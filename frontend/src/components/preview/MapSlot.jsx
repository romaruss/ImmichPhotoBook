import { useRef, useCallback } from 'react'
import { photoStyle } from '../../utils/pageGeometry'

const MAP_AR = 2.0  // matches backend generate_map_image(800, 400)

export default function MapSlot({ item, slotW, slotH, transform, isEditMode, onEnterEdit, onExitEdit, onTransformChange, onResetTransform }) {
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
