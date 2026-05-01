"""
pdf_generator.py — Genera PDF pronti per la stampa professionale.

Features:
  - Formati pagina standard e personalizzati (mm)
  - Abbondanza (bleed) con segni di taglio
  - Margini indipendenti per lato con swap interno/esterno per rilegatura
  - Ridimensionamento foto alla risoluzione target (default 300 dpi)
  - Conversione profilo colore ICC (RGB o CMYK: sRGB, AdobeRGB, FOGRA39, FOGRA51, SWOP)
  - Pagina titolo con mappa GPS embedded
  - Slot didascalia con testo multi-riga
  - Font embedded (Helvetica standard)
  - Fronte/retro con pagine vuote bilanciate
"""

import io
import gc
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from PIL import Image as PILImage, ExifTags, ImageCms
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics

logger = logging.getLogger(__name__)

# ── Page size catalogue (mm, portrait) ───────────────────────────────────────
PAGE_SIZES_MM: dict[str, tuple[float, float]] = {
    "A4":     (210,   297),
    "A3":     (297,   420),
    "A5":     (148,   210),
    "20x20":  (200,   200),
    "20x30":  (200,   300),
    "30x30":  (300,   300),
    "30x40":  (300,   400),
    "Letter": (215.9, 279.4),
    "Custom": (200,   300),
}

# ── ICC profile paths — bundled with the app ─────────────────────────────────
_ICC_DIR = os.path.join(os.path.dirname(__file__), "icc")

ICC_PROFILES: dict[str, str | None] = {
    # RGB
    "srgb":       os.path.join(_ICC_DIR, "srgb.icc"),
    "adobe_rgb":  None,   # not bundled — falls back to sRGB
    # CMYK
    "fogra39":    os.path.join(_ICC_DIR, "fogra39.icc"),   # ISO Coated v2 — EU offset
    "fogra51":    None,   # not bundled — falls back to sRGB
    "swop":       None,   # not bundled — falls back to sRGB
}

def _icc_path(profile_key: str) -> str | None:
    """Return verified ICC path or None if not available."""
    path = ICC_PROFILES.get(profile_key)
    if path and os.path.exists(path):
        return path
    return None


def _parse_page_size(size_name: str, custom_sizes: list | None = None) -> tuple[float, float]:
    if not size_name:
        return (200.0, 300.0)
    if size_name.startswith("Custom_"):
        try:
            parts = size_name[7:].split("x")
            return (float(parts[0]), float(parts[1]))
        except Exception:
            pass
    if size_name in PAGE_SIZES_MM:
        return PAGE_SIZES_MM[size_name]
    if custom_sizes:
        for cs in custom_sizes:
            if cs.get("id") == size_name or cs.get("name") == size_name:
                return (float(cs["w_mm"]), float(cs["h_mm"]))
    return (200.0, 300.0)


def _mm(v: float) -> float:
    """Convert millimetres to ReportLab points."""
    return v * mm


def _fix_orientation(img: PILImage.Image) -> PILImage.Image:
    """Rotate image according to EXIF orientation tag."""
    try:
        exif_raw = img._getexif()
        if not exif_raw:
            return img
        orient_tag = next(
            (v for k, v in ExifTags.TAGS.items() if v == "Orientation"), None
        )
        if not orient_tag:
            return img
        orientation = exif_raw.get(orient_tag)
        if orientation == 3:
            return img.rotate(180, expand=True)
        if orientation == 6:
            return img.rotate(270, expand=True)
        if orientation == 8:
            return img.rotate(90, expand=True)
    except Exception:
        pass
    return img


def _prepare_image(
    img_bytes: bytes,
    slot_w_pt: float,
    slot_h_pt: float,
    dpi: int,
    color_profile: str,
    pan_x: float = 50.0,
    pan_y: float = 50.0,
    zoom: float = 1.0,
) -> tuple[bytes, float, float, float, float]:
    """
    Process an image for PDF embedding.
    1. Fix EXIF orientation
    2. Compute cover-crop scale (fill slot), then apply zoom
    3. Apply pan offset (pan_x/pan_y 0-100)
    4. Resize to target DPI
    5. Convert colour profile (ICC)
    6. Re-encode as JPEG

    Returns (jpeg_bytes, draw_x_offset, draw_y_offset, draw_w_pt, draw_h_pt)
    where offsets position the (full-size) image so the correct pan area
    appears inside the slot when clipped.
    """
    pil = PILImage.open(io.BytesIO(img_bytes))
    pil = _fix_orientation(pil)

    iw, ih = pil.size
    # Base scale: image just covers the slot (cover-crop)
    base_scale = max(slot_w_pt / iw, slot_h_pt / ih)
    # Apply zoom (zoom<1 → image smaller than slot → letterboxed, matches preview)
    eff_zoom = max(0.01, float(zoom))
    scale = base_scale * eff_zoom
    draw_w = iw * scale
    draw_h = ih * scale

    # Pan offset: 0=top/left, 50=center, 100=bottom/right
    # ReportLab is y-up; CSS is y-down → Y pan must be inverted (1-pan_fy)
    pan_fx = pan_x / 100.0
    pan_fy = pan_y / 100.0
    ox = (draw_w - slot_w_pt) * pan_fx        if draw_w >= slot_w_pt else -(slot_w_pt - draw_w) / 2
    oy = (draw_h - slot_h_pt) * (1.0 - pan_fy) if draw_h >= slot_h_pt else -(slot_h_pt - draw_h) / 2

    # ── Resize to target DPI ──────────────────────────────────────────────
    target_w_px = round(draw_w / 72 * dpi)
    target_h_px = round(draw_h / 72 * dpi)
    # Only downscale (never upscale originals)
    if target_w_px < iw or target_h_px < ih:
        pil = pil.resize((target_w_px, target_h_px), PILImage.LANCZOS)
        # Recompute draw dimensions from resized pixel size
        iw2, ih2 = pil.size
        scale2 = max(slot_w_pt / iw2, slot_h_pt / ih2) * eff_zoom
        draw_w = iw2 * scale2
        draw_h = ih2 * scale2
        ox = (draw_w - slot_w_pt) * pan_fx
        oy = (draw_h - slot_h_pt) * (1.0 - pan_fy)

    # ── Colour profile conversion ─────────────────────────────────────────
    is_cmyk = color_profile in ("fogra39", "fogra51", "swop")
    icc_path = _icc_path(color_profile)
    src_path  = _icc_path("srgb")

    if icc_path and src_path:
        try:
            src_profile = ImageCms.getOpenProfile(src_path)
            dst_profile = ImageCms.getOpenProfile(icc_path)
            pil_rgb = pil.convert("RGB") if pil.mode != "RGB" else pil
            dst_mode = "CMYK" if is_cmyk else "RGB"
            transform = ImageCms.buildTransform(
                src_profile, dst_profile, "RGB", dst_mode,
                renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                flags=(lambda: (
        ImageCms.FLAGS.get("BLACKPOINTCOMPENSATION", 0)
        if hasattr(ImageCms, "FLAGS") and isinstance(ImageCms.FLAGS, dict) else 0
    ))(),
            )
            pil = ImageCms.applyTransform(pil_rgb, transform)
        except Exception as e:
            logger.warning(f"ICC conversion failed ({color_profile}): {e}")
            pil = pil.convert("RGB")
    else:
        pil = pil.convert("RGB")
        if icc_path is None and color_profile not in ("srgb", "adobe_rgb"):
            logger.warning(f"ICC profile not found for '{color_profile}', using sRGB")

    # ── Re-encode ─────────────────────────────────────────────────────────
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=92, optimize=True, dpi=(dpi, dpi))
    buf.seek(0)
    return buf.read(), ox, oy, draw_w, draw_h


def _draw_cover_photo(c: canvas.Canvas, img_bytes: bytes,
                      x: float, y: float, w: float, h: float,
                      dpi: int = 300, color_profile: str = "srgb") -> None:
    """Draw photo filling the slot with crop, DPI resize and colour conversion."""
    try:
        buf, ox, oy, draw_w, draw_h = _prepare_image(img_bytes, w, h, dpi, color_profile)
        c.saveState()
        p = c.beginPath()
        p.rect(x, y, w, h)
        c.clipPath(p, stroke=0)
        c.drawImage(ImageReader(buf), x - ox, y - oy,
                    width=draw_w, height=draw_h, mask="auto")
        c.restoreState()
    except Exception as e:
        logger.warning(f"Photo draw error: {e}")
        c.setFillColorRGB(0.82, 0.81, 0.79)
        c.rect(x, y, w, h, fill=1, stroke=0)


def _draw_text_wrapped(c: canvas.Canvas, text: str,
                       x: float, y: float, max_w: float,
                       font: str, size: float, leading: float,
                       color: tuple = (0.95, 0.93, 0.88),
                       max_lines: int = 20,
                       align: str = "left") -> float:
    c.setFont(font, size)
    c.setFillColorRGB(*color)

    def _emit(ln, cy):
        if align == "center":
            c.drawCentredString(x + max_w / 2, cy, ln)
        elif align == "right":
            c.drawRightString(x + max_w, cy, ln)
        else:
            c.drawString(x, cy, ln)

    words = text.split()
    line = ""
    cur_y = y
    lines_drawn = 0
    for word in words:
        test = (line + " " + word).strip()
        if c.stringWidth(test, font, size) <= max_w:
            line = test
        else:
            if line:
                _emit(line, cur_y)
                cur_y -= leading
                lines_drawn += 1
                if lines_drawn >= max_lines:
                    return cur_y
            line = word
    if line and lines_drawn < max_lines:
        _emit(line, cur_y)
        cur_y -= leading
    return cur_y


def _draw_bleed_marks(c: canvas.Canvas, pw: float, ph: float, bleed: float) -> None:
    c.saveState()
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.5)
    mark = _mm(5)
    gap  = _mm(1.5)
    corners = [
        (bleed, bleed,        -1, -1),
        (pw - bleed, bleed,    1, -1),
        (bleed, ph - bleed,   -1,  1),
        (pw - bleed, ph - bleed, 1, 1),
    ]
    for cx, cy, dx, dy in corners:
        c.line(cx + dx * gap, cy, cx + dx * (gap + mark), cy)
        c.line(cx, cy + dy * gap, cx, cy + dy * (gap + mark))
    c.restoreState()



def _draw_divider_page(c: canvas.Canvas, page: dict,
                       processed_cache: dict,
                       pw: float, ph: float,
                       ml: float, mr: float, mt: float, mb: float,
                       gap: float, bleed: float,
                       crop_marks: bool = False,
                       pan_offsets: dict | None = None,
                       page_idx: int = 0,
                       profile_cs: dict | None = None) -> None:
    """
    Renders an album divider page.
    Works like _draw_photo_page_fast but also handles dynamic content slots:
      type == 'album_name'   → album name text
      type == 'photo_count'  → photo count
      type == 'year'         → year range from album
      type == 'map'          → GPS map image (stored in item as base64 or bytes key)
    """
    cs = page.get("_divider_style") or {}
    if bleed > 0 and crop_marks:
        _draw_bleed_marks(c, pw, ph, bleed)

    album_info = page.get("_album_info") or {}
    album_name  = album_info.get("albumName", "")
    asset_count = album_info.get("assetCount", 0)
    date_range  = album_info.get("dateRange", "")
    accent      = cs.get("accent_color", "#d4aa5a")
    text_color  = cs.get("text_color", "#f0ede6")

    ux = ml
    uw = pw - ml - mr
    uh = ph - mt - mb

    items = page.get("items", [])
    if not items:
        # Default layout: centered album name
        cx, cy = pw / 2, ph / 2
        ar, ag, ab = _hex_to_rgb(accent)
        c.setStrokeColorRGB(ar, ag, ab)
        c.setLineWidth(0.6)
        c.line(ml + _mm(10), cy, pw - mr - _mm(10), cy)
        c.setFillColorRGB(*_hex_to_rgb(text_color))
        c.setFont("Helvetica-Bold", _mm(14))
        c.drawCentredString(pw / 2, cy + _mm(8), album_name or "Album")
        if date_range:
            c.setFont("Helvetica", _mm(6))
            c.setFillColorRGB(ar, ag, ab)
            c.drawCentredString(pw / 2, cy - _mm(10), date_range)
        if asset_count:
            c.setFont("Helvetica", _mm(5))
            c.drawCentredString(pw / 2, cy - _mm(18), f"{asset_count} fotografie")
        return

    # Slot-based layout
    for slot_idx, item_data in enumerate(items):
        slot = item_data.get("slot", {"x":0,"y":0,"w":100,"h":100})
        item = item_data.get("item")
        le = slot["x"] < 0.5
        te = slot["y"] < 0.5
        re = (slot["x"] + slot["w"]) > 99.5
        be = (slot["y"] + slot["h"]) > 99.5
        sx     = ux + (slot["x"] / 100) * uw + (0 if le else gap / 2)
        sy_top = (slot["y"] / 100) * uh       + (0 if te else gap / 2)
        sw     = (slot["w"] / 100) * uw - (0 if le else gap/2) - (0 if re else gap/2)
        sh     = (slot["h"] / 100) * uh - (0 if te else gap/2) - (0 if be else gap/2)
        sy = ph - mt - sy_top - sh
        if sw <= 0 or sh <= 0:
            continue
        if item is None:
            continue
        itype = item.get("type", "")
        if itype == "photo":
            aid = item.get("asset_id", "")
            po    = (pan_offsets or {}).get(f"{page_idx}_{slot_idx}", {})
            pan_x = po.get("x", item.get("_pan_x", 50.0))
            pan_y = po.get("y", item.get("_pan_y", 50.0))
            zoom  = float(po.get("zoom", 1.0))
            key   = (aid, round(sw), round(sh), round(pan_x), round(pan_y), round(zoom*100))
            pre = processed_cache.get(key)
            if pre:
                jpeg_bytes, ox, oy, draw_w, draw_h = pre
                try:
                    c.saveState()
                    p = c.beginPath(); p.rect(sx, sy, sw, sh)
                    c.clipPath(p, stroke=0)
                    c.drawImage(ImageReader(io.BytesIO(jpeg_bytes)),
                                sx - ox, sy - oy, width=draw_w, height=draw_h, mask="auto")
                    c.restoreState()
                except Exception as e:
                    logger.warning(f"Divider photo draw error: {e}")
        elif itype == "caption":
            _render_caption_slot(c, item, sx, sy, sw, sh, profile_cs=profile_cs)
        elif itype in ("album_name", "photo_count", "year", "date_range"):
            # Dynamic text slot
            ar, ag, ab = _hex_to_rgb(accent)
            tr, tg, tb = _hex_to_rgb(text_color)
            c.setFillColorRGB(*_hex_to_rgb(cs.get("bg", "#13141a")))
            c.rect(sx, sy, sw, sh, fill=1, stroke=0)
            if itype == "album_name":
                fs = min(_mm(12), sw / max(len(album_name or "A"), 1) * 1.4)
                fs = max(fs, _mm(5))
                c.setFont("Helvetica-Bold", fs)
                c.setFillColorRGB(tr, tg, tb)
                c.drawCentredString(sx + sw/2, sy + sh/2 - fs/3, album_name or "Album")
            elif itype == "photo_count":
                text = f"{asset_count} fotografie"
                c.setFont("Helvetica", _mm(7))
                c.setFillColorRGB(ar, ag, ab)
                c.drawCentredString(sx + sw/2, sy + sh/2 - _mm(3.5), text)
            elif itype in ("year", "date_range"):
                c.setFont("Helvetica", _mm(6))
                c.setFillColorRGB(ar, ag, ab)
                c.drawCentredString(sx + sw/2, sy + sh/2 - _mm(3), date_range or "")
        elif itype == "map":
            map_bytes = item.get("_map_bytes")
            if map_bytes:
                try:
                    pil = PILImage.open(io.BytesIO(map_bytes)).convert("RGB")
                    buf = io.BytesIO(); pil.save(buf, "JPEG", quality=88); buf.seek(0)
                    iw, ih = pil.size
                    scale = min(sw / iw, sh / ih)
                    dw, dh = iw*scale, ih*scale
                    c.saveState()
                    p = c.beginPath(); p.rect(sx, sy, sw, sh)
                    c.clipPath(p, stroke=0)
                    c.drawImage(ImageReader(buf), sx + (sw-dw)/2, sy + (sh-dh)/2,
                                width=dw, height=dh, mask="auto")
                    c.restoreState()
                except Exception as e:
                    logger.warning(f"Divider map draw error: {e}")


def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    """Convert #rrggbb to (r, g, b) floats 0-1."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (0.08, 0.08, 0.10)
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def _draw_title_page(c: canvas.Canvas, album: dict,
                     map_image: Optional[bytes],
                     pw: float, ph: float,
                     margin: float, bleed: float,
                     crop_marks: bool = False,
                     ml: float | None = None, mr: float | None = None,
                     mt: float | None = None, mb: float | None = None) -> None:
    # Use per-side margins if provided, otherwise fall back to symmetric margin
    _ml = ml if ml is not None else margin
    _mr = mr if mr is not None else margin
    _mt = mt if mt is not None else margin
    _mb = mb if mb is not None else margin

    if bleed > 0 and crop_marks:
        _draw_bleed_marks(c, pw, ph, bleed)

    content_h = ph - 2 * margin

    # Map image (upper 55%)
    if map_image:
        try:
            map_h = content_h * 0.55
            map_y = margin + content_h * 0.45
            pil = PILImage.open(io.BytesIO(map_image)).convert("RGB")
            buf = io.BytesIO()
            pil.save(buf, format="JPEG", quality=88)
            buf.seek(0)
            c.saveState()
            p = c.beginPath()
            p.rect(margin, map_y, pw - 2 * margin, map_h)
            c.clipPath(p, stroke=0)
            iw, ih = pil.size
            scale = max((pw - 2 * margin) / iw, map_h / ih)
            dw, dh = iw * scale, ih * scale
            c.drawImage(ImageReader(buf),
                        margin - (dw - (pw - 2 * margin)) / 2,
                        map_y - (dh - map_h) / 2,
                        width=dw, height=dh, mask="auto")
            c.restoreState()
            c.setFillColorRGB(0.04, 0.04, 0.06)
            # Gradient-like fade at bottom of map
            for i in range(20):
                alpha = i / 20
                c.setFillColorRGB(0.04, 0.04, 0.06)
                c.setFillAlpha(alpha)
                c.rect(margin, map_y, pw - 2 * margin, map_h * 0.3 * (i / 20))
            c.setFillAlpha(1)
        except Exception as e:
            logger.warning(f"Map draw error: {e}")

    # Gold accent line
    line_y = margin + content_h * 0.38
    c.setStrokeColorRGB(0.83, 0.67, 0.35)
    c.setLineWidth(0.8)
    c.line(margin, line_y, pw - margin, line_y)

    # Album title
    title = album.get("albumName", "")
    if title:
        c.setFillColorRGB(0.94, 0.92, 0.86)
        font_size = min(_mm(14), (pw - 2 * margin) / max(len(title), 1) * 1.6)
        font_size = max(font_size, _mm(7))
        max_title_w = pw - _ml - _mr
        c.setFont("Helvetica-Light" if "Helvetica-Light" in pdfmetrics.getRegisteredFontNames() else "Helvetica", font_size)
        title_y = line_y - _mm(12)
        _draw_text_wrapped(c, title, _ml, title_y, max_title_w,
                           "Helvetica", font_size, font_size * 1.3, (0.94, 0.92, 0.86), 3)

    # Description
    desc = album.get("description", "")
    if desc:
        desc_y = line_y - _mm(24)
        _draw_text_wrapped(c, desc, margin, desc_y, pw - 2 * margin,
                           "Helvetica-Oblique", _mm(5.5), _mm(8),
                           (0.65, 0.63, 0.60), 4)

    # Footer
    assets = album.get("assets", [])
    photo_count = len(assets)
    foot_y = margin + _mm(5)
    c.setFont("Helvetica", _mm(4))
    c.setFillColorRGB(0.45, 0.43, 0.41)
    date_range = _date_range(assets)
    if date_range:
        c.drawString(margin, foot_y, date_range)
    c.drawRightString(pw - margin, foot_y, f"{photo_count} fotografie")


def _slot_geometry(slot, ux, uw, ph, mt, gap):
    """Compute (sx, sy, sw, sh) for a slot dict within the page content area."""
    left_edge  = slot["x"] < 0.5
    top_edge   = slot["y"] < 0.5
    right_edge = (slot["x"] + slot["w"]) > 99.5
    bot_edge   = (slot["y"] + slot["h"]) > 99.5
    sx     = ux + (slot["x"] / 100) * uw + (0 if left_edge  else gap / 2)
    sy_top = (slot["y"] / 100) * (ph - mt) + (0 if top_edge else gap / 2)
    sw     = (slot["w"] / 100) * uw - (0 if left_edge  else gap / 2) \
                                     - (0 if right_edge else gap / 2)
    sh     = (slot["h"] / 100) * (ph - mt) - (0 if top_edge else gap / 2) \
                                            - (0 if bot_edge else gap / 2)
    return sx, ph - mt - sy_top - sh, sw, sh


def _draw_photo_page(c: canvas.Canvas, page: dict,
                     photo_cache: dict,
                     pw: float, ph: float,
                     ml: float, mr: float, mt: float, mb: float,
                     gap: float, bleed: float,
                     dpi: int = 300,
                     color_profile: str = "srgb",
                     crop_marks: bool = False,
                     profile_cs: dict | None = None) -> None:
    """Legacy: render page using raw photo_cache (for SmartLayout preview path)."""
    if bleed > 0 and crop_marks:
        _draw_bleed_marks(c, pw, ph, bleed)
    items = page.get("items", [])
    if not items:
        return
    ux = ml
    uw = pw - ml - mr
    uh = ph - mt - mb
    for item_data in items:
        slot = item_data.get("slot", {"x":0,"y":0,"w":100,"h":100})
        item = item_data.get("item")
        left_edge  = slot["x"] < 0.5
        top_edge   = slot["y"] < 0.5
        right_edge = (slot["x"] + slot["w"]) > 99.5
        bot_edge   = (slot["y"] + slot["h"]) > 99.5
        sx     = ux + (slot["x"] / 100) * uw + (0 if left_edge  else gap / 2)
        sy_top = (slot["y"] / 100) * uh       + (0 if top_edge   else gap / 2)
        sw     = (slot["w"] / 100) * uw        - (0 if left_edge  else gap / 2) \
                                                - (0 if right_edge else gap / 2)
        sh     = (slot["h"] / 100) * uh        - (0 if top_edge   else gap / 2) \
                                                - (0 if bot_edge   else gap / 2)
        sy = ph - mt - sy_top - sh
        if sw <= 0 or sh <= 0:
            continue
        if item is None:
            c.setFillColorRGB(0.87, 0.85, 0.82)
            c.rect(sx, sy, sw, sh, fill=1, stroke=0)
            continue
        if item["type"] == "caption":
            _render_caption_slot(c, item, sx, sy, sw, sh, profile_cs=profile_cs)
        else:
            img_bytes = photo_cache.get(item.get("asset_id", ""))
            if img_bytes:
                _draw_cover_photo(c, img_bytes, sx, sy, sw, sh, dpi, color_profile)
            else:
                c.setFillColorRGB(0.80, 0.78, 0.75)
                c.rect(sx, sy, sw, sh, fill=1, stroke=0)
                c.setFillColorRGB(0.55, 0.53, 0.50)
                c.setFont("Helvetica", _mm(5))
                c.drawCentredString(sx + sw / 2, sy + sh / 2 - _mm(2.5), "📷")


def _draw_photo_page_fast(c: canvas.Canvas, page: dict,
                          processed_cache: dict,
                          pw: float, ph: float,
                          ml: float, mr: float, mt: float, mb: float,
                          gap: float, bleed: float,
                          crop_marks: bool = False,
                          pan_offsets: dict | None = None,
                          page_idx: int = 0,
                          profile_cs: dict | None = None) -> None:
    """
    Fast render: images already pre-processed (JPEG bytes, offsets pre-computed).
    pan_offsets: {"pageIdx_slotIdx": {x, y, zoom}} from frontend editor.
    page_idx: 0-based index into the pages list (matches frontend panKey).
    """
    if bleed > 0 and crop_marks:
        _draw_bleed_marks(c, pw, ph, bleed)
    items = page.get("items", [])
    if not items:
        return
    ux = ml
    uw = pw - ml - mr
    uh = ph - mt - mb
    for slot_idx, item_data in enumerate(items):
        slot = item_data.get("slot", {"x":0,"y":0,"w":100,"h":100})
        item = item_data.get("item")
        left_edge  = slot["x"] < 0.5
        top_edge   = slot["y"] < 0.5
        right_edge = (slot["x"] + slot["w"]) > 99.5
        bot_edge   = (slot["y"] + slot["h"]) > 99.5
        sx     = ux + (slot["x"] / 100) * uw + (0 if left_edge  else gap / 2)
        sy_top = (slot["y"] / 100) * uh       + (0 if top_edge   else gap / 2)
        sw     = (slot["w"] / 100) * uw        - (0 if left_edge  else gap / 2) \
                                                - (0 if right_edge else gap / 2)
        sh     = (slot["h"] / 100) * uh        - (0 if top_edge   else gap / 2) \
                                                - (0 if bot_edge   else gap / 2)
        sy = ph - mt - sy_top - sh
        if sw <= 0 or sh <= 0:
            continue
        if item is None:
            c.setFillColorRGB(0.87, 0.85, 0.82)
            c.rect(sx, sy, sw, sh, fill=1, stroke=0)
            continue
        if item["type"] == "caption":
            _render_caption_slot(c, item, sx, sy, sw, sh, profile_cs=profile_cs)
            continue
        # Photo: look up pre-processed data using pan-inclusive key
        aid = item.get("asset_id", "")
        po    = (pan_offsets or {}).get(f"{page_idx}_{slot_idx}", {})
        pan_x = po.get("x", item.get("_pan_x", 50.0))
        pan_y = po.get("y", item.get("_pan_y", 50.0))
        zoom  = float(po.get("zoom", 1.0))
        key   = (aid, round(sw), round(sh), round(pan_x), round(pan_y), round(zoom*100))
        pre = processed_cache.get(key)
        if pre:
            jpeg_bytes, ox, oy, draw_w, draw_h = pre
            try:
                c.saveState()
                p = c.beginPath()
                p.rect(sx, sy, sw, sh)
                c.clipPath(p, stroke=0)
                c.drawImage(ImageReader(io.BytesIO(jpeg_bytes)),
                            sx - ox, sy - oy,
                            width=draw_w, height=draw_h, mask="auto")
                c.restoreState()
            except Exception as e:
                logger.warning(f"Draw error {aid}: {e}")
                c.setFillColorRGB(0.80, 0.78, 0.75)
                c.rect(sx, sy, sw, sh, fill=1, stroke=0)
        else:
            # Fallback: gray placeholder
            c.setFillColorRGB(0.80, 0.78, 0.75)
            c.rect(sx, sy, sw, sh, fill=1, stroke=0)
            c.setFillColorRGB(0.55, 0.53, 0.50)
            c.setFont("Helvetica", _mm(5))
            c.drawCentredString(sx + sw / 2, sy + sh / 2 - _mm(2.5), "📷")


def _render_caption_slot(c: canvas.Canvas, item: dict,
                          x: float, y: float, w: float, h: float,
                          profile_cs: dict | None = None) -> None:
    cs       = {**(profile_cs or {}), **(item.get("caption_style") or {})}
    bg       = cs.get("bg", "#111116")
    clr      = cs.get("color", "#e8e6e0")
    size_px  = float(cs.get("size", 13) or 13)
    italic   = cs.get("italic", True)
    bold     = cs.get("bold", False)
    align    = cs.get("align", "left")
    lh_mult  = float(cs.get("lineHeight", 1.45) or 1.45)
    font_str = (cs.get("font") or "Georgia").lower()

    if "courier" in font_str or "mono" in font_str:
        base = "Courier"
    elif any(k in font_str for k in ("helvetica", "arial", "sans", "montserrat")):
        base = "Helvetica"
    else:
        base = "Times"

    if bold and italic:
        font_name = "Times-BoldItalic" if base == "Times" else f"{base}-BoldOblique"
    elif bold:
        font_name = "Times-Bold" if base == "Times" else f"{base}-Bold"
    elif italic:
        font_name = "Times-Italic" if base == "Times" else f"{base}-Oblique"
    else:
        font_name = "Times-Roman" if base == "Times" else base

    if bg and bg != "transparent":
        c.setFillColorRGB(*_hex_to_rgb(bg))
        c.rect(x, y, w, h, fill=1, stroke=0)

    text = (item.get("text") or "").strip()
    if not text:
        return

    font_size = min(_mm(size_px * 0.42), h / 5)
    font_size = max(font_size, _mm(3))
    leading   = font_size * lh_mult
    inner_x   = x + _mm(5)
    inner_w   = w - _mm(10)
    max_lines = max(2, int((h - _mm(8)) / leading))
    start_y   = y + h - _mm(6) - font_size
    _draw_text_wrapped(c, text, inner_x, start_y, inner_w,
                       font_name, font_size, leading,
                       color=_hex_to_rgb(clr), max_lines=max_lines, align=align)


def _date_range(assets: list) -> str:
    dates = sorted(a.get("localDateTime", "")[:7]
                   for a in assets if a.get("localDateTime"))
    if not dates:
        return ""
    return dates[0] if dates[0] == dates[-1] else f"{dates[0]} — {dates[-1]}"


# ── Public API ────────────────────────────────────────────────────────────────

def generate_pdf(
    album: dict,
    pages: list[dict],
    profile: dict,
    photo_cache: dict[str, bytes],
    map_image: Optional[bytes] = None,
    on_page_progress: "callable | None" = None,
    pan_offsets: dict | None = None,
) -> bytes:
    """
    Generate the complete photobook PDF.
    Profile fields used:
      page_size, orientation, duplex
      margin_mm, margin_top, margin_right, margin_bottom, margin_left
      bleed, bleed_mm, gap_mm
      export_dpi        (int,  default 300)
      color_profile     (str,  default "srgb")
                        one of: srgb, adobe_rgb, fogra39, fogra51, swop
    """
    size_name    = profile.get("page_size", "20x30")
    pw_mm, ph_mm = _parse_page_size(size_name)

    if profile.get("orientation", "portrait") == "landscape":
        pw_mm, ph_mm = ph_mm, pw_mm

    bleed_mm  = profile.get("bleed_mm", 3.0) if profile.get("bleed") else 0.0
    margin_mm = profile.get("margin_mm", 5.0)
    gap_mm    = profile.get("gap_mm",    3.0)
    duplex    = profile.get("duplex",    False)
    dpi       = int(profile.get("export_dpi", 300) or 300)
    color_profile = str(profile.get("color_profile", "srgb") or "srgb").lower()
    crop_marks = bool(profile.get("crop_marks", False))

    # Independent margins (fall back to margin_mm for all sides if not set)
    mt = float(profile.get("margin_top",    margin_mm) or margin_mm)
    mr = float(profile.get("margin_right",  margin_mm) or margin_mm)
    mb = float(profile.get("margin_bottom", margin_mm) or margin_mm)
    ml = float(profile.get("margin_left",   margin_mm) or margin_mm)

    logger.info(f"PDF export: {pw_mm}×{ph_mm}mm {dpi}dpi color={color_profile} "
                f"margins T{mt}/R{mr}/B{mb}/L{ml}mm bleed={bleed_mm}mm")

    pw    = _mm(pw_mm + 2 * bleed_mm)
    ph    = _mm(ph_mm + 2 * bleed_mm)
    bleed = _mm(bleed_mm)
    gap   = _mm(gap_mm)
    margin = _mm(margin_mm + bleed_mm)  # for title page (symmetric)

    def margins_for_page(page_num: int):
        """
        Calcola i margini per la pagina page_num (1-based).

        Convenzione profilo (coerente con le label UI):
          ml (margin_left)  = ESTERNO  ("← Esterno")
          mr (margin_right) = INTERNO  ("Interno →", lato rilegatura)

        duplex=False: esterno sempre a sinistra, interno sempre a destra.
        duplex=True:  i margini alternano in base alla pagina:
          pagine DISPARI = destra del libro → rilegatura a SINISTRA → interno a sx, esterno a dx
          pagine PARI    = sinistra del libro → rilegatura a DESTRA → esterno a sx, interno a dx
        """
        outer_val = ml   # margin_left  = ESTERNO
        inner_val = mr   # margin_right = INTERNO / rilegatura
        if duplex:
            if page_num % 2 == 0:
                # Pagina PARI = destra del libro → rilegatura a SINISTRA
                m_l, m_r = inner_val, outer_val
            else:
                # Pagina DISPARI = sinistra del libro → rilegatura a DESTRA
                m_l, m_r = outer_val, inner_val
        else:
            # Non duplex: esterno fisso a sx, interno fisso a dx
            m_l, m_r = outer_val, inner_val
        return (
            _mm(m_l + bleed_mm),
            _mm(m_r + bleed_mm),
            _mm(mt  + bleed_mm),
            _mm(mb  + bleed_mm),
        )

    # ── Phase 1: Pre-process all unique images in parallel ───────────────────
    # Collect (asset_id, slot_w_pt, slot_h_pt, pan_x, pan_y) for every photo slot.
    # Use (asset_id, round(w), round(h)) as cache key — same photo, same slot size → reuse.
    photo_jobs: list[tuple] = []  # (asset_id, w_pt, h_pt, pan_x, pan_y)
    # Phase 1 must use per-page margins (same as Phase 2) so slot dimensions match.
    # page_counter in Phase 2 starts at 2 (cover=1) + 1 if duplex blank page.
    _p1_counter = 3 if duplex else 2
    for page_idx, page in enumerate(pages):
        if page.get("_album_cover") or page.get("_album_separator"):
            _p1_counter += 1
            continue
        # Divider and regular pages both have slots — fall through
        ml_pt1, mr_pt1, mt_pt1, mb_pt1 = margins_for_page(_p1_counter)
        uw1 = pw - ml_pt1 - mr_pt1
        uh1 = ph - mt_pt1 - mb_pt1
        items = page.get("items", [])
        for slot_idx, item_data in enumerate(items):
            slot = item_data.get("slot", {})
            item = item_data.get("item")
            if not item or item.get("type") != "photo":
                continue
            aid = item.get("asset_id", "")
            if not aid or aid not in photo_cache:
                continue
            # Apply the same edge + gap logic as _draw_photo_page_fast so the
            # cache key (aid, round_w, round_h) matches exactly in Phase 2.
            le = slot.get("x", 0) < 0.5
            re = (slot.get("x", 0) + slot.get("w", 100)) > 99.5
            te = slot.get("y", 0) < 0.5
            be = (slot.get("y", 0) + slot.get("h", 100)) > 99.5
            sw_pt = (slot.get("w", 100) / 100) * uw1 \
                    - (0 if le else gap / 2) \
                    - (0 if re else gap / 2)
            sh_pt = (slot.get("h", 100) / 100) * uh1 \
                    - (0 if te else gap / 2) \
                    - (0 if be else gap / 2)
            if sw_pt <= 0 or sh_pt <= 0:
                continue
            # pan_offsets (frontend editor) takes priority over _pan_x/_pan_y (face detection)
            po = (pan_offsets or {}).get(f"{page_idx}_{slot_idx}", {})
            pan_x = po.get("x", item.get("_pan_x", 50.0))
            pan_y = po.get("y", item.get("_pan_y", 50.0))
            zoom  = float(po.get("zoom", 1.0))
            photo_jobs.append((aid, sw_pt, sh_pt, pan_x, pan_y, zoom))
        _p1_counter += 1

    # Deduplicate by cache key (includes pan+zoom so edits produce distinct cached images)
    seen_keys: set = set()
    unique_jobs: list[tuple] = []
    for job in photo_jobs:
        key = (job[0], round(job[1]), round(job[2]), round(job[3]), round(job[4]), round(job[5]*100))
        if key not in seen_keys:
            seen_keys.add(key)
            unique_jobs.append(job)

    logger.info(f"PDF pre-processing: {len(unique_jobs)} unique image jobs "
                f"({len(photo_jobs)} total placements)")

    # Processed image cache: (aid, round_w, round_h) → (jpeg_bytes, ox, oy, dw, dh)
    processed_cache: dict[tuple, tuple] = {}
    n_jobs = len(unique_jobs)
    n_done = 0

    def _process_one(job: tuple) -> tuple:
        aid, sw_pt, sh_pt, pan_x, pan_y, zoom = job
        raw = photo_cache.get(aid)
        cache_key = (aid, round(sw_pt), round(sh_pt), round(pan_x), round(pan_y), round(zoom*100))
        if not raw:
            return cache_key, None
        try:
            result = _prepare_image(raw, sw_pt, sh_pt, dpi, color_profile, pan_x, pan_y, zoom)
            return cache_key, result
        except Exception as e:
            logger.warning(f"Image pre-process failed for {aid}: {e}")
            return cache_key, None

    # Parallel processing: 4 workers (PIL releases GIL → real concurrency)
    n_workers = min(4, max(1, n_jobs))
    if n_jobs > 0:
        if on_page_progress:
            on_page_progress(0, n_jobs + len(pages))  # phase 1 starts

        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futures = {pool.submit(_process_one, job): job for job in unique_jobs}
            for fut in as_completed(futures):
                key, result = fut.result()
                if result is not None:
                    processed_cache[key] = result
                n_done += 1
                if on_page_progress:
                    on_page_progress(n_done, n_jobs + len(pages))

    # Raw cache no longer needed — free memory
    photo_cache.clear()
    gc.collect()
    logger.info(f"Pre-processing done: {len(processed_cache)}/{n_jobs} images ready")

    # ── Phase 2: PDF rendering (sequential, fast — no image decoding) ─────────
    # Write to a temp file to avoid holding the whole PDF in RAM
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        cv  = canvas.Canvas(tmp_path, pagesize=(pw, ph))
        cv.setTitle(album.get("albumName", "Fotolibro"))
        cv.setAuthor("PhotoBook Studio")
        cv.setCreator("PhotoBook Studio")

        # Title page
        _draw_title_page(cv, album, map_image, pw, ph, margin, bleed, crop_marks=crop_marks,
                 ml=_mm(ml + bleed_mm), mr=_mm(mr + bleed_mm),
                 mt=_mm(mt + bleed_mm), mb=_mm(mb + bleed_mm))
        cv.showPage()

        page_counter = 2
        if duplex:
            cv.showPage()
            page_counter += 1

        n_pages = len(pages)
        for page_idx, page in enumerate(pages):
            if on_page_progress:
                on_page_progress(n_done + page_idx, n_jobs + n_pages)

            if page.get("_album_cover") or page.get("_album_separator"):
                cv.showPage()
                page_counter += 1
                continue

            ml_pt, mr_pt, mt_pt, mb_pt = margins_for_page(page_counter)
            profile_cs = profile.get("caption_style") or {}
            if page.get("_album_divider"):
                _draw_divider_page(cv, page, processed_cache, pw, ph,
                                   ml_pt, mr_pt, mt_pt, mb_pt, gap, bleed,
                                   crop_marks=crop_marks,
                                   pan_offsets=pan_offsets,
                                   page_idx=page_idx,
                                   profile_cs=profile_cs)
            else:
                _draw_photo_page_fast(cv, page, processed_cache, pw, ph,
                                      ml_pt, mr_pt, mt_pt, mb_pt, gap, bleed,
                                      crop_marks=crop_marks,
                                      pan_offsets=pan_offsets,
                                      page_idx=page_idx,
                                      profile_cs=profile_cs)
            cv.showPage()
            page_counter += 1

        if duplex and page_counter % 2 != 0:
            cv.showPage()

        cv.save()
        processed_cache.clear()
        gc.collect()

        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
