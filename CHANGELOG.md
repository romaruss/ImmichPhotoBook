# Changelog

All notable changes to PhotoBook Studio are documented here.

---

## [0.5.0] - 2026-04-28

### Fixed
- **PDF pan/crop Y-axis inversion** — ReportLab uses y-up coordinates while CSS uses y-down. The vertical pan offset was inverted (`oy = overflow * pan_fy` → `oy = overflow * (1 - pan_fy)`), causing the PDF to show the wrong vertical region of the image. Preview and PDF now match exactly.
- **PDF zoom < 1 clamped to 1.0** — `_prepare_image` used `max(1.0, float(zoom))`, preventing zoom-out from working. Now uses `max(0.01, float(zoom))` with correct centering when image is smaller than slot.
- **Wrong aspect ratio in preview** — `photoAspects` was loaded from `?size=thumbnail` (Immich 250×250 square crop), giving AR=1.0 for all photos and incorrect pan/crop preview. Fixed to load from `?size=preview` (actual aspect-ratio-preserving image).
- **SVG export pan off-by-1** — `enumerate(pages, start=1)` made page_num 1-based but pan key lookup used 0-based index. Fixed pan key from `f"{page_num}_{si}"` to `f"{page_num - 1}_{si}"`.

### Added
- **PDF caption style export** — captions now respect all `caption_style` profile settings: background color (with transparency support), text color, font family (mapped to PDF built-ins), font size, bold, italic, text alignment (left/center/right), and line height.
- **SVG caption style export** — same caption style fields applied to SVG export: font-family, font-size, fill, text-anchor for alignment, font-weight, font-style, transparent backgrounds, multi-line tspan wrapping.
- **Caption editor: Immich sync toggle** — new toggle in caption toolbar. Defaults ON when editing a caption paired to a photo (has `for_asset_id`), OFF/hidden for empty slots. When ON, saving syncs the caption back to Immich as description.
- **Caption editor: live style persistence** — caption style settings (font, size, color, bold, italic, align, etc.) persist across captions in the same session via `sessionStorage` key `pb_caption_style`.
- **Caption editor: symbol picker** — new "Ω" button in caption toolbar opens a panel with 40+ special characters (typographic, mathematical, arrows, currency). Symbols insert at cursor position preserving selection.
- **Unused photo overlay — AlbumPanel grid** — photos not used anywhere in the album show a red semi-transparent overlay (rgba 220,50,50,0.35) in the album panel grid view.
- **Unused photo overlay — PhotoPickerModal** — same red overlay and red border for unused photos in the slot photo-chooser dialog (opened by "Scegli foto" on an empty slot).

---

## [0.4.0] - 2026-04-23

### Added
- Password protection (`PHOTOBOOK_TOKEN` env var) with login gate
- Stadia Maps integration for map slots
- AlbumPanel: filter by unused / multi-used photos
- AlbumPanel: click unused photo → full-screen preview overlay
- Profile export/import (JSON)

### Fixed
- Various layout engine edge cases
- ICC color profile conversion errors on CMYK export

---

## [0.3.0] - 2026-04-20

### Added
- Smart layout engine with face-aware crop
- Multi-language support (IT/EN)
- SVG export with Inkscape-compatible layers
- Cover editor

---

## [0.2.0] - 2026-04-09

### Added
- PDF export with ReportLab
- Pan/zoom/crop per photo slot
- Caption editor with style options
- Immich album browser

---

## [0.1.0] - 2026-04-06

### Added
- Initial release
- Basic photobook preview
- Immich integration
- Template/profile system
