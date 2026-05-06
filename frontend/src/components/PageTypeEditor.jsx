/**
 * PageTypeEditor
 *
 * Mostra le pagine tipo come miniature. Ogni miniatura ha ✏ (modifica) e ✕ (elimina).
 * "Nuovo layout" apre SlotEditorModal.
 *
 * SlotEditorModal:
 *   - Canvas SVG con handle PER SLOT (4 bordi indipendenti per slot)
 *   - Spostare un bordo cambia SOLO quello slot — nessun accoppiamento rigido
 *   - Toggle magnete: snap ai bordi vicini al rilascio del mouse
 *   - Hover gestito con stato React (nessuna manipolazione DOM diretta)
 *
 * Il componente usa stato interno puro.
 * Il parent deve passare key={profileId} per il reset al cambio profilo.
 */

import { useState, useRef, useCallback, useEffect } from 'react'

// ── Canvas dimensions (px) ────────────────────────────────────────────────────
const CW = 360   // canvas width  (portrait)
const CH = 504   // canvas height (portrait)
// Per landscape, invertiamo: width=CH, height=CW

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS_PORTRAIT = [
  { label:'1 foto intera',      slots:[{x:0,y:0,w:100,h:100}] },
  { label:'Ritratto centrato',  slots:[{x:18,y:0,w:64,h:100}] },
  { label:'Foto + didascalia',  slots:[{x:0,y:0,w:100,h:72},{x:0,y:72,w:100,h:28}] },
  { label:'2 affiancate',       slots:[{x:0,y:0,w:50,h:100},{x:50,y:0,w:50,h:100}] },
  { label:'2 impilate',         slots:[{x:0,y:0,w:100,h:50},{x:0,y:50,w:100,h:50}] },
  { label:'3 grande sopra',     slots:[{x:0,y:0,w:100,h:55},{x:0,y:55,w:50,h:45},{x:50,y:55,w:50,h:45}] },
  { label:'3 verticali',        slots:[{x:0,y:0,w:33.3,h:100},{x:33.3,y:0,w:33.4,h:100},{x:66.7,y:0,w:33.3,h:100}] },
  { label:'4 griglia 2×2',      slots:[{x:0,y:0,w:50,h:50},{x:50,y:0,w:50,h:50},{x:0,y:50,w:50,h:50},{x:50,y:50,w:50,h:50}] },
  { label:'4 grande + 3',       slots:[{x:0,y:0,w:60,h:100},{x:60,y:0,w:40,h:33.3},{x:60,y:33.4,w:40,h:33.3},{x:60,y:66.7,w:40,h:33.3}] },
]
const DEFAULTS_LANDSCAPE = [
  { label:'1 foto intera',      slots:[{x:0,y:0,w:100,h:100}] },
  { label:'Paesaggio centrato', slots:[{x:0,y:22,w:100,h:56}] },
  { label:'Panoramica',         slots:[{x:0,y:30,w:100,h:40}] },
  { label:'2 affiancate',       slots:[{x:0,y:0,w:50,h:100},{x:50,y:0,w:50,h:100}] },
  { label:'2 impilate',         slots:[{x:0,y:0,w:100,h:50},{x:0,y:50,w:100,h:50}] },
  { label:'3 orizzontali',      slots:[{x:0,y:0,w:100,h:33},{x:0,y:33.5,w:100,h:33},{x:0,y:67,w:100,h:33}] },
  { label:'4 griglia 2×2',      slots:[{x:0,y:0,w:50,h:50},{x:50,y:0,w:50,h:50},{x:0,y:50,w:50,h:50},{x:50,y:50,w:50,h:50}] },
  { label:'6 griglia 3×2',      slots:[{x:0,y:0,w:33.3,h:50},{x:33.4,y:0,w:33.3,h:50},{x:66.7,y:0,w:33.3,h:50},{x:0,y:50,w:33.3,h:50},{x:33.4,y:50,w:33.3,h:50},{x:66.7,y:50,w:33.3,h:50}] },
]

const SNAP_DIST = 4   // % — soglia magnete
const MIN_SIZE  = 5   // % — dimensione minima slot

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function autoNameSlots(slots, orientation) {
  const pageAR = orientation === 'landscape' ? CH/CW : CW/CH
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

/** Griglia uniforme di n slot */
function makeGrid(n) {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const slots = []
  let k = 0
  for (let r = 0; r < rows && k < n; r++)
    for (let c = 0; c < cols && k < n; c++, k++)
      slots.push({
        x: parseFloat(((c / cols) * 100).toFixed(2)),
        y: parseFloat(((r / rows) * 100).toFixed(2)),
        w: parseFloat((100 / cols).toFixed(2)),
        h: parseFloat((100 / rows).toFixed(2)),
        slot_type: 'photo',
      })
  return slots
}

// ── Slot color palette (one distinct colour per slot index, cycles) ───────────
const SLOT_PALETTE = [
  [212, 160,  50],  // amber
  [ 55, 185, 165],  // teal
  [200,  75, 115],  // rose
  [130,  90, 215],  // violet
  [ 65, 190,  85],  // green
  [220, 110,  45],  // orange
  [ 50, 155, 215],  // sky
  [200,  55,  55],  // red
  [155, 200,  45],  // lime
  [ 55, 115, 200],  // blue
  [190, 140,  75],  // sand
  [ 75, 200, 150],  // mint
]

function slotColor(i) {
  const [r, g, b] = SLOT_PALETTE[i % SLOT_PALETTE.length]
  return {
    fill:      `rgba(${r},${g},${b},0.22)`,
    fillAct:   `rgba(${r},${g},${b},0.40)`,
    stroke:    `rgba(${r},${g},${b},0.70)`,
    strokeAct: `rgba(${r},${g},${b},1.0)`,
    tableBg:   `rgba(${r},${g},${b},0.14)`,
    thumb:     `rgba(${r},${g},${b},0.32)`,
    thumbStroke: `rgb(${Math.round(r*0.75)},${Math.round(g*0.75)},${Math.round(b*0.75)})`,
  }
}

// ── Miniatura ─────────────────────────────────────────────────────────────────
function LayoutThumb({ pt, profileOrientation, onEdit, onDelete, onDuplicate, onToggle }) {
  const ptOri  = pt.orientation || 'any'
  const oriMatch   = ptOri === 'any' || ptOri === profileOrientation
  const manualOff  = oriMatch && pt.enabled === false   // ✗ manual-off
  const autoOff    = !oriMatch                          // ○ auto-off
  const isActive   = oriMatch && pt.enabled !== false   // ● active

  const W = profileOrientation === 'landscape' ? 120 : 84
  const H = profileOrientation === 'landscape' ? 84  : 120

  // Border/opacity per state
  const border  = isActive ? '2px solid var(--border)'
                : manualOff ? '2px dashed #844'
                : '2px dashed #555'
  const opacity = isActive ? 1 : 0.38

  // Toggle button appearance
  const toggleIcon  = isActive ? '●' : manualOff ? '✗' : '○'
  const toggleColor = isActive ? '#8f8' : manualOff ? '#f66' : '#666'
  const toggleTitle = isActive   ? 'Disattiva manualmente (escludi da auto-layout)'
                    : manualOff  ? 'Riattiva'
                    : `Auto-disattivato — orientamento ${ptOri === 'portrait' ? 'verticale' : 'orizzontale'} non coincide col profilo`

  const btnBase = { width:18, height:18, background:'rgba(10,10,12,0.72)',
    border:'1px solid rgba(255,255,255,0.12)', borderRadius:3, cursor:'pointer',
    fontSize:9, display:'flex', alignItems:'center', justifyContent:'center' }

  return (
    <div style={{ position:'relative', userSelect:'none', opacity }}>
      <div
        onClick={onEdit}
        title={`${pt.label} — clicca per modificare`}
        style={{ cursor:'pointer', borderRadius:6, overflow:'hidden',
          border, background:'var(--bg3)', transition:'border-color 0.15s' }}
        onMouseEnter={e=>{ if(isActive) e.currentTarget.style.borderColor='var(--gold)' }}
        onMouseLeave={e=>e.currentTarget.style.borderColor=isActive?'var(--border)':manualOff?'#844':'#555'}>
        <svg width={W} height={H} style={{ display:'block', background:'#e9e5dd' }}>
          {pt.slots.map((s,i) => {
            const x=(s.x/100)*W, y=(s.y/100)*H, w=(s.w/100)*W, h=(s.h/100)*H
            const sc = slotColor(i)
            return (
              <g key={i}>
                <rect x={x+1.5} y={y+1.5} width={w-3} height={h-3}
                  fill={sc.thumb} stroke={sc.thumbStroke}
                  strokeWidth={1} strokeDasharray={s.slot_type==='caption'?'3,2':'4,2.5'} rx={1}/>
                {w>20&&h>14&&(
                  <text x={x+w/2} y={y+h/2+3.5} textAnchor="middle"
                    fontSize={Math.min(10,Math.max(6,Math.min(w,h)*0.28))}
                    fill={sc.thumbStroke} fontFamily="monospace">
                    {s.slot_type==='caption'?'T':i+1}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <div style={{ padding:'3px 6px', fontSize:10, fontFamily:'var(--font-mono)',
          color:'var(--text2)', borderTop:'1px solid var(--border)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          textDecoration: manualOff ? 'line-through' : 'none' }}>
          {pt.label}
          {ptOri !== 'any' && (
            <span style={{ marginLeft:4, fontSize:8,
              color: oriMatch ? '#8a8' : '#a66',
              background:'var(--bg2)', borderRadius:3, padding:'0 3px' }}>
              {ptOri === 'portrait' ? '▯' : '▭'}
            </span>
          )}
        </div>
      </div>
      <div style={{ position:'absolute', top:3, right:3, display:'flex', gap:2 }}>
        <button onClick={e=>{e.stopPropagation();onEdit()}}
          style={{...btnBase,color:'#ddd'}} title="Modifica">✏</button>
        <button onClick={e=>{e.stopPropagation();onDuplicate()}}
          style={{...btnBase,color:'#adf'}} title="Duplica">⧉</button>
        <button onClick={e=>{e.stopPropagation(); if(!autoOff) onToggle()}}
          style={{...btnBase, color:toggleColor, cursor:autoOff?'default':'pointer',
            opacity:autoOff?0.5:1}} title={toggleTitle}>
          {toggleIcon}
        </button>
        <button onClick={e=>{e.stopPropagation();onDelete()}}
          style={{...btnBase,color:'#f88'}} title="Elimina">✕</button>
      </div>
    </div>
  )
}

// ── Slot Editor Modal ─────────────────────────────────────────────────────────
function SlotEditorModal({ initSlots, initLabel, initPtOrientation='portrait', landscape, onSave, onCancel }) {
  const canvasW = landscape ? CH : CW
  const canvasH = landscape ? CW : CH

  const [slots,   setSlots]   = useState(() => initSlots.map(s=>({...s})))
  const [label,   setLabel]   = useState(initLabel)
  const [ptOri,   setPtOri]   = useState(initPtOrientation)
  const [magnet, setMagnet] = useState(true)
  const [hover,  setHover]  = useState(null)   // {si, edge} | null
  const [n,      setN]      = useState(initSlots.length)
  const [tableDragIdx,  setTableDragIdx]  = useState(null)
  const [tableDragOver, setTableDragOver] = useState(null)

  const svgRef  = useRef(null)
  const dragRef = useRef(null)  // {si, edge|'move', startX, startY, snapshot, sr}

  const GRAB_W = 14   // px grab zone width
  const PILL   = 5    // px pill half-size

  // Snap ai bordi vicini
  const snap = useCallback((val, others) => {
    if (!magnet) return val
    for (const c of others) if (Math.abs(val - c) < SNAP_DIST) return c
    return val
  }, [magnet])

  // Applica magnete a un singolo slot dopo drag
  const applySnap = useCallback((ns, si) => {
    if (!magnet) return ns
    const s = {...ns[si]}
    const oth = ns.flatMap((o,j) => j===si ? [] : [o.x, o.x+o.w, o.y, o.y+o.h, 0, 100])
    const L = snap(s.x,       [...oth])
    const R = snap(s.x + s.w, [...oth])
    const T = snap(s.y,       [...oth])
    const B = snap(s.y + s.h, [...oth])
    if (R - L >= MIN_SIZE) { s.x = parseFloat(L.toFixed(2)); s.w = parseFloat((R-L).toFixed(2)) }
    if (B - T >= MIN_SIZE) { s.y = parseFloat(T.toFixed(2)); s.h = parseFloat((B-T).toFixed(2)) }
    return ns.map((o,j) => j===si ? s : o)
  }, [magnet, snap])

  // Avvia drag su un bordo di uno slot
  const startDrag = (e, si, edge) => {
    e.preventDefault()
    e.stopPropagation()
    const sr = svgRef.current.getBoundingClientRect()
    dragRef.current = {
      si, edge,
      startX: e.clientX, startY: e.clientY,
      sr,
      snapshot: slots.map(s=>({...s})),
    }

    const onMove = (me) => {
      const d = dragRef.current
      if (!d) return
      const dx = ((me.clientX - d.startX) / d.sr.width)  * 100
      const dy = ((me.clientY - d.startY) / d.sr.height) * 100
      const s  = {...d.snapshot[d.si]}

      if (d.edge === 'left') {
        const newX = clamp(s.x + dx, 0, s.x + s.w - MIN_SIZE)
        s.w = parseFloat((s.w - (newX - s.x)).toFixed(2))
        s.x = parseFloat(newX.toFixed(2))
      } else if (d.edge === 'right') {
        const newR = clamp(s.x + s.w + dx, s.x + MIN_SIZE, 100)
        s.w = parseFloat((newR - s.x).toFixed(2))
      } else if (d.edge === 'top') {
        const newY = clamp(s.y + dy, 0, s.y + s.h - MIN_SIZE)
        s.h = parseFloat((s.h - (newY - s.y)).toFixed(2))
        s.y = parseFloat(newY.toFixed(2))
      } else {  // bottom
        const newB = clamp(s.y + s.h + dy, s.y + MIN_SIZE, 100)
        s.h = parseFloat((newB - s.y).toFixed(2))
      }
      setSlots(prev => prev.map((o,j) => j===d.si ? s : o))
    }

    const onUp = () => {
      const d = dragRef.current
      if (d) setSlots(prev => applySnap(prev, d.si))
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Avvia drag per spostare uno slot (interno)
  const startMoveDrag = (e, si) => {
    e.preventDefault()
    e.stopPropagation()
    const sr = svgRef.current.getBoundingClientRect()
    dragRef.current = {
      si, edge: 'move',
      startX: e.clientX, startY: e.clientY,
      sr,
      snapshot: slots.map(s => ({...s})),
    }

    const onMove = (me) => {
      const d = dragRef.current
      if (!d || d.edge !== 'move') return
      const dx = ((me.clientX - d.startX) / d.sr.width)  * 100
      const dy = ((me.clientY - d.startY) / d.sr.height) * 100
      const snap0 = d.snapshot[d.si]
      const s = {
        ...snap0,
        x: parseFloat(clamp(snap0.x + dx, 0, 100 - snap0.w).toFixed(2)),
        y: parseFloat(clamp(snap0.y + dy, 0, 100 - snap0.h).toFixed(2)),
      }
      setSlots(prev => prev.map((o,j) => j===d.si ? s : o))
    }

    const onUp = () => {
      const d = dragRef.current
      if (d) setSlots(prev => applySnap(prev, d.si))
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Handle descriptor: returns SVG rect props for grab zone + visual bar + pill
  const makeHandle = (si, edge, s) => {
    const isHov = hover?.si===si && hover?.edge===edge
    const isDrag = dragRef.current?.si===si && dragRef.current?.edge===edge
    const active = isHov || isDrag
    const sx=(s.x/100)*canvasW, sy=(s.y/100)*canvasH
    const sw=(s.w/100)*canvasW, sh=(s.h/100)*canvasH

    let grab, bar, pill, cursor
    if (edge === 'left') {
      cursor = 'col-resize'
      grab   = { x:sx - GRAB_W/2, y:sy,       w:GRAB_W, h:sh }
      bar    = { x:sx - 1.5,      y:sy + 6,   w:3,      h:sh - 12 }
      pill   = { x:sx - PILL,     y:sy+sh/2 - PILL*2, w:PILL*2, h:PILL*4 }
    } else if (edge === 'right') {
      cursor = 'col-resize'
      grab   = { x:sx+sw - GRAB_W/2, y:sy,       w:GRAB_W, h:sh }
      bar    = { x:sx+sw - 1.5,      y:sy + 6,   w:3,      h:sh - 12 }
      pill   = { x:sx+sw - PILL,     y:sy+sh/2 - PILL*2, w:PILL*2, h:PILL*4 }
    } else if (edge === 'top') {
      cursor = 'row-resize'
      grab   = { x:sx,       y:sy - GRAB_W/2, w:sw, h:GRAB_W }
      bar    = { x:sx + 6,   y:sy - 1.5,      w:sw - 12, h:3 }
      pill   = { x:sx+sw/2 - PILL*2, y:sy - PILL, w:PILL*4, h:PILL*2 }
    } else {  // bottom
      cursor = 'row-resize'
      grab   = { x:sx,       y:sy+sh - GRAB_W/2, w:sw, h:GRAB_W }
      bar    = { x:sx + 6,   y:sy+sh - 1.5,      w:sw - 12, h:3 }
      pill   = { x:sx+sw/2 - PILL*2, y:sy+sh - PILL, w:PILL*4, h:PILL*2 }
    }

    const barColor  = active ? '#ffdd44' : 'rgba(212,170,90,0.75)'
    const pillColor = active ? '#ffdd44' : 'var(--gold)'

    return (
      <g key={`${si}-${edge}`}>
        {/* Grab zone (invisible, wide) */}
        <rect
          x={grab.x} y={grab.y} width={grab.w} height={grab.h}
          fill="transparent"
          style={{ cursor }}
          onMouseDown={e => startDrag(e, si, edge)}
          onMouseEnter={() => setHover({si, edge})}
          onMouseLeave={() => setHover(null)}/>
        {/* Visual bar */}
        <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h}
          fill={barColor} rx={1.5} style={{ pointerEvents:'none' }}/>
        {/* Pill */}
        <rect x={pill.x} y={pill.y} width={pill.w} height={pill.h}
          fill={pillColor} rx={Math.min(pill.w, pill.h)/2}
          style={{ pointerEvents:'none' }}/>
      </g>
    )
  }

  const handleSetN = (v) => {
    const clamped = Math.max(1, Math.min(12, v))
    setN(clamped)
    setSlots(makeGrid(clamped))
  }



  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', zIndex:9000,
      display:'flex', alignItems:'center', justifyContent:'center',
    }} onClick={e=>e.target===e.currentTarget && onCancel()}>
      <div style={{
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:12, boxShadow:'0 28px 88px rgba(0,0,0,0.72)',
        width: Math.min(860, window.innerWidth - 40),
        maxHeight:'94vh', display:'flex', flexDirection:'column', overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{ padding:'16px 24px 12px', borderBottom:'1px solid var(--border)',
          background:'var(--bg3)', display:'flex', justifyContent:'space-between',
          alignItems:'center', flexShrink:0 }}>
          <div>
            <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:20, marginBottom:2 }}>
              ✏ Editor layout
            </h3>
            <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
              Trascina interno → sposta slot · bordi dorati → ridimensiona · magnete avvicina al rilascio
            </p>
          </div>
          <button onClick={onCancel}
            style={{ background:'none',border:'none',color:'var(--text3)',fontSize:22,cursor:'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:24,
          display:'flex', gap:28, flexWrap:'wrap', alignItems:'flex-start' }}>

          {/* ── Controls ── */}
          <div style={{ minWidth:210, display:'flex', flexDirection:'column', gap:14 }}>

            <div className="form-group">
              <label className="form-label">Nome layout</label>
              <input className="form-input" value={label}
                onChange={e=>setLabel(e.target.value)}
                placeholder="es. Ritratto + striscia"/>
            </div>

            <div className="form-group">
              <label className="form-label">Formato pagina</label>
              <select className="form-select" value={ptOri} onChange={e=>setPtOri(e.target.value)}>
                <option value="portrait">▯ Verticale</option>
                <option value="landscape">▭ Orizzontale</option>
              </select>
              <p style={{fontSize:10,color:'var(--text3)',marginTop:3}}>
                Layout visibile e usato solo nei profili con orientamento concorde.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Numero slot — clicca per ridistribuire in griglia</label>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {[1,2,3,4,5,6,8,9,12].map(v=>(
                  <button key={v} onClick={()=>handleSetN(v)}
                    style={{
                      width:34, height:34, borderRadius:5, fontSize:13, fontWeight:600,
                      cursor:'pointer',
                      border:`1px solid ${n===v?'var(--gold)':'var(--border)'}`,
                      background: n===v ? 'var(--gold-dim)' : 'var(--bg3)',
                      color: n===v ? 'var(--gold)' : 'var(--text2)',
                    }}>{v}</button>
                ))}
              </div>
            </div>

            {/* Magnet toggle */}
            <div
              onClick={()=>setMagnet(m=>!m)}
              style={{
                padding:'10px 14px', borderRadius:7, cursor:'pointer',
                border:`1px solid ${magnet?'rgba(212,170,90,0.4)':'var(--border)'}`,
                background: magnet?'rgba(212,170,90,0.08)':'var(--bg3)',
                display:'flex', alignItems:'center', gap:10,
              }}>
              <span style={{ fontSize:20 }}>{magnet ? '🧲' : '⬜'}</span>
              <div>
                <p style={{ fontSize:12, fontWeight:600,
                  color: magnet?'var(--gold)':'var(--text2)' }}>
                  Magnete {magnet?'attivo':'disattivo'}
                </p>
                <p style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>
                  {magnet
                    ? `Snap entro ${SNAP_DIST}% al rilascio`
                    : 'Bordi liberi: puoi sovrapporre o lasciare spazi'}
                </p>
              </div>
            </div>

            {/* Slot coords table */}
            <div style={{ background:'var(--bg3)', borderRadius:6,
              border:'1px solid var(--border)', padding:'8px 10px' }}>
              <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', marginBottom:6 }}>
                Coordinate slot (%) · z-index = ordine:
              </p>
              <table style={{ borderCollapse:'collapse', fontSize:10, fontFamily:'var(--font-mono)', width:'100%' }}>
                <thead><tr style={{ color:'var(--text3)' }}>
                  {['','#','Tipo','X','Y','W','H'].map(h=>(
                    <th key={h} style={{ padding:'2px 4px', textAlign:'right', fontWeight:400 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {slots.map((s,i)=>(
                    <tr key={i}
                      draggable
                      onDragStart={() => setTableDragIdx(i)}
                      onDragOver={e => { e.preventDefault(); setTableDragOver(i) }}
                      onDrop={() => {
                        if (tableDragIdx !== null && tableDragIdx !== i) {
                          setSlots(prev => {
                            const next = [...prev]
                            const [moved] = next.splice(tableDragIdx, 1)
                            next.splice(i, 0, moved)
                            return next
                          })
                        }
                        setTableDragIdx(null); setTableDragOver(null)
                      }}
                      onDragEnd={() => { setTableDragIdx(null); setTableDragOver(null) }}
                      style={{
                        borderTop:'1px solid var(--border)', color:'var(--text2)',
                        background: tableDragOver === i && tableDragIdx !== i
                          ? 'rgba(74,197,133,0.12)'
                          : slotColor(i).tableBg,
                        cursor:'grab',
                      }}>
                      <td style={{ padding:'2px 3px', color:'var(--text3)', textAlign:'center', userSelect:'none' }}>⠿</td>
                      <td style={{ padding:'2px 4px', color:'var(--gold)', textAlign:'right' }}>{i+1}</td>
                      <td style={{ padding:'2px 4px', textAlign:'center' }}>
                        <button
                          onClick={()=>setSlots(ss=>ss.map((sl,si)=>si===i?{...sl,slot_type:sl.slot_type==='caption'?'photo':'caption'}:sl))}
                          title={s.slot_type==='caption'?'Slot didascalia (clicca per foto)':'Slot foto (clicca per didascalia)'}
                          style={{fontSize:10,padding:'1px 4px',borderRadius:3,cursor:'pointer',border:'1px solid',
                            borderColor:s.slot_type==='caption'?'#7eb8d4':'var(--border)',
                            background:s.slot_type==='caption'?'rgba(126,184,212,0.15)':'var(--bg3)',
                            color:s.slot_type==='caption'?'#7eb8d4':'var(--text3)'}}>
                          {s.slot_type==='caption'?'T':'📷'}
                        </button>
                      </td>
                      {[s.x,s.y,s.w,s.h].map((v,j)=>(
                        <td key={j} style={{ padding:'2px 4px', textAlign:'right' }}>{v.toFixed(1)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize:9, color:'var(--text3)', fontFamily:'var(--font-mono)', marginTop:6 }}>
                {slots.length} slot · {slots.filter(s=>s.h>s.w).length} vert · {slots.filter(s=>s.w>=s.h).length} orizz · {slots.filter(s=>s.slot_type==='caption').length} T
              </p>
              <p style={{ fontSize:9, color:'#7eb8d4', marginTop:4 }}>
                📷 = slot foto &nbsp;·&nbsp; T = slot didascalia
              </p>
              <p style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>
                ⠿ Trascina righe per riordinare · primo = sotto, ultimo = sopra (z-index)
              </p>
            </div>
          </div>

          {/* ── Canvas ── */}
          <div>
            <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', marginBottom:8 }}>
              Trascina i bordi dorati per ridimensionare:
            </p>
            <svg
              ref={svgRef}
              width={canvasW} height={canvasH}
              style={{ display:'block', background:'#ede9e0', borderRadius:4,
                border:'1px solid var(--border)', userSelect:'none',
                boxShadow:'0 4px 20px rgba(0,0,0,0.22)', maxWidth:'100%' }}>

              {/* Slot bodies */}
              {slots.map((s,i) => {
                const sx=(s.x/100)*canvasW, sy=(s.y/100)*canvasH
                const sw=(s.w/100)*canvasW, sh=(s.h/100)*canvasH
                const isP = s.h > s.w
                const isA = dragRef.current?.si===i
                return (
                  <g key={i}
  >
                    {(()=>{
                      const isCaption = s.slot_type === 'caption'
                      const sc = slotColor(i)
                      const fillBase = sc.fill
                      const fillAct  = sc.fillAct
                      const strokeB  = sc.stroke
                      const strokeA  = sc.strokeAct
                      const innerW = Math.max(0, sw - GRAB_W*2)
                      const innerH = Math.max(0, sh - GRAB_W*2)
                      return (<>
                        <rect x={sx+0.5} y={sy+0.5} width={sw-1} height={sh-1}
                          fill={isA?fillAct:fillBase}
                          stroke={isA?strokeA:strokeB}
                          strokeWidth={isA?1.5:1} strokeDasharray={isA?'none':'8,5'} rx={1}/>
                        {sw>30&&sh>20&&(
                          <text x={sx+sw/2} y={sy+sh/2+(isCaption?2:5)} textAnchor="middle"
                            fontSize={Math.min(18,Math.max(8,Math.min(sw,sh)*0.22))}
                            fill={isA ? sc.strokeAct : sc.thumbStroke} fontFamily="monospace">
                            {isCaption ? 'T' : i+1}
                          </text>
                        )}
                        {sw>50&&sh>30&&(
                          <text x={sx+sw/2} y={sy+sh/2+(isCaption?16:18)} textAnchor="middle"
                            fontSize={8} fill={sc.thumbStroke} fontFamily="monospace">
                            {isCaption ? 'didascalia' : `${(s.w/s.h).toFixed(2)} ${isP?'↕':'↔'}`}
                          </text>
                        )}
                        {/* Interior drag rect for slot move */}
                        {innerW > 4 && innerH > 4 && (
                          <rect
                            x={sx+GRAB_W} y={sy+GRAB_W}
                            width={innerW} height={innerH}
                            fill="transparent"
                            style={{ cursor:'move' }}
                            onMouseDown={e => startMoveDrag(e, i)}
                          />
                        )}
                      </>)
                    })()}
                  </g>
                )
              })}

              {/* Per-slot handles (drawn after slots so they're on top) */}
              {slots.map((s,i) =>
                ['top','right','bottom','left'].map(edge => makeHandle(i, edge, s))
              )}

            </svg>
            <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', marginTop:6 }}>
              Trascina interno → sposta · bordi dorati → ridimensiona · bordi indipendenti
            </p>


            
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)',
          background:'var(--bg3)', display:'flex', justifyContent:'space-between',
          alignItems:'center', flexShrink:0 }}>
          <p style={{ fontSize:11, color:'var(--text3)' }}>
            {slots.length} slot · {label || '(senza nome)'}
          </p>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn" onClick={onCancel}>Annulla</button>
            <button className="btn btn-primary"
              onClick={()=>onSave(label.trim()||autoNameSlots(slots, ptOri), slots.map(s=>({...s})), ptOri)}>
              ✓ Salva layout
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main PageTypeEditor ────────────────────────────────────────────────────────
export default function PageTypeEditor({ pageTypes: initPTs, onChange, orientation='portrait' }) {
  const landscape = orientation === 'landscape'

  const [pts, setPts] = useState(() => {
    if (initPTs && initPTs.length > 0)
      return initPTs.map(pt=>({ ...pt, slots: pt.slots.map(s=>({...s})) }))
    const defs = landscape ? DEFAULTS_LANDSCAPE : DEFAULTS_PORTRAIT
    return defs.map(d=>({ id:uid(), label:d.label, slots:d.slots.map(s=>({...s})) }))
  })

  // null | { mode:'new'|'edit', idx:number|null }
  const [editor, setEditor] = useState(null)

  const profileOrientation = orientation === 'landscape' ? 'landscape' : 'portrait'

  // Filters
  const [filterType,        setFilterType]        = useState('all')         // 'all'|'photo'|'caption'
  const [filterCount,       setFilterCount]       = useState('all')         // 'all'|'1'|'2'|'3'|'4'|'5+'
  const [filterStatus,      setFilterStatus]      = useState('active')      // 'all'|'active'|'manual-off'|'auto-off'
  const [filterOrientation, setFilterOrientation] = useState(profileOrientation) // 'all'|'portrait'|'landscape'

  // Auto-update orientation filter when profile orientation changes
  useEffect(() => {
    setFilterOrientation(profileOrientation)
  }, [orientation])

  const commit = (newPts) => { setPts(newPts); onChange(newPts) }

  const openNew  = () => setEditor({ mode:'new', idx:null })
  const openEdit = (i) => setEditor({ mode:'edit', idx:i })
  const close    = () => setEditor(null)

  const save = (label, slots, ptOri='any') => {
    if (editor.mode === 'new') {
      const newPT = { id:uid(), label, slots, enabled:true, orientation: ptOri }
      commit([...pts, newPT])
    } else {
      commit(pts.map((pt,i) => i===editor.idx ? {...pt, label, slots, orientation: ptOri} : pt))
    }
    close()
  }

  const remove = (idx) => {
    if (!confirm(`Eliminare "${pts[idx].label}"?`)) return
    commit(pts.filter((_,i)=>i!==idx))
  }

  const duplicate = (idx) => {
    const src = pts[idx]
    const copy = { ...src, id:uid(), label:`${src.label} (copia)`,
      slots: src.slots.map(s=>({...s})), enabled: src.enabled !== false }
    const next = [...pts]
    next.splice(idx + 1, 0, copy)
    commit(next)
  }

  const toggleEnabled = (idx) => {
    commit(pts.map((pt,i) => i===idx ? {...pt, enabled: !(pt.enabled !== false)} : pt))
  }

  const editingPT = editor?.mode==='edit' && editor.idx!=null ? pts[editor.idx] : null

  // Compute status helpers for each pt
  const ptStatus = (pt) => {
    const ptOri    = pt.orientation || 'any'
    const oriMatch = ptOri === 'any' || ptOri === profileOrientation
    if (!oriMatch)               return 'auto-off'
    if (pt.enabled === false)    return 'manual-off'
    return 'active'
  }

  // Apply filters (filter → visible list with original index)
  const visible = pts.map((pt,i)=>({pt,i})).filter(({pt}) => {
    const nCap   = pt.slots.filter(s=>s.slot_type==='caption').length
    const nPhoto = pt.slots.length - nCap
    const ptOri  = pt.orientation || 'any'
    const status = ptStatus(pt)
    if (filterType === 'photo'   && nCap > 0)  return false
    if (filterType === 'caption' && nCap === 0) return false
    if (filterCount !== 'all') {
      if (filterCount === '5+' ? nPhoto < 5 : nPhoto !== parseInt(filterCount)) return false
    }
    if (filterStatus !== 'all' && status !== filterStatus) return false
    if (filterOrientation !== 'all') {
      if (filterOrientation === 'portrait'  && ptOri === 'landscape') return false
      if (filterOrientation === 'landscape' && ptOri === 'portrait')  return false
    }
    return true
  })

  const chipStyle = (active) => ({
    padding:'2px 8px', borderRadius:10, fontSize:10, cursor:'pointer',
    border:`1px solid ${active?'var(--gold)':'var(--border)'}`,
    background: active?'rgba(212,170,90,0.15)':'var(--bg3)',
    color: active?'var(--gold)':'var(--text3)'
  })

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <p style={{ fontSize:11, color:'var(--text3)', flex:1 }}>
          {visible.length}/{pts.length} layout
          {(() => {
            const nAuto   = pts.filter(p=>ptStatus(p)==='auto-off').length
            const nManual = pts.filter(p=>ptStatus(p)==='manual-off').length
            return (<>
              {nAuto   > 0 && <span style={{color:'#888',marginLeft:6}}>· {nAuto} auto-off ○</span>}
              {nManual > 0 && <span style={{color:'#f66',marginLeft:6}}>· {nManual} disattivati ✗</span>}
            </>)
          })()}
        </p>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ Nuovo layout</button>
      </div>

      {/* Filter bar */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12,
        padding:'8px 10px', background:'var(--bg2)', borderRadius:7,
        border:'1px solid var(--border)' }}>
        <span style={{fontSize:10,color:'var(--text3)',alignSelf:'center',marginRight:2}}>Formato:</span>
        {[['all','Tutti'],['portrait','▯ Verticale'],['landscape','▭ Orizzontale']].map(([v,l])=>(
          <button key={v} style={chipStyle(filterOrientation===v)} onClick={()=>setFilterOrientation(v)}>{l}</button>
        ))}
        <span style={{fontSize:10,color:'var(--text3)',alignSelf:'center',marginLeft:6,marginRight:2}}>Stato:</span>
        {[['all','Tutti'],['active','● Attivi'],['manual-off','✗ Disattivati'],['auto-off','○ Auto-off']].map(([v,l])=>(
          <button key={v} style={chipStyle(filterStatus===v)} onClick={()=>setFilterStatus(v)}>{l}</button>
        ))}
        <span style={{fontSize:10,color:'var(--text3)',alignSelf:'center',marginLeft:6,marginRight:2}}>Tipo:</span>
        {[['all','Tutti'],['photo','Solo foto'],['caption','Con didascalie']].map(([v,l])=>(
          <button key={v} style={chipStyle(filterType===v)} onClick={()=>setFilterType(v)}>{l}</button>
        ))}
        <span style={{fontSize:10,color:'var(--text3)',alignSelf:'center',marginLeft:6,marginRight:2}}>Foto:</span>
        {['all','1','2','3','4','5+'].map(v=>(
          <button key={v} style={chipStyle(filterCount===v)} onClick={()=>setFilterCount(v)}>{v==='all'?'Tutti':v}</button>
        ))}
      </div>

      {/* Grid of thumbnails */}
      {visible.length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text3)', fontSize:13,
          border:'2px dashed var(--border)', borderRadius:8, lineHeight:1.9 }}>
          {pts.length === 0 ? <>Nessun layout.<br/><span style={{fontSize:12}}>Clicca <strong>+ Nuovo layout</strong>.</span></>
            : 'Nessun layout corrisponde ai filtri.'}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(128px, 1fr))', gap:10 }}>
          {visible.map(({pt,i}) => (
            <LayoutThumb key={pt.id} pt={pt} profileOrientation={profileOrientation}
              onEdit={()=>openEdit(i)} onDelete={()=>remove(i)}
              onDuplicate={()=>duplicate(i)} onToggle={()=>toggleEnabled(i)}/>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editor && (
        <SlotEditorModal
          key={editor.mode + (editor.idx ?? 'new')}
          initSlots={editingPT ? editingPT.slots.map(s=>({...s})) : makeGrid(2)}
          initLabel={editingPT ? editingPT.label : ''}
          initPtOrientation={editingPT ? (editingPT.orientation || profileOrientation) : profileOrientation}
          landscape={landscape}
          onSave={save}
          onCancel={close}/>
      )}
    </div>
  )
}
