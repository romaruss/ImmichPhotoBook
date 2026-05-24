# Profili di Stampa

Un **profilo di stampa** definisce tutto ciò che riguarda il libro fisico che vuoi produrre: dimensioni della pagina, margini, layout degli slot, stile delle didascalie, impostazioni bleed e parametri di output del colore. I profili sono salvati come file JSON in `/data/profiles/` e possono essere creati, modificati, duplicati ed eliminati dalla pagina **Profili** nell'interfaccia.

---

## Indice

- [Cos'è un Profilo?](#cosè-un-profilo)
- [Riferimento Campi del Profilo](#riferimento-campi-del-profilo)
- [Catalogo Dimensioni Pagina](#catalogo-dimensioni-pagina)
- [Il Sistema Slot](#il-sistema-slot)
- [L'Editor Profili](#leditor-profili)
- [Copertina e Dorso](#copertina-e-dorso)
- [Bleed e Segni di Taglio](#bleed-e-segni-di-taglio)
- [Margini — Uniformi, Per Lato e Duplex](#margini--uniformi-per-lato-e-duplex)
- [Stile Didascalie](#stile-didascalie)
- [Profili Colore](#profili-colore)
- [Guida DPI per l'Export](#guida-dpi-per-lexport)

---

## Cos'è un Profilo?

Un profilo è un template riutilizzabile che descrive le **proprietà fisiche e visive** di un libro. Una volta creato un profilo (es. "A4 Portrait — Album di Famiglia"), puoi usarlo per più progetti. Modificare il profilo aggiorna il layout per tutte le generazioni future; i progetti già salvati mantengono le impostazioni del profilo al momento del salvataggio.

I profili sono salvati come `{uuid}.json` in `/data/profiles/`. L'endpoint `GET /api/profiles` restituisce tutti i profili; `POST /api/profiles` ne crea uno nuovo.

---

## Riferimento Campi del Profilo

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `name` | string | Nome del profilo leggibile |
| `page_size` | string | Una delle dimensioni predefinite o `"custom"` |
| `orientation` | `"portrait"` \| `"landscape"` | Orientamento della pagina |
| `margin_mm` | number | Margine uniforme applicato a tutti e quattro i lati (mm). Sostituito dai campi per lato se presenti |
| `margin_top` | number | Margine superiore (mm) — se impostato, sovrascrive `margin_mm` per il bordo superiore |
| `margin_right` | number | Margine destro (mm) |
| `margin_bottom` | number | Margine inferiore (mm) |
| `margin_left` | number | Margine sinistro (mm) |
| `bleed` | boolean | Abilita l'area di bleed (per la stampa offset) |
| `bleed_mm` | number | Dimensione del bleed in mm (tipicamente 3 mm) |
| `gap_mm` | number | Spazio tra gli slot in una pagina (mm) |
| `page_types` | array | Array di definizioni layout pagina (slot) — vedi [Sistema Slot](#il-sistema-slot) |
| `caption_style` | object | Stile testo didascalie globale — vedi [Stile Didascalie](#stile-didascalie) |
| `cover` | array | Configurazione copertina a 5 elementi — vedi [Copertina e Dorso](#copertina-e-dorso) |
| `export_dpi` | number | Risoluzione target per la rasterizzazione delle foto (150–600) |
| `color_profile` | string | Profilo colore ICC per l'output — vedi [Profili Colore](#profili-colore) |
| `crop_marks` | boolean | Includi i segni di taglio sulle pagine con bleed |
| `body_paper_gsm` | number | Grammatura della carta (g/m²) usata per stimare la larghezza del dorso |
| `map_style` | string | Nome stile Stadia Maps per le mappe GPS (es. `"stamen_terrain"`) |

---

## Catalogo Dimensioni Pagina

| ID | Dimensioni (mm) | Uso Comune |
|----|----------------|-----------|
| `a5` | 148 × 210 | Copertina morbida piccola, album tascabile |
| `a4` | 210 × 297 | Stampa standard ufficio/casa |
| `a3` | 297 × 420 | Grande formato da tavolo |
| `20x20` | 200 × 200 | Libro da tavolino quadrato |
| `20x30` | 200 × 300 | Copertina morbida portrait |
| `30x30` | 300 × 300 | Grande copertina rigida quadrata |
| `30x40` | 300 × 400 | Grande copertina rigida portrait |
| `letter` | 215.9 × 279.4 | Formato US Letter |
| `custom` | definito dall'utente | Qualsiasi larghezza × altezza in mm |

Le dimensioni si riferiscono alla pagina **rifilata** (dopo la rimozione del bleed). Quando il bleed è attivo, l'artboard effettivo (media box del PDF) è più grande di `bleed_mm` su ogni lato.

L'orientamento (`portrait` / `landscape`) scambia larghezza e altezza dove applicabile. I formati quadrati (`20x20`, `30x30`) sono neutri rispetto all'orientamento.

---

## Il Sistema Slot

Un **tipo di pagina** definisce come foto e didascalie sono disposti su una singola pagina. È composto da:

- `label` — nome visualizzato nell'editor (es. `"2 foto affiancate"`)
- `slots` — un array di oggetti slot

### Oggetto Slot

```json
{
  "x": 0,
  "y": 0,
  "w": 50,
  "h": 100,
  "type": "photo"
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `x` | number | Bordo sinistro come percentuale (0–100) della larghezza dell'area contenuto della pagina |
| `y` | number | Bordo superiore come percentuale (0–100) dell'altezza dell'area contenuto della pagina |
| `w` | number | Larghezza come percentuale (0–100) della larghezza dell'area contenuto della pagina |
| `h` | number | Altezza come percentuale (0–100) dell'altezza dell'area contenuto della pagina |
| `type` | `"photo"` \| `"caption"` | Se questo slot contiene una foto o una didascalia testuale |

Tutte le coordinate sono **relative all'area contenuto** (pagina meno margini). Uno slot che riempie l'intera pagina è `{x:0, y:0, w:100, h:100}`.

### Esempi di Tipi di Pagina

**Pagina intera (1 foto):**
```json
{
  "label": "Full page",
  "slots": [
    { "x": 0, "y": 0, "w": 100, "h": 100, "type": "photo" }
  ]
}
```

**Due foto affiancate:**
```json
{
  "label": "2 columns",
  "slots": [
    { "x": 0,  "y": 0, "w": 50, "h": 100, "type": "photo" },
    { "x": 50, "y": 0, "w": 50, "h": 100, "type": "photo" }
  ]
}
```

**Foto con barra didascalia in basso:**
```json
{
  "label": "Photo + caption",
  "slots": [
    { "x": 0,  "y": 0,  "w": 100, "h": 85, "type": "photo"   },
    { "x": 0,  "y": 85, "w": 100, "h": 15, "type": "caption" }
  ]
}
```

### Regole degli Slot

- Un tipo di pagina può avere da **1 a 6 slot**
- Gli slot non devono essere adiacenti né riempire l'intera pagina; gli spazi tra gli slot sono resi come sfondo della pagina
- Il parametro `gap_mm` del profilo aggiunge spaziatura visiva tra slot adiacenti al momento del rendering (le percentuali degli slot definiscono l'area foto incluso il gap)
- Gli slot foto usano il crop face-aware per impostazione predefinita (vedi [Generazione Album](Album-Generation-IT.md))
- Gli slot didascalia mostrano il testo della descrizione della foto

---

## L'Editor Profili

La pagina **Profili** (`/profiles`) include un editor visivo degli slot:

1. Seleziona un tipo di pagina dall'elenco (o fai clic su **Aggiungi tipo pagina**)
2. Il canvas mostra la pagina con handle degli slot trascinabili/ridimensionabili
3. **Trascina** un bordo dello slot per ridimensionare gli slot adiacenti — si agganciano a una griglia configurabile
4. Lo **snap** è abilitato per impostazione predefinita: i bordi degli slot si agganciano alle frazioni comuni (25%, 33.3%, 50%, 66.6%, 75%) più i bordi dei margini
5. Fai clic su uno slot per cambiarne il tipo (`photo` / `caption`) o rimuoverlo
6. Fai clic su **Aggiungi slot** per aggiungere un nuovo slot al tipo di pagina corrente
7. Le modifiche vengono salvate facendo clic su **Salva profilo**

L'editor impone che le coordinate degli slot rimangano entro `0–100` e impedisce dimensioni negative.

---

## Copertina e Dorso

Il campo `cover` è un array a 5 elementi che descrive il layout della copertina:

```
cover[0]  Copertina anteriore
cover[1]  Copertina posteriore
cover[2]  Dorso
cover[3]  Risvolto anteriore (per formati a sovraccoperta/avvolgimento)
cover[4]  Risvolto posteriore
```

Ogni elemento segue lo stesso formato slot/stile di un tipo di pagina del corpo. La **larghezza del dorso** viene stimata automaticamente da:

```
spine_width_mm = page_count × paper_thickness_per_page
paper_thickness_per_page ≈ body_paper_gsm / 1000 × 0.1 mm/gsm  (approssimata)
```

Questa stima viene usata per i calcoli del layout di copertina. Il valore effettivo varierà a seconda della stampante e del tipo di carta — verifica sempre con il tuo fornitore di stampa.

---

## Bleed e Segni di Taglio

Il **bleed** è un'area dell'immagine extra che si estende oltre il bordo finale di rifilatura, utilizzata nella stampa offset professionale per evitare sbavature bianche ai bordi della pagina dovute alle tolleranze di taglio.

Quando `bleed: true`:

- L'artboard del PDF (media box) viene espanso di `bleed_mm` su tutti e quattro i lati
- Le foto e gli sfondi vengono estesi per riempire l'area di bleed
- Se `crop_marks: true`, vengono disegnati sottili segni di registro fuori dall'area di bleed per guidare la taglierina

**Impostazioni tipiche di bleed:**
- `bleed_mm: 3` — standard per la maggior parte delle stampanti offset
- `bleed_mm: 5` — tolleranza maggiore per alcune stampanti digitali

Le dimensioni della pagina rifilata (finita) corrispondono sempre alle dimensioni di `page_size`; il bleed è aggiuntivo.

---

## Margini — Uniformi, Per Lato e Duplex

### Margine uniforme

Imposta `margin_mm` su un singolo valore. Tutti e quattro i lati usano lo stesso margine.

### Margini per lato

Imposta uno qualsiasi tra `margin_top`, `margin_right`, `margin_bottom`, `margin_left`. Qualsiasi campo presente sovrascrive il valore di `margin_mm` per quel lato.

```json
{
  "margin_mm": 10,
  "margin_left": 20
}
```

Nell'esempio sopra, il margine sinistro è 20 mm (lato rilegatura) e tutti gli altri sono 10 mm.

### Inversione duplex (rilegatura)

Quando un libro viene stampato fronte-retro e rilegato, il **margine interno** (lato rilegatura) deve essere più largo di quello esterno. In modalità duplex, PhotoBook Studio scambia automaticamente `margin_left` e `margin_right` sulle pagine pari in modo che il margine più largo sia sempre verso il dorso. Questo viene applicato al momento del rendering del PDF — definisci i margini per le pagine dispari (recto) e l'inversione è automatica per le pagine pari (verso).

---

## Stile Didascalie

L'oggetto `caption_style` controlla come appare il testo negli slot di tipo `"caption"`:

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `font` | string | Nome della famiglia di font (deve essere disponibile nel registro font di ReportLab) |
| `size` | number | Dimensione base del font in punti |
| `color` | string | Colore CSS esadecimale per il testo (es. `"#222222"`) |
| `align` | `"left"` \| `"center"` \| `"right"` | Allineamento del testo |
| `bg` | string | Colore di riempimento dello sfondo per lo slot didascalia (es. `"#ffffff"` o `"transparent"`) |

Il testo è multilinea; le didascalie lunghe vengono mandate a capo automaticamente e, se superano l'altezza dello slot, troncate con i puntini di sospensione.

---

## Profili Colore

Il campo `color_profile` seleziona il profilo ICC incorporato nel PDF esportato. Questo è fondamentale per la stampa professionale perché i monitor consumer usano sRGB (RGB additivo) mentre le presse offset usano CMYK (inchiostro sottrattivo). Fornire il profilo ICC corretto permette ai RIP di stampa di convertire i colori con precisione.

| Valore | Profilo | Spazio colore | Note |
|--------|---------|--------------|-------|
| `srgb` | IEC 61966-2-1 sRGB | RGB | Predefinito. Adatto per stampanti home/office e consegna PDF digitale |
| `adobe_rgb` | Adobe RGB (1998) | RGB | Gamut più ampio di sRGB. Torna a sRGB se non incluso |
| `fogra39` | ISO Coated v2 (FOGRA39) | CMYK | Standard europeo per stampa offset. Incluso |
| `fogra51` | ISO Coated v2 300% (FOGRA51) | CMYK | Variante a limite inchiostro ridotto. Torna a sRGB se non incluso |
| `swop` | SWOP v2 | CMYK | Standard offset USA. Torna a sRGB se non incluso |

I profili contrassegnati come **inclusi** sono presenti nell'immagine Docker dentro `backend/icc/`. I profili che tornano a sRGB non sono inclusi per restrizioni di licenza; puoi aggiungerli manualmente al container se necessario.

### Perché il CMYK è importante

I PDF sRGB sono tecnicamente validi per la stampa, ma i colori potrebbero cambiare quando il RIP della pressa li converte. Se ordini da una stamperia professionale, chiedi quale profilo ICC richiedono — la maggior parte delle stamperie europee specifica FOGRA39. Usa `fogra39` per l'output più prevedibile.

---

## Guida DPI per l'Export

Il campo `export_dpi` controlla la risoluzione alla quale le foto vengono rasterizzate quando incorporate nel PDF. Un DPI più alto significa file più grandi e tempi di export più lunghi.

| DPI | Caso d'uso | Dimensione file |
|-----|-----------|----------------|
| 150 | PDF per schermo/web, anteprima rapida | Piccola |
| 200 | Stampa digitale economica | Media |
| 300 | Stampa professionale standard (consigliato) | Media-grande |
| 400 | Stampa di alta qualità con dettagli fini | Grande |
| 600 | Qualità massima, stampa grande formato | Molto grande |

**Raccomandazione:** usa **300 DPI** per i fotolibri standard ordinati da un servizio di stampa on-demand. 150 DPI è sufficiente per l'anteprima su schermo. 600 DPI è necessario solo per stampe di formato molto grande (A2+) o con dettagli in primo piano estremo.

La risoluzione effettiva di rendering dipende anche dalla risoluzione della foto sorgente in Immich. Se l'immagine sorgente ha una risoluzione inferiore a quella richiesta da `export_dpi` per le dimensioni dello slot, Pillow la ingrandirà (con interpolazione), il che può produrre una visibile morbidezza. Il sistema di punteggio qualità (vedi [Generazione Album](Album-Generation-IT.md)) penalizza le foto a bassa risoluzione per evitare questo problema.
