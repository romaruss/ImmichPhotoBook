# PhotoBook Studio

A self-hosted web application for creating professional print-ready photobooks from your Immich library

---

This project was entirely designed and coded with the assistance of Claude AI (Anthropic).
From architecture to every line of code, AI was the co-pilot throughout the development process.

---

Features | Installation | Configuration | Usage | Export | Contributing

---

## Features

### Immich integration
- Connects directly to your Immich instance via API key
- Browses all albums, shows thumbnails and metadata
- Reads GPS coordinates, descriptions and face data from Immich

### Layout engine
- Smart Layout: analyses photo quality, groups shots into time events, detects face regions, selects the optimal template per group, puts favourite photos on full-page spreads.
- Manual layout: use custom print profiles with 20+ built-in page templates.
- Face-aware crop: automatically centres the initial crop on detected faces; never cuts through them.
- Duplicate detection and quality filtering (configurable).

### Print profiles
- Page sizes: A4, A3, A5, 20x20, 20x30, 30x30, 30x40, Letter, Custom (mm)
- Portrait / Landscape orientation
- Adjustable margins, gutter spacing, bleed area with crop marks
- Duplex printing support
- Custom grid creator and drag-to-resize slot editor in the browser

### Interactive preview
- Page-by-page preview, keyboard navigation (Left/Right arrows)
- Drag photos between slots to swap
- Drag gold dividers to resize slots live on the canvas
- Pan & zoom photos within their slot (mouse drag + scroll wheel)
- Portrait/landscape mismatch detection (red border) with guided reposition
- Add / edit / remove captions inline
- Right-side album browser: usage status (used / repeated / unused), click to navigate to page
- Full Recalculate menu: from this page, this page only, compress, optimise orientation, reorder by date, add unused, full reset.

### Projects
- Save and load multiple named projects
- All page edits, pan/zoom transforms and layout state are persisted
- Resume work across sessions

### Export
- PDF: print-ready with embedded photos, bleed, crop marks
- SVG ZIP: one SVG per page, editable in Illustrator, Inkscape, Scribus, InDesign (photos embedded as base64)

### Localisation
- Italian and English built-in (select in Configuration)
- Easily extensible: add a locale file + one line of code

---

## Installation

### Prerequisites
- Docker and Docker Compose installed on your server
- A running Immich instance
- An Immich API key (Account Settings -> API Keys)

### 1 - Clone and start
git clone https://github.com/romaruss/ImmichPhotoBook.git
cd photobook-studio
docker compose up -d --build

### 2 - Connect to Immich's Docker network
If both containers are on the same host, connect them internally:
# Find your Immich network name
docker network ls | grep immich

Edit docker-compose.yml and uncomment the networks: section:
services:
  photobook:
    networks:
      - immich_net
networks:
  immich_net:
    name: immich_default
    external: true

### 3 - Persistent data
Data is stored in Docker volume photobook_data at /data inside the container:
- config.json (Immich connection)
- profiles/ (Print profiles)
- projects/ (Saved photobook projects)
- smart_config.json (Smart Layout parameters)
- cache/ (Thumbnail cache)

---

## Configuration
Go to Configuration in the app:
- Immich URL: e.g. http://immich_server:2283
- API Key: From Immich settings
- Language: Italian or English

---

## Generate Map
register to https://client.stadiamaps.com and get an api key
add .env file with key 
STADIA_MAPS_API_KEY=XXXX

---

## Export formats
PDF: Standard print-ready PDF with crop marks.
SVG ZIP: Editable layers (background, photos, captions, cropmarks, guides).

---

## Tech stack
- Backend: Python 3.12, FastAPI, uvicorn
- PDF: ReportLab
- Images: Pillow (PIL)
- Maps: staticmap + OpenStreetMap
- Frontend: React 18, Vite
- Container: Docker multi-stage build

---

## License
MIT License - free to use, modify and distribute.

---

## About AI-assisted development
PhotoBook Studio was entirely designed and implemented through conversation with Claude AI (Anthropic). 
The project demonstrates what becomes possible when AI acts as a true engineering partner.
