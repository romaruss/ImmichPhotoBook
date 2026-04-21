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
import logging
import os
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
) -> tuple[bytes, float, float, float, float]:
    """
    Process an image for PDF embedding:
    1. Fix EXIF orientation
    2. Compute cover-crop scale (fill slot)
    3. Resize to target DPI at the slot's physical size
    4. Convert colour profile (ICC)
    5. Re-encode as JPEG

    Returns (jpeg_bytes, draw_x_offset, draw_y_offset, draw_w_pt, draw_h_pt)
    where offsets position the image to cover the slot.
    """
    pil = PILImage.open(io.BytesIO(img_bytes))
    pil = _fix_orientation(pil)

    iw, ih = pil.size
    scale = max(slot_w_pt / iw, slot_h_pt / ih)
    draw_w = iw * scale
    draw_h = ih * scale
    ox = (draw_w - slot_w_pt) / 2
    oy = (draw_h - slot_h_pt) / 2

    # ── Resize to target DPI ──────────────────────────────────────────────
    # Physical slot size in inches
    slot_w_in = slot_w_pt / 72
    slot_h_in = slot_h_pt / 72
    # Target pixel size for the full (scaled) image
    target_w_px = round(draw_w / 72 * dpi)
    target_h_px = round(draw_h / 72 * dpi)
    # Only downscale (never upscale originals)
    if target_w_px < iw or target_h_px < ih:
        pil = pil.resize((target_w_px, target_h_px), PILImage.LANCZOS)
        draw_w = slot_w_pt + (ox / iw) * 2 * target_w_px / iw * 72 / dpi * iw
        # Recompute with new pixel size
        iw2, ih2 = pil.size
        scale2 = max(slot_w_pt / iw2, slot_h_pt / ih2)
        draw_w = iw2 * scale2
        draw_h = ih2 * scale2
        ox = (draw_w - slot_w_pt) / 2
        oy = (draw_h - slot_h_pt) / 2

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
                flags=ImageCms.FLAGS["BLACKPOINTCOMPENSATION"],
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
    pil.save(buf, format="JPEG", quality=92, optimize=True,
             dpi=(dpi, dpi))
    buf.seek(0)
    return buf, ox, oy, draw_w, draw_h


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
                       max_lines: int = 20) -> float:
    c.setFont(font, size)
    c.setFillColorRGB(*color)
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
                c.drawString(x, cur_y, line)
                cur_y -= leading
                lines_drawn += 1
                if lines_drawn >= max_lines:
                    return cur_y
            line = word
    if line and lines_drawn < max_lines:
        c.drawString(x, cur_y, line)
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


def _draw_title_page(c: canvas.Canvas, album: dict,
                     map_image: Optional[bytes],
                     pw: float, ph: float,
                     margin: float, bleed: float) -> None:
    # Dark background
    c.setFillColorRGB(0.04, 0.04, 0.06)
    c.rect(0, 0, pw, ph, fill=1, stroke=0)

    if bleed > 0:
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
        max_title_w = pw - 2 * margin
        c.setFont("Helvetica-Light" if "Helvetica-Light" in pdfmetrics.getRegisteredFontNames() else "Helvetica", font_size)
        title_y = line_y - _mm(12)
        _draw_text_wrapped(c, title, margin, title_y, max_title_w,
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


def _draw_photo_page(c: canvas.Canvas, page: dict,
                     photo_cache: dict,
                     pw: float, ph: float,
                     ml: float, mr: float, mt: float, mb: float,
                     gap: float, bleed: float,
                     dpi: int = 300,
                     color_profile: str = "srgb") -> None:
    """Render a single photo page with independent per-side margins."""
    c.setFillColorRGB(0.97, 0.96, 0.94)
    c.rect(0, 0, pw, ph, fill=1, stroke=0)

    if bleed > 0:
        _draw_bleed_marks(c, pw, ph, bleed)

    items = page.get("items", [])
    if not items:
        return

    ux = ml
    uw = pw - ml - mr
    uh = ph - mt - mb

    for item_data in items:
        slot = item_data.get("slot", {"x": 0, "y": 0, "w": 100, "h": 100})
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
            _render_caption_slot(c, item, sx, sy, sw, sh)
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


def _render_caption_slot(c: canvas.Canvas, item: dict,
                          x: float, y: float, w: float, h: float) -> None:
    c.setFillColorRGB(0.10, 0.10, 0.13)
    c.rect(x, y, w, h, fill=1, stroke=0)
    text = (item.get("text") or "").strip()
    if not text:
        return
    c.setFillColorRGB(0.83, 0.67, 0.35)
    c.setFont("Helvetica-Bold", _mm(4))
    c.drawString(x + _mm(5), y + h - _mm(8), "—")
    inner_x   = x + _mm(5)
    inner_w   = w - _mm(10)
    start_y   = y + h - _mm(14)
    font_size = min(_mm(5.5), h / 5)
    font_size = max(font_size, _mm(3.5))
    leading   = font_size * 1.45
    max_lines = max(2, int((h - _mm(18)) / leading))
    _draw_text_wrapped(c, text, inner_x, start_y, inner_w,
                       "Helvetica-BoldOblique", font_size, leading,
                       color=(0.94, 0.92, 0.86), max_lines=max_lines)


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
        page_num: 1-based.
        Duplex: odd pages = right-hand (left=inner/binding), even = left-hand (right=inner).
        margin_left in profile = inner margin (binding side).
        margin_right in profile = outer margin.
        """
        if duplex:
            inner, outer = ml, mr
            if page_num % 2 == 0:          # even = left page → right is inner
                m_l, m_r = outer, inner
            else:                           # odd = right page → left is inner
                m_l, m_r = inner, outer
        else:
            m_l, m_r = ml, mr
        return (
            _mm(m_l + bleed_mm),
            _mm(m_r + bleed_mm),
            _mm(mt  + bleed_mm),
            _mm(mb  + bleed_mm),
        )

    buf = io.BytesIO()
    cv  = canvas.Canvas(buf, pagesize=(pw, ph))
    cv.setTitle(album.get("albumName", "Fotolibro"))
    cv.setAuthor("PhotoBook Studio")
    cv.setCreator("PhotoBook Studio")

    # Title page
    _draw_title_page(cv, album, map_image, pw, ph, margin, bleed)
    cv.showPage()

    page_counter = 2
    if duplex:
        cv.setFillColorRGB(0.97, 0.96, 0.94)
        cv.rect(0, 0, pw, ph, fill=1, stroke=0)
        cv.showPage()
        page_counter += 1

    for page in pages:
        if page.get("_album_cover") or page.get("_album_separator"):
            # Special multi-album divider pages — blank
            cv.setFillColorRGB(0.97, 0.96, 0.94)
            cv.rect(0, 0, pw, ph, fill=1, stroke=0)
            cv.showPage()
            page_counter += 1
            continue

        ml_pt, mr_pt, mt_pt, mb_pt = margins_for_page(page_counter)
        _draw_photo_page(cv, page, photo_cache, pw, ph,
                         ml_pt, mr_pt, mt_pt, mb_pt, gap, bleed,
                         dpi=dpi, color_profile=color_profile)
        cv.showPage()
        page_counter += 1

    if duplex and page_counter % 2 != 0:
        cv.setFillColorRGB(0.97, 0.96, 0.94)
        cv.rect(0, 0, pw, ph, fill=1, stroke=0)
        cv.showPage()

    cv.save()
    return buf.getvalue()
