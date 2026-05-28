import { useState, useEffect, useRef } from 'react'
import { getPageDims } from '../../utils/pageGeometry'

// ── Layout picker with hover mini-preview ─────────────────────────────────────
export default function LayoutPickerDropdown({ allPageTypes, currentId, profile, onChange }) {
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
        <div
          data-no-page-nav="1"
          onWheel={e=>e.stopPropagation()}
          style={{
          position:'absolute', top:'100%', left:0, zIndex:9200,
          background:'var(--bg2)', border:'1px solid var(--border)',
          borderRadius:8, boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
          height:360, minHeight:120, maxHeight:'70vh',
          overflowY:'auto', minWidth:200, marginTop:2,
          resize:'vertical',
          overscrollBehavior:'contain',
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
