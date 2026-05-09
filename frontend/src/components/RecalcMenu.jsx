import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n.jsx'

export default function RecalcMenu({ anchorRef, currentPage, totalPages, busy, onAction, onClose }) {
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
