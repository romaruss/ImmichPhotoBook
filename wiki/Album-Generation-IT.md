# Generazione Album

La generazione album è il processo che trasforma un elenco grezzo di asset Immich in una sequenza ordinata di pagine con le foto assegnate agli slot. Questa pagina documenta ogni fase della pipeline, gli algoritmi coinvolti e tutti i parametri configurabili.

Il codice principale di generazione si trova in `backend/album_generator.py` (~1434 righe) e `backend/smart_layout.py` (~654 righe), coordinati tramite `backend/layout_engine.py` (~397 righe).

---

## Indice

- [Panoramica della Pipeline](#panoramica-della-pipeline)
- [Fase 1 — Clustering Temporale](#fase-1--clustering-temporale)
- [Fase 2 — Punteggio Qualità](#fase-2--punteggio-qualità)
- [Fase 3 — Rimozione Duplicati](#fase-3--rimozione-duplicati)
- [Fase 4 — Rilevamento Volti](#fase-4--rilevamento-volti)
- [Fase 5 — Selezione Layout](#fase-5--selezione-layout)
- [Fase 6 — Assegnazione Slot e Crop Face-Aware](#fase-6--assegnazione-slot-e-crop-face-aware)
- [Alternanza del Ritmo](#alternanza-del-ritmo)
- [Riempimento Mappa GPS](#riempimento-mappa-gps)
- [Parametro Densità](#parametro-densità)
- [Pipeline Smart Layout](#pipeline-smart-layout)
- [Parametri Deep Config](#parametri-deep-config)

---

## Panoramica della Pipeline

```
Lista asset Immich  (EXIF, GPS, bbox volti, descrizione)
        │
        ▼
1. cluster_events()
   Raggruppa le foto in eventi temporali (basato su intervallo di tempo)
        │
        ▼
2. score_quality()
   Assegna un punteggio di qualità a ogni foto
        │
        ▼
3. remove_duplicates()
   Elimina scatti quasi identici e burst
        │
        ▼
4. _get_all_faces()
   Legge i bounding box dei volti dai metadati Immich
        │
        ▼
5. _select_template()
   Sceglie il miglior tipo di layout pagina per ogni gruppo/pagina
        │
        ▼
6. _assign_slots()
   Assegna le foto agli slot; calcola il rettangolo di crop face-aware
        │
        ▼
   Lista di oggetti Page  →  risposta JSON al browser
```

Ogni fase è configurabile tramite il sistema [Deep Config](#parametri-deep-config).

---

## Fase 1 — Clustering Temporale

### Scopo

Raggruppare le foto in **eventi** (es. "escursione mattutina", "cena") in modo che ogni evento abbia la propria sezione nel libro, potenzialmente con una pagina divisore tra le sezioni.

### Algoritmo

1. Ordina tutti gli asset per `exif.dateTimeOriginal` (usa `fileCreatedAt` come fallback)
2. Itera attraverso la lista ordinata; calcola il delta temporale tra foto consecutive
3. Se il delta supera la **soglia di gap cluster** (predefinita: 60 minuti), inizia un nuovo cluster
4. Ogni cluster diventa un'unità indipendente per il layout

### Quando il clustering è disabilitato

Se l'utente disabilita il clustering nelle opzioni di generazione, tutte le foto vengono inserite in un singolo cluster e trattate come una sequenza continua.

### Parametri

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `cluster_gap_minutes` | 60 | Intervallo di tempo (minuti) che avvia un nuovo cluster evento |
| `min_cluster_size` | 2 | I cluster con meno foto di questo valore vengono uniti al cluster precedente |

---

## Fase 2 — Punteggio Qualità

### Scopo

Classificare le foto in modo che quelle migliori ottengano posizionamento prioritario (slot a pagina intera, posizioni prominenti) e le foto di qualità molto bassa possano essere filtrate o relegate a slot più piccoli.

### Formula del Punteggio

```
quality_score = (w_resolution × score_resolution)
              + (w_sharpness  × score_sharpness)
              + (w_brightness × score_brightness)
```

Tutti i punteggi componenti sono normalizzati a `[0, 1]` prima della pesatura.

### Punteggio Risoluzione

```
score_resolution = min(1.0, (width × height) / (megapixel_reference × 1_000_000))
```

`megapixel_reference` (predefinito: 12 MP) è il riferimento target. Le foto a questa risoluzione o superiore ottengono 1.0; al di sotto, il punteggio scala linearmente.

### Punteggio Nitidezza

La nitidezza viene stimata utilizzando la **varianza del Laplaciano** dell'immagine:

1. Decodifica il thumbnail (scaricato via endpoint thumb di Immich)
2. Converti in scala di grigi
3. Applica un kernel Laplaciano (rilevamento bordi)
4. Calcola la varianza della mappa risultante

```
score_sharpness = min(1.0, laplacian_variance / sharpness_variance_divisor)
```

Alta varianza = bordi nitidi = alta nitidezza. `sharpness_variance_divisor` (predefinito: 500) è il divisore di normalizzazione.

### Punteggio Luminosità

```
mean_brightness = valore medio dei pixel del thumbnail in scala di grigi  (0–255)
score_brightness = 1 - |mean_brightness - brightness_target| / brightness_target
```

`brightness_target` (predefinito: 128) è la luminosità media ideale. Le foto molto scure o molto sovraesposte ottengono un punteggio più basso.

### Filtraggio

Le foto con `quality_score < min_quality_threshold` vengono escluse dal layout. Questa soglia è predefinita a 0.2 e può essere alzata per imporre requisiti di qualità più severi.

### Pesi

| Parametro | Predefinito |
|-----------|-------------|
| `weight_resolution` | 0.4 |
| `weight_sharpness` | 0.4 |
| `weight_brightness` | 0.2 |

---

## Fase 3 — Rimozione Duplicati

### Scopo

Rimuovere gli scatti ridondanti: fotogrammi quasi identici da riprese in burst, o importazioni accidentalmente duplicate.

### dHash (Difference Hash)

dHash è un algoritmo di **hash percettivo**:

1. Ridimensiona il thumbnail a `(dhash_size + 1) × dhash_size` pixel (predefinito: 9×8 = 72 pixel)
2. Converti in scala di grigi
3. Per ogni riga, confronta la luminosità dei pixel adiacenti: se sinistra > destra → bit 1, altrimenti → bit 0
4. Risultato: un hash a 64 bit

Due foto sono considerate duplicati se la distanza di Hamming del loro dHash è inferiore alla **soglia duplicati** (predefinita: 0.83, ossia ≤ 83% di bit diversi — equivalentemente, ≥ 17% di similarità).

```
are_duplicates = (hamming_distance(hash_a, hash_b) / hash_bits) <= duplicate_threshold
```

Quando vengono trovati duplicati, quello con il **punteggio di qualità più alto** viene mantenuto; gli altri vengono scartati.

### Rilevamento Burst

Oltre all'hash percettivo, gli scatti burst vengono rilevati combinando due segnali:

- **Stessa posizione GPS**: le coordinate GPS arrotondate a `gps_coord_rounding` decimali (predefinito: 3, ≈ 111 m di precisione) devono coincidere
- **Finestra temporale breve**: foto scattate entro `burst_time_window_base_sec` secondi l'una dall'altra (predefinito: 10 s)

Quando entrambe le condizioni sono soddisfatte, il gruppo viene trattato come un burst e viene mantenuta solo la foto con la qualità più alta.

### Parametri

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `dhash_size` | 8 | Dimensione griglia hash (produce `dhash_size²` bit) |
| `duplicate_threshold` | 0.83 | Soglia rapporto distanza di Hamming |
| `burst_time_window_base_sec` | 10 | Secondi massimi tra fotogrammi burst |
| `gps_coord_rounding` | 3 | Decimali per l'arrotondamento GPS nel rilevamento burst |

---

## Fase 4 — Rilevamento Volti

### Come Immich Fornisce i Dati sui Volti

Immich esegue il riconoscimento facciale automaticamente quando la funzione è abilitata. Per ogni asset, le API Immich restituiscono un array di oggetti volto, ciascuno con:

- `boundingBoxX1`, `boundingBoxY1`, `boundingBoxX2`, `boundingBoxY2` — coordinate pixel del bounding box del volto
- `imageWidth`, `imageHeight` — dimensioni complete dell'immagine (usate per la normalizzazione)
- `person.id`, `person.name` — identità della persona collegata (se assegnata)

PhotoBook Studio normalizza questi valori nell'intervallo `[0.0, 1.0]`:

```
face_x1 = boundingBoxX1 / imageWidth
face_y1 = boundingBoxY1 / imageHeight
face_x2 = boundingBoxX2 / imageWidth
face_y2 = boundingBoxY2 / imageHeight
```

### Unione di Box Sovrapposti

Quando una foto contiene più volti (es. una foto di gruppo), `_get_face_region()` calcola un **bounding box unificato** che comprende tutti i volti rilevati:

```
merged_x1 = min(face.x1 per tutti i volti)
merged_y1 = min(face.y1 per tutti i volti)
merged_x2 = max(face.x2 per tutti i volti)
merged_y2 = max(face.y2 per tutti i volti)
```

Questo box unificato viene usato come target per il crop face-aware.

### Classificazione Dimensione Volto

- **Volto prominente**: area del bounding box > `prominent_threshold` (predefinito: 0.05 = 5% dell'area immagine). Queste foto sono preferite per slot a pagina intera o grandi.
- **Primo piano**: area del bounding box > `close_up_threshold` (predefinito: 0.15). Queste sono fortemente preferite per slot a pagina intera.

---

## Fase 5 — Selezione Layout

### Punteggio Template

Per ogni pagina (o gruppo evento), l'algoritmo assegna un punteggio a ogni **tipo di pagina** disponibile (layout slot) del profilo:

```
template_score = base_score
               - penalty_orientation_violation  (se orientamento foto ≠ orientamento slot)
               - penalty_empty_caption_slot      (se non c'è testo didascalia disponibile)
               + bonus_caption_match             (se slot didascalia disponibile E testo presente)
               - face_clip_penalty_weight × estimated_face_clip_fraction
               - rhythm_alternation_penalty      (se stesso template usato nella pagina precedente)
               - layout_reuse_penalty × reuse_count
```

Il template con il punteggio più alto viene selezionato per quella pagina.

### Override Basato su Volti

Le foto con volti prominenti (`prominent_threshold`) saltano il punteggio e vengono direttamente assegnate allo **slot a pagina intera** se disponibile nel profilo. Questo garantisce che i ritratti non vengano mai relegati a slot piccoli.

Anche le foto con il flag **"preferita"** impostato in Immich ricevono un posizionamento preferenziale a pagina intera.

### Parametri

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `penalty_orientation_violation` | 2.0 | Penalità punteggio per mancata corrispondenza orientamento foto/slot |
| `penalty_empty_caption_slot` | 0.5 | Penalità per slot didascalia sprecato |
| `bonus_caption_match` | 1.0 | Bonus quando lo slot didascalia è usato e il testo è disponibile |
| `face_clip_penalty_weight` | 3.0 | Peso per penalizzare i layout che taglierebbero i volti |
| `rhythm_alternation_penalty` | 0.3 | Penalità per usare lo stesso layout della pagina precedente |
| `layout_reuse_penalty` | 0.1 | Penalità aggiuntiva per ogni riutilizzo consecutivo |

---

## Fase 6 — Assegnazione Slot e Crop Face-Aware

### Assegnazione

Una volta selezionato un template per una pagina, le foto vengono assegnate agli slot. L'assegnazione cerca di abbinare l'orientamento della foto a quello dello slot (foto landscape → slot landscape, foto portrait → slot portrait). Se ci sono più foto che slot, le foto in eccesso vengono portate alla pagina successiva.

### Crop Face-Aware

Per ogni slot `"photo"`, viene calcolato un **rettangolo di crop** in modo che il volto del soggetto rimanga centrato e visibile nello slot renderizzato.

L'algoritmo:

1. Calcola il rapporto d'aspetto dello slot: `slot_w / slot_h`
2. Ritaglia l'immagine sorgente a questo rapporto d'aspetto (massimizzando l'area di crop)
3. Se la foto ha dati sui volti:
   a. Calcola il centro del bounding box unificato dei volti: `(face_cx, face_cy)`
   b. Applica la correzione `target_y_position` (predefinita: 0.35) — i volti vengono posizionati leggermente sopra il centro (regola dei terzi)
   c. Sposta la finestra di crop in modo che il centro del volto cada a `target_y_position × crop_height` dall'alto
   d. Controlla l'**evitamento del taglio**: se la finestra di crop taglierebbe un bordo del bounding box di più di `clip_check_margin` (predefinito: 0.05 = 5%), sposta la finestra per includere il volto completo
   e. Applica `pan_margin` (predefinito: 0.1) — mantieni un buffer di almeno il 10% della dimensione del crop intorno al volto per evitare un inquadratura troppo stretta
4. Se non ci sono dati sui volti: crop centrato

Il risultato è un rettangolo `{crop_x, crop_y, crop_w, crop_h}` espresso come coordinate pixel nell'immagine ad alta risoluzione, che viene memorizzato nel JSON della pagina e usato al momento del rendering PDF/SVG.

### Parametri

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `min_face_size` | 0.02 | Frazione minima dell'area bbox volto da considerare (i volti più piccoli vengono ignorati) |
| `clip_check_margin` | 0.05 | Frazione della dimensione del crop sotto la quale il taglio del volto è tollerato |
| `prominent_threshold` | 0.05 | Frazione dell'area volto sopra la quale un volto è "prominente" |
| `pan_margin` | 0.1 | Buffer minimo intorno al volto come frazione della dimensione del crop |
| `target_y_position` | 0.35 | Posizione verticale del centro del volto nel crop (0 = alto, 1 = basso) |
| `close_up_threshold` | 0.15 | Frazione dell'area volto sopra la quale la foto è trattata come primo piano |

---

## Alternanza del Ritmo

L'alternanza del ritmo impedisce che il libro risulti monotono penalizzando il riutilizzo dello stesso layout di pagina su pagine consecutive. Questo è controllato da `rhythm_alternation_penalty` e `layout_reuse_penalty` nella formula di punteggio.

Un libro equilibrato alterna tra:
- Spread a pagina intera (singola foto grande)
- Pagine multi-slot (2–4 foto)
- Pagine con didascalia (testo + foto)
- Pagine divisore (mappa GPS o intestazione evento)

---

## Riempimento Mappa GPS

Quando uno slot di pagina non può essere riempito con una foto (perché il cluster ha meno foto degli slot), lo slot può essere riempito con una **mappa GPS** invece di lasciarlo vuoto.

La mappa viene generata da `map_generator.py`:
- Raccoglie tutte le coordinate GPS dalle foto nel cluster corrente
- Raggruppa i punti vicini e disegna una linea di percorso che li collega cronologicamente
- Renderizza un'immagine tile (Stadia Maps o OSM staticmap)
- Vengono posizionati marker colorati in ogni cluster GPS

Il riempimento mappa viene attivato automaticamente quando l'opzione `use_map_fill` è abilitata nelle opzioni di generazione.

I parametri della mappa sono configurabili:

| Parametro | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `marker_color` | `"#e74c3c"` | Colore esadecimale per i marker GPS |
| `marker_size` | 8 | Raggio del marker in pixel |
| `route_width` | 2 | Larghezza della linea di percorso in pixel |
| `background_color` | `"#f8f9fa"` | Colore di sfondo fallback |
| `grid_color` | `"#dee2e6"` | Colore delle linee della griglia |
| `grid_lines` | 5 | Numero di linee griglia per asse |
| `bbox_padding_deg` | 0.05 | Gradi di padding intorno al bounding box GPS |

---

## Parametro Densità

L'impostazione **densità** controlla quante foto vengono inserite in media per pagina. È un moltiplicatore applicato al conteggio degli slot nella selezione dei template:

- `density = 1.0` (predefinito) — usa il numero naturale di slot di ogni template
- `density < 1.0` — preferisce template con meno slot (più spazio bianco, foto più grandi)
- `density > 1.0` — preferisce template con più slot (più foto per pagina, più piccole)

Questa è un'opzione esposta all'utente nel form di generazione di **AlbumsPage**, non un parametro deep config.

---

## Pipeline Smart Layout

`smart_layout.py` avvolge `album_generator` per fornire una modalità **auto-layout** di alto livello accessibile via `POST /api/generate/smart`.

Differenze rispetto alla generazione standard:

1. Itera su tutti i cluster e genera le pagine cluster per cluster
2. Inserisce automaticamente **pagine divisore** tra i cluster (con intestazione data/posizione evento)
3. Esegue un passaggio aggiuntivo per bilanciare il numero di pagine per cluster (evita che una sezione sia molto più lunga delle altre)
4. Tenta di posizionare la **foto migliore** di ogni cluster nella sua prima pagina

Lo smart layout è il punto di partenza consigliato per un nuovo libro; il risultato può poi essere affinato nell'anteprima interattiva.

---

## Parametri Deep Config

Tutti i parametri di generazione sono gestiti tramite il [sistema Deep Config](Configuration-IT.md#sistema-deep-config). Sono raggruppati in sezioni:

| Sezione | Parametri |
|---------|-----------|
| `quality` | `sharpness_variance_divisor`, `brightness_target`, `megapixel_reference`, `histogram_bins`, `weight_resolution`, `weight_sharpness`, `weight_brightness` |
| `face` | `min_face_size`, `clip_check_margin`, `prominent_threshold`, `pan_margin`, `target_y_position`, `close_up_threshold` |
| `duplicates` | `dhash_size`, `duplicate_threshold`, `burst_time_window_base_sec`, `gps_coord_rounding` |
| `layout_scoring` | `penalty_orientation_violation`, `penalty_empty_caption_slot`, `bonus_caption_match`, `face_clip_penalty_weight`, `rhythm_alternation_penalty`, `layout_reuse_penalty` |
| `map` | `marker_color`, `marker_size`, `route_width`, `background_color`, `grid_color`, `grid_lines`, `bbox_padding_deg` |
| `pdf` | `jpeg_quality`, `bleed_mark_length_mm`, `title_page_map_height_frac`, `caption_font_size_factor` |
| `svg` | `max_image_dimension_px`, `jpeg_quality`, `title_font_size` |
| `performance` | `max_hires_photos`, `concurrent_hires_downloads`, `concurrent_thumb_downloads`, `pdf_timeout_per_page_sec` |

Vedi [Configurazione — Riferimento Sezioni Deep Config](Configuration-IT.md#riferimento-sezioni-deep-config) per informazioni su come modificare questi parametri.
