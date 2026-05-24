# Configurazione

Questa pagina tratta tutte le opzioni di configurazione di PhotoBook Studio: configurazione della connessione Immich, variabili d'ambiente, il sistema Deep Config per i parametri dell'algoritmo e l'autenticazione tramite token di accesso.

---

## Indice

- [Configurazione Connessione Immich](#configurazione-connessione-immich)
- [Permessi Immich Richiesti](#permessi-immich-richiesti)
- [Variabili d'Ambiente](#variabili-dambiente)
- [Configurazione Token Auth](#configurazione-token-auth)
- [Sistema Deep Config](#sistema-deep-config)
- [Riferimento Sezioni Deep Config](#riferimento-sezioni-deep-config)

---

## Configurazione Connessione Immich

Al primo avvio, vai alla pagina **Config** (icona ingranaggio o route `/config`). Inserisci:

| Campo | Descrizione |
|-------|-------------|
| **Immich URL** | URL base del tuo server Immich, inclusi protocollo e porta. Esempio: `http://192.168.1.10:2283` o `https://photos.example.com` |
| **API Key** | Una chiave API Immich con i permessi richiesti (vedi sotto) |

Fai clic su **Salva** poi su **Testa Connessione** per verificare la connettività. Il test di connessione chiama `GET /api/config/test` sul backend, che a sua volta chiama gli endpoint Immich `/api/server/ping` e `/api/auth/validateToken`.

La configurazione viene salvata in `/data/config.json`:

```json
{
  "immich_url": "http://192.168.1.10:2283",
  "api_key": "your_immich_api_key_here"
}
```

In **Modalità Demo**, la pagina config è comunque accessibile ma il test di connessione restituisce sempre `{connected: true, demo: true}` senza effettuare chiamate di rete.

---

## Permessi Immich Richiesti

Crea una chiave API dedicata in Immich (**Amministrazione → Chiavi API → Nuova Chiave API**) con questi permessi:

| Permesso | Necessario per |
|----------|---------------|
| `Asset:Read` | Recupero metadati asset, EXIF, dati volti |
| `Asset:View` | Download thumbnail e foto ad alta risoluzione per l'export |
| `Asset:Update` | Scrittura didascalie su Immich (sincronizzazione didascalie) — può essere omesso se la sincronizzazione non è necessaria |
| `Album:Read` | Elenco album e lettura contenuti degli album |
| `Person:Read` | Lettura dati riconoscimento facciale (bounding box persone/volti) |

Si raccomanda l'utilizzo di una chiave con permessi minimi per la sicurezza. Se non usi la sincronizzazione delle didascalie, ometti `Asset:Update`.

---

## Variabili d'Ambiente

Tutte le variabili d'ambiente possono essere impostate in `docker-compose.yml` sotto la chiave `environment:`, in `.env`, o come variabili d'ambiente di Railway/piattaforma.

| Variabile | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `PHOTOBOOK_PORT` | `7180` | Porta host usata nel mapping delle porte `docker-compose.yml`. Non influisce sulla porta uvicorn interna. |
| `PHOTOBOOK_TOKEN` | *(vuoto)* | Se impostato, abilita l'autenticazione bearer token per tutte le route `/api/*`. Lascia vuoto per disabilitare l'auth. |
| `STADIA_MAPS_API_KEY` | *(vuoto)* | Chiave API per il servizio tile Stadia Maps. Se vuoto, l'app usa la libreria staticmap basata su OpenStreetMap come fallback (nessuna chiave richiesta, ma latenza maggiore). |
| `TZ` | `Europe/Rome` | Timezone del container, usata per la formattazione delle date in titoli e pagine divisore. |
| `DEMO_MODE` | *(vuoto)* | Imposta a `true` per abilitare la modalità demo (album integrati, nessun server Immich richiesto). Vedi [Modalità Demo](Demo-Mode-IT.md). |
| `PORT` | `8000` | Porta di ascolto interna di uvicorn. Impostata automaticamente da Railway; non impostare manualmente a meno che non si abbia un motivo specifico. |

### Impostazione Variabili in Docker Compose

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    ports:
      - "${PHOTOBOOK_PORT:-7180}:8000"
    environment:
      - TZ=Europe/Rome
      - PHOTOBOOK_TOKEN=my_secret_token
      - STADIA_MAPS_API_KEY=your_stadia_key
      - DEMO_MODE=false
    volumes:
      - photobook_data:/data
```

### Impostazione Variabili su Railway

Vai al tuo servizio Railway → scheda **Variables** e aggiungi ogni variabile come coppia chiave-valore. Railway inietta automaticamente `PORT` — non sovrascriverla.

---

## Configurazione Token Auth

PhotoBook Studio include un'autenticazione bearer token opzionale per impedire l'accesso non autorizzato alla tua libreria fotografica.

### Abilitare l'Auth

Imposta la variabile d'ambiente `PHOTOBOOK_TOKEN` su qualsiasi stringa segreta:

```
PHOTOBOOK_TOKEN=super_secret_token_here
```

Quando impostato:

- Tutte le route `GET /api/*` e `POST /api/*` richiedono autenticazione
- Il frontend allega automaticamente il token all'intestazione di ogni richiesta API
- Le richieste non autenticate ricevono `HTTP 401 Unauthorized`

### Fornire il Token al Browser

Quando apri per la prima volta l'app con l'auth abilitata, ti verrà chiesto di inserire il token. Il token viene salvato nel `localStorage` del browser e inviato come:

```
Authorization: Bearer super_secret_token_here
```

In alternativa, il token può essere passato come parametro query nell'URL (utile per l'accesso tramite link diretto):

```
http://localhost:7180/?token=super_secret_token_here
```

### Verifica Stato Auth

L'endpoint `GET /api/auth/status` restituisce se l'auth è abilitata e se la richiesta corrente è autenticata:

```json
{
  "auth_enabled": true,
  "authenticated": true
}
```

Viene chiamato dal frontend all'avvio per decidere se mostrare il prompt del token.

### Note sulla Sicurezza

- Il token viene trasmesso come intestazione HTTP in chiaro. Se esponi PhotoBook Studio a Internet, **usa sempre HTTPS** (tramite un reverse proxy come Nginx, Caddy o Traefik).
- Non esiste un sistema multi-utente; tutti gli utenti autenticati condividono la stessa vista di profili, progetti ed export.
- La rotazione del token richiede il riavvio del container con il nuovo valore di `PHOTOBOOK_TOKEN`.

---

## Sistema Deep Config

Il sistema **Deep Config** espone i parametri interni dell'algoritmo del layout engine, del valutatore di qualità, del rilevatore di duplicati, del sistema di crop dei volti e della pipeline di export — tutto in un'interfaccia modificabile su `/deep-config`.

### Come Funziona

I parametri vengono definiti con i loro default in `backend/deep_config_defaults.json`. Questo file è la **fonte di verità** per tutti i nomi dei parametri, i tipi e i valori predefiniti. È incluso nell'immagine Docker e non viene mai modificato a runtime.

Le sostituzioni dell'utente vengono salvate come **delta** in `/data/deep_config.json`. Solo i parametri che differiscono dai default devono essere salvati — le chiavi assenti usano automaticamente il valore predefinito.

A runtime, `config_loader.py` unisce i due:

```python
effective_config = {**defaults, **user_overrides}
```

Questo significa:
- Puoi sempre reimpostare un singolo parametro al suo default eliminando la sua chiave da `/data/deep_config.json`
- Un ripristino completo ai valori di fabbrica di tutti i parametri si ottiene eliminando `/data/deep_config.json`
- L'aggiornamento dell'applicazione può aggiungere nuovi parametri a `deep_config_defaults.json`; saranno attivi immediatamente senza alcuna azione richiesta

### Modifica tramite l'Interfaccia

1. Vai su **Deep Config** (icona chiave inglese o route `/deep-config`)
2. I parametri sono raggruppati per sezione (quality, face, duplicates, layout_scoring, map, pdf, svg, performance)
3. Ogni parametro mostra il valore corrente, il valore predefinito e un pulsante per reimpostare al default
4. Modifica il valore e fai clic su **Salva**

Le modifiche hanno effetto alla prossima generazione di layout o export — nessun riavvio necessario.

### Modifica tramite API

```bash
# Ottieni la configurazione effettiva corrente (default uniti con le sostituzioni)
curl http://localhost:7180/api/deep-config

# Salva le sostituzioni (invia solo le chiavi che vuoi cambiare)
curl -X POST http://localhost:7180/api/deep-config \
  -H "Content-Type: application/json" \
  -d '{"quality": {"weight_sharpness": 0.5, "weight_resolution": 0.3}}'
```

### Modifica Diretta del File

Puoi anche modificare `/data/deep_config.json` con un editor di testo. Il file è un JSON piatto o annidato con solo i parametri sovrascritti. Il riavvio non è necessario; il file viene riletto ad ogni richiesta.

---

## Riferimento Sezioni Deep Config

### `quality` — Punteggio Qualità Foto

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `sharpness_variance_divisor` | 500 | Divisore per normalizzare la varianza del Laplaciano a 0–1 |
| `brightness_target` | 128 | Luminosità media dei pixel ideale (0–255) |
| `megapixel_reference` | 12 | Conteggio megapixel di riferimento per il punteggio risoluzione |
| `histogram_bins` | 256 | Bin usati nell'istogramma di luminosità |
| `weight_resolution` | 0.4 | Peso della risoluzione nel punteggio qualità composito |
| `weight_sharpness` | 0.4 | Peso della nitidezza nel punteggio qualità composito |
| `weight_brightness` | 0.2 | Peso della luminosità nel punteggio qualità composito |

### `face` — Rilevamento Volti e Crop

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `min_face_size` | 0.02 | Area bbox volto minima (frazione dell'immagine) da considerare |
| `clip_check_margin` | 0.05 | Frazione di tolleranza prima che un taglio del volto venga penalizzato |
| `prominent_threshold` | 0.05 | Frazione dell'area sopra la quale un volto è "prominente" |
| `pan_margin` | 0.1 | Buffer intorno al bbox del volto come frazione della dimensione del crop |
| `target_y_position` | 0.35 | Posizione verticale del centro del volto nel crop (regola dei terzi) |
| `close_up_threshold` | 0.15 | Frazione dell'area sopra la quale la foto è trattata come primo piano |

### `duplicates` — Rilevamento Duplicati

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `dhash_size` | 8 | Dimensione griglia dHash (produce `dhash_size²` bit) |
| `duplicate_threshold` | 0.83 | Rapporto distanza di Hamming sotto il quale le foto sono duplicate |
| `burst_time_window_base_sec` | 10 | Secondi massimi tra scatti burst |
| `gps_coord_rounding` | 3 | Decimali per l'arrotondamento GPS nel rilevamento burst |

### `layout_scoring` — Selezione Template

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `penalty_orientation_violation` | 2.0 | Penalità per mancata corrispondenza orientamento foto/slot |
| `penalty_empty_caption_slot` | 0.5 | Penalità per slot didascalia non utilizzato |
| `bonus_caption_match` | 1.0 | Bonus per slot didascalia con testo disponibile |
| `face_clip_penalty_weight` | 3.0 | Peso per la penalità di taglio del volto |
| `rhythm_alternation_penalty` | 0.3 | Penalità per stesso layout consecutivo |
| `layout_reuse_penalty` | 0.1 | Penalità aggiuntiva per conteggio riutilizzi |

### `map` — Generazione Mappa GPS

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `marker_color` | `"#e74c3c"` | Colore marker GPS (esadecimale) |
| `marker_size` | 8 | Raggio marker (pixel) |
| `route_width` | 2 | Larghezza linea percorso (pixel) |
| `background_color` | `"#f8f9fa"` | Colore sfondo fallback mappa |
| `grid_color` | `"#dee2e6"` | Colore linee griglia |
| `grid_lines` | 5 | Linee griglia per asse |
| `bbox_padding_deg` | 0.05 | Padding intorno al bounding box GPS (gradi) |

### `pdf` — Export PDF

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `jpeg_quality` | 92 | Qualità compressione JPEG per le foto incorporate (1–95) |
| `bleed_mark_length_mm` | 5 | Lunghezza delle linee dei segni di taglio (mm) |
| `title_page_map_height_frac` | 0.6 | Frazione dell'altezza della pagina titolo usata dalla mappa GPS |
| `caption_font_size_factor` | 1.0 | Moltiplicatore applicato a `caption_style.size` |

### `svg` — Export SVG

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `max_image_dimension_px` | 2000 | Dimensione massima in pixel per le foto incorporate |
| `jpeg_quality` | 85 | Qualità JPEG per le foto incorporate nell'SVG |
| `title_font_size` | 48 | Dimensione font del testo titolo (pt) sulla pagina titolo |

### `performance` — Concorrenza e Timeout

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `max_hires_photos` | 50 | Numero massimo di foto ad alta risoluzione scaricate per export |
| `concurrent_hires_downloads` | 4 | Numero massimo di download ad alta risoluzione in parallelo |
| `concurrent_thumb_downloads` | 8 | Numero massimo di download thumbnail in parallelo durante la generazione |
| `pdf_timeout_per_page_sec` | 30 | Timeout per pagina nella generazione PDF (secondi) |
