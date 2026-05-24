# Architettura

Questa pagina descrive l'architettura interna di PhotoBook Studio: come sono strutturati frontend e backend, come le richieste fluiscono attraverso il sistema e come vengono archiviati i dati.

---

## Indice

- [Panoramica del Sistema](#panoramica-del-sistema)
- [Separazione Frontend / Backend](#separazione-frontend--backend)
- [Come Viene Servito il Frontend](#come-viene-servito-il-frontend)
- [Panoramica delle Dipendenze tra Moduli](#panoramica-delle-dipendenze-tra-moduli)
- [Flusso delle Richieste: Generazione Layout](#flusso-delle-richieste-generazione-layout)
- [Flusso delle Richieste: Export PDF](#flusso-delle-richieste-export-pdf)
- [Struttura di Archiviazione dei Dati](#struttura-di-archiviazione-dei-dati)
- [Client Immich](#client-immich)

---

## Panoramica del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Container (Python 3.12 + uvicorn)                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  FastAPI Application  (main.py)                          │   │
│  │                                                          │   │
│  │  /api/*  ──► endpoint REST                               │   │
│  │  /*      ──► StaticFiles (React SPA)                     │   │
│  │                                                          │   │
│  │  ┌─────────────────┐  ┌────────────────────────────┐    │   │
│  │  │ album_generator │  │ pdf_generator / svg_exporter│    │   │
│  │  │ smart_layout    │  │ (pipeline di export)        │    │   │
│  │  │ layout_engine   │  └────────────────────────────┘    │   │
│  │  └────────┬────────┘                                     │   │
│  │           │                                              │   │
│  │  ┌────────▼────────┐  ┌──────────────────┐              │   │
│  │  │ immich_client   │  │ map_generator    │              │   │
│  │  │ (httpx async)   │  │ (Stadia/OSM)     │              │   │
│  │  └────────┬────────┘  └──────────────────┘              │   │
│  │           │                                              │   │
│  │  ┌────────▼────────┐                                     │   │
│  │  │ config_loader   │                                     │   │
│  │  │ demo_data       │                                     │   │
│  │  └─────────────────┘                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  /data/ volume ─── config.json, profiles/, projects/,           │
│                     exports/, cache/, presets/, deep_config.json│
└──────────────┬──────────────────────────────────────────────────┘
               │
               │  HTTP  (Immich API)
               ▼
┌──────────────────────────┐
│  Immich Server           │
│  (container separato)    │
└──────────────────────────┘
```

---

## Separazione Frontend / Backend

PhotoBook Studio è un'applicazione **single-origin**: la React SPA e il backend FastAPI sono inclusi nello stesso container Docker e serviti sulla stessa porta.

### Backend (`backend/`)

| File | Responsabilità | Righe appross. |
|------|---------------|----------------|
| `main.py` | Entry point dell'app FastAPI; definizioni di tutti gli endpoint REST; middleware auth; mount file statici | ~1325 |
| `immich_client.py` | Client asincrono per le API Immich; connection pooling (max 20); intercettazione demo mode | — |
| `album_generator.py` | Generazione layout principale: clustering eventi, punteggio qualità, selezione template, assegnazione slot | ~1434 |
| `smart_layout.py` | Pipeline di smart auto-layout ad alto livello che orchestra i componenti di album_generator | ~654 |
| `layout_engine.py` | Geometria pagina/slot: calcoli delle coordinate, slot in percentuale, calcoli bleed/margine | ~397 |
| `pdf_generator.py` | Export PDF con ReportLab: profili ICC, bleed, segni di taglio, pagina titolo, didascalie, dorso | ~1237 |
| `svg_exporter.py` | Export SVG ZIP: SVG per pagina con foto JPEG in base64 incorporate | ~520 |
| `map_generator.py` | Immagini mappa GPS: tile Stadia Maps o fallback OSM staticmap | ~347 |
| `config_loader.py` | Sistema deep config: carica `deep_config_defaults.json`, unisce le sostituzioni utente da `/data/deep_config.json` | — |
| `demo_data.py` | Album demo integrati (4 album, 64 foto via picsum.photos) | — |
| `deep_config_defaults.json` | Default di tutti i parametri dell'algoritmo; funge da schema per DeepConfigPage | — |

### Frontend (`frontend/src/`)

| File / Directory | Responsabilità |
|-----------------|----------------|
| `pages/ConfigPage.jsx` | Configurazione URL server Immich e chiave API |
| `pages/HomePage.jsx` | Dashboard: lista progetti, azioni rapide |
| `pages/ProfilesPage.jsx` | CRUD profili di stampa, editor drag-resize degli slot |
| `pages/AlbumsPage.jsx` | Browser album, opzioni di generazione, avvio smart layout |
| `pages/PreviewPage.jsx` | Editor pagine interattivo: pan/zoom, scambio foto, didascalie inline, modale export |
| `pages/DeepConfigPage.jsx` | Editor avanzato dei parametri dell'algoritmo |
| `src/i18n.jsx` | Provider i18n (React context) |
| `src/locales/it.js` | Mappa stringhe in italiano |
| `src/locales/en.js` | Mappa stringhe in inglese |

---

## Come Viene Servito il Frontend

Durante la build Docker, Vite compila l'app React in asset statici posizionati in `frontend/dist/`. FastAPI monta poi quella directory al percorso root tramite `StaticFiles`:

```python
# main.py (semplificato)
from fastapi.staticfiles import StaticFiles

app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
```

Tutti i percorsi che iniziano con `/api/` vengono gestiti dal router di FastAPI **prima** del mount statico, quindi le chiamate API non vengono mai intercettate dalla SPA. L'app React usa il routing lato client (React Router); il flag `html=True` su `StaticFiles` assicura che `index.html` della SPA venga servito per qualsiasi percorso sconosciuto, consentendo ai deep-link di funzionare correttamente.

In **sviluppo**, il dev server Vite del frontend gira separatamente (tipicamente sulla porta 5173) e fa il proxy delle richieste `/api/` verso il backend uvicorn sulla porta 8000.

---

## Panoramica delle Dipendenze tra Moduli

```
main.py
 ├── immich_client.py  ◄── demo_data.py
 ├── config_loader.py  ◄── deep_config_defaults.json
 ├── album_generator.py
 │     ├── layout_engine.py
 │     └── immich_client.py
 ├── smart_layout.py
 │     └── album_generator.py
 ├── pdf_generator.py
 │     ├── layout_engine.py
 │     └── map_generator.py
 ├── svg_exporter.py
 │     └── layout_engine.py
 └── map_generator.py
```

`config_loader.py` viene importato dalla maggior parte dei moduli backend per accedere ai parametri del deep config unificati a runtime.

---

## Flusso delle Richieste: Generazione Layout

Questa è l'azione principale dell'utente: selezionare un album e fare clic su **Genera**.

```
Browser
  │  POST /api/generate  { album_id, profile_id, options }
  ▼
main.py  ─── carica il profilo da /data/profiles/{id}.json
          ─── chiama immich_client.get_album_assets(album_id)
                │
                ▼  (async, connection pool)
          Immich API  →  lista asset con EXIF, GPS, dati bbox volti
                │
          immich_client restituisce la lista asset
          │
          ▼
  album_generator.generate_layout(assets, profile, options)
    │
    ├── 1. cluster_events()      raggruppa per intervallo temporale
    ├── 2. score_quality()       risoluzione × nitidezza × luminosità
    ├── 3. remove_duplicates()   dHash + rilevamento burst
    ├── 4. _get_all_faces()      legge metadati bbox volti da Immich
    ├── 5. _select_template()    valuta i tipi di pagina, sceglie il migliore
    ├── 6. _assign_slots()       pan face-aware, calcolo crop
    └── restituisce: lista di oggetti Page
          │
          ▼
  main.py serializza le pagine → risposta JSON
          │
          ▼
Browser  ─── PreviewPage visualizza le pagine dal JSON
```

Per lo **smart layout** (`POST /api/generate/smart`), `smart_layout.py` avvolge `album_generator` con euristiche aggiuntive e lo chiama iterativamente per riempire tutte le pagine.

---

## Flusso delle Richieste: Export PDF

```
Browser
  │  POST /api/export/pdf  { pages, profile_id, options }
  ▼
main.py
  ├── deserializza le pagine dal corpo della richiesta
  ├── carica il profilo
  └── chiama pdf_generator.generate_pdf(pages, profile, options)
          │
          ├── per ogni pagina:
          │     ├── scarica l'asset ad alta risoluzione da Immich
          │     │     (o URL demo) tramite immich_client
          │     ├── ridimensionamento Pillow al DPI target
          │     ├── applica trasformazione colore ICC (se profilo CMYK)
          │     └── disegna la pagina con ReportLab (foto, didascalia, mappa)
          │
          ├── incorpora il profilo ICC di output nei metadati PDF
          ├── aggiunge segni di taglio se bleed attivo
          └── scrive i byte PDF in /data/exports/{uuid}.pdf
                │
                ▼
main.py  ─── risposta streaming con i byte PDF
          ─── (o nome file per il download)
```

L'export SVG segue lo stesso schema ma chiama `svg_exporter.generate_svg_zip()` al posto del generatore PDF.

---

## Struttura di Archiviazione dei Dati

Tutto lo stato persistente si trova nel volume `/data/`:

```
/data/
├── config.json              URL server Immich + chiave API
├── deep_config.json         Sostituzioni utente per i parametri dell'algoritmo
│                             (delta rispetto ai default; le chiavi assenti usano il default)
├── profiles/
│   ├── {uuid}.json          Un file per ogni profilo di stampa
│   └── ...
├── projects/
│   ├── {uuid}.json          Progetti libro salvati
│   └── ...
├── exports/
│   ├── {uuid}.pdf           Export PDF generati
│   ├── {uuid}.zip           Export SVG ZIP generati
│   └── ...
├── cache/
│   └── thumbs/              Cache thumbnail proxy da Immich
└── presets/
    └── {name}.json          Preset di configurazione generazione
```

La directory `/data/exports/` è servita da FastAPI come route di file statici su `/api/exports/`, quindi i file generati sono direttamente scaricabili dal browser.

---

## Client Immich

`immich_client.py` fornisce un'interfaccia asincrona alle API REST di Immich tramite `httpx.AsyncClient` con un connection pool condiviso (max 20 connessioni simultanee).

Comportamenti principali:

- **Autenticazione**: invia `x-api-key: {key}` su ogni richiesta, letto da `/data/config.json`
- **Intercettazione demo**: quando `DEMO_MODE=true`, tutti i metodi restituiscono dati da `demo_data.py` senza effettuare richieste di rete
- **Dati volti**: Immich restituisce i bounding box dei volti come coordinate normalizzate (`0.0`–`1.0`) relative alle dimensioni dell'asset completo; `immich_client` le elabora e le passa ad `album_generator`
- **Sincronizzazione didascalie**: `update_asset_description(asset_id, description)` chiama `PUT /api/assets/{id}` sul server Immich per salvare le didascalie come descrizioni EXIF

Permessi API Immich richiesti per la chiave API:

| Permesso | Utilizzato per |
|----------|---------------|
| `Asset:Read` | Download metadati asset e thumbnail |
| `Asset:View` | Download asset ad alta risoluzione per l'export |
| `Asset:Update` | Scrittura didascalie su Immich |
| `Album:Read` | Elenco album e contenuti degli album |
| `Person:Read` | Lettura dati riconoscimento volti/persone |
