# Configuration

This page covers all configuration options for PhotoBook Studio: Immich connection setup, environment variables, the Deep Config system for algorithm parameters, and access token authentication.

---

## Table of Contents

- [Immich Connection Setup](#immich-connection-setup)
- [Required Immich Permissions](#required-immich-permissions)
- [Environment Variables](#environment-variables)
- [Auth Token Setup](#auth-token-setup)
- [Deep Config System](#deep-config-system)
- [Deep Config Sections Reference](#deep-config-sections-reference)

---

## Immich Connection Setup

On first launch, navigate to the **Config** page (gear icon or `/config` route). Enter:

| Field | Description |
|-------|-------------|
| **Immich URL** | Base URL of your Immich server, including protocol and port. Example: `http://192.168.1.10:2283` or `https://photos.example.com` |
| **API Key** | An Immich API key with the required permissions (see below) |

Click **Save** then **Test Connection** to verify connectivity. The connection test calls `GET /api/config/test` on the backend, which in turn calls the Immich `/api/server/ping` and `/api/auth/validateToken` endpoints.

The config is stored in `/data/config.json`:

```json
{
  "immich_url": "http://192.168.1.10:2283",
  "api_key": "your_immich_api_key_here"
}
```

In **Demo Mode**, the config page is still accessible but the connection test always returns `{connected: true, demo: true}` and no network call is made.

---

## Required Immich Permissions

Create a dedicated API key in Immich (**Administration → API Keys → New API Key**) with these permissions:

| Permission | Required for |
|-----------|-------------|
| `Asset:Read` | Fetching asset metadata, EXIF, face data |
| `Asset:View` | Downloading thumbnails and full-resolution photos for export |
| `Asset:Update` | Writing captions back to Immich (caption sync) — can be omitted if caption sync is not needed |
| `Album:Read` | Listing albums and reading album contents |
| `Person:Read` | Reading face recognition data (person/face bounding boxes) |

Using a minimal-permission key is recommended for security. If you do not use caption sync, omit `Asset:Update`.

---

## Environment Variables

All environment variables can be set in `docker-compose.yml` under the `environment:` key, in `.env`, or as Railway / platform environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PHOTOBOOK_PORT` | `7180` | Host port used in `docker-compose.yml` port mapping. Does not affect the internal uvicorn port. |
| `PHOTOBOOK_TOKEN` | *(empty)* | If set, enables bearer token authentication for all `/api/*` routes. Leave empty to disable auth. |
| `STADIA_MAPS_API_KEY` | *(empty)* | API key for Stadia Maps tile service. When empty, the app falls back to the OpenStreetMap-based staticmap library (no key required, but higher latency). |
| `TZ` | `Europe/Rome` | Container timezone, used for date formatting in titles and divider pages. |
| `DEMO_MODE` | *(empty)* | Set to `true` to enable demo mode (built-in albums, no Immich server required). See [Demo Mode](Demo-Mode.md). |
| `PORT` | `8000` | Internal uvicorn listen port. Set automatically by Railway; do not set manually unless you have a specific reason. |

### Setting Variables in Docker Compose

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    ports:
      - "${PHOTOBOOK_PORT:-7180}:8000"
    environment:
      - TZ=Europe/Rome
      - PHOTOBOOK_TOKEN=my_secret_token
      - STADIA_MAPS_API_KEY=your_stadia_key
      - DEMO_MODE=false
    volumes:
      - photobook_data:/data
```

### Setting Variables on Railway

Go to your Railway service → **Variables** tab and add each variable as a key-value pair. Railway automatically injects `PORT` — do not override it.

---

## Auth Token Setup

PhotoBook Studio includes optional bearer token authentication to prevent unauthorised access to your photo library.

### Enabling Auth

Set the `PHOTOBOOK_TOKEN` environment variable to any secret string:

```
PHOTOBOOK_TOKEN=super_secret_token_here
```

When set:

- All `GET /api/*` and `POST /api/*` routes require authentication
- The frontend automatically attaches the token to every API request header
- Unauthenticated requests receive `HTTP 401 Unauthorized`

### Providing the Token to the Browser

When you first open the app with auth enabled, you will be prompted to enter the token. The token is stored in the browser's `localStorage` and sent as:

```
Authorization: Bearer super_secret_token_here
```

Alternatively, the token can be passed as a URL query parameter (useful for direct-link access):

```
http://localhost:7180/?token=super_secret_token_here
```

### Checking Auth Status

The endpoint `GET /api/auth/status` returns whether auth is enabled and whether the current request is authenticated:

```json
{
  "auth_enabled": true,
  "authenticated": true
}
```

This is called by the frontend on startup to decide whether to show the token prompt.

### Security Notes

- The token is transmitted as a plain HTTP header. If you expose PhotoBook Studio to the internet, **always use HTTPS** (via a reverse proxy such as Nginx, Caddy, or Traefik).
- There is no multi-user system; all authenticated users share the same view of profiles, projects, and exports.
- Token rotation requires restarting the container with the new `PHOTOBOOK_TOKEN` value.

---

## Deep Config System

The **Deep Config** system exposes the internal algorithm parameters of the layout engine, quality scorer, duplicate remover, face-crop system, and export pipeline — all in one editable UI at `/deep-config`.

### How It Works

Parameters are defined with their defaults in `backend/deep_config_defaults.json`. This file is the **source of truth** for all parameter names, types, and default values. It is bundled in the Docker image and never modified at runtime.

User overrides are stored as a **delta** in `/data/deep_config.json`. Only parameters that differ from the defaults need to be stored — absent keys automatically use the default value.

At runtime, `config_loader.py` merges the two:

```python
effective_config = {**defaults, **user_overrides}
```

This means:
- You can always reset a single parameter to its default by deleting its key from `/data/deep_config.json`
- A full factory reset of all parameters is achieved by deleting `/data/deep_config.json`
- Upgrading the application may add new parameters to `deep_config_defaults.json`; they will be active immediately without any action required

### Editing via the UI

1. Navigate to **Deep Config** (wrench icon or `/deep-config` route)
2. Parameters are grouped by section (quality, face, duplicates, layout_scoring, map, pdf, svg, performance)
3. Each parameter shows its current value, default value, and a reset-to-default button
4. Edit the value and click **Save**

Changes take effect on the next layout generation or export — no restart required.

### Editing via API

```bash
# Get current effective config (merged defaults + overrides)
curl http://localhost:7180/api/deep-config

# Save overrides (only send the keys you want to change)
curl -X POST http://localhost:7180/api/deep-config \
  -H "Content-Type: application/json" \
  -d '{"quality": {"weight_sharpness": 0.5, "weight_resolution": 0.3}}'
```

### Editing the File Directly

You can also edit `/data/deep_config.json` in a text editor. The file is a flat or nested JSON with only the overridden parameters. Restart is not required; the file is re-read on every request.

---

## Deep Config Sections Reference

### `quality` — Photo Quality Scoring

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sharpness_variance_divisor` | 500 | Divisor to normalise Laplacian variance to 0–1 |
| `brightness_target` | 128 | Ideal mean pixel brightness (0–255) |
| `megapixel_reference` | 12 | Reference megapixel count for resolution scoring |
| `histogram_bins` | 256 | Bins used in brightness histogram |
| `weight_resolution` | 0.4 | Weight of resolution in composite quality score |
| `weight_sharpness` | 0.4 | Weight of sharpness in composite quality score |
| `weight_brightness` | 0.2 | Weight of brightness in composite quality score |

### `face` — Face Detection and Crop

| Parameter | Default | Description |
|-----------|---------|-------------|
| `min_face_size` | 0.02 | Minimum face bbox area (fraction of image) to consider |
| `clip_check_margin` | 0.05 | Tolerance fraction before a face clip is penalised |
| `prominent_threshold` | 0.05 | Area fraction above which a face is "prominent" |
| `pan_margin` | 0.1 | Buffer around face bbox as fraction of crop dimension |
| `target_y_position` | 0.35 | Vertical position of face centre in crop (rule of thirds) |
| `close_up_threshold` | 0.15 | Area fraction above which photo is treated as close-up |

### `duplicates` — Duplicate Detection

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dhash_size` | 8 | dHash grid size (produces `dhash_size²` bits) |
| `duplicate_threshold` | 0.83 | Hamming distance ratio below which photos are duplicates |
| `burst_time_window_base_sec` | 10 | Max seconds between burst shots |
| `gps_coord_rounding` | 3 | Decimal places for GPS rounding in burst detection |

### `layout_scoring` — Template Selection

| Parameter | Default | Description |
|-----------|---------|-------------|
| `penalty_orientation_violation` | 2.0 | Score penalty for photo/slot orientation mismatch |
| `penalty_empty_caption_slot` | 0.5 | Penalty for unused caption slot |
| `bonus_caption_match` | 1.0 | Bonus for caption slot with available text |
| `face_clip_penalty_weight` | 3.0 | Weight for face-clipping penalty |
| `rhythm_alternation_penalty` | 0.3 | Penalty for consecutive same layout |
| `layout_reuse_penalty` | 0.1 | Additional penalty per reuse count |

### `map` — GPS Map Generation

| Parameter | Default | Description |
|-----------|---------|-------------|
| `marker_color` | `"#e74c3c"` | GPS marker color (hex) |
| `marker_size` | 8 | Marker radius (pixels) |
| `route_width` | 2 | Route line width (pixels) |
| `background_color` | `"#f8f9fa"` | Map background fallback color |
| `grid_color` | `"#dee2e6"` | Grid line color |
| `grid_lines` | 5 | Grid lines per axis |
| `bbox_padding_deg` | 0.05 | Padding around GPS bounding box (degrees) |

### `pdf` — PDF Export

| Parameter | Default | Description |
|-----------|---------|-------------|
| `jpeg_quality` | 92 | JPEG compression quality for embedded photos (1–95) |
| `bleed_mark_length_mm` | 5 | Length of crop mark lines (mm) |
| `title_page_map_height_frac` | 0.6 | Fraction of title page height used by GPS map |
| `caption_font_size_factor` | 1.0 | Multiplier applied to `caption_style.size` |

### `svg` — SVG Export

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_image_dimension_px` | 2000 | Max pixel dimension for embedded photos |
| `jpeg_quality` | 85 | JPEG quality for SVG-embedded photos |
| `title_font_size` | 48 | Title text font size (pt) on title page |

### `performance` — Concurrency and Timeouts

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_hires_photos` | 50 | Max full-resolution photos downloaded per export |
| `concurrent_hires_downloads` | 4 | Max parallel full-resolution downloads |
| `concurrent_thumb_downloads` | 8 | Max parallel thumbnail downloads during generation |
| `pdf_timeout_per_page_sec` | 30 | Per-page timeout for PDF generation (seconds) |
