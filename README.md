<div align="center">

# 📖 PhotoBook Studio

**Self-hosted web app for creating print-ready photobooks from your Immich library**

[![ghcr.io](https://img.shields.io/badge/ghcr.io-romaruss%2FImmichPhotoBook-2496ED?logo=docker&logoColor=white)](https://github.com/romaruss/ImmichPhotoBook/pkgs/container/immichphotobook)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![AI Generated](https://img.shields.io/badge/Built%20with-Claude%20AI-orange)](https://claude.ai)

---

> 🤖 **Entirely designed and coded with [Claude AI](https://claude.ai) (Anthropic).**

</div>

---

## How it works

PhotoBook Studio connects to your [Immich](https://immich.app) instance, reads your albums and photo metadata (GPS, descriptions, faces), and lets you compose a photobook through an interactive browser-based editor. When you're done, it exports a print-ready PDF or an editable SVG ZIP.

**Workflow:**

```
Configuration → Print profile → Generate layout → Edit preview → Export PDF / SVG
```

1. **Configuration** — enter your Immich URL and API key
2. **Print profile** — choose page size, orientation, margins, bleed, page layouts, caption style, GPS map style
3. **Generate** — Smart Layout (automatic, face-aware, GPS maps) or Manual layout
4. **Preview** — drag photos between slots, resize, pan/zoom, edit captions inline
5. **Export** — PDF (print shop ready) or SVG ZIP (editable in Illustrator, Inkscape, Scribus)

---

## Main features

- **Immich integration** — reads albums, EXIF, GPS, face data, descriptions; syncs captions back as asset descriptions; shows favorite ⭐ and description 💬 badges on photo slots
- **Smart Layout** — groups photos by time event, ranks by quality, face-aware crop, fills empty slots with GPS cluster maps
- **Manual layout** — configurable page layouts per profile; visual slot editor with drag-to-move and drag-to-resize, z-index reorder, magnet snap
- **Print profiles** — page sizes (A4, A3, A5, 20×20, 30×30, custom mm), portrait/landscape, margins, bleed, duplex; auto-save with discard support
- **Page types** — orientation tag, filter by format/status/content, preset library (25 portrait + 25 landscape layouts included)
- **Interactive preview** — swap/pan/zoom photos, WYSIWYG caption editor, add/remove/reorder pages, recalculate menu, 2-page spread view
- **Album divider pages** — fully customisable: text elements (title, subtitle, multi-line free text), GPS map, photo slot (zoom/pan with Ctrl+drag), separator lines; drag-to-reorder layers; preset save/load
- **GPS maps** — static map slots with configurable tile style, marker shape/colour/size, route; Stadia Maps or OSM fallback
- **Generation options** — duplicate removal (dHash + burst detection), quality filter, auto-captions toggle, named option presets
- **Projects** — save and resume named projects across sessions
- **Export** — PDF with bleed/crop marks, SVG ZIP with embedded photos; both respect pan/zoom/crop and caption styles
- **Localisation** — Italian and English built-in

---

## Installation

### Prerequisites

- Docker and Docker Compose
- A running [Immich](https://immich.app) instance (v1.91+)
- Immich API key with: **Asset: Read**, **Asset: View**, **Asset: Update**, **Album: Read**, **Person: Read**

### Option A — Pre-built image (recommended)

```bash
curl -O https://raw.githubusercontent.com/romaruss/ImmichPhotoBook/main/docker-compose.hub.yml
# edit the file to set your environment variables
docker compose -f docker-compose.hub.yml up -d
```

Open: `http://your-server-ip:7180`

### Option B — Build from source

```bash
git clone https://github.com/romaruss/ImmichPhotoBook.git
cd ImmichPhotoBook
cp .env.example .env   # edit values
docker compose up -d --build
```

### Connect to Immich's Docker network (optional)

If both run on the same host, uncomment the `networks:` section in the compose file and set your Immich network name:

```yaml
networks:
  immich_net:
    name: immich_default   # find with: docker network ls | grep immich
    external: true
```

Then use `http://immich_server:2283` as the Immich URL in Configuration.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PHOTOBOOK_PORT` | `7180` | Host port |
| `PHOTOBOOK_TOKEN` | *(empty)* | Access token — leave empty to disable auth |
| `STADIA_MAPS_API_KEY` | *(empty)* | For Stadia Maps tile styles (optional, OSM fallback if absent) |
| `TZ` | `Europe/Rome` | Timezone |

### Persistent data

Data is stored in a Docker volume mounted at `/data` inside the container. To use a custom host path, set `DATA_PATH` in `.env` and switch to the bind-mount line in the compose file.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Not connected | Check Immich URL and API key in Configuration |
| Albums not loading | Verify Immich is reachable from the container |
| Caption sync fails (403) | API key needs Asset: Update permission |
| Map not showing | No GPS data in photos, or no internet access for tiles |

```bash
docker logs photobook-studio -f
```

---

## License

[MIT](LICENSE) — free to use, modify and distribute.

---

<div align="center">

## ☕ Support this project

<a href="https://paypal.me/@piercrup">
  <img src="https://img.shields.io/badge/PayPal-Buy%20me%20a%20coffee-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal"/>
</a>

**⭐ If PhotoBook Studio is useful, please star this repo!**

Made with ❤️ and 🤖 Claude AI

</div>
