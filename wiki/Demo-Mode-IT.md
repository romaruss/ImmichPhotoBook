# Modalità Demo

La modalità demo ti permette di esplorare e valutare PhotoBook Studio senza collegarti a un server Immich. Fornisce quattro album fotografici integrati con metadati GPS, EXIF e strutturali realistici, serviti tramite immagini Lorem Picsum pubblicamente accessibili.

---

## Indice

- [Cos'è la Modalità Demo?](#cosè-la-modalità-demo)
- [Come Abilitare la Modalità Demo](#come-abilitare-la-modalità-demo)
- [Album Demo Integrati](#album-demo-integrati)
- [Profili Demo Pre-installati](#profili-demo-pre-installati)
- [Implementazione Tecnica](#implementazione-tecnica)
- [Limitazioni](#limitazioni)

---

## Cos'è la Modalità Demo?

La modalità demo è un flag di runtime che sostituisce tutte le chiamate alle API Immich con risposte provenienti da un dataset integrato definito in `backend/demo_data.py`. Quando attiva:

- Non è richiesto nessun URL del server Immich né chiave API
- Tutte le risposte di album, foto e metadati provengono dai dati demo hardcoded
- Le foto vengono servite come URL che puntano a [Lorem Picsum](https://picsum.photos) (CDN immagini stabile e pubblicamente accessibile)
- L'intera pipeline di generazione, anteprima ed export funziona normalmente

La modalità demo è pensata per:
- La valutazione iniziale prima di configurare Immich
- Test e sviluppo senza un'istanza Immich in esecuzione
- Dimostrazioni pubbliche dell'applicazione

---

## Come Abilitare la Modalità Demo

Imposta la variabile d'ambiente `DEMO_MODE` su `true`:

### Docker Compose

```yaml
services:
  photobook:
    image: ghcr.io/romaruss/photobook-studio:latest
    ports:
      - "7180:8000"
    volumes:
      - photobook_data:/data
    environment:
      - DEMO_MODE=true
      - TZ=Europe/Rome
```

### Docker CLI

```bash
docker run -d \
  -p 7180:8000 \
  -v photobook_data:/data \
  -e DEMO_MODE=true \
  ghcr.io/romaruss/photobook-studio:latest
```

### Railway / Piattaforma

Aggiungi `DEMO_MODE` = `true` nel pannello delle variabili d'ambiente del servizio.

Una volta abilitata, l'interfaccia mostra un banner **"Demo Mode"** sulla pagina Config e il test di connessione restituisce sempre `{connected: true, demo: true}`.

---

## Album Demo Integrati

La modalità demo fornisce quattro album, ciascuno con caratteristiche geografiche e tematiche distinte:

### Album 1 — Toscana 2023

| Campo | Valore |
|-------|--------|
| Foto | 18 |
| Tema | Campagna toscana, borghi collinari, vigneti |
| Regione GPS | Toscana, Italia (circa 43°N, 11°E) |
| Date | Estate 2023 |
| Dati volti | Nessuno (foto di paesaggio/architettura) |

Questo album dimostra il clustering GPS e le pagine divisore basate su mappa. Le coordinate GPS sono distribuite su diverse località toscane (Firenze, Siena, area di San Gimignano), permettendo al clustering temporale di produrre 3–4 gruppi evento.

### Album 2 — Dolomiti Estate

| Campo | Valore |
|-------|--------|
| Foto | 17 |
| Tema | Scenari alpini di montagna, escursionismo |
| Regione GPS | Dolomiti, Italia (circa 46°N, 12°E) |
| Date | Estate |
| Dati volti | Nessuno |

Dimostra la pagina titolo con mappa e coordinate GPS montane. I metadati EXIF delle foto includono l'altitudine (dati di quota simulati). La distribuzione GPS su più vallate mostra la funzione della linea di percorso sulle pagine mappa.

### Album 3 — Famiglia

| Campo | Valore |
|-------|--------|
| Foto | 13 |
| Tema | Ritratti di famiglia e raduni al chiuso/all'aperto |
| Regione GPS | Variata (casa + luoghi all'aperto) |
| Date | Miste |
| Dati volti | Sì — più persone con nome |

Questo album mette alla prova il rilevamento volti e il crop face-aware. Diverse foto hanno più volti; il generatore di album dimostra come unisce i bounding box e posiziona i crop per mostrare tutti i volti. Le foto con volti prominenti vengono posizionate su slot a pagina intera.

### Album 4 — Barcellona 2024

| Campo | Valore |
|-------|--------|
| Foto | 16 |
| Tema | Viaggio urbano, architettura, cibo |
| Regione GPS | Barcellona, Spagna (circa 41°N, 2°E) |
| Date | 2024 |
| Dati volti | Minimi |

Dimostra il layout di un libro di viaggio/città con clustering GPS denso in ambiente urbano. Ideale per testare le opzioni dello stile mappa (Stadia Maps o OSM) in un percorso GPS a scala pedonale e camminabile.

---

## Profili Demo Pre-installati

Quando la modalità demo viene avviata per la prima volta, vengono creati automaticamente due profili di stampa in `/data/profiles/` se non esistono ancora profili:

| Profilo | Dimensione pagina | Orientamento | Note |
|---------|------------------|--------------|------|
| **A4 Portrait — Standard** | A4 | Portrait | Margini 10 mm, bleed 3 mm, 300 DPI, sRGB |
| **20×20 Square — Coffee Table** | 20×20 | — | Margini 15 mm, senza bleed, 300 DPI, sRGB |

Questi profili includono un set base di tipi di pagina (pagina intera, 2 colonne, foto+didascalia) sufficiente a dimostrare la pipeline di generazione. Puoi modificarli o eliminarli come qualsiasi altro profilo.

Se esistono già profili in `/data/profiles/` quando la modalità demo si avvia, i profili demo **non** vengono creati (per evitare di sovrascrivere il tuo lavoro).

---

## Implementazione Tecnica

La modalità demo è implementata come guardia all'interno di `backend/immich_client.py`. Ogni metodo pubblico verifica il flag demo prima di effettuare qualsiasi chiamata HTTP:

```python
# Logica semplificata in immich_client.py
class ImmichClient:
    def __init__(self):
        self.demo_mode = os.environ.get("DEMO_MODE", "").lower() == "true"

    async def get_albums(self):
        if self.demo_mode:
            return demo_data.ALBUMS
        # ... vera chiamata HTTP a Immich
```

`backend/demo_data.py` contiene:
- `ALBUMS` — lista di 4 oggetti album corrispondenti allo schema album di Immich
- `ASSETS` — mapping ID album → lista di oggetti asset, ciascuno con:
  - URL stabili picsum.photos per thumbnail e alta risoluzione
  - EXIF simulato (data, GPS, orientamento, dimensioni)
  - Bounding box volti simulati (per l'album Famiglia)
  - Descrizioni simulate

### URL delle Foto

Le foto demo usano il formato URL stabile di [Lorem Picsum](https://picsum.photos):

```
https://picsum.photos/id/{n}/800/600
```

Dove `{n}` è un ID foto specifico. Questi ID sono hardcoded in `demo_data.py` e scelti per essere visivamente rappresentativi del tema dell'album.

I thumbnail usano dimensioni più piccole (es. `400/300`). Gli URL ad alta risoluzione usano dimensioni più grandi (es. `1600/1200`) per simulare un download realistico durante l'export PDF.

### Comportamento degli Endpoint API in Modalità Demo

| Endpoint | Comportamento demo |
|----------|--------------------|
| `GET /api/config/test` | Restituisce `{connected: true, demo: true}` senza chiamata HTTP |
| `GET /api/albums` | Restituisce `demo_data.ALBUMS` |
| `GET /api/thumb/{id}` | Fa il proxy dell'URL thumbnail picsum.photos |
| `POST /api/generate` | La pipeline completa gira sulla lista asset demo |
| `POST /api/export/pdf` | PDF completo generato dalle immagini picsum.photos |
| `POST /api/export/svg` | SVG ZIP completo generato |
| Sincronizzazione didascalie | Scrittura silenziosamente scartata (nessuna chiamata HTTP) |

### Il Flag `demo` nell'Health Check

```bash
curl http://localhost:7180/api/health
```

```json
{
  "status": "ok",
  "version": "0.9.8",
  "demo": true
}
```

Il campo `demo` nella risposta dell'health check permette agli strumenti di monitoraggio e integrazione di rilevare programmaticamente la modalità demo.

---

## Limitazioni

La modalità demo presenta le seguenti limitazioni rispetto a una connessione Immich live:

- **Nessuna sincronizzazione didascalie** — le didascalie non possono essere riscritte (non c'è un server Immich per riceverle)
- **Connessione internet richiesta** — le immagini delle foto demo vengono recuperate da picsum.photos a runtime; l'app richiede accesso internet in uscita dal container
- **Dataset fisso** — non puoi aggiungere, rimuovere o modificare album o foto demo
- **Solo metadati simulati** — i dati EXIF (nitidezza, GPS reale, date reali) sono simulati; i punteggi di qualità e il clustering potrebbero non riflettere le prestazioni nel mondo reale
- **Dati volti solo per Famiglia** — gli altri tre album non hanno dati di rilevamento volti, quindi il crop face-aware usa il crop centrato per tutte le foto
- **Nessun nome persona reale** — le identità dei volti nell'album Famiglia usano nomi segnaposto
