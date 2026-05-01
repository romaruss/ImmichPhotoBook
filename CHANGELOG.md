# Changelog

All notable changes to PhotoBook Studio are documented here.

---

## [0.6.0] - 2026-05-01

### Added
- **GPS map auto-fill** — new config toggle "Riempi slot vuoti con mappa GPS". When enabled, empty photo slots at the end of each cluster are filled with a static GPS map showing the locations of all photos in that cluster. Maps are generated via Stadia Maps (with OSM tile fallback), cached server-side under `/data/cache/`, and served via `/api/mapcache/{key}`.
- **Page-level zoom** — zoom in/out toolbar (30%–250%) added to the preview page. Click the percentage label to reset to 100%. Independent of per-slot photo zoom and map zoom.
- **Map slot zoom-out below 100%** — the "Riposiziona / zoom mappa" dialog now allows zoom-out to 30% (was clamped to 100%).
- **Cluster separators in LogViewer sidebar** — event-cluster and free-photo groups are visually separated in the page list with colored labels (cyan for dated events, gold for isolated photos).
- **Map preview in LogViewer** — slot cards for GPS map items show the rendered map thumbnail with a 🗺 tag.

### Changed
- **Duplicate removal — AND logic** — photos are now excluded only when BOTH perceptual similarity (dHash ≤ threshold) AND burst-shot detection (same base name + within time window) are triggered simultaneously. Previously OR logic caused over-removal.
- **dHash Hamming distance scale** — distance computed against a 128-bit range (`int((1-threshold)*128)`) instead of 64-bit, giving more headroom at default threshold 0.83 (max_hamming ≈ 22).
- **Default `similarity_threshold`** — changed from 0.92 → **0.83**.
- **Default `min_quality`** — changed from 0.7 → **0.60**.
- **Density penalty — quadratic** — page-type density score uses `(diff²) × 50` instead of linear `diff × 50`, making the preference for target density stronger at high deviations.
- **Caption layout priority** — layouts with caption slots are now strongly preferred when captioned photos are present (`cap_bonus = captions_available × 200`, `pen = n_caps_on_page × 300`). Captioned photos are placed first in each chunk.
- **Event clustering min-cluster** — `min_cluster` fixed to 2 (was `max(2, max_slots)`), preventing small clusters from being misclassified as isolated photos.

### Fixed
- **Dedup thumbnails cropped** — LogViewer dedup comparison images now use `objectFit: contain` (was `cover`), showing the full photo.
- **Number input loses value without blur** — config modal slider/number inputs now commit the value immediately on typing a complete valid number, without requiring focus-out.
- **Maps rendered black** — MiniPage and MapSlot used `objectFit: cover` which cropped PNG map images to a black border. Fixed to `objectFit: contain` with dark background.
- **Caption 5000-point penalty regression** — `n_caps_in_batch` was computed only over `photos[:n_photo_slots]` instead of the full batch, causing spurious penalties when a captioned photo was not first. Fixed to count over the full batch.

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
