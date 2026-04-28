# PhotoBook Studio

Self-hosted photobook editor with Immich integration. Create, preview, and export print-ready photobooks as PDF or SVG directly from your Immich library.

## Features

- **Immich integration** — browse albums, sync captions, face-aware crop
- **Smart layout** — automatic page composition with orientation matching
- **Pan/zoom/crop** — per-slot interactive adjustment with live preview
- **Caption editor** — full style control (font, size, color, bold, italic, align, line-height), symbol picker, Immich sync toggle
- **PDF export** — print-ready PDF with ICC color profiles (sRGB, Adobe RGB, FOGRA39, FOGRA51, SWOP), correct pan/zoom/crop
- **SVG export** — Inkscape-compatible layered SVG
- **Profile system** — save/load/export layout and caption style profiles
- **Password protection** — optional token-based access control

## Quick Start

### Prerequisites
- Docker + Docker Compose
- Immich instance (self-hosted)

### Deploy

```bash
cp .env.example .env   # edit STADIA_MAPS_API_KEY and PHOTOBOOK_TOKEN
docker compose up -d
```

App available at `http://localhost:7180`

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PHOTOBOOK_TOKEN` | *(empty)* | Access token. Leave empty to disable auth. Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `STADIA_MAPS_API_KEY` | *(empty)* | API key for map tiles (optional) |
| `TZ` | `Europe/Rome` | Timezone |

### ICC Color Profiles

Place ICC profiles in `backend/icc/`:

| File | Profile |
|---|---|
| `sRGB_v4.icc` | sRGB (default) |
| `AdobeRGB1998.icc` | Adobe RGB |
| `ISOcoated_v2_300_eci.icc` | FOGRA39 |
| `PSO_Coated_v3.icc` | FOGRA51 |
| `USWebCoatedSWOP.icc` | SWOP |

## Architecture

```
frontend/   React + Vite SPA
backend/    FastAPI + Python
  main.py              API routes
  pdf_generator.py     ReportLab PDF export
  svg_exporter.py      SVG export
  layout_engine.py     Manual layout
  smart_layout.py      Auto layout with face-aware crop
  immich_client.py     Immich API client
  album_generator.py   Album assembly
  map_generator.py     Static map tiles
Dockerfile             Multi-stage build (Node → Python)
docker-compose.yml
```

## Development

```bash
# Backend (hot reload)
cd backend && uvicorn main:app --reload --port 8000

# Frontend (dev server)
cd frontend && npm install && npm run dev
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
