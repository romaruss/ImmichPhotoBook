import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useT } from '../i18n.jsx'

export default function ExportPanel({ layout, onExport, exporting }) {
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
