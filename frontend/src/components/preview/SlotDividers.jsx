import { useState, useEffect, useRef } from 'react'
import { marginsForPage } from '../../utils/pageGeometry'
import { useT } from '../../i18n.jsx'

// ── Per-slot resize handles ──────────────────────────────────────────────────
// Ogni slot ha 4 handle (top/bottom/left/right).
// Trascinare un handle sposta quel bordo e, se c'è uno slot adiacente, lo ridimensiona.
// Se non c'è adiacente, il bordo viene spostato liberamente (entro i limiti della pagina).
export default function SlotDividers({ items: _rawItems, pw, ph, profile, scale, onUpdateItems, pageNum }) {
  const items = _rawItems || []
  const t = useT(); const tp = t.preview
  const dragRef = useRef(null)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const _m = marginsForPage(profile, pageNum)
  const uw = pw - _m.ml - _m.mr
  const uh = ph - _m.mt - _m.mb
  const MIN_PCT   = 8
  const EPS       = 1.5
  const SNAP_DIST = 3   // % — snap outer edge back to 0/100 within this distance

  useEffect(() => {
    const down = e => { if (e.key === 'Control') setCtrlHeld(true) }
    const up   = e => { if (e.key === 'Control') setCtrlHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

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

  const startMove = (e, slotIdx) => {
    e.preventDefault(); e.stopPropagation()
    const snap = items.map(id => ({...id, slot: {...id.slot}}))
    const usableW = uw * scale, usableH = uh * scale
    dragRef.current = { move: true, slotIdx, startX: e.clientX, startY: e.clientY, snap }
    const fmt = v => parseFloat(v.toFixed(2))
    const onMove = me => {
      if (!dragRef.current?.move) return
      const { slotIdx: si, snap: s0 } = dragRef.current
      const ns = s0.map(id => ({...id, slot: {...id.slot}}))
      const dx = ((me.clientX - dragRef.current.startX) / usableW) * 100
      const dy = ((me.clientY - dragRef.current.startY) / usableH) * 100
      ns[si].slot.x = fmt(Math.max(0, Math.min(100 - s0[si].slot.w, s0[si].slot.x + dx)))
      ns[si].slot.y = fmt(Math.max(0, Math.min(100 - s0[si].slot.h, s0[si].slot.y + dy)))
      onUpdateItems(ns)
      dragRef.current.startX = me.clientX
      dragRef.current.startY = me.clientY
      dragRef.current.snap = ns
    }
    const onUp = () => { dragRef.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  const sx = pct => (_m.ml + (pct/100)*uw) * scale
  const sy = pct => (_m.mt + (pct/100)*uh) * scale
  const GRAB = 16, PILL = 28, THICK = 10

  return (
    <>
      {/* Per-slot Ctrl+drag move overlays */}
      {items.map((id, si) => {
        const s = id.slot; if (!s) return null
        const x1 = sx(s.x), y1 = sy(s.y)
        const x2 = sx(s.x + s.w), y2 = sy(s.y + s.h)
        return (
          <div key={`move-${si}`}
            onMouseDown={e => { if (e.ctrlKey) startMove(e, si) }}
            title={ctrlHeld ? `Trascina per spostare slot ${si+1}` : undefined}
            style={{
              position: 'absolute', left: x1, top: y1,
              width: x2-x1, height: y2-y1,
              zIndex: 38,
              cursor: ctrlHeld ? 'grab' : 'default',
              pointerEvents: ctrlHeld ? 'auto' : 'none',
              background: ctrlHeld ? 'rgba(212,170,90,0.06)' : 'transparent',
              boxSizing: 'border-box',
              border: ctrlHeld ? '1.5px dashed rgba(212,170,90,0.5)' : 'none',
            }}
          />
        )
      })}
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
