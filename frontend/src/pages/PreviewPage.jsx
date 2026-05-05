/**
 * PreviewPage v4
 *
 * Novità:
 *  - Riposizionamento + zoom (mantenendo proporzioni) su TUTTE le foto
 *  - Mismatch portrait/landscape: cornice rossa se la foto è verticale in uno slot
 *    orizzontale o viceversa
 *  - Pannello destro apribile/chiudibile con tutte le foto dell'album,
 *    stato usata/usata più volte/non usata, drag verso slot
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'
import CoverStyleEditor, { CoverPreview, DEFAULT_COVER } from '../components/CoverEditor'
import LogViewer from '../components/LogViewer'
import { DividerCanvas, DividerEditorModal, migrateDividerStyle } from '../components/DividerEditor'

// ── Page geometry ─────────────────────────────────────────────────────────────
const PAGE_SIZES_PT = {
  'A4':[595,842],'A3':[842,1191],'A5':[420,595],
  '20x20':[566,566],'20x30':[566,850],'30x30':[850,850],
  '30x40':[850,1134],'Letter':[612,792],'Custom':[566,850],
}
function getPageDims(profile) {
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
function marginsForPage(profile, pageNum) {
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

function slotRect(slot, pw, ph, profile, scale, pageNum) {
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
function isMismatch(photoAR, slot) {
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
function photoStyle(photoAR, slotW, slotH, transform) {
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

// ── Mini thumbnail ────────────────────────────────────────────────────────────
function MiniPage({ page, profile, scale=0.07 }) {
  const [pw,ph] = getPageDims(profile)
  return (
    <div style={{width:pw*scale,height:ph*scale,background:'#e8e4dc',position:'relative',overflow:'hidden',flexShrink:0}}>
      {(page?.items||[]).map((id,i)=>{
        const r=slotRect(id.slot||{x:0,y:0,w:100,h:100},pw,ph,profile,scale,null)
        const s={position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,overflow:'hidden'}
        const item=id.item
        if(!item) return <div key={i} style={{...s,background:'#c8c5be'}}/>
        if(item.type==='caption') return <div key={i} style={{...s,background:'#111116'}}/>
        if(item.type==='map') return <div key={i} style={{...s,background:'#0d1117'}}><img src={`/api/mapcache/${item.map_key}`} alt="mappa GPS" loading="lazy" style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/></div>
        return <div key={i} style={s}><img src={`/api/thumb/${item.asset_id}`} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/></div>
      })}
    </div>
  )
}

// ── Photo picker modal ────────────────────────────────────────────────────────
function PhotoPickerModal({ assets, allAlbumAssets, albumIdx, albumNames, usageMap, onSelect, onClose }) {
  const [filter,setFilter] = useState('')
  const isMulti = allAlbumAssets?.length > 1
  const [showAll,setShowAll] = useState(false)
  const base = (isMulti && !showAll ? (allAlbumAssets[albumIdx] || assets) : assets)
    .filter(a=>(a.type||'IMAGE').toUpperCase()!=='VIDEO')
  const filtered = base.filter(a=>!filter||(a.originalFileName||'').toLowerCase().includes(filter.toLowerCase()))
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--bg2)',borderRadius:12,padding:24,width:680,maxHeight:'82vh',display:'flex',flexDirection:'column',border:'1px solid var(--border)',boxShadow:'0 24px 80px rgba(0,0,0,0.6)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <h3 style={{fontFamily:'var(--font-display)',fontWeight:300,fontSize:20}}>Seleziona foto</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>
        {isMulti&&(
          <div style={{display:'flex',gap:4,marginBottom:10,background:'var(--bg3)',borderRadius:6,padding:3}}>
            <button onClick={()=>setShowAll(false)}
              style={{flex:1,padding:'4px 8px',borderRadius:4,border:'none',cursor:'pointer',fontSize:12,
                background:!showAll?'var(--gold)':'transparent',color:!showAll?'#0a0a0c':'var(--text)',fontWeight:!showAll?700:400}}>
              {albumNames?.[albumIdx] || `Album ${albumIdx+1}`}
            </button>
            <button onClick={()=>setShowAll(true)}
              style={{flex:1,padding:'4px 8px',borderRadius:4,border:'none',cursor:'pointer',fontSize:12,
                background:showAll?'var(--gold)':'transparent',color:showAll?'#0a0a0c':'var(--text)',fontWeight:showAll?700:400}}>
              Tutti gli album
            </button>
          </div>
        )}
        <input className="form-input" placeholder="Cerca per nome file…" style={{marginBottom:10}} value={filter} onChange={e=>setFilter(e.target.value)} autoFocus/>
        <div style={{overflowY:'auto',flex:1}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8}}>
            {filtered.map(asset=>{
              const uses=usageMap[asset.id]||0
              const bc=uses>1?'#e89a3a':uses===1?'#4ac585':'#e05050'
              return (
                <div key={asset.id} onClick={()=>onSelect(asset)}
                  style={{cursor:'pointer',borderRadius:6,overflow:'hidden',aspectRatio:'1',position:'relative',
                    border:`2px solid ${bc}`,transition:'border-color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=bc}>
                  <img src={`/api/thumb/${asset.id}`} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                  {uses===0&&<div style={{position:'absolute',inset:0,background:'rgba(220,50,50,0.35)',pointerEvents:'none'}}/>}
                  {uses>1&&<div style={{position:'absolute',top:3,right:3,background:'#e89a3a',color:'#000',fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:700}}>{uses}×</div>}
                </div>
              )
            })}
          </div>
          {filtered.length===0&&<p style={{textAlign:'center',padding:32,color:'var(--text3)'}}>Nessun risultato</p>}
        </div>
      </div>
    </div>
  )
}


function AlbumPanel({ assets, presorted, usageMap, usagePages, open, onToggle, onDragStart, onNavigate, highlightedAsset, onClearHighlight }) {
  const t = useT()
  const tp = t.preview
  const [filter, setFilter]         = useState('')
  const [view, setView]             = useState(()=>{try{return JSON.parse(localStorage.getItem('pb_view'))||1}catch{return 1}})
  const [statusFilter, setStatusFilter] = useState('all')
  const [previewAsset, setPreviewAsset] = useState(null)  // foto ingrandita
  const highlightRef = useRef(null)  // ref to highlighted photo item

  // Scroll highlighted asset into view when it changes
  useEffect(() => {
    if (highlightedAsset && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior:'smooth', block:'nearest' })
    }
  }, [highlightedAsset])

  const sortedAssets = presorted
    ? assets.filter(a => (a.type||'IMAGE').toUpperCase() !== 'VIDEO')
    : [...assets].filter(a => (a.type||'IMAGE').toUpperCase() !== 'VIDEO')
        .sort((a,b)=>(a.localDateTime||'').localeCompare(b.localDateTime||''))
  const filtered = sortedAssets.filter(a => {
    const uses = usageMap[a.id] || 0
    if (statusFilter === 'unused' && uses > 0)  return false
    if (statusFilter === 'multi'  && uses < 2)  return false
    if (filter && !(a.originalFileName || '').toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const used   = Object.values(usageMap).filter(v => v > 0).length
  const multi  = Object.values(usageMap).filter(v => v > 1).length
  const unused = sortedAssets.length - used  // sortedAssets already excludes videos

  const borderColor = (id) => {
    const u = usageMap[id] || 0
    if (u === 0)  return '#e05050'
    if (u > 1)    return '#e89a3a'
    return '#4ac585'
  }

  const altText = (asset) => {
    const u = usageMap[asset.id] || 0
    const pages = usagePages[asset.id] || []
    const name  = asset.originalFileName || asset.id
    return tp.panelAlt(name, u, pages)
  }

  // Tracks which occurrence index was last shown per asset (for cycling)
  const occurrenceCursor = useRef({})

  // Click su foto: se non usata → preview ingrandita; se usata → cicla tra le occorrenze
  const handlePhotoClick = (asset) => {
    const pages_list = usagePages[asset.id] || []
    if (pages_list.length === 0) {
      setPreviewAsset(asset)
      return
    }
    const cur = occurrenceCursor.current[asset.id] || 0
    const targetPage = pages_list[cur % pages_list.length]
    occurrenceCursor.current[asset.id] = (cur + 1) % pages_list.length
    onNavigate(targetPage)
  }

  return (
    <>
    {/* Modal anteprima foto non usata */}
    {previewAsset && createPortal(
      <>
        <div
          onClick={() => setPreviewAsset(null)}
          style={{
            position:'fixed', inset:0, zIndex:9990,
            background:'rgba(0,0,0,0.82)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position:'relative', maxWidth:'90vw', maxHeight:'90vh',
              display:'flex', flexDirection:'column', alignItems:'center', gap:12,
            }}>
            {/* X button */}
            <button
              onClick={() => setPreviewAsset(null)}
              style={{
                position:'absolute', top:-14, right:-14, zIndex:1,
                width:32, height:32, borderRadius:'50%',
                background:'var(--bg2)', border:'1px solid var(--border)',
                color:'var(--text)', fontSize:18, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                lineHeight:1,
              }}>✕</button>
            {/* Immagine */}
            <img
              src={`/api/thumb/${previewAsset.id}?size=preview`}
              alt={previewAsset.originalFileName || previewAsset.id}
              style={{
                maxWidth:'85vw', maxHeight:'80vh',
                objectFit:'contain',
                borderRadius:6,
                boxShadow:'0 8px 40px rgba(0,0,0,0.8)',
                border:'2px solid #e05050',
              }}
            />
            {/* Nome file */}
            <p style={{
              fontSize:12, color:'rgba(255,255,255,0.7)',
              fontFamily:'var(--font-mono)', textAlign:'center',
              maxWidth:'80vw', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            }}>
              {previewAsset.originalFileName || previewAsset.id}
              <span style={{color:'#e05050', marginLeft:8}}>● non usata</span>
            </p>
          </div>
        </div>
      </>,
      document.body
    )}
    <div style={{
      width: open ? 200 : 30,
      flexShrink: 0, transition: 'width 0.22s ease',
      background: 'var(--bg2)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
    }}>
      <button onClick={onToggle}
        title={open ? 'Chiudi pannello foto' : 'Apri pannello foto'}
        style={{
          position:'absolute', left:0, top:'50%', transform:'translateY(-50%)',
          width:16, height:48, background:'var(--bg3)',
          border:'1px solid var(--border)', borderRight:'none',
          borderRadius:'5px 0 0 5px', cursor:'pointer', zIndex:10,
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'var(--text3)', fontSize:12,
        }}>
        {open ? '›' : '‹'}
      </button>

      {open && (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',marginLeft:16}}>

          {/* Header */}
          <div style={{padding:'10px 8px 6px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
            <p style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)',
              textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5}}>
              Foto ({assets.length})
            </p>

            {/* Status filter */}
            <div style={{display:'flex',gap:3,marginBottom:6}}>
              {[['all',tp.panelAll],['unused',tp.panelUnused],['multi',tp.panelMulti]].map(([k,l])=>(
                <button key={k}
                  onClick={()=>setStatusFilter(k)}
                  title={k==='all'?tp.panelAll:k==='unused'?'Non usate':'Usate più volte'}
                  style={{
                    flex:1, fontSize:10, padding:'3px 0',
                    border:`1px solid ${statusFilter===k?'var(--gold)':'var(--border)'}`,
                    background: statusFilter===k?'var(--gold-dim)':'transparent',
                    color: statusFilter===k?'var(--gold)':'var(--text3)',
                    borderRadius:4, cursor:'pointer',
                  }}>{l}</button>
              ))}
            </div>

            {/* Search */}
            <input className="form-input" style={{fontSize:10,padding:'4px 7px'}}
              placeholder="Cerca…" value={filter} onChange={e=>setFilter(e.target.value)}/>

            {/* View mode */}
            <div style={{display:'flex',gap:3,marginTop:5}}>
              {[1,2,3].map(n=>(
                <button key={n} onClick={()=>{setView(n);localStorage.setItem('pb_view',n)}}
                  style={{
                    flex:1, fontSize:10, padding:'2px 0',
                    border:`1px solid ${view===n?'var(--gold)':'var(--border)'}`,
                    background: view===n?'var(--gold-dim)':'transparent',
                    color: view===n?'var(--gold)':'var(--text3)',
                    borderRadius:4, cursor:'pointer',
                  }}>{n}×</button>
              ))}
            </div>
          </div>

          {/* Stats row */}
          <div style={{padding:'4px 8px',borderBottom:'1px solid var(--border)',
            fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',
            display:'flex',gap:8,flexShrink:0}}>
            <span style={{color:'#4ac585'}}>✓{used}</span>
            <span style={{color:'#e89a3a'}}>×{multi}</span>
            <span style={{color:'#e05050'}}>○{unused}</span>
          </div>

          {/* Photo list — scroll container with minHeight:0 so flex shrink works */}
          <div style={{
            flex: 1, minHeight: 0,  /* CRITICAL: without this flex child never shrinks */
            overflowY: 'auto', overflowX: 'hidden',
            padding: '6px 6px 0',
          }}>
            {/* Inner grid/list wrapper — NOT the scroll container */}
            {view === 1 ? (
              <div style={{ display:'flex', flexDirection:'column', gap:5, paddingBottom:6 }}>
                {filtered.map(asset => {
                  const uses  = usageMap[asset.id] || 0
                  const pages = usagePages[asset.id] || []
                  const bc    = borderColor(asset.id)
                  const alt   = altText(asset)
                  const firstPage = pages[0]
                  return (
                    <div key={asset.id}
                      ref={highlightedAsset===asset.id ? highlightRef : null}
                      draggable
                      onDragStart={e=>{e.dataTransfer.setData('asset_id',asset.id);onDragStart(asset)}}
                      onClick={()=>{ handlePhotoClick(asset); onClearHighlight?.() }}
                      onDoubleClick={()=>setPreviewAsset(asset)}
                      title={alt}
                      style={{
                        display:'flex', gap:6, alignItems:'center', flexShrink:0,
                        cursor:firstPage!==undefined?'pointer':'grab',
                        borderRadius:4, padding:'3px 5px',
                        border: highlightedAsset===asset.id
                          ? '2px solid var(--gold)'
                          : `1.5px solid ${bc}`,
                        background: highlightedAsset===asset.id ? 'var(--gold-dim)' : 'transparent',
                        opacity:uses===0?0.65:1,
                        transition:'background 0.1s, border-color 0.1s',
                        boxShadow: highlightedAsset===asset.id ? '0 0 0 2px rgba(212,170,90,0.25)' : 'none',
                      }}
                      onMouseEnter={e=>{if(highlightedAsset!==asset.id)e.currentTarget.style.background='var(--bg3)'}}
                      onMouseLeave={e=>{if(highlightedAsset!==asset.id)e.currentTarget.style.background='transparent'}}>
                      <div style={{width:38,height:38,flexShrink:0,borderRadius:3,
                        overflow:'hidden',background:'var(--bg3)',position:'relative'}}>
                        <img src={`/api/thumb/${asset.id}`} alt={alt} loading="lazy"
                          style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                        {uses>1&&<div style={{position:'absolute',top:1,right:1,
                          background:'#e89a3a',color:'#000',fontSize:8,
                          padding:'1px 3px',borderRadius:2,fontWeight:700}}>{uses}×</div>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontSize:9,color:'var(--text2)',overflow:'hidden',
                          textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:'var(--font-mono)'}}>
                          {(asset.originalFileName||asset.id).replace(/\.[^.]+$/,'')}
                        </p>
                        <p style={{fontSize:8,color:'var(--text3)',marginTop:1}}>
                          {uses===0?tp.panelNotUsedLabel:pages.length?tp.panelPageHint(pages):`${uses}×`}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: view===2 ? '1fr 1fr' : '1fr 1fr 1fr',
                gap: 4,
                paddingBottom: 6,
              }}>
                {filtered.map(asset => {
                  const uses  = usageMap[asset.id] || 0
                  const pages = usagePages[asset.id] || []
                  const bc    = borderColor(asset.id)
                  const alt   = altText(asset)
                  const firstPage = pages[0]
                  return (
                    <div key={asset.id}
                      ref={highlightedAsset===asset.id ? highlightRef : null}
                      draggable
                      onDragStart={e=>{e.dataTransfer.setData('asset_id',asset.id);onDragStart(asset)}}
                      onClick={()=>{ handlePhotoClick(asset); onClearHighlight?.() }}
                      onDoubleClick={()=>setPreviewAsset(asset)}
                      title={alt}
                      style={{
                        position:'relative', width:'100%', paddingTop:'100%',
                        cursor:(usageMap[asset.id]||0)===0?'zoom-in':firstPage!==undefined?'pointer':'grab',
                        borderRadius:4, overflow:'hidden',
                        border: highlightedAsset===asset.id
                          ? '2px solid var(--gold)'
                          : `2px solid ${bc}`,
                        opacity:uses===0?0.6:1,
                        transition:'box-shadow 0.12s, border-color 0.12s',
                        boxSizing:'border-box',
                        boxShadow: highlightedAsset===asset.id ? '0 0 0 3px rgba(212,170,90,0.4)' : 'none',
                      }}
                      onMouseEnter={e=>{
                        if(highlightedAsset!==asset.id){
                          e.currentTarget.style.boxShadow='0 0 0 2px var(--gold)'
                          e.currentTarget.style.borderColor='var(--gold)'
                        }
                      }}
                      onMouseLeave={e=>{
                        if(highlightedAsset!==asset.id){
                          e.currentTarget.style.boxShadow='none'
                          e.currentTarget.style.borderColor=bc
                        }
                      }}>
                      {/* Content inside the aspect-ratio box */}
                      <div style={{position:'absolute',inset:0}}>
                        <img src={`/api/thumb/${asset.id}`} alt={alt} loading="lazy"
                          style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                        {uses===0&&<div style={{position:'absolute',inset:0,background:'rgba(220,50,50,0.35)',pointerEvents:'none'}}/>}
                        {uses>1&&<div style={{position:'absolute',top:2,right:2,
                          background:'#e89a3a',color:'#000',fontSize:8,
                          padding:'1px 3px',borderRadius:2,fontWeight:700,lineHeight:1.3}}>{uses}×</div>}
                        {pages.length>0&&firstPage!==undefined&&(
                          <div style={{position:'absolute',bottom:0,left:0,right:0,textAlign:'center',
                            fontSize:8,color:'rgba(255,255,255,0.85)',fontFamily:'var(--font-mono)',
                            background:'rgba(0,0,0,0.45)',lineHeight:1.6}}>p.{firstPage+1}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length===0&&(
              <p style={{textAlign:'center',color:'var(--text3)',fontSize:10,padding:'20px 0'}}>
                {filter||statusFilter!=='all'?tp.panelNoResults:tp.panelNoPhotos}
              </p>
            )}
          </div>

          <div style={{padding:'5px 8px',borderTop:'1px solid var(--border)',
            fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',flexShrink:0}}>
            {tp.panelDragHint}
          </div>
        </div>
      )}
    </div>
    </>
  )
}

// ── Per-slot resize handles ──────────────────────────────────────────────────
// Ogni slot ha 4 handle (top/bottom/left/right).
// Trascinare un handle sposta quel bordo e, se c'è uno slot adiacente, lo ridimensiona.
// Se non c'è adiacente, il bordo viene spostato liberamente (entro i limiti della pagina).
function SlotDividers({ items, pw, ph, profile, scale, onUpdateItems, pageNum }) {
  const t = useT(); const tp = t.preview
  const dragRef = useRef(null)
  const _m = marginsForPage(profile, pageNum)
  const uw = pw - _m.ml - _m.mr
  const uh = ph - _m.mt - _m.mb
  const MIN_PCT   = 8
  const EPS       = 1.5
  const SNAP_DIST = 3   // % — snap outer edge back to 0/100 within this distance

  const groupClose = (vals) => {
    if (!vals.length) return []
    const sorted = [...vals].sort((a,b)=>a-b)
    const groups = []
    for (const v of sorted) {
      const last = groups[groups.length-1]
      if (last && v - last.sum/last.n < EPS) { last.sum+=v; last.n++; last.rep=last.sum/last.n }
      else groups.push({sum:v,n:1,rep:v})
    }
    return groups.map(g=>g.rep)
  }

  // Build per-slot handles: all 4 edges.
  // isOuter = no adjacent slot shares this edge → outer page border, drag inward only.
  const buildHandles = () => {
    const handles = []
    items.forEach((id, si) => {
      const s = id.slot
      if (!s) return
      const hasAdj = (side) => items.some((id2,j) => {
        if (j === si) return false
        const s2 = id2.slot
        if (side === 'top')    return Math.abs((s2.y+s2.h) - s.y) < EPS && Math.abs(s2.x-s.x) < EPS && Math.abs(s2.w-s.w) < EPS
        if (side === 'bottom') return Math.abs(s2.y - (s.y+s.h)) < EPS && Math.abs(s2.x-s.x) < EPS && Math.abs(s2.w-s.w) < EPS
        if (side === 'left')   return Math.abs((s2.x+s2.w) - s.x) < EPS && Math.abs(s2.y-s.y) < EPS && Math.abs(s2.h-s.h) < EPS
        if (side === 'right')  return Math.abs(s2.x - (s.x+s.w)) < EPS && Math.abs(s2.y-s.y) < EPS && Math.abs(s2.h-s.h) < EPS
        return false
      })
      handles.push({ slotIdx:si, side:'top',    isOuter:!hasAdj('top'),    x1:s.x, x2:s.x+s.w, y:s.y       })
      handles.push({ slotIdx:si, side:'bottom',  isOuter:!hasAdj('bottom'), x1:s.x, x2:s.x+s.w, y:s.y+s.h   })
      handles.push({ slotIdx:si, side:'left',    isOuter:!hasAdj('left'),   y1:s.y, y2:s.y+s.h, x:s.x       })
      handles.push({ slotIdx:si, side:'right',   isOuter:!hasAdj('right'),  y1:s.y, y2:s.y+s.h, x:s.x+s.w   })
    })
    return handles
  }

  const handles = buildHandles()

  const startDrag = (e, handle) => {
    e.preventDefault(); e.stopPropagation()
    const snap = items.map(id=>({...id,slot:{...id.slot}}))
    const usableW = uw * scale, usableH = uh * scale
    const _dm = marginsForPage(profile, pageNum)
    dragRef.current = { handle, startX:e.clientX, startY:e.clientY, snap }

    const onMove = me => {
      if (!dragRef.current) return
      const { handle:h, snap:s0 } = dragRef.current
      const ns = s0.map(id=>({...id,slot:{...id.slot}}))
      const si = h.slotIdx

      const snap0   = v => Math.abs(v)     < SNAP_DIST ? 0   : v
      const snap100 = v => Math.abs(v-100) < SNAP_DIST ? 100 : v
      const fmt = v => parseFloat(v.toFixed(2))

      if (h.side === 'top' || h.side === 'bottom') {
        const dy = ((me.clientY - dragRef.current.startY) / usableH) * 100
        if (h.isOuter) {
          if (h.side === 'top') {
            const raw = s0[si].slot.y + dy
            const clamped = Math.max(0, Math.min(s0[si].slot.y + s0[si].slot.h - MIN_PCT, raw))
            const newY = snap0(clamped)
            ns[si].slot.h = fmt(s0[si].slot.h - (newY - s0[si].slot.y))
            ns[si].slot.y = fmt(newY)
          } else {
            const raw = s0[si].slot.y + s0[si].slot.h + dy
            const clamped = Math.max(s0[si].slot.y + MIN_PCT, Math.min(100, raw))
            const newBot = snap100(clamped)
            ns[si].slot.h = fmt(newBot - s0[si].slot.y)
          }
        } else if (h.side === 'top') {
          const maxUp   = s0[si].slot.h - MIN_PCT
          const maxDown = s0[si].slot.h - MIN_PCT
          const adj = Math.max(-maxUp, Math.min(maxDown, dy))
          ns[si].slot.y = fmt(s0[si].slot.y + adj)
          ns[si].slot.h = fmt(s0[si].slot.h - adj)
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs((s0[j].slot.y+s0[j].slot.h)-s0[si].slot.y)<EPS &&
               Math.abs(s0[j].slot.x-s0[si].slot.x)<EPS &&
               Math.abs(s0[j].slot.w-s0[si].slot.w)<EPS)
              ns[j].slot.h = fmt(s0[j].slot.h + adj)
          })
        } else {
          const maxDown = s0[si].slot.h - MIN_PCT
          const adj = Math.max(-maxDown, Math.min(maxDown, dy))
          ns[si].slot.h = fmt(s0[si].slot.h + adj)
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs(s0[j].slot.y-(s0[si].slot.y+s0[si].slot.h))<EPS &&
               Math.abs(s0[j].slot.x-s0[si].slot.x)<EPS &&
               Math.abs(s0[j].slot.w-s0[si].slot.w)<EPS) {
              ns[j].slot.y = fmt(s0[j].slot.y + adj)
              ns[j].slot.h = fmt(s0[j].slot.h - adj)
            }
          })
        }
      } else {
        const dx = ((me.clientX - dragRef.current.startX) / usableW) * 100
        if (h.isOuter) {
          if (h.side === 'left') {
            const raw = s0[si].slot.x + dx
            const clamped = Math.max(0, Math.min(s0[si].slot.x + s0[si].slot.w - MIN_PCT, raw))
            const newX = snap0(clamped)
            ns[si].slot.w = fmt(s0[si].slot.w - (newX - s0[si].slot.x))
            ns[si].slot.x = fmt(newX)
          } else {
            const raw = s0[si].slot.x + s0[si].slot.w + dx
            const clamped = Math.max(s0[si].slot.x + MIN_PCT, Math.min(100, raw))
            const newRight = snap100(clamped)
            ns[si].slot.w = fmt(newRight - s0[si].slot.x)
          }
        } else if (h.side === 'left') {
          const adj = Math.max(-(s0[si].slot.w-MIN_PCT), Math.min(s0[si].slot.w-MIN_PCT, dx))
          ns[si].slot.x = fmt(s0[si].slot.x + adj)
          ns[si].slot.w = fmt(s0[si].slot.w - adj)
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs((s0[j].slot.x+s0[j].slot.w)-s0[si].slot.x)<EPS &&
               Math.abs(s0[j].slot.y-s0[si].slot.y)<EPS &&
               Math.abs(s0[j].slot.h-s0[si].slot.h)<EPS)
              ns[j].slot.w = fmt(s0[j].slot.w + adj)
          })
        } else {
          const adj = Math.max(-(s0[si].slot.w-MIN_PCT), Math.min(s0[si].slot.w-MIN_PCT, dx))
          ns[si].slot.w = fmt(s0[si].slot.w + adj)
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs(s0[j].slot.x-(s0[si].slot.x+s0[si].slot.w))<EPS &&
               Math.abs(s0[j].slot.y-s0[si].slot.y)<EPS &&
               Math.abs(s0[j].slot.h-s0[si].slot.h)<EPS) {
              ns[j].slot.x = fmt(s0[j].slot.x + adj)
              ns[j].slot.w = fmt(s0[j].slot.w - adj)
            }
          })
        }
      }
      onUpdateItems(ns)
    }
    const onUp = () => { dragRef.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
  }

  const sx = pct => (_m.ml + (pct/100)*uw) * scale
  const sy = pct => (_m.mt + (pct/100)*uh) * scale
  const GRAB = 16, PILL = 28, THICK = 10

  return (
    <>
      {handles.map((h, hi) => {
        const col  = h.isOuter ? 'rgba(100,190,220,0.85)' : 'rgba(212,170,90,0.85)'
        const pill = h.isOuter ? '#5bbcd8'                : 'var(--gold)'
        if (h.side==='top'||h.side==='bottom') {
          const yPx = sy(h.y)
          const x1  = sx(h.x1), x2 = sx(h.x2)
          const len = x2-x1
          return (
            <div key={`${h.slotIdx}-${h.side}`}
              onMouseDown={e=>startDrag(e,h)}
              title={h.isOuter ? `Margine slot ${h.slotIdx+1} (${h.side})` : tp.resizeHintH(h.slotIdx+1, h.side)}
              style={{
                position:'absolute', left:x1, top:yPx-GRAB/2,
                width:len, height:GRAB, cursor:'row-resize', zIndex:40,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
              <div style={{position:'absolute',left:0,right:0,top:'50%',
                transform:'translateY(-50%)',height:h.isOuter?1.5:2,
                background:col, pointerEvents:'none'}}/>
              <div style={{position:'absolute',left:'50%',top:'50%',
                transform:'translate(-50%,-50%)',
                width:PILL,height:THICK,background:pill,
                borderRadius:THICK/2,pointerEvents:'none',
                boxShadow:'0 1px 6px rgba(0,0,0,0.5)',
                display:'flex',alignItems:'center',justifyContent:'center',gap:3}}>
                {[0,1,2].map(k=><div key={k} style={{width:3,height:4,borderRadius:2,background:'rgba(0,0,0,0.4)'}}/>)}
              </div>
            </div>
          )
        } else {
          const xPx = sx(h.x)
          const y1  = sy(h.y1), y2 = sy(h.y2)
          const len = y2-y1
          return (
            <div key={`${h.slotIdx}-${h.side}`}
              onMouseDown={e=>startDrag(e,h)}
              title={h.isOuter ? `Margine slot ${h.slotIdx+1} (${h.side})` : tp.resizeHintV(h.slotIdx+1, h.side)}
              style={{
                position:'absolute', top:y1, left:xPx-GRAB/2,
                height:len, width:GRAB, cursor:'col-resize', zIndex:40,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
              <div style={{position:'absolute',top:0,bottom:0,left:'50%',
                transform:'translateX(-50%)',width:h.isOuter?1.5:2,
                background:col, pointerEvents:'none'}}/>
              <div style={{position:'absolute',left:'50%',top:'50%',
                transform:'translate(-50%,-50%)',
                height:PILL,width:THICK,background:pill,
                borderRadius:THICK/2,pointerEvents:'none',
                boxShadow:'0 1px 6px rgba(0,0,0,0.5)',
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3}}>
                {[0,1,2].map(k=><div key={k} style={{height:3,width:4,borderRadius:2,background:'rgba(0,0,0,0.4)'}}/>)}
              </div>
            </div>
          )
        }
      })}
    </>
  )
}

// ── Photo slot — pan + zoom ───────────────────────────────────────────────────
// ── Photo slot — pan + zoom ───────────────────────────────────────────────────
function PhotoSlot({ item, slotW, slotH, transform, photoAR,
                     isEditMode, onEnterEdit, onExitEdit,
                     onTransformChange, onResetTransform,
                     originalTransform, mismatch }) {
  const t = useT(); const tp = t.preview
  const panDragRef = useRef(null)
  const containerRef = useRef(null)

  const imgStyle = photoStyle(photoAR, slotW, slotH, transform)

  // Mouse drag pan
  const startPan = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    const slotAR = slotW/slotH
    const zoom = transform?.zoom || 1
    const panX = transform?.x ?? 50
    const panY = transform?.y ?? 50
    const startX=e.clientX, startY=e.clientY

    // Calcola overflow disponibile in pixel (coordinate dello slot renderizzato)
    let baseW, baseH
    if ((photoAR||1) >= slotAR) { baseH=slotH; baseW=slotH*(photoAR||1) }
    else { baseW=slotW; baseH=slotW/(photoAR||1) }
    const imgW=baseW*zoom, imgH=baseH*zoom
    const maxDX=Math.max(0,imgW-slotW), maxDY=Math.max(0,imgH-slotH)

    panDragRef.current = {startX,startY,panX,panY,maxDX,maxDY}

    const onMove=(me)=>{
      if(!panDragRef.current) return
      const {startX,startY,panX,panY,maxDX,maxDY}=panDragRef.current
      // spostamento in pixel → converti in % dell'overflow
      const dx = maxDX>0 ? ((me.clientX-startX)/maxDX)*100 : 0
      const dy = maxDY>0 ? ((me.clientY-startY)/maxDY)*100 : 0
      onTransformChange({
        zoom,
        x: Math.max(0,Math.min(100,panX-dx)),
        y: Math.max(0,Math.min(100,panY-dy)),
      })
    }
    const onUp=()=>{panDragRef.current=null;window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp)}
    window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp)
  },[transform,photoAR,slotW,slotH,onTransformChange])

  // Scroll wheel zoom
  const onWheel = useCallback((e) => {
    if(!isEditMode) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.08 : 0.08
    const cur = transform?.zoom || 1
    const newZoom = Math.max(0.1, Math.min(4, cur+delta))
    onTransformChange({...(transform||{x:50,y:50}), zoom:newZoom})
  },[isEditMode,transform,onTransformChange])

  // Zoom buttons
  const adjustZoom = (delta) => {
    const cur = transform?.zoom || 1
    const newZoom = Math.max(0.1, Math.min(4, cur+delta))
    onTransformChange({...(transform||{x:50,y:50}), zoom:newZoom})
  }

  return (
    <div ref={containerRef} style={{width:'100%',height:'100%',position:'relative',overflow:'hidden'}}
      onWheel={onWheel}>

      {/* Photo image */}
      <img
        draggable={false}
        src={`/api/thumb/${item.asset_id}?size=preview`}
        alt="" loading="lazy"
        style={{...imgStyle, cursor: isEditMode ? 'move' : 'default'}}
      />

      {/* Pan overlay — solo in edit mode */}
      {isEditMode && (
        <div style={{position:'absolute',inset:0,zIndex:15,cursor:'move',background:'transparent'}}
          onMouseDown={startPan}/>
      )}

      {/* Mismatch badge — solo quando non in edit mode */}
      {mismatch && !isEditMode && (
        <div title="Proporzioni foto non corrispondono allo slot — clicca ⋮ → Riposiziona per regolare"
          style={{position:'absolute',top:4,left:4,
          background:'rgba(220,70,70,0.88)',color:'white',
          fontSize:9,padding:'2px 6px',borderRadius:4,
          fontFamily:'var(--font-mono)',pointerEvents:'auto',zIndex:12,lineHeight:1.4,cursor:'default'}}>
          ↕↔
        </div>
      )}

      {/* Edit mode: zoom controls + done/reset — angolo in alto a destra */}
      {isEditMode && (
        <div style={{position:'absolute',top:6,right:6,zIndex:20,
          display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
          <div style={{display:'flex',gap:3,alignItems:'center',
            background:'rgba(0,0,0,0.72)',borderRadius:6,padding:'4px 6px'}}>
            <button onMouseDown={e=>e.stopPropagation()} onClick={()=>adjustZoom(-0.15)}
              {...{title:tp.zoomOut}}
              style={{background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text)',
                width:24,height:24,borderRadius:4,cursor:'pointer',fontSize:15,lineHeight:1,
                display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
            <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:'#ddd',minWidth:34,textAlign:'center'}}>
              {Math.round((transform?.zoom||1)*100)}%
            </span>
            <button onMouseDown={e=>e.stopPropagation()} onClick={()=>adjustZoom(0.15)}
              {...{title:tp.zoomIn}}
              style={{background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text)',
                width:24,height:24,borderRadius:4,cursor:'pointer',fontSize:15,lineHeight:1,
                display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
          </div>
          <div style={{display:'flex',gap:3}}>
            <button onMouseDown={e=>e.stopPropagation()}
              onClick={()=>onResetTransform?.(originalTransform)}
              {...{title:tp.resetZoom}}
              style={{background:'rgba(0,0,0,0.72)',border:'1px solid rgba(255,255,255,0.18)',
                color:'#ccc',fontSize:10,padding:'3px 8px',borderRadius:4,cursor:'pointer'}}>
              ↺
            </button>
            <button onMouseDown={e=>e.stopPropagation()} onClick={onExitEdit}
              {...{title:tp.doneZoom}}
              style={{background:'var(--gold)',border:'none',color:'#0a0a0c',
                fontSize:10,padding:'3px 8px',borderRadius:4,cursor:'pointer',fontWeight:700}}>
              ✓
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const MAP_AR = 2.0  // matches backend generate_map_image(800, 400)

function MapSlot({ item, slotW, slotH, transform, isEditMode, onEnterEdit, onExitEdit, onTransformChange, onResetTransform }) {
  const panDragRef = useRef(null)
  const MAP_ZOOM_MIN = 0.3
  const MAP_ZOOM_MAX = 4
  const imgStyle = photoStyle(MAP_AR, slotW, slotH, transform)

  const startPan = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    const zoom = Math.max(MAP_ZOOM_MIN, transform?.zoom || 1)
    const panX = transform?.x ?? 50, panY = transform?.y ?? 50
    const slotAR = slotW / slotH
    let baseW, baseH
    if (MAP_AR >= slotAR) { baseH = slotH; baseW = slotH * MAP_AR }
    else                  { baseW = slotW; baseH = slotW / MAP_AR }
    const imgW = baseW * zoom, imgH = baseH * zoom
    const maxDX = Math.max(0, imgW - slotW), maxDY = Math.max(0, imgH - slotH)
    panDragRef.current = { startX:e.clientX, startY:e.clientY, panX, panY, maxDX, maxDY }
    const onMove = (me) => {
      if (!panDragRef.current) return
      const { startX, startY, panX, panY, maxDX, maxDY } = panDragRef.current
      const dx = maxDX > 0 ? ((me.clientX - startX) / maxDX) * 100 : 0
      const dy = maxDY > 0 ? ((me.clientY - startY) / maxDY) * 100 : 0
      onTransformChange({ zoom, x:Math.max(0,Math.min(100,panX-dx)), y:Math.max(0,Math.min(100,panY-dy)) })
    }
    const onUp = () => { panDragRef.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [transform, slotW, slotH, onTransformChange])

  const onWheel = useCallback((e) => {
    if (!isEditMode) return
    e.preventDefault()
    const newZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, (transform?.zoom||1) + (e.deltaY > 0 ? -0.08 : 0.08)))
    onTransformChange({ ...(transform||{x:50,y:50}), zoom:newZoom })
  }, [isEditMode, transform, onTransformChange])

  const adjustZoom = (delta) => {
    const newZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, (transform?.zoom||1) + delta))
    onTransformChange({ ...(transform||{x:50,y:50}), zoom:newZoom })
  }

  return (
    <div style={{width:'100%',height:'100%',position:'relative',overflow:'hidden',background:'#1a1a1a'}}
      onWheel={onWheel}>
      <img draggable={false}
        src={item._map_url || (item.map_key ? `/api/mapcache/${item.map_key}` : undefined)}
        alt="Mappa GPS"
        style={{...imgStyle, cursor:isEditMode?'move':'default', objectFit: item._map_url ? imgStyle.objectFit : 'contain'}}/>
      {isEditMode&&(
        <div style={{position:'absolute',inset:0,zIndex:15,cursor:'move',background:'transparent'}}
          onMouseDown={startPan}/>
      )}
      {isEditMode&&(
        <div style={{position:'absolute',top:6,right:6,zIndex:20,display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
          <div style={{display:'flex',gap:3,alignItems:'center',background:'rgba(0,0,0,0.72)',borderRadius:6,padding:'4px 6px'}}>
            <button onMouseDown={e=>e.stopPropagation()} onClick={()=>adjustZoom(-0.15)}
              style={{background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text)',
                width:24,height:24,borderRadius:4,cursor:'pointer',fontSize:15,lineHeight:1,
                display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
            <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:'#ddd',minWidth:34,textAlign:'center'}}>
              {Math.round((transform?.zoom||1)*100)}%</span>
            <button onMouseDown={e=>e.stopPropagation()} onClick={()=>adjustZoom(0.15)}
              style={{background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text)',
                width:24,height:24,borderRadius:4,cursor:'pointer',fontSize:15,lineHeight:1,
                display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
          </div>
          <div style={{display:'flex',gap:3}}>
            <button onMouseDown={e=>e.stopPropagation()}
              onClick={()=>onResetTransform?.({x:50,y:50,zoom:1})}
              style={{background:'rgba(0,0,0,0.72)',border:'1px solid rgba(255,255,255,0.18)',
                color:'#ccc',fontSize:10,padding:'3px 8px',borderRadius:4,cursor:'pointer'}}>↺</button>
            <button onMouseDown={e=>e.stopPropagation()} onClick={onExitEdit}
              style={{background:'var(--gold)',border:'none',color:'#0a0a0c',
                fontSize:10,padding:'3px 8px',borderRadius:4,cursor:'pointer',fontWeight:700}}>✓</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Layout picker with hover mini-preview ─────────────────────────────────────
function LayoutPickerDropdown({ allPageTypes, currentId, profile, onChange }) {
  const [open, setOpen] = useState(false)
  const [hoveredId, setHoveredId] = useState(null)
  const ref = useRef(null)
  const current = allPageTypes.find(pt => pt.id === currentId) || allPageTypes[0]

  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const [pw, ph] = getPageDims(profile)
  const PW = 52, PH = Math.round(ph / pw * PW)

  const SlotPreview = ({ pt }) => (
    <svg width={PW} height={PH} viewBox={`0 0 ${PW} ${PH}`}
      style={{ display:'block', flexShrink:0, borderRadius:2, overflow:'hidden' }}>
      <rect width={PW} height={PH} fill="#f0ece4"/>
      {(pt.slots || []).map((s, i) => {
        const sx = (s.x / 100) * PW, sy = (s.y / 100) * PH
        const sw = (s.w / 100) * PW, sh = (s.h / 100) * PH
        return <rect key={i} x={sx+0.5} y={sy+0.5} width={sw-1} height={sh-1}
          fill="none" stroke="rgba(100,140,200,0.6)" strokeWidth={1}/>
      })}
    </svg>
  )

  return (
    <div ref={ref} style={{ position:'relative', flex:1, minWidth:0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:6,
          fontSize:11, padding:'3px 6px',
          background:'var(--bg3)', border:'1px solid var(--border)',
          color:'var(--text)', borderRadius:5, cursor:'pointer', textAlign:'left' }}>
        {current && <SlotPreview pt={current}/>}
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {current?.label || '—'}
        </span>
        <span style={{ color:'var(--text3)', fontSize:9 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position:'absolute', top:'100%', left:0, zIndex:9200,
          background:'var(--bg2)', border:'1px solid var(--border)',
          borderRadius:8, boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
          height:360, minHeight:120, maxHeight:'70vh',
          overflowY:'auto', minWidth:200, marginTop:2,
          resize:'vertical',
        }}>
          {allPageTypes.map(pt => (
            <div key={pt.id}
              onMouseEnter={() => setHoveredId(pt.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => { onChange(pt.id); setOpen(false) }}
              style={{
                display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                cursor:'pointer', transition:'background 0.1s',
                background: pt.id === (hoveredId || currentId) ? 'var(--bg3)' : 'transparent',
                borderLeft: pt.id === currentId ? '3px solid var(--gold)' : '3px solid transparent',
              }}>
              <SlotPreview pt={pt}/>
              <span style={{ fontSize:12, color:'var(--text)', flex:1 }}>{pt.label}</span>
              {pt.id === currentId && <span style={{ fontSize:9, color:'var(--gold)' }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Editable page ─────────────────────────────────────────────────────────────
// ── BlankPage — stesse dimensioni e struttura di EditablePage ────────────────
// Replica pixel-perfect il layout di EditablePage: stesso ResizeObserver,
// stesso calcolo scale, stesso toolbar invisibile (visibility:hidden ma
// con le stesse dimensioni del toolbar reale → allineamento garantito da CSS).
function BlankPage({ profile, allPageTypes, label, maxW=570, zoomFactor=1 }) {
  const [pw,ph]=getPageDims(profile)
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(maxW)

  useEffect(()=>{
    if(!containerRef.current) return
    const ro = new ResizeObserver(([e])=> setContainerW(e.contentRect.width||maxW))
    ro.observe(containerRef.current)
    return ()=>ro.disconnect()
  },[maxW])

  const maxH_px = typeof window !== 'undefined' ? window.innerHeight * 0.65 : 600
  const scale = Math.min(containerW/pw, maxH_px/ph) * zoomFactor
  const W = pw*scale, H = ph*scale

  return (
    <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
      {/* Toolbar fantasma: usa lo stesso markup del LayoutPickerDropdown (<div> non <select>)
          così l'altezza coincide con quella di EditablePage → pagine allineate nello spread. */}
      {allPageTypes.length>0 && (
        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8,flexShrink:0,visibility:'hidden'}}>
          <span className="text-xs text-muted" style={{flexShrink:0}}>Layout:</span>
          <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:6,
            fontSize:11,padding:'3px 6px',
            background:'var(--bg3)',border:'1px solid var(--border)',
            color:'var(--text)',borderRadius:5}}>—</div>
          <button className="btn btn-sm" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}>+ Slot</button>
        </div>
      )}
      <div style={{width:W,height:H,background:'#f0ece4',
        boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,flexShrink:0,
        display:'flex',alignItems:'center',justifyContent:'center'}}>
        <p style={{fontSize:11,color:'#c0bbb2',fontFamily:'var(--font-mono)',fontStyle:'italic'}}>
          {label || 'pagina vuota'}
        </p>
      </div>
    </div>
  )
}

function autoNameSlots(slots, orientation) {
  const pageAR = orientation === 'landscape' ? 504/360 : 360/504
  const photo = slots.filter(s => s.slot_type !== 'caption')
  const capt  = slots.filter(s => s.slot_type === 'caption')
  const n = photo.length
  const suffix = capt.length > 0 ? ` +${capt.length}T` : ''
  if (n === 0) return capt.length === 1 ? '1 didascalia' : `${capt.length} didascalie`
  const nPort = photo.filter(s => (s.w / (s.h || 1)) * pageAR < 1).length
  const nLand = n - nPort
  if (n === 1) return `1 ${nPort ? 'verticale' : 'orizzontale'}${suffix}`
  if (n === 2) {
    if (nPort === 2) return `2 verticali${suffix}`
    if (nLand === 2) return `2 orizzontali${suffix}`
    return `vert + oriz${suffix}`
  }
  if (n === 3) {
    const areas = photo.map(s => s.w * s.h)
    const maxA = Math.max(...areas), minA = Math.min(...areas)
    if (maxA / minA > 2) return `1 grande + 2${suffix}`
    return `3 foto${suffix}`
  }
  const areas = photo.map(s => s.w * s.h)
  const maxA = Math.max(...areas), minA = Math.min(...areas)
  if (maxA / minA < 1.4) {
    if (n === 4) return `4 griglia 2×2${suffix}`
    if (n === 6) return `6 griglia 3×2${suffix}`
  }
  return `${n} foto${suffix}`
}

function EditablePage({ page, pageIdx, profile, allPageTypes,
                        photoAspects, photoTransforms, originalTransforms,
                        onTransformChange, onSwapTransforms, onSlotRemoved,
                        onUpdatePage, onOpenPicker, onAddCaption,
                        onDrop, maxW=570, onPhotoClick, onAddMap, isActive=false, zoomFactor=1,
                        dividerMapUrl, assets, assetById={}, onSaveCustomLayout }) {
  const t = useT(); const tp = t.preview
  const [pw,ph]=getPageDims(profile)
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(maxW)

  useEffect(()=>{
    if(!containerRef.current) return
    const ro = new ResizeObserver(([e])=> setContainerW(e.contentRect.width||maxW))
    ro.observe(containerRef.current)
    return ()=>ro.disconnect()
  },[maxW])

  // Cap scale so portrait pages don't overflow available viewport height.
  // 65vh leaves room for the top toolbar (~80px) and nav bar (~50px).
  const maxH_px = typeof window !== 'undefined' ? window.innerHeight * 0.65 : 600
  const scale=Math.min(containerW/pw, maxH_px/ph) * zoomFactor
  const W=pw*scale, H=ph*scale

  const [dragFromIdx,setDragFromIdx]=useState(null)
  const [dragOverIdx,setDragOverIdx]=useState(null)
  const [editCaptionIdx,setEditCaptionIdx]=useState(null)
  const [captionToolbarMore,setCaptionToolbarMore]=useState(false)
  const [syncToImmich,setSyncToImmich]=useState(true)
  const [showSymbols,setShowSymbols]=useState(false)
  const textareaRef=useRef(null)
  const [editPhotoSlot,setEditPhotoSlot]=useState(null)
  const [editMapSlot,setEditMapSlot]=useState(null)
  const [slotMenu,setSlotMenu]=useState(null) // {x,y,yAbove,title,items:[{icon,label,action,color,danger}]}
  const [dividerEditOpen,setDividerEditOpen]=useState(false)

  const openSlotMenu=(e, title, items)=>{
    e.stopPropagation()
    const rect=e.currentTarget.closest('[data-slot-anchor]')?.getBoundingClientRect()
      || e.currentTarget.getBoundingClientRect()
    setSlotMenu({x:rect.left+rect.width/2, y:rect.bottom+8, yAbove:rect.top-8, title, items})
  }

  // Reset edit quando cambia pagina
  useEffect(()=>{setEditPhotoSlot(null);setEditCaptionIdx(null);setCaptionToolbarMore(false);setShowSymbols(false);setSlotMenu(null)},[pageIdx])

  useEffect(()=>{
    if(!slotMenu) return
    const close=e=>{ if(!e.target.closest?.('[data-slot-menu]')) setSlotMenu(null) }
    const esc=e=>{ if(e.key==='Escape') setSlotMenu(null) }
    setTimeout(()=>{ window.addEventListener('mousedown',close); window.addEventListener('keydown',esc) },0)
    return ()=>{ window.removeEventListener('mousedown',close); window.removeEventListener('keydown',esc) }
  },[slotMenu])

  // Quando si apre una caption: imposta syncToImmich in base a for_asset_id
  useEffect(()=>{
    if(editCaptionIdx!==null){
      const it=page.items[editCaptionIdx]?.item
      setSyncToImmich(!!it?.for_asset_id)
      setShowSymbols(false)
    }
  },[editCaptionIdx])

  const swapItems=(fromIdx,toIdx)=>{
    if(fromIdx===toIdx) return
    const ni=page.items.map(i=>({...i}))
    const tmp=ni[fromIdx].item;ni[fromIdx]={...ni[fromIdx],item:ni[toIdx].item};ni[toIdx]={...ni[toIdx],item:tmp}
    onUpdatePage({...page,items:ni})
    onSwapTransforms?.(`${pageIdx}_${fromIdx}`,`${pageIdx}_${toIdx}`)
  }

  const removeSlot=(slotIdx)=>{
    const items=page.items; if(items.length<=1) return
    const slot=items[slotIdx].slot; const EPS=1.5
    let mergeIdx=-1,mergeDir=null
    for(let i=0;i<items.length;i++){
      if(i===slotIdx) continue
      const s=items[i].slot
      if(Math.abs(s.y-slot.y)<EPS&&Math.abs(s.h-slot.h)<EPS){
        if(Math.abs((s.x+s.w)-slot.x)<EPS){mergeIdx=i;mergeDir='leftOf';break}
        if(Math.abs((slot.x+slot.w)-s.x)<EPS){mergeIdx=i;mergeDir='rightOf';break}
      }
      if(Math.abs(s.x-slot.x)<EPS&&Math.abs(s.w-slot.w)<EPS){
        if(Math.abs((s.y+s.h)-slot.y)<EPS){mergeIdx=i;mergeDir='above';break}
        if(Math.abs((slot.y+slot.h)-s.y)<EPS){mergeIdx=i;mergeDir='below';break}
      }
    }
    let newItems
    if(mergeIdx>=0){
      newItems=items.map((id,i)=>{
        if(i!==mergeIdx) return id
        const s={...id.slot}
        if(mergeDir==='leftOf')  s.w=parseFloat((s.w+slot.w).toFixed(2))
        if(mergeDir==='rightOf'){s.x=slot.x;s.w=parseFloat((s.w+slot.w).toFixed(2))}
        if(mergeDir==='above')   s.h=parseFloat((s.h+slot.h).toFixed(2))
        if(mergeDir==='below')  {s.y=slot.y;s.h=parseFloat((s.h+slot.h).toFixed(2))}
        return {...id,slot:s}
      }).filter((_,i)=>i!==slotIdx)
    } else {
      newItems=items.filter((_,i)=>i!==slotIdx)
    }
    setEditPhotoSlot(null)
    onUpdatePage({...page,items:newItems,page_type_id:'custom',
      page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}})
    onSlotRemoved?.(pageIdx, slotIdx, items.length)
  }

  const removeItem=(slotIdx)=>
    onUpdatePage({...page,items:page.items.map((id,i)=>i===slotIdx?{...id,item:null}:id)})

  const updateCaption=(slotIdx, text, style)=>
    onUpdatePage({...page,items:page.items.map((id,i)=>i===slotIdx
      ? {...id,item:{...id.item, ...(text!==undefined?{text}:{}), ...(style?{caption_style:style}:{})}}
      : id)})

  // Sync caption text back to Immich as asset description
  const syncCaptionToImmich = async (slotIdx) => {
    const id = page.items[slotIdx]
    if (!id?.item?.for_asset_id || !id.item.text) return
    try {
      await axios.post(`/api/assets/${id.item.for_asset_id}/description`, {
        asset_id: id.item.for_asset_id,
        description: id.item.text,
      })
    } catch(e) { console.warn('Immich sync failed', e) }
  }

  const changePageType=(ptId)=>{
    const pt=allPageTypes.find(p=>p.id===ptId);if(!pt) return
    const curItems=page.items.map(i=>i.item)
    onUpdatePage({...page,page_type_id:ptId,page_type:pt,
      items:pt.slots.map((slot,idx)=>({slot,item:curItems[idx]??null}))})
  }

  const addSlot=()=>{
    let bigIdx=0,bigArea=0
    page.items.forEach((id,i)=>{const a=id.slot.w*id.slot.h;if(a>bigArea){bigArea=a;bigIdx=i}})
    const slot=page.items[bigIdx].slot
    let s1,s2
    if(slot.w>=slot.h){
      const half=parseFloat((slot.w/2).toFixed(2))
      s1={...slot,w:half}
      s2={x:parseFloat((slot.x+half).toFixed(2)),y:slot.y,w:parseFloat((slot.w-half).toFixed(2)),h:slot.h}
    } else {
      const half=parseFloat((slot.h/2).toFixed(2))
      s1={...slot,h:half}
      s2={x:slot.x,y:parseFloat((slot.y+half).toFixed(2)),w:slot.w,h:parseFloat((slot.h-half).toFixed(2))}
    }
    const ni=[...page.items];ni[bigIdx]={...ni[bigIdx],slot:s1};ni.push({slot:s2,item:null})
    onUpdatePage({...page,items:ni,page_type_id:'custom',
      page_type:{id:'custom',label:'Custom',slots:ni.map(i=>i.slot)}})
  }


  // Special pages: album cover marker and blank separator
  if (page?._album_cover) {
    const cs = profile?.cover_style || {}
    return (
      <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
        <div style={{width:W,height:H,background:cs.bg||'#0a0a0e',
          boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,overflow:'hidden',
          display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:14}}>
          <div style={{width:'60%',height:1,background:(cs.accent_color||'#d4aa5a')+'99'}}/>
          <p style={{fontFamily:'var(--font-display)',fontWeight:300,
            fontSize:Math.round(24*scale*2),color:cs.text_color||'#f0ede6',textAlign:'center',padding:'0 16px'}}>
            {page._album_info?.albumName||'Album'}
          </p>
          {page._album_info?.assetCount>0 && (
            <p style={{fontSize:Math.round(11*scale*2),color:cs.accent_color||'#d4aa5a',fontFamily:'var(--font-mono)'}}>
              {page._album_info.assetCount} foto
            </p>
          )}
          <div style={{width:'60%',height:1,background:(cs.accent_color||'#d4aa5a')+'99'}}/>
        </div>
      </div>
    )
  }

  if (page?._album_separator) {
    return (
      <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
        <div style={{width:W,height:H,background:'#e8e4dc',
          boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,
          display:'flex',alignItems:'center',justifyContent:'center'}}>
          <p style={{fontSize:11,color:'#aaa',fontFamily:'var(--font-mono)'}}>{tp.blankPage}</p>
        </div>
      </div>
    )
  }

  const isDivider = !!page?._album_divider

  // Divider pages use a dedicated element-based renderer instead of the slot system.
  if (isDivider) {
    const ds = migrateDividerStyle(page._divider_style)
    return (
      <>
      <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
        <div style={{position:'relative',flexShrink:0}}>
          <div style={{width:W,height:H,borderRadius:2,boxShadow:'0 16px 64px rgba(0,0,0,0.55)',overflow:'hidden'}}>
            <DividerCanvas
              style={ds}
              albumInfo={page._album_info}
              canvasW={W} canvasH={H}
              readOnly
              dividerMapUrl={dividerMapUrl}
            />
          </div>
        </div>
        <p className="text-xs text-muted mt-2">Pagina divisore album</p>
      </div>
      {/* Button always on top via portal */}
      {isActive && createPortal(
        <button
          onClick={()=>setDividerEditOpen(true)}
          style={{
            position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
            padding:'8px 22px', fontSize:12, fontWeight:500,
            background:'rgba(18,18,24,0.96)', border:'1px solid rgba(255,255,255,0.22)',
            borderRadius:8, cursor:'pointer', color:'#fff',
            boxShadow:'0 4px 20px rgba(0,0,0,0.6)', zIndex:8500,
            whiteSpace:'nowrap', letterSpacing:'0.02em',
          }}
        >✏ Modifica stile divisore</button>,
        document.body
      )}
      {dividerEditOpen && (
        <DividerEditorModal
          value={ds}
          onChange={newDs=>onUpdatePage({...page,_divider_style:newDs})}
          onClose={()=>setDividerEditOpen(false)}
          profile={profile}
          albumInfo={page._album_info}
          dividerMapUrl={dividerMapUrl}
          assets={assets}
        />
      )}
      </>
    )
  }

  return (
    <>
    <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
      {/* Page type switcher — custom picker with hover mini-preview */}
      {allPageTypes.length>0&&(
        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8,flexShrink:0}}>
          <span className="text-xs text-muted" style={{flexShrink:0}}>Layout:</span>
          <LayoutPickerDropdown
            allPageTypes={allPageTypes}
            currentId={page.page_type_id||''}
            profile={profile}
            onChange={changePageType}/>
          <button className="btn btn-sm" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}
            title={tp.addSlot} onClick={addSlot}>+ Slot</button>
          {page.page_type_id==='custom' && onSaveCustomLayout && (
            <button className="btn btn-sm btn-primary" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}
              title="Salva come nuovo tipo di pagina nel profilo"
              onClick={()=>onSaveCustomLayout(page.items.map(i=>i.slot))}>
              💾 Salva
            </button>
          )}
        </div>
      )}

      {/* Page canvas */}
      {(
      <div style={{width:W,height:H,
        background: '#f0ece4',
        position:'relative',
        boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,overflow:'hidden',
        outline: isActive ? '3px solid #4ac585' : 'none', outlineOffset:'3px',
        userSelect:'none',WebkitUserSelect:'none'}}>
        {/* Margin overlay — shows actual margin lines per page */}
        {(()=>{
          const _mo = marginsForPage(profile, pageIdx+2)
          const bleedMm = profile?.bleed ? (profile?.bleed_mm||3) : 0
          const bleedPx = bleedMm * 2.835 * scale
          const mlPx = _mo.ml*scale, mrPx = _mo.mr*scale
          const mtPx = _mo.mt*scale, mbPx = _mo.mb*scale
          return (
            <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1}} overflow="visible">
              {/* Margin lines */}
              <line x1={mlPx} y1={0} x2={mlPx} y2={H} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              <line x1={W-mrPx} y1={0} x2={W-mrPx} y2={H} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              <line x1={0} y1={mtPx} x2={W} y2={mtPx} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              <line x1={0} y1={H-mbPx} x2={W} y2={H-mbPx} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              {/* Binding edge highlight */}
              {profile?.duplex && (
                <rect
                  x={(pageIdx+2)%2===0 ? W-mrPx-1 : mlPx-2}
                  y={0} width={3} height={H}
                  fill="rgba(212,170,90,0.18)"
                />
              )}
              {/* Bleed indicators (corner marks) */}
              {bleedMm > 0 && profile?.crop_marks && (
                <g stroke="rgba(200,0,0,0.4)" strokeWidth={0.7}>
                  <line x1={0} y1={bleedPx} x2={bleedPx*0.6} y2={bleedPx}/>
                  <line x1={bleedPx} y1={0} x2={bleedPx} y2={bleedPx*0.6}/>
                  <line x1={W} y1={bleedPx} x2={W-bleedPx*0.6} y2={bleedPx}/>
                  <line x1={W-bleedPx} y1={0} x2={W-bleedPx} y2={bleedPx*0.6}/>
                  <line x1={0} y1={H-bleedPx} x2={bleedPx*0.6} y2={H-bleedPx}/>
                  <line x1={bleedPx} y1={H} x2={bleedPx} y2={H-bleedPx*0.6}/>
                  <line x1={W} y1={H-bleedPx} x2={W-bleedPx*0.6} y2={H-bleedPx}/>
                  <line x1={W-bleedPx} y1={H} x2={W-bleedPx} y2={H-bleedPx*0.6}/>
                </g>
              )}
              {/* Margin labels on hover area */}
              <text x={mlPx/2} y={mtPx+14} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">
                {profile?.duplex && (pageIdx+2)%2!==0 ? `Int ${profile?.margin_right||profile?.margin_mm||5}mm` : `Ext ${profile?.margin_left||profile?.margin_mm||5}mm`}
              </text>
              <text x={W-mrPx/2} y={mtPx+14} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">
                {profile?.duplex && (pageIdx+2)%2!==0 ? `Ext ${profile?.margin_left||profile?.margin_mm||5}mm` : `Int ${profile?.margin_right||profile?.margin_mm||5}mm`}
              </text>
              <text x={W/2} y={mtPx-3} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">↑ {profile?.margin_top||profile?.margin_mm||5}mm</text>
              <text x={W/2} y={H-mbPx+9} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">↓ {profile?.margin_bottom||profile?.margin_mm||5}mm</text>
            </svg>
          )
        })()}

        {(page?.items||[]).map((id,slotIdx)=>{
          const slot=id.slot||{x:0,y:0,w:100,h:100}
          const item=id.item
          const r=slotRect(slot,pw,ph,profile,scale,pageIdx+2)
          const panKey=`${pageIdx}_${slotIdx}`
          const transform=photoTransforms[panKey]||{x:50,y:50,zoom:1}
          const photoAR=item?.type==='photo'?photoAspects[item.asset_id]:null
          const mismatch=item?.type==='photo'&&isMismatch(photoAR,slot)
          const isPhotoEdit=editPhotoSlot===slotIdx
          const isMapEdit=editMapSlot===slotIdx
          const isDragSrc=dragFromIdx===slotIdx
          const isDragTgt=dragOverIdx===slotIdx
          const isCaptionEdit=editCaptionIdx===slotIdx
          const canDrag=!!item&&!isPhotoEdit&&!isMapEdit&&!isCaptionEdit
          const outlineColor=isPhotoEdit||isMapEdit?'#6a8fd8':mismatch?'#e05050':isDragTgt?'var(--gold)':'transparent'
          const outlineStyle=isDragTgt?'2px dashed':'3px solid'

          return (
            <div key={slotIdx}
              onClick={()=>{ if(item?.type==='photo'&&!isPhotoEdit&&!isCaptionEdit) onPhotoClick?.(item.asset_id) }}
              draggable={canDrag}
              onDragStart={e=>{if(!canDrag){e.preventDefault();return};setDragFromIdx(slotIdx)}}
              onDragEnd={()=>{setDragFromIdx(null);setDragOverIdx(null)}}
              onDragOver={e=>{
                e.preventDefault()
                // Accetta anche drag dal pannello album
                setDragOverIdx(slotIdx)
              }}
              onDragLeave={()=>setDragOverIdx(null)}
              onDrop={e=>{
                e.preventDefault()
                const extAssetId=e.dataTransfer.getData('asset_id')
                if(extAssetId) {
                  onDrop(pageIdx,slotIdx,extAssetId)
                } else if(dragFromIdx!=null) {
                  swapItems(dragFromIdx,slotIdx)
                }
                setDragFromIdx(null);setDragOverIdx(null)
              }}
              style={{
                position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,
                overflow:'hidden',boxSizing:'border-box',
                outline:`${outlineStyle} ${outlineColor}`,outlineOffset:'-3px',
                zIndex:isDragSrc||isDragTgt?5:isPhotoEdit?8:1,
              }}>

              {/* Empty slot — ＋ opens picker directly, ⋮ opens full menu */}
              {!item&&(
                <>
                  <div
                    style={{width:'100%',height:'100%',background:'#d0cdc6',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      cursor:'pointer',userSelect:'none'}}
                    onClick={e=>{ e.stopPropagation(); onOpenPicker(pageIdx,slotIdx) }}>
                    <span style={{fontSize:Math.max(10,Math.min(22,r.w*0.18)),color:'#999',
                      fontFamily:'var(--font-mono)',lineHeight:1,pointerEvents:'none'}}>＋</span>
                  </div>
                  <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                    e.stopPropagation()
                    const canRemove=page.items.length>1
                    openSlotMenu(e, 'Slot vuoto', [
                      {icon:'📷', label:'Scegli foto', action:()=>{ onOpenPicker(pageIdx,slotIdx); setSlotMenu(null) }, color:'#d4aa5a'},
                      {icon:'💬', label:'Didascalia',  action:()=>{ onAddCaption(pageIdx,slotIdx); setSlotMenu(null) }, color:'#4a9edd'},
                      {icon:'🗺',  label:'Mappa GPS',  action:()=>{ onAddMap?.(pageIdx,slotIdx); setSlotMenu(null) }, color:'#5dbd7a'},
                      ...(canRemove?[{icon:'✕', label:'Rimuovi slot', action:()=>{ removeSlot(slotIdx); setSlotMenu(null) }, danger:true}]:[]),
                    ])
                  }}>⋮</button>
                </>
              )}

              {/* Photo */}
              {item?.type==='photo'&&(
                <PhotoSlot
                  item={item}
                  slotW={r.w} slotH={r.h}
                  transform={transform}
                  photoAR={photoAR}
                  isEditMode={isPhotoEdit}
                  mismatch={mismatch}
                  onEnterEdit={()=>setEditPhotoSlot(slotIdx)}
                  onExitEdit={()=>setEditPhotoSlot(null)}
                  originalTransform={item?.type==='photo'
                    ? (originalTransforms?.[panKey] ?? {x:50, y:50, zoom:1})
                    : null}
                  onTransformChange={t=>onTransformChange(panKey,t)}
                  onResetTransform={(origT)=>{
                    onTransformChange(panKey, origT || {x:50, y:50, zoom:1})
                  }}
                />
              )}

              {/* Favorite / description badges — bottom-left to avoid mismatch badge overlap */}
              {item?.type==='photo'&&!isPhotoEdit&&(()=>{
                const asset = assetById[item.asset_id]
                if (!asset) return null
                const isFav = asset.isFavorite
                const hasDesc = !!(asset.description || asset.exifInfo?.description)
                if (!isFav && !hasDesc) return null
                const sz = Math.max(8,Math.min(14,r.w*0.1))
                return (
                  <div style={{ position:'absolute', bottom:3, left:3, display:'flex', gap:2,
                    pointerEvents:'auto', zIndex:4 }}>
                    {isFav  && <span title="Preferita in Immich" style={{ fontSize:sz,
                      lineHeight:1, filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.8))', cursor:'default' }}>⭐</span>}
                    {hasDesc && <span title="Ha didascalia in Immich" style={{ fontSize:sz,
                      lineHeight:1, filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.8))', cursor:'default' }}>💬</span>}
                  </div>
                )
              })()}

              {/* ⋮ button — opens floating action menu for photo slot */}
              {item?.type==='photo'&&!isPhotoEdit&&(
                <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                  e.stopPropagation()
                  openSlotMenu(e, 'Foto', [
                    {icon:'🖐', label: mismatch ? tp.repositionMismatch : tp.reposition, action:()=>{ setEditPhotoSlot(slotIdx); setSlotMenu(null) }, color: mismatch?'#e05050':undefined},
                    {icon:'🗺', label:'Inserisci mappa GPS', action:()=>{ onAddMap?.(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'🔄', label:tp.changePhoto, action:()=>{ onOpenPicker(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'💬', label:tp.addCaption, action:()=>{ onAddCaption(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'🗑️', label:tp.removePhoto, action:()=>{ removeItem(slotIdx); setSlotMenu(null) }, danger:true},
                  ])
                }}>⋮</button>
              )}



              {/* Map */}
              {item?.type==='map'&&(
                <MapSlot
                  item={item} slotW={r.w} slotH={r.h}
                  transform={transform}
                  isEditMode={isMapEdit}
                  onEnterEdit={()=>setEditMapSlot(slotIdx)}
                  onExitEdit={()=>setEditMapSlot(null)}
                  onTransformChange={t=>onTransformChange(panKey,t)}
                  onResetTransform={()=>onTransformChange(panKey,{x:50,y:50,zoom:1})}/>
              )}
              {/* ⋮ button — opens floating action menu for map slot */}
              {item?.type==='map'&&!isMapEdit&&(
                <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                  e.stopPropagation()
                  openSlotMenu(e, 'Mappa', [
                    {icon:'🖐', label:'Riposiziona / zoom mappa', action:()=>{ setEditMapSlot(slotIdx); setSlotMenu(null) }},
                    {icon:'🔄', label:'Rigenera mappa', action:()=>{ onAddMap?.(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'🗑️', label:'Rimuovi mappa', action:()=>{ removeItem(slotIdx); setSlotMenu(null) }, danger:true},
                  ])
                }}>⋮</button>
              )}

              {/* Caption */}
              {item?.type==='caption'&&(()=>{
                const profileCs = profile?.caption_style || {}
                const sessionCs = (() => { try { return JSON.parse(sessionStorage.getItem('pb_caption_style')||'{}') } catch { return {} } })()
                const cs = { ...profileCs, ...sessionCs, ...(item.caption_style||{}) }
                const font          = cs.font          || 'Georgia, serif'
                const size          = cs.size          || 13
                const color         = cs.color         || '#e8e6e0'
                const bg            = cs.bg            || '#111116'
                const align         = cs.align         || 'left'
                const valign        = cs.valign        || 'center'
                const italic        = cs.italic        !== false
                const bold          = cs.bold          || false
                const underline     = cs.underline     || false
                const lineHeight    = cs.lineHeight    || 1.55
                const letterSpacing = cs.letterSpacing || 0

                const setCs = (key, val) => {
                  try {
                    const cur = JSON.parse(sessionStorage.getItem('pb_caption_style')||'{}')
                    sessionStorage.setItem('pb_caption_style', JSON.stringify({...cur, [key]: val}))
                  } catch {}
                  updateCaption(slotIdx, undefined, {...(item.caption_style||{}), [key]: val})
                }

                const insertSymbol = (sym) => {
                  const ta = textareaRef.current
                  if (!ta) return
                  const start = ta.selectionStart, end = ta.selectionEnd
                  const newText = ta.value.substring(0, start) + sym + ta.value.substring(end)
                  updateCaption(slotIdx, newText)
                  requestAnimationFrame(() => {
                    if (textareaRef.current) {
                      textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + sym.length
                      textareaRef.current.focus()
                    }
                  })
                }

                // ── Toolbar helpers ──────────────────────────────────
                const TB = (active, extra={}) => ({
                  width:22, height:22, flexShrink:0, padding:0,
                  border:`1px solid ${active?'rgba(212,170,90,0.55)':'rgba(255,255,255,0.12)'}`,
                  borderRadius:4, cursor:'pointer',
                  background: active?'rgba(212,170,90,0.22)':'rgba(255,255,255,0.07)',
                  color: active?'#f0c040':'#ccc', fontSize:11,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  ...extra,
                })
                const SEP = { width:1, height:16, background:'rgba(255,255,255,0.1)', flexShrink:0, margin:'0 2px' }
                const TEXT_PRESETS = ['#ffffff','#f0ede6','#e8e4d0','#d4aa5a','#a8cfe8','#c8a0e8','#a8e0b0','#111116']
                const BG_PRESETS   = ['#111116','#13141a','#1a1a2e','#0a0a0e','transparent','#f0ece4','#2a1a0e','#1a2a1a']
                const FONTS = [
                  ['Georgia, serif',                     'Georgia'],
                  ['"Playfair Display", Georgia, serif',  'Playfair'],
                  ['"Helvetica Neue", Arial, sans-serif', 'Helvetica'],
                  ['Montserrat, Arial, sans-serif',       'Montserrat'],
                  ['"Courier New", monospace',            'Courier'],
                  ['var(--font-display)',                 'Display'],
                  ['var(--font-mono)',                    'Mono'],
                ]

                if (isCaptionEdit) return (
                  <>
                    {/* Floating toolbar — portal to document.body, unaffected by slot size */}
                    {createPortal(
                      <div style={{
                        position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
                        width:'min(calc(100vw - 24px), 720px)',
                        background:'rgba(10,10,18,0.96)', backdropFilter:'blur(18px)',
                        borderRadius:14, border:'1px solid rgba(255,255,255,0.1)',
                        boxShadow:'0 8px 48px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)',
                        zIndex:9999, overflow:'hidden',
                        userSelect:'none', WebkitUserSelect:'none',
                      }}>
                        {/* ── Main row ── */}
                        <div onMouseDown={e=>e.preventDefault()} style={{
                          display:'flex', gap:3, padding:'7px 10px', alignItems:'center', flexWrap:'wrap',
                        }}>
                          <span style={{fontSize:8,color:'rgba(255,255,255,0.28)',fontFamily:'var(--font-mono)',
                            letterSpacing:'0.08em',flexShrink:0,marginRight:1}}>DIDASCALIA</span>
                          <div style={SEP}/>

                          {/* Font family */}
                          <select value={font} onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('font',e.target.value)}
                            style={{height:26,fontSize:11,background:'rgba(255,255,255,0.07)',
                              border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,
                              color:'#ddd',padding:'0 4px',flexShrink:0,maxWidth:94,cursor:'pointer'}}>
                            {FONTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>

                          {/* Font size ± */}
                          <div style={{display:'flex',alignItems:'center',gap:1,flexShrink:0}}>
                            <button onMouseDown={e=>{e.preventDefault();setCs('size',Math.max(6,size-1))}}
                              style={TB(false,{width:24,height:26,borderRadius:5})}>−</button>
                            <input type="number" min={6} max={120} value={size}
                              onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('size',+e.target.value)}
                              style={{width:34,height:26,background:'rgba(255,255,255,0.07)',
                                border:'1px solid rgba(255,255,255,0.12)',borderRadius:5,
                                color:'#ddd',fontSize:11,textAlign:'center',padding:0}}/>
                            <button onMouseDown={e=>{e.preventDefault();setCs('size',Math.min(120,size+1))}}
                              style={TB(false,{width:24,height:26,borderRadius:5})}>+</button>
                          </div>

                          <div style={SEP}/>

                          {/* B I U */}
                          <button onMouseDown={e=>{e.preventDefault();setCs('bold',!bold)}}
                            style={TB(bold,{width:26,height:26,borderRadius:5,fontSize:13})}><b>B</b></button>
                          <button onMouseDown={e=>{e.preventDefault();setCs('italic',!italic)}}
                            style={TB(italic,{width:26,height:26,borderRadius:5,fontSize:13})}><i>I</i></button>
                          <button onMouseDown={e=>{e.preventDefault();setCs('underline',!underline)}}
                            style={TB(underline,{width:26,height:26,borderRadius:5,fontSize:13,textDecoration:'underline'})}>U</button>

                          <div style={SEP}/>

                          {/* Text align */}
                          {[['←','left'],['↔','center'],['→','right']].map(([icon,v])=>(
                            <button key={v} onMouseDown={e=>{e.preventDefault();setCs('align',v)}}
                              style={TB(align===v,{width:26,height:26,borderRadius:5,fontSize:14})} title={v}>{icon}</button>
                          ))}

                          <div style={SEP}/>

                          {/* Text color swatches + picker */}
                          <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0}}>T</span>
                          {TEXT_PRESETS.map(c=>(
                            <button key={c} onMouseDown={e=>{e.preventDefault();setCs('color',c)}} title={c}
                              style={{width:18,height:18,flexShrink:0,borderRadius:4,background:c,cursor:'pointer',padding:0,
                                border:color===c?'2px solid #f0c040':'1px solid rgba(255,255,255,0.18)'}}/>
                          ))}
                          <input type="color" value={color} onMouseDown={e=>e.stopPropagation()}
                            onChange={e=>setCs('color',e.target.value)}
                            style={{width:22,height:22,flexShrink:0,padding:1,
                              border:'1px solid rgba(255,255,255,0.12)',borderRadius:5,cursor:'pointer',background:'transparent'}}/>

                          <div style={SEP}/>

                          {/* Ω Simboli */}
                          <button onMouseDown={e=>{e.preventDefault();setShowSymbols(p=>!p);setCaptionToolbarMore(false)}}
                            style={TB(showSymbols,{width:28,height:26,borderRadius:5,fontSize:14})} title="Inserisci simbolo">Ω</button>

                          {/* ⋯ More */}
                          <button onMouseDown={e=>{e.preventDefault();setCaptionToolbarMore(p=>!p);setShowSymbols(false)}}
                            style={TB(captionToolbarMore,{width:28,height:26,borderRadius:5,fontSize:16})} title="Più opzioni">⋯</button>

                          {/* Push right */}
                          <div style={{marginLeft:'auto',display:'flex',gap:5,flexShrink:0,alignItems:'center'}}>
                            {/* Immich sync toggle */}
                            <button
                              onMouseDown={e=>{e.preventDefault();if(item.for_asset_id) setSyncToImmich(p=>!p)}}
                              title={item.for_asset_id ? (syncToImmich?'Sincronizzazione Immich attiva':'Sincronizzazione Immich disattivata') : 'Nessuna foto abbinata'}
                              style={TB(syncToImmich&&!!item.for_asset_id,{padding:'0 8px',width:'auto',height:26,fontSize:9,
                                whiteSpace:'nowrap',borderRadius:5,
                                opacity:item.for_asset_id?1:0.35,cursor:item.for_asset_id?'pointer':'default'})}>
                              {syncToImmich&&item.for_asset_id?'↑ Immich':'○ Immich'}
                            </button>
                            <button onMouseDown={e=>{e.preventDefault();if(syncToImmich) syncCaptionToImmich(slotIdx);setEditCaptionIdx(null)}}
                              style={{...TB(false),width:30,height:30,background:'rgba(212,170,90,0.2)',
                                color:'#f0c040',border:'1px solid rgba(212,170,90,0.4)',
                                fontSize:16,borderRadius:8}} title="Fine (Esc)">✓</button>
                          </div>
                        </div>

                        {/* ── Symbol picker row ── */}
                        {showSymbols&&(
                          <div onMouseDown={e=>e.preventDefault()} style={{
                            display:'flex', gap:2, padding:'6px 10px', alignItems:'center', flexWrap:'wrap',
                            background:'rgba(4,4,10,0.65)',
                            borderTop:'1px solid rgba(255,255,255,0.07)',
                          }}>
                            {['©','®','™','—','–','•','…','°','×','÷','±','√','≈','≠','≤','≥',
                              '←','→','↑','↓','↔','↕','«','»','„','"','"','\'','\'','‰','€','£','¥','¢',
                              '½','¼','¾','¹','²','³','α','β','γ','δ','∞','♥','★','☆','✓','✗'].map(sym=>(
                              <button key={sym} onMouseDown={e=>{e.preventDefault();insertSymbol(sym)}}
                                style={{width:26,height:26,flexShrink:0,borderRadius:4,cursor:'pointer',padding:0,
                                  background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',
                                  color:'#ddd',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                {sym}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* ── Extended row ── */}
                        {captionToolbarMore&&(
                          <div onMouseDown={e=>e.preventDefault()} style={{
                            display:'flex', gap:3, padding:'6px 10px', alignItems:'center', flexWrap:'wrap',
                            background:'rgba(4,4,10,0.65)',
                            borderTop:'1px solid rgba(255,255,255,0.07)',
                          }}>
                            {/* Vertical align */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0}}>V-align</span>
                            {[['↑','flex-start'],['↕','center'],['↓','flex-end']].map(([icon,v])=>(
                              <button key={v} onMouseDown={e=>{e.preventDefault();setCs('valign',v)}}
                                style={TB(valign===v,{width:26,height:26,borderRadius:5})}>{icon}</button>
                            ))}

                            <div style={SEP}/>

                            {/* Bg color */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0}}>BG</span>
                            {BG_PRESETS.map(c=>(
                              <button key={c} onMouseDown={e=>{e.preventDefault();setCs('bg',c)}} title={c==='transparent'?'Trasparente':c}
                                style={{width:18,height:18,flexShrink:0,borderRadius:4,cursor:'pointer',padding:0,
                                  background:c==='transparent'?'none':c,
                                  border:bg===c?'2px solid #f0c040':c==='transparent'?'1px dashed rgba(255,255,255,0.3)':'1px solid rgba(255,255,255,0.18)'}}/>
                            ))}
                            <input type="color" value={bg==='transparent'?'#000000':bg} onMouseDown={e=>e.stopPropagation()}
                              onChange={e=>setCs('bg',e.target.value)}
                              style={{width:22,height:22,flexShrink:0,padding:1,
                                border:'1px solid rgba(255,255,255,0.12)',borderRadius:5,cursor:'pointer',background:'transparent'}}/>

                            <div style={SEP}/>

                            {/* Line height */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0,whiteSpace:'nowrap'}}>↕ interlinea</span>
                            <input type="range" min={0.9} max={3} step={0.05} value={lineHeight}
                              onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('lineHeight',parseFloat(e.target.value))}
                              style={{width:80,accentColor:'#d4aa5a',flexShrink:0}}/>
                            <span style={{fontSize:10,color:'#bbb',width:30,textAlign:'right',flexShrink:0}}>{lineHeight.toFixed(2)}</span>

                            <div style={SEP}/>

                            {/* Letter spacing */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0,whiteSpace:'nowrap'}}>↔ spaziatura</span>
                            <input type="range" min={-2} max={10} step={0.5} value={letterSpacing}
                              onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('letterSpacing',parseFloat(e.target.value))}
                              style={{width:80,accentColor:'#d4aa5a',flexShrink:0}}/>
                            <span style={{fontSize:10,color:'#bbb',width:30,textAlign:'right',flexShrink:0}}>{letterSpacing}px</span>
                          </div>
                        )}
                      </div>,
                      document.body
                    )}

                    {/* Slot content — full-height textarea, gold outline shows active state */}
                    <div style={{width:'100%',height:'100%',background:bg,
                      outline:'2px solid rgba(212,170,90,0.55)',outlineOffset:'-2px'}}>
                      <textarea ref={textareaRef} autoFocus value={item.text||''}
                        onChange={e=>updateCaption(slotIdx, e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Escape'){ if(syncToImmich) syncCaptionToImmich(slotIdx); setEditCaptionIdx(null) } }}
                        style={{
                          width:'100%', height:'100%', background:'transparent',
                          border:'none', outline:'none', resize:'none', boxSizing:'border-box',
                          color, fontFamily:font, fontStyle:italic?'italic':'normal',
                          fontWeight:bold?'bold':'normal',
                          textDecoration:underline?'underline':'none',
                          fontSize:size, lineHeight, letterSpacing:letterSpacing?`${letterSpacing}px`:undefined,
                          padding:Math.max(6,r.w*0.04), textAlign:align,
                        }}/>
                    </div>
                  </>
                )

                // View mode
                return (
                  <div style={{width:'100%',height:'100%',background:bg,
                    display:'flex',alignItems:valign,
                    justifyContent:align==='left'?'flex-start':align==='right'?'flex-end':'center',
                    padding:Math.max(8,r.w*0.05),
                    cursor:'text'}}
                    onClick={()=>setEditCaptionIdx(slotIdx)}>
                    <span style={{color,fontFamily:font,fontStyle:italic?'italic':'normal',
                      fontWeight:bold?'bold':'normal',
                      textDecoration:underline?'underline':'none',
                      fontSize:size,textAlign:align,lineHeight,
                      letterSpacing:letterSpacing?`${letterSpacing}px`:undefined,
                      overflow:'hidden',display:'-webkit-box',
                      WebkitLineClamp:Math.max(2,Math.floor(r.h/((size||13)*(lineHeight||1.6)))),
                      WebkitBoxOrient:'vertical'}}>
                      {item.text||<span style={{opacity:0.32}}>clicca per scrivere…</span>}
                    </span>
                    <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                      e.stopPropagation()
                      openSlotMenu(e, 'Didascalia', [
                        {icon:'✏️', label:'Modifica', action:()=>{ setEditCaptionIdx(slotIdx); setSlotMenu(null) }},
                        {icon:'🗑️', label:'Rimuovi', action:()=>{ removeItem(slotIdx); setSlotMenu(null) }, danger:true},
                      ])
                    }}>⋮</button>
                  </div>
                )
              })()}
            </div>
          )
        })}

        {/* Slot dividers */}
        <SlotDividers items={page.items} pw={pw} ph={ph} profile={profile} scale={scale} pageNum={pageIdx+2}
          onUpdateItems={newItems=>onUpdatePage({...page,items:newItems,page_type_id:'custom',
            page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}})}/>
      </div>
      )}

    </div>

    {/* ── Floating slot action menu (portal, outside page canvas) ── */}
    {slotMenu && createPortal(
      (()=>{
        const VH=window.innerHeight, VW=window.innerWidth
        const menuH=32+slotMenu.items.length*46, menuW=200
        const fitsBelow=slotMenu.y+menuH<VH-12
        const top=fitsBelow?slotMenu.y:slotMenu.yAbove-menuH
        const left=Math.max(8,Math.min(slotMenu.x-menuW/2, VW-menuW-8))
        const arrowLeft=slotMenu.x-left
        return (
          <div data-slot-menu="1" style={{
            position:'fixed', top, left, width:menuW, zIndex:9900,
            background:'#1e2028', border:'1px solid #353840',
            borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.7)',
            overflow:'hidden',
          }}>
            {/* Arrow */}
            <div style={{position:'absolute',
              ...(fitsBelow
                ? {top:-6, borderBottom:'6px solid #353840'}
                : {bottom:-6, borderTop:'6px solid #353840'}),
              left:Math.max(10,Math.min(arrowLeft-6,menuW-22)),
              width:0,height:0,
              borderLeft:'6px solid transparent',borderRight:'6px solid transparent'}}/>
            <div style={{padding:'6px 8px',borderBottom:'1px solid #2a2d35',
              fontSize:10,color:'#6b7080',fontFamily:'var(--font-mono)',textAlign:'center',
              letterSpacing:'0.06em',textTransform:'uppercase'}}>
              {slotMenu.title}
            </div>
            {slotMenu.items.map(({icon,label,action,color,danger})=>{
              // Strip leading emoji/symbol from label when icon already shows it
              const displayLabel = icon ? label.replace(/^[^a-zA-ZÀ-ÖØ-öø-ÿ\d]+/, '').trim() : label
              return (
              <button key={label} onClick={action} style={{
                display:'flex',alignItems:'center',gap:10,width:'100%',padding:'11px 14px',
                background:'none',border:'none',cursor:'pointer',textAlign:'left',
                color: danger?'#e05050':'#e8e5de',
                fontSize:13,fontFamily:'var(--font-body)',
                borderBottom:'1px solid #2a2d35',transition:'background 0.12s'}}
                onMouseEnter={e=>e.currentTarget.style.background=danger?'rgba(224,80,80,0.08)':'rgba(255,255,255,0.05)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <span style={{fontSize:18,lineHeight:1}}>{icon}</span>
                <span style={{fontWeight:500,color:color||(danger?'#e05050':'inherit')}}>{displayLabel}</span>
              </button>
            )})}
          </div>
        )
      })(),
      document.body
    )}
    </>
  )
}

// ── Export panel ──────────────────────────────────────────────────────────────
function ExportPanel({ layout, onExport, exporting }) {
  const t = useT(); const tp = t.preview
  const [open, setOpen]       = useState(false)
  const [quality, setQuality] = useState('hires')   // 'hires' | 'preview'
  const [progress, setProgress] = useState(null)    // {pct, step} | null
  const pollRef = useRef(null)
  const p = layout?.profile || {}

  // Start polling progress when export begins, stop when done
  useEffect(() => {
    if (exporting) {
      setProgress({ pct: 0, step: tp.exportStart })
      pollRef.current = setInterval(async () => {
        try {
          const r = await axios.get('/api/export/progress')
          setProgress({ pct: r.data.pct, step: r.data.step })
          if (r.data.done) {
            clearInterval(pollRef.current)
            setTimeout(() => setProgress(null), 1500)
          }
        } catch {}
      }, 600)
    } else {
      clearInterval(pollRef.current)
    }
    return () => clearInterval(pollRef.current)
  }, [exporting])

  const pct = progress?.pct || 0

  return (
    <div style={{ padding:12, borderTop:'1px solid var(--border)', flexShrink:0 }}>
      {/* Main button with progress fill */}
      <button
        className="btn btn-primary w-full"
        style={{
          justifyContent:'center', fontSize:12, position:'relative',
          overflow:'hidden', transition:'background 0.3s',
        }}
        onClick={() => setOpen(o => !o)}
        disabled={exporting}>
        {/* Progress fill layer */}
        {exporting && pct > 0 && (
          <div style={{
            position:'absolute', left:0, top:0, bottom:0,
            width:`${pct}%`,
            background:'rgba(255,255,255,0.18)',
            transition:'width 0.5s ease',
            pointerEvents:'none',
          }}/>
        )}
        {/* Label */}
        <span style={{ position:'relative', zIndex:1 }}>
          {exporting
            ? <>{progress?.step || tp.exporting} {pct > 0 ? `(${pct}%)` : ''}</>
            : <>📄 Esporta</>}
        </span>
      </button>

      {open && !exporting && (
        <div style={{ marginTop:8, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:12 }}>
          {/* Profile info */}
          {(()=>{
            const base2 = p.margin_mm || 5
            const mTop    = p.margin_top    ?? base2
            const mBot    = p.margin_bottom ?? base2
            const mEst    = p.margin_left   ?? base2   // ← Esterno
            const mInt    = p.margin_right  ?? base2   // Interno →
            const rows = [
              ['📐 Formato', tp.exportFormat(p.page_size, p.orientation==='landscape'?tp.exportLandscape:tp.exportPortrait)],
              ['📐 Orientamento', p.orientation==='landscape' ? tp.exportLandscape : tp.exportPortrait],
              ['↑ Alto', `${mTop}mm`],
              ['↓ Basso', `${mBot}mm`],
              ['← Esterno', `${mEst}mm`],
              ['→ Interno', `${mInt}mm`],
              ['↔ Spazio foto', `${p.gap_mm ?? 3}mm`],
              p.bleed ? ['✂ Abbondanza', `${p.bleed_mm}mm`] : null,
              p.crop_marks ? ['✂ Crocini', 'Sì'] : null,
              ['📄 Pagine', `${(layout?.pages?.length||0)+1}`],
            ].filter(Boolean)
            return rows.map(([k,v]) => (
              <div key={k} style={{ fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text2)',
                display:'flex', justifyContent:'space-between', padding:'2px 0',
                borderBottom:'1px solid var(--border)' }}>
                <span>{k}</span><strong style={{ color:'var(--text)', maxWidth:'60%', textAlign:'right', wordBreak:'break-word' }}>{v}</strong>
              </div>
            ))
          })()}

          {/* Quality toggle */}
          <div style={{ marginTop:10, display:'flex', gap:4, padding:'6px 0' }}>
            {[["hires",tp.qualityHires,tp.qualityHiresDesc],
              ["preview",tp.qualityPreview,tp.qualityPreviewDesc]
            ].map(([v,lbl,hint]) => (
              <button key={v} onClick={() => setQuality(v)}
                title={hint}
                style={{ flex:1, padding:'5px 4px', fontSize:10, borderRadius:5,
                  border:`1px solid ${quality===v?'var(--gold)':'var(--border)'}`,
                  background: quality===v?'var(--gold-dim)':'var(--bg3)',
                  color: quality===v?'var(--gold)':'var(--text3)',
                  cursor:'pointer', lineHeight:1.3 }}>
                {lbl}
              </button>
            ))}
          </div>
          {quality === 'hires' && (
            <p style={{ fontSize:9, color:'var(--text3)', marginBottom:8, textAlign:'center' }}>
              ⏳ L'esportazione hi-res può richiedere qualche minuto
            </p>
          )}

          {/* Export buttons */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <button className="btn btn-primary" style={{ justifyContent:'center', fontSize:12 }}
              onClick={() => onExport('pdf', quality)}>
              📄 Esporta PDF
            </button>
            <button className="btn" style={{ justifyContent:'center', fontSize:12 }}
              onClick={() => onExport('svg', quality)}
              title="ZIP con SVG modificabili (Illustrator, Scribus, InDesign)">
              🎨 Esporta SVG / Illustrator
            </button>
          </div>
          <p style={{ textAlign:'center', fontSize:9, color:'var(--text3)', marginTop:6, fontFamily:'var(--font-mono)' }}>
            SVG: compatibile con Illustrator, Scribus, InDesign
          </p>
        </div>
      )}
    </div>
  )
}

// ── Project save / load modal ────────────────────────────────────────────────
function ProjectModal({ mode, layout, photoTransforms, currentPage, onClose, onLoad }) {
  // mode: 'save' | 'load'
  const t = useT(); const tp = t.preview
  const [projects, setProjects]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [projectName, setProjectName] = useState(() => {
    const storedName = sessionStorage.getItem('photobook_project_name')
    const storedId   = sessionStorage.getItem('photobook_project_id')
    if (storedId && storedName) return storedName
    return layout ? tp.projectDefaultName(layout.album?.albumName) : ''
  })
  const [saving, setSaving]       = useState(false)
  const [savedId, setSavedId]     = useState(null)   // current open project ID (for update)
  const [toast, setToast]         = useState(null)
  const nameRef = useRef()

  useEffect(() => {
    const stored = sessionStorage.getItem('photobook_project_id')
    if (stored) setSavedId(stored)
    loadList()   // carica lista in entrambe le modalità
    if (mode === 'save' && nameRef.current) setTimeout(()=>nameRef.current?.select(), 100)
  }, [mode])

  const loadList = async () => {
    setLoading(true)
    try {
      const list = (await axios.get('/api/projects')).data
      setProjects(list)
      // Pre-fill project name from the currently open project (not generic album name)
      if (mode === 'save') {
        const sid = sessionStorage.getItem('photobook_project_id')
        if (sid) {
          const existing = list.find(p => String(p.id) === String(sid))
          if (existing) setProjectName(existing.name)
        }
      }
    }
    catch { setToast({ type:'error', msg:tp.projectListError }) }
    finally { setLoading(false) }
  }

  const handleSave = async () => {
    if (!projectName.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: projectName.trim(),
        album: layout.album,
        profile: layout.profile,
        pages: layout.pages,
        locations: layout.locations || [],
        photo_transforms: photoTransforms,
        current_page: currentPage,
      }
      // Read from sessionStorage (not state) so handleSaveNew (which removes the key) works correctly
      const sid = sessionStorage.getItem('photobook_project_id')
      let res
      if (sid) {
        res = await axios.put(`/api/projects/${sid}`, payload)
        setToast({ type:'success', msg:tp.projectSavedOk })
      } else {
        res = await axios.post('/api/projects', payload)
        sessionStorage.setItem('photobook_project_id', res.data.id)
        setSavedId(res.data.id)
        setToast({ type:'success', msg:tp.projectNewSavedOk })
      }
      sessionStorage.setItem('photobook_project_name', projectName.trim())
      setTimeout(onClose, 1200)
    } catch {
      setToast({ type:'error', msg:tp.projectSaveError })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveNew = async () => {
    setSavedId(null)
    sessionStorage.removeItem('photobook_project_id')
    sessionStorage.removeItem('photobook_project_name')
    await handleSave()
  }

  // In save mode: select project as overwrite target (never loads/replaces current work)
  const handleSelectForSave = (pid) => {
    const project = projects.find(p => String(p.id) === String(pid))
    if (!project) return
    setProjectName(project.name)
    setSavedId(String(pid))
    sessionStorage.setItem('photobook_project_id', String(pid))
    sessionStorage.setItem('photobook_project_name', project.name)
    if (nameRef.current) { nameRef.current.focus(); nameRef.current.select() }
  }

  // In load mode: actually loads the project (replaces current work)
  const handleLoad = async (pid) => {
    try {
      const r = await axios.get(`/api/projects/${pid}`)
      sessionStorage.setItem('photobook_layout', JSON.stringify({
        album: r.data.album,
        profile: r.data.profile,
        pages: r.data.pages,
        locations: r.data.locations || [],
      }))
      sessionStorage.setItem('photobook_project_id', pid)
      sessionStorage.setItem('photobook_project_name', r.data.name || '')
      onLoad(r.data)   // parent aggiorna stato
      onClose()
    } catch {
      setToast({ type:'error', msg:tp.projectLoadError })
    }
  }

  const handleDelete = async (pid, name, e) => {
    e.stopPropagation()
    if (!window.confirm(`Eliminare il progetto "${name}"?`)) return
    await axios.delete(`/api/projects/${pid}`)
    setProjects(p => p.filter(x => x.id !== pid))
  }

  const fmt = iso => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })
  }

  return createPortal(
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:8000 }}
        onClick={e => e.target===e.currentTarget && onClose()}/>
      <div style={{
        position:'fixed', top:'50%', left:'50%',
        transform:'translate(-50%,-50%)',
        width: 520, maxHeight:'80vh',
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        zIndex:8001, display:'flex', flexDirection:'column', overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:'var(--bg3)', flexShrink:0 }}>
          <div>
            <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:20, marginBottom:2 }}>
              {mode === 'save' ? '💾 Salva progetto' : '📂 Apri progetto'}
            </h3>
            <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
              {mode === 'save'
                ? 'Salva il layout corrente per riprendere in un altro momento'
                : 'Seleziona un progetto salvato per caricarlo'}
            </p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none',
            color:'var(--text3)', fontSize:20, cursor:'pointer', padding:'0 4px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:24 }}>

          {mode === 'save' && (
            <div>
              <label className="form-label">Nome del progetto</label>
              <input ref={nameRef} className="form-input" value={projectName}
                onChange={e => setProjectName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="es. Vacanze estate 2024"/>
              <p className="text-xs text-muted" style={{ marginTop:6 }}>
                {savedId
                  ? `Premi "Aggiorna" per sovrascrivere, oppure "Salva come nuovo" per una copia`
                  : 'Verrà creato un nuovo progetto'}
              </p>

              <div style={{ display:'flex', gap:10, marginTop:20 }}>
                {savedId && (
                  <button className="btn btn-primary" style={{ flex:1, justifyContent:'center' }}
                    onClick={handleSave} disabled={saving || !projectName.trim()}>
                    {saving ? <><span className="spinner" style={{width:13,height:13}}/> Salvataggio…</> : '💾 Aggiorna'}
                  </button>
                )}
                <button className={`btn ${savedId ? '' : 'btn-primary'}`}
                  style={{ flex:1, justifyContent:'center' }}
                  onClick={savedId ? handleSaveNew : handleSave}
                  disabled={saving || !projectName.trim()}>
                  {saving ? <><span className="spinner" style={{width:13,height:13}}/> Salvataggio…</>
                    : savedId ? tp.projectSaveNewBtn : '💾 Salva'}
                </button>
              </div>

              <hr className="divider"/>
              <p className="text-xs text-muted mb-4">
                Sovrascivi un progetto esistente — <em>clicca per selezionare</em>
              </p>
              {loading && <div style={{ textAlign:'center', padding:16 }}><span className="spinner"/></div>}
              {!loading && projects.length === 0 && (
                <p className="text-sm text-muted" style={{ textAlign:'center', padding:16 }}>
                  Nessun progetto salvato
                </p>
              )}
              {!loading && projects.map(p => (
                <ProjectRow key={p.id} project={p} fmt={fmt}
                  selected={String(p.id) === String(savedId)}
                  onLoad={handleSelectForSave} onDelete={handleDelete}/>
              ))}
              {!loading && projects.length === 0 && (
                <button className="btn btn-sm" onClick={loadList} style={{ marginTop:8 }}>
                  Aggiorna lista
                </button>
              )}
            </div>
          )}

          {mode === 'load' && (
            <div>
              {loading && <div style={{ textAlign:'center', padding:32 }}><span className="spinner" style={{ width:24, height:24 }}/></div>}
              {!loading && projects.length === 0 && (
                <div className="empty-state" style={{ padding:'40px 0' }}>
                  <div className="icon" style={{ fontSize:36 }}>📭</div>
                  <h3 style={{ fontSize:18 }}>Nessun progetto salvato</h3>
                  <p>Usa "Salva progetto" dall'anteprima per conservare il tuo lavoro</p>
                </div>
              )}
              {!loading && projects.map(p => (
                <ProjectRow key={p.id} project={p} fmt={fmt} onLoad={handleLoad} onDelete={handleDelete}/>
              ))}
            </div>
          )}
        </div>

        {toast && (
          <div style={{ padding:'12px 24px', borderTop:'1px solid var(--border)',
            background: toast.type==='success' ? 'rgba(74,197,133,0.1)' : 'rgba(197,74,74,0.1)',
            color: toast.type==='success' ? 'var(--success)' : 'var(--danger)',
            fontSize:13, flexShrink:0 }}>
            {toast.msg}
          </div>
        )}
      </div>
    </>,
    document.body
  )
}

function ProjectRow({ project, fmt, onLoad, onDelete, selected }) {
  const t = useT(); const tp = t.preview
  return (
    <div
      onClick={() => onLoad(project.id)}
      style={{
        display:'flex', gap:12, alignItems:'center',
        padding:'12px 14px', borderRadius:8, cursor:'pointer',
        border: selected ? '1px solid var(--gold)' : '1px solid var(--border)',
        marginBottom:8,
        transition:'background 0.12s, border-color 0.12s',
        background: selected ? 'var(--gold-dim,rgba(212,175,55,0.08))' : 'var(--bg3)',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.background='var(--bg)'; e.currentTarget.style.borderColor='var(--gold)' } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.background='var(--bg3)'; e.currentTarget.style.borderColor='var(--border)' } }}>
      <span style={{ fontSize:24, flexShrink:0 }}>📖</span>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:14, fontWeight:500, color:'var(--text)', marginBottom:2,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {project.name}
        </p>
        <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
          {project.album_name} · {project.page_count} pag.
          {project.profile_name ? ` · ${project.profile_name}` : ''}
        </p>
        <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', marginTop:2 }}>
          {project.saved_at ? `Salvato: ${fmt(project.saved_at)}` : ''}
        </p>
      </div>
      <button
        onClick={e => onDelete(project.id, project.name, e)}
        title="Elimina progetto"
        style={{ background:'none', border:'1px solid var(--border)',
          color:'var(--text3)', borderRadius:5, padding:'4px 8px',
          cursor:'pointer', fontSize:12, flexShrink:0 }}>
        🗑️
      </button>
    </div>
  )
}

// ── Recalculate menu — rendered via Portal to escape sidebar overflow ─────────────
// anchorRef: ref del bottone trigger, usato per calcolare la posizione sullo schermo
function RecalcMenu({ anchorRef, currentPage, totalPages, busy, onAction, onClose }) {
  const t = useT(); const tp = t.preview
  const fromIdx = Math.max(0, currentPage)
  const atTitle = currentPage === -1
  const isFirst  = fromIdx === 0

  const [pos, setPos] = useState(null)
  const SECTIONS = tp.recalcSections(fromIdx, totalPages, atTitle, isFirst)

  useEffect(() => {
    if (!anchorRef?.current) return
    const update = () => {
      const r = anchorRef.current.getBoundingClientRect()
      setPos({ top: r.top, left: r.right + 8 })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchorRef])


  if (!pos) return null

  const menuTop  = Math.min(pos.top,  window.innerHeight - 560)
  const menuLeft = Math.min(pos.left, window.innerWidth  - 360)
  const maxH     = window.innerHeight - menuTop - 20

  return createPortal(
    <>
      {/* Backdrop per chiudere cliccando fuori */}
      <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={onClose}/>

      {/* Pannello menu — fuori dalla gerarchia del sidebar */}
      <div style={{
        position:'fixed', top:menuTop, left:menuLeft, width:348,
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:10, boxShadow:'0 24px 72px rgba(0,0,0,0.72)',
        zIndex:9999, overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding:'11px 16px 9px', borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:'var(--bg3)',
        }}>
          <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text3)',
            textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:500}}>
            {tp.recalcTitle}
          </span>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>
              {atTitle ? tp.recalcCover : `pag. ${fromIdx + 1} / ${totalPages}`}
            </span>
            <button onClick={onClose}
              style={{background:'none',border:'none',color:'var(--text3)',
                fontSize:16,cursor:'pointer',lineHeight:1,padding:'0 2px',
                display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
          </div>
        </div>

        <div style={{maxHeight:maxH, overflowY:'auto'}}>
          {SECTIONS.map((section, si) => (
            <div key={si} style={{borderBottom: si < SECTIONS.length - 1 ? '1px solid var(--border)' : 'none'}}>
              <div style={{padding:'8px 16px 2px', fontSize:10, fontFamily:'var(--font-mono)',
                color:'var(--text3)', letterSpacing:'0.09em', textTransform:'uppercase'}}>
                {section.title}
              </div>
              {section.items.map(opt => (
                <button key={opt.id}
                  disabled={busy || opt.disabled}
                  onClick={() => onAction(opt.id)}
                  style={{
                    width:'100%', display:'flex', gap:11, padding:'10px 16px',
                    alignItems:'flex-start', background:'transparent', border:'none',
                    borderTop:'1px solid var(--border)',
                    cursor: (busy || opt.disabled) ? 'not-allowed' : 'pointer',
                    textAlign:'left', opacity: opt.disabled ? 0.38 : 1,
                    transition:'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!opt.disabled && !busy) e.currentTarget.style.background = 'var(--bg3)' }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{fontSize:19,flexShrink:0,lineHeight:1.3}}>{opt.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{
                      fontSize:13, fontWeight:500, marginBottom:3, lineHeight:1.2,
                      color: opt.danger ? 'var(--danger)' : opt.highlight ? 'var(--gold2)' : 'var(--text)',
                    }}>{opt.label}</div>
                    <div style={{fontSize:11,color:'var(--text3)',lineHeight:1.45}}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        {busy && (
          <div style={{padding:'10px 16px', borderTop:'1px solid var(--border)',
            display:'flex', alignItems:'center', gap:8, background:'var(--bg3)'}}>
            <span className="spinner" style={{width:14,height:14}}/>
            <span style={{fontSize:12,color:'var(--text2)'}}>Operazione in corso…</span>
          </div>
        )}
      </div>
    </>,
    document.body
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PreviewPage() {
  const t = useT(); const tp = t.preview
  const navigate=useNavigate()
  const [layout,setLayout]=useState(null)
  const [currentPage,setCurrentPage]=useState(-1)
  const [photoAspects,setPhotoAspects]=useState({})
  const [photoTransforms,setPhotoTransforms]=useState({})  // key → {x,y,zoom}
  const originalTransformsRef = useRef({})  // immutable copy of algo-computed transforms
  const [photoPicker,setPhotoPicker]=useState(null)
  const [albumAssets,setAlbumAssets]=useState([])
  const [allAlbumAssets,setAllAlbumAssets]=useState([])
  const [mapUrl,setMapUrl]=useState(null)
  const [dividerMapUrls,setDividerMapUrls]=useState({})
  const [exporting,setExporting]=useState(false)
  const [recalculating,setRecalculating]=useState(false)
  const [logViewerOpen,setLogViewerOpen]=useState(false)
  const [toast,setToast]=useState(null)
  const [hasChanges,setHasChanges]=useState(false)
  const [recalcMenuOpen,setRecalcMenuOpen]=useState(false)
  const [projectModal,setProjectModal]=useState(null)  // null | 'save' | 'load'
  const [lastAutoSave,setLastAutoSave]=useState(null)
  const autoSaveTimerRef = useRef(null)
  const liveLayoutRef = useRef(null)
  const liveTransformsRef = useRef(null)
  const livePageRef = useRef(null)
  const recalcBtnRef = useRef(null)
  const sidebarListRef = useRef(null)
  const [panelOpen,setPanelOpen]=useState(()=>{try{return JSON.parse(localStorage.getItem('pb_panelOpen'))??true}catch{return true}})
  const [draggedAsset,setDraggedAsset]=useState(null)
  const [spreadView,setSpreadView]=useState(()=>{try{return JSON.parse(localStorage.getItem('pb_spreadView'))||false}catch{return false}})
  const [viewZoom,setViewZoom]=useState(1.0)
  const zoomStep=0.15
  const zoomMin=0.3
  const zoomMax=2.5
  const [sidebarDrag,setSidebarDrag]=useState(null)
  const [leftSidebarOpen,setLeftSidebarOpen]=useState(true)
  const [coverStyleOpen,setCoverStyleOpen]=useState(false)
  const [highlightedAsset,setHighlightedAsset]=useState(null)  // asset_id highlighted in right panel
  const highlightRef=useRef(null)  // ref to highlighted element in AlbumPanel

  useEffect(() => {
    const stored = sessionStorage.getItem('photobook_layout')
    if (!stored) return
    const data = JSON.parse(stored); setLayout(data)
    // Load face-aware transforms from smart layout (if any)
    const storedTransforms = sessionStorage.getItem('photobook_transforms')
    if (storedTransforms) {
      try {
        const t = JSON.parse(storedTransforms)
        setPhotoTransforms(t)
        // Snapshot the algorithm-computed transforms — used by "ripristina" button
        originalTransformsRef.current = t
      } catch {}
    }
    if (data.locations?.length)
      axios.post('/api/map',{locations:data.locations, map_style: data.profile?.map_style||{}},{responseType:'blob'})
        .then(r=>setMapUrl(URL.createObjectURL(r.data))).catch(()=>{})
    // Per-divider album map URLs
    if (data.pages) {
      const mapStyle = data.profile?.map_style || {}
      data.pages.forEach((pg, idx) => {
        if (!pg._album_divider) return
        const locs = pg._album_info?.locations
        if (!locs?.length) return
        axios.post('/api/map', { locations:locs, map_style:mapStyle }, { responseType:'blob' })
          .then(r => setDividerMapUrls(prev => ({ ...prev, [idx]: URL.createObjectURL(r.data) })))
          .catch(() => {})
      })
    }
    const sortAssets = arr => [...(arr||[])].sort((a,b)=>(a.localDateTime||'').localeCompare(b.localDateTime||''))
    if (data._multi_album && data._album_ids?.length) {
      Promise.all(data._album_ids.map(id=>axios.get(`/api/albums/${id}`)))
        .then(results=>{
          const perAlbum = results.map(r=>sortAssets(r.data.assets))
          setAllAlbumAssets(perAlbum)
          setAlbumAssets(perAlbum.flat())
        }).catch(()=>{})
    } else if (data.album?.id) {
      axios.get(`/api/albums/${data.album.id}`)
        .then(r=>{ const s=sortAssets(r.data.assets); setAlbumAssets(s); setAllAlbumAssets([s]) }).catch(()=>{})
    }
  },[])

  // Sync sidebar page list to current page
  useEffect(() => {
    if (!sidebarListRef.current) return
    const active = sidebarListRef.current.querySelector('.page-thumb-item.active')
    if (active) active.scrollIntoView({ behavior:'smooth', block:'nearest' })
  }, [currentPage])

  // Keep live refs in sync (avoid stale closures in auto-save interval)
  useEffect(()=>{ liveLayoutRef.current = layout },[layout])
  useEffect(()=>{ liveTransformsRef.current = photoTransforms },[photoTransforms])
  useEffect(()=>{ livePageRef.current = currentPage },[currentPage])

  // Auto-save every 5 minutes to the currently open project (or a new draft)
  useEffect(()=>{
    if (!layout) return
    autoSaveTimerRef.current = setInterval(async () => {
      const lo = liveLayoutRef.current
      if (!lo) return
      const pid  = sessionStorage.getItem('photobook_project_id')
      const pname = sessionStorage.getItem('photobook_project_name') || `Bozza — ${lo.album?.albumName || 'progetto'}`
      const payload = {
        name: pname,
        album: lo.album,
        profile: lo.profile,
        pages: lo.pages,
        locations: lo.locations || [],
        photo_transforms: liveTransformsRef.current || {},
        current_page: livePageRef.current ?? 0,
      }
      try {
        if (pid) {
          await axios.put(`/api/projects/${pid}`, payload)
        } else {
          const res = await axios.post('/api/projects', payload)
          sessionStorage.setItem('photobook_project_id', res.data.id)
          sessionStorage.setItem('photobook_project_name', pname)
        }
        setLastAutoSave(new Date())
      } catch {}
    }, 5 * 60 * 1000)
    return () => clearInterval(autoSaveTimerRef.current)
  }, [!!layout])  // restart only when layout goes null↔loaded

  // Detect aspect ratios
  useEffect(()=>{
    if(!layout) return
    const seen=new Set()
    layout.pages.forEach(pg=>pg.items.forEach(id=>{
      const item=id.item
      if(item?.type==='photo'&&!photoAspects[item.asset_id]&&!seen.has(item.asset_id)){
        seen.add(item.asset_id)
        const img=new Image()
        img.onload=()=>setPhotoAspects(prev=>({...prev,[item.asset_id]:img.naturalWidth/img.naturalHeight}))
        img.src=`/api/thumb/${item.asset_id}?size=preview`
      }
    }))
  },[layout])

  // Keyboard navigation
  useEffect(()=>{
    const onKey=e=>{
      if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT') return
      if(!layout) return
      if(e.key==='ArrowRight'||e.key==='ArrowDown') setCurrentPage(p=>{
        if(spreadView&&p>=0){const l=p%2===0?p-1:p;return Math.min(layout.pages.length-1,l+2)}
        return Math.min(layout.pages.length-1,p+1)
      })
      if(e.key==='ArrowLeft'||e.key==='ArrowUp') setCurrentPage(p=>{
        if(spreadView&&p>=0){const l=p%2===0?p-1:p;return Math.max(-1,l-2)}
        return Math.max(-1,p-1)
      })
    }
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[layout])

  // Compute usage map AND which pages each asset appears on
  const usageMap   = {}
  const usagePages = {}  // assetId → [pageIdx, ...]
  if(layout) {
    layout.pages.forEach((pg, pi) => pg.items.forEach(id => {
      if(id.item?.type==='photo') {
        const aid = id.item.asset_id
        usageMap[aid]   = (usageMap[aid]   || 0) + 1
        usagePages[aid] = [...(usagePages[aid] || []), pi]
      }
    }))
  }

  const assetById = useMemo(() => Object.fromEntries(albumAssets.map(a=>[a.id,a])), [albumAssets])

  const persist=(nl)=>{sessionStorage.setItem('photobook_layout',JSON.stringify(nl));return nl}

  const updatePage=useCallback((idx,newPage)=>{
    setLayout(prev=>{const pages=[...prev.pages];pages[idx]=newPage;return persist({...prev,pages})})
    setHasChanges(true)
  },[])

  // ── Page management ──────────────────────────────────────────────────────────
  const addPage = (afterIdx) => {
    // Add a blank page with the first available page type (or single slot)
    const profile = layout?.profile || {}
    const pts = profile.page_types || []
    const defaultPT = pts[0] || {id:'blank',label:'Vuota',slots:[{x:0,y:0,w:100,h:100}]}
    const newPage = {
      page_type_id: defaultPT.id,
      page_type: defaultPT,
      items: defaultPT.slots.map(slot=>({slot,item:null}))
    }
    setLayout(prev=>{
      const pages=[...prev.pages]
      pages.splice(afterIdx+1,0,newPage)
      return persist({...prev,pages})
    })
    setCurrentPage(afterIdx+1)
    setHasChanges(true)
  }

  const removePage = (idx) => {
    if (!confirm(tp.confirmRemovePage)) return
    setLayout(prev=>{
      const pages=prev.pages.filter((_,i)=>i!==idx)
      return persist({...prev,pages})
    })
    setCurrentPage(p=>Math.max(-1,Math.min(p,layout.pages.length-2)))
    setHasChanges(true)
  }

  const movePage = (fromIdx, toIdx) => {
    if (fromIdx===toIdx) return
    setLayout(prev=>{
      const pages=[...prev.pages]
      const [moved]=pages.splice(fromIdx,1)
      pages.splice(toIdx,0,moved)
      return persist({...prev,pages})
    })
    setCurrentPage(toIdx)
    setHasChanges(true)
  }

  const onTransformChange=useCallback((panKey,t)=>{
    setPhotoTransforms(prev=>{
      const next={...prev,[panKey]:t}
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
  },[])

  const onSwapTransforms=useCallback((keyA,keyB)=>{
    setPhotoTransforms(prev=>{
      const tA=prev[keyA]||{x:50,y:50,zoom:1}
      const tB=prev[keyB]||{x:50,y:50,zoom:1}
      const next={...prev,[keyA]:tB,[keyB]:tA}
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
  },[])

  const onSlotRemoved=useCallback((pgIdx, removedSlotIdx, oldCount)=>{
    setPhotoTransforms(prev=>{
      const next={...prev}
      delete next[`${pgIdx}_${removedSlotIdx}`]
      for(let i=removedSlotIdx+1;i<oldCount;i++){
        const key=`${pgIdx}_${i}`
        if(next[key]!==undefined){
          next[`${pgIdx}_${i-1}`]=next[key]
          delete next[key]
        }
      }
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
  },[])

  const openPicker=useCallback((pageIdx,slotIdx)=>{
    const albumIdx=layout?.pages[pageIdx]?._album_idx ?? 0
    setPhotoPicker({pageIdx,slotIdx,albumIdx})
  },[layout])

  const [mapPickerSlot, setMapPickerSlot] = useState(null)
  const [mapNPages, setMapNPages]           = useState('all')

  const doAddMap = useCallback(async(pageIdx, slotIdx, nPages) => {
    const allLocations = layout?.locations || []
    if (!allLocations.length) { alert('Nessun dato GPS disponibile per questo album'); return }
    const locations = (nPages === 'all' || isNaN(parseInt(nPages)))
      ? allLocations
      : allLocations.slice(0, Math.max(1, Math.min(parseInt(nPages) * 5, allLocations.length)))
    try {
      const r = await axios.post('/api/map', { locations, map_style: layout?.profile?.map_style || {} }, { responseType:'blob' })
      const mapUrl = URL.createObjectURL(r.data)
      const mapItem = { type:'map', _map_url: mapUrl, _n_pages: nPages }
      setLayout(prev=>{
        const pages = prev.pages.map((pg,pi)=>pi!==pageIdx?pg:{
          ...pg, items: pg.items.map((id,si)=>si!==slotIdx?id:{...id, item:mapItem})
        })
        return persist({...prev, pages})
      })
      setHasChanges(true)
    } catch(e) { alert('Errore generazione mappa: ' + e.message) }
    setMapPickerSlot(null)
  },[layout])

  const addMapToSlot=useCallback((pageIdx,slotIdx)=>{
    setMapPickerSlot({pageIdx,slotIdx})
    setMapNPages('all')
  },[])

  // Drop from album panel onto slot
  const handleDropFromPanel=useCallback((pageIdx,slotIdx,assetId)=>{
    const asset=albumAssets.find(a=>a.id===assetId)
    if(!asset) return
    const exif=asset.exifInfo||{}
    const desc=(exif.description||asset.description||'').trim()
    const photoItem={type:'photo',asset_id:asset.id,description:desc,
      originalFileName:asset.originalFileName||'',localDateTime:asset.localDateTime||'',
      exif,has_caption:!!desc}
    setLayout(prev=>{
      const pages=prev.pages.map((pg,pi)=>pi!==pageIdx?pg:{
        ...pg,items:pg.items.map((id,si)=>si!==slotIdx?id:{...id,item:photoItem})
      })
      return persist({...prev,pages})
    })
    // Reset transform for this slot so new photo starts centered
    setPhotoTransforms(prev=>{
      const next={...prev}
      delete next[`${pageIdx}_${slotIdx}`]
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
    setHasChanges(true)
  },[albumAssets])

  const onPhotoSelected=useCallback((asset)=>{
    if(!photoPicker||!layout) return
    const {pageIdx,slotIdx}=photoPicker
    handleDropFromPanel(pageIdx,slotIdx,asset.id)
    setPhotoPicker(null)
  },[photoPicker,layout,handleDropFromPanel])

  const addCaption=useCallback((pageIdx,slotIdx)=>{
    setLayout(prev=>{
      const page=prev.pages[pageIdx]; const items=page.items
      const item=items[slotIdx].item
      const captionItem={type:'caption',text:item?.description||'',for_asset_id:item?.asset_id||'',originalFileName:item?.originalFileName||''}
      let newItems
      if(!item){
        // Empty slot: convert it directly to caption
        newItems=items.map((id,i)=>i===slotIdx?{...id,item:captionItem}:id)
      } else {
        const emptyIdx=items.findIndex((id,i)=>i!==slotIdx&&!id.item)
        if(emptyIdx>=0){
          newItems=items.map((id,i)=>i===emptyIdx?{...id,item:captionItem}:id)
        } else {
          const slot=items[slotIdx].slot
          const photoSlot={...slot,h:parseFloat((slot.h*0.68).toFixed(2))}
          const capSlot={x:slot.x,y:parseFloat((slot.y+slot.h*0.68).toFixed(2)),w:slot.w,h:parseFloat((slot.h*0.32).toFixed(2))}
          newItems=items.map((id,i)=>i===slotIdx?{slot:photoSlot,item:id.item}:id)
          newItems.push({slot:capSlot,item:captionItem})
        }
      }
      const newPages=prev.pages.map((pg,pi)=>pi!==pageIdx?pg:{
        ...pg,items:newItems,page_type_id:'custom',
        page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}
      })
      return persist({...prev,pages:newPages})
    })
    setHasChanges(true)
  },[])

  // ── Helper: collect photo items from a page range (deduplicated) ──────────
  const collectPhotos = (pages, from, to) => {
    const items=[], seen=new Set()
    pages.slice(from, to).forEach(pg=>pg.items.forEach(id=>{
      const it=id.item
      if(it?.type==='photo'&&!seen.has(it.asset_id)){seen.add(it.asset_id);items.push(it)}
    }))
    return items
  }

  // ── Helper: greedy orientation swap within one page ─────────────────────
  const optimizePageOrientation = (page, aspects) => {
    const items = page.items.map(id=>({...id}))
    const pIdx = items.map((id,i)=>id.item?.type==='photo'?i:-1).filter(i=>i>=0)
    if(pIdx.length<=1) return page
    const score = arr => pIdx.reduce((s,i)=>{
      const ar=aspects[arr[i].item?.asset_id]; return s+(isMismatch(ar,arr[i].slot)?1:0)},0)
    let cur=items, improved=true
    while(improved){
      improved=false
      for(let a=0;a<pIdx.length;a++) for(let b=a+1;b<pIdx.length;b++){
        const ai=pIdx[a],bi=pIdx[b]
        const sw=cur.map((id,i)=>i===ai?{...id,item:cur[bi].item}:i===bi?{...id,item:cur[ai].item}:id)
        if(score(sw)<score(cur)){cur=sw;improved=true}
      }
    }
    return {...page,items:cur}
  }

  // ── 1. Consolida fino alla pagina corrente, ricalcola il resto ──────────────
  //    - Blocca pagine 0..currentPage (inclusa)
  //    - Colleziona tutte le foto delle pagine successive (currentPage+1..end)
  //    - Aggiunge le foto dell'album non ancora presenti nelle pagine bloccate
  //      con localDateTime >= la più recente delle pagine bloccate
  //    - Deduplicazione per asset_id
  //    - Invia al backend per ridistribuzione
  const recalcFromNext=async()=>{
    const lockUntil=Math.max(0,currentPage)  // 0-based: blocca pagine 0..lockUntil incluso
    setRecalculating(true)
    try{
      const lockedPages=layout.pages.slice(0,lockUntil+1)
      const restPages  =layout.pages.slice(lockUntil+1)

      // Foto già nelle pagine bloccate → da escludere
      const lockedIds=new Set()
      lockedPages.forEach(pg=>pg.items.forEach(id=>{
        if(id.item?.type==='photo') lockedIds.add(id.item.asset_id)
      }))

      // Data più recente tra le foto bloccate → soglia per includere foto non usate
      let latestLocked=''
      lockedPages.forEach(pg=>pg.items.forEach(id=>{
        if(id.item?.type==='photo'&&(id.item.localDateTime||'')>latestLocked)
          latestLocked=id.item.localDateTime||''
      }))

      // Foto dalle pagine successive (già nel layout, non bloccate)
      const restPhotos=collectPhotos(restPages,0)
      const seenInRest=new Set(restPhotos.map(p=>p.asset_id))

      // Foto dell'album non usate da nessuna parte e con data >= latestLocked
      const unusedPhotos=albumAssets
        .filter(a=>(a.type||'IMAGE').toUpperCase()!=='VIDEO')
        .filter(a=>!lockedIds.has(a.id)&&!seenInRest.has(a.id))
        .filter(a=>!latestLocked||(a.localDateTime||'')>=latestLocked)
        .map(asset=>{
          const exif=asset.exifInfo||{}
          const desc=(exif.description||asset.description||'').trim()
          return{type:'photo',asset_id:asset.id,description:desc,
            originalFileName:asset.originalFileName||'',
            localDateTime:asset.localDateTime||'',exif,has_caption:!!desc}
        })

      // Unisci: prima foto dalle pagine rest, poi le non usate; dedup
      const seenFinal=new Set()
      const photoItems=[...restPhotos,...unusedPhotos].filter(p=>{
        if(seenFinal.has(p.asset_id)) return false
        seenFinal.add(p.asset_id); return true
      })

      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'info');return}

      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>persist({...prev,pages:[...lockedPages,...r.data.pages],page_logs:null}))
      setHasChanges(false)
      showToast(tp.recalcToasts.fromNext(lockUntil+1),'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 2. Ricalcola solo questa pagina ─────────────────────────────────────────
  const recalcThisPage=async()=>{
    if(currentPage<0) return
    setRecalculating(true)
    try{
      const photoItems=collectPhotos([layout.pages[currentPage]],0)
      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'error');return}
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const pages=[...prev.pages]
        pages.splice(currentPage,1,...r.data.pages)
        return persist({...prev,pages})
      })
      showToast(tp.recalcToasts.thisPage,'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 3. Comprimi pagine con slot vuoti ───────────────────────────────────────
  const recalcCompress=async()=>{
    const fromIdx=Math.max(0,currentPage)
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,fromIdx)
      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'error');return}
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const locked=prev.pages.slice(0,fromIdx)
        return persist({...prev,pages:[...locked,...r.data.pages],page_logs:null})
      })
      showToast(tp.recalcToasts.compress,'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 4. Ricomincia tutto da zero ──────────────────────────────────────────────
  const recalcAll=async()=>{
    if(!window.confirm(tp.recalcConfirmAll)) return
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,0)
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>persist({...prev,pages:r.data.pages,page_logs:null}))
      setHasChanges(false);setCurrentPage(0)
      showToast(tp.recalcToasts.all,'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── Salva layout custom nel profilo ─────────────────────────────────────────
  const saveCustomLayout = async (slots) => {
    if (!layout?.profile) return
    const ori = layout.profile.orientation || 'portrait'
    const newPT = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      label: autoNameSlots(slots, ori),
      pref: 'any',
      slots: slots.map(s => ({...s})),
    }
    const updatedProfile = {
      ...layout.profile,
      page_types: [...(layout.profile.page_types || []), newPT],
    }
    try {
      await axios.put(`/api/profiles/${layout.profile.id}`, updatedProfile)
      setLayout(prev => persist({ ...prev, profile: updatedProfile }))
      showToast(`Layout "${newPT.label}" salvato nel profilo`, 'success')
    } catch {
      showToast('Errore salvataggio layout', 'error')
    }
  }

  // ── Dispatcher ───────────────────────────────────────────────────────────────
  const handleRecalcAction = (id) => {
    setRecalcMenuOpen(false)
    const map={
      from_next: recalcFromNext,
      this_page: recalcThisPage,
      compress:  recalcCompress,
      full:      recalcAll,
    }
    map[id]?.()
  }

  const exportBook=async(format='pdf', quality='hires')=>{
    if(!layout) return; setExporting(true)
    try{
      const r=await axios.post('/api/export',{
        album_id:layout.album.id,
        profile_id:layout.profile.id,
        pages:layout.pages,
        locations:layout.locations||[],
        photo_transforms:photoTransforms,
        format,
        quality,
      },{responseType:'blob'})
      const url=URL.createObjectURL(r.data)
      const a=document.createElement('a');a.href=url
      a.download=`${layout.album.albumName||'fotolibro'}${format==='svg'?'_svg.zip':'.pdf'}`
      a.click(); URL.revokeObjectURL(url)
      showToast(format==='svg'?tp.svgDownloaded:tp.pdfDownloaded,'success')
    }catch{showToast(tp.exportError,'error')}
    finally{setExporting(false)}
  }

  const showToast=(msg,type)=>{setToast({msg,type});setTimeout(()=>setToast(null),4000)}

  // Load a project from the modal
  const handleProjectLoad = (projectData) => {
    setLayout({
      album:     projectData.album,
      profile:   projectData.profile,
      pages:     projectData.pages,
      locations: projectData.locations || [],
    })
    if (projectData.photo_transforms) {
      setPhotoTransforms(projectData.photo_transforms)
      originalTransformsRef.current = projectData.photo_transforms
    }
    setCurrentPage(projectData.current_page ?? 0)
    setHasChanges(false)
    // reload album assets for the picker
    if (projectData.album?.id)
      axios.get(`/api/albums/${projectData.album.id}`)
        .then(r=>setAlbumAssets([...(r.data.assets||[])].sort((a,b)=>(a.localDateTime||'').localeCompare(b.localDateTime||'')))).catch(()=>{})
  }

  if(!layout) return(
    <div className="empty-state" style={{padding:'80px 40px'}}>
      <div className="icon">📖</div>
      <h3>Nessun layout generato</h3>
      <p>Vai alla pagina Album, seleziona un album e un profilo, poi clicca "Genera layout"</p>
      <button className="btn btn-primary mt-4" onClick={()=>navigate('/albums')}>→ Vai agli album</button>
    </div>
  )

  const {album,profile,pages}=layout
  const allPageTypes=profile?.page_types||[]

  return(
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>

      {/* ── Left sidebar: page list ── */}
      <div className="preview-sidebar" style={{
        width: leftSidebarOpen ? 200 : 38,
        transition:'width 0.2s ease',
        overflow:'hidden',
        flexShrink:0,
        position:'relative',
      }}>
        {/* Collapse toggle — always visible */}
        <button
          onClick={()=>setLeftSidebarOpen(o=>!o)}
          title={leftSidebarOpen ? 'Comprimi sidebar' : 'Espandi sidebar'}
          style={{
            position:'absolute', right:0, top:'50%', transform:'translateY(-50%)',
            width:16, height:48,
            background:'var(--bg3)', border:'1px solid var(--border)', borderLeft:'none',
            borderRadius:'0 5px 5px 0', cursor:'pointer', zIndex:10,
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--text3)', fontSize:12,
          }}>
          {leftSidebarOpen ? '‹' : '›'}
        </button>

        {/* Full content — hidden when collapsed */}
        {leftSidebarOpen && (<>
        <div className="preview-sidebar-header">
          <h3 style={{fontFamily:'var(--font-display)',fontWeight:300,fontSize:16,marginBottom:2}}>{album.albumName}</h3>
          <p className="text-xs text-muted font-mono">{pages.length} pag. · {album.assetCount} foto</p>
          <p className="text-xs text-muted" style={{marginTop:2}}>← → per navigare</p>
          {/* Save / Load project */}
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <button className="btn" style={{flex:1,fontSize:10,justifyContent:'center',padding:'6px 4px'}}
              onClick={()=>setProjectModal('save')} title="Salva il progetto corrente">
              💾 Salva
            </button>
            <button className="btn" style={{flex:1,fontSize:10,justifyContent:'center',padding:'6px 4px'}}
              onClick={()=>setProjectModal('load')} title="Apri un progetto salvato">
              📂 Apri
            </button>
          </div>
          {lastAutoSave && (
            <p style={{fontSize:9,color:'var(--text3)',textAlign:'center',marginTop:3,fontFamily:'var(--font-mono)'}}>
              ⏱ {lastAutoSave.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
            </p>
          )}
          {/* Recalculate menu */}
          <div style={{position:'relative',marginTop:8}}>
            <button ref={recalcBtnRef} className="btn w-full" style={{fontSize:11,justifyContent:'space-between'}}
              onClick={()=>setRecalcMenuOpen(o=>!o)} disabled={recalculating}>
              <span>{recalculating?<><span className="spinner" style={{width:11,height:11}}/> Ricalcolo…</>:'🔄 Ricalcola'}</span>
              <span style={{opacity:0.5,fontSize:10}}>{recalcMenuOpen?'▲':'▼'}</span>
            </button>
            {recalcMenuOpen && !recalculating && (
              <RecalcMenu
                anchorRef={recalcBtnRef}
                currentPage={currentPage}
                totalPages={layout?.pages?.length||0}
                busy={recalculating}
                onAction={handleRecalcAction}
                onClose={()=>setRecalcMenuOpen(false)}
              />
            )}
          </div>
          {layout?.page_logs?.length > 0 && (
            <button className="btn w-full" style={{fontSize:11,marginTop:6}}
              onClick={()=>setLogViewerOpen(true)}>
              🔍 Log impaginazione
            </button>
          )}
        </div>
        <div ref={sidebarListRef} style={{flex:1,overflowY:'auto',padding:'8px 8px 0'}}>
          {/* Cover thumb */}
          <div className={`page-thumb-item${currentPage===-1?' active':''}`} onClick={()=>setCurrentPage(-1)}>
            <span className="page-num">T</span>
            {(()=>{
              const [pw,ph]=getPageDims(profile)
              const isL=profile?.orientation==='landscape'
              const tw=isL?44:28, th=isL?28:40
              return (
                <div style={{width:tw,height:th,background:'#0f0f14',borderRadius:2,overflow:'hidden',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {mapUrl?<img src={mapUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:12}}>🗺️</span>}
                </div>
              )
            })()}
            <span className="text-xs text-muted">Copertina</span>
          </div>

          {/* Page thumbs — draggable for reorder */}
          {pages.map((page,idx)=>(
            <div key={idx}
              draggable
              onDragStart={e=>{e.dataTransfer.setData('page-idx',String(idx));setSidebarDrag(idx)}}
              onDragEnd={()=>setSidebarDrag(null)}
              onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}}
              onDrop={e=>{
                e.preventDefault()
                const fromIdx=parseInt(e.dataTransfer.getData('page-idx'),10)
                if(!isNaN(fromIdx)&&fromIdx!==idx) movePage(fromIdx,idx)
                setSidebarDrag(null)
              }}
              className={`page-thumb-item${currentPage===idx?' active':''}`}
              style={{
                opacity: sidebarDrag===idx ? 0.45 : 1,
                cursor:'grab',
                outline: currentPage===idx ? '2px solid #4ac585' : 'none',
                outlineOffset: '-2px',
              }}
              onClick={()=>setCurrentPage(idx)}>
              <span className="page-num">{idx+1}</span>
              <MiniPage page={page} profile={profile} scale={0.052}/>
              <div style={{flex:1,minWidth:0}}>
                <p className="text-xs" style={{color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {page.page_type?.label||'Pagina'}
                </p>
                <p className="text-xs text-muted">
                  {page.items.filter(i=>i.item?.type==='photo').length}📷 {page.items.filter(i=>i.item?.type==='caption').length}💬 {page.items.filter(i=>!i.item).length}○
                </p>
              </div>
              {/* Per-page actions */}
              <div style={{display:'flex',flexDirection:'column',gap:2,flexShrink:0}}>
                <button
                  title="Aggiungi pagina vuota dopo"
                  onClick={e=>{e.stopPropagation();addPage(idx)}}
                  style={{width:16,height:16,background:'none',border:'1px solid var(--border)',
                    borderRadius:3,cursor:'pointer',fontSize:10,color:'var(--text3)',lineHeight:1,
                    display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
                {pages.length>1&&(
                  <button
                    title="Elimina pagina"
                    onClick={e=>{e.stopPropagation();removePage(idx)}}
                    style={{width:16,height:16,background:'none',border:'1px solid var(--border)',
                      borderRadius:3,cursor:'pointer',fontSize:10,color:'#e05050',lineHeight:1,
                      display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
                )}
              </div>
            </div>
          ))}

          {/* Add page at end */}
          <div
            style={{margin:'6px 0 12px',padding:'6px 8px',borderRadius:6,border:'1px dashed var(--border)',
              cursor:'pointer',display:'flex',alignItems:'center',gap:6,
              color:'var(--text3)',fontSize:11,
            }}
            onClick={()=>addPage(pages.length-1)}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <span style={{fontSize:14}}>+</span>
            <span>{tp.addPageHint}</span>
          </div>
        </div>
        <ExportPanel layout={layout} onExport={exportBook} exporting={exporting}/>

        </>)}
      </div>

      {/* ── Main canvas ── */}
      <div className="preview-main" style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}
        onWheel={e=>{
          // Yield to fixed overlays (PhotoPicker, caption toolbar, slot menu)
          // and to scrollable elements that actually CAN scroll in this direction.
          // The canvas div has overflow:auto but usually no overflow → pass through.
          let el = e.target
          while (el && el !== e.currentTarget) {
            const s = window.getComputedStyle(el)
            if (s.position === 'fixed' || s.position === 'sticky') return
            const oy = s.overflowY
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
                el.scrollHeight > el.clientHeight + 2 &&
                ((e.deltaY > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 2) ||
                 (e.deltaY < 0 && el.scrollTop > 0))) {
              return
            }
            el = el.parentElement
          }
          e.preventDefault()
          if(e.deltaY>0){
            setCurrentPage(p=>{
              if(spreadView&&p>=0){const l=p%2===0?p-1:p;return Math.min(layout.pages.length-1,l+2)}
              return Math.min(layout.pages.length-1,p+1)
            })
          } else {
            setCurrentPage(p=>{
              if(spreadView&&p>=0){const l=p%2===0?p-1:p;return Math.max(-1,l-2)}
              return Math.max(-1,p-1)
            })
          }
        }}>
        {/* Top bar: prev/next + spread toggle + add/remove page — one compact line */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'6px 12px', flexShrink:0, gap:6,
          borderBottom:'1px solid var(--border)', background:'var(--bg2)',
        }}>
          <button className="btn btn-ghost" style={{fontSize:12,padding:'4px 10px'}}
            onClick={()=>{
              if(spreadView&&currentPage>=0){
                // In spread: step back by 2 (to prev pair), snap to odd index (left of pair)
                const leftIdx=currentPage%2===0?currentPage-1:currentPage
                setCurrentPage(Math.max(-1,leftIdx-2))
              } else {
                setCurrentPage(p=>Math.max(-1,p-1))
              }
            }} disabled={currentPage<=-1}>{tp.prevBtn}</button>

          <div style={{display:'flex',alignItems:'center',gap:6,flex:1,justifyContent:'center'}}>
            <span className="text-sm font-mono text-muted" style={{minWidth:90,textAlign:'center'}}>
              {currentPage===-1?tp.coverPage:tp.pageOf(currentPage+1, pages.length)}
            </span>
            {/* View zoom */}
            <div style={{display:'flex',gap:2,alignItems:'center',background:'var(--bg3)',borderRadius:5,padding:'2px 6px',border:'1px solid var(--border)'}}>
              <button onClick={()=>setViewZoom(z=>Math.max(zoomMin,+(z-zoomStep).toFixed(2)))}
                style={{padding:'1px 6px',border:'none',background:'transparent',cursor:'pointer',fontSize:14,color:'var(--text)',lineHeight:1}}
                title="Riduci">−</button>
              <span onClick={()=>setViewZoom(1)} title="Ripristina 100%"
                style={{fontSize:10,fontFamily:'monospace',color:'var(--text2)',minWidth:34,textAlign:'center',cursor:'pointer'}}>
                {Math.round(viewZoom*100)}%</span>
              <button onClick={()=>setViewZoom(z=>Math.min(zoomMax,+(z+zoomStep).toFixed(2)))}
                style={{padding:'1px 6px',border:'none',background:'transparent',cursor:'pointer',fontSize:14,color:'var(--text)',lineHeight:1}}
                title="Ingrandisci">+</button>
            </div>
            {/* Spread / Single toggle */}
            <div style={{display:'flex',gap:1,background:'var(--bg3)',borderRadius:5,padding:2,border:'1px solid var(--border)'}}>
              <button onClick={()=>{setSpreadView(false);localStorage.setItem('pb_spreadView','false')}} title="Pagina singola"
                style={{padding:'2px 7px',borderRadius:3,border:'none',cursor:'pointer',fontSize:12,
                  background:!spreadView?'var(--bg)':'transparent',
                  color:!spreadView?'var(--text)':'var(--text3)'}}>□</button>
              <button onClick={()=>{setSpreadView(true);localStorage.setItem('pb_spreadView','true')}} title="Doppia pagina"
                style={{padding:'2px 7px',borderRadius:3,border:'none',cursor:'pointer',fontSize:12,
                  background:spreadView?'var(--bg)':'transparent',
                  color:spreadView?'var(--text)':'var(--text3)'}}>□□</button>
            </div>
            {/* +Pag and Elim always rendered for stable toolbar width;
                disabled/grey on cover page so layout doesn't shift */}
            <button className="btn btn-sm"
              style={{fontSize:10,padding:'2px 8px',
                opacity: currentPage>=0 ? 1 : 0.3,
                pointerEvents: currentPage>=0 ? 'auto' : 'none'}}
              title={currentPage>=0 ? "Aggiungi pagina vuota dopo questa" : "Non disponibile sulla copertina"}
              onClick={()=>currentPage>=0&&addPage(currentPage)}>+ Pag.</button>
            <button className="btn btn-sm"
              style={{fontSize:10,padding:'2px 8px',
                background: currentPage>=0&&pages.length>1 ? 'rgba(197,74,74,0.12)' : 'var(--bg3)',
                borderColor: currentPage>=0&&pages.length>1 ? 'rgba(197,74,74,0.4)' : 'var(--border)',
                color: currentPage>=0&&pages.length>1 ? '#e05050' : 'var(--text3)',
                opacity: currentPage>=0&&pages.length>1 ? 1 : 0.3,
                pointerEvents: currentPage>=0&&pages.length>1 ? 'auto' : 'none'}}
              title={currentPage>=0&&pages.length>1 ? "Elimina questa pagina" : "Non disponibile sulla copertina"}
              onClick={()=>currentPage>=0&&pages.length>1&&removePage(currentPage)}>× Elim.</button>
          </div>

          <button className="btn btn-ghost" style={{fontSize:12,padding:'4px 10px'}}
            onClick={()=>{
              if(spreadView&&currentPage>=0){
                // In spread: step forward by 2 (to next pair), snap to odd index
                const leftIdx=currentPage%2===0?currentPage-1:currentPage
                setCurrentPage(Math.min(pages.length-1,leftIdx+2))
              } else {
                setCurrentPage(p=>Math.min(pages.length-1,p+1))
              }
            }} disabled={currentPage>=pages.length-1}>{tp.nextBtn}</button>
        </div>

        {/* Canvas area — fills all remaining height, centers content */}
        <div style={{flex:1,overflow:'auto',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px 8px'}}>

        {currentPage===-1?(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
            {/* Live cover preview */}
            <div style={{position:'relative'}}>
              {(()=>{
                const [pw,ph] = getPageDims(layout.profile)
                const isLandscape = layout.profile?.orientation === 'landscape'
                // Fit the cover preview to ~320px on its longest dimension
                const maxDim = 320
                const coverW = isLandscape ? maxDim : Math.round(maxDim * pw / ph)
                const coverH = isLandscape ? Math.round(maxDim * ph / pw) : maxDim
                return (
                  <CoverPreview
                    style={layout.profile?.cover_style||DEFAULT_COVER}
                    albumName={album.albumName}
                    assetCount={album.assetCount}
                    mapUrl={mapUrl}
                    width={coverW}
                    height={coverH}/>
                )
              })()}
              <button
                onClick={()=>setCoverStyleOpen(o=>!o)}
                style={{position:'absolute',top:8,right:8,padding:'4px 10px',fontSize:11,
                  background:'rgba(0,0,0,0.7)',border:'1px solid rgba(255,255,255,0.2)',
                  color:'#fff',borderRadius:5,cursor:'pointer'}}>
                {coverStyleOpen ? tp.coverCloseBtn : tp.coverEditBtn}
              </button>
            </div>

            {/* Inline cover editor */}
            {coverStyleOpen && (
              <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:10,
                padding:20,width:'100%',maxWidth:720,boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}>
                {(()=>{
                  const [cpw,cph]=getPageDims(layout.profile)
                  const isLand=layout.profile?.orientation==='landscape'
                  const maxD=280
                  const cW=isLand?maxD:Math.round(maxD*cpw/cph)
                  const cH=isLand?Math.round(maxD*cph/cpw):maxD
                  return (
                    <CoverStyleEditor
                      value={layout.profile?.cover_style||DEFAULT_COVER}
                      albumName={album.albumName}
                      assetCount={album.assetCount}
                      mapUrl={mapUrl}
                      assets={albumAssets}
                      compact={true}
                      coverWidth={cW}
                      coverHeight={cH}
                      onChange={cs=>{
                        setLayout(prev=>persist({...prev,profile:{...prev.profile,cover_style:cs}}))
                        setHasChanges(true)
                      }}/>
                  )
                })()}
                <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:14,paddingTop:12,borderTop:'1px solid var(--border)'}}>
                  <button className="btn" onClick={()=>setCoverStyleOpen(false)}>✕ Chiudi</button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted">{tp.coverAuto}</p>
          </div>
        ) : spreadView ? (
          /* ── Spread view: 2 pages side by side, fill available space ── */
          (() => {
            const leftIdx  = currentPage % 2 === 0 ? currentPage - 1 : currentPage
            const rightIdx = leftIdx + 1
            const leftPage  = leftIdx >= 0 ? pages[leftIdx]  : null
            const rightPage = rightIdx < pages.length ? pages[rightIdx] : null
            return (
              <div style={{display:'flex',gap:12,alignItems:'flex-start',justifyContent:'center',width:'100%'}}>
                {/* Left page */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1,minWidth:0}}
                  onClick={()=>setCurrentPage(leftIdx)}>
                  {leftPage ? (
                    <EditablePage
                      page={leftPage} pageIdx={leftIdx}
                      profile={profile} allPageTypes={allPageTypes}
                      photoAspects={photoAspects} photoTransforms={photoTransforms}
                      originalTransforms={originalTransformsRef.current}
                      onTransformChange={onTransformChange}
                      onSwapTransforms={onSwapTransforms}
                      onSlotRemoved={onSlotRemoved}
                      onUpdatePage={p=>updatePage(leftIdx,p)}
                      onOpenPicker={openPicker} onAddCaption={addCaption}
                      onDrop={handleDropFromPanel}
                      onPhotoClick={aid=>{ setHighlightedAsset(aid); if(!panelOpen) setPanelOpen(true) }}
                      onAddMap={addMapToSlot}
                      isActive={currentPage===leftIdx} zoomFactor={viewZoom}
                      dividerMapUrl={dividerMapUrls[leftIdx]}
                      assets={allAlbumAssets[leftPage?._album_idx??0]??albumAssets}
                      assetById={assetById}
                      onSaveCustomLayout={saveCustomLayout}/>
                  ) : (
                    <BlankPage profile={profile} allPageTypes={allPageTypes} label="pagina vuota" zoomFactor={viewZoom}/>
                  )}
                  {leftPage
                    ? <p className="text-xs text-muted mt-1">Pagina {leftIdx+1}</p>
                    : <p className="text-xs text-muted mt-1">Seconda di copertina</p>}
                </div>
                {/* Right page */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1,minWidth:0}}
                  onClick={()=>setCurrentPage(rightIdx)}>
                  {rightPage ? (
                    <EditablePage
                      page={rightPage} pageIdx={rightIdx}
                      profile={profile} allPageTypes={allPageTypes}
                      photoAspects={photoAspects} photoTransforms={photoTransforms}
                      originalTransforms={originalTransformsRef.current}
                      onTransformChange={onTransformChange}
                      onSwapTransforms={onSwapTransforms}
                      onSlotRemoved={onSlotRemoved}
                      onUpdatePage={p=>updatePage(rightIdx,p)}
                      onOpenPicker={openPicker} onAddCaption={addCaption}
                      onDrop={handleDropFromPanel}
                      onPhotoClick={aid=>{ setHighlightedAsset(aid); if(!panelOpen) setPanelOpen(true) }}
                      onAddMap={addMapToSlot}
                      isActive={currentPage===rightIdx} zoomFactor={viewZoom}
                      dividerMapUrl={dividerMapUrls[rightIdx]}
                      assets={allAlbumAssets[rightPage?._album_idx??0]??albumAssets}
                      assetById={assetById}
                      onSaveCustomLayout={saveCustomLayout}/>
                  ) : (
                    <BlankPage profile={profile} allPageTypes={allPageTypes} label="pagina vuota" zoomFactor={viewZoom}/>
                  )}
                  {rightPage
                    ? <p className="text-xs text-muted mt-1">Pagina {rightIdx+1}</p>
                    : <p className="text-xs text-muted mt-1">Terza di copertina</p>}
                </div>
              </div>
            )
          })()
        ):(
          <EditablePage
            page={pages[currentPage]}
            pageIdx={currentPage}
            profile={profile}
            allPageTypes={allPageTypes}
            photoAspects={photoAspects}
            photoTransforms={photoTransforms}
            originalTransforms={originalTransformsRef.current}
            onTransformChange={onTransformChange}
            onSwapTransforms={onSwapTransforms}
            onSlotRemoved={onSlotRemoved}
            onUpdatePage={p=>updatePage(currentPage,p)}
            onOpenPicker={openPicker}
            onAddCaption={addCaption}
            onDrop={handleDropFromPanel}
            onPhotoClick={aid=>{ setHighlightedAsset(aid); if(!panelOpen) setPanelOpen(true) }}
            onAddMap={addMapToSlot}
            isActive={true} zoomFactor={viewZoom}
            dividerMapUrl={dividerMapUrls[currentPage]}
            assets={allAlbumAssets[pages[currentPage]?._album_idx??0]??albumAssets}
            assetById={assetById}
            onSaveCustomLayout={saveCustomLayout}
          />
        )}
        </div>{/* end canvas area */}
      </div>

      {/* ── Right panel: album photos ── */}
      <AlbumPanel
        assets={albumAssets}
        presorted={allAlbumAssets.length > 1}
        usageMap={usageMap}
        usagePages={usagePages}
        open={panelOpen}
        onToggle={()=>setPanelOpen(o=>{localStorage.setItem('pb_panelOpen',!o);return !o})}
        onDragStart={setDraggedAsset}
        onNavigate={pi=>setCurrentPage(pi)}
        highlightedAsset={highlightedAsset}
        onClearHighlight={()=>setHighlightedAsset(null)}
      />

      {photoPicker&&(
        <PhotoPickerModal assets={albumAssets} usageMap={usageMap}
          allAlbumAssets={allAlbumAssets}
          albumIdx={photoPicker?.albumIdx ?? 0}
          albumNames={layout?._album_names}
          onSelect={onPhotoSelected} onClose={()=>setPhotoPicker(null)}/>
      )}

      {mapPickerSlot&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,
          display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={()=>setMapPickerSlot(null)}>
          <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:10,
            padding:24,minWidth:300,maxWidth:400,boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}
            onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 16px',fontSize:15}}>🗺 Inserisci mappa GPS</h3>
            <label style={{fontSize:12,color:'var(--text2)',display:'block',marginBottom:10}}>
              Pagine da coprire
            </label>
            <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="radio" name="mapNPages" checked={mapNPages==='all'}
                  onChange={()=>setMapNPages('all')}/>
                Tutto l'album
              </label>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="radio" name="mapNPages" checked={mapNPages!=='all'}
                  onChange={()=>setMapNPages(mapNPages==='all'?'10':mapNPages)}/>
                Prime
                <input type="number" min={1} max={999} value={mapNPages==='all'?'':mapNPages}
                  disabled={mapNPages==='all'}
                  onChange={e=>setMapNPages(e.target.value||'1')}
                  onClick={()=>{ if(mapNPages==='all') setMapNPages('10') }}
                  style={{width:60,padding:'2px 6px',background:'var(--bg3)',
                    border:'1px solid var(--border)',color:'var(--text)',borderRadius:4,fontSize:13}}/>
                pagine
              </label>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" onClick={()=>setMapPickerSlot(null)}>Annulla</button>
              <button className="btn btn-primary"
                onClick={()=>doAddMap(mapPickerSlot.pageIdx,mapPickerSlot.slotIdx,mapNPages)}>
                Inserisci mappa
              </button>
            </div>
          </div>
        </div>
      )}

      {projectModal && (
        <ProjectModal
          mode={projectModal}
          layout={layout}
          photoTransforms={photoTransforms}
          currentPage={currentPage}
          onClose={()=>setProjectModal(null)}
          onLoad={handleProjectLoad}
        />
      )}

      {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
  {logViewerOpen && layout?.page_logs?.length > 0 && (
    <LogViewer
      pageLogs={layout.page_logs}
      excludedPhotos={layout.excluded_photos || []}
      currentPage={currentPage - 1}
      onNavigate={(idx)=>{ setCurrentPage(idx + 1) }}
      onClose={()=>setLogViewerOpen(false)}
    />
  )}
    </div>
  )
}
