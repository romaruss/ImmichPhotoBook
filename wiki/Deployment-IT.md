# Deployment

Questa pagina copre tutti i metodi di deployment supportati per PhotoBook Studio: Docker Compose (consigliato per self-hosted), immagine pre-costruita da GitHub Container Registry, build da sorgente, deployment cloud Railway.app, integrazione rete Immich e gestione volumi.

---

## Indice

- [Docker Compose — Self-Hosted Standard](#docker-compose--self-hosted-standard)
- [Immagine Pre-Costruita da GHCR](#immagine-pre-costruita-da-ghcr)
- [Build da Sorgente](#build-da-sorgente)
- [Deployment su Railway.app](#deployment-su-railwayapp)
- [Connessione alla Rete Immich](#connessione-alla-rete-immich)
- [Volume e Persistenza dei Dati](#volume-e-persistenza-dei-dati)
- [Reverse Proxy (HTTPS)](#reverse-proxy-https)
- [Procedura di Aggiornamento](#procedura-di-aggiornamento)

---

## Docker Compose — Self-Hosted Standard

Questo è il deployment consigliato per home server e setup self-hosted.

### `docker-compose.yml` Minimale

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

Avvia con:

```bash
docker compose up -d
```

Apri `http://<ip-host>:7180` e configura la connessione Immich.

### `docker-compose.yml` Completo con Tutte le Opzioni

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
      - PHOTOBOOK_TOKEN=il_tuo_token_segreto
      - STADIA_MAPS_API_KEY=la_tua_chiave_stadia
      - DEMO_MODE=false
    networks:
      - photobook_net
      - immich_default     # opzionale: unisciti alla rete Docker di Immich

networks:
  photobook_net:
  immich_default:
    external: true         # riferimento alla rete del compose Immich

volumes:
  photobook_data:
```

Vedi [Connessione alla Rete Immich](#connessione-alla-rete-immich) per i dettagli sulla rete `immich_default`.

### Uso di un File `.env`

Crea un file `.env` accanto a `docker-compose.yml`:

```dotenv
PHOTOBOOK_PORT=7180
PHOTOBOOK_TOKEN=ilmiotokensegreto
STADIA_MAPS_API_KEY=la_tua_chiave_stadia
TZ=Europe/Rome
```

Docker Compose legge `.env` automaticamente.

---

## Immagine Pre-Costruita da GHCR

L'immagine Docker pre-costruita è pubblicata nel GitHub Container Registry:

```
ghcr.io/romaruss/photobook-studio:latest
```

**Tag disponibili:**

| Tag | Descrizione |
|-----|-------------|
| `latest` | Release stabile più recente |
| `0.9.8` | Versione specifica (sostituire con la versione desiderata) |

Scarica l'immagine manualmente:

```bash
docker pull ghcr.io/romaruss/photobook-studio:latest
```

L'immagine è multi-arch e supporta `linux/amd64` e `linux/arm64` (per Raspberry Pi 4+ e NAS Apple Silicon).

---

## Build da Sorgente

Usa questo metodo se hai bisogno di una build personalizzata (es. aggiungere librerie backend, applicare patch al codice o build per architetture non supportate).

### Prerequisiti

- Docker con BuildKit abilitato (Docker 24+ ha BuildKit attivo di default)
- Accesso Internet per `pip install` e `npm install` durante la build

### Passi

1. **Clona il repository:**

```bash
git clone https://github.com/romaruss/photobook-studio.git
cd photobook-studio
```

2. **Costruisci l'immagine:**

```bash
docker build -t photobook-studio:local .
```

Il `Dockerfile` esegue un build multi-stage:

```
Stage 1 (node:18-alpine):
  COPY frontend/ .
  RUN npm ci && npm run build
  → produce frontend/dist/

Stage 2 (python:3.12-slim):
  COPY backend/ .
  COPY --from=stage1 frontend/dist/ ./frontend/dist/
  RUN pip install -r requirements.txt
  CMD uvicorn main:app --host 0.0.0.0 --port 8000
```

3. **Esegui l'immagine locale:**

```bash
docker run -d \
  --name photobook \
  -p 7180:8000 \
  -v photobook_data:/data \
  -e TZ=Europe/Rome \
  photobook-studio:local
```

4. **Uso in docker-compose.yml** sostituendo `image:` con `build:`:

```yaml
services:
  photobook:
    build: .          # build dal Dockerfile locale
    # image: ...      # rimuovere o commentare
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
```

---

## Deployment su Railway.app

PhotoBook Studio supporta il deployment one-click su [Railway.app](https://railway.app).

### Configurazione

1. **Fai fork o clona** il repository nel tuo account GitHub
2. In Railway, clicca **New Project → Deploy from GitHub repo**
3. Seleziona il tuo fork
4. Railway rileva il `railway.toml` nella root del repository e configura il servizio automaticamente

### `railway.toml`

Il `railway.toml` configura la build e il deploy su Railway:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "sh -c 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}'"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
```

Railway inietta automaticamente la variabile d'ambiente `PORT`; il comando di avvio usa `${PORT:-8000}` tramite wrapper `sh -c` per garantire l'espansione corretta della variabile shell.

### Volume su Railway

Railway fornisce volumi persistenti tramite il tab **Volumes** nelle impostazioni del servizio:

1. Vai al servizio → **Volumes**
2. Clicca **Add Volume**
3. Mount path: `/data`

Senza un volume, `/data/` è effimero e tutti i profili, progetti ed export vengono persi ad ogni redeploy.

### Variabili d'Ambiente su Railway

Imposta queste nel tab **Variables**:

| Variabile | Consigliato |
|-----------|------------|
| `TZ` | Il tuo fuso orario |
| `PHOTOBOOK_TOKEN` | Un segreto robusto |
| `STADIA_MAPS_API_KEY` | Chiave Stadia Maps (opzionale) |
| `DEMO_MODE` | `true` per un'istanza demo pubblica |
| `PHOTOBOOK_DEV` | `true` per abilitare Advanced Config e Layout Log (modalità sviluppatore) |

**Non** impostare `PORT` manualmente — Railway lo gestisce.

### Dominio Personalizzato su Railway

Vai al servizio → **Settings → Domains** per aggiungere un dominio personalizzato o usa il sottodominio fornito da Railway (`*.railway.app`). HTTPS è automatico tramite il proxy edge di Railway.

---

## Connessione alla Rete Immich

Se Immich e PhotoBook Studio girano sullo **stesso host Docker**, puoi collegarli tramite una rete Docker condivisa invece di usare l'IP dell'host. Questo evita la necessità di esporre la porta di Immich alla rete host.

### Step 1: Identifica la Rete Immich

```bash
docker network ls | grep immich
```

Lo stack Compose di Immich crea tipicamente una rete chiamata `immich_default`.

### Step 2: Unisciti alla Rete nel Compose di PhotoBook

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    networks:
      - photobook_net
      - immich_default      # unisciti alla rete condivisa

networks:
  immich_default:
    external: true          # questa rete è gestita dallo stack compose di Immich

  photobook_net:
```

### Step 3: Usa il Nome Container di Immich come Host

Nella pagina **Config** di PhotoBook Studio, imposta l'URL Immich usando il nome del container Immich:

```
http://immich_server:3001
```

Sostituisci `immich_server` con il nome effettivo del servizio/container Immich (verifica con `docker ps`).

### Vantaggio di Sicurezza

Usando una rete Docker interna, la porta di Immich non è esposta sull'host. PhotoBook Studio è l'unico servizio con accesso a livello di rete.

---

## Volume e Persistenza dei Dati

Tutti i dati persistenti di PhotoBook Studio sono conservati nel volume `/data/`:

```
/data/
├── config.json         URL e API key Immich
├── deep_config.json    Override parametri algoritmo
├── profiles/           Profili di stampa (un UUID.json per profilo)
├── projects/           Libri salvati (un UUID.json per progetto)
├── exports/            PDF e ZIP SVG generati
├── cache/              Cache proxy thumbnail
└── presets/            Preset configurazione generazione
```

### Backup

Fai backup della directory `/data/` per proteggere profili e progetti:

```bash
# Usando docker cp (il container deve essere in esecuzione)
docker cp photobook:/data ./photobook-backup-$(date +%Y%m%d)

# Oppure backup diretto del volume named
docker run --rm \
  -v photobook_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/photobook-data-$(date +%Y%m%d).tar.gz /data
```

### Ripristino

```bash
docker run --rm \
  -v photobook_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/photobook-data-20240315.tar.gz -C /
```

### Retention degli Export

La directory `/data/exports/` accumula PDF e ZIP SVG generati. Non vengono puliti automaticamente. Per liberare spazio su disco:

```bash
# Rimuovi export più vecchi di 7 giorni
find /path/to/photobook_data/exports -mtime +7 -delete
```

Oppure accedi alla directory export nel container:

```bash
docker exec photobook find /data/exports -mtime +7 -delete
```

---

## Reverse Proxy (HTTPS)

Per deployment in produzione, metti sempre PhotoBook Studio dietro un reverse proxy che gestisce la terminazione TLS.

### Esempio Nginx

```nginx
server {
  listen 443 ssl;
  server_name photobook.example.com;

  ssl_certificate     /etc/letsencrypt/live/photobook.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/photobook.example.com/privkey.pem;

  client_max_body_size 50m;   # consenti richieste PDF grandi

  location / {
    proxy_pass         http://localhost:7180;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_buffering    off;   # importante: risposte PDF in streaming
    proxy_read_timeout 120s;  # tempo sufficiente per generazione PDF grandi
  }
}
```

### Esempio Caddy

```
photobook.example.com {
  reverse_proxy localhost:7180 {
    transport http {
      read_timeout 120s
    }
  }
}
```

**Importante:** Imposta `proxy_buffering off` (Nginx) o equivalente. L'export PDF è una risposta in streaming, e il buffering della risposta ritarderà o interromperà il download.

---

## Procedura di Aggiornamento

### Aggiornamento Standard Docker Compose

```bash
# Scarica l'immagine più recente
docker compose pull

# Ricrea il container
docker compose up -d --force-recreate
```

Questo sostituisce il container mantenendo intatto il volume named. Profili, progetti e configurazione vengono preservati.

### Aggiornamento a Versione Specifica

Per fissare una versione specifica:

```yaml
image: ghcr.io/romaruss/photobook-studio:0.9.8
```

Poi cambia il tag ed esegui `docker compose up -d`.

### Verifiche Post-Aggiornamento

1. Apri `http://<host>:7180/api/health` e verifica che il campo `version` mostri la nuova versione
2. Controlla la pagina **Config** — l'URL Immich deve essere ancora presente
3. Controlla la pagina **Profili** — tutti i profili devono essere presenti
4. Esegui una generazione di test per confermare che il layout engine funzioni correttamente
5. Controlla `/data/deep_config.json` se avevi parametri algoritmo personalizzati — i nuovi parametri aggiunti nella nuova versione appariranno con i loro default automaticamente (nessuna migrazione necessaria)

### Rollback

```bash
# Ferma il container attuale
docker compose down

# Modifica docker-compose.yml per fissare il tag versione precedente
# es. image: ghcr.io/romaruss/photobook-studio:0.9.6

docker compose up -d
```

Il volume `/data/` non viene modificato da un rollback; tutti i dati utente vengono preservati.
