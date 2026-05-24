# Development Guide

This page explains how to set up a local development environment, run the application for development, build the production Docker image, and extend the application with new features.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Repository Structure](#repository-structure)
- [Local Development Setup](#local-development-setup)
  - [Backend (FastAPI + uvicorn)](#backend-fastapi--uvicorn)
  - [Frontend (Vite dev server)](#frontend-vite-dev-server)
- [Running in Demo Mode Locally](#running-in-demo-mode-locally)
- [Building for Production (Docker)](#building-for-production-docker)
- [Adding a New Page Type (Slot Layout)](#adding-a-new-page-type-slot-layout)
- [Adding a New Locale String](#adding-a-new-locale-string)
- [Adding a New Deep Config Parameter](#adding-a-new-deep-config-parameter)
- [Code Style and Conventions](#code-style-and-conventions)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.12+ | Backend runtime |
| Node.js | 18+ | Frontend build |
| npm | 9+ | Frontend package manager |
| Docker | 24+ | Production build and container testing |
| Docker Compose | v2 | Local deployment |

Optional but recommended:
- A running Immich instance (or use Demo Mode for development)
- `httpie` or `curl` for API testing

---

## Repository Structure

```
photobook-app-test/
├── backend/               Python backend source
│   ├── main.py
│   ├── immich_client.py
│   ├── album_generator.py
│   ├── smart_layout.py
│   ├── layout_engine.py
│   ├── pdf_generator.py
│   ├── svg_exporter.py
│   ├── map_generator.py
│   ├── config_loader.py
│   ├── demo_data.py
│   ├── deep_config_defaults.json
│   ├── icc/               Bundled ICC profiles
│   └── requirements.txt
├── frontend/              React + Vite frontend source
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── locales/
│   │   ├── i18n.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── Dockerfile             Multi-stage build
├── docker-compose.yml     Standard local deployment
├── docker-compose.hub.yml Pre-built GHCR image deployment
└── railway.toml           Railway.app deployment config
```

---

## Local Development Setup

### Backend (FastAPI + uvicorn)

1. **Create and activate a virtual environment:**

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate      # Linux/macOS
# .venv\Scripts\activate       # Windows
```

2. **Install dependencies:**

```bash
pip install -r requirements.txt
```

3. **Create the data directory:**

```bash
mkdir -p /tmp/photobook-dev/data
```

4. **Start the backend:**

```bash
DATA_DIR=/tmp/photobook-dev/data \
DEMO_MODE=true \
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The `--reload` flag restarts the server on source file changes.

Key environment variables for development:

| Variable | Recommended dev value |
|----------|-----------------------|
| `DATA_DIR` | `/tmp/photobook-dev/data` |
| `DEMO_MODE` | `true` |
| `PHOTOBOOK_TOKEN` | *(empty — disable auth for dev)* |

The backend is now available at `http://localhost:8000`.

### Frontend (Vite dev server)

1. **Install Node dependencies:**

```bash
cd frontend
npm install
```

2. **Configure the API proxy:**

`frontend/vite.config.js` should already include a proxy that forwards `/api/` requests to the backend:

```js
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
}
```

3. **Start the Vite dev server:**

```bash
npm run dev
```

The frontend is available at `http://localhost:5173`. All API calls are proxied to the backend at port 8000.

Hot Module Replacement (HMR) is enabled: React component changes are reflected in the browser without a full reload.

---

## Running in Demo Mode Locally

For pure frontend development (no Immich, no data required):

```bash
# Terminal 1 — backend
cd backend && DEMO_MODE=true uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`. The app loads with four built-in demo albums and pre-installed profiles.

---

## Building for Production (Docker)

The `Dockerfile` uses a multi-stage build:

1. **Stage 1 — Node build**: installs npm dependencies and runs `npm run build` (Vite) to produce `frontend/dist/`
2. **Stage 2 — Python runtime**: copies `backend/` and `frontend/dist/` into a slim Python 3.12 image, installs `requirements.txt`, and starts uvicorn

```bash
# Build the image
docker build -t photobook-studio:local .

# Run the image
docker run -p 7180:8000 -v $(pwd)/dev-data:/data photobook-studio:local
```

To test demo mode with the built image:

```bash
docker run -p 7180:8000 -e DEMO_MODE=true photobook-studio:local
```

---

## Adding a New Page Type (Slot Layout)

Page types (slot layouts) are defined per-profile in the `page_types` array. They are not hardcoded in backend Python — the backend treats them as pure data. However, if you want to add a **built-in default page type** that appears in new profiles by default, update the default profile template in `main.py` (look for the profile initialisation logic in the `POST /api/profiles` route).

To add a custom page type to an existing profile **via the UI**: use the ProfilesPage slot editor (see [Print Profiles](Print-Profiles.md#the-profile-editor)).

To add a page type **programmatically** via the API:

1. `GET /api/profiles/{id}` to fetch the profile
2. Append to the `page_types` array:

```json
{
  "label": "3 landscape + caption",
  "slots": [
    {"x": 0,  "y": 0,  "w": 33, "h": 80, "type": "photo"},
    {"x": 33, "y": 0,  "w": 34, "h": 80, "type": "photo"},
    {"x": 67, "y": 0,  "w": 33, "h": 80, "type": "photo"},
    {"x": 0,  "y": 80, "w": 100,"h": 20, "type": "caption"}
  ]
}
```

3. `PUT /api/profiles/{id}` with the modified profile

---

## Adding a New Locale String

All user-facing text in the frontend must be localised. Never hardcode strings in JSX. This is a project convention enforced by code review.

### Steps

1. **Add the key and English string to `frontend/src/locales/en.js`:**

```js
// en.js
export default {
  // ... existing keys ...
  myNewFeature: {
    title: "My New Feature",
    description: "This feature does something useful."
  }
}
```

2. **Add the same key with the Italian translation to `frontend/src/locales/it.js`:**

```js
// it.js
export default {
  // ... existing keys ...
  myNewFeature: {
    title: "La Mia Nuova Funzione",
    description: "Questa funzione fa qualcosa di utile."
  }
}
```

3. **Use the key in your component via the `useI18n` hook:**

```jsx
import { useI18n } from '../i18n';

function MyComponent() {
  const t = useI18n();
  return <h1>{t.myNewFeature.title}</h1>;
}
```

### Rules

- Both `en.js` and `it.js` must contain exactly the same key tree — missing keys will cause runtime errors
- Use nested objects for grouping related strings (e.g. `profileEditor.save`, `profileEditor.delete`)
- Never use the raw string directly in JSX — always go through `t.key`

---

## Adding a New Deep Config Parameter

Deep Config parameters are algorithm tuning values surfaced to power users via the `/deep-config` UI.

### Steps

1. **Add the parameter with its default value to `backend/deep_config_defaults.json`:**

Find the appropriate section (e.g. `"quality"`, `"face"`, `"performance"`) or create a new section:

```json
{
  "quality": {
    "sharpness_variance_divisor": 500,
    "my_new_parameter": 42
  }
}
```

2. **Use the parameter in your backend code via `config_loader.py`:**

```python
from config_loader import get_deep_config

cfg = get_deep_config()
my_value = cfg["quality"]["my_new_parameter"]
```

3. **Add locale strings for the parameter label and description** (follow the [locale steps above](#adding-a-new-locale-string)):

```js
// en.js
deepConfig: {
  quality: {
    myNewParameter: {
      label: "My New Parameter",
      description: "Controls the behaviour of the new algorithm feature."
    }
  }
}
```

4. **The DeepConfigPage renders parameters dynamically** from the API response, so no JSX changes are needed — just adding the locale string ensures the label is correct.

5. **Document the parameter** in this wiki's [Configuration — Deep Config Sections Reference](Configuration.md#deep-config-sections-reference).

### Parameter Types

The deep config system infers UI control type from the JSON default value:
- `number` → numeric input with step controls
- `boolean` → toggle switch
- `string` → text input (used for color hex values etc.)

---

## Code Style and Conventions

### Python (backend)

- Type hints on all function signatures
- `async def` for all I/O-bound functions
- `snake_case` for variables, functions, and module names
- `PascalCase` for classes
- No unused imports (enforced by linting)

### JavaScript/React (frontend)

- Functional components only (no class components)
- `camelCase` for variables and functions
- `PascalCase` for component names and filenames
- Hooks: prefix with `use` (e.g. `useI18n`, `useProfiles`)
- Every user-visible string must go through the i18n system (see above)
- No hardcoded colors or sizes in JSX — use CSS variables or Tailwind classes

### Git Workflow

- Branch from `main` for features; branch from the relevant release branch for hotfixes
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.)
- All PRs require a passing Docker build before merging
