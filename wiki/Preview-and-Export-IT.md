# Anteprima ed Export

La pagina **Anteprima** (`/preview`) è l'editor interattivo dove rivedi e affini il layout generato prima di esportare. Questa pagina documenta ogni funzione di modifica ed entrambi i formati di export (PDF e SVG ZIP).

---

## Indice

- [Funzionalità dell'Anteprima Interattiva](#funzionalità-dellanteprima-interattiva)
- [Manipolazione delle Pagine](#manipolazione-delle-pagine)
- [Scambio e Assegnazione Foto](#scambio-e-assegnazione-foto)
- [Didascalie Inline](#didascalie-inline)
- [Editor Copertina](#editor-copertina)
- [Pagine Divisore](#pagine-divisore)
- [Visualizzazione Spread a Due Pagine](#visualizzazione-spread-a-due-pagine)
- [Modale Export](#modale-export)
- [Export PDF — Dettagli Tecnici](#export-pdf--dettagli-tecnici)
- [Export SVG — Dettagli Tecnici](#export-svg--dettagli-tecnici)
- [Sincronizzazione Didascalie su Immich](#sincronizzazione-didascalie-su-immich)

---

## Funzionalità dell'Anteprima Interattiva

La pagina di anteprima renderizza ogni pagina del libro come una rappresentazione scalabile usando la geometria degli slot definita nel profilo di stampa. L'elenco pagine è mostrato come uno scroll verticale di thumbnail di pagina.

### Pan e Zoom

Ogni pagina nell'anteprima supporta:

- **Zoom**: rotellina del mouse o gesto di pinch per ingrandire una pagina per un'ispezione dettagliata
- **Pan**: click e trascinamento per spostarsi nella vista mentre si è ingranditi

Questo ti permette di verificare il crop dei volti, il testo delle didascalie e le decisioni di layout sui dettagli piccoli senza dover esportare.

### Navigazione da Tastiera

- I tasti freccia scorrono tra le pagine
- `Escape` esce dalla modalità zoom
- `Z` reimposta lo zoom per adattarsi alla vista

---

## Manipolazione delle Pagine

### Aggiungere una Pagina

Fai clic su **Aggiungi pagina** (pulsante + nella barra laterale o nella toolbar) per inserire una pagina vuota. Puoi poi assegnare le foto ai suoi slot manualmente.

### Rimuovere una Pagina

Fai clic sull'icona **Elimina** su qualsiasi pagina per rimuoverla dal libro. Le foto assegnate alla pagina eliminata tornano nel pool delle non assegnate.

### Riordinare le Pagine

Le pagine possono essere riordinate con drag-and-drop nella barra laterale dell'elenco pagine. L'ordine di rendering si aggiorna immediatamente.

### Cambiare il Layout della Pagina

Ogni pagina ha un **selettore layout** accessibile dal suo menu contestuale. Selezionando un tipo di pagina diverso (layout slot) dal profilo si ricalcolano le posizioni degli slot per le assegnazioni foto correnti. Se il nuovo layout ha meno slot del corrente, le foto in eccesso vengono de-assegnate.

---

## Scambio e Assegnazione Foto

### Scambio tra Slot

Puoi trascinare una foto da uno slot a un altro (all'interno della stessa pagina o tra pagine diverse) per riordinarle. Il crop face-aware viene ricalcolato automaticamente quando una foto viene spostata in uno slot con un rapporto d'aspetto diverso.

### Sostituzione di una Foto

Fai clic su qualsiasi slot occupato e scegli **Sostituisci** per aprire il selettore asset. Il selettore mostra tutte le foto non assegnate dell'album corrente. Puoi anche cercare per nome file o data.

### De-assegnazione di una Foto

Fai clic destro su uno slot (o usa il menu contestuale) e scegli **Rimuovi foto**. Lo slot diventa vuoto e la foto torna nel pool delle non assegnate.

### Pool Foto Non Assegnate

Il pannello **Non assegnate** (accessibile dalla barra laterale) mostra tutte le foto dell'album che non sono state posizionate su nessuna pagina. Puoi trascinare le foto da questo pannello negli slot vuoti.

---

## Didascalie Inline

Gli slot didascalia (tipo `"caption"` nella definizione del tipo di pagina) mostrano un campo di testo inline nell'anteprima.

- Fai clic su qualsiasi slot didascalia per entrare in modalità modifica
- Digita o incolla il testo; il testo multilinea è supportato
- Premi `Enter` per una nuova riga, `Escape` o fai clic fuori per confermare
- Il testo della didascalia è memorizzato nel JSON della pagina e renderizzato verbatim nel PDF/SVG esportato

Il testo della didascalia è indipendente per ogni slot. Quando una foto ha anche una descrizione in Immich, questa viene pre-compilata nello slot didascalia durante la generazione del layout, ma puoi sovrascriverla.

Vedi [Sincronizzazione Didascalie su Immich](#sincronizzazione-didascalie-su-immich) per informazioni su come riscrivere le didascalie.

---

## Editor Copertina

L'editor **Copertina** è accessibile tramite la scheda **Copertina** in cima alla pagina Anteprima (o tramite il pulsante **Modifica Copertina**).

L'editor copertina mostra:
- **Copertina anteriore** (lato destro, recto)
- **Dorso** (striscia centrale, larghezza stimata dal numero di pagine e `body_paper_gsm`)
- **Copertina posteriore** (lato sinistro, verso)
- **Risvolti anteriore/posteriore** (se il profilo li definisce)

Ogni sezione della copertina usa le definizioni slot dall'array `cover` nel profilo di stampa. Puoi:
- Assegnare foto agli slot foto della copertina
- Modificare il testo di didascalia/titolo negli slot didascalia della copertina
- Cambiare il layout della copertina (usando i template dei tipi di pagina del profilo)

La larghezza stimata del dorso viene visualizzata e aggiornata dinamicamente man mano che aggiungi o rimuovi pagine.

---

## Pagine Divisore

Le **pagine divisore** sono pagine speciali inserite automaticamente tra i cluster di eventi durante la generazione smart layout. Fungono da separatori visivi di sezione.

Una pagina divisore contiene tipicamente:
- Un titolo evento (intervallo date, nome posizione se è disponibile il geocoding inverso GPS)
- Una mappa GPS che mostra le posizioni delle foto del cluster
- Una foto a tutta pagina del cluster (l'immagine di qualità più alta)

Puoi:
- **Modificare il testo del divisore** inline (come la modifica delle didascalie)
- **Sostituire la foto di sfondo** facendo clic sullo slot foto
- **Eliminare un divisore** se preferisci un flusso continuo tra le sezioni
- **Aggiungere un divisore** manualmente tra due pagine qualsiasi tramite il menu contestuale della pagina (clic destro)

---

## Visualizzazione Spread a Due Pagine

Fai clic su **Vista spread** (o premi `S`) per passare dalla visualizzazione a pagina singola a quella a due pagine affiancate. Questo simula il libro aperto mostrando le pagine sinistra (verso) e destra (recto) affiancate.

La vista spread è utile per:
- Verificare che le foto non creino conflitti visivi disturbanti attraverso il dorso
- Verificare che le foto a tutta pagina che si estendono su entrambe le pagine (se supportate dal tuo profilo) siano allineate
- Rivedere il ritmo generale del libro

Nota: gli slot foto che attraversano le pagine (bleed attraverso il dorso) non sono attualmente supportati; ogni pagina è indipendente.

---

## Modale Export

Fai clic su **Esporta** (pulsante in alto a destra nella toolbar di anteprima) per aprire il modale export.

### Opzioni di Export

| Opzione | Descrizione |
|---------|-------------|
| **Formato** | PDF o SVG ZIP |
| **DPI** | Sovrascrive il `export_dpi` del profilo per questo export (150–600) |
| **Profilo colore** | Sovrascrive il `color_profile` del profilo per questo export |
| **Includi copertina** | Se includere le pagine di copertina nell'export |
| **Intervallo pagine** | Esporta tutte le pagine o un intervallo specifico (es. pagine 3–10 per una ristampa) |
| **Bleed** | Attiva/disattiva il bleed per questo export (sovrascrive l'impostazione del profilo) |
| **Segni di taglio** | Attiva/disattiva i segni di taglio (disponibile solo se il bleed è attivo) |

Dopo aver fatto clic su **Esporta**, il server genera il file e il browser lo scarica automaticamente quando è pronto. I libri grandi (300 DPI, 100+ pagine) possono richiedere 30–90 secondi.

I profili ICC disponibili vengono recuperati da `GET /api/export/color_profiles` e elencati nel dropdown del modale.

---

## Export PDF — Dettagli Tecnici

Il PDF viene generato da `backend/pdf_generator.py` usando **ReportLab**.

### Processo

1. **Setup pagina**: il canvas ReportLab viene creato alle dimensioni dell'artboard (dimensioni rifilate + bleed su tutti i lati se attivato)
2. **Download foto**: le foto ad alta risoluzione vengono scaricate da Immich (o URL demo) in modo asincrono, fino a `concurrent_hires_downloads` alla volta (predefinito: 4)
3. **Elaborazione foto** (per ogni foto, tramite Pillow):
   - Ritaglia al rettangolo di crop memorizzato
   - Ridimensiona alle dimensioni dello slot al `export_dpi` (interpolazione bilineare)
   - Se profilo CMYK selezionato: applica la trasformazione colore ICC usando `ImageCms` di Pillow
   - Codifica JPEG al `jpeg_quality` (predefinito: 92)
4. **Rendering pagina** (ReportLab, per ogni pagina):
   - Disegna lo sfondo (bianco o colore definito dal profilo)
   - Per ogni slot foto: disegna l'immagine JPEG alle coordinate calcolate
   - Per ogni slot didascalia: disegna il testo con `caption_style` (font, dimensione, colore, allineamento, riempimento sfondo)
   - Per gli slot mappa GPS (titolo/divisore): disegna l'immagine mappa generata da `map_generator.py`
5. **Bleed e segni di taglio**: se `bleed` attivo, estende i riempimenti di sfondo al bordo di bleed; se `crop_marks` attivo, disegna linee da 0.25 pt in ogni angolo fuori dall'area di bleed con lunghezza `bleed_mark_length_mm`
6. **Incorporazione ICC**: il profilo ICC di output selezionato viene incorporato nel dizionario `OutputIntents` del PDF
7. **Dorso e copertina**: le pagine di copertina vengono renderizzate per prime (copertina anteriore, poi pagine corpo, poi copertina posteriore)

### Pagina Titolo

La pagina titolo (pagina 1) include:
- Una mappa GPS a tutta pagina che copre la parte superiore `title_page_map_height_frac` (predefinito: 0.6 = 60%) della pagina
- Una sfumatura sovrapposta che mescola la mappa con lo sfondo della pagina
- Testo titolo album (dal nome album di Immich) in carattere display grande
- Intervallo date delle foto dell'album

### Gestione Margini

I margini vengono applicati come offset a tutte le coordinate degli slot. Per la stampa duplex (fronte-retro), `margin_left` e `margin_right` vengono scambiati sulle pagine pari (pagine verso) in modo che il margine di rilegatura più largo sia sempre sul lato del dorso.

---

## Export SVG — Dettagli Tecnici

L'export SVG viene generato da `backend/svg_exporter.py`.

### Processo

1. Per ogni pagina viene creato un documento SVG standalone alle dimensioni rifilate (in mm, con `viewBox` in mm)
2. Le foto vengono scaricate, ritagliate, ridimensionate (dimensione massima: `max_image_dimension_px`, predefinito: 2000 px) e codificate in JPEG
3. Ogni JPEG viene codificato in base64 e incorporato come elemento `<image xlink:href="data:image/jpeg;base64,…">`
4. Il testo delle didascalie viene renderizzato come elementi `<text>` SVG con gli attributi `caption_style`
5. Le mappe GPS vengono incorporate come immagini base64 nello stesso modo
6. Se il bleed è attivo, le linee dei segni di taglio vengono disegnate come elementi `<line>` fuori dal riquadro rifilato
7. Tutti i file SVG delle pagine vengono raggruppati in un **archivio ZIP** e scritti in `/data/exports/{uuid}.zip`

### Vantaggi dell'Export SVG

- Le pagine sono **completamente modificabili** in editor vettoriali (Inkscape, Adobe Illustrator, Affinity Designer)
- Il testo rimane come elementi `<text>` (non rasterizzato), quindi può essere riformattato
- Utile per le tipografie che preferiscono file vettoriali o hanno bisogno di apportare aggiustamenti finali

### Limitazioni

- Le foto sono incorporate come JPEG rasterizzati (non vettoriali) — l'SVG non supporta la modifica dei crop delle foto
- La gestione del colore ICC non è incorporata nei file SVG; gestisci i profili colore a livello applicativo prima dell'export

---

## Sincronizzazione Didascalie su Immich

PhotoBook Studio può **riscrivere le didascalie su Immich** in modo che le descrizioni che elabori nell'editor del libro vengano conservate nella tua libreria Immich.

### Come Funziona

Quando fai clic su **Sincronizza didascalie su Immich** (nella toolbar Anteprima o nel modale Export), il frontend invia i dati delle didascalie correnti al backend. Per ogni foto che ha una didascalia non vuota:

```
PUT /api/assets/{asset_id}   (Immich API)
Body: { "description": "<testo didascalia>" }
```

Questo viene eseguito tramite `immich_client.update_asset_description(asset_id, description)`.

La didascalia viene salvata in Immich come campo EXIF **ImageDescription** dell'asset.

### Requisiti

- La chiave API Immich deve avere il permesso `Asset:Update`
- La modalità demo non supporta la sincronizzazione delle didascalie (le scritture vengono silenziosamente scartate)

### Comportamento in Caso di Conflitto

La sincronizzazione delle didascalie è una scrittura unidirezionale: sovrascrive la descrizione Immich esistente per ogni asset senza verificare la presenza di conflitti. Se un altro utente o processo ha aggiornato la descrizione in Immich tra l'ultimo caricamento e la sincronizzazione, quelle modifiche verranno sovrascritte. Non esiste un meccanismo di merge/diff.
