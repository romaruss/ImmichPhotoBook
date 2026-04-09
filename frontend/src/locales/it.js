// locales/it.js — Italiano (default)
export default {
  // ── App shell ──────────────────────────────────────────────────────────────
  app: {
    title: 'PhotoBook',
    subtitle: 'Studio',
    tagline: 'Print Designer',
  },
  nav: {
    config:   'Configurazione',
    profiles: 'Profili di stampa',
    albums:   'Album & Layout',
    preview:  'Anteprima & Export',
  },
  connection: {
    connected:    'Immich connesso',
    disconnected: 'Non connesso',
    checking:     'Verifica…',
  },

  // ── Config page ────────────────────────────────────────────────────────────
  config: {
    title:       'Configurazione',
    subtitle:    'Connetti PhotoBook Studio al tuo server Immich',
    cardTitle:   'Connessione Immich',
    urlLabel:    'URL del server Immich',
    urlPlaceholder: 'http://immich:2283 oppure http://192.168.1.100:2283',
    urlHint:     "Inserisci l'URL interno del tuo server Immich (senza /api finale)",
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'La tua API key di Immich',
    apiKeyHint:  'Generala in Immich → Account Settings → API Keys',
    save:        'Salva',
    test:        'Testa connessione',
    saved:       'Configurazione salvata',
    saveError:   'Errore nel salvataggio',
    testOk:      '✓ Connessione a Immich riuscita!',
    testFail:    '✗ Impossibile connettersi a Immich. Controlla URL e API key.',
    testError:   'Errore durante il test',
    guideTitle:  'Guida rapida',
    guideSteps: [
      ['1', 'Configura',        "Inserisci l'URL di Immich e la tua API key, poi testa la connessione"],
      ['2', 'Profili di stampa','Crea un profilo con le dimensioni del foglio, margini, abbondanza e layout delle pagine'],
      ['3', 'Seleziona album',  'Scegli uno o più album da Immich e il profilo da usare, poi genera il layout'],
      ['4', 'Anteprima',        'Rivedi e modifica la disposizione delle foto pagina per pagina'],
      ['5', 'Esporta',          'Genera il PDF pronto per la stamperia'],
    ],
    langTitle:   'Lingua / Language',
    langLabel:   'Seleziona lingua',
  },

  // ── Profiles page ──────────────────────────────────────────────────────────
  profiles: {
    title:         'Profili di stampa',
    subtitle:      'Gestisci i tuoi preset di stampa riutilizzabili',
    newBtn:        '+ Nuovo profilo',
    newTitle:      'Nuovo profilo di stampa',
    editTitle:     'Modifica:',
    subtitle2:     'Configura le impostazioni per la tua stamperia',
    cancelBtn:     'Annulla',
    saveBtn:       '💾 Salva profilo',
    generalCard:   'Informazioni generali',
    nameLabel:     'Nome del profilo',
    namePlaceholder: 'es. Fotolibro 20x30 lucido',
    formatCard:    'Formato pagina',
    pageSizeLabel: 'Dimensione pagina',
    orientLabel:   'Orientamento',
    portrait:      'Verticale (Portrait)',
    landscape:     'Orizzontale (Landscape)',
    duplexLabel:   'Stampa fronte/retro (duplex) — aggiunge una pagina vuota dopo ogni coppia',
    marginsCard:   'Margini e spaziatura',
    marginLabel:   'Margine (mm)',
    marginHint:    'Spazio tra foto e bordo pagina',
    gapLabel:      'Spazio tra foto (mm)',
    gapHint:       'Gutter tra le foto nella stessa pagina',
    bleedLabel:    'Abbondanza (mm)',
    bleedActive:   'Attiva',
    bleedHint:     'Area extra che verrà rifilata in stampa',
    pageTypesCard: 'Pagine tipo',
    pageTypesHint: "Definisci i layout di pagina disponibili. Il sistema sceglierà tra questi durante l'impaginazione automatica. Puoi ridimensionare gli slot trascinando le linee dorate nel canvas.",
    savedOk:       'Profilo salvato',
    savedError:    'Errore nel salvataggio',
    deleteConfirm: (name) => `Eliminare il profilo "${name}"?`,
    noProfiles:    'Nessun profilo',
    noProfilesHint:'Crea il tuo primo profilo di stampa per iniziare',
    createBtn:     'Crea profilo',
    editBtn:       '✏️ Modifica',
    deleteBtn:     '🗑️',
    infoRow:       (p) => `${p.page_size} · ${p.orientation === 'portrait' ? 'Verticale' : 'Orizzontale'}${p.duplex ? ' · Fronte/Retro' : ''}${p.bleed ? ` · Abbondanza ${p.bleed_mm}mm` : ''} · ${(p.page_types||[]).length} pagine tipo`,
    noNameError:   'Inserisci un nome per il profilo',
  },

  // ── Page type editor ───────────────────────────────────────────────────────
  pageTypeEditor: {
    addLabel:         '+ Aggiungi:',
    customGrid:       'Griglia personalizzata',
    rows:             'Righe',
    cols:             'Colonne',
    addBtn:           '+ Aggiungi',
    filterAll:        'Tutti',
    filterPortrait:   'Verticale',
    filterLandscape:  'Orizzontale',
    editSection:      'MODIFICA PAGINA TIPO',
    nameLabel:        'Nome',
    prefLabel:        'Orientamento preferito',
    prefMixed:        'Misto (qualsiasi)',
    prefPortrait:     'Verticale (ritratto)',
    prefLandscape:    'Orizzontale (paesaggio)',
    slotsTable:       'Dimensioni slot (% pagina):',
    slotCountHint:    (n, v, h) => `Slot ${n} · ${v} verticali, ${h} orizzontali`,
    dragHint:         '⟷ Trascina i punti dorati per ridimensionare · Min 8%',
    noSlots:          'Nessuna pagina tipo — aggiungine una con i pulsanti sopra',
    presetGroups: [
      { label: '1 foto',   keys: ['1f','1v','1h','1+c','pan'] },
      { label: '2 foto',   keys: ['2v','2h','2+c'] },
      { label: '3 foto',   keys: ['3a','3b','3c'] },
      { label: '4+ foto',  keys: ['4g','4a','6g'] },
    ],
  },

  // ── Albums page ────────────────────────────────────────────────────────────
  albums: {
    title:        'Seleziona album',
    subtitle:     'Scegli uno o più album da Immich per creare il tuo fotolibro',
    profileLabel: 'Profilo di stampa',
    noProfiles:   '⚠ Nessun profilo.',
    noProfilesLink:'Creane uno →',
    searchLabel:  'Cerca album',
    searchPlaceholder: 'Filtra per nome…',
    smartBtn:     '✨ Smart Layout',
    smartTitle:   'Analizza qualità, raggruppa per eventi temporali, sceglie layout ottimali',
    smartConfig:  'Configura Smart Layout',
    manualBtn:    '📖 Layout manuale',
    manualTitle:  'Usa i profili pagina definiti nel profilo di stampa',
    generating:   'Generazione…',
    photos:       (n) => `${n} foto`,
    noAlbums:     'Nessun album trovato',
    noAlbumsImmich:'Nessun album su Immich',
    noAlbumsSearch: (q) => `Nessun risultato per "${q}"`,
    loading:      'Caricamento album da Immich…',
    errorTitle:   'Errore di connessione',
    errorHint:    'Verifica la configurazione nella pagina Configurazione',
  },

  // ── Smart config modal ─────────────────────────────────────────────────────
  smartConfig: {
    title:    '✨ Configurazione Smart Layout',
    subtitle: "Regola i parametri dell'analisi automatica delle foto",
    resetBtn: '↺ Ripristina default',
    cancelBtn:'Annulla',
    saveBtn:  '💾 Salva',
    saving:   'Salvo…',
    savedOk:  'Configurazione salvata ✓',
    savedErr: 'Errore nel salvataggio',
    qualityGuideTitle: 'Come viene calcolata la qualità',
    qualityComponents: [
      ['40%','Risoluzione EXIF (MP)','Più megapixel = punteggio più alto'],
      ['30%','Nitidezza (Laplaciano)','Alta varianza bordi = foto a fuoco'],
      ['30%','Luminosità','Preferisce esposizioni bilanciate'],
    ],
    sections: [
      {
        section: 'Clustering temporale',
        fields: [
          { key:'event_clustering', label:'Raggruppa per eventi temporali', type:'bool',
            help:'Attivo: le foto vengono raggruppate in eventi separati in base ai gap di tempo.' },
          { key:'event_gap_min', label:'Gap tra eventi (minuti)', type:'number', min:5, max:480, step:5,
            help:'Foto scattate entro questo intervallo vengono raggruppate nello stesso evento.',
            disabledWhen: cfg => !cfg.event_clustering },
        ]
      },
      {
        section: 'Foto preferite ★',
        fields: [
          { key:'favorite_full_page', label:'Foto preferite → pagina intera', type:'bool',
            help:'Le foto con il cuore ★ in Immich vengono posizionate da sole su una pagina intera.' },
        ]
      },
      {
        section: 'Posizionamento volti (Face-Aware)',
        fields: [
          { key:'face_aware_crop', label:'Centra il crop sui volti', type:'bool',
            help:'Il crop iniziale viene centrato automaticamente sui volti in primo piano. Evita tagli su visi.' },
        ]
      },
      {
        section: 'Filtro qualità',
        fields: [
          { key:'quality_filter', label:'Attiva filtro qualità', type:'bool',
            help:'Esclude le foto con punteggio qualità troppo basso.' },
          { key:'min_quality', label:'Soglia qualità minima (0.0 – 1.0)', type:'number', min:0, max:1, step:0.01,
            help:'0.05 = escludi solo foto inutilizzabili. Raccomandato: 0.05.',
            disabledWhen: cfg => !cfg.quality_filter },
        ]
      },
      {
        section: 'Rimozione duplicati',
        fields: [
          { key:'remove_duplicates', label:'Attiva rimozione duplicati', type:'bool',
            help:'Rimuove foto quasi identiche per colore, tenendo quella con qualità più alta.' },
          { key:'similarity_threshold', label:'Soglia similarità (0.0 – 1.0)', type:'number', min:0.80, max:1.0, step:0.01,
            help:'1.0 = solo identiche. 0.90 = anche molto simili. Raccomandato: 0.95–0.98.',
            disabledWhen: cfg => !cfg.remove_duplicates },
        ]
      },
      {
        section: 'Layout pagine',
        fields: [
          { key:'max_per_page', label:'Max foto per pagina', type:'number', min:1, max:9, step:1,
            help:'Numero massimo di foto in una singola pagina.' },
          { key:'rhythm_alternation', label:'Alterna pagine dense e minimaliste', type:'bool',
            help:'Crea variazione visiva alternando pagine con molte foto a pagine con poche foto.' },
        ]
      },
    ],
  },

  // ── Preview page ───────────────────────────────────────────────────────────
  preview: {
    noLayout:     'Nessun layout generato',
    noLayoutHint: 'Vai alla pagina Album, seleziona un album e un profilo, poi clicca "Genera layout"',
    goToAlbums:   '→ Vai agli album',
    prevBtn:      '← Prec.',
    nextBtn:      'Succ. →',
    coverPage:    'Copertina',
    pageOf:       (n, t) => `Pagina ${n} / ${t}`,
    coverAuto:    'La copertina viene generata automaticamente con mappa GPS',
    photos:       'foto',
    gpsLocations: 'GPS',
    recalcBtn:    '🔄 Ricalcola',
    recalcBusy:   'Ricalcolo…',
    saveBtn:      '💾 Salva',
    openBtn:      '📂 Apri',
    exportBtn:    '📄 Esporta',
    exporting:    'Generazione…',
    exportPdf:    '📄 Esporta PDF',
    exportSvg:    '🎨 Esporta SVG / Illustrator',
    svgHint:      'ZIP compatibile con Illustrator, Scribus, InDesign',
    keyboard:     '← → per navigare',
    pages:        (n) => `${n} pag.`,
    photoCount:   (n) => `${n} foto`,

    // slot overlay
    reposition:   '🖐 Riposiziona',
    repositionMismatch: '↕↔ Riposiziona',
    changePhoto:  '🔄 Cambia',
    addCaption:   '💬 Didascalia',
    removePhoto:  '✕ Togli',
    editCaption:  '✏️ Modifica',
    emptySlot:    'slot vuoto',
    choosePhoto:  '📷 Scegli foto',
    addCaptionBtn:'💬 Didascalia',
    removeSlot:   '✕ Rimuovi slot',
    mismatch:     '↕↔ orientamento diverso',
    panMode:      '🖐 Modalità riposizionamento attiva — trascina la foto per spostarla nello slot',
    panDone:      '✓ Fatto',
    dragHint:     '⇄ Trascina foto per scambiarle · Trascina linee dorate per ridimensionare · Hover per azioni',
    panHint:      '🖐 Trascina la foto per spostarla · "✓ Fatto" per uscire',
    addSlot:      '⊞ Slot',
    layoutLabel:  'Layout:',
    zoomIn:       'Aumenta zoom',
    zoomOut:      'Riduci zoom',
    resetZoom:    'Ripristina posizione originale',
    doneZoom:     'Conferma riposizionamento',
    resizeHint:   (n) => `↕ Ridimensiona slot ${n}`,
    resizeHintH:  (n, side) => `↕ Ridimensiona slot ${n} — bordo ${side === 'top' ? 'superiore' : 'inferiore'}`,
    resizeHintV:  (n, side) => `↔ Ridimensiona slot ${n} — bordo ${side === 'left' ? 'sinistro' : 'destro'}`,
    oneSlotHint:  '⊞ Slot → aggiungi per ridimensionare',
    captionPlaceholder: 'clicca per scrivere…',

    // album panel
    panelPhotos:    (n) => `Foto (${n})`,
    panelAll:       'Tutte',
    panelUnused:    '○',
    panelMulti:     '2×',
    panelUsed:      (n) => `✓${n} usate`,
    panelRepeated:  (n) => `×${n} ripetute`,
    panelNotUsed:   (n) => `○${n} non usate`,
    panelViewLabel: '×',
    panelSearch:    'Cerca…',
    panelNoPhotos:  'Nessuna foto',
    panelNoResults: 'Nessun risultato',
    panelDragHint:  '⇄ Trascina su slot · Clicca per andare alla pagina',
    panelUsedOnce:  '1× usata',
    panelUsedTimes: (n) => `${n}× usata`,
    panelNotUsedLabel:'non usata',
    panelPageHint:  (pages) => `Pagina ${pages.map(p=>p+1).join(', ')}`,
    panelAlt:       (name, uses, pages) => {
      if (uses === 0) return `${name}\nNon usata`
      if (pages.length) return `${name}\nPagina ${pages.map(p=>p+1).join(', ')}`
      return `${name}\nUsata ${uses} volta/e`
    },
    hideUnused:     'Nascondi non usate',
    showUnused:     'Mostra non usate',

    // recalc menu
    recalcTitle:    'Ricalcola layout',
    recalcCover:    'copertina',
    recalcWorking:  'Operazione in corso…',
    recalcSections: (fromIdx, totalPages, atTitle, isFirst) => [
      {
        title: 'RICALCOLO PARZIALE',
        items: [
          {
            id: 'from_here', icon: '📍',
            label: 'Da questa pagina in avanti',
            highlight: true,
            desc: isFirst
              ? "Ricalcola l'intero album (sei alla prima pagina)"
              : `Blocca le pagine 1–${fromIdx} già revisionate · ricalcola da pag. ${fromIdx+1} alla fine`,
          },
          {
            id: 'this_page', icon: '📄',
            label: 'Solo questa pagina',
            disabled: atTitle,
            desc: atTitle
              ? 'Non applicabile alla copertina'
              : 'Redistribuisce le foto di questa pagina con un layout automatico diverso',
          },
        ],
      },
      {
        title: 'OTTIMIZZAZIONI  (da questa pagina in poi)',
        items: [
          { id:'compress',     icon:'🗜️', label:'Comprimi pagine vuote',  desc:'Raggruppa le foto sparse riducendo le pagine con slot vuoti · le pagine precedenti restano intatte' },
          { id:'orientation',  icon:'🎯', label:'Ottimizza orientamento', desc:'Scambia le foto dentro ogni pagina per far corrispondere verticale↔verticale e orizzontale↔orizzontale · istantaneo' },
          { id:'reorder_date', icon:'📅', label:'Riordina per data',      desc:'Sposta le foto nei loro slot in ordine cronologico mantenendo il layout invariato · istantaneo' },
        ],
      },
      {
        title: 'AGGIUNTE',
        items: [
          { id:'add_unused', icon:'➕', label:'Inserisci foto non ancora usate', desc:"Genera nuove pagine in fondo all'album con le foto Immich non ancora nel layout" },
        ],
      },
      {
        title: 'RICALCOLO COMPLETO',
        items: [
          { id:'full', icon:'🔄', label:'Ricomincia tutto da zero', danger:true, desc:'⚠ Tutte le modifiche manuali andranno perse · ricalcola da capo' },
        ],
      },
    ],
    recalcToasts: {
      fromHere:    (n) => `✓ Ricalcolato da pagina ${n} in avanti`,
      thisPage:    '✓ Pagina ricalcolata',
      all:         '✓ Album ricalcolato da zero',
      compress:    '✓ Pagine compresse',
      noPhotos:    'Nessuna foto da riorganizzare',
      orientation: (n) => `✓ Orientamento ottimizzato${n ? ` (${n} scambi)` : ' — già ottimale'}`,
      reorderDate: '✓ Foto riordinate per data',
      addedUnused: (photos, pages) => `✓ Aggiunte ${photos} foto in ${pages} nuove pagine`,
      allUsed:     '✓ Tutte le foto sono già nel layout',
      recalcError: 'Errore nel ricalcolo',
      error:       'Errore',
    },
    recalcConfirmAll: 'Sei sicuro? Tutte le modifiche manuali andranno perse.',

    // export panel
    exportFormat:    (size, orient) => `${size} ${orient}`,
    exportMargins:   'Margini',
    exportBleed:     'Abbondanza',
    exportDuplex:    'Fronte/retro',
    exportPages:     'Pagine',
    exportYes:       'Sì',
    exportNo:        'No',
    exportPortrait:  'Vert.',
    exportLandscape: 'Orizz.',
    exportInclCover: '(incl. copertina)',
    exportReady:     'PDF pronto per la stamperia',
    pdfDownloaded:   '✓ PDF scaricato!',
    svgDownloaded:   '✓ ZIP SVG scaricato!',
    exportError:     '✗ Errore export',

    // photo picker
    pickerTitle:     'Seleziona foto',
    pickerSearch:    'Cerca per nome file…',
    pickerNoResults: 'Nessun risultato',

    // project modal
    projectSaveTitle:    '💾 Salva progetto',
    projectSaveSubtitle: 'Salva il layout corrente per riprendere in un altro momento',
    projectLoadTitle:    '📂 Apri progetto',
    projectLoadSubtitle: 'Seleziona un progetto salvato per caricarlo',
    projectNameLabel:    'Nome del progetto',
    projectNamePlaceholder: 'es. Vacanze estate 2024',
    projectUpdateBtn:    '💾 Aggiorna',
    projectSaveNewBtn:   '+ Salva come nuovo',
    projectSaveBtn:      '💾 Salva',
    projectSaving:       'Salvataggio…',
    projectSavedOk:      'Progetto aggiornato ✓',
    projectNewSavedOk:   'Progetto salvato ✓',
    projectSaveError:    'Errore nel salvataggio',
    projectLoadError:    'Errore nel caricamento',
    projectSavedList:    'Progetti salvati',
    projectNone:         'Nessun progetto salvato',
    projectNoneHint:     'Usa "Salva progetto" dall\'anteprima per conservare il tuo lavoro',
    projectHint:         (savedId) => savedId
      ? 'Progetto aperto — premi "Aggiorna" per sovrascrivere o "Salva come nuovo" per una copia'
      : 'Verrà creato un nuovo progetto',
    projectSavedAt:      (date) => `Salvato: ${date}`,
    projectDeleteConfirm:(name) => `Eliminare il progetto "${name}"?`,
    projectDeleteBtn:    '🗑️',
    projectRefreshBtn:   'Aggiorna lista',
  },
}
