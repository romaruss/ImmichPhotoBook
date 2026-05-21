import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'
import { calcSpineWidthMm } from './CoverConfig'

const COLOR_PROFILES = [
  { id:'srgb',      label:'sRGB',          hint:'Standard web e consumer.' },
  { id:'adobe_rgb', label:'Adobe RGB 1998', hint:'Gamut più ampio. Per laboratori professionali.' },
  { id:'fogra39',   label:'FOGRA39',        hint:'ISO Coated v2 — standard europeo offset.' },
  { id:'fogra51',   label:'FOGRA51',        hint:'PSO Coated v3 — versione aggiornata.' },
  { id:'swop',      label:'SWOP',           hint:'US Web Coated — standard USA.' },
]

const DPI_OPTIONS = [150, 200, 300, 600]

// Controlled number input — allows free typing, clamps only on blur
function NumInput({ value, min, max, step = 1, onChange, style }) {
  const [raw, setRaw] = useState(String(value ?? ''))
  useEffect(() => { setRaw(String(value ?? '')) }, [value])
  const commit = (str) => {
    const n = parseFloat(str)
    const clamped = isNaN(n) ? min : Math.max(min, Math.min(max, n))
    setRaw(String(clamped))
    onChange(clamped)
  }
  return (
    <input type="number" className="form-input" style={style}
      min={min} max={max} step={step}
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={e => commit(e.target.value)}/>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <p style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text3)',
        textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:600,
        marginBottom:8, paddingBottom:4, borderBottom:'1px solid var(--border)' }}>
        {title}
      </p>
      {children}
    </div>
  )
}

function Row({ label, children, hint }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
      <span style={{ fontSize:12, color:'var(--text2)', flex:'0 0 170px', lineHeight:1.3 }}>{label}</span>
      <div style={{ flex:1, display:'flex', alignItems:'center', gap:6 }}>
        {children}
      </div>
      {hint && <span style={{ fontSize:10, color:'var(--text3)', flex:'0 0 auto', maxWidth:120, lineHeight:1.3 }}>{hint}</span>}
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'3px 0',
      borderBottom:'1px solid var(--border)', fontSize:11, fontFamily:'var(--font-mono)' }}>
      <span style={{ color:'var(--text2)' }}>{label}</span>
      <strong style={{ color:'var(--text)', maxWidth:'60%', textAlign:'right', wordBreak:'break-word' }}>{value}</strong>
    </div>
  )
}

function initSettings(profile) {
  const cover = profile?.cover || {}
  return {
    body_paper_gsm:        profile?.body_paper_gsm        ?? 90,
    cover_paper_gsm:       cover.cover_paper_gsm           ?? 300,
    spine_width_mm:        cover.spine_width_mm            ?? null,
    export_dpi:            profile?.export_dpi             ?? 300,
    color_profile:         profile?.color_profile          ?? 'srgb',
    crop_marks:            profile?.crop_marks             ?? false,
    export_as_spread:      cover.export_as_spread          ?? false,
    export_cover_separate: cover.export_cover_separate     ?? false,
  }
}

export default function ExportModal({ layout, onExport, exporting, onClose, externalSettings, onSettingsChange }) {
  const t = useT(); const tp = t.preview; const te = t.export
  const [settings, setSettings_] = useState(() => externalSettings || initSettings(layout?.profile))
  const [quality, setQuality]   = useState('hires')

  const setSettings = (fn) => {
    setSettings_(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      onSettingsChange?.(next)
      return next
    })
  }
  const [progress, setProgress] = useState(null)
  const [iccAvail, setIccAvail] = useState({})
  const pollRef = useRef(null)

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))

  const exportMode = settings.export_as_spread ? 'spread' : settings.export_cover_separate ? 'separate' : 'none'
  const setExportMode = (mode) => setSettings(s => ({
    ...s,
    export_as_spread:      mode === 'spread',
    export_cover_separate: mode === 'separate',
  }))

  useEffect(() => {
    axios.get('/api/export/color_profiles').then(r => setIccAvail(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (exporting) {
      setProgress({ pct: 0, step: te.processing })
      pollRef.current = setInterval(async () => {
        try {
          const r = await axios.get('/api/export/progress')
          setProgress({ pct: r.data.pct, step: r.data.step })
          if (r.data.done) { clearInterval(pollRef.current); setTimeout(() => setProgress(null), 1800) }
        } catch {}
      }, 600)
    } else {
      clearInterval(pollRef.current)
    }
    return () => clearInterval(pollRef.current)
  }, [exporting])

  const handleExport = (format) => onExport(format, quality, settings)

  const handleCancel = async () => {
    try { await axios.delete('/api/export') } catch {}
  }

  const p       = layout?.profile || {}
  const cover   = layout?.profile?.cover || {}
  const pages   = layout?.pages || []
  const nPages  = pages.length + 1

  const spineAuto = calcSpineWidthMm(pages.length, settings.body_paper_gsm)
  const spineDisplay = settings.spine_width_mm != null
    ? `${settings.spine_width_mm} ${te.mm} ${te.spineManual}`
    : `${spineAuto} ${te.mm} ${te.spineAuto}`

  const base = p.margin_mm || 5
  const mTop  = p.margin_top    ?? base
  const mBot  = p.margin_bottom ?? base
  const mEst  = p.margin_left   ?? base
  const mInt  = p.margin_right  ?? base
  const pct   = progress?.pct || 0

  const handleClose = () => {
    if (exporting) handleCancel()
    onClose()
  }

  const selectedIcc = iccAvail[settings.color_profile]

  return createPortal(
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:9000 }}
        onClick={e => e.target === e.currentTarget && !exporting && onClose()}/>
      <div style={{
        position:'fixed', top:'50%', left:'50%',
        transform:'translate(-50%,-50%)',
        width:580, maxHeight:'88vh',
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:14, boxShadow:'0 32px 96px rgba(0,0,0,0.8)',
        zIndex:9001, display:'flex', flexDirection:'column', overflow:'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:'var(--bg3)', flexShrink:0 }}>
          <div>
            <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:20, marginBottom:2 }}>
              {te.title}
            </h3>
            <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
              {layout?.album?.albumName || '—'} · {te.pages(nPages)}
            </p>
          </div>
          <button onClick={handleClose}
            style={{ background:'none', border:'none', color:'var(--text3)',
              fontSize:20, cursor:'pointer', padding:'0 4px' }}>✕</button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>

          {/* Profile summary */}
          <Section title={te.formatSection}>
            <InfoRow label={te.formatLabel}
              value={`${p.page_size || '20x30'} · ${p.orientation === 'landscape' ? te.landscape : te.portrait}`}/>
            <InfoRow label={te.marginsLabel}
              value={`${mTop} / ${mBot} / ${mEst} / ${mInt} ${te.mm}`}/>
            <InfoRow label={te.gapLabel} value={`${p.gap_mm ?? 3} ${te.mm}`}/>
            {p.bleed && <InfoRow label={te.bleedLabel} value={`${p.bleed_mm} ${te.mm}`}/>}
          </Section>

          {/* Hot-editable printing options */}
          <Section title={te.printSection}>
            <Row label={te.bodyGsm}>
              <NumInput value={settings.body_paper_gsm} min={40} max={350} step={10}
                style={{ width:80 }} onChange={v => set('body_paper_gsm', v)}/>
              <span style={{ fontSize:11, color:'var(--text3)' }}>{te.gsm}</span>
            </Row>
            <Row label={te.coverGsm}>
              <NumInput value={settings.cover_paper_gsm} min={100} max={500} step={10}
                style={{ width:80 }} onChange={v => set('cover_paper_gsm', v)}/>
              <span style={{ fontSize:11, color:'var(--text3)' }}>{te.gsm}</span>
            </Row>
            <Row label={te.spineWidth}>
              <input type="number" className="form-input" style={{ width:80 }}
                min={0} max={50} step={0.5}
                placeholder="auto"
                value={settings.spine_width_mm ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? null : +e.target.value
                  set('spine_width_mm', v)
                }}
                onBlur={e => {
                  if (e.target.value !== '') {
                    set('spine_width_mm', Math.max(0, Math.min(50, +e.target.value || 0)))
                  }
                }}/>
              <span style={{ fontSize:11, color:'var(--text3)' }}>{te.mm} · {spineDisplay}</span>
            </Row>
            <Row label={te.dpiLabel}>
              <select className="form-input" style={{ width:110 }}
                value={settings.export_dpi}
                onChange={e => set('export_dpi', +e.target.value)}>
                {DPI_OPTIONS.map(d => <option key={d} value={d}>{d} {te.dpi}</option>)}
              </select>
            </Row>
            <Row label={te.colorLabel}>
              <select className="form-input" style={{ width:180 }}
                value={settings.color_profile}
                onChange={e => set('color_profile', e.target.value)}>
                {COLOR_PROFILES.map(cp => {
                  const info = iccAvail[cp.id]
                  const available = info == null || info.available
                  return (
                    <option key={cp.id} value={cp.id}
                      disabled={!available}
                      title={available ? cp.hint : info?.reason}
                      style={{ color: available ? '#4caf50' : '#ef5350' }}>
                      {cp.label}
                    </option>
                  )
                })}
              </select>
            </Row>
            {selectedIcc?.available === false && (
              <p style={{ fontSize:10, color:'#ef5350', marginTop:2, fontFamily:'var(--font-mono)' }}>
                ⚠ {selectedIcc.reason}
              </p>
            )}
            <p style={{ fontSize:10, color:'var(--text3)', marginTop:2, fontFamily:'var(--font-mono)' }}>
              {COLOR_PROFILES.find(c => c.id === settings.color_profile)?.hint}
            </p>
          </Section>

          {/* Cover options — mutually exclusive */}
          <Section title={te.coverSection}>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[
                ['none',     te.coverNone,     null],
                ['spread',   te.coverSpread,   te.coverSpreadHint],
                ['separate', te.coverSeparate, te.coverSeparateHint],
              ].map(([mode, label, sub]) => (
                <label key={mode} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12 }}>
                  <input type="radio" name="export_cover_mode" value={mode}
                    checked={exportMode === mode}
                    onChange={() => setExportMode(mode)}/>
                  <span>
                    {label}
                    {sub && <span style={{ fontSize:10, color:'var(--text3)', marginLeft:6, fontWeight:400 }}>{sub}</span>}
                  </span>
                </label>
              ))}
            </div>
          </Section>

          {/* Print marks */}
          <Section title={te.marksSection}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12 }}>
              <input type="checkbox" checked={settings.crop_marks}
                onChange={e => set('crop_marks', e.target.checked)}/>
              {te.cropMarksLabel}
            </label>
          </Section>

          {/* Quality */}
          <Section title={te.qualitySection}>
            <div style={{ display:'flex', gap:6 }}>
              {[
                ['hires',   te.hiresLabel,   te.hiresHint],
                ['preview', te.previewLabel, te.previewHint],
              ].map(([v, lbl, hint]) => (
                <button key={v} onClick={() => setQuality(v)}
                  title={hint}
                  style={{ flex:1, padding:'7px 6px', fontSize:11, borderRadius:6,
                    border:`1px solid ${quality===v?'var(--gold)':'var(--border)'}`,
                    background: quality===v?'var(--gold-dim)':'var(--bg3)',
                    color: quality===v?'var(--gold)':'var(--text2)',
                    cursor:'pointer', lineHeight:1.3, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                  <span style={{ fontWeight:600 }}>{lbl}</span>
                  <span style={{ fontSize:9, opacity:0.7 }}>{hint}</span>
                </button>
              ))}
            </div>
            {quality === 'hires' && (
              <p style={{ fontSize:10, color:'var(--text3)', marginTop:8, fontFamily:'var(--font-mono)' }}>
                {te.hiresWarn}
              </p>
            )}
          </Section>

        </div>

        {/* ── Footer: progress + buttons ── */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)',
          background:'var(--bg3)', flexShrink:0 }}>

          {/* Progress bar */}
          {exporting && progress && (
            <div style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between',
                fontSize:11, color:'var(--text2)', marginBottom:4, fontFamily:'var(--font-mono)' }}>
                <span>{progress.step || te.processing}</span>
                <span>{pct > 0 ? `${pct}%` : ''}</span>
              </div>
              <div style={{ width:'100%', height:5, background:'var(--bg)',
                borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${pct}%`,
                  background:'var(--gold)', borderRadius:3,
                  transition:'width 0.4s ease' }}/>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display:'flex', gap:8 }}>
            {exporting ? (
              <button className="btn btn-danger" style={{ flex:1, justifyContent:'center', fontSize:12 }}
                onClick={handleCancel}>
                {te.stopBtn}
              </button>
            ) : (
              <>
                <button className="btn btn-primary" style={{ flex:2, justifyContent:'center', fontSize:12 }}
                  onClick={() => handleExport('pdf')}>
                  {te.exportPdfBtn}
                </button>
                <button className="btn" style={{ flex:1, justifyContent:'center', fontSize:12 }}
                  onClick={() => handleExport('svg')}
                  title={te.svgNote}>
                  {te.svgBtn}
                </button>
              </>
            )}
            <button className="btn" style={{ justifyContent:'center', fontSize:12, minWidth:70 }}
              onClick={handleClose}>
              {exporting ? te.closeBtn : '✕'}
            </button>
          </div>
          {!exporting && (
            <p style={{ textAlign:'center', fontSize:9, color:'var(--text3)', marginTop:6, fontFamily:'var(--font-mono)' }}>
              {te.svgNote}
            </p>
          )}
        </div>

      </div>
    </>,
    document.body
  )
}
