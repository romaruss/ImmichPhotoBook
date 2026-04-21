# PhotoBook Studio — Release Notes
## Versione 0.4.0 — Layout Intelligence & Debug UX

---

## Commit Message

```
feat: layout log viewer, EXIF orientation fix, SPA routing & UX fixes

BREAKING CHANGE (backend): generate_album() ora ritorna 4 valori invece di 3.
Aggiornare qualsiasi chiamata esterna: pages, transforms, log, page_logs = generate_album(...)

Novità principali:
- Log impaginazione interattivo (3 pannelli) richiamabile dall'anteprima di stampa
- Fix bug critico: bbox volti e photo_ar ignoravano il tag EXIF orientation (foto portrait
  trattate come landscape → crop sbagliato, pan sull'asse errato)
- Fix F5 su route React → 404: sostituito StaticFiles con SPA catch-all in FastAPI
- Fix drag slider non funzionante nel ConfigModal: SliderInput estratto a top-level
- Fix layout import in ProfilesPage: non richiedeva più save+refresh per vedere i nuovi layout
- Nuovo: export/import profilo di stampa integrale (JSON completo)
```

---

## CHANGELOG

### [0.4.0] - 2025-04-21

#### 🆕 Aggiunte

**Log impaginazione interattivo (`LogViewer.jsx`)**
- Nuovo pannello a 3 colonne richiamabile dall'anteprima con il pulsante **🔍 Log impaginazione**
- **Colonna sinistra**: lista di tutte le pagine dell'album con numero, nome layout scelto, gruppo (cluster temporale), punteggio del vincitore colorato (verde/oro/rosso), icone ⚠ per problemi (mismatch orientamento, volti tagliati, slot T vuoti), ★ per preferite. Filtro testo e checkbox "Solo pagine con problemi"
- **Colonna centrale**: dettaglio per ogni slot — thumbnail dell'asset, nome file, data, badge orientamento (↕V/↔H) per foto e slot con indicazione ✓/⚠ del match, aspect ratio fisici, bounding box volti visualizzata graficamente (rettangolo colorato su griglia 96×64px), indicatore pan (punto ciano su griglia 30×20px con coordinate x%/y%), testo descrizione Immich, pulsante "→ Vai alla pagina" che naviga direttamente nella preview
- **Colonna destra**: tutti i layout candidati valutati per quella pagina, ordinati dal punteggio più basso (vincitore 🏆) al più alto. Click espande il breakdown completo con barre colorate per i 7 componenti dello scoring: orientamento (×10.000), slot T vuoti (×5.000), slot vuoti eccessivi (n²×200), distanza densità target (×20), penalità volto tagliato, utilizzo layout (diversità), penalità ritmo visivo
- Badge "nuovo layout" (−30 bonus) e "penalità ritmo" (+4) mostrate inline
- Navigazione tastiera: ← Prec. / Succ. → tra le pagine nel footer
- Il pulsante appare solo dopo aver generato un layout; scompare automaticamente dopo un ricalcolo (i log diventerebbero stale)
- Supporto multi-album: i `page_logs` vengono mergiati con offset corretto per la numerazione pagine

**Export/Import profilo di stampa integrale**
- Nell'header della pagina di modifica profilo: pulsante **⬇ Esporta profilo** scarica un JSON completo con tutti i campi (formato, orientamento, margini indipendenti, gap, abbondanza, DPI, profilo colore, pagine tipo, stile copertina, stile didascalie)
- Pulsante **⬆ Importa profilo** carica il JSON e popola immediatamente tutti i campi del form. L'`id` viene rimosso per non sovrascrivere profili esistenti
- Utile per backup, condivisione tra installazioni, template predefiniti

#### 🐛 Bug risolti

**Bug critico: EXIF orientation ignorata nel calcolo crop/pan volti**
- **Causa**: `_photo_ar()`, `_photo_is_portrait()` e `_get_all_faces()` leggevano `exifImageWidth/Height` grezze, senza considerare il tag `orientation`. Le fotocamere reflex e molti telefoni salvano fisicamente i pixel come landscape (larghezza > altezza) e memorizzano la rotazione in `orientation=6` (90°CW) o `orientation=8` (90°CCW). Il risultato: una foto portrait (visualizzata 3024×4032) veniva trattata come landscape (ar=1.33 invece di 0.75)
- **Effetti del bug**:
  - `_photo_is_portrait()` → `False` per molte foto portrait → scoring orientamento penalizzava slot corretti, favoriva slot sbagliati
  - `_photo_ar()` → valore landscape → `_face_transform()` calcolava il pan sull'asse X invece di Y → `pan_y=50` fisso → i volti in alto nella foto portrait venivano tagliati
  - `_get_all_faces()` normalizzava le bbox con `img_w=4032, img_h=3024` (fisico) invece di `3024, 4032` (display) → coordinate X e Y scambiate
- **Fix**: nuova funzione `_display_dims(photo)` che legge `exifInfo.orientation` e swappa `w/h` per i valori 5, 6, 7, 8. Tutti e tre i punti bugati ora usano `_display_dims()`
- **Impatto**: migliora significativamente il crop/pan per tutte le foto scattate in portrait con reflex DSLR e la maggior parte dei telefoni Android

**F5 / hard refresh su route React → 404**
- **Causa**: `StaticFiles(directory=..., html=True)` serve solo file fisicamente presenti in `dist/`. Quando il browser richiede `/preview` o `/profiles` direttamente, FastAPI non trova nessun file corrispondente e restituisce 404
- **Fix**: rimosso il mount diretto. Aggiunto catch-all `GET /{full_path:path}` registrato **dopo** tutte le route `/api/`. Serve i file reali se esistono (favicon, JS, CSS), altrimenti ritorna sempre `index.html`. React Router gestisce la navigazione client-side

**Slider non trascinabili nel ConfigModal generazione album**
- **Causa**: `SliderInput` era definito come funzione inline dentro `ConfigModal`. Ad ogni change di stato (ogni movimento dello slider) React ri-eseguiva `ConfigModal`, creava una **nuova funzione** `SliderInput`, la riconosceva come componente diverso, smontava e rimontava il DOM → il drag si interrompeva al primo pixel di movimento
- **Fix**: `SliderInput` estratto come funzione top-level del modulo. Ora riceve `value` e `onChange` come prop invece del vecchio `k="..."`. React la riconosce sempre come la stessa componente

**Layout importati non visibili senza save+refresh**
- **Causa**: `<PageTypeEditor key={editing === 'new' ? 'new' : editing.id}>` aveva chiave statica. Anche dopo `set('page_types', nuoviLayout)`, React non rimontava il componente perché la key non era cambiata → il `PageTypeEditor` mostrava ancora i layout vecchi
- **Fix**: aggiunto stato `ptKey` (intero) che si incrementa a ogni import e a ogni apertura del profilo. La key diventa `key={\`${id}_${ptKey}\`}`, forzando il rimount immediato con i nuovi dati

#### ♻️ Refactoring / Miglioramenti tecnici

**Backend — struttura dati per pagina (album_generator.py)**
- `_score_page_type()`: aggiunto parametro `_return_breakdown=True` che restituisce un dict con tutti i valori intermedi (orient_violations, cap_unfilled, empty_slots, slot_target, face_penalty, usage, unused_bonus, rhythm_penalty, total)
- `_best_page_type()`: aggiunto parametro `_return_candidates=True` che restituisce la lista completa dei candidati con punteggi e breakdown, ordinata dal migliore
- `_make_pages_from_group()`: ora raccoglie `page_logs` — una entry strutturata per ogni pagina con candidati, slot detail (AR, orient match, faces bbox, transform), gruppo di clustering
- `generate_album()`: ritorna ora **4 valori**: `(pages, transforms, log_text, all_page_logs)`

**Backend — SPA routing (main.py)**
- Rimosso `StaticFiles(html=True)`
- `/assets/*` montato staticamente per JS/CSS
- Aggiunto route catch-all `/{full_path:path}` che serve file reali o `index.html`

**Frontend — flusso page_logs**
- `AlbumsPage`: single-album salva `page_logs` in sessionStorage insieme al layout; multi-album merggia i log con offset numerazione corretti
- `PreviewPage`: legge `page_logs` da sessionStorage, espone pulsante Log, azzera i log dopo ricalcolo

---

## File modificati in questo commit

```
backend/
  album_generator.py   — _display_dims(), fix EXIF orientation, page_logs strutturati
  main.py              — SPA catch-all routing

frontend/src/
  components/
    LogViewer.jsx      — NUOVO: pannello debug interattivo 3 colonne
  pages/
    AlbumsPage.jsx     — SliderInput top-level, page_logs in sessionStorage
    PreviewPage.jsx    — pulsante 🔍 Log, LogViewer render, page_logs clearing
    ProfilesPage.jsx   — ptKey fix, export/import profilo integrale
```

---

## Note per il deploy

1. Il backend ritorna ora **4 valori** da `generate_album()`. Se hai script o test che chiamano questa funzione direttamente, aggiorna il destructuring:
   ```python
   # Prima
   pages, transforms, log = generate_album(...)
   # Dopo
   pages, transforms, log, page_logs = generate_album(...)
   ```

2. Nessuna migrazione database richiesta. I profili esistenti sono compatibili.

3. I log di impaginazione sono in-memory e in sessionStorage: non persistono tra sessioni diverse o salvataggi progetto (by design — i log di un layout precedente non hanno senso dopo un ricalcolo).
