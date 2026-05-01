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

import { useState, useRef, useCallback } from 'react'

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

// ── Miniatura ─────────────────────────────────────────────────────────────────
function LayoutThumb({ pt, landscape, onEdit, onDelete }) {
  const W = landscape ? 120 : 84
  const H = landscape ? 84  : 120
  return (
    <div style={{ position:'relative', userSelect:'none' }}>
      <div
        onClick={onEdit}
        title={`${pt.label} — clicca per modificare`}
        style={{ cursor:'pointer', borderRadius:6, overflow:'hidden',
          border:'2px solid var(--border)', background:'var(--bg3)',
          transition:'border-color 0.15s',
        }}
        onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
        onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
        <svg width={W} height={H} style={{ display:'block', background:'#e9e5dd' }}>
          {pt.slots.map((s,i) => {
            const x=(s.x/100)*W, y=(s.y/100)*H, w=(s.w/100)*W, h=(s.h/100)*H
            return (
              <g key={i}>
                <rect x={x+1.5} y={y+1.5} width={w-3} height={h-3}
                  fill={s.slot_type==='caption'?'rgba(100,160,200,0.18)':'rgba(155,150,140,0.25)'}
                  stroke={s.slot_type==='caption'?'#7eb8d4':'#a8a49c'}
                  strokeWidth={1} strokeDasharray={s.slot_type==='caption'?'3,2':'4,2.5'} rx={1}/>
                {w>20&&h>14&&(
                  <text x={x+w/2} y={y+h/2+3.5} textAnchor="middle"
                    fontSize={Math.min(10,Math.max(6,Math.min(w,h)*0.28))}
                    fill={s.slot_type==='caption'?'#7eb8d4':'#aaa'} fontFamily="monospace">
                    {s.slot_type==='caption'?'T':i+1}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <div style={{ padding:'3px 6px', fontSize:10, fontFamily:'var(--font-mono)',
          color:'var(--text2)', borderTop:'1px solid var(--border)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {pt.label}
        </div>
      </div>
      <div style={{ position:'absolute', top:3, right:3, display:'flex', gap:3 }}>
        <button onClick={e=>{e.stopPropagation();onEdit()}}
          style={{ width:18,height:18,background:'rgba(10,10,12,0.72)',
            border:'1px solid rgba(255,255,255,0.12)',borderRadius:3,cursor:'pointer',
            fontSize:9,color:'#ddd',display:'flex',alignItems:'center',justifyContent:'center' }}>✏</button>
        <button onClick={e=>{e.stopPropagation();onDelete()}}
          style={{ width:18,height:18,background:'rgba(10,10,12,0.72)',
            border:'1px solid rgba(255,255,255,0.12)',borderRadius:3,cursor:'pointer',
            fontSize:10,color:'#f88',display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>
      </div>
    </div>
  )
}

// ── Slot Editor Modal ─────────────────────────────────────────────────────────
function SlotEditorModal({ initSlots, initLabel, landscape, onSave, onCancel }) {
  const canvasW = landscape ? CH : CW
  const canvasH = landscape ? CW : CH

  const [slots,  setSlots]  = useState(() => initSlots.map(s=>({...s})))
  const [label,  setLabel]  = useState(initLabel)
  const [pref,   setPref]   = useState('any')
  const [magnet, setMagnet] = useState(true)
  const [hover,  setHover]  = useState(null)   // {si, edge} | null
  const [n,      setN]      = useState(initSlots.length)

  const svgRef  = useRef(null)
  const dragRef = useRef(null)  // {si, edge, startX, startY, snapshot, sr}

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
              Trascina i bordi dorati · ogni slot è indipendente · il magnete avvicina i bordi al rilascio
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
              <label className="form-label">Orientamento preferito</label>
              <select className="form-select" value={pref} onChange={e=>setPref(e.target.value)}>
                <option value="any">Misto (qualsiasi)</option>
                <option value="portrait">Verticale (ritratto)</option>
                <option value="landscape">Orizzontale (paesaggio)</option>
              </select>
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
                Coordinate slot (%):
              </p>
              <table style={{ borderCollapse:'collapse', fontSize:10, fontFamily:'var(--font-mono)', width:'100%' }}>
                <thead><tr style={{ color:'var(--text3)' }}>
                  {['#','Tipo','X','Y','W','H'].map(h=>(
                    <th key={h} style={{ padding:'2px 5px', textAlign:'right', fontWeight:400 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {slots.map((s,i)=>(
                    <tr key={i} style={{ borderTop:'1px solid var(--border)', color:'var(--text2)' }}>
                      <td style={{ padding:'2px 5px', color:'var(--gold)', textAlign:'right' }}>{i+1}</td>
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
                        <td key={j} style={{ padding:'2px 5px', textAlign:'right' }}>{v.toFixed(1)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize:9, color:'var(--text3)', fontFamily:'var(--font-mono)', marginTop:6 }}>
                {slots.length} slot · {slots.filter(s=>s.h>s.w).length} vert · {slots.filter(s=>s.w>=s.h).length} orizz · {slots.filter(s=>s.slot_type==='caption').length} T
              </p>
              <p style={{ fontSize:9, color:'#7eb8d4', marginTop:4 }}>
                📷 = slot foto &nbsp;·&nbsp; T = slot didascalia (usato solo con foto con descrizione)
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
                      const fillBase = isCaption ? 'rgba(100,160,200,0.10)' : 'rgba(212,170,90,0.04)'
                      const fillAct  = isCaption ? 'rgba(100,160,200,0.22)' : 'rgba(212,170,90,0.10)'
                      const strokeB  = isCaption ? 'rgba(100,160,200,0.7)'  : 'rgba(212,170,90,0.45)'
                      const strokeA  = isCaption ? 'rgba(100,160,200,1.0)'  : 'rgba(212,170,90,0.9)'
                      return (<>
                        <rect x={sx+0.5} y={sy+0.5} width={sw-1} height={sh-1}
                          fill={isA?fillAct:fillBase}
                          stroke={isA?strokeA:strokeB}
                          strokeWidth={isA?1.5:1} strokeDasharray={isA?'none':'8,5'} rx={1}/>
                        {sw>30&&sh>20&&(
                          <text x={sx+sw/2} y={sy+sh/2+(isCaption?2:5)} textAnchor="middle"
                            fontSize={Math.min(18,Math.max(8,Math.min(sw,sh)*0.22))}
                            fill={isA?(isCaption?'rgba(100,160,200,0.9)':'rgba(212,170,90,0.7)'):(isCaption?'#7eb8d4':'#bbb')} fontFamily="monospace">
                            {isCaption ? 'T' : i+1}
                          </text>
                        )}
                        {sw>50&&sh>30&&(
                          <text x={sx+sw/2} y={sy+sh/2+(isCaption?16:18)} textAnchor="middle"
                            fontSize={8} fill={isCaption?'#7eb8d4':'#aaa'} fontFamily="monospace">
                            {isCaption ? 'didascalia' : `${(s.w/s.h).toFixed(2)} ${isP?'↕':'↔'}`}
                          </text>
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
              Ogni bordo è indipendente — gli slot possono sovrapporsi o avere spazi
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
              onClick={()=>onSave(label.trim()||'Layout', pref, slots.map(s=>({...s})))}>
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
    return defs.map(d=>({ id:uid(), label:d.label, pref:'any', slots:d.slots.map(s=>({...s})) }))
  })

  // null | { mode:'new'|'edit', idx:number|null }
  const [editor, setEditor] = useState(null)

  const commit = (newPts) => { setPts(newPts); onChange(newPts) }

  const openNew  = () => setEditor({ mode:'new', idx:null })
  const openEdit = (i) => setEditor({ mode:'edit', idx:i })
  const close    = () => setEditor(null)

  const save = (label, pref, slots) => {
    if (editor.mode === 'new') {
      const newPT = { id:uid(), label, pref, slots }
      commit([...pts, newPT])
    } else {
      commit(pts.map((pt,i) => i===editor.idx ? {...pt, label, pref, slots} : pt))
    }
    close()
  }

  const remove = (idx) => {
    if (!confirm(`Eliminare "${pts[idx].label}"?`)) return
    commit(pts.filter((_,i)=>i!==idx))
  }

  const editingPT = editor?.mode==='edit' && editor.idx!=null ? pts[editor.idx] : null

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <p style={{ fontSize:11, color:'var(--text3)', flex:1 }}>
          {pts.length} layout — ✏ modifica · ✕ elimina · clicca la miniatura per modificare
        </p>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          + Nuovo layout
        </button>
      </div>

      {/* Grid of thumbnails */}
      {pts.length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text3)', fontSize:13,
          border:'2px dashed var(--border)', borderRadius:8, lineHeight:1.9 }}>
          Nessun layout.<br/>
          <span style={{ fontSize:12 }}>Clicca <strong>+ Nuovo layout</strong>.</span>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(128px, 1fr))', gap:10 }}>
          {pts.map((pt, i) => (
            <LayoutThumb key={pt.id} pt={pt} landscape={landscape}
              onEdit={()=>openEdit(i)} onDelete={()=>remove(i)}/>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editor && (
        <SlotEditorModal
          key={editor.mode + (editor.idx ?? 'new')}
          initSlots={editingPT ? editingPT.slots.map(s=>({...s})) : makeGrid(2)}
          initLabel={editingPT ? editingPT.label : ''}
          landscape={landscape}
          onSave={save}
          onCancel={close}/>
      )}
    </div>
  )
}
