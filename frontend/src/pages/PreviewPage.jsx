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

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'

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

function slotRect(slot, pw, ph, profile, scale) {
  const margin = (profile?.margin_mm||5)*2.835
  const gap    = (profile?.gap_mm||3)*2.835
  const uw = pw-2*margin, uh = ph-2*margin
  const le=slot.x<0.5, te=slot.y<0.5, re=(slot.x+slot.w)>99.5, be=(slot.y+slot.h)>99.5
  const r = {
    x: margin+(slot.x/100)*uw+(le?0:gap/2),
    y: margin+(slot.y/100)*uh+(te?0:gap/2),
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
  const left = -(panX / 100) * overflowX
  const top  = -(panY / 100) * overflowY

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
        const r=slotRect(id.slot||{x:0,y:0,w:100,h:100},pw,ph,profile,scale)
        const s={position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,overflow:'hidden'}
        const item=id.item
        if(!item) return <div key={i} style={{...s,background:'#c8c5be'}}/>
        if(item.type==='caption') return <div key={i} style={{...s,background:'#111116'}}/>
        return <div key={i} style={s}><img src={`/api/thumb/${item.asset_id}`} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/></div>
      })}
    </div>
  )
}

// ── Photo picker modal ────────────────────────────────────────────────────────
function PhotoPickerModal({ assets, usageMap, onSelect, onClose }) {
  const [filter,setFilter] = useState('')
  const filtered = assets.filter(a=>!filter||(a.originalFileName||'').toLowerCase().includes(filter.toLowerCase()))
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--bg2)',borderRadius:12,padding:24,width:680,maxHeight:'82vh',display:'flex',flexDirection:'column',border:'1px solid var(--border)',boxShadow:'0 24px 80px rgba(0,0,0,0.6)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <h3 style={{fontFamily:'var(--font-display)',fontWeight:300,fontSize:20}}>Seleziona foto</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>
        <input className="form-input" placeholder="Cerca per nome file…" style={{marginBottom:10}} value={filter} onChange={e=>setFilter(e.target.value)} autoFocus/>
        <div style={{overflowY:'auto',flex:1}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8}}>
            {filtered.map(asset=>{
              const uses=usageMap[asset.id]||0
              return (
                <div key={asset.id} onClick={()=>onSelect(asset)}
                  style={{cursor:'pointer',borderRadius:6,overflow:'hidden',aspectRatio:'1',position:'relative',
                    border:`2px solid ${uses>1?'#e89a3a':uses===1?'#4ac585':'var(--border)'}`,transition:'border-color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=uses>1?'#e89a3a':uses===1?'#4ac585':'var(--border)'}>
                  <img src={`/api/thumb/${asset.id}`} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
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


function AlbumPanel({ assets, usageMap, usagePages, open, onToggle, onDragStart, onNavigate }) {
  const t = useT()
  const tp = t.preview
  const [filter, setFilter]         = useState('')
  const [view, setView]             = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [previewAsset, setPreviewAsset] = useState(null)  // foto ingrandita

  const filtered = assets.filter(a => {
    const uses = usageMap[a.id] || 0
    if (statusFilter === 'unused' && uses > 0)  return false
    if (statusFilter === 'multi'  && uses < 2)  return false
    if (filter && !(a.originalFileName || '').toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const used   = Object.values(usageMap).filter(v => v > 0).length
  const multi  = Object.values(usageMap).filter(v => v > 1).length
  const unused = assets.length - used

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

  // Click su foto: se non usata → preview ingrandita; se usata → naviga alla pagina
  const handlePhotoClick = (asset, firstPage) => {
    const uses = usageMap[asset.id] || 0
    if (uses === 0) {
      setPreviewAsset(asset)
    } else if (firstPage !== undefined) {
      onNavigate(firstPage)
    }
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
                <button key={n} onClick={()=>setView(n)}
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
                      draggable
                      onDragStart={e=>{e.dataTransfer.setData('asset_id',asset.id);onDragStart(asset)}}
                      onClick={()=>firstPage!==undefined&&onNavigate(firstPage)}
                      title={alt}
                      style={{
                        display:'flex', gap:6, alignItems:'center', flexShrink:0,
                        cursor:firstPage!==undefined?'pointer':'grab',
                        borderRadius:4, padding:'3px 5px',
                        border:`1.5px solid ${bc}`,
                        opacity:uses===0?0.65:1,
                        transition:'background 0.1s',
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
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
                      draggable
                      onDragStart={e=>{e.dataTransfer.setData('asset_id',asset.id);onDragStart(asset)}}
                      onClick={()=>handlePhotoClick(asset, firstPage)}
                      title={alt}
                      style={{
                        /* Use padding-top trick for reliable aspect ratio in grid */
                        position:'relative', width:'100%', paddingTop:'100%',
                        cursor:(usageMap[asset.id]||0)===0?'zoom-in':firstPage!==undefined?'pointer':'grab',
                        borderRadius:4, overflow:'hidden',
                        border:`2px solid ${bc}`,
                        opacity:uses===0?0.6:1,
                        transition:'box-shadow 0.12s, border-color 0.12s',
                        boxSizing:'border-box',
                      }}
                      onMouseEnter={e=>{
                        e.currentTarget.style.boxShadow='0 0 0 2px var(--gold)'
                        e.currentTarget.style.borderColor='var(--gold)'
                      }}
                      onMouseLeave={e=>{
                        e.currentTarget.style.boxShadow='none'
                        e.currentTarget.style.borderColor=bc
                      }}>
                      {/* Content inside the aspect-ratio box */}
                      <div style={{position:'absolute',inset:0}}>
                        <img src={`/api/thumb/${asset.id}`} alt={alt} loading="lazy"
                          style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
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
            ⇄ Trascina su slot · Clicca per andare alla pagina
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
function SlotDividers({ items, pw, ph, profile, scale, onUpdateItems }) {
  const t = useT(); const tp = t.preview
  const dragRef = useRef(null)
  const margin  = (profile?.margin_mm||5)*2.835
  const uw = pw - 2*margin
  const uh = ph - 2*margin
  const MIN_PCT = 8
  const EPS     = 1.5

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

  // Build per-slot handles: for each slot, 4 edges
  // Each edge is { slotIdx, side:'top'|'bottom'|'left'|'right', pct, x1,y1,x2,y2 }
  const buildHandles = () => {
    const handles = []
    items.forEach((id, si) => {
      const s = id.slot
      if (!s) return
      const hc = []
      items.forEach(id2 => { const s2=id2.slot; if(s2.y>EPS) hc.push(s2.y); if(s2.y+s2.h<100-EPS) hc.push(s2.y+s2.h) })
      const vc = []
      items.forEach(id2 => { const s2=id2.slot; if(s2.x>EPS) vc.push(s2.x); if(s2.x+s2.w<100-EPS) vc.push(s2.x+s2.w) })

      // top edge (y)
      if (s.y > EPS) handles.push({ slotIdx:si, side:'top', pct:s.y,
        x1:s.x, x2:s.x+s.w, y:s.y })
      // bottom edge
      if (s.y+s.h < 100-EPS) handles.push({ slotIdx:si, side:'bottom', pct:s.y+s.h,
        x1:s.x, x2:s.x+s.w, y:s.y+s.h })
      // left edge
      if (s.x > EPS) handles.push({ slotIdx:si, side:'left', pct:s.x,
        y1:s.y, y2:s.y+s.h, x:s.x })
      // right edge
      if (s.x+s.w < 100-EPS) handles.push({ slotIdx:si, side:'right', pct:s.x+s.w,
        y1:s.y, y2:s.y+s.h, x:s.x+s.w })
    })
    return handles
  }

  const handles = buildHandles()

  const startDrag = (e, handle) => {
    e.preventDefault(); e.stopPropagation()
    const snap = items.map(id=>({...id,slot:{...id.slot}}))
    const usableW = uw * scale, usableH = uh * scale
    dragRef.current = { handle, startX:e.clientX, startY:e.clientY, snap }

    const onMove = me => {
      if (!dragRef.current) return
      const { handle:h, snap:s0 } = dragRef.current
      const ns = s0.map(id=>({...id,slot:{...id.slot}}))
      const si = h.slotIdx

      if (h.side === 'top' || h.side === 'bottom') {
        const dy = ((me.clientY - dragRef.current.startY) / usableH) * 100
        if (h.side === 'top') {
          // Moving top edge: shrink from top or expand up
          const maxUp   = s0[si].slot.h - MIN_PCT  // can't make slot smaller than MIN
          const maxDown = s0[si].slot.h - MIN_PCT
          const adj = Math.max(-maxUp, Math.min(maxDown, dy))
          ns[si].slot.y = parseFloat((s0[si].slot.y + adj).toFixed(2))
          ns[si].slot.h = parseFloat((s0[si].slot.h - adj).toFixed(2))
          // Find slot whose bottom edge is at the same Y (adiacente sopra)
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs((s0[j].slot.y+s0[j].slot.h)-s0[si].slot.y)<EPS &&
               Math.abs(s0[j].slot.x-s0[si].slot.x)<EPS &&
               Math.abs(s0[j].slot.w-s0[si].slot.w)<EPS) {
              ns[j].slot.h = parseFloat((s0[j].slot.h + adj).toFixed(2))
            }
          })
        } else { // bottom
          const maxDown = s0[si].slot.h - MIN_PCT
          const adj = Math.max(-maxDown, Math.min(maxDown, dy))
          ns[si].slot.h = parseFloat((s0[si].slot.h + adj).toFixed(2))
          // Find slot whose top is at the same Y (adiacente sotto)
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs(s0[j].slot.y-(s0[si].slot.y+s0[si].slot.h))<EPS &&
               Math.abs(s0[j].slot.x-s0[si].slot.x)<EPS &&
               Math.abs(s0[j].slot.w-s0[si].slot.w)<EPS) {
              ns[j].slot.y = parseFloat((s0[j].slot.y + adj).toFixed(2))
              ns[j].slot.h = parseFloat((s0[j].slot.h - adj).toFixed(2))
            }
          })
        }
      } else {
        const dx = ((me.clientX - dragRef.current.startX) / usableW) * 100
        if (h.side === 'left') {
          const adj = Math.max(-(s0[si].slot.w-MIN_PCT), Math.min(s0[si].slot.w-MIN_PCT, dx))
          ns[si].slot.x = parseFloat((s0[si].slot.x + adj).toFixed(2))
          ns[si].slot.w = parseFloat((s0[si].slot.w - adj).toFixed(2))
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs((s0[j].slot.x+s0[j].slot.w)-s0[si].slot.x)<EPS &&
               Math.abs(s0[j].slot.y-s0[si].slot.y)<EPS &&
               Math.abs(s0[j].slot.h-s0[si].slot.h)<EPS) {
              ns[j].slot.w = parseFloat((s0[j].slot.w + adj).toFixed(2))
            }
          })
        } else { // right
          const adj = Math.max(-(s0[si].slot.w-MIN_PCT), Math.min(s0[si].slot.w-MIN_PCT, dx))
          ns[si].slot.w = parseFloat((s0[si].slot.w + adj).toFixed(2))
          items.forEach((id2,j)=>{
            if(j===si) return
            if(Math.abs(s0[j].slot.x-(s0[si].slot.x+s0[si].slot.w))<EPS &&
               Math.abs(s0[j].slot.y-s0[si].slot.y)<EPS &&
               Math.abs(s0[j].slot.h-s0[si].slot.h)<EPS) {
              ns[j].slot.x = parseFloat((s0[j].slot.x + adj).toFixed(2))
              ns[j].slot.w = parseFloat((s0[j].slot.w - adj).toFixed(2))
            }
          })
        }
      }
      onUpdateItems(ns)
    }
    const onUp = () => { dragRef.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
  }

  const sx = pct => (margin + (pct/100)*uw) * scale
  const sy = pct => (margin + (pct/100)*uh) * scale
  const GRAB = 16, PILL = 28, THICK = 10

  return (
    <>
      {handles.map((h, hi) => {
        if (h.side==='top'||h.side==='bottom') {
          const yPx = sy(h.y||h.pct)
          const x1  = sx(h.x1), x2 = sx(h.x2)
          const len = x2-x1
          return (
            <div key={`${h.slotIdx}-${h.side}`}
              onMouseDown={e=>startDrag(e,h)}
              {...{title: tp.resizeHintH(h.slotIdx+1, h.side)}}
              style={{
                position:'absolute', left:x1, top:yPx-GRAB/2,
                width:len, height:GRAB, cursor:'row-resize', zIndex:40,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
              <div style={{position:'absolute',left:0,right:0,top:'50%',
                transform:'translateY(-50%)',height:2,
                background:`rgba(212,170,90,${h.side==='bottom'?0.9:0.65})`,
                pointerEvents:'none'}}/>
              <div style={{position:'absolute',left:'50%',top:'50%',
                transform:'translate(-50%,-50%)',
                width:PILL,height:THICK,background:'var(--gold)',
                borderRadius:THICK/2,pointerEvents:'none',
                boxShadow:'0 1px 6px rgba(0,0,0,0.5)',
                display:'flex',alignItems:'center',justifyContent:'center',gap:3}}>
                {[0,1,2].map(k=><div key={k} style={{width:3,height:4,borderRadius:2,background:'rgba(0,0,0,0.4)'}}/>)}
              </div>
            </div>
          )
        } else {
          const xPx = sx(h.x||h.pct)
          const y1  = sy(h.y1), y2 = sy(h.y2)
          const len = y2-y1
          return (
            <div key={`${h.slotIdx}-${h.side}`}
              onMouseDown={e=>startDrag(e,h)}
              {...{title: tp.resizeHintV(h.slotIdx+1, h.side)}}
              style={{
                position:'absolute', top:y1, left:xPx-GRAB/2,
                height:len, width:GRAB, cursor:'col-resize', zIndex:40,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
              <div style={{position:'absolute',top:0,bottom:0,left:'50%',
                transform:'translateX(-50%)',width:2,
                background:`rgba(212,170,90,${h.side==='right'?0.9:0.65})`,
                pointerEvents:'none'}}/>
              <div style={{position:'absolute',left:'50%',top:'50%',
                transform:'translate(-50%,-50%)',
                height:PILL,width:THICK,background:'var(--gold)',
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
                     onTransformChange, mismatch }) {
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
    const newZoom = Math.max(1, Math.min(4, cur+delta))
    onTransformChange({...(transform||{x:50,y:50}), zoom:newZoom})
  },[isEditMode,transform,onTransformChange])

  // Zoom buttons
  const adjustZoom = (delta) => {
    const cur = transform?.zoom || 1
    const newZoom = Math.max(1, Math.min(4, cur+delta))
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
        <div style={{position:'absolute',top:4,left:4,
          background:'rgba(220,70,70,0.88)',color:'white',
          fontSize:9,padding:'2px 6px',borderRadius:4,
          fontFamily:'var(--font-mono)',pointerEvents:'none',zIndex:12,lineHeight:1.4}}>
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
              onClick={()=>onTransformChange({x:50,y:50,zoom:1})}
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

// ── Editable page ─────────────────────────────────────────────────────────────
function EditablePage({ page, pageIdx, profile, allPageTypes,
                        photoAspects, photoTransforms, onTransformChange,
                        onUpdatePage, onOpenPicker, onAddCaption,
                        onDrop, maxW=570 }) {
  const t = useT(); const tp = t.preview
  const [pw,ph]=getPageDims(profile)
  const MAX_W=maxW
  const scale=Math.min(MAX_W/pw, 720/ph)
  const W=pw*scale, H=ph*scale

  const [dragFromIdx,setDragFromIdx]=useState(null)
  const [dragOverIdx,setDragOverIdx]=useState(null)
  const [editCaptionIdx,setEditCaptionIdx]=useState(null)
  const [editPhotoSlot,setEditPhotoSlot]=useState(null)  // slotIdx in pan/zoom mode

  // Reset edit quando cambia pagina
  useEffect(()=>{setEditPhotoSlot(null);setEditCaptionIdx(null)},[pageIdx])

  const swapItems=(fromIdx,toIdx)=>{
    if(fromIdx===toIdx) return
    const ni=page.items.map(i=>({...i}))
    const tmp=ni[fromIdx].item;ni[fromIdx]={...ni[fromIdx],item:ni[toIdx].item};ni[toIdx]={...ni[toIdx],item:tmp}
    onUpdatePage({...page,items:ni})
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


  return (
    <div>
      {/* Page type switcher */}
      {allPageTypes.length>0&&(
        <div style={{display:'flex',gap:5,alignItems:'center',marginBottom:10,flexWrap:'wrap'}}>
          <span className="text-xs text-muted">Layout:</span>
          {allPageTypes.map(pt=>(
            <button key={pt.id} className={`btn btn-sm${page.page_type_id===pt.id?' btn-primary':''}`}
              style={{fontSize:11}} onClick={()=>changePageType(pt.id)}>{pt.label}</button>
          ))}
          <button className="btn btn-sm" style={{fontSize:11,marginLeft:'auto'}}
            title={tp.addSlot} onClick={addSlot}>{tp.addSlot}</button>
        </div>
      )}

      {/* Page canvas */}
      <div style={{width:W,height:H,background:'#f0ece4',position:'relative',
        boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,overflow:'hidden',
        userSelect:'none',WebkitUserSelect:'none'}}>

        {(page?.items||[]).map((id,slotIdx)=>{
          const slot=id.slot||{x:0,y:0,w:100,h:100}
          const item=id.item
          const r=slotRect(slot,pw,ph,profile,scale)
          const panKey=`${pageIdx}_${slotIdx}`
          const transform=photoTransforms[panKey]||{x:50,y:50,zoom:1}
          const photoAR=item?.type==='photo'?photoAspects[item.asset_id]:null
          const mismatch=item?.type==='photo'&&isMismatch(photoAR,slot)
          const isPhotoEdit=editPhotoSlot===slotIdx
          const isDragSrc=dragFromIdx===slotIdx
          const isDragTgt=dragOverIdx===slotIdx
          const isCaptionEdit=editCaptionIdx===slotIdx
          const canDrag=!!item&&!isPhotoEdit&&!isCaptionEdit
          const outlineColor=isPhotoEdit?'#6a8fd8':mismatch?'#e05050':isDragTgt?'var(--gold)':'transparent'
          const outlineStyle=isDragTgt?'2px dashed':'3px solid'

          return (
            <div key={slotIdx}
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

              {/* Empty slot */}
              {!item&&(
                <div style={{width:'100%',height:'100%',background:'#d0cdc6',
                  display:'flex',flexDirection:'column',alignItems:'center',
                  justifyContent:'center',gap:6}}>
                  <span style={{fontSize:10,color:'#888',fontFamily:'var(--font-mono)'}}>slot vuoto</span>
                  <button className="btn btn-sm" style={{fontSize:10}}
                    onClick={()=>onOpenPicker(pageIdx,slotIdx)}>📷 Scegli foto</button>
                  <button className="btn btn-sm" style={{fontSize:10}}
                    onClick={()=>onAddCaption(pageIdx,slotIdx)}>💬 Didascalia</button>
                  {page.items.length>1&&(
                    <button className="btn btn-sm btn-danger" style={{fontSize:10}}
                      onClick={()=>removeSlot(slotIdx)}>✕ Rimuovi slot</button>
                  )}
                </div>
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
                  onTransformChange={t=>onTransformChange(panKey,t)}
                />
              )}

              {/* Unico overlay con tutti i pulsanti foto — solo icone con title */}
              {item?.type==='photo'&&!isPhotoEdit&&(
                <div className="slot-hover-overlay" style={{alignItems:'flex-end',justifyContent:'center',padding:'0 0 8px'}}>
                  {[
                    { icon:'🖐', label: mismatch ? 'Riposiziona (orientamento diverso)' : 'Riposiziona / Zoom', action: e=>{ e.stopPropagation(); setEditPhotoSlot(slotIdx) }, bg: mismatch ? 'rgba(220,70,70,0.9)' : undefined },
                    { icon:'🔄', label:'Sostituisci foto', action: e=>{ e.stopPropagation(); onOpenPicker(pageIdx,slotIdx) } },
                    { icon:'💬', label:'Aggiungi didascalia', action: e=>{ e.stopPropagation(); onAddCaption(pageIdx,slotIdx) } },
                    { icon:'🗑️', label:'Rimuovi foto dallo slot', action: e=>{ e.stopPropagation(); removeItem(slotIdx) }, bg:'rgba(197,74,74,0.88)' },
                  ].map(({icon,label,action,bg})=>(
                    <button key={icon} title={label} onClick={action}
                      style={{
                        width:32, height:32, borderRadius:6, border:'none', cursor:'pointer',
                        fontSize:15, display:'flex', alignItems:'center', justifyContent:'center',
                        background: bg || 'rgba(212,170,90,0.88)',
                        boxShadow:'0 2px 8px rgba(0,0,0,0.4)',
                        transition:'transform 0.1s,background 0.1s',
                        flexShrink:0,
                      }}
                      onMouseEnter={e=>e.currentTarget.style.transform='scale(1.12)'}
                      onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
                      {icon}
                    </button>
                  ))}
                </div>
              )}



              {/* Caption */}
              {item?.type==='caption'&&(()=>{
                // Merge profile default style with per-caption overrides
                const profileCs = profile?.caption_style || {}
                const cs = { ...profileCs, ...(item.caption_style||{}) }
                const font     = cs.font     || 'Georgia, serif'
                const size     = Math.max(8, Math.min(cs.size||13, Math.max(11, r.w*0.05)))
                const color    = cs.color    || '#e8e6e0'
                const bg       = cs.bg       || '#111116'
                const align    = cs.align    || 'center'
                const valign   = cs.valign   || 'center'
                const italic   = cs.italic   !== false
                const bold     = cs.bold     || false

                const setCs = (key, val) => updateCaption(slotIdx, undefined, {...(item.caption_style||{}), [key]: val})

                if (isCaptionEdit) return (
                  <div style={{width:'100%',height:'100%',background:bg,
                    display:'flex',flexDirection:'column',overflow:'hidden'}}>

                    {/* WYSIWYG toolbar
                        IMPORTANT: ogni controllo ha onMouseDown={e=>e.preventDefault()}
                        per impedire che il textarea perda il focus prima del click */}
                    <div
                      onMouseDown={e=>e.preventDefault()}
                      style={{display:'flex',gap:3,padding:'3px 5px',flexShrink:0,flexWrap:'wrap',
                        background:'rgba(0,0,0,0.35)',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>

                      {/* Font size */}
                      <input type="number" min={8} max={72} step={1} value={cs.size||13}
                        onMouseDown={e=>e.stopPropagation()}
                        onChange={e=>setCs('size', +e.target.value)}
                        title="Dimensione"
                        style={{width:38,height:22,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',
                          borderRadius:3,color:'#ddd',fontSize:10,textAlign:'center',padding:'0 2px'}}/>

                      {/* Bold / Italic */}
                      {[['B','bold',{fontWeight:'bold'}],['I','italic',{fontStyle:'italic'}]].map(([lbl,key,sty])=>(
                        <button key={key}
                          onMouseDown={e=>{ e.preventDefault(); setCs(key, !cs[key]) }}
                          style={{width:22,height:22,border:'1px solid rgba(255,255,255,0.15)',borderRadius:3,
                            cursor:'pointer',fontSize:11,...sty,
                            background:cs[key]?'rgba(212,170,90,0.35)':'rgba(255,255,255,0.08)',
                            color:cs[key]?'#f0c040':'#ccc'}}>{lbl}</button>
                      ))}

                      {/* Text align */}
                      {[['←','left'],['↔','center'],['→','right']].map(([icon,v])=>(
                        <button key={v}
                          onMouseDown={e=>{ e.preventDefault(); setCs('align',v) }}
                          style={{width:22,height:22,border:'1px solid rgba(255,255,255,0.15)',borderRadius:3,
                            cursor:'pointer',fontSize:12,
                            background:align===v?'rgba(212,170,90,0.35)':'rgba(255,255,255,0.08)',
                            color:align===v?'#f0c040':'#ccc'}}>{icon}</button>
                      ))}

                      {/* Vertical align */}
                      {[['↑','flex-start'],['↕','center'],['↓','flex-end']].map(([icon,v])=>(
                        <button key={v}
                          onMouseDown={e=>{ e.preventDefault(); setCs('valign',v) }}
                          style={{width:22,height:22,border:'1px solid rgba(255,255,255,0.15)',borderRadius:3,
                            cursor:'pointer',fontSize:12,
                            background:valign===v?'rgba(212,170,90,0.35)':'rgba(255,255,255,0.08)',
                            color:valign===v?'#f0c040':'#ccc'}}>{icon}</button>
                      ))}

                      {/* Text color */}
                      <div title="Colore testo" style={{position:'relative',display:'inline-block'}}>
                        <input type="color" value={color}
                          onMouseDown={e=>e.stopPropagation()}
                          onChange={e=>setCs('color',e.target.value)}
                          style={{width:22,height:22,padding:1,border:'1px solid rgba(255,255,255,0.15)',
                            borderRadius:3,cursor:'pointer',background:'transparent'}}/>
                      </div>

                      {/* Bg color */}
                      <div title="Colore sfondo" style={{position:'relative',display:'inline-block'}}>
                        <input type="color" value={bg==='transparent'?'#000000':bg}
                          onMouseDown={e=>e.stopPropagation()}
                          onChange={e=>setCs('bg',e.target.value)}
                          style={{width:22,height:22,padding:1,border:'1px solid rgba(255,255,255,0.15)',
                            borderRadius:3,cursor:'pointer',background:'transparent'}}/>
                      </div>

                      {/* Sync to Immich */}
                      {item.for_asset_id&&(
                        <button
                          onMouseDown={e=>{ e.preventDefault(); syncCaptionToImmich(slotIdx) }}
                          title="Salva come descrizione in Immich"
                          style={{marginLeft:'auto',height:22,padding:'0 6px',border:'1px solid rgba(255,255,255,0.15)',
                            borderRadius:3,cursor:'pointer',fontSize:9,
                            background:'rgba(212,170,90,0.2)',color:'#f0c040',whiteSpace:'nowrap'}}>
                          ↑ Immich
                        </button>
                      )}

                      {/* Done — unico che deve chiudere l'editor */}
                      <button
                        onMouseDown={e=>{ e.preventDefault(); syncCaptionToImmich(slotIdx); setEditCaptionIdx(null) }}
                        title="Chiudi editor"
                        style={{height:22,padding:'0 6px',border:'1px solid rgba(255,255,255,0.15)',
                          borderRadius:3,cursor:'pointer',fontSize:9,
                          background:'rgba(255,255,255,0.08)',color:'#ccc'}}>✓</button>
                    </div>

                    <textarea autoFocus value={item.text||''}
                      onChange={e=>updateCaption(slotIdx, e.target.value)}
                      onKeyDown={e=>{
                        if(e.key==='Escape'){ syncCaptionToImmich(slotIdx); setEditCaptionIdx(null) }
                      }}
                      style={{flex:1,background:'transparent',border:'none',
                        outline:'none',color,fontFamily:font,fontStyle:italic?'italic':'normal',
                        fontWeight:bold?'bold':'normal',fontSize:size,
                        resize:'none',lineHeight:1.55,padding:Math.max(6,r.w*0.04),
                        textAlign:align}}/>
                  </div>
                )

                return (
                  <div style={{width:'100%',height:'100%',background:bg,
                    display:'flex',alignItems:valign,justifyContent:align==='left'?'flex-start':align==='right'?'flex-end':'center',
                    padding:Math.max(8,r.w*0.05)}}>
                    <span style={{color,fontFamily:font,fontStyle:italic?'italic':'normal',
                      fontWeight:bold?'bold':'normal',fontSize:size,
                      textAlign:align,lineHeight:1.55,
                      overflow:'hidden',display:'-webkit-box',
                      WebkitLineClamp:Math.max(2,Math.floor(r.h/((size||13)*1.6))),
                      WebkitBoxOrient:'vertical'}}>
                      {item.text||<span style={{opacity:0.32}}>clicca per scrivere…</span>}
                    </span>
                    <div className="slot-hover-overlay">
                      <button className="slot-btn" style={{fontSize:10}}
                        onClick={e=>{e.stopPropagation();setEditCaptionIdx(slotIdx)}}>✏️ Modifica</button>
                      <button className="slot-btn" style={{fontSize:10,background:'rgba(197,74,74,0.9)'}}
                        onClick={e=>{e.stopPropagation();removeItem(slotIdx)}}>✕</button>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })}

        {/* Slot dividers */}
        <SlotDividers items={page.items} pw={pw} ph={ph} profile={profile} scale={scale}
          onUpdateItems={newItems=>onUpdatePage({...page,items:newItems,page_type_id:'custom',
            page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}})}/>
      </div>

      <p className="text-xs text-muted mt-2">
        Hover → azioni · "🖐 Riposiziona" → drag+scroll per spostare e zoomare · ⇄ drag tra slot per scambiare
      </p>
    </div>
  )
}

// ── Export panel ──────────────────────────────────────────────────────────────
function ExportPanel({ layout, onExport, exporting }) {
  const t = useT(); const tp = t.preview
  const [open,setOpen]=useState(false)
  const p=layout?.profile||{}
  return (
    <div style={{padding:12,borderTop:'1px solid var(--border)',flexShrink:0}}>
      <button className="btn btn-primary w-full" style={{justifyContent:'center',fontSize:12}}
        onClick={()=>setOpen(o=>!o)} disabled={exporting}>
        {exporting?<><span className="spinner"/> Generazione…</>:<>📄 Esporta</>}
      </button>
      {open&&!exporting&&(
        <div style={{marginTop:8,background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:8,padding:12}}>
          {[['📐 Formato',`${p.page_size} ${p.orientation==='landscape'?'Orizz.':'Vert.'}`],
            ['📏 Margini',`${p.margin_mm}mm`],
            ['✂ Abbondanza',p.bleed?`${p.bleed_mm}mm`:'No'],
            ['📄 Pagine',`${(layout?.pages?.length||0)+1}`],
          ].map(([k,v])=>(
            <div key={k} style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text2)',
              display:'flex',justifyContent:'space-between',padding:'2px 0',borderBottom:'1px solid var(--border)'}}>
              <span>{k}</span><strong style={{color:'var(--text)'}}>{v}</strong>
            </div>
          ))}
          <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:10}}>
            <button className="btn btn-primary" style={{justifyContent:'center',fontSize:12}}
              onClick={()=>onExport('pdf')}>
              📄 Esporta PDF
            </button>
            <button className="btn" style={{justifyContent:'center',fontSize:12}}
              onClick={()=>onExport('svg')}
              title="ZIP con SVG modificabili (Illustrator, Scribus, InDesign)">
              🎨 Esporta SVG / Illustrator
            </button>
          </div>
          <p style={{textAlign:'center',fontSize:9,color:'var(--text3)',marginTop:6,fontFamily:'var(--font-mono)'}}>
            SVG compatibile con Illustrator, Scribus, InDesign
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
  const [projectName, setProjectName] = useState(
    layout ? `${layout.album?.albumName || 'Album'} — ${new Date().toLocaleDateString('it-IT')}` : ''
  )
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
    try { setProjects((await axios.get('/api/projects')).data) }
    catch { setToast({ type:'error', msg:'Errore nel caricamento dei progetti' }) }
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
      let res
      if (savedId) {
        res = await axios.put(`/api/projects/${savedId}`, payload)
        setToast({ type:'success', msg:tp.projectSavedOk })
      } else {
        res = await axios.post('/api/projects', payload)
        sessionStorage.setItem('photobook_project_id', res.data.id)
        setSavedId(res.data.id)
        setToast({ type:'success', msg:tp.projectNewSavedOk })
      }
      setTimeout(onClose, 1200)
    } catch {
      setToast({ type:'error', msg:tp.projectSaveError })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveNew = async () => {
    setSavedId(null)     // forza creazione nuovo
    sessionStorage.removeItem('photobook_project_id')
    await handleSave()
  }

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
                  ? `Progetto aperto — premi "Aggiorna" per sovrascrivere o "Salva come nuovo" per una copia`
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
              <p className="text-xs text-muted mb-4">Progetti salvati</p>
              {loading && <div style={{ textAlign:'center', padding:16 }}><span className="spinner"/></div>}
              {!loading && projects.length === 0 && (
                <p className="text-sm text-muted" style={{ textAlign:'center', padding:16 }}>
                  Nessun progetto salvato
                </p>
              )}
              {!loading && projects.map(p => (
                <ProjectRow key={p.id} project={p} fmt={fmt} onLoad={handleLoad} onDelete={handleDelete}/>
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

function ProjectRow({ project, fmt, onLoad, onDelete }) {
  const t = useT(); const tp = t.preview
  return (
    <div
      onClick={() => onLoad(project.id)}
      style={{
        display:'flex', gap:12, alignItems:'center',
        padding:'12px 14px', borderRadius:8, cursor:'pointer',
        border:'1px solid var(--border)', marginBottom:8,
        transition:'background 0.12s, border-color 0.12s',
        background:'var(--bg3)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background='var(--bg)'; e.currentTarget.style.borderColor='var(--gold)' }}
      onMouseLeave={e => { e.currentTarget.style.background='var(--bg3)'; e.currentTarget.style.borderColor='var(--border)' }}>
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
            Ricalcola layout
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
  const [photoPicker,setPhotoPicker]=useState(null)
  const [albumAssets,setAlbumAssets]=useState([])
  const [mapUrl,setMapUrl]=useState(null)
  const [exporting,setExporting]=useState(false)
  const [recalculating,setRecalculating]=useState(false)
  const [toast,setToast]=useState(null)
  const [hasChanges,setHasChanges]=useState(false)
  const [recalcMenuOpen,setRecalcMenuOpen]=useState(false)
  const [projectModal,setProjectModal]=useState(null)  // null | 'save' | 'load'
  const recalcBtnRef = useRef(null)
  const [panelOpen,setPanelOpen]=useState(true)
  const [draggedAsset,setDraggedAsset]=useState(null)
  const [spreadView,setSpreadView]=useState(false)  // false=single, true=2-page spread
  const [sidebarDrag,setSidebarDrag]=useState(null)  // {idx} being dragged in sidebar

  useEffect(() => {
    const stored = sessionStorage.getItem('photobook_layout')
    if (!stored) return
    const data = JSON.parse(stored); setLayout(data)
    // Load face-aware transforms from smart layout (if any)
    const storedTransforms = sessionStorage.getItem('photobook_transforms')
    if (storedTransforms) {
      try { setPhotoTransforms(JSON.parse(storedTransforms)) } catch {}
    }
    if (data.locations?.length)
      axios.post('/api/map',{locations:data.locations},{responseType:'blob'})
        .then(r=>setMapUrl(URL.createObjectURL(r.data))).catch(()=>{})
    if (data.album?.id)
      axios.get(`/api/albums/${data.album.id}`)
        .then(r=>setAlbumAssets(r.data.assets||[])).catch(()=>{})
  },[])

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
        img.src=`/api/thumb/${item.asset_id}?size=thumbnail`
      }
    }))
  },[layout])

  // Keyboard navigation
  useEffect(()=>{
    const onKey=e=>{
      if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT') return
      if(!layout) return
      if(e.key==='ArrowRight'||e.key==='ArrowDown') setCurrentPage(p=>Math.min(layout.pages.length-1,p+1))
      if(e.key==='ArrowLeft'||e.key==='ArrowUp')   setCurrentPage(p=>Math.max(-1,p-1))
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
    if (!confirm('Eliminare questa pagina?')) return
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
    setPhotoTransforms(prev=>({...prev,[panKey]:t}))
  },[])

  const openPicker=useCallback((pageIdx,slotIdx)=>setPhotoPicker({pageIdx,slotIdx}),[])

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
      const captionItem={type:'caption',text:'',for_asset_id:item?.asset_id||'',originalFileName:item?.originalFileName||''}
      const emptyIdx=items.findIndex((id,i)=>i!==slotIdx&&!id.item)
      let newItems
      if(emptyIdx>=0){
        newItems=items.map((id,i)=>i===emptyIdx?{...id,item:captionItem}:id)
      } else {
        const slot=items[slotIdx].slot
        const photoSlot={...slot,h:parseFloat((slot.h*0.68).toFixed(2))}
        const capSlot={x:slot.x,y:parseFloat((slot.y+slot.h*0.68).toFixed(2)),w:slot.w,h:parseFloat((slot.h*0.32).toFixed(2))}
        newItems=items.map((id,i)=>i===slotIdx?{slot:photoSlot,item:id.item}:id)
        newItems.push({slot:capSlot,item:captionItem})
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

  // ── 1. Da questa pagina in avanti ────────────────────────────────────────
  const recalcFromHere=async()=>{
    const fromIdx=Math.max(0,currentPage)
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,fromIdx)
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const locked=prev.pages.slice(0,fromIdx)
        return persist({...prev,pages:[...locked,...r.data.pages]})
      })
      setHasChanges(false)
      showToast(tp.recalcToasts.fromHere(fromIdx+1),'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 2. Solo questa pagina ────────────────────────────────────────────────
  const recalcThisPage=async()=>{
    if(currentPage<0) return
    setRecalculating(true)
    try{
      const photoItems=collectPhotos([layout.pages[currentPage]],0)
      if(!photoItems.length){showToast('Nessuna foto in questa pagina','error');return}
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const pages=[...prev.pages]
        // Se il backend genera più pagine, inseriscile al posto di quella corrente
        pages.splice(currentPage,1,...r.data.pages)
        return persist({...prev,pages})
      })
      showToast(tp.recalcToasts.thisPage,'success')
    }catch{showToast('Errore nel ricalcolo','error')}
    finally{setRecalculating(false)}
  }

  // ── 3. Tutto l'album da zero ─────────────────────────────────────────────
  const recalcAll=async()=>{
    if(!window.confirm(tp.recalcConfirmAll)) return
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,0)
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>persist({...prev,pages:r.data.pages}))
      setHasChanges(false);setCurrentPage(0)
      showToast(tp.recalcToasts.all,'success')
    }catch{showToast('Errore nel ricalcolo','error')}
    finally{setRecalculating(false)}
  }

  // ── 4. Comprimi pagine vuote (ricalcola backend da fromIdx) ─────────────
  const recalcCompress=async()=>{
    const fromIdx=Math.max(0,currentPage)
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,fromIdx)
      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'error');return}
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const locked=prev.pages.slice(0,fromIdx)
        return persist({...prev,pages:[...locked,...r.data.pages]})
      })
      showToast(tp.recalcToasts.compress,'success')
    }catch{showToast('Errore','error')}
    finally{setRecalculating(false)}
  }

  // ── 5. Ottimizza orientamento (frontend, nessuna chiamata backend) ───────
  const recalcOrientation=()=>{
    const fromIdx=Math.max(0,currentPage)
    let swapped=0
    const newPages=layout.pages.map((pg,pi)=>{
      if(pi<fromIdx) return pg
      const opt=optimizePageOrientation(pg,photoAspects)
      // conta se qualcosa è cambiato
      opt.items.forEach((id,i)=>{
        if(id.item?.asset_id!==pg.items[i]?.item?.asset_id) swapped++
      })
      return opt
    })
    setLayout(prev=>persist({...prev,pages:newPages}))
    setHasChanges(true)
    showToast(`✓ Orientamento ottimizzato${swapped?` (${swapped} scambi)`:'  — già ottimale'}`,'success')
  }

  // ── 6. Riordina per data (frontend) ──────────────────────────────────────
  const recalcReorderDate=()=>{
    const fromIdx=Math.max(0,currentPage)
    // Copia profonda delle pagine da fromIdx
    const newPages=layout.pages.map((pg,pi)=>
      pi<fromIdx?pg:{...pg,items:pg.items.map(id=>({...id}))}
    )
    // Raccogli posizioni slot foto in ordine
    const slots=[]
    for(let pi=fromIdx;pi<newPages.length;pi++)
      newPages[pi].items.forEach((id,si)=>{if(id.item?.type==='photo') slots.push({pi,si,item:id.item})})
    // Ordina per data
    const sorted=[...slots].sort((a,b)=>(a.item.localDateTime||'').localeCompare(b.item.localDateTime||''))
    // Rimetti nelle stesse posizioni
    slots.forEach(({pi,si},i)=>{newPages[pi].items[si]={...newPages[pi].items[si],item:sorted[i].item}})
    setLayout(prev=>persist({...prev,pages:newPages}))
    setHasChanges(true)
    showToast(tp.recalcToasts.reorderDate,'success')
  }

  // ── 7. Aggiungi foto non usate ────────────────────────────────────────────
  const recalcAddUnused=async()=>{
    const usedIds=new Set()
    layout.pages.forEach(pg=>pg.items.forEach(id=>{if(id.item?.type==='photo') usedIds.add(id.item.asset_id)}))
    const unused=albumAssets.filter(a=>!usedIds.has(a.id))
    if(!unused.length){showToast(tp.recalcToasts.allUsed,'success');return}
    setRecalculating(true)
    try{
      const photoItems=unused.map(asset=>{
        const exif=asset.exifInfo||{}
        const desc=(exif.description||asset.description||'').trim()
        return{type:'photo',asset_id:asset.id,description:desc,
          originalFileName:asset.originalFileName||'',localDateTime:asset.localDateTime||'',
          exif,has_caption:!!desc}
      })
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      const insertAt=layout.pages.length
      setLayout(prev=>persist({...prev,pages:[...prev.pages,...r.data.pages]}))
      setCurrentPage(insertAt)
      showToast(tp.recalcToasts.addedUnused(unused.length, r.data.pages.length),'success')
    }catch{showToast('Errore','error')}
    finally{setRecalculating(false)}
  }

  // ── Dispatcher del menu ───────────────────────────────────────────────────
  const handleRecalcAction = (id) => {
    setRecalcMenuOpen(false)
    const map={
      from_here: recalcFromHere,
      this_page: recalcThisPage,
      full:      recalcAll,
      compress:  recalcCompress,
      orientation:recalcOrientation,
      reorder_date:recalcReorderDate,
      add_unused:recalcAddUnused,
    }
    map[id]?.()
  }

  const exportBook=async(format='pdf')=>{
    if(!layout) return; setExporting(true)
    try{
      const r=await axios.post('/api/export',{
        album_id:layout.album.id,
        profile_id:layout.profile.id,
        pages:layout.pages,
        locations:layout.locations||[],
        photo_transforms:photoTransforms,
        format,
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
    if (projectData.photo_transforms) setPhotoTransforms(projectData.photo_transforms)
    setCurrentPage(projectData.current_page ?? 0)
    setHasChanges(false)
    // reload album assets for the picker
    if (projectData.album?.id)
      axios.get(`/api/albums/${projectData.album.id}`)
        .then(r=>setAlbumAssets(r.data.assets||[])).catch(()=>{})
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
      <div className="preview-sidebar" style={{width:200}}>
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
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'8px 8px 0'}}>
          {/* Cover thumb */}
          <div className={`page-thumb-item${currentPage===-1?' active':''}`} onClick={()=>setCurrentPage(-1)}>
            <span className="page-num">T</span>
            <div style={{width:28,height:40,background:'#0f0f14',borderRadius:2,overflow:'hidden',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
              {mapUrl?<img src={mapUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:12}}>🗺️</span>}
            </div>
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
                borderLeft: sidebarDrag!==null&&sidebarDrag!==idx ? '2px solid transparent' : undefined,
                outline: sidebarDrag!==null&&sidebarDrag!==idx ? undefined : undefined,
                cursor:'grab',
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
            <span>Aggiungi pagina in fondo</span>
          </div>
        </div>
        <ExportPanel layout={layout} onExport={exportBook} exporting={exporting}/>
      </div>

      {/* ── Main canvas ── */}
      <div className="preview-main" style={{flex:1}}>
        {/* Top bar: prev/next + spread toggle + add page */}
        <div className="flex items-center justify-between" style={{width:'100%',maxWidth:900,marginBottom:12,flexShrink:0,gap:8}}>
          <button className="btn btn-ghost" style={{fontSize:12}}
            onClick={()=>setCurrentPage(p=>Math.max(-1,p-1))} disabled={currentPage<=-1}>{tp.prevBtn}</button>

          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="text-sm font-mono text-muted">
              {currentPage===-1?tp.coverPage:tp.pageOf(currentPage+1, pages.length)}
            </span>
            {/* Spread / Single toggle */}
            <div style={{display:'flex',gap:2,background:'var(--bg3)',borderRadius:6,padding:2,border:'1px solid var(--border)'}}>
              <button
                onClick={()=>setSpreadView(false)}
                title="Pagina singola"
                style={{padding:'3px 8px',borderRadius:4,border:'none',cursor:'pointer',fontSize:11,
                  background:!spreadView?'var(--bg)':'transparent',
                  color:!spreadView?'var(--text)':'var(--text3)'}}>□</button>
              <button
                onClick={()=>setSpreadView(true)}
                title="Doppia pagina (spread)"
                style={{padding:'3px 8px',borderRadius:4,border:'none',cursor:'pointer',fontSize:11,
                  background:spreadView?'var(--bg)':'transparent',
                  color:spreadView?'var(--text)':'var(--text3)'}}>□□</button>
            </div>
            {/* Add page */}
            {currentPage >= 0 && (
              <button className="btn btn-sm" style={{fontSize:11}}
                title="Aggiungi pagina vuota dopo questa"
                onClick={()=>addPage(currentPage)}>+ Pagina</button>
            )}
            {/* Remove current page */}
            {currentPage >= 0 && pages.length > 1 && (
              <button className="btn btn-sm btn-danger" style={{fontSize:11}}
                title="Elimina questa pagina"
                onClick={()=>removePage(currentPage)}>× Elimina</button>
            )}
          </div>

          <button className="btn btn-ghost" style={{fontSize:12}}
            onClick={()=>setCurrentPage(p=>Math.min(pages.length-1,p+1))} disabled={currentPage>=pages.length-1}>{tp.nextBtn}</button>
        </div>

        {currentPage===-1?(
          <div style={{textAlign:'center'}}>
            <div style={{background:'#0a0a0e',borderRadius:8,padding:32,boxShadow:'0 12px 56px rgba(0,0,0,0.6)',minWidth:240,maxWidth:420,margin:'0 auto'}}>
              {mapUrl&&<img src={mapUrl} alt="" style={{width:'100%',borderRadius:4,marginBottom:20,opacity:0.75,display:'block'}}/>}
              <div style={{borderTop:'1px solid rgba(212,170,90,0.5)',paddingTop:16,marginBottom:10}}>
                <h2 style={{fontFamily:'var(--font-display)',fontSize:24,fontWeight:300,color:'#f0ede6'}}>{album.albumName}</h2>
              </div>
              {album.description&&<p style={{color:'#888',fontStyle:'italic',fontSize:13,lineHeight:1.5}}>{album.description}</p>}
              <div style={{marginTop:16,display:'flex',justifyContent:'space-between',fontSize:11,fontFamily:'var(--font-mono)',color:'#555'}}>
                <span>{album.assetCount} foto</span>
                {layout.locations?.length>0&&<span>{layout.locations.length} GPS</span>}
              </div>
            </div>
            <p className="text-xs text-muted mt-3">La copertina viene generata automaticamente con mappa GPS</p>
          </div>
        ) : spreadView ? (
          /* ── Spread view: 2 pages side by side ── */
          (() => {
            // Even page on left (0-indexed: even idx = right-hand page in book terms,
            // but user wants pairs: 0+1, 2+3 etc. — floor to even pair)
            const leftIdx  = currentPage % 2 === 0 ? currentPage - 1 : currentPage
            const rightIdx = leftIdx + 1
            const leftPage  = leftIdx >= 0 ? pages[leftIdx]  : null
            const rightPage = rightIdx < pages.length ? pages[rightIdx] : null
            return (
              <div style={{display:'flex',gap:8,alignItems:'flex-start',justifyContent:'center'}}>
                {/* Left page */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                  {leftPage ? (
                    <EditablePage
                      page={leftPage} pageIdx={leftIdx}
                      profile={profile} allPageTypes={allPageTypes}
                      photoAspects={photoAspects} photoTransforms={photoTransforms}
                      onTransformChange={onTransformChange}
                      onUpdatePage={p=>updatePage(leftIdx,p)}
                      onOpenPicker={openPicker} onAddCaption={addCaption}
                      onDrop={handleDropFromPanel}
                      maxW={360}/>
                  ) : (
                    <div style={{width:250,height:354,background:'rgba(0,0,0,0.08)',borderRadius:2,
                      display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>copertina/inizio</span>
                    </div>
                  )}
                  {leftPage && (
                    <p className="text-xs text-muted mt-1">Pagina {leftIdx+1}</p>
                  )}
                </div>
                {/* Right page */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                  {rightPage ? (
                    <EditablePage
                      page={rightPage} pageIdx={rightIdx}
                      profile={profile} allPageTypes={allPageTypes}
                      photoAspects={photoAspects} photoTransforms={photoTransforms}
                      onTransformChange={onTransformChange}
                      onUpdatePage={p=>updatePage(rightIdx,p)}
                      onOpenPicker={openPicker} onAddCaption={addCaption}
                      onDrop={handleDropFromPanel}
                      maxW={360}/>
                  ) : (
                    <div style={{width:250,height:354,background:'rgba(0,0,0,0.08)',borderRadius:2,
                      display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>fine album</span>
                    </div>
                  )}
                  {rightPage && (
                    <p className="text-xs text-muted mt-1">Pagina {rightIdx+1}</p>
                  )}
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
            onTransformChange={onTransformChange}
            onUpdatePage={p=>updatePage(currentPage,p)}
            onOpenPicker={openPicker}
            onAddCaption={addCaption}
            onDrop={handleDropFromPanel}
          />
        )}
      </div>

      {/* ── Right panel: album photos ── */}
      <AlbumPanel
        assets={albumAssets}
        usageMap={usageMap}
        usagePages={usagePages}
        open={panelOpen}
        onToggle={()=>setPanelOpen(o=>!o)}
        onDragStart={setDraggedAsset}
        onNavigate={pi=>setCurrentPage(pi)}
      />

      {photoPicker&&(
        <PhotoPickerModal assets={albumAssets} usageMap={usageMap}
          onSelect={onPhotoSelected} onClose={()=>setPhotoPicker(null)}/>
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
    </div>
  )
}
