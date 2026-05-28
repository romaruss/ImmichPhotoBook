// ── Page geometry ─────────────────────────────────────────────────────────────
export const PAGE_SIZES_PT = {
  'A4':[595,842],'A3':[842,1191],'A5':[420,595],
  '20x20':[566,566],'20x30':[566,850],'30x30':[850,850],
  '30x40':[850,1134],'Letter':[612,792],'Custom':[566,850],
}
export function getPageDims(profile) {
  let [w,h] = PAGE_SIZES_PT[profile?.page_size||'20x30']||[566,850]
  if (profile?.orientation==='landscape') [w,h]=[h,w]
  return [w,h]
}

// marginsForPage: returns {ml, mr, mt, mb} in px (2.835px = 1mm)
// Mapping profilo (coerente con le label UI di ProfilesPage):
//   margin_left  = ESTERNO  ("← Esterno")
//   margin_right = INTERNO  ("Interno →", lato rilegatura)
//
// L'alternanza interna/esterna è attiva solo con duplex (stampa fronte/retro):
//   duplex=false: esterno sempre a sx, interno sempre a dx
//   duplex=true, pagine DISPARI  = pagina destra → rilegatura a SINISTRA → interno a sx, esterno a dx
//   duplex=true, pagine PARI     = pagina sinistra → rilegatura a DESTRA → esterno a sx, interno a dx
//   pageNum == null = copertina / miniature → margini simmetrici (esterno su entrambi)
export function marginsForPage(profile, pageNum) {
  const mmPx   = 2.835
  const base   = (profile?.margin_mm || 5)
  const mt     = ((profile?.margin_top    ?? base)) * mmPx
  const mb     = ((profile?.margin_bottom ?? base)) * mmPx
  const mOuter = ((profile?.margin_left   ?? base)) * mmPx  // ← Esterno
  const mInner = ((profile?.margin_right  ?? base)) * mmPx  // Interno →

  if (!profile?.duplex || pageNum == null) {
    // Non duplex o copertina: fisso — esterno a sx, interno a dx
    return { ml: mOuter, mr: mInner, mt, mb }
  }
  if (pageNum % 2 === 0) {
    // Pagina PARI = destra del libro → rilegatura a SINISTRA
    return { ml: mInner, mr: mOuter, mt, mb }
  } else {
    // Pagina DISPARI = sinistra del libro → rilegatura a DESTRA
    return { ml: mOuter, mr: mInner, mt, mb }
  }
}

export function slotRect(slot, pw, ph, profile, scale, pageNum) {
  const m = marginsForPage(profile, pageNum)
  const gap = (profile?.gap_mm||3)*2.835
  const uw = pw - m.ml - m.mr
  const uh = ph - m.mt - m.mb
  const le=slot.x<0.5, te=slot.y<0.5, re=(slot.x+slot.w)>99.5, be=(slot.y+slot.h)>99.5
  const r = {
    x: m.ml+(slot.x/100)*uw+(le?0:gap/2),
    y: m.mt+(slot.y/100)*uh+(te?0:gap/2),
    w: (slot.w/100)*uw-(le?0:gap/2)-(re?0:gap/2),
    h: (slot.h/100)*uh-(te?0:gap/2)-(be?0:gap/2),
  }
  return scale ? {x:r.x*scale,y:r.y*scale,w:r.w*scale,h:r.h*scale} : r
}

/**
 * Mismatch: portrait photo (AR<1) in landscape slot (AR>1) o viceversa.
 * Tolleranza: se entrambi hanno AR tra 0.8 e 1.25 (circa quadrato), non è mismatch.
 */
export function isMismatch(photoAR, slot) {
  if (!photoAR || !slot) return false
  const slotAR = slot.w / slot.h
  const photoPortrait = photoAR < 0.85
  const photoLandscape = photoAR > 1.18
  const slotPortrait   = slotAR  < 0.85
  const slotLandscape  = slotAR  > 1.18
  // Cross: portrait in landscape slot or landscape in portrait slot
  if (photoPortrait && slotLandscape) return true
  if (photoLandscape && slotPortrait) return true
  // Also flag when the crop is extreme (>60% of photo would be lost)
  const coverScale = Math.max(slot.w/slot.h / photoAR, photoAR / (slot.w/slot.h))
  return coverScale > 2.2
}

/**
 * Calcola le dimensioni dell'immagine e l'offset per mostrare la parte desiderata.
 * zoom=1 → copertina minima (la foto riempie esattamente lo slot con il minimo crop)
 * zoom>1 → la foto viene ingrandita ulteriormente
 * panX, panY 0-100 → percentuale di spostamento sull'overflow disponibile
 */
export function photoStyle(photoAR, slotW, slotH, transform) {
  if (!photoAR) return { width:'100%', height:'100%', objectFit:'cover', display:'block' }
  const slotAR = slotW / slotH
  const zoom = transform?.zoom || 1

  let baseW, baseH
  if (photoAR >= slotAR) {
    // Foto più larga: fit sull'altezza
    baseH = slotH
    baseW = slotH * photoAR
  } else {
    // Foto più alta: fit sulla larghezza
    baseW = slotW
    baseH = slotW / photoAR
  }
  const imgW = baseW * zoom
  const imgH = baseH * zoom
  const overflowX = imgW - slotW
  const overflowY = imgH - slotH
  const panX = transform?.x ?? 50
  const panY = transform?.y ?? 50
  // When image smaller than slot (zoom < 1): center it instead of panning
  const left = overflowX > 0 ? -(panX / 100) * overflowX : (slotW - imgW) / 2
  const top  = overflowY > 0 ? -(panY / 100) * overflowY : (slotH - imgH) / 2

  return {
    position: 'absolute',
    width:  Math.round(imgW),
    height: Math.round(imgH),
    left:   Math.round(left),
    top:    Math.round(top),
    display: 'block',
    maxWidth: 'none',
    pointerEvents: 'none',
    draggable: false,
  }
}
