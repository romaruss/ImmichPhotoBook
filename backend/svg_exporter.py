"""
svg_exporter.py

Genera pagine SVG modificabili compatibili con:
  - Adobe Illustrator (apre SVG nativamente)
  - Scribus (File → Import → Get SVG)
  - InDesign (File → Place)
  - Inkscape (open source)

Ogni pagina diventa un file SVG separato.
Tutti i file vengono compressi in uno ZIP.

Le foto vengono incorporate come data URI base64 per avere file autonomi.
I layer SVG sono separati:
  - layer "background"
  - layer "photos" (immagini embedded)
  - layer "captions" (testo)
  - layer "cropmarks" (segni di taglio, se bleed attivo)
  - layer "guides" (bordi slot come guide visive)
"""

import io
import base64
import zipfile
import logging
import xml.etree.ElementTree as ET
from typing import Optional
from PIL import Image as PILImage, ExifTags

logger = logging.getLogger(__name__)

# ── SVG namespace constants ───────────────────────────────────────────────────
SVG_NS      = "http://www.w3.org/2000/svg"
XLINK       = "http://www.w3.org/1999/xlink"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"

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
    """mm → px at 96dpi (SVG default: 1px = 1/96 inch; 1mm = 96/25.4 px)"""
    return v * 3.7795275591  # 96 / 25.4


def _fix_orientation(img: PILImage.Image) -> PILImage.Image:
    try:
        exif_raw = img._getexif()
        if not exif_raw:
            return img
        tag = next((t for t, n in ExifTags.TAGS.items() if n == "Orientation"), None)
        if not tag:
            return img
        o = exif_raw.get(tag)
        if o == 3: return img.rotate(180, expand=True)
        if o == 6: return img.rotate(270, expand=True)
        if o == 8: return img.rotate(90, expand=True)
    except Exception:
        pass
    return img


def _img_to_data_uri(img_bytes: bytes, max_px: int = 2400) -> str:
    """Resize and encode image as base64 data URI."""
    try:
        pil = PILImage.open(io.BytesIO(img_bytes))
        pil = _fix_orientation(pil).convert("RGB")
        # Downscale if needed (keep file size reasonable)
        if max(pil.size) > max_px:
            pil.thumbnail((max_px, max_px), PILImage.LANCZOS)
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=88, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/jpeg;base64,{b64}"
    except Exception as e:
        logger.warning(f"Image encode error: {e}")
        return ""


def _slot_rect(slot: dict, pw_mm: float, ph_mm: float, margin_mm: float, gap_mm: float) -> dict:
    """Compute slot rect in mm."""
    uw = pw_mm - 2 * margin_mm
    uh = ph_mm - 2 * margin_mm
    le = slot["x"] < 0.5
    te = slot["y"] < 0.5
    re = (slot["x"] + slot["w"]) > 99.5
    be = (slot["y"] + slot["h"]) > 99.5
    return {
        "x": margin_mm + (slot["x"] / 100) * uw + (0 if le else gap_mm / 2),
        "y": margin_mm + (slot["y"] / 100) * uh + (0 if te else gap_mm / 2),
        "w": (slot["w"] / 100) * uw - (0 if le else gap_mm / 2) - (0 if re else gap_mm / 2),
        "h": (slot["h"] / 100) * uh - (0 if te else gap_mm / 2) - (0 if be else gap_mm / 2),
    }


def _build_page_svg(
    page_num: int,
    page: dict,
    profile: dict,
    photo_cache: dict,
    pan_offsets: dict,
    bleed_mm: float,
    pw_mm: float,
    ph_mm: float,
    margin_mm: float,
    gap_mm: float,
    is_title_page: bool = False,
    title: str = "",
    description: str = "",
    map_image: Optional[bytes] = None,
    crop_marks: bool = False,
) -> str:
    """Build one SVG page as string."""
    total_w_mm = pw_mm + 2 * bleed_mm
    total_h_mm = ph_mm + 2 * bleed_mm
    total_w_px = _mm(total_w_mm)
    total_h_px = _mm(total_h_mm)
    bleed_px = _mm(bleed_mm)
    margin_px = _mm(margin_mm + bleed_mm)

    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK)
    ET.register_namespace("inkscape", INKSCAPE_NS)

    root = ET.Element(f"{{{SVG_NS}}}svg")
    root.set("width",  f"{total_w_mm}mm")
    root.set("height", f"{total_h_mm}mm")
    root.set("viewBox", f"0 0 {total_w_px:.2f} {total_h_px:.2f}")
    root.set("version", "1.1")

    # ── defs ─────────────────────────────────────────────────────────────────
    defs = ET.SubElement(root, f"{{{SVG_NS}}}defs")

    # Page clip (trim area)
    clip = ET.SubElement(defs, f"{{{SVG_NS}}}clipPath")
    clip.set("id", f"page-clip-{page_num}")
    clip_rect = ET.SubElement(clip, f"{{{SVG_NS}}}rect")
    clip_rect.set("x", f"{bleed_px:.2f}")
    clip_rect.set("y", f"{bleed_px:.2f}")
    clip_rect.set("width",  f"{_mm(pw_mm):.2f}")
    clip_rect.set("height", f"{_mm(ph_mm):.2f}")

    # ── Photos layer ──────────────────────────────────────────────────────────
    photo_layer = ET.SubElement(root, f"{{{SVG_NS}}}g")
    photo_layer.set("id", "photos")
    photo_layer.set(f"{{{INKSCAPE_NS}}}label", "Foto")

    if is_title_page:
        # Map image on title page
        if map_image:
            uri = _img_to_data_uri(map_image, max_px=1200)
            if uri:
                map_clip_id = f"map-clip-{page_num}"
                mc = ET.SubElement(defs, f"{{{SVG_NS}}}clipPath")
                mc.set("id", map_clip_id)
                mr = ET.SubElement(mc, f"{{{SVG_NS}}}rect")
                mr.set("x", f"{bleed_px:.2f}"); mr.set("y", f"{bleed_px:.2f}")
                mr.set("width", f"{_mm(pw_mm):.2f}")
                mr.set("height", f"{total_h_px * 0.45:.2f}")
                img_el = ET.SubElement(photo_layer, f"{{{SVG_NS}}}image")
                img_el.set("x", f"{bleed_px:.2f}"); img_el.set("y", f"{bleed_px:.2f}")
                img_el.set("width", f"{_mm(pw_mm):.2f}")
                img_el.set("height", f"{total_h_px * 0.45:.2f}")
                img_el.set("preserveAspectRatio", "xMidYMid slice")
                img_el.set("clip-path", f"url(#{map_clip_id})")
                img_el.set("opacity", "0.6")
                img_el.set(f"{{{XLINK}}}href", uri)
        # Title text
        text_layer = ET.SubElement(root, f"{{{SVG_NS}}}g")
        text_layer.set("id", "title")
        text_layer.set(f"{{{INKSCAPE_NS}}}label", "Titolo")
        # Gold line
        line = ET.SubElement(text_layer, f"{{{SVG_NS}}}line")
        line.set("x1", f"{bleed_px + _mm(margin_mm):.2f}")
        line.set("x2", f"{total_w_px - bleed_px - _mm(margin_mm):.2f}")
        line.set("y1", f"{total_h_px * 0.52:.2f}"); line.set("y2", f"{total_h_px * 0.52:.2f}")
        line.set("stroke", "#d4aa5a"); line.set("stroke-width", "1.5")
        # Title
        t = ET.SubElement(text_layer, f"{{{SVG_NS}}}text")
        t.set("x", f"{total_w_px/2:.2f}"); t.set("y", f"{total_h_px * 0.49:.2f}")
        t.set("text-anchor", "middle"); t.set("font-size", "28")
        t.set("fill", "#f0ede6"); t.set("font-family", "Georgia, serif"); t.set("font-weight", "300")
        t.text = title or "Fotolibro"
        if description:
            desc_t = ET.SubElement(text_layer, f"{{{SVG_NS}}}text")
            desc_t.set("x", f"{total_w_px/2:.2f}"); desc_t.set("y", f"{total_h_px * 0.55:.2f}")
            desc_t.set("text-anchor", "middle"); desc_t.set("font-size", "14")
            desc_t.set("fill", "#888"); desc_t.set("font-family", "Georgia, serif"); desc_t.set("font-style", "italic")
            desc_t.text = description
    else:
        # Photo page slots
        for si, item_data in enumerate(page.get("items", [])):
            slot = item_data.get("slot", {"x": 0, "y": 0, "w": 100, "h": 100})
            item = item_data.get("item")
            r = _slot_rect(slot, pw_mm, ph_mm, margin_mm, gap_mm)
            rx = _mm(r["x"]) + bleed_px
            ry = _mm(r["y"]) + bleed_px
            rw = _mm(r["w"])
            rh = _mm(r["h"])

            if not item:
                # Empty slot placeholder
                rect = ET.SubElement(photo_layer, f"{{{SVG_NS}}}rect")
                rect.set("x", f"{rx:.2f}"); rect.set("y", f"{ry:.2f}")
                rect.set("width", f"{rw:.2f}"); rect.set("height", f"{rh:.2f}")
                rect.set("fill", "#d8d5ce")
                continue

            if item["type"] == "caption":
                # Will be drawn in text layer
                continue

            # Photo slot
            asset_id = item.get("asset_id", "")
            img_bytes = photo_cache.get(asset_id)

            # Clip path for this slot
            clip_id = f"clip-{page_num}-{si}"
            sc = ET.SubElement(defs, f"{{{SVG_NS}}}clipPath")
            sc.set("id", clip_id)
            sr = ET.SubElement(sc, f"{{{SVG_NS}}}rect")
            sr.set("x", f"{rx:.2f}"); sr.set("y", f"{ry:.2f}")
            sr.set("width", f"{rw:.2f}"); sr.set("height", f"{rh:.2f}")

            if img_bytes:
                uri = _img_to_data_uri(img_bytes, max_px=2400)
                if uri:
                    # Compute pan/zoom
                    pan_key = f"{page_num - 1}_{si}"
                    transform = pan_offsets.get(pan_key, {"x": 50, "y": 50, "zoom": 1})
                    zoom = transform.get("zoom", 1)
                    pan_x = transform.get("x", 50) / 100
                    pan_y = transform.get("y", 50) / 100

                    try:
                        pil = _fix_orientation(PILImage.open(io.BytesIO(img_bytes)))
                        iw, ih = pil.size
                        photo_ar = iw / ih
                    except Exception:
                        photo_ar = rw / rh

                    slot_ar = rw / rh
                    if photo_ar >= slot_ar:
                        base_h = rh * zoom; base_w = base_h * photo_ar
                    else:
                        base_w = rw * zoom; base_h = base_w / photo_ar

                    overflow_x = max(0, base_w - rw)
                    overflow_y = max(0, base_h - rh)
                    img_x = rx - pan_x * overflow_x
                    img_y = ry - pan_y * overflow_y

                    img_el = ET.SubElement(photo_layer, f"{{{SVG_NS}}}image")
                    img_el.set("x", f"{img_x:.2f}"); img_el.set("y", f"{img_y:.2f}")
                    img_el.set("width", f"{base_w:.2f}"); img_el.set("height", f"{base_h:.2f}")
                    img_el.set("clip-path", f"url(#{clip_id})")
                    img_el.set("preserveAspectRatio", "none")
                    img_el.set(f"{{{XLINK}}}href", uri)
                    # Metadata for InDesign/Illustrator
                    img_el.set("data-asset-id", asset_id)
            else:
                # Placeholder
                ph_rect = ET.SubElement(photo_layer, f"{{{SVG_NS}}}rect")
                ph_rect.set("x", f"{rx:.2f}"); ph_rect.set("y", f"{ry:.2f}")
                ph_rect.set("width", f"{rw:.2f}"); ph_rect.set("height", f"{rh:.2f}")
                ph_rect.set("fill", "#c8c5be")
                ph_txt = ET.SubElement(photo_layer, f"{{{SVG_NS}}}text")
                ph_txt.set("x", f"{rx + rw/2:.2f}"); ph_txt.set("y", f"{ry + rh/2:.2f}")
                ph_txt.set("text-anchor", "middle"); ph_txt.set("dominant-baseline", "middle")
                ph_txt.set("font-size", "12"); ph_txt.set("fill", "#888")
                ph_txt.text = asset_id[:8] if asset_id else "foto"

    # ── Text/captions layer ───────────────────────────────────────────────────
    if not is_title_page:
        text_layer = ET.SubElement(root, f"{{{SVG_NS}}}g")
        text_layer.set("id", "captions")
        text_layer.set(f"{{{INKSCAPE_NS}}}label", "Didascalie")

        profile_cs = profile.get("caption_style") or {}
        for si, item_data in enumerate(page.get("items", [])):
            item = item_data.get("item")
            if not item or item["type"] != "caption":
                continue
            slot = item_data.get("slot", {"x": 0, "y": 0, "w": 100, "h": 100})
            r = _slot_rect(slot, pw_mm, ph_mm, margin_mm, gap_mm)
            rx = _mm(r["x"]) + bleed_px
            ry = _mm(r["y"]) + bleed_px
            rw = _mm(r["w"]); rh = _mm(r["h"])

            cs       = {**profile_cs, **(item.get("caption_style") or {})}
            bg_color = cs.get("bg", "#111116")
            clr      = cs.get("color", "#e8e6e0")
            font_fam = cs.get("font", "Georgia, serif")
            size_px  = float(cs.get("size", 13) or 13)
            italic   = cs.get("italic", True)
            bold     = cs.get("bold", False)
            align    = cs.get("align", "left")
            lh_mult  = float(cs.get("lineHeight", 1.45) or 1.45)

            if bg_color and bg_color != "transparent":
                bg_el = ET.SubElement(text_layer, f"{{{SVG_NS}}}rect")
                bg_el.set("x", f"{rx:.2f}"); bg_el.set("y", f"{ry:.2f}")
                bg_el.set("width", f"{rw:.2f}"); bg_el.set("height", f"{rh:.2f}")
                bg_el.set("fill", bg_color)

            text_content = (item.get("text") or "").strip()
            if not text_content:
                continue

            # font-size in SVG units (1 CSS px = 1 SVG unit in this coord system)
            font_size = max(8.0, min(size_px, rh / 5))
            leading   = font_size * lh_mult
            pad_x     = _mm(5)
            pad_top   = _mm(5)
            inner_x   = rx + pad_x
            inner_w   = rw - 2 * pad_x

            txt_anchor = "middle" if align == "center" else ("end" if align == "right" else "start")
            txt_x = inner_x + inner_w / 2 if align == "center" else (rx + rw - pad_x if align == "right" else inner_x)

            txt = ET.SubElement(text_layer, f"{{{SVG_NS}}}text")
            txt.set("x", f"{txt_x:.2f}")
            txt.set("y", f"{ry + pad_top + font_size:.2f}")
            txt.set("text-anchor", txt_anchor)
            txt.set("font-size", f"{font_size:.1f}")
            txt.set("fill", clr)
            txt.set("font-family", font_fam)
            if italic:
                txt.set("font-style", "italic")
            if bold:
                txt.set("font-weight", "bold")

            # Wrap lines naively by word count (SVG has no text-wrap)
            words = text_content.split()
            # Estimate chars-per-line from slot width and font size
            chars_per_line = max(10, int(inner_w / (font_size * 0.55)))
            lines = []
            line = ""
            for word in words:
                if len(line) + len(word) + 1 <= chars_per_line:
                    line = (line + " " + word).strip()
                else:
                    if line:
                        lines.append(line)
                    line = word
            if line:
                lines.append(line)
            max_lines = max(1, int((rh - 2 * pad_top) / leading))
            lines = lines[:max_lines]

            if len(lines) == 1:
                txt.text = lines[0]
            else:
                txt.text = None
                for i, ln in enumerate(lines):
                    tspan = ET.SubElement(txt, f"{{{SVG_NS}}}tspan")
                    tspan.set("x", f"{txt_x:.2f}")
                    if i == 0:
                        tspan.set("dy", "0")
                    else:
                        tspan.set("dy", f"{leading:.1f}")
                    tspan.text = ln

    # ── Crop marks layer ─────────────────────────────────────────────────────
    if bleed_mm > 0 and crop_marks:
        marks_layer = ET.SubElement(root, f"{{{SVG_NS}}}g")
        marks_layer.set("id", "cropmarks")
        marks_layer.set(f"{{{INKSCAPE_NS}}}label", "Segni di taglio")
        mark_len = _mm(5)
        gap = _mm(1.5)
        corners = [
            (bleed_px, bleed_px, -1, -1),
            (total_w_px - bleed_px, bleed_px, 1, -1),
            (bleed_px, total_h_px - bleed_px, -1, 1),
            (total_w_px - bleed_px, total_h_px - bleed_px, 1, 1),
        ]
        for cx, cy, dx, dy in corners:
            for pts in [
                (cx + dx*gap, cy, cx + dx*(gap+mark_len), cy),
                (cx, cy + dy*gap, cx, cy + dy*(gap+mark_len)),
            ]:
                ln = ET.SubElement(marks_layer, f"{{{SVG_NS}}}line")
                ln.set("x1", f"{pts[0]:.2f}"); ln.set("y1", f"{pts[1]:.2f}")
                ln.set("x2", f"{pts[2]:.2f}"); ln.set("y2", f"{pts[3]:.2f}")
                ln.set("stroke", "#000"); ln.set("stroke-width", "0.5")

    # ── Guides layer (slot outlines, hidden by default) ───────────────────────
    guides_layer = ET.SubElement(root, f"{{{SVG_NS}}}g")
    guides_layer.set("id", "guides")
    guides_layer.set(f"{{{INKSCAPE_NS}}}label", "Guide slot")
    guides_layer.set("display", "none")
    for si, item_data in enumerate(page.get("items", []) if not is_title_page else []):
        slot = item_data.get("slot", {"x": 0, "y": 0, "w": 100, "h": 100})
        r = _slot_rect(slot, pw_mm, ph_mm, margin_mm, gap_mm)
        gr = ET.SubElement(guides_layer, f"{{{SVG_NS}}}rect")
        gr.set("x",  f"{_mm(r['x']) + bleed_px:.2f}")
        gr.set("y",  f"{_mm(r['y']) + bleed_px:.2f}")
        gr.set("width",  f"{_mm(r['w']):.2f}")
        gr.set("height", f"{_mm(r['h']):.2f}")
        gr.set("fill", "none"); gr.set("stroke", "#d4aa5a"); gr.set("stroke-width", "0.5")
        gr.set("stroke-dasharray", "4,3")

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def generate_svg_zip(
    album: dict,
    pages: list[dict],
    profile: dict,
    photo_cache: dict,
    pan_offsets: dict,
    map_image: Optional[bytes] = None,
) -> bytes:
    """Generate a ZIP archive containing one SVG per page."""
    size_name = profile.get("page_size", "20x30")
    pw_mm, ph_mm = _parse_page_size(size_name)
    if profile.get("orientation", "portrait") == "landscape":
        pw_mm, ph_mm = ph_mm, pw_mm

    bleed_mm   = profile.get("bleed_mm", 3.0) if profile.get("bleed") else 0.0
    margin_mm  = profile.get("margin_mm", 5.0)
    gap_mm     = profile.get("gap_mm",    3.0)
    crop_marks = bool(profile.get("crop_marks", False))

    album_name = (album.get("albumName") or "fotolibro").replace(" ", "_")
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # README
        readme = f"""PhotoBook Studio — Export SVG
=============================
Album: {album.get('albumName', '')}
Formato: {size_name} {profile.get('orientation','portrait')} — {ph_mm}×{pw_mm}mm
Abbondanza: {bleed_mm}mm
Margini: {margin_mm}mm

File inclusi:
  {album_name}_00_copertina.svg  — Pagina del titolo
  {album_name}_01.svg ... {album_name}_{len(pages):02d}.svg — Pagine foto

Compatibilità:
  - Adobe Illustrator: Apri direttamente
  - Inkscape: Apri direttamente (free)
  - Scribus: File → Import → Get SVG
  - InDesign: File → Place (le foto sono embedded)

Layer SVG (visibili nel pannello Layers):
  - background  → sfondo pagina
  - photos      → immagini fotografiche
  - captions    → testo didascalie
  - cropmarks   → segni di taglio (se abbondanza attiva)
  - guides      → guide degli slot (nascoste, da attivare)
"""
        zf.writestr("README.txt", readme)

        # Title page
        svg = _build_page_svg(
            page_num=0, page={}, profile=profile,
            photo_cache=photo_cache, pan_offsets=pan_offsets,
            bleed_mm=bleed_mm, pw_mm=pw_mm, ph_mm=ph_mm,
            margin_mm=margin_mm, gap_mm=gap_mm,
            is_title_page=True,
            title=album.get("albumName", "Fotolibro"),
            description=album.get("description", ""),
            map_image=map_image,
            crop_marks=crop_marks,
        )
        zf.writestr(f"{album_name}_00_copertina.svg", svg)

        # Photo pages
        for i, page in enumerate(pages, start=1):
            svg = _build_page_svg(
                page_num=i, page=page, profile=profile,
                photo_cache=photo_cache, pan_offsets=pan_offsets,
                bleed_mm=bleed_mm, pw_mm=pw_mm, ph_mm=ph_mm,
                margin_mm=margin_mm, gap_mm=gap_mm,
                is_title_page=False,
                crop_marks=crop_marks,
            )
            zf.writestr(f"{album_name}_{i:02d}.svg", svg)

    return buf.getvalue()
