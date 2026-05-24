# PhotoBook Studio — Wiki

**PhotoBook Studio** (also known as *ImmichPhotoBook*) is a self-hosted web application that connects to an [Immich](https://immich.app/) photo server, reads your albums and photo metadata (GPS, EXIF, face recognition data, descriptions), and lets you compose print-ready photobooks through a browser-based interactive editor. Finished books can be exported as print-ready PDF or SVG ZIP files.

---

## Table of Contents

| Page | Description |
|------|-------------|
| [Architecture](Architecture.md) | System diagram, module overview, request flow, data storage |
| [Print Profiles](Print-Profiles.md) | Profile fields, page sizes, slot system, bleed, color profiles, DPI guide |
| [Album Generation](Album-Generation.md) | Pipeline steps, clustering, quality scoring, face-aware crop, layout selection |
| [Preview and Export](Preview-and-Export.md) | Interactive editor features, PDF/SVG export, caption sync |
| [Configuration](Configuration.md) | Immich connection, environment variables, Deep Config, auth token |
| [Demo Mode](Demo-Mode.md) | Built-in demo albums, how to enable, technical implementation |
| [API Reference](API-Reference.md) | All REST endpoints, request/response shapes, auth format, error codes |
| [Development Guide](Development.md) | Local setup, dev server, adding features, i18n, Deep Config extension |
| [Deployment](Deployment.md) | Docker Compose, GHCR image, Railway.app, volumes, upgrade procedure |

---

## What PhotoBook Studio Does

```
Immich Server
    │
    │  albums, thumbnails, EXIF, GPS, faces
    ▼
PhotoBook Studio
    │
    ├── Layout Engine ──► Smart auto-layout with quality scoring
    │                     face-aware cropping, temporal clustering
    │
    ├── Interactive Editor ──► Drag-and-drop pages, inline captions,
    │                          cover editor, divider pages, 2-up spread
    │
    └── Export Engine ──► Print-ready PDF (ReportLab + ICC profiles)
                          SVG ZIP (vector, Inkscape/Illustrator compatible)
```

PhotoBook Studio does **not** store or re-upload your photos. It reads thumbnails and metadata from Immich, generates layouts in memory, and produces export files on demand. All persistent data (config, profiles, projects) is stored in a single `/data/` volume mount.

---

## Key Features

- **Self-hosted** — runs entirely in Docker on your own infrastructure; no cloud dependency
- **Immich-native** — uses the Immich API directly; respects face recognition, GPS, EXIF dates, and album structure
- **Smart auto-layout** — automatically clusters events by time, scores photo quality, detects duplicates, and chooses page layouts with face-aware cropping
- **Fully customisable print profiles** — define page size, margins, bleed, slot layouts, caption style, and color profile per book
- **Print-ready output** — PDF with ICC color profiles (sRGB, FOGRA39/ISO Coated for CMYK offset printing), bleed and crop marks, correct DPI
- **SVG export** — each page as an editable SVG, bundled in a ZIP
- **GPS maps** — title and divider pages embed satellite/street maps from Stadia Maps or OpenStreetMap
- **Caption sync** — captions written in the editor can be synced back to Immich as EXIF descriptions
- **Demo mode** — works without any Immich server; built-in demo albums using picsum.photos
- **i18n** — Italian and English UI (more locales can be added)
- **Optional token auth** — protect the UI with a bearer token

---

## Quick Start

### Docker Compose (recommended)

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
    environment:
      - TZ=Europe/Rome

volumes:
  photobook_data:
```

Open `http://localhost:7180`, go to **Config**, enter your Immich URL and API key, and start creating your first photobook.

### Demo Mode (no Immich needed)

```yaml
environment:
  - DEMO_MODE=true
```

See [Demo Mode](Demo-Mode.md) for details.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, uvicorn |
| Frontend | React 18, Vite (SPA, served by FastAPI) |
| PDF generation | ReportLab |
| Image processing | Pillow (PIL) |
| HTTP client | httpx (async, connection pooling) |
| Maps | Stadia Maps tiles or staticmap (OSM fallback) |
| Container | Docker multi-stage build (Node build + Python runtime) |

---

## Version and Changelog

See `CHANGELOG.md` in the repository root for the full version history.

Current stable: **v0.9.8**

---

## License

See `LICENSE` in the repository root.
