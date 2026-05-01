/**
 * CoverEditor.jsx — Editor copertina fotolibro
 *
 * Modello cover_style:
 *   bg_type:       "color" | "photo" | "map"   — tipo di sfondo
 *   bg:            "#rrggbb"                    — colore sfondo
 *   bg_photo:      asset_id | null              — foto sfondo (se bg_type=photo)
 *   bg_photo_opacity: 0..1
 *   text_color:    "#rrggbb"
 *   accent_color:  "#rrggbb"
 *   title_align:   "left"|"center"|"right"
 *   title_valign:  "top"|"center"|"bottom"
 *   title_size:    px
 *   show_year:     bool
 *   show_count:    bool
 *   inset: {
 *     show:     bool
 *     type:     "map"|"photo"
 *     photo:    asset_id | null
 *     position: "top"|"bottom"|"left"|"right"
 *     opacity:  0..1
 *     size_pct: 35..60  — % del lato più corto della copertina
 *   }
 *   preset_id:     string (per evidenziare preset attivo)
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'

// ── Presets ───────────────────────────────────────────────────────────────────
export const COVER_PRESETS = [
  {
    id: 'classic_dark', label: 'Classico scuro',
    bg_type: 'color', bg: '#0a0a0e',
    text_color: '#f0ede6', accent_color: '#d4aa5a',
    title_align: 'center', title_valign: 'bottom', title_size: 32,
    show_year: true, show_count: true,
    inset: { show: true, type: 'map', photo: null, position: 'top', opacity: 0.75, size_pct: 45 },
  },
  {
    id: 'minimal_white', label: 'Minimal chiaro',
    bg_type: 'color', bg: '#f5f3ef',
    text_color: '#1a1a1a', accent_color: '#8b6914',
    title_align: 'center', title_valign: 'center', title_size: 36,
    show_year: true, show_count: false,
    inset: { show: false, type: 'map', photo: null, position: 'top', opacity: 0.6, size_pct: 40 },
  },
  {
    id: 'bold_photo', label: 'Foto grande',
    bg_type: 'photo', bg: '#1a1a1a',
    text_color: '#ffffff', accent_color: '#ffffff',
    title_align: 'left', title_valign: 'bottom', title_size: 28,
    show_year: true, show_count: true,
    inset: { show: true, type: 'map', photo: null, position: 'bottom', opacity: 0.85, size_pct: 38 },
  },
  {
    id: 'travel', label: 'Viaggio',
    bg_type: 'map', bg: '#1c2b3a',
    text_color: '#e8dcc8', accent_color: '#7eb8d4',
    title_align: 'center', title_valign: 'bottom', title_size: 30,
    show_year: true, show_count: false,
    inset: { show: false, type: 'map', photo: null, position: 'top', opacity: 0.7, size_pct: 42 },
  },
  {
    id: 'split', label: 'Foto + Mappa',
    bg_type: 'photo', bg: '#111',
    text_color: '#ffffff', accent_color: '#ffdd88',
    title_align: 'left', title_valign: 'center', title_size: 28,
    show_year: true, show_count: true,
    inset: { show: true, type: 'map', photo: null, position: 'right', opacity: 0.9, size_pct: 40 },
  },
]

export const DEFAULT_COVER = {
  ...COVER_PRESETS[0],
  preset_id: 'classic_dark',
  bg_photo: null,
  bg_photo_opacity: 1.0,
}

const CUSTOM_KEY = 'photobook_cover_styles'
function loadCustom() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') } catch { return [] } }
function saveCustom(s) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(s)) }

// ── Photo picker modal ────────────────────────────────────────────────────────
function PhotoPickerModal({ assets, current, onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const filtered = assets
    .filter(a => (a.type || 'IMAGE').toUpperCase() !== 'VIDEO')
    .filter(a => !search || (a.originalFileName || '').toLowerCase().includes(search.toLowerCase()))

  return createPortal(
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:9100 }}
        onClick={onClose}/>
      <div style={{ position:'fixed', top:'10%', left:'50%', transform:'translateX(-50%)',
        width:560, maxHeight:'75vh', background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        zIndex:9101, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* Header */}
        <div style={{ padding:'14px 18px 10px', borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:17 }}>Scegli foto</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:18,
            color:'var(--text3)', cursor:'pointer' }}>✕</button>
        </div>
        {/* Search */}
        <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <input className="form-input" style={{ fontSize:12 }}
            placeholder="Cerca per nome file…" value={search}
            onChange={e => setSearch(e.target.value)} autoFocus/>
        </div>
        {/* None option */}
        <div style={{ padding:'8px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={() => { onSelect(null); onClose() }}
            style={{ padding:'6px 14px', fontSize:11, border:'1px solid var(--border)',
              borderRadius:6, cursor:'pointer', background: !current ? 'var(--gold-dim)' : 'var(--bg3)',
              color: !current ? 'var(--gold)' : 'var(--text3)' }}>
            ✕ Nessuna foto (usa tinta unita / mappa)
          </button>
        </div>
        {/* Grid */}
        <div style={{ flex:1, overflowY:'auto', padding:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6 }}>
            {filtered.map(a => (
              <div key={a.id} onClick={() => { onSelect(a.id); onClose() }}
                style={{ position:'relative', paddingTop:'100%', borderRadius:5, overflow:'hidden',
                  cursor:'pointer', border: current===a.id
                    ? '2.5px solid var(--gold)' : '2px solid transparent',
                  transition:'border-color 0.1s' }}>
                <img src={`/api/thumb/${a.id}`} alt={a.originalFileName} loading="lazy"
                  style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                {current === a.id && (
                  <div style={{ position:'absolute', top:3, right:3, background:'var(--gold)',
                    color:'#000', borderRadius:'50%', width:18, height:18,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700 }}>✓</div>
                )}
              </div>
            ))}
          </div>
          {filtered.length === 0 && (
            <p style={{ textAlign:'center', color:'var(--text3)', padding:24, fontSize:12 }}>
              {search ? 'Nessun risultato' : 'Nessuna foto disponibile'}
            </p>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

// ── CoverPreview ──────────────────────────────────────────────────────────────
export function CoverPreview({ style, albumName, assetCount, mapUrl, width = 160, height = null }) {
  const s = { ...DEFAULT_COVER, ...style }
  const ins = { ...DEFAULT_COVER.inset, ...(s.inset || {}) }
  const h = height ?? Math.round(width * 1.41)

  // Inset dimensions
  const insetSizePct = ins.size_pct || 42
  const insetIsHoriz = ins.position === 'left' || ins.position === 'right'
  const insetW = insetIsHoriz ? `${insetSizePct}%` : '100%'
  const insetH = insetIsHoriz ? '100%' : `${insetSizePct}%`
  const insetPos = ins.position === 'top'    ? { top:0, left:0, right:0 }
                 : ins.position === 'bottom' ? { bottom:0, left:0, right:0 }
                 : ins.position === 'left'   ? { top:0, left:0, bottom:0 }
                 :                             { top:0, right:0, bottom:0 }

  // Title position within the "free" area (opposite to inset)
  const titleAreaTop  = ins.show && ins.position === 'top'    ? `${insetSizePct}%` : '0'
  const titleAreaBot  = ins.show && ins.position === 'bottom' ? `${insetSizePct}%` : '0'
  const titleAreaLeft = ins.show && ins.position === 'left'   ? `${insetSizePct}%` : '0'
  const titleAreaRight= ins.show && ins.position === 'right'  ? `${insetSizePct}%` : '0'

  const titleScale = width / 280
  const fz  = Math.max(9,  Math.round(s.title_size * titleScale))
  const fzS = Math.max(7,  Math.round(10 * titleScale))

  // Title vertical within free area
  const freePct = ins.show && !insetIsHoriz ? (100 - insetSizePct) : 100
  const titleRelY = s.title_valign === 'top' ? '12%' : s.title_valign === 'center' ? '50%' : '80%'
  const accentRelY = s.title_valign === 'bottom' ? '68%' : s.title_valign === 'top' ? '22%' : '44%'

  // Background photo/map
  const bgImg = s.bg_type === 'photo' && s.bg_photo
    ? `/api/thumb/${s.bg_photo}`
    : s.bg_type === 'map' && mapUrl ? mapUrl : null

  return (
    <div style={{ width, height: h, background: s.bg, borderRadius:4, overflow:'hidden',
      position:'relative', flexShrink:0, boxShadow:'0 4px 20px rgba(0,0,0,0.5)' }}>

      {/* Background layer */}
      {bgImg && (
        <img src={bgImg} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%',
          objectFit:'cover', opacity: s.bg_type === 'photo' ? (s.bg_photo_opacity ?? 1.0) : 0.55 }}/>
      )}
      {bgImg && (
        <div style={{ position:'absolute', inset:0, background:`${s.bg}66` }}/>
      )}

      {/* Inset box */}
      {ins.show && (
        <div style={{ position:'absolute', ...insetPos, width:insetW, height:insetH,
          overflow:'hidden', borderRadius:0 }}>
          {ins.type === 'map' && mapUrl && (
            <img src={mapUrl} alt="" style={{ width:'100%', height:'100%',
              objectFit:'cover', opacity: ins.opacity ?? 0.85 }}/>
          )}
          {ins.type === 'photo' && ins.photo && (
            <img src={`/api/thumb/${ins.photo}`} alt="" style={{ width:'100%', height:'100%',
              objectFit:'cover', opacity: ins.opacity ?? 1.0 }}/>
          )}
          {/* Subtle separator line */}
          <div style={{ position:'absolute', inset:0,
            boxShadow: ins.position === 'bottom' ? 'inset 0 2px 8px rgba(0,0,0,0.4)'
                      : ins.position === 'top'    ? 'inset 0 -2px 8px rgba(0,0,0,0.4)'
                      : ins.position === 'right'  ? 'inset 2px 0 8px rgba(0,0,0,0.4)'
                      : 'inset -2px 0 8px rgba(0,0,0,0.4)' }}/>
        </div>
      )}

      {/* Title area (positioned in the "free" part of the cover) */}
      <div style={{ position:'absolute',
        top: titleAreaTop, bottom: titleAreaBot, left: titleAreaLeft, right: titleAreaRight }}>
        {/* Accent line */}
        <div style={{ position:'absolute', left:'8%', right:'8%', top: accentRelY,
          height:1, background: s.accent_color, opacity:0.7 }}/>
        {/* Title */}
        <div style={{ position:'absolute', left:'8%', right:'8%', top: titleRelY,
          transform: s.title_valign==='center' ? 'translateY(-50%)' : 'none',
          textAlign: s.title_align }}>
          <div style={{ fontFamily:'Georgia, serif', fontWeight:300, fontSize:fz,
            color: s.text_color, lineHeight:1.25, textShadow:'0 1px 6px rgba(0,0,0,0.5)' }}>
            {albumName || 'Nome album'}
          </div>
          {(s.show_year || s.show_count) && (
            <div style={{ fontSize:fzS, color:s.accent_color, fontFamily:'monospace',
              marginTop:4, opacity:0.9, display:'flex', gap:6,
              justifyContent: s.title_align==='right' ? 'flex-end'
                            : s.title_align==='left'  ? 'flex-start' : 'center' }}>
              {s.show_year  && <span>2025</span>}
              {s.show_year && s.show_count && <span>·</span>}
              {s.show_count && <span>{typeof assetCount==='number' ? `${assetCount} foto` : '— foto'}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CoverStyleEditor ──────────────────────────────────────────────────────────
export default function CoverStyleEditor({
  value, onChange, albumName, assetCount, mapUrl,
  assets = [], compact = false,
  coverWidth = 160, coverHeight = null,   // for orientation support
}) {
  const [customStyles, setCustomStyles] = useState(loadCustom)
  const [saveName, setSaveName]         = useState('')
  const [showSave, setShowSave]         = useState(false)
  const [pickerTarget, setPickerTarget] = useState(null) // 'bg' | 'inset'

  const s   = { ...DEFAULT_COVER, ...value }
  const ins = { ...DEFAULT_COVER.inset, ...(s.inset || {}) }
  const set = (k, v) => onChange({ ...s, [k]: v })
  const setIns = (k, v) => onChange({ ...s, inset: { ...ins, [k]: v } })

  const allPresets    = [...COVER_PRESETS, ...customStyles]
  const activePresetId = s.preset_id || null

  const applyPreset = (pr) => onChange({
    ...pr, preset_id: pr.id,
    bg_photo: s.bg_photo, bg_photo_opacity: s.bg_photo_opacity,
    inset: { ...pr.inset, photo: ins.photo },
  })

  const saveCustomStyle = () => {
    if (!saveName.trim()) return
    const id = `custom_${Date.now()}`
    const ns = { ...s, id, preset_id: id, label: saveName.trim() }
    const updated = [...customStyles, ns]
    setCustomStyles(updated); saveCustom(updated); setSaveName(''); setShowSave(false)
  }
  const deleteCustom = (id) => {
    const updated = customStyles.filter(x => x.id !== id)
    setCustomStyles(updated); saveCustom(updated)
  }

  const cleanAssets = assets.filter(a => (a.type || 'IMAGE').toUpperCase() !== 'VIDEO')

  // Section header style
  const SH = ({ children }) => (
    <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)',
      textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>{children}</p>
  )

  return (
    <div style={{ display:'flex', gap:20, flexWrap: compact ? 'wrap' : undefined }}>

      {/* ── Column 1: Preview + Presets ── */}
      <div style={{ flexShrink:0 }}>
        <CoverPreview style={s} albumName={albumName} assetCount={assetCount}
          mapUrl={mapUrl} width={coverWidth} height={coverHeight}/>

        <div style={{ marginTop:10 }}>
          <SH>Preset</SH>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {allPresets.map(pr => (
              <div key={pr.id} style={{ display:'flex', gap:4 }}>
                <button onClick={() => applyPreset(pr)} style={{
                  flex:1, padding:'4px 8px', fontSize:11, textAlign:'left',
                  background: activePresetId===pr.id ? 'var(--gold-dim)' : 'var(--bg3)',
                  border:`1px solid ${activePresetId===pr.id ? 'var(--gold)' : 'var(--border)'}`,
                  color: activePresetId===pr.id ? 'var(--gold)' : 'var(--text2)',
                  borderRadius:5, cursor:'pointer' }}>{pr.label}</button>
                {customStyles.find(x => x.id===pr.id) && (
                  <button onClick={() => deleteCustom(pr.id)} style={{
                    padding:'3px 6px', fontSize:10, border:'1px solid var(--border)',
                    background:'none', color:'#e05050', borderRadius:4, cursor:'pointer' }}>×</button>
                )}
              </div>
            ))}
          </div>
          {showSave ? (
            <div style={{ display:'flex', gap:4, marginTop:6 }}>
              <input className="form-input" style={{ flex:1, fontSize:11, padding:'3px 6px' }}
                placeholder="Nome stile…" value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => e.key==='Enter' && saveCustomStyle()}/>
              <button className="btn btn-sm" onClick={saveCustomStyle}>✓</button>
              <button className="btn btn-sm" onClick={() => setShowSave(false)}>✕</button>
            </div>
          ) : (
            <button className="btn btn-sm w-full" style={{ marginTop:6, fontSize:10 }}
              onClick={() => setShowSave(true)}>+ Salva stile</button>
          )}
        </div>
      </div>

      {/* ── Column 2: Controls ── */}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:16 }}>

        {/* SFONDO */}
        <div>
          <SH>Sfondo</SH>
          {/* Type selector */}
          <div style={{ display:'flex', gap:4, marginBottom:10 }}>
            {[['color','🎨 Tinta unita'],['photo','🖼 Foto'],['map','🗺 Mappa GPS']].map(([v,lbl]) => (
              <button key={v} onClick={() => set('bg_type', v)} style={{
                flex:1, padding:'5px 4px', fontSize:10, borderRadius:5, cursor:'pointer',
                border:`1px solid ${s.bg_type===v ? 'var(--gold)' : 'var(--border)'}`,
                background: s.bg_type===v ? 'var(--gold-dim)' : 'var(--bg3)',
                color: s.bg_type===v ? 'var(--gold)' : 'var(--text3)' }}>{lbl}</button>
            ))}
          </div>
          {/* Color picker (always) */}
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems:'center' }}>
              <input type="color" value={s.bg} onChange={e => set('bg', e.target.value)} style={{
                width:36, height:36, padding:2, border:'1px solid var(--border)',
                borderRadius:5, cursor:'pointer', background:'transparent' }}/>
              <span style={{ fontSize:9, color:'var(--text3)' }}>Sfondo</span>
            </div>
            {/* Photo picker button */}
            {s.bg_type === 'photo' && (
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {s.bg_photo && (
                  <img src={`/api/thumb/${s.bg_photo}`} alt="" style={{
                    width:44, height:44, objectFit:'cover', borderRadius:4,
                    border:'2px solid var(--gold)' }}/>
                )}
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  <button className="btn btn-sm" onClick={() => setPickerTarget('bg')}
                    style={{ fontSize:10 }}>
                    {s.bg_photo ? '🖼 Cambia foto' : '🖼 Scegli foto…'}
                  </button>
                  {s.bg_photo && (
                    <>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:10, color:'var(--text3)', minWidth:60 }}>
                          Opacità {Math.round((s.bg_photo_opacity??1)*100)}%
                        </span>
                        <input type="range" min={0.1} max={1} step={0.05}
                          value={s.bg_photo_opacity??1}
                          onChange={e => set('bg_photo_opacity', +e.target.value)}
                          style={{ flex:1, accentColor:'var(--gold)' }}/>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {s.bg_type === 'map' && !mapUrl && (
              <p style={{ fontSize:10, color:'#e89a3a' }}>⚠ Nessuna mappa GPS disponibile per questo album</p>
            )}
          </div>
        </div>

        {/* TITOLO */}
        <div>
          <SH>Titolo</SH>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
            {/* Colors */}
            {[['text_color','Testo'],['accent_color','Accento']].map(([k,lbl]) => (
              <div key={k} style={{ display:'flex', flexDirection:'column', gap:3, alignItems:'center' }}>
                <input type="color" value={s[k]} onChange={e => set(k, e.target.value)} style={{
                  width:32, height:32, padding:2, border:'1px solid var(--border)',
                  borderRadius:4, cursor:'pointer', background:'transparent' }}/>
                <span style={{ fontSize:9, color:'var(--text3)' }}>{lbl}</span>
              </div>
            ))}
            {/* Size */}
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              <span style={{ fontSize:10, color:'var(--text3)' }}>Dimensione</span>
              <input type="number" className="form-input" min={12} max={72} step={1}
                value={s.title_size} onChange={e => set('title_size', +e.target.value)}
                style={{ width:60 }}/>
            </div>
            {/* Align H */}
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              <span style={{ fontSize:10, color:'var(--text3)' }}>Orizz.</span>
              <div style={{ display:'flex', gap:3 }}>
                {[['left','←'],['center','↔'],['right','→']].map(([v,icon]) => (
                  <button key={v} onClick={() => set('title_align', v)} style={{
                    width:28, height:28, border:'1px solid var(--border)', borderRadius:4,
                    cursor:'pointer', fontSize:13,
                    background: s.title_align===v ? 'var(--gold-dim)' : 'var(--bg3)',
                    color: s.title_align===v ? 'var(--gold)' : 'var(--text3)' }}>{icon}</button>
                ))}
              </div>
            </div>
            {/* Align V */}
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              <span style={{ fontSize:10, color:'var(--text3)' }}>Vert.</span>
              <div style={{ display:'flex', gap:3 }}>
                {[['top','↑'],['center','↕'],['bottom','↓']].map(([v,icon]) => (
                  <button key={v} onClick={() => set('title_valign', v)} style={{
                    width:28, height:28, border:'1px solid var(--border)', borderRadius:4,
                    cursor:'pointer', fontSize:14,
                    background: s.title_valign===v ? 'var(--gold-dim)' : 'var(--bg3)',
                    color: s.title_valign===v ? 'var(--gold)' : 'var(--text3)' }}>{icon}</button>
                ))}
              </div>
            </div>
            {/* Info checkboxes */}
            <div style={{ display:'flex', gap:10 }}>
              {[['show_year','Anno'],['show_count','N° foto']].map(([k,lbl]) => (
                <label key={k} style={{ display:'flex', gap:5, alignItems:'center',
                  cursor:'pointer', fontSize:11 }}>
                  <input type="checkbox" checked={!!s[k]} onChange={e => set(k, e.target.checked)}
                    style={{ accentColor:'var(--gold)' }}/>
                  {lbl}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* RIQUADRO (inset box) */}
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
            <SH>Riquadro</SH>
            <label style={{ display:'flex', gap:6, alignItems:'center',
              cursor:'pointer', fontSize:12, marginBottom:8 }}>
              <input type="checkbox" checked={!!ins.show}
                onChange={e => setIns('show', e.target.checked)}
                style={{ accentColor:'var(--gold)' }}/>
              Mostra riquadro
            </label>
          </div>
          {ins.show && (
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-start' }}>
              {/* Content type */}
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                <span style={{ fontSize:10, color:'var(--text3)' }}>Contenuto</span>
                <div style={{ display:'flex', gap:4 }}>
                  {[['map','🗺 Mappa'],['photo','🖼 Foto']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setIns('type', v)} style={{
                      padding:'4px 8px', fontSize:10, borderRadius:4, cursor:'pointer',
                      border:`1px solid ${ins.type===v ? 'var(--gold)' : 'var(--border)'}`,
                      background: ins.type===v ? 'var(--gold-dim)' : 'var(--bg3)',
                      color: ins.type===v ? 'var(--gold)' : 'var(--text3)' }}>{lbl}</button>
                  ))}
                </div>
                {ins.type === 'photo' && (
                  <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4 }}>
                    {ins.photo && (
                      <img src={`/api/thumb/${ins.photo}`} alt="" style={{
                        width:36, height:36, objectFit:'cover', borderRadius:3,
                        border:'2px solid var(--gold)' }}/>
                    )}
                    <button className="btn btn-sm" onClick={() => setPickerTarget('inset')}
                      style={{ fontSize:10 }}>
                      {ins.photo ? 'Cambia' : '🖼 Scegli foto…'}
                    </button>
                  </div>
                )}
                {ins.type === 'map' && !mapUrl && (
                  <p style={{ fontSize:9, color:'#e89a3a', marginTop:4 }}>⚠ Nessuna mappa GPS</p>
                )}
              </div>
              {/* Position */}
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                <span style={{ fontSize:10, color:'var(--text3)' }}>Posizione</span>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:3 }}>
                  {[['top','↑ Alto'],['bottom','↓ Basso'],['left','← Sinistra'],['right','Destra →']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setIns('position', v)} style={{
                      padding:'3px 6px', fontSize:10, borderRadius:4, cursor:'pointer',
                      border:`1px solid ${ins.position===v ? 'var(--gold)' : 'var(--border)'}`,
                      background: ins.position===v ? 'var(--gold-dim)' : 'var(--bg3)',
                      color: ins.position===v ? 'var(--gold)' : 'var(--text3)' }}>{lbl}</button>
                  ))}
                </div>
              </div>
              {/* Size + opacity */}
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <div>
                  <span style={{ fontSize:10, color:'var(--text3)' }}>
                    Dimensione {ins.size_pct || 42}%
                  </span>
                  <input type="range" min={20} max={65} step={1}
                    value={ins.size_pct || 42}
                    onChange={e => setIns('size_pct', +e.target.value)}
                    style={{ width:110, display:'block', accentColor:'var(--gold)', marginTop:4 }}/>
                </div>
                <div>
                  <span style={{ fontSize:10, color:'var(--text3)' }}>
                    Opacità {Math.round((ins.opacity??0.85)*100)}%
                  </span>
                  <input type="range" min={0.1} max={1} step={0.05}
                    value={ins.opacity??0.85}
                    onChange={e => setIns('opacity', +e.target.value)}
                    style={{ width:110, display:'block', accentColor:'var(--gold)', marginTop:4 }}/>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Photo picker modal */}
      {pickerTarget && (
        <PhotoPickerModal
          assets={cleanAssets}
          current={pickerTarget === 'bg' ? s.bg_photo : ins.photo}
          onSelect={id => {
            if (pickerTarget === 'bg') onChange({ ...s, bg_photo: id, bg_type: id ? 'photo' : s.bg_type })
            else setIns('photo', id)
          }}
          onClose={() => setPickerTarget(null)}/>
      )}
    </div>
  )
}
