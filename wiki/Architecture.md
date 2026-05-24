# Architecture

This page describes the internal architecture of PhotoBook Studio: how the frontend and backend are structured, how requests flow through the system, and how data is stored.

---

## Table of Contents

- [System Overview](#system-overview)
- [Frontend / Backend Split](#frontend--backend-split)
- [How the Frontend is Served](#how-the-frontend-is-served)
- [Module Dependency Overview](#module-dependency-overview)
- [Request Flow: Layout Generation](#request-flow-layout-generation)
- [Request Flow: PDF Export](#request-flow-pdf-export)
- [Data Storage Layout](#data-storage-layout)
- [Immich Client](#immich-client)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Container (Python 3.12 + uvicorn)                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  FastAPI Application  (main.py)                          │   │
│  │                                                          │   │
│  │  /api/*  ──► REST endpoints                              │   │
│  │  /*      ──► StaticFiles (React SPA)                     │   │
│  │                                                          │   │
│  │  ┌─────────────────┐  ┌────────────────────────────┐    │   │
│  │  │ album_generator │  │ pdf_generator / svg_exporter│    │   │
│  │  │ smart_layout    │  │ (export pipeline)           │    │   │
│  │  │ layout_engine   │  └────────────────────────────┘    │   │
│  │  └────────┬────────┘                                     │   │
│  │           │                                              │   │
│  │  ┌────────▼────────┐  ┌──────────────────┐              │   │
│  │  │ immich_client   │  │ map_generator    │              │   │
│  │  │ (httpx async)   │  │ (Stadia/OSM)     │              │   │
│  │  └────────┬────────┘  └──────────────────┘              │   │
│  │           │                                              │   │
│  │  ┌────────▼────────┐                                     │   │
│  │  │ config_loader   │                                     │   │
│  │  │ demo_data       │                                     │   │
│  │  └─────────────────┘                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  /data/ volume ─── config.json, profiles/, projects/,           │
│                     exports/, cache/, presets/, deep_config.json│
└──────────────┬──────────────────────────────────────────────────┘
               │
               │  HTTP  (Immich API)
               ▼
┌──────────────────────────┐
│  Immich Server           │
│  (separate container)    │
└──────────────────────────┘
```

---

## Frontend / Backend Split

PhotoBook Studio is a **single-origin** application: the React SPA and the FastAPI backend are bundled inside the same Docker container and served on the same port.

### Backend (`backend/`)

| File | Responsibility | Approx. lines |
|------|---------------|---------------|
| `main.py` | FastAPI app entry point; all REST endpoint definitions; auth middleware; static file mount | ~1325 |
| `immich_client.py` | Async Immich API client; connection pooling (max 20); demo-mode interception | — |
| `album_generator.py` | Core layout generation: event clustering, quality scoring, template selection, slot assignment | ~1434 |
| `smart_layout.py` | High-level smart auto-layout pipeline orchestrating album_generator components | ~654 |
| `layout_engine.py` | Page/slot geometry: coordinate math, percentage-based slots, bleed/margin calculations | ~397 |
| `pdf_generator.py` | ReportLab PDF export: ICC profiles, bleed, crop marks, title page, captions, spine | ~1237 |
| `svg_exporter.py` | SVG ZIP export: per-page SVG with embedded base64 JPEG photos | ~520 |
| `map_generator.py` | GPS map images: Stadia Maps tiles or OSM staticmap fallback | ~347 |
| `config_loader.py` | Deep config system: loads `deep_config_defaults.json`, merges user overrides from `/data/deep_config.json` |  — |
| `demo_data.py` | Built-in demo albums (4 albums, 64 photos via picsum.photos) | — |
| `deep_config_defaults.json` | All algorithm parameter defaults; serves as the schema for DeepConfigPage | — |

### Frontend (`frontend/src/`)

| File / Directory | Responsibility |
|-----------------|----------------|
| `pages/ConfigPage.jsx` | Immich server URL and API key configuration |
| `pages/HomePage.jsx` | Dashboard: project list, quick actions |
| `pages/ProfilesPage.jsx` | Print profile CRUD, slot drag-resize editor |
| `pages/AlbumsPage.jsx` | Album browser, generation options, smart layout trigger |
| `pages/PreviewPage.jsx` | Interactive page editor: pan/zoom, photo swap, inline captions, export modal |
| `pages/DeepConfigPage.jsx` | Advanced algorithm parameter editor |
| `src/i18n.jsx` | i18n provider (React context) |
| `src/locales/it.js` | Italian string map |
| `src/locales/en.js` | English string map |

---

## How the Frontend is Served

During the Docker build, Vite compiles the React app into static assets placed in `frontend/dist/`. FastAPI then mounts that directory at the root path using `StaticFiles`:

```python
# main.py (simplified)
from fastapi.staticfiles import StaticFiles

app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
```

All routes beginning with `/api/` are matched by FastAPI's router **before** the static mount, so API calls are never intercepted by the SPA. The React app uses client-side routing (React Router); the `html=True` flag on `StaticFiles` ensures the SPA's `index.html` is served for any unknown path, enabling deep-links to work correctly.

In **development**, the frontend Vite dev server runs separately (typically on port 5173) and proxies `/api/` requests to the uvicorn backend on port 8000.

---

## Module Dependency Overview

```
main.py
 ├── immich_client.py  ◄── demo_data.py
 ├── config_loader.py  ◄── deep_config_defaults.json
 ├── album_generator.py
 │     ├── layout_engine.py
 │     └── immich_client.py
 ├── smart_layout.py
 │     └── album_generator.py
 ├── pdf_generator.py
 │     ├── layout_engine.py
 │     └── map_generator.py
 ├── svg_exporter.py
 │     └── layout_engine.py
 └── map_generator.py
```

`config_loader.py` is imported by most backend modules to access the merged deep-config parameters at runtime.

---

## Request Flow: Layout Generation

This is the primary user action: selecting an album and clicking **Generate**.

```
Browser
  │  POST /api/generate  { album_id, profile_id, options }
  ▼
main.py  ─── load profile from /data/profiles/{id}.json
          ─── call immich_client.get_album_assets(album_id)
                │
                ▼  (async, connection pool)
          Immich API  →  asset list with EXIF, GPS, face bbox data
                │
          immich_client returns asset list
          │
          ▼
  album_generator.generate_layout(assets, profile, options)
    │
    ├── 1. cluster_events()      group by time gap
    ├── 2. score_quality()       resolution × sharpness × brightness
    ├── 3. remove_duplicates()   dHash + burst detection
    ├── 4. _get_all_faces()      parse Immich face bbox metadata
    ├── 5. _select_template()    score page types, pick best fit
    ├── 6. _assign_slots()       face-aware pan, crop calculation
    └── returns: list of Page objects
          │
          ▼
  main.py serialises pages → JSON response
          │
          ▼
Browser  ─── PreviewPage renders pages from JSON
```

For **smart layout** (`POST /api/generate/smart`), `smart_layout.py` wraps `album_generator` with additional heuristics and calls it iteratively to fill all pages.

---

## Request Flow: PDF Export

```
Browser
  │  POST /api/export/pdf  { pages, profile_id, options }
  ▼
main.py
  ├── deserialise pages from request body
  ├── load profile
  └── call pdf_generator.generate_pdf(pages, profile, options)
          │
          ├── for each page:
          │     ├── download full-resolution asset from Immich
          │     │     (or demo URL)  via immich_client
          │     ├── Pillow resize to target DPI
          │     ├── apply ICC color transform (if CMYK profile)
          │     └── draw page with ReportLab (photo, caption, map)
          │
          ├── embed ICC output profile in PDF metadata
          ├── add crop marks if bleed enabled
          └── write PDF bytes to /data/exports/{uuid}.pdf
                │
                ▼
main.py  ─── streaming response with PDF bytes
          ─── (or filename for download)
```

SVG export follows the same pattern but calls `svg_exporter.generate_svg_zip()` instead.

---

## Data Storage Layout

All persistent state lives inside the `/data/` volume:

```
/data/
├── config.json              Immich server URL + API key
├── deep_config.json         User overrides for algorithm parameters
│                             (delta from defaults; absent keys = use default)
├── profiles/
│   ├── {uuid}.json          One file per print profile
│   └── ...
├── projects/
│   ├── {uuid}.json          Saved book projects
│   └── ...
├── exports/
│   ├── {uuid}.pdf           Generated PDF exports
│   ├── {uuid}.zip           Generated SVG ZIP exports
│   └── ...
├── cache/
│   └── thumbs/              Proxied thumbnail cache from Immich
└── presets/
    └── {name}.json          Generation config presets
```

The `/data/exports/` directory is served by FastAPI as a static file route at `/api/exports/`, so generated files are directly downloadable by the browser.

---

## Immich Client

`immich_client.py` provides an async interface to the Immich REST API using `httpx.AsyncClient` with a shared connection pool (max 20 simultaneous connections).

Key behaviors:

- **Authentication**: sends `x-api-key: {key}` on every request, read from `/data/config.json`
- **Demo interception**: when `DEMO_MODE=true`, all methods return data from `demo_data.py` without making any network requests
- **Face data**: Immich returns face bounding boxes as normalized coordinates (`0.0`–`1.0`) relative to the full asset dimensions; `immich_client` parses these and passes them to `album_generator`
- **Caption sync**: `update_asset_description(asset_id, description)` calls `PUT /api/assets/{id}` on the Immich server to persist captions as EXIF descriptions

Required Immich API permissions for the API key:

| Permission | Used for |
|------------|---------|
| `Asset:Read` | Download asset metadata and thumbnails |
| `Asset:View` | Download full-resolution assets for export |
| `Asset:Update` | Write captions back to Immich |
| `Album:Read` | List albums and album contents |
| `Person:Read` | Read face/person recognition data |
