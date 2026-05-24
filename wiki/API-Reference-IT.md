# Riferimento API

Tutta la funzionalità del backend di PhotoBook Studio è esposta come API REST sotto il prefisso `/api/`. La React SPA frontend è il principale utilizzatore, ma puoi chiamare questi endpoint direttamente per scripting, integrazione o debug.

---

## Indice

- [Autenticazione](#autenticazione)
- [URL Base e Versioning](#url-base-e-versioning)
- [Risposte di Errore](#risposte-di-errore)
- [Endpoint](#endpoint)
  - [Health](#health)
  - [Auth](#auth)
  - [Config](#config)
  - [Album](#album)
  - [Thumbnail](#thumbnail)
  - [Profili di Stampa](#profili-di-stampa)
  - [Generazione Layout](#generazione-layout)
  - [Export](#export)
  - [Progetti](#progetti)
  - [Deep Config](#deep-config)

---

## Autenticazione

L'autenticazione è **opzionale** e controllata dalla variabile d'ambiente `PHOTOBOOK_TOKEN`. Quando impostata, tutte le route `/api/*` richiedono un token valido.

### Intestazione Bearer Token

```
Authorization: Bearer <token>
```

### Parametro Query (alternativa)

```
GET /api/albums?token=<token>
```

### Risposta quando Non Autenticato

```
HTTP 401 Unauthorized
Content-Type: application/json

{"detail": "Unauthorized"}
```

---

## URL Base e Versioning

Tutti gli endpoint sono serviti alla root dell'applicazione con il prefisso `/api/`. Non esiste un prefisso di versioning; le API sono pensate per essere consumate dal frontend incluso alla stessa versione.

```
http://localhost:7180/api/...
```

Tutti i body di richiesta e risposta usano `application/json` salvo diversa indicazione.

---

## Risposte di Errore

| Stato HTTP | Significato |
|-----------|-------------|
| `200 OK` | Successo |
| `201 Created` | Risorsa creata |
| `204 No Content` | Successo, nessun body |
| `400 Bad Request` | Body della richiesta o parametri non validi |
| `401 Unauthorized` | Token auth mancante o non valido |
| `404 Not Found` | La risorsa non esiste |
| `422 Unprocessable Entity` | Errore di validazione della richiesta FastAPI (JSON malformato o campi obbligatori mancanti) |
| `500 Internal Server Error` | Errore backend non gestito |

Tutte le risposte di errore includono un body JSON con un campo `detail`:

```json
{"detail": "Profile not found"}
```

---

## Endpoint

---

### Health

#### `GET /api/health`

Restituisce lo stato di salute dell'applicazione, la versione e il flag demo.

**Risposta `200`:**
```json
{
  "status": "ok",
  "version": "0.9.8",
  "demo": false
}
```

`demo: true` quando `DEMO_MODE=true` è impostato.

---

### Auth

#### `GET /api/auth/status`

Restituisce se l'autenticazione è abilitata e se la richiesta corrente è autenticata. Questo endpoint è **sempre accessibile** (non richiede auth) in modo che il frontend possa determinare se mostrare il prompt del token.

**Risposta `200`:**
```json
{
  "auth_enabled": true,
  "authenticated": false
}
```

---

### Config

#### `GET /api/config`

Restituisce la configurazione di connessione Immich corrente (salvata in `/data/config.json`). La chiave API viene mascherata nella risposta per sicurezza.

**Risposta `200`:**
```json
{
  "immich_url": "http://192.168.1.10:2283",
  "api_key": "••••••••••••••••"
}
```

---

#### `POST /api/config`

Salva la configurazione di connessione Immich.

**Body della richiesta:**
```json
{
  "immich_url": "http://192.168.1.10:2283",
  "api_key": "your_immich_api_key"
}
```

**Risposta `200`:**
```json
{"status": "saved"}
```

---

#### `GET /api/config/test`

Testa la connessione Immich usando la configurazione attualmente salvata. Restituisce lo stato di connettività e il flag demo.

**Risposta `200` (connesso):**
```json
{
  "connected": true,
  "demo": false,
  "immich_version": "1.105.1"
}
```

**Risposta `200` (non connesso):**
```json
{
  "connected": false,
  "demo": false,
  "error": "Connection refused"
}
```

In modalità demo, restituisce sempre `{connected: true, demo: true}`.

---

### Album

#### `GET /api/albums`

Elenca tutti gli album Immich accessibili con la chiave API configurata. In modalità demo, restituisce i quattro album demo integrati.

**Risposta `200`:**
```json
[
  {
    "id": "album-uuid",
    "albumName": "Toscana 2023",
    "assetCount": 18,
    "startDate": "2023-07-10T08:00:00Z",
    "endDate": "2023-07-17T19:00:00Z",
    "albumThumbnailAssetId": "asset-uuid"
  }
]
```

---

### Thumbnail

#### `GET /api/thumb/{asset_id}`

Fa il proxy del thumbnail per l'asset specificato da Immich (o URL demo picsum). Restituisce i byte dell'immagine con l'intestazione `Content-Type` appropriata.

Questo endpoint esiste per evitare problemi CORS e per fornire un singolo punto proxy per entrambe le modalità live e demo.

**Parametro path:** `asset_id` — UUID asset Immich

**Risposta `200`:** byte immagine (`image/jpeg` o `image/webp`)

**Risposta `404`:** asset non trovato

---

### Profili di Stampa

#### `GET /api/profiles`

Restituisce tutti i profili di stampa salvati in `/data/profiles/`.

**Risposta `200`:**
```json
[
  {
    "id": "profile-uuid",
    "name": "A4 Portrait",
    "page_size": "a4",
    "orientation": "portrait",
    "margin_mm": 10,
    "bleed": true,
    "bleed_mm": 3,
    "gap_mm": 2,
    "export_dpi": 300,
    "color_profile": "srgb",
    "crop_marks": true,
    "body_paper_gsm": 130,
    "page_types": [...],
    "caption_style": {...},
    "cover": [...]
  }
]
```

---

#### `POST /api/profiles`

Crea un nuovo profilo di stampa. Un UUID viene generato automaticamente.

**Body della richiesta:** oggetto profilo (senza `id`)

**Risposta `201`:**
```json
{"id": "new-profile-uuid"}
```

---

#### `PUT /api/profiles/{id}`

Aggiorna un profilo esistente. Sostituisce l'intero documento del profilo.

**Parametro path:** `id` — UUID profilo

**Body della richiesta:** oggetto profilo completo

**Risposta `200`:**
```json
{"status": "updated"}
```

---

#### `DELETE /api/profiles/{id}`

Elimina un profilo.

**Parametro path:** `id` — UUID profilo

**Risposta `204`:** nessun contenuto

**Risposta `404`:** profilo non trovato

---

#### `POST /api/profiles/{id}/duplicate`

Crea una copia di un profilo esistente con un nuovo UUID. Il nome della copia è preceduto da `"Copy of "`.

**Parametro path:** `id` — UUID profilo sorgente

**Risposta `201`:**
```json
{"id": "new-copy-uuid"}
```

---

### Generazione Layout

#### `POST /api/generate`

Esegue la pipeline di generazione album standard per l'album e il profilo specificati.

**Body della richiesta:**
```json
{
  "album_id": "album-uuid",
  "profile_id": "profile-uuid",
  "options": {
    "cluster_events": true,
    "cluster_gap_minutes": 60,
    "remove_duplicates": true,
    "use_map_fill": true,
    "density": 1.0,
    "min_quality": 0.2,
    "include_title_page": true,
    "include_dividers": true
  }
}
```

**Risposta `200`:** array di oggetti pagina

```json
[
  {
    "page_index": 0,
    "page_type": "full_page",
    "slots": [
      {
        "slot_index": 0,
        "type": "photo",
        "asset_id": "asset-uuid",
        "crop": {"x": 0, "y": 120, "w": 4032, "h": 3024},
        "caption": "Walking through the vineyard"
      }
    ]
  }
]
```

---

#### `POST /api/generate/smart`

Esegue la pipeline di smart auto-layout (wrapper di livello superiore con divisori evento e bilanciamento tra cluster). Il formato di richiesta e risposta è identico a `POST /api/generate`.

---

#### `POST /api/generate/recalculate`

Ricalcola il layout da un elenco di foto ordinato manualmente. Usato quando l'utente ha riordinato le foto nel pool delle non assegnate e vuole rieseguire la generazione senza ri-effettuare il clustering.

**Body della richiesta:**
```json
{
  "asset_ids": ["uuid1", "uuid2", "..."],
  "profile_id": "profile-uuid",
  "options": { ... }
}
```

**Risposta `200`:** stesso array di oggetti pagina di `POST /api/generate`.

---

### Export

#### `POST /api/export/pdf`

Genera un export PDF del layout libro corrente. La risposta è un download in streaming del file PDF.

**Body della richiesta:**
```json
{
  "pages": [...],
  "profile_id": "profile-uuid",
  "options": {
    "dpi": 300,
    "color_profile": "fogra39",
    "include_cover": true,
    "bleed": true,
    "crop_marks": true,
    "page_range": null
  }
}
```

`page_range`: `null` per tutte le pagine, o `[start, end]` (1-based inclusivo) per un intervallo.

**Risposta `200`:**
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="photobook.pdf"`
- Body: byte PDF (streaming)

---

#### `POST /api/export/svg`

Genera un export SVG ZIP. La risposta è un download di file ZIP.

**Body della richiesta:** stesso formato di `POST /api/export/pdf`

**Risposta `200`:**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="photobook_svg.zip"`
- Body: byte ZIP

---

#### `GET /api/export/color_profiles`

Restituisce l'elenco dei profili colore ICC disponibili sul server (inclusi e trovati).

**Risposta `200`:**
```json
[
  {"id": "srgb",      "name": "sRGB",                "color_space": "RGB",  "bundled": true},
  {"id": "adobe_rgb", "name": "Adobe RGB (1998)",     "color_space": "RGB",  "bundled": false},
  {"id": "fogra39",   "name": "ISO Coated v2 FOGRA39","color_space": "CMYK", "bundled": true},
  {"id": "fogra51",   "name": "ISO Coated v2 300%",   "color_space": "CMYK", "bundled": false},
  {"id": "swop",      "name": "SWOP v2",              "color_space": "CMYK", "bundled": false}
]
```

I profili con `bundled: false` tornano a sRGB al momento dell'export.

---

### Progetti

#### `GET /api/projects`

Restituisce tutti i progetti salvati in `/data/projects/`.

**Risposta `200`:**
```json
[
  {
    "id": "project-uuid",
    "name": "Toscana 2023 Book",
    "album_id": "album-uuid",
    "profile_id": "profile-uuid",
    "created_at": "2024-03-15T10:30:00Z",
    "updated_at": "2024-03-16T14:00:00Z",
    "page_count": 24
  }
]
```

---

#### `POST /api/projects`

Salva il layout libro corrente come progetto (crea o sovrascrive).

**Body della richiesta:**
```json
{
  "id": "project-uuid",
  "name": "Toscana 2023 Book",
  "album_id": "album-uuid",
  "profile_id": "profile-uuid",
  "pages": [...]
}
```

Se `id` viene omesso, viene generato un nuovo UUID.

**Risposta `200`:**
```json
{"id": "project-uuid"}
```

---

### Deep Config

#### `GET /api/deep-config`

Restituisce il deep config effettivo: default uniti con le sostituzioni utente.

**Risposta `200`:** oggetto JSON annidato con tutte le sezioni e i parametri (vedi [Configurazione — Riferimento Sezioni Deep Config](Configuration-IT.md#riferimento-sezioni-deep-config)).

---

#### `POST /api/deep-config`

Salva le sostituzioni utente per i parametri dell'algoritmo. Invia solo le chiavi che vuoi cambiare — le chiavi non specificate mantengono la loro sostituzione corrente (o il default).

**Body della richiesta (esempio — sovrascrive solo due valori):**
```json
{
  "quality": {
    "weight_sharpness": 0.5
  },
  "face": {
    "target_y_position": 0.4
  }
}
```

**Risposta `200`:**
```json
{"status": "saved"}
```

Per reimpostare tutte le sostituzioni ai default, invia un oggetto vuoto `{}` con `POST`.
