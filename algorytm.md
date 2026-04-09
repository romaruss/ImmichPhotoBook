Smart Layout (smart_layout.py)

1. cluster_events()
   └── raggruppa le foto in eventi per gap temporale (es. >60 min)

2. Per ogni evento → _build_pages_for_event()
   ├── Le foto PREFERITE (★ Immich) → pagina intera immediata, prima delle altre
   └── Le foto normali vengono divise in chunk (max N per pagina)

3. Per ogni chunk → _pick_template()
   ├── Candidati: tutti i template con n == chunk_size
   ├── Score primario: _orientation_score(template, foto)
   │   → conta min(portrait_foto, portrait_slots) + min(landscape_foto, landscape_slots)
   │   → template con più coppie (foto,slot) dello stesso orientamento vince
   └── Score secondario: ritmo editoriale (alterna pagine dense e minimaliste)

4. _assign_photos_to_slots_smart(foto, slots)
   ├── Separa foto portrait e landscape
   ├── Separa slot portrait (h>w) e landscape (w≥h)
   ├── Abbina: portrait_foto → portrait_slot, landscape_foto → landscape_slot
   └── Residui (disallineamenti inevitabili) → slot rimasti nell'ordine

5. Face-aware crop (se attivo)
   └── Per ogni foto assegnata allo slot, calcola il transform {x,y,zoom}
       centrato sul volto rilevato da Immich
	   
Layout Manuale (layout_engine.py)

1. _group_into_units()
   └── raggruppa (foto + sua didascalia) in unità inseparabili

2. Per ogni unità → _pick_page_type()
   ├── Fa il "peek" sulle prossime N foto in arrivo
   ├── Per ogni page_type del profilo calcola _orientation_match_score()
   │   (stesso algoritmo: conta coppie orientamento corrispondenti)
   └── Sceglie il page_type con il punteggio più alto
       In caso di parità → più slot vince (riempie di più l'album)

3. _assign_photos_to_slots(foto, slots)
   └── Stessa logica greedy: portrait→portrait, landscape→landscape, residui nei rimasti

Preview foto non usate nel pannello

Clic su una foto con bordo rosso (non usata nell'album):

    Apre un overlay scuro a tutto schermo (Portal su document.body)
    Mostra la foto a grandezza naturale con objectFit: contain
    Bordo rosso anche nell'anteprima per coerenza visiva
    Pulsante ✕ in alto a destra per chiudere
    Clic sul backdrop (fuori dalla foto) chiude anch'esso
    Cursore zoom-in sulle foto non usate per indicare il comportamento
    Le foto usate mantengono il cursore pointer e navigano alla pagina (comportamento invariato)
	   