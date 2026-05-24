# Deployment

This page covers all supported deployment methods for PhotoBook Studio: Docker Compose (recommended for self-hosted), pre-built image from GitHub Container Registry, building from source, Railway.app cloud deployment, Immich network integration, and volume management.

---

## Table of Contents

- [Docker Compose — Standard Self-Hosted](#docker-compose--standard-self-hosted)
- [Pre-Built Image from GHCR](#pre-built-image-from-ghcr)
- [Build from Source](#build-from-source)
- [Railway.app Deployment](#railwayapp-deployment)
- [Connecting to the Immich Network](#connecting-to-the-immich-network)
- [Volume and Data Persistence](#volume-and-data-persistence)
- [Reverse Proxy (HTTPS)](#reverse-proxy-https)
- [Upgrade Procedure](#upgrade-procedure)

---

## Docker Compose — Standard Self-Hosted

This is the recommended deployment for home servers and self-hosted setups.

### Minimal `docker-compose.yml`

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    container_name: photobook
    restart: unless-stopped
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
    environment:
      - TZ=Europe/Rome

volumes:
  photobook_data:
```

Start with:

```bash
docker compose up -d
```

Open `http://<host-ip>:7180` and configure your Immich connection.

### Full `docker-compose.yml` with All Options

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    container_name: photobook
    restart: unless-stopped
    ports:
      - "${PHOTOBOOK_PORT:-7180}:8000"
    volumes:
      - photobook_data:/data
    environment:
      - TZ=Europe/Rome
      - PHOTOBOOK_TOKEN=your_secret_token
      - STADIA_MAPS_API_KEY=your_stadia_key
      - DEMO_MODE=false
    networks:
      - photobook_net
      - immich_default     # optional: join Immich's Docker network

networks:
  photobook_net:
  immich_default:
    external: true         # reference the Immich compose network

volumes:
  photobook_data:
```

See [Connecting to the Immich Network](#connecting-to-the-immich-network) for details on the `immich_default` network.

### Using an `.env` File

Create a `.env` file next to `docker-compose.yml`:

```dotenv
PHOTOBOOK_PORT=7180
PHOTOBOOK_TOKEN=mysecrettoken
STADIA_MAPS_API_KEY=your_stadia_key
TZ=Europe/Rome
```

Docker Compose reads `.env` automatically.

---

## Pre-Built Image from GHCR

The pre-built Docker image is published to the GitHub Container Registry:

```
ghcr.io/romaruss/photobook-studio:latest
```

**Available tags:**

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release |
| `0.9.8` | Specific version (replace with desired version) |

Pull the image manually:

```bash
docker pull ghcr.io/romaruss/photobook-studio:latest
```

The image is a multi-arch image supporting `linux/amd64` and `linux/arm64` (for Raspberry Pi 4+ and Apple Silicon NAS devices).

---

## Build from Source

Use this method if you need a custom build (e.g. adding backend libraries, patching code, or building for an unsupported architecture).

### Prerequisites

- Docker with BuildKit enabled (Docker 24+ has BuildKit on by default)
- Internet access for `pip install` and `npm install` during build

### Steps

1. **Clone the repository:**

```bash
git clone https://github.com/romaruss/photobook-studio.git
cd photobook-studio
```

2. **Build the image:**

```bash
docker build -t photobook-studio:local .
```

The `Dockerfile` performs a multi-stage build:

```
Stage 1 (node:18-alpine):
  COPY frontend/ .
  RUN npm ci && npm run build
  → outputs frontend/dist/

Stage 2 (python:3.12-slim):
  COPY backend/ .
  COPY --from=stage1 frontend/dist/ ./frontend/dist/
  RUN pip install -r requirements.txt
  CMD uvicorn main:app --host 0.0.0.0 --port 8000
```

3. **Run the locally built image:**

```bash
docker run -d \
  --name photobook \
  -p 7180:8000 \
  -v photobook_data:/data \
  -e TZ=Europe/Rome \
  photobook-studio:local
```

4. **Use in docker-compose.yml** by replacing `image:` with `build:`:

```yaml
services:
  photobook:
    build: .          # build from local Dockerfile
    # image: ...      # remove or comment out
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
```

---

## Railway.app Deployment

PhotoBook Studio supports one-click deployment on [Railway.app](https://railway.app).

### Setup

1. **Fork or clone** the repository to your GitHub account
2. In Railway, click **New Project → Deploy from GitHub repo**
3. Select your fork
4. Railway detects the `railway.toml` at the repository root and configures the service automatically

### `railway.toml`

The `railway.toml` configures the Railway build and deploy:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
```

Railway automatically injects the `PORT` environment variable; the start command uses `$PORT` so the app binds to the correct port.

### Volume on Railway

Railway provides persistent volumes via the **Volumes** tab in the service settings:

1. Go to your service → **Volumes**
2. Click **Add Volume**
3. Mount path: `/data`

Without a volume, `/data/` is ephemeral and all profiles, projects, and exports are lost on redeploy.

### Environment Variables on Railway

Set these in the **Variables** tab:

| Variable | Recommended |
|----------|------------|
| `TZ` | Your timezone |
| `PHOTOBOOK_TOKEN` | A strong secret |
| `STADIA_MAPS_API_KEY` | Stadia Maps key (optional) |
| `DEMO_MODE` | `true` for a public demo instance |

Do **not** set `PORT` manually — Railway manages it.

### Custom Domain on Railway

Go to your service → **Settings → Domains** to add a custom domain or use the Railway-provided subdomain (`*.railway.app`). HTTPS is automatic via Railway's edge proxy.

---

## Connecting to the Immich Network

If Immich and PhotoBook Studio run on the **same Docker host**, you can connect them via a shared Docker network instead of using the host's IP address. This avoids the need to expose Immich's port to the host network.

### Step 1: Identify the Immich Network

```bash
docker network ls | grep immich
```

The Immich Compose stack typically creates a network named `immich_default`.

### Step 2: Join the Network in PhotoBook Compose

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    networks:
      - photobook_net
      - immich_default      # join the shared network

networks:
  immich_default:
    external: true          # this network is managed by the Immich compose stack

  photobook_net:
```

### Step 3: Use the Immich Container Name as Host

In PhotoBook Studio's **Config** page, set the Immich URL using the Immich container name:

```
http://immich_server:3001
```

Replace `immich_server` with the actual Immich service/container name (check with `docker ps`).

### Security Benefit

When using an internal Docker network, Immich's port is not exposed on the host. PhotoBook Studio is the only service with network-level access.

---

## Volume and Data Persistence

All PhotoBook Studio persistent data is stored in the `/data/` volume:

```
/data/
├── config.json         Immich URL and API key
├── deep_config.json    Algorithm parameter overrides
├── profiles/           Print profiles (one UUID.json per profile)
├── projects/           Saved books (one UUID.json per project)
├── exports/            Generated PDFs and SVG ZIPs
├── cache/              Thumbnail proxy cache
└── presets/            Generation config presets
```

### Backup

Back up the `/data/` directory to protect your profiles and projects:

```bash
# Using docker cp (container must be running)
docker cp photobook:/data ./photobook-backup-$(date +%Y%m%d)

# Or back up the named volume directly
docker run --rm \
  -v photobook_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/photobook-data-$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
docker run --rm \
  -v photobook_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/photobook-data-20240315.tar.gz -C /
```

### Export Retention

The `/data/exports/` directory accumulates generated PDFs and SVG ZIPs. These are not automatically cleaned up. To free disk space:

```bash
# Remove exports older than 7 days
find /path/to/photobook_data/exports -mtime +7 -delete
```

Or access the exports directory in the container:

```bash
docker exec photobook find /data/exports -mtime +7 -delete
```

---

## Reverse Proxy (HTTPS)

For production deployments, always place PhotoBook Studio behind a reverse proxy that handles TLS termination.

### Nginx Example

```nginx
server {
  listen 443 ssl;
  server_name photobook.example.com;

  ssl_certificate     /etc/letsencrypt/live/photobook.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/photobook.example.com/privkey.pem;

  client_max_body_size 50m;   # allow large PDF requests

  location / {
    proxy_pass         http://localhost:7180;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_buffering    off;   # important: streaming PDF responses
    proxy_read_timeout 120s;  # allow time for large PDF generation
  }
}
```

### Caddy Example

```
photobook.example.com {
  reverse_proxy localhost:7180 {
    transport http {
      read_timeout 120s
    }
  }
}
```

**Important:** Set `proxy_buffering off` (Nginx) or equivalent. PDF export is a streaming response, and response buffering will delay or break the download.

---

## Upgrade Procedure

### Standard Docker Compose Upgrade

```bash
# Pull the latest image
docker compose pull

# Recreate the container
docker compose up -d --force-recreate
```

This replaces the container while keeping the named volume intact. Your profiles, projects, and config are preserved.

### Specific Version Upgrade

To pin to a specific version:

```yaml
image: ghcr.io/romaruss/photobook-studio:0.9.8
```

Then change the tag and run `docker compose up -d`.

### Post-Upgrade Checks

1. Open `http://<host>:7180/api/health` and verify the `version` field shows the new version
2. Check the **Config** page — your Immich URL should still be populated
3. Check the **Profiles** page — all profiles should be present
4. Run a test generation to confirm the layout engine works correctly
5. Check `/data/deep_config.json` if you had custom algorithm parameters — new parameters added in the new version will appear with their defaults automatically (no migration needed)

### Rollback

```bash
# Stop current container
docker compose down

# Edit docker-compose.yml to pin the previous version tag
# e.g. image: ghcr.io/romaruss/photobook-studio:0.9.6

docker compose up -d
```

The `/data/` volume is unchanged by a rollback; all user data is preserved.
