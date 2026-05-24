# PhotoBook Studio — Wiki

**PhotoBook Studio** (conosciuto anche come *ImmichPhotoBook*) è un'applicazione web self-hosted che si collega a un server fotografico [Immich](https://immich.app/), legge i tuoi album e i metadati delle foto (GPS, EXIF, dati di riconoscimento facciale, descrizioni) e ti permette di comporre fotolibri pronti per la stampa tramite un editor interattivo nel browser. I libri finiti possono essere esportati come PDF o SVG ZIP pronti per la stampa.

---

## Indice

| Pagina | Descrizione |
|--------|-------------|
| [Architettura](Architecture-IT.md) | Diagramma del sistema, panoramica dei moduli, flusso delle richieste, archiviazione dei dati |
| [Profili di Stampa](Print-Profiles-IT.md) | Campi del profilo, dimensioni pagina, sistema slot, bleed, profili colore, guida DPI |
| [Generazione Album](Album-Generation-IT.md) | Fasi della pipeline, clustering, punteggio qualità, crop face-aware, selezione layout |
| [Anteprima ed Export](Preview-and-Export-IT.md) | Funzionalità dell'editor interattivo, export PDF/SVG, sincronizzazione didascalie |
| [Configurazione](Configuration-IT.md) | Connessione Immich, variabili d'ambiente, Deep Config, token di autenticazione |
| [Modalità Demo](Demo-Mode-IT.md) | Album demo integrati, come attivare, implementazione tecnica |
| [Riferimento API](API-Reference-IT.md) | Tutti gli endpoint REST, formati richiesta/risposta, formato auth, codici errore |
| [Guida allo Sviluppo](Development-IT.md) | Configurazione locale, dev server, aggiunta funzionalità, i18n, estensione Deep Config |
| [Deploy](Deployment-IT.md) | Docker Compose, immagine GHCR, Railway.app, volumi, procedura di aggiornamento |

---

## Cosa fa PhotoBook Studio

```
Immich Server
    │
    │  album, thumbnail, EXIF, GPS, volti
    ▼
PhotoBook Studio
    │
    ├── Layout Engine ──► Layout automatico intelligente con punteggio qualità
    │                     crop face-aware, clustering temporale
    │
    ├── Interactive Editor ──► Pagine drag-and-drop, didascalie inline,
    │                          editor copertina, pagine divisore, spread a 2 pagine
    │
    └── Export Engine ──► PDF pronto per la stampa (ReportLab + profili ICC)
                          SVG ZIP (vettoriale, compatibile con Inkscape/Illustrator)
```

PhotoBook Studio **non** archivia né ricarica le tue foto. Legge thumbnail e metadati da Immich, genera i layout in memoria e produce i file di export su richiesta. Tutti i dati persistenti (configurazione, profili, progetti) sono memorizzati in un unico volume montato su `/data/`.

---

## Funzionalità Principali

- **Self-hosted** — gira interamente in Docker sulla tua infrastruttura; nessuna dipendenza cloud
- **Nativo per Immich** — usa direttamente le API Immich; rispetta il riconoscimento facciale, GPS, date EXIF e struttura degli album
- **Layout automatico intelligente** — raggruppa automaticamente gli eventi per periodo, valuta la qualità delle foto, rileva i duplicati e sceglie i layout di pagina con crop face-aware
- **Profili di stampa completamente personalizzabili** — definisci dimensioni pagina, margini, bleed, layout degli slot, stile didascalie e profilo colore per ogni libro
- **Output pronto per la stampa** — PDF con profili colore ICC (sRGB, FOGRA39/ISO Coated per offset CMYK), bleed e segni di taglio, DPI corretto
- **Export SVG** — ogni pagina come SVG modificabile, in un bundle ZIP
- **Mappe GPS** — le pagine di titolo e divisore incorporano mappe satellitari/stradali da Stadia Maps o OpenStreetMap
- **Badge foto** — overlay opzionale di data/posizione su ogni foto, configurabile per profilo (forma, posizione, colori); deduplicati all'interno di ogni pagina
- **Pagine didascalia evento** — la prima pagina di ogni cluster temporale viene riempita automaticamente con l'intervallo di date e la posizione quando il clustering è abilitato
- **Sincronizzazione didascalie** — le didascalie scritte nell'editor possono essere risincronizzate in Immich come descrizioni EXIF
- **Modalità demo** — funziona senza alcun server Immich; album demo integrati tramite picsum.photos
- **i18n** — interfaccia in italiano e inglese (è possibile aggiungere altre lingue)
- **Autenticazione token opzionale** — proteggi l'interfaccia con un bearer token

---

## Avvio Rapido

### Docker Compose (consigliato)

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
    environment:
      - TZ=Europe/Rome

volumes:
  photobook_data:
```

Apri `http://localhost:7180`, vai su **Config**, inserisci l'URL di Immich e la chiave API, e inizia a creare il tuo primo fotolibro.

### Modalità Demo (senza Immich)

```yaml
environment:
  - DEMO_MODE=true
```

Vedi [Modalità Demo](Demo-Mode-IT.md) per i dettagli.

---

## Stack Tecnologico

| Livello | Tecnologia |
|---------|-----------|
| Backend | Python 3.12, FastAPI, uvicorn |
| Frontend | React 18, Vite (SPA, servita da FastAPI) |
| Generazione PDF | ReportLab |
| Elaborazione immagini | Pillow (PIL) |
| Client HTTP | httpx (async, connection pooling) |
| Mappe | Tile Stadia Maps o staticmap (fallback OSM) |
| Container | Build Docker multi-stage (build Node + runtime Python) |

---

## Versione e Changelog

Consulta `CHANGELOG.md` nella root del repository per la cronologia completa delle versioni.

Versione stabile attuale: **v0.9.8**

---

## Licenza

Consulta `LICENSE` nella root del repository.
