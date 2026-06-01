<div align="center">

# 📖 PhotoBook Studio

**Self-hosted web app for creating print-ready photobooks from your photo library**

[![ghcr.io](https://img.shields.io/badge/ghcr.io-romaruss%2FImmichPhotoBook-2496ED?logo=docker&logoColor=white)](https://github.com/romaruss/ImmichPhotoBook/pkgs/container/immichphotobook)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![AI Generated](https://img.shields.io/badge/Built%20with-Claude%20AI-orange)](https://claude.ai)

---

> 🤖 **Entirely designed and coded with [Claude AI](https://claude.ai) (Anthropic).**

🎭 **[Try the live demo](https://photobook-studio-production.up.railway.app)** — sample data, no Immich needed

</div>

---

## How it works

PhotoBook Studio reads your photos from [Immich](https://immich.app) or a local folder, and lets you compose a photobook through an interactive browser-based editor. It uses photo metadata (GPS, EXIF, descriptions, faces) to auto-generate smart layouts. When done, it exports a print-ready PDF or an editable SVG ZIP.

```
Configuration → Print profile → Generate layout → Edit preview → Export PDF / SVG
```

---

## Main features

- **Dual photo source** — connect to Immich (albums, faces, GPS, favourites) or use a local folder
- **Smart layout** — automatic grouping by time/event, face-aware crop, GPS cluster maps
- **Photo badges** — configurable date/location overlay per photo
- **Event caption pages** — auto-fills caption slot per event with date range and GPS location
- **Print profiles** — A4/A3/A5/20×20/30×30/custom, portrait/landscape, margins, bleed; preset save/load
- **Page type editor** — drag-to-resize slots, snap, 50 built-in layouts
- **Interactive preview** — swap/pan/zoom photos, inline captions, 2-page spread, add/remove/reorder pages
- **Cover & dividers** — front/back/spine editor, album dividers with GPS map and photo slots
- **GPS maps** — Stadia Maps or OpenStreetMap fallback
- **Export** — PDF (DPI 150–600, colour profiles, crop marks) or SVG ZIP
- **Projects** — save and resume named projects
- **Localisation** — Italian and English

---

## Installation

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
| `STADIA_MAPS_API_KEY` | *(empty)* | Stadia Maps tile styles (optional, OSM fallback if absent) |
| `TZ` | `Europe/Rome` | Timezone |
| `DEMO_MODE` | *(empty)* | Set to `true` to run with built-in sample data (no Immich needed) |
| `PHOTOBOOK_DEV` | *(empty)* | Set to `true` to show the advanced config (Deep Config) menu |

Persistent data is stored in a Docker volume mounted at `/data` inside the container.

### Using a local folder as photo source

In Configuration, switch source to **Local folder** and set the path (default `/data/local_photos`). Each subfolder becomes an album. Mount your photos into the container via the compose file:

```yaml
volumes:
  - /your/photos:/data/local_photos:ro
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Not connected to Immich | Check URL and API key in Configuration |
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
