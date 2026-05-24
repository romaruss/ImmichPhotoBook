# Guida allo Sviluppo

Questa pagina spiega come configurare un ambiente di sviluppo locale, eseguire l'applicazione in modalità sviluppo, costruire l'immagine Docker di produzione ed estendere l'applicazione con nuove funzionalità.

---

## Indice

- [Prerequisiti](#prerequisiti)
- [Struttura del Repository](#struttura-del-repository)
- [Configurazione Locale](#configurazione-locale)
  - [Backend (FastAPI + uvicorn)](#backend-fastapi--uvicorn)
  - [Frontend (Vite dev server)](#frontend-vite-dev-server)
- [Esecuzione in Modalità Demo](#esecuzione-in-modalità-demo)
- [Build per la Produzione (Docker)](#build-per-la-produzione-docker)
- [Aggiungere un Nuovo Tipo di Pagina](#aggiungere-un-nuovo-tipo-di-pagina)
- [Aggiungere una Nuova Stringa Localizzata](#aggiungere-una-nuova-stringa-localizzata)
- [Aggiungere un Nuovo Parametro Deep Config](#aggiungere-un-nuovo-parametro-deep-config)
- [Stile del Codice e Convenzioni](#stile-del-codice-e-convenzioni)

---

## Prerequisiti

| Strumento | Versione | Note |
|-----------|----------|------|
| Python | 3.12+ | Runtime backend |
| Node.js | 18+ | Build frontend |
| npm | 9+ | Package manager frontend |
| Docker | 24+ | Build produzione e test container |
| Docker Compose | v2 | Deployment locale |

Opzionali ma consigliati:
- Un'istanza Immich attiva (oppure usa la Modalità Demo per lo sviluppo)
- `httpie` o `curl` per testare le API

---

## Struttura del Repository

```
photobook-app-test/
├── backend/               Sorgente backend Python
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
│   ├── icc/               Profili ICC inclusi
│   └── requirements.txt
├── frontend/              Sorgente frontend React + Vite
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── locales/
│   │   ├── i18n.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── Dockerfile             Build multi-stage
├── docker-compose.yml     Deployment locale standard
├── docker-compose.hub.yml Deployment da immagine GHCR pre-costruita
└── railway.toml           Configurazione deployment Railway.app
```

---

## Configurazione Locale

### Backend (FastAPI + uvicorn)

1. **Crea e attiva un ambiente virtuale:**

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate      # Linux/macOS
# .venv\Scripts\activate       # Windows
```

2. **Installa le dipendenze:**

```bash
pip install -r requirements.txt
```

3. **Crea la directory dati:**

```bash
mkdir -p /tmp/photobook-dev/data
```

4. **Avvia il backend:**

```bash
DATA_DIR=/tmp/photobook-dev/data \
DEMO_MODE=true \
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Il flag `--reload` riavvia il server automaticamente ad ogni modifica dei sorgenti.

Variabili d'ambiente principali per lo sviluppo:

| Variabile | Valore consigliato |
|-----------|-------------------|
| `DATA_DIR` | `/tmp/photobook-dev/data` |
| `DEMO_MODE` | `true` |
| `PHOTOBOOK_TOKEN` | *(vuoto — disabilita auth in sviluppo)* |

Il backend è disponibile su `http://localhost:8000`.

### Frontend (Vite dev server)

1. **Installa le dipendenze Node:**

```bash
cd frontend
npm install
```

2. **Configura il proxy API:**

`frontend/vite.config.js` include già un proxy che reindirizza le richieste `/api/` al backend:

```js
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
}
```

3. **Avvia il Vite dev server:**

```bash
npm run dev
```

Il frontend è disponibile su `http://localhost:5173`. Tutte le chiamate API vengono proxate al backend sulla porta 8000.

Hot Module Replacement (HMR) è attivo: le modifiche ai componenti React si riflettono nel browser senza ricaricare la pagina.

---

## Esecuzione in Modalità Demo

Per lo sviluppo frontend puro (nessun Immich, nessun dato richiesto):

```bash
# Terminale 1 — backend
cd backend && DEMO_MODE=true uvicorn main:app --reload --port 8000

# Terminale 2 — frontend
cd frontend && npm run dev
```

Apri `http://localhost:5173`. L'app si carica con quattro album demo e profili pre-installati.

---

## Build per la Produzione (Docker)

Il `Dockerfile` usa un build multi-stage:

1. **Stage 1 — Node build**: installa le dipendenze npm ed esegue `npm run build` (Vite) producendo `frontend/dist/`
2. **Stage 2 — Python runtime**: copia `backend/` e `frontend/dist/` in un'immagine Python 3.12 slim, installa `requirements.txt` e avvia uvicorn

```bash
# Costruisci l'immagine
docker build -t photobook-studio:local .

# Esegui l'immagine
docker run -p 7180:8000 -v $(pwd)/dev-data:/data photobook-studio:local
```

Per testare la modalità demo con l'immagine costruita:

```bash
docker run -p 7180:8000 -e DEMO_MODE=true photobook-studio:local
```

---

## Aggiungere un Nuovo Tipo di Pagina

I tipi di pagina (layout slot) sono definiti per profilo nell'array `page_types`. Non sono hardcoded nel backend Python — il backend li tratta come puri dati. Se vuoi aggiungere un tipo di pagina **predefinito** che appare nei nuovi profili, aggiorna il template del profilo di default in `main.py` (cerca la logica di inizializzazione profilo nella route `POST /api/profiles`).

Per aggiungere un tipo di pagina personalizzato a un profilo esistente **tramite l'UI**: usa l'editor slot nella pagina Profili (vedi [Profili di Stampa](Print-Profiles-IT.md#leditor-di-profilo)).

Per aggiungere un tipo di pagina **programmaticamente** via API:

1. `GET /api/profiles/{id}` per recuperare il profilo
2. Aggiungi all'array `page_types`:

```json
{
  "label": "3 landscape + didascalia",
  "slots": [
    {"x": 0,  "y": 0,  "w": 33, "h": 80, "type": "photo"},
    {"x": 33, "y": 0,  "w": 34, "h": 80, "type": "photo"},
    {"x": 67, "y": 0,  "w": 33, "h": 80, "type": "photo"},
    {"x": 0,  "y": 80, "w": 100,"h": 20, "type": "caption"}
  ]
}
```

3. `PUT /api/profiles/{id}` con il profilo modificato

---

## Aggiungere una Nuova Stringa Localizzata

Tutto il testo visibile all'utente nel frontend deve essere localizzato. Non hardcodare mai stringhe nel JSX. È una convenzione di progetto applicata in code review.

### Passi

1. **Aggiungi la chiave e la stringa inglese a `frontend/src/locales/en.js`:**

```js
// en.js
export default {
  // ... chiavi esistenti ...
  myNewFeature: {
    title: "My New Feature",
    description: "This feature does something useful."
  }
}
```

2. **Aggiungi la stessa chiave con la traduzione italiana a `frontend/src/locales/it.js`:**

```js
// it.js
export default {
  // ... chiavi esistenti ...
  myNewFeature: {
    title: "La Mia Nuova Funzione",
    description: "Questa funzione fa qualcosa di utile."
  }
}
```

3. **Usa la chiave nel componente tramite l'hook `useI18n`:**

```jsx
import { useI18n } from '../i18n';

function MyComponent() {
  const t = useI18n();
  return <h1>{t.myNewFeature.title}</h1>;
}
```

### Regole

- Sia `en.js` che `it.js` devono contenere esattamente lo stesso albero di chiavi — chiavi mancanti causano errori runtime
- Usa oggetti annidati per raggruppare stringhe correlate (es. `profileEditor.save`, `profileEditor.delete`)
- Non usare mai la stringa raw direttamente nel JSX — passa sempre attraverso `t.chiave`

---

## Aggiungere un Nuovo Parametro Deep Config

I parametri Deep Config sono valori di tuning degli algoritmi esposti agli utenti avanzati tramite l'UI `/deep-config`.

### Passi

1. **Aggiungi il parametro con il suo valore di default a `backend/deep_config_defaults.json`:**

Trova la sezione appropriata (es. `"quality"`, `"face"`, `"performance"`) o creane una nuova:

```json
{
  "quality": {
    "sharpness_variance_divisor": 500,
    "my_new_parameter": 42
  }
}
```

2. **Usa il parametro nel codice backend tramite `config_loader.py`:**

```python
from config_loader import cfg

my_value = cfg("quality", "my_new_parameter")
```

3. **Aggiungi stringhe locale per l'etichetta e la descrizione del parametro** (segui i [passi sopra](#aggiungere-una-nuova-stringa-localizzata)):

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

4. **La DeepConfigPage renderizza i parametri dinamicamente** dalla risposta API, quindi non sono necessarie modifiche JSX — aggiungere solo la stringa locale garantisce l'etichetta corretta.

5. **Documenta il parametro** nel wiki nella pagina [Configurazione — Riferimento Sezioni Deep Config](Configuration-IT.md#riferimento-sezioni-deep-config).

### Tipi di Parametro

Il sistema deep config deduce il tipo di controllo UI dal valore di default JSON:
- `number` → input numerico con controlli step
- `boolean` → toggle switch
- `string` → input testo (usato per valori hex colore, ecc.)

---

## Stile del Codice e Convenzioni

### Python (backend)

- Type hints su tutte le firme di funzione
- `async def` per tutte le funzioni I/O-bound
- `snake_case` per variabili, funzioni e nomi modulo
- `PascalCase` per le classi
- Nessun import inutilizzato (applicato dal linting)

### JavaScript/React (frontend)

- Solo componenti funzionali (niente class component)
- `camelCase` per variabili e funzioni
- `PascalCase` per nomi di componenti e file
- Hook: prefisso `use` (es. `useI18n`, `useProfiles`)
- Ogni stringa visibile all'utente deve passare attraverso il sistema i18n (vedi sopra)
- Nessun colore o dimensione hardcoded nel JSX — usa variabili CSS o classi Tailwind

### Git Workflow

- Branch da `main` per le feature; branch dal branch di release per hotfix
- I messaggi di commit seguono Conventional Commits (`feat:`, `fix:`, `refactor:`, ecc.)
- Tutti i PR richiedono una Docker build riuscita prima del merge
