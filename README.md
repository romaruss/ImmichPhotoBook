<div align="center">

# 📖 PhotoBook Studio

**A self-hosted web application for creating professional print-ready photobooks from your Immich library**

[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://hub.docker.com)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![AI Generated](https://img.shields.io/badge/Built%20with-Claude%20AI-orange)](https://claude.ai)

---

> 🤖 **This project was entirely designed and coded with the assistance of [Claude AI](https://claude.ai) (Anthropic).**  
> From architecture to every line of code, AI was the co-pilot throughout the development process.

---

**[Features](#-features) · [Installation](#-installation) · [Configuration](#-configuration) · [Usage](#-usage) · [Export](#-export-formats) · [Contributing](#-contributing)**

</div>

---

## ✨ Features

### 📸 Immich integration
- Connects directly to your **[Immich](https://immich.app)** instance via API key
- Browses all albums, shows thumbnails and metadata
- Reads GPS coordinates, descriptions and face data from Immich
- **Syncs captions back to Immich** as asset descriptions (`PUT /api/assets/{id}`)

### 🎨 Layout engine
- **✨ Smart Layout** — analyses photo quality, groups shots into time events, detects face regions, selects the optimal template per group, puts favourite (★) photos on full-page spreads
- **📖 Manual layout** — use custom print profiles with fully configurable page layouts
- **Face-aware crop** — automatically centres the initial crop on detected faces
- **Orientation matching** — portrait photos go into portrait slots, landscape into landscape
- Duplicate detection and quality filtering (configurable)

### 📐 Print profiles
- Page sizes: A4, A3, A5, 20×20, 20×30, 30×30, 30×40, Letter, **Custom (free mm dimensions)**
- Custom sizes are saved globally and available to all profiles
- Portrait / Landscape orientation
- Adjustable margins, gutter spacing, bleed area with crop marks
- Duplex printing support
- **Profile duplication** — clone any profile as a starting point
- **Caption style defaults** — font, size, colour, alignment, background per profile

### 🗂️ Page layout editor
- Visual drag-to-resize slot editor, per-slot independent borders
- 14 built-in presets (1–6 photos, hero, panoramic, portrait-centred…)
- **Custom layout builder** — define rows × columns, then fine-tune proportions visually
- Magnet snapping (optional) — align borders automatically on release
- Adapts canvas orientation to the profile setting (portrait/landscape)

### 🖼️ Interactive preview
- **Single page** or **two-page spread** view (even page left, odd page right)
- Page-by-page navigation with keyboard arrows (← →)
- Drag photos between slots to swap
- Drag gold dividers to resize slots live
- Pan & zoom photos within their slot (mouse drag + scroll wheel)
- Portrait/landscape mismatch detection (red border) with guided reposition
- **WYSIWYG caption editor** — font size, bold/italic, text colour, background, horizontal and vertical alignment, all editable inline with a floating toolbar
- Right-side album browser: usage status, filter by status, drag to slot

### 📄 Page management
- **Add** a blank page anywhere in the album (after any page, or at the end)
- **Remove** pages with confirmation
- **Reorder** pages by dragging in the sidebar

### 🔄 Recalculate menu (7 options)
- From this page onwards — locks reviewed pages, recalculates the rest
- This page only
- Compress empty pages
- Optimise orientation (swap photos to best match slots)
- Reorder by date
- Insert unused photos
- Full reset (with confirmation)

### 💾 Projects
- Save and load multiple named projects
- All page edits, pan/zoom transforms and layout state are persisted
- Resume work across sessions

### 📄 Export
- **PDF** — print-ready with embedded photos, bleed, crop marks
- **SVG ZIP** — one SVG per page, editable in Illustrator, Inkscape, Scribus, InDesign (photos embedded as base64)

### 🌍 Localisation
- Italian 🇮🇹 and English 🇬🇧 built-in (select in Configuration)
- Easily extensible: add a locale file and one line of code

---

## 🚀 Installation

### Prerequisites
- Docker and Docker Compose installed on your server
- A running **[Immich](https://immich.app)** instance (v1.91+)
- An Immich API key with **Asset: Read** and **Asset: Update** permissions  
  *(Account Settings → API Keys)*

### 1 — Clone and start

```bash
git clone https://github.com/romaruss/ImmichPhotoBook.git
cd photobook-studio

docker compose up -d --build
```

First build takes a few minutes (downloads base images, compiles the React frontend). Open the app at:

```
http://your-server-ip:8080
```

### 2 — Connect to Immich's Docker network

If both containers are on the same Docker host, connect them so you can use the container name as hostname:

```bash
# Find your Immich network name
docker network ls | grep immich
# e.g.: immich_default
```

Edit `docker-compose.yml` and uncomment the `networks:` section:

```yaml
services:
  photobook:
    networks:
      - immich_net

networks:
  immich_net:
    name: immich_default    # ← replace with your network name
    external: true
```

Then restart: `docker compose up -d`

Use `http://immich_server:2283` (container name) as the Immich URL in the app.

### 3 — Change the host port

```yaml
ports:
  - "9090:8000"   # host port : container port
```

### Persistent data

All data is stored in Docker volume `photobook_data` at `/data` inside the container:

```
/data/
├── config.json          # Immich connection
├── profiles/            # Print profiles (JSON files)
├── projects/            # Saved photobook projects
├── custom_sizes.json    # Global custom page sizes
├── smart_config.json    # Smart Layout engine parameters
└── cache/               # Thumbnail cache from Immich
```

To use a host path instead:

```yaml
volumes:
  - /your/host/path:/data
```

---

## ⚙️ Configuration

Go to **Configuration** in the app:

| Setting | Description |
|---|---|
| Immich URL | Internal URL, e.g. `http://immich_server:2283` |
| API Key | From Immich → Account Settings → API Keys |
| Language | Italian 🇮🇹 or English 🇬🇧 |

Click **Test connection** to verify. The sidebar shows the connection status at all times.

---

<<<<<<< HEAD
## 📋 Usage

```
1. Configuration  →  Immich URL + API key
         ↓
2. Print profiles →  Create profile: page size, margins, bleed, page layouts, caption style
         ↓
3. Albums         →  Select album + profile
                     Click ✨ Smart Layout or 📖 Manual layout
         ↓
4. Preview        →  Browse with ← → (or sidebar)
                     Swap photos, resize slots, edit captions
                     Add / remove / reorder pages
                     Recalculate menu for redistribution
         ↓
5. Export         →  PDF (print shop ready) or SVG ZIP (editable)
```
=======
## Generate Map
register to https://client.stadiamaps.com and get an api key
add .env file with key 
STADIA_MAPS_API_KEY=XXXX

---

## Export formats
PDF: Standard print-ready PDF with crop marks.
SVG ZIP: Editable layers (background, photos, captions, cropmarks, guides).
>>>>>>> 4571901e3d6b3eaab6990a2e288b1434646fda98

---

## 📄 Export formats

### PDF
Standard print-ready PDF with crop marks when bleed is enabled. Photos embedded at preview quality. Title page with GPS map (OpenStreetMap tiles, PIL fallback).

### SVG ZIP

| Application | How to open |
|---|---|
| Adobe Illustrator | File → Open |
| Inkscape (free) | File → Open |
| Scribus (free) | File → Import → Get SVG |
| InDesign | File → Place |

Photos are embedded as base64 — files are fully self-contained.

---

## 🛠️ Development

### Run without Docker

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

Vite proxies `/api/*` to `localhost:8000` automatically.

### Project structure

```
photobook-studio/
├── backend/
│   ├── main.py              # FastAPI app, all endpoints
│   ├── immich_client.py     # Immich API wrapper (read + update descriptions)
│   ├── layout_engine.py     # Manual layout with orientation matching
│   ├── smart_layout.py      # Smart layout (quality, clustering, faces)
│   ├── pdf_generator.py     # PDF generation (ReportLab)
│   ├── svg_exporter.py      # SVG export
│   ├── map_generator.py     # GPS map image (OSM + PIL fallback)
│   └── requirements.txt
├── frontend/src/
│   ├── i18n.jsx             # Localisation provider + useT() hook
│   ├── locales/
│   │   ├── it.js            # Italian strings
│   │   └── en.js            # English strings
│   ├── pages/
│   │   ├── ConfigPage.jsx
│   │   ├── ProfilesPage.jsx  # Profiles + custom sizes + caption style
│   │   ├── AlbumsPage.jsx
│   │   └── PreviewPage.jsx   # Main editor
│   └── components/
│       └── PageTypeEditor.jsx  # Visual slot editor with magnet
├── Dockerfile
├── docker-compose.yml
└── README.md
```

### Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn |
| PDF | ReportLab |
| Images | Pillow (PIL) |
| Maps | staticmap + OpenStreetMap / PIL fallback |
| Frontend | React 18, Vite |
| Routing | React Router v6 |
| HTTP | Axios |
| Container | Docker multi-stage build |

---

## 🤝 Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'Add: my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

### Adding a language

1. Copy `frontend/src/locales/en.js` → `frontend/src/locales/de.js`
2. Translate all string values (keep key names unchanged)
3. Register in `frontend/src/i18n.jsx`:

```js
import de from './locales/de.js'
export const LOCALES = {
  it: { label: 'Italiano', dict: it },
  en: { label: 'English',  dict: en },
  de: { label: 'Deutsch',  dict: de },
}
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---|---|
| "Not connected" in sidebar | Check Immich URL and API key in Configuration |
| Albums not loading | Verify Immich is reachable from the container |
| Caption sync fails (403) | API key needs **Asset: Update** permission in Immich settings |
| Photos missing in PDF | Thumbnail timeout — retry export |
| Map not showing | No GPS data in photos, or OSM tiles unavailable |
| Build error | Ensure Docker has internet access during first build |

```bash
# View live logs
docker logs photobook-studio -f
```

---

## 📜 License

[MIT License](LICENSE) — free to use, modify and distribute for any purpose.

---

## 🤖 About AI-assisted development

> *"The best tool is the one that lets you build what you imagine."*

PhotoBook Studio was **entirely designed and implemented through conversation with [Claude AI](https://claude.ai)** (Anthropic's Claude Sonnet model).

Every component — from the system architecture, to the PDF generation pipeline, to the smart layout engine with face detection, to the interactive preview editor, to this README — was developed through iterative dialogue. No code was written by hand.

This project demonstrates what becomes possible when AI acts as a true engineering partner: handling implementation complexity so the creator can focus entirely on what the software should *do* and *feel like*.

---

<div align="center">

## ☕ Support this project

If PhotoBook Studio saves you time or makes your photobooks better, consider buying me a coffee!

<a href="https://paypal.me/@piercrup">
  <img src="https://img.shields.io/badge/PayPal-Buy%20me%20a%20coffee-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal"/>
</a>

*Every contribution helps keep the project alive. Thank you! 🙏*

---

**⭐ If PhotoBook Studio is useful, please star this repo — it helps others find it!**

Made with ❤️ and 🤖 Claude AI

</div>