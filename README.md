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

## �?Features

### 📸 Immich integration
- Connects directly to your **Immich** instance via API key
- Browses all albums, shows thumbnails and metadata
- Reads GPS coordinates, descriptions and face data from Immich

### 🎨 Layout engine
- **�?Smart Layout** �?analyses photo quality, groups shots into time events, detects face regions, selects the optimal template per group, puts favourite (�? photos on full-page spreads
- **📖 Manual layout** �?use custom print profiles with 20+ built-in page templates
- **Face-aware crop** �?automatically centres the initial crop on detected faces; never cuts through them
- Duplicate detection and quality filtering (configurable)

### 📐 Print profiles
- Page sizes: A4, A3, A5, 20×20, 20×30, 30×30, 30×40, Letter, Custom (mm)
- Portrait / Landscape orientation
- Adjustable margins, gutter spacing, bleed area with crop marks
- Duplex printing support
- Custom grid creator and drag-to-resize slot editor in the browser

### 🖼�?Interactive preview
- Page-by-page preview, keyboard navigation (�?�?
- Drag photos between slots to swap
- Drag gold dividers to resize slots live on the canvas
- Pan & zoom photos within their slot (mouse drag + scroll wheel)
- Portrait/landscape mismatch detection (red border) with guided reposition
- Add / edit / remove captions inline
- Right-side album browser: usage status (used / repeated / unused), click to navigate to page
- Full **Recalculate** menu: from this page, this page only, compress, optimise orientation, reorder by date, add unused, full reset

### 💾 Projects
- Save and load multiple named projects
- All page edits, pan/zoom transforms and layout state are persisted
- Resume work across sessions

### 📄 Export
- **PDF** �?print-ready with embedded photos, bleed, crop marks
- **SVG ZIP** �?one SVG per page, editable in Illustrator, Inkscape, Scribus, InDesign (photos embedded as base64)

### 🌍 Localisation
- Italian 🇮🇹 and English 🇬🇧 built-in (select in Configuration)
- Easily extensible: add a locale file + one line of code

---

## 🚀 Installation

### Prerequisites
- Docker and Docker Compose installed on your server
- A running **[Immich](https://immich.app)** instance
- An Immich API key *(Account Settings �?API Keys)*

### 1 �?Clone and start

```bash
git clone https://github.com/romaruss/ImmichPhotoBook.git
cd photobook-studio

docker compose up -d --build
```

First build takes a few minutes (downloads base images, compiles the React frontend). Open the app at:

```
http://your-server-ip:8080
```

### 2 �?Connect to Immich's Docker network

If both containers are on the same host, connect them internally:

```bash
# Find your Immich network name
docker network ls | grep immich
# e.g.: immich_default
```

Edit `docker-compose.yml` and uncomment the `networks:` section:

```yaml
# docker-compose.yml
services:
  photobook:
    # ... existing config ...
    networks:
      - immich_net

networks:
  immich_net:
    name: immich_default    # �?replace with your network name
    external: true
```

Then restart:

```bash
docker compose up -d
```

Use `http://immich_server:2283` (container name) as the Immich URL in the app.

### 3 �?Change the port

```yaml
ports:
  - "9090:8000"   # host port : container port
```

### Persistent data

Data is stored in Docker volume `photobook_data` at `/data` inside the container:

```
/data/
├── config.json          # Immich connection
├── profiles/            # Print profiles
├── projects/            # Saved photobook projects
├── smart_config.json    # Smart Layout parameters
└── cache/               # Thumbnail cache
```

To bind-mount to a host path instead:

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
| API Key | From Immich �?Account Settings �?API Keys |
| Language | Italian 🇮🇹 or English 🇬🇧 |

Click **Test connection** to verify.

---

## 📋 Usage

```
1. Configuration  �? Immich URL + API key
         �?2. Print profiles �? Create profile (size, margins, bleed, page layouts)
         �?3. Albums         �? Select album + profile
                     Click �?Smart Layout or 📖 Manual layout
         �?4. Preview        �? Browse with �?�?keys
                     Swap photos, resize slots, edit captions
                     Recalculate menu for redistribution
         �?5. Export         �? PDF (print shop ready) or SVG ZIP (editable)
```

---

## 📄 Export formats

### PDF
Standard print-ready PDF with crop marks when bleed is enabled. Photos embedded at preview quality. Title page with GPS map (OpenStreetMap, PIL fallback).

### SVG ZIP

| Application | How to open |
|---|---|
| Adobe Illustrator | File �?Open |
| Inkscape (free) | File �?Open |
| Scribus (free) | File �?Import �?Get SVG |
| InDesign | File �?Place |

Named SVG layers: `background`, `photos`, `captions`, `cropmarks`, `guides` (hidden, toggleable).

---

## 🛠�?Development

### Run without Docker

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev        # �?http://localhost:5173
```

Vite proxies `/api/*` to `localhost:8000` automatically.

### Project structure

```
photobook-studio/
├── backend/
�?  ├── main.py              # FastAPI app, all endpoints
�?  ├── immich_client.py     # Immich API wrapper
�?  ├── layout_engine.py     # Manual layout algorithm
�?  ├── smart_layout.py      # Smart layout (quality, clustering, faces)
�?  ├── pdf_generator.py     # PDF generation (ReportLab)
�?  ├── svg_exporter.py      # SVG export
�?  ├── map_generator.py     # GPS map image
�?  └── requirements.txt
├── frontend/src/
�?  ├── i18n.jsx             # Localisation provider + useT() hook
�?  ├── locales/
�?  �?  ├── it.js            # Italian strings (~400 keys)
�?  �?  └── en.js            # English strings
�?  ├── pages/
�?  �?  ├── ConfigPage.jsx
�?  �?  ├── ProfilesPage.jsx
�?  �?  ├── AlbumsPage.jsx
�?  �?  └── PreviewPage.jsx  # Main editor (~1900 lines)
�?  └── components/
�?      └── PageTypeEditor.jsx
├── Dockerfile               # Multi-stage: Node build + Python runtime
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

1. Copy `frontend/src/locales/en.js` �?`frontend/src/locales/de.js`
2. Translate all string values (keep the key names unchanged)
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
| "Not connected" | Check URL and API key in Configuration |
| Albums not loading | Verify Immich is reachable from the container |
| Photos missing in PDF | Thumbnail timeout �?retry export |
| Map not showing | No GPS data in photos, or OSM tiles unavailable (PIL map is used) |
| Build error | Ensure Docker has internet access |
| `DATA_DIR not defined` on startup | Replace `backend/main.py` with the latest version |

```bash
# View live logs
docker logs photobook-studio -f
```

---

## 📜 License

[MIT License](LICENSE) �?free to use, modify and distribute for any purpose.

---

## 🤖 About AI-assisted development

> *"The best tool is the one that lets you build what you imagine."*

PhotoBook Studio was **entirely designed and implemented through conversation with [Claude AI](https://claude.ai)** (Anthropic's Claude Sonnet model).

The development process was a continuous dialogue: the human provided requirements, design decisions, and feedback; the AI proposed architectures, wrote every line of code, debugged issues, and refined features. No code was written by hand.

This project demonstrates what becomes possible when AI acts as a true engineering partner �?handling implementation complexity so the creator can focus entirely on what the software should *do* and *feel like*.

---

<div align="center">

## �?Support this project

If PhotoBook Studio is useful to you and saves you time, consider buying me a coffee!

<a href="https://paypal.me/piercrup">
  <img src="https://img.shields.io/badge/PayPal-Buy%20me%20a%20coffee-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal"/>
</a>

*Every contribution helps keep the project maintained and growing. Thank you! 🙏*

---

**�?If PhotoBook Studio is useful, please star this repo �?it helps others find it!**

Made with ❤️ and 🤖 Claude AI

</div>
