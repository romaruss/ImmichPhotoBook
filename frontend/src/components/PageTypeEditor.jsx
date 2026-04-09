import { useState, useRef, useEffect, useCallback } from 'react'

const PREVIEW_W = 140
const PREVIEW_H = 196
const EDITOR_W  = 260
const EDITOR_H  = 364

// ── All presets ───────────────────────────────────────────────────────────────
const PRESETS = {
  '1f':  { label:'1 foto intera',          pref:'any',       slots:[{x:0,y:0,w:100,h:100}] },
  '1v':  { label:'1 ritratto (verticale)', pref:'portrait',  slots:[{x:20,y:0,w:60,h:100}] },
  '1h':  { label:'1 paesaggio (orizzont.)',pref:'landscape', slots:[{x:0,y:25,w:100,h:50}] },
  '1+c': { label:'Foto + didascalia',      pref:'any',       slots:[{x:0,y:0,w:100,h:72},{x:0,y:72,w:100,h:28}] },
  '2v':  { label:'2 foto (affiancate)',    pref:'portrait',  slots:[{x:0,y:0,w:50,h:100},{x:50,y:0,w:50,h:100}] },
  '2h':  { label:'2 foto (impilate)',      pref:'landscape', slots:[{x:0,y:0,w:100,h:50},{x:0,y:50,w:100,h:50}] },
  '2+c': { label:'2 foto + didascalia',   pref:'any',       slots:[{x:0,y:0,w:50,h:100},{x:50,y:0,w:50,h:72},{x:50,y:72,w:50,h:28}] },
  '3a':  { label:'3 foto (grande sopra)', pref:'any',       slots:[{x:0,y:0,w:100,h:55},{x:0,y:55,w:50,h:45},{x:50,y:55,w:50,h:45}] },
  '3b':  { label:'3 foto (grande sotto)', pref:'any',       slots:[{x:0,y:0,w:50,h:45},{x:50,y:0,w:50,h:45},{x:0,y:45,w:100,h:55}] },
  '3c':  { label:'3 verticali',           pref:'portrait',  slots:[{x:0,y:0,w:33.3,h:100},{x:33.3,y:0,w:33.4,h:100},{x:66.7,y:0,w:33.3,h:100}] },
  '4g':  { label:'4 foto griglia',        pref:'any',       slots:[{x:0,y:0,w:50,h:50},{x:50,y:0,w:50,h:50},{x:0,y:50,w:50,h:50},{x:50,y:50,w:50,h:50}] },
  '4a':  { label:'4 foto (1+3)',          pref:'any',       slots:[{x:0,y:0,w:60,h:100},{x:60,y:0,w:40,h:33.3},{x:60,y:33.3,w:40,h:33.4},{x:60,y:66.7,w:40,h:33.3}] },
  'pan': { label:'Panoramica',            pref:'landscape', slots:[{x:0,y:30,w:100,h:40}] },
  '6g':  { label:'6 foto griglia',        pref:'any',       slots:[{x:0,y:0,w:33.3,h:50},{x:33.3,y:0,w:33.4,h:50},{x:66.7,y:0,w:33.3,h:50},{x:0,y:50,w:33.3,h:50},{x:33.3,y:50,w:33.4,h:50},{x:66.7,y:50,w:33.3,h:50}] },
}

const PREF_COLORS = { portrait:'#6a8fd8', landscape:'#d8926a', any:'#8a8880' }
const PREF_LABELS = { portrait:'Verticale', landscape:'Orizzontale', any:'Misto' }

// ── Tiny read-only preview ────────────────────────────────────────────────────
function PagePreview({ slots, label, pref, selected, onSelect, onDelete }) {
  return (
    <div style={{ position:'relative' }}>
      <div onClick={onSelect} style={{
        cursor:'pointer', borderRadius:6, overflow:'hidden', background:'var(--bg3)',
        border:`2px solid ${selected?'var(--gold)':'var(--border)'}`,
        transition:'border-color 0.15s',
      }}>
        <svg width={PREVIEW_W} height={PREVIEW_H} style={{ display:'block', background:'#e8e4dc' }}>
          {slots.map((s,i) => {
            const x=(s.x/100)*PREVIEW_W, y=(s.y/100)*PREVIEW_H
            const w=(s.w/100)*PREVIEW_W, h=(s.h/100)*PREVIEW_H
            return (
              <g key={i}>
                <rect x={x+2} y={y+2} width={w-4} height={h-4}
                  fill={selected?'rgba(212,170,90,0.18)':'rgba(180,176,168,0.35)'}
                  stroke={selected?'rgba(212,170,90,0.7)':'#b0aca4'}
                  strokeWidth={1} strokeDasharray="5,3" rx={1}/>
                <text x={x+w/2} y={y+h/2+4} textAnchor="middle" fontSize={9} fill="#999">{i+1}</text>
              </g>
            )
          })}
        </svg>
        <div style={{
          padding:'4px 7px', fontSize:10, fontFamily:'var(--font-mono)',
          color:selected?'var(--gold)':'var(--text2)',
          borderTop:'1px solid var(--border)',
          background:selected?'var(--gold-dim)':'transparent',
          display:'flex', alignItems:'center', gap:5,
        }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:PREF_COLORS[pref||'any'], flexShrink:0, display:'inline-block' }}/>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{label}</span>
        </div>
      </div>
      <button onClick={e=>{e.stopPropagation();onDelete()}} style={{
        position:'absolute', top:4, right:4, width:18, height:18,
        background:'rgba(10,10,12,0.7)', border:'1px solid var(--border)', borderRadius:3,
        cursor:'pointer', fontSize:9, color:'var(--text3)', display:'flex',
        alignItems:'center', justifyContent:'center', zIndex:2,
      }}>✕</button>
    </div>
  )
}

// ── Drag-to-resize slot editor ────────────────────────────────────────────────
function LayoutEditor({ slots, onChange }) {
  const svgRef = useRef(null)
  const dragState = useRef(null)

  const EPS = 0.5
  const dividers = []
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j]
      if (Math.abs((a.y+a.h)-b.y)<EPS && Math.abs(a.x-b.x)<EPS && Math.abs(a.w-b.w)<EPS)
        dividers.push({ kind:'h', pct:a.y+a.h, topIdx:i, botIdx:j })
      if (Math.abs((a.x+a.w)-b.x)<EPS && Math.abs(a.y-b.y)<EPS && Math.abs(a.h-b.h)<EPS)
        dividers.push({ kind:'v', pct:a.x+a.w, leftIdx:i, rightIdx:j })
    }
  }

  const startDrag = useCallback((e, divider) => {
    e.preventDefault()
    const sr = svgRef.current.getBoundingClientRect()
    dragState.current = { divider, startX:e.clientX, startY:e.clientY, sr }

    const onMove = (me) => {
      if (!dragState.current) return
      const { divider:d, sr } = dragState.current
      const ns = slots.map(s=>({...s}))
      const MIN = 8

      if (d.kind==='h') {
        const dy = ((me.clientY-dragState.current.startY)/sr.height)*100
        const t=ns[d.topIdx], b=ns[d.botIdx]
        const cl = Math.max(-(t.h-MIN), Math.min(b.h-MIN, dy))
        t.h=parseFloat((t.h+cl).toFixed(2)); b.y=parseFloat((b.y+cl).toFixed(2)); b.h=parseFloat((b.h-cl).toFixed(2))
        dragState.current.startY=me.clientY
      } else {
        const dx = ((me.clientX-dragState.current.startX)/sr.width)*100
        const l=ns[d.leftIdx], r=ns[d.rightIdx]
        const cl = Math.max(-(l.w-MIN), Math.min(r.w-MIN, dx))
        l.w=parseFloat((l.w+cl).toFixed(2)); r.x=parseFloat((r.x+cl).toFixed(2)); r.w=parseFloat((r.w-cl).toFixed(2))
        dragState.current.startX=me.clientX
      }
      onChange(ns)
    }
    const onUp = () => { dragState.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
  }, [slots, onChange])

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:6, overflow:'hidden', display:'inline-block' }}>
      <svg ref={svgRef} width={EDITOR_W} height={EDITOR_H}
        style={{ display:'block', background:'#e8e4dc', userSelect:'none' }}>
        {slots.map((s,i)=>{
          const x=(s.x/100)*EDITOR_W, y=(s.y/100)*EDITOR_H
          const w=(s.w/100)*EDITOR_W, h=(s.h/100)*EDITOR_H
          return (
            <g key={i}>
              <rect x={x+3} y={y+3} width={w-6} height={h-6}
                fill="rgba(212,170,90,0.08)" stroke="rgba(212,170,90,0.45)"
                strokeWidth={1.5} strokeDasharray="6,4" rx={2}/>
              <text x={x+w/2} y={y+h/2+5} textAnchor="middle" fontSize={12} fill="#bbb">
                {w > 30 && h > 20 ? `Slot ${i+1}` : `${i+1}`}
              </text>
            </g>
          )
        })}
        {dividers.map((d,i)=>{
          if (d.kind==='h') {
            const yPx=(d.pct/100)*EDITOR_H
            return (
              <g key={i}>
                <rect x={0} y={yPx-7} width={EDITOR_W} height={14} fill="transparent"
                  style={{cursor:'row-resize'}} onMouseDown={e=>startDrag(e,d)}/>
                <line x1={4} y1={yPx} x2={EDITOR_W-4} y2={yPx}
                  stroke="rgba(212,170,90,0.9)" strokeWidth={2} style={{pointerEvents:'none'}}/>
                <circle cx={EDITOR_W/2} cy={yPx} r={5} fill="var(--gold)" style={{pointerEvents:'none'}}/>
              </g>
            )
          } else {
            const xPx=(d.pct/100)*EDITOR_W
            return (
              <g key={i}>
                <rect x={xPx-7} y={0} width={14} height={EDITOR_H} fill="transparent"
                  style={{cursor:'col-resize'}} onMouseDown={e=>startDrag(e,d)}/>
                <line x1={xPx} y1={4} x2={xPx} y2={EDITOR_H-4}
                  stroke="rgba(212,170,90,0.9)" strokeWidth={2} style={{pointerEvents:'none'}}/>
                <circle cx={xPx} cy={EDITOR_H/2} r={5} fill="var(--gold)" style={{pointerEvents:'none'}}/>
              </g>
            )
          }
        })}
      </svg>
      <div style={{ padding:'5px 10px', fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)',
        borderTop:'1px solid var(--border)', background:'var(--bg3)' }}>
        ⟷ Trascina i punti dorati per ridimensionare · Min 8%
      </div>
    </div>
  )
}

// ── Custom grid creator ───────────────────────────────────────────────────────
function CustomCreator({ onAdd }) {
  const [rows, setRows] = useState(2)
  const [cols, setCols] = useState(2)

  const create = () => {
    const slots = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slots.push({
          x: parseFloat(((c / cols) * 100).toFixed(2)),
          y: parseFloat(((r / rows) * 100).toFixed(2)),
          w: parseFloat((100 / cols).toFixed(2)),
          h: parseFloat((100 / rows).toFixed(2)),
        })
      }
    }
    onAdd(`${rows}×${cols} custom`, slots)
  }

  const previewSlots = []
  for (let r=0;r<rows;r++) for(let c=0;c<cols;c++)
    previewSlots.push({ x:(c/cols)*100, y:(r/rows)*100, w:100/cols, h:100/rows })

  return (
    <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:16, marginTop:8 }}>
      <p className="text-xs text-muted mb-3" style={{ fontFamily:'var(--font-mono)' }}>Griglia personalizzata</p>
      <div style={{ display:'flex', gap:20, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div>
            <label className="form-label">Righe</label>
            <input type="number" className="form-input" style={{ width:70 }}
              min={1} max={6} value={rows} onChange={e=>setRows(+e.target.value||1)}/>
          </div>
          <div style={{ marginTop:20, color:'var(--text3)', fontSize:18 }}>×</div>
          <div>
            <label className="form-label">Colonne</label>
            <input type="number" className="form-input" style={{ width:70 }}
              min={1} max={6} value={cols} onChange={e=>setCols(+e.target.value||1)}/>
          </div>
          <div style={{ marginTop:20 }}>
            <button className="btn btn-primary btn-sm" onClick={create}>+ Aggiungi</button>
          </div>
        </div>
        {/* Mini preview */}
        <svg width={80} height={112} style={{ background:'#e8e4dc', borderRadius:4, border:'1px solid var(--border)', flexShrink:0 }}>
          {previewSlots.map((s,i)=>(
            <rect key={i}
              x={(s.x/100)*80+2} y={(s.y/100)*112+2}
              width={(s.w/100)*80-4} height={(s.h/100)*112-4}
              fill="rgba(212,170,90,0.12)" stroke="rgba(212,170,90,0.5)" strokeWidth={1} strokeDasharray="4,3"/>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PageTypeEditor({ pageTypes: propPageTypes, onChange }) {
  // IMPORTANT: Use internal state to ensure immediate UI updates.
  // Sync from props only when the profile changes (not on every render).
  const [localPTs, setLocalPTs] = useState(propPageTypes || [])
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [showCustom, setShowCustom] = useState(false)
  const [filter, setFilter] = useState('all')

  // Sync from props when profile changes (prop reference changes deeply)
  const propRef = useRef(propPageTypes)
  useEffect(() => {
    if (propPageTypes !== propRef.current) {
      propRef.current = propPageTypes
      setLocalPTs(propPageTypes || [])
      setSelectedIdx(null)
    }
  }, [propPageTypes])

  const update = useCallback((newPTs) => {
    setLocalPTs(newPTs)
    onChange(newPTs)
  }, [onChange])

  const addPreset = (key) => {
    const preset = PRESETS[key]
    const newPT = {
      id: crypto.randomUUID(),
      label: preset.label,
      pref: preset.pref,
      slots: preset.slots.map(s=>({...s})),
    }
    const next = [...localPTs, newPT]
    setSelectedIdx(next.length - 1)
    update(next)
  }

  const addCustom = (label, slots) => {
    const newPT = { id:crypto.randomUUID(), label, pref:'any', slots }
    const next = [...localPTs, newPT]
    setSelectedIdx(next.length - 1)
    setShowCustom(false)
    update(next)
  }

  const remove = (idx) => {
    update(localPTs.filter((_,i)=>i!==idx))
    setSelectedIdx(prev => prev===idx ? null : prev>idx ? prev-1 : prev)
  }

  const updateSlots = (idx, slots) =>
    update(localPTs.map((pt,i)=>i===idx?{...pt,slots}:pt))

  const updateLabel = (idx, label) =>
    update(localPTs.map((pt,i)=>i===idx?{...pt,label}:pt))

  const updatePref = (idx, pref) =>
    update(localPTs.map((pt,i)=>i===idx?{...pt,pref}:pt))

  const selected = selectedIdx !== null ? localPTs[selectedIdx] : null

  // Group presets by type for UI
  const presetGroups = [
    { label:'1 foto', keys:['1f','1v','1h','1+c','pan'] },
    { label:'2 foto', keys:['2v','2h','2+c'] },
    { label:'3 foto', keys:['3a','3b','3c'] },
    { label:'4+ foto', keys:['4g','4a','6g'] },
  ]

  const filteredPTs = filter === 'all' ? localPTs
    : localPTs.filter(pt => (pt.pref||'any') === filter)

  return (
    <div>
      {/* ── Add preset buttons ── */}
      <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:14, marginBottom:16 }}>
        <p className="text-xs text-muted mb-3" style={{ fontFamily:'var(--font-mono)' }}>
          AGGIUNGI PAGINA TIPO
        </p>
        {presetGroups.map(group => (
          <div key={group.label} style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8, alignItems:'center' }}>
            <span style={{ fontSize:11, color:'var(--text3)', width:60, flexShrink:0, fontFamily:'var(--font-mono)' }}>{group.label}</span>
            {group.keys.map(k => (
              <button key={k} className="btn btn-sm" style={{ fontSize:11 }}
                onClick={()=>addPreset(k)}>
                + {PRESETS[k].label}
              </button>
            ))}
          </div>
        ))}
        <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:8, paddingTop:8, borderTop:'1px solid var(--border)' }}>
          <span style={{ fontSize:11, color:'var(--text3)', width:60, flexShrink:0, fontFamily:'var(--font-mono)' }}>Custom</span>
          <button className="btn btn-sm" style={{ fontSize:11 }}
            onClick={()=>setShowCustom(s=>!s)}>
            {showCustom ? '✕ Chiudi' : '⊞ Crea griglia custom'}
          </button>
        </div>
        {showCustom && <CustomCreator onAdd={addCustom}/>}
      </div>

      {/* ── Legend ── */}
      <div style={{ display:'flex', gap:12, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <span className="text-xs text-muted">Orientamento preferito:</span>
        {Object.entries(PREF_LABELS).map(([k,v])=>(
          <span key={k} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--text2)' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:PREF_COLORS[k], display:'inline-block'}}/>
            {v}
          </span>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {['all','portrait','landscape','any'].map(f=>(
            <button key={f} className={`btn btn-sm${filter===f?' btn-primary':''}`}
              style={{ fontSize:11, padding:'4px 10px' }}
              onClick={()=>setFilter(f)}>
              {f==='all'?'Tutti':PREF_LABELS[f]||f}
            </button>
          ))}
        </div>
      </div>

      {/* ── Preview grid ── */}
      {localPTs.length === 0 ? (
        <div style={{ textAlign:'center', padding:'28px 0', color:'var(--text3)', fontSize:13 }}>
          Nessuna pagina tipo — aggiungine una con i pulsanti sopra
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(142px, 1fr))', gap:10, marginBottom:16 }}>
          {filteredPTs.map(pt => {
            const realIdx = localPTs.indexOf(pt)
            return (
              <PagePreview key={pt.id}
                slots={pt.slots} label={pt.label} pref={pt.pref||'any'}
                selected={selectedIdx===realIdx}
                onSelect={()=>setSelectedIdx(realIdx)}
                onDelete={()=>remove(realIdx)}/>
            )
          })}
        </div>
      )}

      {/* ── Editor panel ── */}
      {selected && (
        <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:20, marginTop:4 }}>
          <p className="text-xs text-muted mb-3" style={{ fontFamily:'var(--font-mono)' }}>MODIFICA PAGINA TIPO</p>
          
          <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap', alignItems:'flex-end' }}>
            <div style={{ flex:1, minWidth:160 }}>
              <label className="form-label">Nome</label>
              <input className="form-input"
                value={selected.label}
                onChange={e=>updateLabel(selectedIdx,e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Orientamento preferito</label>
              <select className="form-select" style={{ width:160 }}
                value={selected.pref||'any'}
                onChange={e=>updatePref(selectedIdx,e.target.value)}>
                <option value="any">Misto (qualsiasi)</option>
                <option value="portrait">Verticale (ritratto)</option>
                <option value="landscape">Orizzontale (paesaggio)</option>
              </select>
            </div>
          </div>

          <div style={{ display:'flex', gap:28, alignItems:'flex-start', flexWrap:'wrap' }}>
            <LayoutEditor
              slots={selected.slots}
              onChange={s=>updateSlots(selectedIdx,s)}/>
            <div>
              <p className="text-xs text-muted mb-2">Misure slot (% pagina):</p>
              <table style={{ borderCollapse:'collapse', fontSize:12, fontFamily:'var(--font-mono)' }}>
                <thead>
                  <tr style={{ color:'var(--text3)' }}>
                    {['#','X','Y','W','H','AR'].map(h=>(
                      <th key={h} style={{ padding:'3px 8px', textAlign:h==='#'?'left':'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.slots.map((s,i)=>{
                    const ar = (s.w/s.h).toFixed(2)
                    const isV = s.h > s.w
                    return (
                      <tr key={i} style={{ color:'var(--text2)', borderTop:'1px solid var(--border)' }}>
                        <td style={{ padding:'4px 8px', color:'var(--gold)' }}>{i+1}</td>
                        {[s.x,s.y,s.w,s.h].map((v,j)=>(
                          <td key={j} style={{ padding:'4px 8px', textAlign:'right' }}>{v.toFixed(1)}%</td>
                        ))}
                        <td style={{ padding:'4px 8px', textAlign:'right', color: isV?PREF_COLORS.portrait:PREF_COLORS.landscape }}>
                          {ar} {isV?'↕':'↔'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted mt-3">
                Slot {selected.slots.length} · {selected.slots.filter(s=>s.h>s.w).length} verticali, {selected.slots.filter(s=>s.w>=s.h).length} orizzontali
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
