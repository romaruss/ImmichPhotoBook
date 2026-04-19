# Changelog

All notable changes to PhotoBook Studio are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---
feat: layout engine fixes, cover editor redesign, PDF/SVG export improvements

- Fix slot AR calculation for landscape pages (page_ar propagated everywhere)
- Rewrite face crop pan formula: target 38% from top with safe-margin clamps
- Lower face prominence threshold 0.05→0.02 for transform/log
- PDF: fix NameError PT→mm, add per-side margins with duplex binding swap
- SVG: fix NameError SVG_NS/XLINK/INKSCAPE_NS (constants were undefined)
- Export: hi-res/preview quality toggle, progress bar with polling, 300s timeout
- CoverEditor: full redesign — bg_type (color/photo/map), inset box (map/photo,
  position top/bottom/left/right), photo picker modal, orientation-aware preview
- Profile model: add margin_top/right/bottom/left and cover_style fields to Pydantic
- ProfilesPage: MarginInput top-level component (fix focus loss), binding margin labels
- PreviewPage: spread nav advances by 2, per-view highlight, video filter,
  persist spreadView/panelOpen/view in localStorage, export progress bar
- AlbumsPage: SliderInput fixes drag + text focus loss
- Multi-album: concatenate with section covers and blank separator pages
- App: nav sidebar collapse tab on right edge
- Filter VIDEO assets from layout generation, panel display and unused count

## [1.0.0] — 2025

### Added
- Initial release
- Immich integration via API key
- Smart Layout engine: temporal clustering, quality scoring, face-aware crop, favourite-photo full-page
- Manual layout with 20+ built-in page templates and custom grid creator
- Interactive preview: drag-swap photos, drag-resize slots, pan/zoom within slots
- Recalculate menu with 7 redistribution options
- PDF export (ReportLab) with bleed and crop marks
- SVG ZIP export compatible with Illustrator, Inkscape, Scribus, InDesign
- Project save/load (multiple named projects)
- GPS map on cover page (OpenStreetMap tiles, PIL fallback)
- Caption editing inline
- Album panel: usage tracking, filter by status, 1/2/3-column view
- Smart Layout configuration modal with live parameter tuning
- Localisation system (Italian 🇮🇹 and English 🇬🇧)
- Docker multi-stage build, single container deployment
