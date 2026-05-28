import { useRef, useCallback } from 'react'
import { photoStyle } from '../../utils/pageGeometry'
import { useT } from '../../i18n.jsx'

// ── Photo slot — pan + zoom ───────────────────────────────────────────────────
// ── Photo slot — pan + zoom ───────────────────────────────────────────────────
export default function PhotoSlot({ item, slotW, slotH, transform, photoAR,
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
        src={`/api/thumb/${item.asset_id}?size=preview&t=${item._updated_at||''}`}
        alt="" loading="lazy"
        style={{...imgStyle, imageOrientation:'from-image', cursor: isEditMode ? 'move' : 'default'}}
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
