"""
pdf_generator.py — Genera PDF pronti per la stampa professionale.

Features:
  - Formati pagina standard e personalizzati (mm)
  - Abbondanza (bleed) con segni di taglio
  - Foto con cover-crop corretto (EXIF orientation fix)
  - Pagina titolo con mappa GPS embedded
  - Slot didascalia con testo multi-riga
  - Font embedded (Helvetica standard)
  - Fronte/retro con pagine vuote bilanciate
"""

import io
import logging
from typing import Optional
from PIL import Image as PILImage, ExifTags
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

def _parse_page_size(size_name: str, custom_sizes: list | None = None) -> tuple[float, float]:
    """
    Resolve page size to (width_mm, height_mm).
    Handles:
      - Known presets: "A4", "20x30", etc.
      - Custom size by ID (uuid string): looks up in custom_sizes list
      - Legacy "Custom_WxH" format
    """
    if not size_name:
        return (200.0, 300.0)
    # Legacy format: Custom_210x297
    if size_name.startswith("Custom_"):
        try:
            parts = size_name[7:].split("x")
            return (float(parts[0]), float(parts[1]))
        except Exception:
            pass
    # Preset name lookup
    if size_name in PAGE_SIZES_MM:
        return PAGE_SIZES_MM[size_name]
    # Custom size ID lookup
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
            (tag for tag, name in ExifTags.TAGS.items() if name == "Orientation"), None
        )
        if orient_tag is None:
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


def _draw_cover_photo(c: canvas.Canvas, img_bytes: bytes,
                      x: float, y: float, w: float, h: float) -> None:
    """Draw photo filling the slot (cover crop), correct orientation."""
    try:
        pil = PILImage.open(io.BytesIO(img_bytes))
        pil = _fix_orientation(pil)

        iw, ih = pil.size
        scale = max(w / iw, h / ih)
        nw, nh = iw * scale, ih * scale
        ox = (nw - w) / 2
        oy = (nh - h) / 2

        # Re-encode as JPEG for embedding
        buf = io.BytesIO()
        pil = pil.convert("RGB")
        pil.save(buf, format="JPEG", quality=92, optimize=True)
        buf.seek(0)

        c.saveState()
        p = c.beginPath()
        p.rect(x, y, w, h)
        c.clipPath(p, stroke=0)
        c.drawImage(ImageReader(buf), x - ox, y - oy, width=nw, height=nh, mask="auto")
        c.restoreState()
    except Exception as e:
        logger.warning(f"Photo draw error: {e}")
        # Placeholder
        c.setFillColorRGB(0.82, 0.81, 0.79)
        c.rect(x, y, w, h, fill=1, stroke=0)


def _draw_text_wrapped(c: canvas.Canvas, text: str,
                       x: float, y: float, max_w: float,
                       font: str, size: float, leading: float,
                       color: tuple = (0.95, 0.93, 0.88),
                       max_lines: int = 20) -> float:
    """Word-wrap text, return final Y position after last line."""
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


def _draw_bleed_marks(c: canvas.Canvas,
                      pw: float, ph: float, bleed: float) -> None:
    """Draw crop marks at the four corners indicating the trim line."""
    c.saveState()
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.5)
    mark = _mm(5)
    gap  = _mm(1.5)   # gap between page edge and start of mark

    corners = [
        (bleed, bleed,  -1, -1),   # bottom-left
        (pw - bleed, bleed,  1, -1),   # bottom-right
        (bleed, ph - bleed, -1,  1),   # top-left
        (pw - bleed, ph - bleed,  1,  1),   # top-right
    ]
    for cx, cy, dx, dy in corners:
        # Horizontal arm
        c.line(cx + dx * gap, cy, cx + dx * (gap + mark), cy)
        # Vertical arm
        c.line(cx, cy + dy * gap, cx, cy + dy * (gap + mark))

    c.restoreState()


def _draw_title_page(c: canvas.Canvas, album: dict,
                     map_image: Optional[bytes],
                     pw: float, ph: float,
                     margin: float, bleed: float) -> None:
    """Render the title/cover page."""

    # ── Background ──────────────────────────────────────────────────────────
    c.setFillColorRGB(0.05, 0.05, 0.07)
    c.rect(0, 0, pw, ph, fill=1, stroke=0)

    title       = album.get("albumName", "Fotolibro") or "Fotolibro"
    description = album.get("description", "") or ""
    assets      = album.get("assets", [])
    photo_count = len(assets)
    date_range  = _date_range(assets)

    map_h = ph * 0.45

    # ── Map image ────────────────────────────────────────────────────────────
    if map_image:
        try:
            c.saveState()
            p = c.beginPath()
            p.rect(0, ph - map_h, pw, map_h)
            c.clipPath(p, stroke=0)
            c.drawImage(ImageReader(io.BytesIO(map_image)),
                        0, ph - map_h, width=pw, height=map_h,
                        mask="auto", preserveAspectRatio=False)
            c.restoreState()
            # Dark gradient overlay (simulated with multiple translucent rects)
            steps = 24
            for i in range(steps):
                alpha = (i / steps) ** 1.5 * 0.92
                band = map_h / steps
                c.setFillColorRGB(0.05, 0.05, 0.07, alpha)
                c.rect(0, ph - map_h + i * band, pw, band + 1, fill=1, stroke=0)
        except Exception as e:
            logger.warning(f"Map render error: {e}")

    # ── Gold accent line ─────────────────────────────────────────────────────
    line_y = ph * 0.50
    c.setStrokeColorRGB(0.83, 0.67, 0.35)
    c.setLineWidth(1.2)
    c.line(margin, line_y, pw - margin, line_y)

    # ── Title ────────────────────────────────────────────────────────────────
    max_title_w = pw - 2 * margin
    # Scale font so title fits in one line
    title_size = min(_mm(16), max_title_w / max(len(title) * 0.55, 1))
    title_size = max(title_size, _mm(8))
    c.setFont("Helvetica-Bold", title_size)
    c.setFillColorRGB(0.96, 0.94, 0.89)
    c.drawCentredString(pw / 2, line_y - title_size - _mm(3), title)

    # ── Description ──────────────────────────────────────────────────────────
    if description:
        desc_y = line_y - title_size - _mm(9)
        _draw_text_wrapped(
            c, description,
            margin, desc_y, max_title_w,
            "Helvetica-Oblique", _mm(4.8), _mm(7),
            color=(0.68, 0.65, 0.59),
            max_lines=4,
        )

    # ── Footer metadata ──────────────────────────────────────────────────────
    c.setFont("Helvetica", _mm(3.5))
    c.setFillColorRGB(0.42, 0.40, 0.38)
    foot_y = margin + _mm(5)
    if date_range:
        c.drawString(margin, foot_y, date_range)
    c.drawRightString(pw - margin, foot_y, f"{photo_count} fotografie")

    if bleed > 0:
        _draw_bleed_marks(c, pw, ph, bleed)


def _draw_photo_page(c: canvas.Canvas, page: dict,
                     photo_cache: dict,
                     pw: float, ph: float,
                     ml: float, mr: float, mt: float, mb: float,
                     gap: float, bleed: float) -> None:
    """Render a single photo page with independent per-side margins."""

    # ── Background ──────────────────────────────────────────────────────────
    c.setFillColorRGB(0.97, 0.96, 0.94)
    c.rect(0, 0, pw, ph, fill=1, stroke=0)

    if bleed > 0:
        _draw_bleed_marks(c, pw, ph, bleed)

    items = page.get("items", [])
    if not items:
        return

    # Usable area (inside independent margins)
    ux = ml
    uw = pw - ml - mr
    uh = ph - mt - mb

    for item_data in items:
        slot = item_data.get("slot", {"x": 0, "y": 0, "w": 100, "h": 100})
        item = item_data.get("item")

        # Convert % slot to points
        # X/Y inward offsets: add half-gap on sides that touch another slot
        left_edge  = slot["x"] < 0.5
        top_edge   = slot["y"] < 0.5
        right_edge = (slot["x"] + slot["w"]) > 99.5
        bot_edge   = (slot["y"] + slot["h"]) > 99.5

        sx = ux + (slot["x"] / 100) * uw + (0 if left_edge  else gap / 2)
        sy_top = (slot["y"] / 100) * uh  + (0 if top_edge   else gap / 2)
        sw = (slot["w"] / 100) * uw      - (0 if left_edge  else gap / 2) \
                                          - (0 if right_edge else gap / 2)
        sh = (slot["h"] / 100) * uh      - (0 if top_edge   else gap / 2) \
                                          - (0 if bot_edge   else gap / 2)

        # ReportLab: Y from bottom
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
                _draw_cover_photo(c, img_bytes, sx, sy, sw, sh)
            else:
                # Grey placeholder
                c.setFillColorRGB(0.80, 0.78, 0.75)
                c.rect(sx, sy, sw, sh, fill=1, stroke=0)
                c.setFillColorRGB(0.55, 0.53, 0.50)
                c.setFont("Helvetica", _mm(5))
                c.drawCentredString(sx + sw / 2, sy + sh / 2 - _mm(2.5), "📷")


def _render_caption_slot(c: canvas.Canvas, item: dict,
                          x: float, y: float, w: float, h: float) -> None:
    """Render a caption card in a slot."""
    # Dark background
    c.setFillColorRGB(0.10, 0.10, 0.13)
    c.rect(x, y, w, h, fill=1, stroke=0)

    text = (item.get("text") or "").strip()
    if not text:
        return

    # Gold accent dash
    c.setFillColorRGB(0.83, 0.67, 0.35)
    c.setFont("Helvetica-Bold", _mm(4))
    c.drawString(x + _mm(5), y + h - _mm(8), "—")

    # Caption text
    inner_x     = x + _mm(5)
    inner_w     = w - _mm(10)
    start_y     = y + h - _mm(14)
    font_size   = min(_mm(5.5), h / 5)
    font_size   = max(font_size, _mm(3.5))
    leading     = font_size * 1.45
    max_lines   = max(2, int((h - _mm(18)) / leading))

    _draw_text_wrapped(
        c, text, inner_x, start_y, inner_w,
        "Helvetica-BoldOblique", font_size, leading,
        color=(0.94, 0.92, 0.86),
        max_lines=max_lines,
    )


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

    Returns raw PDF bytes ready for download / printing.
    """
    # ── Page geometry ────────────────────────────────────────────────────────
    size_name   = profile.get("page_size", "20x30")
    pw_mm, ph_mm = _parse_page_size(size_name)

    if profile.get("orientation", "portrait") == "landscape":
        pw_mm, ph_mm = ph_mm, pw_mm

    bleed_mm  = profile.get("bleed_mm", 3.0) if profile.get("bleed") else 0.0
    margin_mm = profile.get("margin_mm", 5.0)
    gap_mm    = profile.get("gap_mm",    3.0)
    duplex    = profile.get("duplex", False)

    # Independent margins (fall back to margin_mm for all sides if not set)
    mt = profile.get("margin_top",    margin_mm)  # top
    mr = profile.get("margin_right",  margin_mm)  # right (outer on even pages)
    mb = profile.get("margin_bottom", margin_mm)  # bottom
    ml = profile.get("margin_left",   margin_mm)  # left (inner/binding on odd pages)

    # All dimensions in points; bleed is added around the page
    pw    = _mm(pw_mm + 2 * bleed_mm)
    ph    = _mm(ph_mm + 2 * bleed_mm)
    bleed = _mm(bleed_mm)
    gap   = _mm(gap_mm)
    # Margins per side (including bleed offset)
    def margins_for_page(page_num: int):
        """page_num: 1-based. Odd = right-hand page (left=binding). Even = left-hand page (right=binding)."""
        if duplex:
            # Odd pages: left margin is inner (binding), right is outer
            # Even pages: left is outer, right is inner (binding)
            inner = ml; outer = mr
            if page_num % 2 == 0:   # even = left page → right is inner
                m_left = outer; m_right = inner
            else:                    # odd = right page → left is inner
                m_left = inner; m_right = outer
        else:
            m_left = ml; m_right = mr
        return (
            _mm(m_left  + bleed_mm),   # left
            _mm(m_right + bleed_mm),   # right
            _mm(mt      + bleed_mm),   # top
            _mm(mb      + bleed_mm),   # bottom
        )
    # For title page use symmetric margin
    margin = _mm(margin_mm + bleed_mm)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(pw, ph))
    c.setTitle(album.get("albumName", "Fotolibro"))
    c.setAuthor("PhotoBook Studio")
    c.setCreator("PhotoBook Studio — github.com/youruser/photobook-studio")

    # ── Title page ───────────────────────────────────────────────────────────
    _draw_title_page(c, album, map_image, pw, ph, margin, bleed)
    c.showPage()

    # Blank back of cover for duplex
    page_counter = 2  # cover = page 1
    if duplex:
        c.setFillColorRGB(0.97, 0.96, 0.94)
        c.rect(0, 0, pw, ph, fill=1, stroke=0)
        c.showPage()
        page_counter += 1

    # ── Photo pages ──────────────────────────────────────────────────────────
    for page in pages:
        ml_pt, mr_pt, mt_pt, mb_pt = margins_for_page(page_counter)
        _draw_photo_page(c, page, photo_cache, pw, ph,
                         ml_pt, mr_pt, mt_pt, mb_pt, gap, bleed)
        c.showPage()
        page_counter += 1

    # Ensure even page count for duplex binding
    if duplex and page_counter % 2 != 0:
        c.setFillColorRGB(0.97, 0.96, 0.94)
        c.rect(0, 0, pw, ph, fill=1, stroke=0)
        c.showPage()

    c.save()
    return buf.getvalue()
