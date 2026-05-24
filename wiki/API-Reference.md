# API Reference

All PhotoBook Studio backend functionality is exposed as a REST API under the `/api/` prefix. The frontend React SPA is the primary consumer, but you can call these endpoints directly for scripting, integration, or debugging.

---

## Table of Contents

- [Authentication](#authentication)
- [Base URL and Versioning](#base-url-and-versioning)
- [Error Responses](#error-responses)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [Auth](#auth)
  - [Config](#config)
  - [Albums](#albums)
  - [Thumbnails](#thumbnails)
  - [Print Profiles](#print-profiles)
  - [Layout Generation](#layout-generation)
  - [Export](#export)
  - [Projects](#projects)
  - [Deep Config](#deep-config)

---

## Authentication

Authentication is **optional** and controlled by the `PHOTOBOOK_TOKEN` environment variable. When set, all `/api/*` routes require a valid token.

### Bearer Token Header

```
Authorization: Bearer <token>
```

### Query Parameter (alternative)

```
GET /api/albums?token=<token>
```

### Response When Unauthenticated

```
HTTP 401 Unauthorized
Content-Type: application/json

{"detail": "Unauthorized"}
```

---

## Base URL and Versioning

All endpoints are served at the application's root with the `/api/` prefix. There is no versioning prefix; the API is expected to be consumed by the bundled frontend at the same version.

```
http://localhost:7180/api/...
```

All request and response bodies use `application/json` unless otherwise noted.

---

## Error Responses

| HTTP Status | Meaning |
|------------|---------|
| `200 OK` | Success |
| `201 Created` | Resource created |
| `204 No Content` | Success, no body |
| `400 Bad Request` | Invalid request body or parameters |
| `401 Unauthorized` | Missing or invalid auth token |
| `404 Not Found` | Resource does not exist |
| `422 Unprocessable Entity` | FastAPI request validation failure (malformed JSON or missing required fields) |
| `500 Internal Server Error` | Unhandled backend error |

All error responses include a JSON body with a `detail` field:

```json
{"detail": "Profile not found"}
```

---

## Endpoints

---

### Health

#### `GET /api/health`

Returns the application health status, version, and demo flag.

**Response `200`:**
```json
{
  "status": "ok",
  "version": "0.9.8",
  "demo": false
}
```

`demo: true` when `DEMO_MODE=true` is set.

---

### Auth

#### `GET /api/auth/status`

Returns whether authentication is enabled and whether the current request is authenticated. This endpoint is **always accessible** (no auth required) so the frontend can determine whether to show the token prompt.

**Response `200`:**
```json
{
  "auth_enabled": true,
  "authenticated": false
}
```

---

### Config

#### `GET /api/config`

Returns the current Immich connection configuration (stored in `/data/config.json`). The API key is masked in the response for security.

**Response `200`:**
```json
{
  "immich_url": "http://192.168.1.10:2283",
  "api_key": "••••••••••••••••"
}
```

---

#### `POST /api/config`

Saves the Immich connection configuration.

**Request body:**
```json
{
  "immich_url": "http://192.168.1.10:2283",
  "api_key": "your_immich_api_key"
}
```

**Response `200`:**
```json
{"status": "saved"}
```

---

#### `GET /api/config/test`

Tests the Immich connection using the currently saved config. Returns connectivity status and demo flag.

**Response `200` (connected):**
```json
{
  "connected": true,
  "demo": false,
  "immich_version": "1.105.1"
}
```

**Response `200` (not connected):**
```json
{
  "connected": false,
  "demo": false,
  "error": "Connection refused"
}
```

In demo mode, always returns `{connected: true, demo: true}`.

---

### Albums

#### `GET /api/albums`

Lists all Immich albums accessible with the configured API key. In demo mode, returns the four built-in demo albums.

**Response `200`:**
```json
[
  {
    "id": "album-uuid",
    "albumName": "Toscana 2023",
    "assetCount": 18,
    "startDate": "2023-07-10T08:00:00Z",
    "endDate": "2023-07-17T19:00:00Z",
    "albumThumbnailAssetId": "asset-uuid"
  }
]
```

---

### Thumbnails

#### `GET /api/thumb/{asset_id}`

Proxies the thumbnail for the given asset from Immich (or demo picsum URL). Returns the image bytes with the appropriate `Content-Type` header.

This endpoint exists to avoid CORS issues and to provide a single proxy point for both live and demo modes.

**Path parameter:** `asset_id` — Immich asset UUID

**Response `200`:** image bytes (`image/jpeg` or `image/webp`)

**Response `404`:** asset not found

---

### Print Profiles

#### `GET /api/profiles`

Returns all print profiles stored in `/data/profiles/`.

**Response `200`:**
```json
[
  {
    "id": "profile-uuid",
    "name": "A4 Portrait",
    "page_size": "a4",
    "orientation": "portrait",
    "margin_mm": 10,
    "bleed": true,
    "bleed_mm": 3,
    "gap_mm": 2,
    "export_dpi": 300,
    "color_profile": "srgb",
    "crop_marks": true,
    "body_paper_gsm": 130,
    "page_types": [...],
    "caption_style": {...},
    "cover": [...]
  }
]
```

---

#### `POST /api/profiles`

Creates a new print profile. A UUID is generated automatically.

**Request body:** profile object (without `id`)

**Response `201`:**
```json
{"id": "new-profile-uuid"}
```

---

#### `PUT /api/profiles/{id}`

Updates an existing profile. Replaces the entire profile document.

**Path parameter:** `id` — profile UUID

**Request body:** full profile object

**Response `200`:**
```json
{"status": "updated"}
```

---

#### `DELETE /api/profiles/{id}`

Deletes a profile.

**Path parameter:** `id` — profile UUID

**Response `204`:** no content

**Response `404`:** profile not found

---

#### `POST /api/profiles/{id}/duplicate`

Creates a copy of an existing profile with a new UUID. The copy's name is prefixed with `"Copy of "`.

**Path parameter:** `id` — source profile UUID

**Response `201`:**
```json
{"id": "new-copy-uuid"}
```

---

### Layout Generation

#### `POST /api/generate`

Runs the standard album generation pipeline for the given album and profile.

**Request body:**
```json
{
  "album_id": "album-uuid",
  "profile_id": "profile-uuid",
  "options": {
    "cluster_events": true,
    "cluster_gap_minutes": 60,
    "remove_duplicates": true,
    "use_map_fill": true,
    "density": 1.0,
    "min_quality": 0.2,
    "include_title_page": true,
    "include_dividers": true
  }
}
```

**Response `200`:** array of page objects

```json
[
  {
    "page_index": 0,
    "page_type": "full_page",
    "slots": [
      {
        "slot_index": 0,
        "type": "photo",
        "asset_id": "asset-uuid",
        "crop": {"x": 0, "y": 120, "w": 4032, "h": 3024},
        "caption": "Walking through the vineyard"
      }
    ]
  }
]
```

---

#### `POST /api/generate/smart`

Runs the smart auto-layout pipeline (higher-level wrapper with event dividers and cross-cluster balancing). Request and response shape are identical to `POST /api/generate`.

---

#### `POST /api/generate/recalculate`

Recalculates layout from a manually ordered photo list. Used when the user has reordered photos in the unassigned pool and wants to re-run generation without re-clustering.

**Request body:**
```json
{
  "asset_ids": ["uuid1", "uuid2", "..."],
  "profile_id": "profile-uuid",
  "options": { ... }
}
```

**Response `200`:** same page object array as `POST /api/generate`.

---

### Export

#### `POST /api/export/pdf`

Generates a PDF export of the current book layout. The response is a streaming download of the PDF file.

**Request body:**
```json
{
  "pages": [...],
  "profile_id": "profile-uuid",
  "options": {
    "dpi": 300,
    "color_profile": "fogra39",
    "include_cover": true,
    "bleed": true,
    "crop_marks": true,
    "page_range": null
  }
}
```

`page_range`: `null` for all pages, or `[start, end]` (1-based inclusive) for a range.

**Response `200`:**
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="photobook.pdf"`
- Body: PDF bytes (streaming)

---

#### `POST /api/export/svg`

Generates an SVG ZIP export. Response is a ZIP file download.

**Request body:** same shape as `POST /api/export/pdf`

**Response `200`:**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="photobook_svg.zip"`
- Body: ZIP bytes

---

#### `GET /api/export/color_profiles`

Returns the list of ICC color profiles available on the server (bundled and found).

**Response `200`:**
```json
[
  {"id": "srgb",      "name": "sRGB",                "color_space": "RGB",  "bundled": true},
  {"id": "adobe_rgb", "name": "Adobe RGB (1998)",     "color_space": "RGB",  "bundled": false},
  {"id": "fogra39",   "name": "ISO Coated v2 FOGRA39","color_space": "CMYK", "bundled": true},
  {"id": "fogra51",   "name": "ISO Coated v2 300%",   "color_space": "CMYK", "bundled": false},
  {"id": "swop",      "name": "SWOP v2",              "color_space": "CMYK", "bundled": false}
]
```

Profiles with `bundled: false` fall back to sRGB at export time.

---

### Projects

#### `GET /api/projects`

Returns all saved projects in `/data/projects/`.

**Response `200`:**
```json
[
  {
    "id": "project-uuid",
    "name": "Toscana 2023 Book",
    "album_id": "album-uuid",
    "profile_id": "profile-uuid",
    "created_at": "2024-03-15T10:30:00Z",
    "updated_at": "2024-03-16T14:00:00Z",
    "page_count": 24
  }
]
```

---

#### `POST /api/projects`

Saves the current book layout as a project (creates or overwrites).

**Request body:**
```json
{
  "id": "project-uuid",
  "name": "Toscana 2023 Book",
  "album_id": "album-uuid",
  "profile_id": "profile-uuid",
  "pages": [...]
}
```

If `id` is omitted, a new UUID is generated.

**Response `200`:**
```json
{"id": "project-uuid"}
```

---

### Deep Config

#### `GET /api/deep-config`

Returns the effective deep config: defaults merged with user overrides.

**Response `200`:** nested JSON object with all sections and parameters (see [Configuration — Deep Config Sections Reference](Configuration.md#deep-config-sections-reference)).

---

#### `POST /api/deep-config`

Saves user overrides for algorithm parameters. Only send the keys you want to change — unspecified keys retain their current override (or default).

**Request body (example — only override two values):**
```json
{
  "quality": {
    "weight_sharpness": 0.5
  },
  "face": {
    "target_y_position": 0.4
  }
}
```

**Response `200`:**
```json
{"status": "saved"}
```

To reset all overrides to defaults, `POST` an empty object `{}`.
