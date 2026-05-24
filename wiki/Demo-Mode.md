# Demo Mode

Demo mode lets you explore and evaluate PhotoBook Studio without connecting to an Immich server. It provides four built-in photo albums with realistic GPS, EXIF, and structural metadata, served from publicly available Lorem Picsum images.

---

## Table of Contents

- [What Is Demo Mode?](#what-is-demo-mode)
- [How to Enable Demo Mode](#how-to-enable-demo-mode)
- [Built-in Demo Albums](#built-in-demo-albums)
- [Pre-installed Demo Profiles](#pre-installed-demo-profiles)
- [Technical Implementation](#technical-implementation)
- [Limitations](#limitations)

---

## What Is Demo Mode?

Demo mode is a runtime flag that replaces all Immich API calls with responses from a built-in dataset defined in `backend/demo_data.py`. When active:

- No Immich server URL or API key is required
- All album, photo, and metadata responses come from hard-coded demo data
- Photos are served as URLs pointing to [Lorem Picsum](https://picsum.photos) (stable, publicly accessible image CDN)
- The full generation, preview, and export pipeline works normally

Demo mode is intended for:
- First-time evaluation before setting up Immich
- Testing and development without a running Immich instance
- Public demonstrations of the application

---

## How to Enable Demo Mode

Set the `DEMO_MODE` environment variable to `true`:

### Docker Compose

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
    environment:
      - DEMO_MODE=true
      - TZ=Europe/Rome
```

### Docker CLI

```bash
docker run -d \
  -p 7180:8000 \
  -v photobook_data:/data \
  -e DEMO_MODE=true \
  ghcr.io/romaruss/photobook-studio:latest
```

### Railway / Platform

Add `DEMO_MODE` = `true` in the service's environment variables panel.

Once enabled, the UI shows a **"Demo Mode"** banner on the Config page and the connection test always returns `{connected: true, demo: true}`.

---

## Built-in Demo Albums

Demo mode provides four albums, each with distinct geographic and thematic characteristics:

### Album 1 — Toscana 2023

| Field | Value |
|-------|-------|
| Photos | 18 |
| Theme | Tuscan countryside, hill towns, vineyards |
| GPS region | Tuscany, Italy (approx. 43°N, 11°E) |
| Dates | Summer 2023 |
| Face data | None (landscape/architecture photos) |

This album demonstrates GPS clustering and map-based divider pages. The GPS coordinates are distributed across several Tuscan locations (Florence, Siena, San Gimignano area), allowing the temporal clustering to produce 3–4 event groups.

### Album 2 — Dolomiti Estate

| Field | Value |
|-------|-------|
| Photos | 17 |
| Theme | Alpine mountain scenery, hiking |
| GPS region | Dolomites, Italy (approx. 46°N, 12°E) |
| Dates | Summer |
| Face data | None |

Demonstrates the map title page with mountain GPS coordinates. Photo EXIF metadata includes altitude (mock elevation data). The GPS spread across multiple valleys shows the route line feature on map pages.

### Album 3 — Famiglia

| Field | Value |
|-------|-------|
| Photos | 13 |
| Theme | Family portraits and indoor/outdoor gatherings |
| GPS region | Varied (home + outdoor locations) |
| Dates | Mixed |
| Face data | Yes — multiple named persons |

This album exercises face detection and face-aware cropping. Several photos have multiple faces; the album generator demonstrates how it merges bounding boxes and positions crops to show all faces. Prominent-face photos are placed on full-page slots.

### Album 4 — Barcellona 2024

| Field | Value |
|-------|-------|
| Photos | 16 |
| Theme | Urban travel, architecture, food |
| GPS region | Barcelona, Spain (approx. 41°N, 2°E) |
| Dates | 2024 |
| Face data | Minimal |

Demonstrates city/travel book layout with dense GPS clustering in an urban environment. Good for testing the map style options (Stadia Maps or OSM) in a walkable, pedestrian-scale GPS track.

---

## Pre-installed Demo Profiles

When demo mode is first started, two print profiles are created automatically in `/data/profiles/` if no profiles exist yet:

| Profile | Page size | Orientation | Notes |
|---------|-----------|-------------|-------|
| **A4 Portrait — Standard** | A4 | Portrait | 10 mm margins, 3 mm bleed, 300 DPI, sRGB |
| **20×20 Square — Coffee Table** | 20×20 | — | 15 mm margins, no bleed, 300 DPI, sRGB |

These profiles include a basic set of page types (full page, 2-column, photo+caption) sufficient to demonstrate the generation pipeline. You can modify or delete them like any other profile.

If profiles already exist in `/data/profiles/` when demo mode starts, the demo profiles are **not** created (to avoid overwriting your work).

---

## Technical Implementation

Demo mode is implemented as a guard inside `backend/immich_client.py`. Every public method checks the demo flag before making any HTTP call:

```python
# Simplified logic in immich_client.py
class ImmichClient:
    def __init__(self):
        self.demo_mode = os.environ.get("DEMO_MODE", "").lower() == "true"

    async def get_albums(self):
        if self.demo_mode:
            return demo_data.ALBUMS
        # ... real HTTP call to Immich
```

`backend/demo_data.py` contains:
- `ALBUMS` — list of 4 album objects matching the Immich album schema
- `ASSETS` — mapping of album ID → list of asset objects, each with:
  - Stable picsum.photos URLs for thumbnails and full-resolution
  - Mock EXIF (date, GPS, orientation, dimensions)
  - Mock face bounding boxes (for the Famiglia album)
  - Mock descriptions

### Photo URLs

Demo photos use the [Lorem Picsum](https://picsum.photos) stable URL format:

```
https://picsum.photos/id/{n}/800/600
```

Where `{n}` is a specific photo ID. These IDs are hardcoded in `demo_data.py` and chosen to be visually representative of the album theme.

Thumbnails use smaller dimensions (e.g. `400/300`). Full-resolution URLs use larger dimensions (e.g. `1600/1200`) to simulate a realistic download during PDF export.

### API Endpoint Behaviour in Demo Mode

| Endpoint | Demo behaviour |
|----------|---------------|
| `GET /api/config/test` | Returns `{connected: true, demo: true}` without HTTP call |
| `GET /api/albums` | Returns `demo_data.ALBUMS` |
| `GET /api/thumb/{id}` | Proxies picsum.photos thumbnail URL |
| `POST /api/generate` | Full pipeline runs on demo asset list |
| `POST /api/export/pdf` | Full PDF generated from picsum.photos images |
| `POST /api/export/svg` | Full SVG ZIP generated |
| Caption sync | Write silently discarded (no HTTP call) |

### The `demo` Flag in Health Check

```bash
curl http://localhost:7180/api/health
```

```json
{
  "status": "ok",
  "version": "0.9.8",
  "demo": true
}
```

The `demo` field in the health check response allows monitoring and integration tools to detect demo mode programmatically.

---

## Limitations

Demo mode has the following limitations compared to a live Immich connection:

- **No caption sync** — captions cannot be written back (there is no Immich server to receive them)
- **Internet required** — demo photo images are fetched from picsum.photos at runtime; the app requires outbound internet access from the container
- **Fixed dataset** — you cannot add, remove, or modify demo albums or photos
- **Mock metadata only** — EXIF data (sharpness, real GPS, real dates) is simulated; quality scores and clustering may not reflect real-world performance
- **Face data only for Famiglia** — the other three albums have no face detection data, so face-aware cropping uses centre-crop for all photos
- **No real person names** — face identities in the Famiglia album use placeholder names
