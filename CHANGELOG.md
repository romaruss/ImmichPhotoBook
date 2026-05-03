# Changelog

All notable changes to PhotoBook Studio are documented here.

---

## [0.8.0] - 2026-05-03

### Added
- **Page type orientation** — each layout is tagged as portrait or landscape; layouts are only used by the auto-layout algorithm when their orientation matches the profile's page format
- **Three-state page type markers** — active (● green), auto-off (○ grey, wrong orientation for current profile), manually disabled (✗ red, excluded regardless of orientation). Toggle button is locked for auto-off layouts
- **Page type filter bar** — filter by format (portrait/landscape), status (active/disabled/auto-off), content type (photo only / with captions), and photo count
- **Duplicate page type** — ⧉ button on each layout thumbnail
- **Preset layout files** — `presets/portrait_page_types.json` and `presets/landscape_page_types.json`, 25 layouts each, importable via profile editor
- **Import layouts: replace or add** — when importing a layout JSON, a dialog asks whether to add to existing layouts or replace them
- **Section collapse state persisted in sessionStorage** — profile editor sections remember open/closed state across page navigation and browser refresh (not just within the same editor session)

### Changed
- Auto-layout algorithm excludes page types whose `orientation` field does not match the profile orientation, in addition to the existing `enabled` filter
- Page type filter orientation chip auto-updates when profile orientation changes

---

## [0.7.0] - 2026-05-01

### Added
- **GPS map style editor** in print profile — tile style (6 Stadia Maps styles: Alidade Smooth/Dark, Terrain, Toner, OSM Bright, Outdoors), marker color/size/shape (circle, square, diamond, pin), route color/width/toggle, PIL fallback colors (background, grid, labels). Live 300×300 preview using Turin test coordinates, auto-refreshed with 700 ms debounce. Export/import standalone as JSON.
- **Marker shapes on tile maps** — all four marker shapes (circle, square, diamond, pin) now render correctly on both Stadia Maps tile images (PIL overlay via Mercator projection) and PIL fallback renderer.
- **Map style applied everywhere** — `map_style` from profile propagates to: fill-empty-with-map slots (cache key includes style hash), PDF/SVG export, manual map slot insertion from PreviewPage, initial cover map load.
- **Preset manager for generation options** — save, rename, delete named presets of album generation settings (stored in `localStorage`). Applied instantly from a dropdown at the top of the options modal.
- **Collapsible sections in print profile editor** — all profile editor sections (General, Format, Margins, PDF, Divider, Page Types, Caption Style, GPS Map, Cover) wrap in a CollapsibleCard. Open/closed state persists across editor open/close cycles within the session via React context + `useRef`.
- **Auto-captions toggle** in generation options — when disabled, caption-slot layouts are excluded from selection and no Immich descriptions are auto-inserted (existing caption slot types in the profile are still available but never chosen). Default: enabled.
- **Caption pre-fill from Immich** — clicking "Add caption" on a photo that has an Immich description pre-fills the caption text automatically (was always empty).
- **Caption slot direct click to edit** — clicking anywhere in a caption slot (display mode) enters edit mode; the ⋮ context menu is still available via the button.
- **Docker Hub image** — pre-built image `romaruss/immich-photobook:latest` published automatically on every push to `main` via GitHub Actions. Use `docker-compose.hub.yml` for a no-build installation.
- **One-click deploy to Render** — `render.yaml` added; deploy button in README.

### Fixed
- **`map_style` not saved in profile** — `map_style` field was missing from the Pydantic `Profile` model; settings were silently discarded on save.
- **Marker shape ignored on tile renderer** — Stadia Maps path always used `CircleMarker` (circle only). Now renders tiles as background and overlays PIL markers (correct shape + route) using Mercator projection.
- **`/api/map` endpoint ignored map_style** — `MapRequest` model now accepts `map_style`; both PreviewPage calls (initial load and manual slot insertion) pass `map_style` from the current profile.

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
