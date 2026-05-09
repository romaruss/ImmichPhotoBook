/**
 * CoverEditorModal.jsx — 5-tab editor for all cover elements.
 *
 * Tabs: Fronte | Seconda | Terza | Quarta | Dorso
 * - Tabs 0-3: reuse DividerEditor engine
 * - Tab 4 (Dorso): custom SpineEditor (bg + 4 text elements)
 */

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import DividerEditor, { DividerCanvas, migrateDividerStyle } from './DividerEditor'
import {
  DEFAULT_COVER_FRONT, DEFAULT_COVER_INSIDE, DEFAULT_COVER_BACK,
  DEFAULT_SPINE, migrateCoverConfig, calcSpineWidthMm,
} from './CoverConfig'

// ── Page size lookup (mirrors DividerEditor) ──────────────────────────────────
const PAGE_SIZES = [
  { id:'A4', w:210, h:297 }, { id:'A3', w:297, h:420 }, { id:'A5', w:148, h:210 },
  { id:'20x20', w:200, h:200 }, { id:'20x30', w:200, h:300 },
  { id:'30x30', w:300, h:300 }, { id:'30x40', w:300, h:400 },
  { id:'Letter', w:216, h:279 },
]
function getPageMm(profile) {
  const sz = PAGE_SIZES.find(s => s.id === (profile?.page_size || '20x30')) || { w:200, h:300 }
  let [w, h] = [sz.w, sz.h]
  if (profile?.orientation === 'landscape') [w, h] = [h, w]
  return [w, h]
}

const TABS = [
  { key:'front',        label:'Fronte' },
  { key:'inside_front', label:'Seconda' },
  { key:'inside_back',  label:'Terza' },
  { key:'back',         label:'Quarta' },
  { key:'spine',        label:'Dorso' },
]

const DEFAULTS = {
  front:        DEFAULT_COVER_FRONT,
  inside_front: DEFAULT_COVER_INSIDE,
  inside_back:  DEFAULT_COVER_INSIDE,
  back:         DEFAULT_COVER_BACK,
}

// ── SpinePreview (horizontal bar) ─────────────────────────────────────────────
// Horizontal bar: left = testa del libro (top), right = piede (bottom).
// 3 zones: top-aligned items left, center items middle, bottom items right.

function SpinePreview({ spine, albumName, albumYear }) {
  const BAR_H = 72
  const s  = spine || {}
  const bg = s.bg || '#0a0a0e'
  // Font size relative to bar height — capped so it fits
  const fz = (pct, def) => Math.max(9, Math.min(32, Math.round(BAR_H * (pct || def) / 100 * 1.6)))

  const allItems = [
    s.title_enabled !== false && albumName
      ? { pos: s.title_pos || 'center', text: albumName, color: s.title_color||'#f0ede6',
          sz: fz(s.title_size_pct, 2.5), font:'var(--font-display, Georgia, serif)', ls:'0.04em' }
      : null,
    s.subtitle_enabled && albumName
      ? { pos: s.subtitle_pos || 'center', text: '— sottotitolo —', color: s.subtitle_color||'#b8b0a0',
          sz: fz(s.subtitle_size_pct, 1.8), font:'var(--font-body, sans-serif)', ls:'0.02em' }
      : null,
    s.year_enabled !== false && albumYear
      ? { pos: s.year_pos || 'center', text: albumYear, color: s.year_color||'#d4aa5a',
          sz: fz(s.year_size_pct, 1.5), font:'var(--font-mono, monospace)', ls:0 }
      : null,
    s.custom_text_enabled && s.custom_text
      ? { pos: s.custom_text_pos || 'center', text: s.custom_text, color: s.custom_text_color||'#fff',
          sz: fz(s.custom_text_size_pct, 1.8), font:'inherit', ls:0 }
      : null,
  ].filter(Boolean)

  const zone = (pos) => allItems.filter(i => i.pos === pos)
  const renderSpan = (item, i) => (
    <span key={i} style={{ fontSize:item.sz, color:item.color, fontFamily:item.font,
      letterSpacing:item.ls, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
      {item.text}
    </span>
  )

  const rot180 = !!s.spine_rotate_180
  const leftItems  = rot180 ? zone('bottom') : zone('top')
  const rightItems = rot180 ? zone('top')    : zone('bottom')

  return (
    <div style={{ width:'100%', height:BAR_H, background:bg, borderRadius:4, overflow:'hidden',
      display:'flex', alignItems:'stretch', boxShadow:'0 4px 20px rgba(0,0,0,0.45)',
      outline: rot180 ? '1px dashed rgba(212,170,90,0.4)' : 'none' }}>
      {/* Left zone = testa */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-start',
        padding:'0 12px', gap:8, overflow:'hidden', minWidth:0 }}>
        {leftItems.map(renderSpan)}
      </div>
      {/* Center zone */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
        padding:'0 8px', gap:8, overflow:'hidden', minWidth:0 }}>
        {zone('center').map(renderSpan)}
      </div>
      {/* Right zone = piede */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end',
        padding:'0 12px', gap:8, overflow:'hidden', minWidth:0 }}>
        {rightItems.map(renderSpan)}
      </div>
    </div>
  )
}

// ── SpineEditor ───────────────────────────────────────────────────────────────

function SpineEditor({ value, onChange, albumName, albumYear, spineWidthMm, numPages }) {
  const sp = { ...DEFAULT_SPINE, ...value }
  const set = (k, v) => onChange({ ...sp, [k]:v })

  const PosButtons = ({ posKey, currentPos }) => (
    <div style={{ display:'flex', gap:2, flexShrink:0 }}>
      {[['top','↑ Testa'],['center','↔ Centro'],['bottom','↓ Piede']].map(([v, lbl]) => (
        <button key={v} onClick={() => set(posKey, v)}
          style={{ padding:'2px 6px', fontSize:9, borderRadius:4, cursor:'pointer',
            border:`1px solid ${(currentPos||'center')===v ? 'var(--gold)' : 'var(--border)'}`,
            background:(currentPos||'center')===v ? 'var(--gold-dim)' : 'var(--bg3)',
            color:(currentPos||'center')===v ? 'var(--gold)' : 'var(--text3)' }}>
          {lbl}
        </button>
      ))}
    </div>
  )

  const RowToggle = ({ label, enabledKey, colorKey, sizeKey, posKey, children }) => {
    const en = sp[enabledKey] !== false
    return (
      <div style={{ padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:en?8:0 }}>
          <input type="checkbox" checked={en}
            onChange={e => set(enabledKey, e.target.checked)}
            style={{ cursor:'pointer', width:13, height:13, flexShrink:0 }}/>
          <span style={{ fontSize:12, fontWeight:500, color: en ? 'var(--text)' : 'var(--text3)', flex:1, minWidth:80 }}>
            {label}
          </span>
          {en && (
            <>
              <input type="color" value={sp[colorKey]||'#ffffff'}
                onChange={e => set(colorKey, e.target.value)}
                style={{ width:22, height:22, border:'none', cursor:'pointer', borderRadius:3, flexShrink:0 }}/>
            </>
          )}
        </div>
        {en && (
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <label className="text-xs text-muted" style={{ fontSize:10 }}>Dim. %</label>
            <input type="number" className="form-input" style={{ width:90, fontSize:11 }}
              min={0.5} max={6} step={0.1} value={sp[sizeKey]||2.0}
              onChange={e => set(sizeKey, +e.target.value||2.0)}/>
            <PosButtons posKey={posKey} currentPos={sp[posKey]}/>
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Horizontal preview at top */}
      <div>
        <p className="text-xs text-muted" style={{ margin:'0 0 6px', fontSize:10 }}>
          Anteprima — {spineWidthMm} mm · {numPages} pagine
        </p>
        <SpinePreview spine={sp} albumName={albumName} albumYear={albumYear}/>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:3 }}>
          <span style={{ fontSize:9, color:'var(--text3)' }}>← Testa</span>
          <button onClick={() => set('spine_rotate_180', !sp.spine_rotate_180)}
            style={{ padding:'2px 8px', fontSize:9, borderRadius:4, cursor:'pointer',
              border:`1px solid ${sp.spine_rotate_180 ? 'var(--gold)' : 'var(--border)'}`,
              background: sp.spine_rotate_180 ? 'var(--gold-dim)' : 'var(--bg3)',
              color: sp.spine_rotate_180 ? 'var(--gold)' : 'var(--text3)' }}>
            ↻ 180°
          </button>
          <span style={{ fontSize:9, color:'var(--text3)' }}>Piede →</span>
        </div>
      </div>

      {/* Controls */}
      <div>
        {/* Background */}
        <div style={{ padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
          <label className="form-label" style={{ fontSize:11 }}>Colore sfondo</label>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input type="color" value={sp.bg||'#0a0a0e'}
              onChange={e => set('bg', e.target.value)}
              style={{ width:28, height:28, border:'none', cursor:'pointer', borderRadius:4 }}/>
            <span className="text-xs text-muted" style={{ fontSize:10 }}>{sp.bg||'#0a0a0e'}</span>
          </div>
        </div>

        <RowToggle label="Titolo album" enabledKey="title_enabled"
          colorKey="title_color" sizeKey="title_size_pct" posKey="title_pos"/>

        <RowToggle label="Sottotitolo" enabledKey="subtitle_enabled"
          colorKey="subtitle_color" sizeKey="subtitle_size_pct" posKey="subtitle_pos"/>

        <RowToggle label="Anno" enabledKey="year_enabled"
          colorKey="year_color" sizeKey="year_size_pct" posKey="year_pos"/>

        {/* Custom text */}
        <div style={{ padding:'10px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
            <input type="checkbox" checked={!!sp.custom_text_enabled}
              onChange={e => set('custom_text_enabled', e.target.checked)}
              style={{ cursor:'pointer', width:13, height:13, flexShrink:0 }}/>
            <span style={{ fontSize:12, fontWeight:500, flex:1,
              color: sp.custom_text_enabled ? 'var(--text)' : 'var(--text3)' }}>
              Testo personalizzato
            </span>
            {sp.custom_text_enabled && (
              <input type="color" value={sp.custom_text_color||'#ffffff'}
                onChange={e => set('custom_text_color', e.target.value)}
                style={{ width:22, height:22, border:'none', cursor:'pointer', borderRadius:3, flexShrink:0 }}/>
            )}
          </div>
          {sp.custom_text_enabled && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <input type="text" className="form-input"
                placeholder="Testo singola riga…"
                value={sp.custom_text || ''}
                onChange={e => set('custom_text', e.target.value)}
                maxLength={80}
                style={{ fontSize:12 }}/>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <label className="text-xs text-muted" style={{ fontSize:10 }}>Dim. %</label>
                <input type="number" className="form-input" style={{ width:90, fontSize:11 }}
                  min={0.5} max={5} step={0.1} value={sp.custom_text_size_pct||1.8}
                  onChange={e => set('custom_text_size_pct', +e.target.value||1.8)}/>
                <PosButtons posKey="custom_text_pos" currentPos={sp.custom_text_pos}/>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CoverEditorModal ──────────────────────────────────────────────────────────

export default function CoverEditorModal({
  cover: coverProp,
  onChange,
  onClose,
  profile,
  albumInfo,
  mapUrl,
  assets,
  numBodyPages,
  initialTab = 0,
}) {
  const [local, setLocal]   = useState(() => migrateCoverConfig(coverProp, null))
  const [tab, setTab]       = useState(() => initialTab ?? 0)
  const [size, setSize]     = useState({ w:null, h:null })
  const modalRef            = useRef(null)
  const resizeDragRef       = useRef(null)

  const albumName  = albumInfo?.albumName || ''
  const albumYear  = albumInfo?.dateRange ? String(albumInfo.dateRange).slice(-4) : String(new Date().getFullYear())
  const [pw_mm]    = getPageMm(profile)
  const bodyGsm    = profile?.body_paper_gsm ?? 90
  const spineWidthMm = local.spine_width_mm ?? calcSpineWidthMm(numBodyPages || 40, bodyGsm)

  const updateElement = (key, val) => setLocal(prev => ({ ...prev, [key]: val }))

  const canvasWidth = size.w ? Math.max(200, Math.round(size.w - 520)) : 800

  const beginResize = (e, edge) => {
    e.preventDefault(); e.stopPropagation()
    if (!modalRef.current) return
    const rect = modalRef.current.getBoundingClientRect()
    resizeDragRef.current = { edge, sx:e.clientX, sy:e.clientY, iw:rect.width, ih:rect.height }
    const onMove = me => {
      const d = resizeDragRef.current; if (!d) return
      const dx = me.clientX - d.sx, dy = me.clientY - d.sy
      setSize(s => ({
        w: (edge==='e'||edge==='se') ? Math.max(540, d.iw+dx) : s.w,
        h: (edge==='s'||edge==='se') ? Math.max(400, d.ih+dy) : s.h,
      }))
    }
    const onUp = () => { resizeDragRef.current=null; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const currentTabKey = TABS[tab].key
  const isSpine       = currentTabKey === 'spine'

  // DividerEditor canvas dimensions
  const [pw, ph] = getPageMm(profile)
  const divH = Math.round(ph / pw * canvasWidth)

  return createPortal(
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:9200 }}
        onClick={onClose} onWheel={e => e.stopPropagation()}/>
      <div ref={modalRef}
        style={{
          position:'fixed', top:'2%', left:'50%', transform:'translateX(-50%)',
          width:  size.w ? size.w : 'min(1800px, 97vw)',
          height: size.h ? size.h : undefined,
          maxHeight: size.h ? undefined : '93vh',
          background:'var(--bg2)', border:'1px solid var(--border)',
          borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
          zIndex:9201, display:'flex', flexDirection:'column', overflow:'hidden',
        }}
        onWheel={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', gap:14, flexShrink:0, flexWrap:'wrap' }}>
          <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:17, margin:0, marginRight:'auto' }}>
            Stile copertina
          </h3>
          {/* Tab bar */}
          <div style={{ display:'flex', gap:2, background:'var(--bg3)', borderRadius:7, padding:3, border:'1px solid var(--border)' }}>
            {TABS.map((t, i) => (
              <button key={t.key} onClick={() => setTab(i)}
                style={{
                  padding:'4px 12px', borderRadius:5, fontSize:12, border:'none', cursor:'pointer',
                  fontWeight: tab===i ? 600 : 400,
                  background: tab===i ? 'var(--bg)' : 'transparent',
                  color: tab===i ? 'var(--text)' : 'var(--text3)',
                  letterSpacing: tab===i ? '0.01em' : 0,
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-sm btn-primary"
              onClick={() => { onChange(local); onClose() }}>
              Applica
            </button>
            <button onClick={onClose}
              style={{ background:'none', border:'none', fontSize:18, color:'var(--text3)', cursor:'pointer' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:20 }}>
          {isSpine ? (
            <SpineEditor
              value={local.spine || DEFAULT_SPINE}
              onChange={v => updateElement('spine', v)}
              albumName={albumName}
              albumYear={albumYear}
              spineWidthMm={spineWidthMm}
              numPages={numBodyPages || 40}
            />
          ) : (
            <DividerEditor
              value={migrateDividerStyle(local[currentTabKey] || DEFAULTS[currentTabKey])}
              onChange={v => updateElement(currentTabKey, v)}
              profile={profile}
              albumInfo={albumInfo}
              canvasWidth={canvasWidth}
              dividerMapUrl={mapUrl}
              assets={assets}
            />
          )}
        </div>

        {/* Resize handles */}
        <div onMouseDown={e => beginResize(e,'e')}
          style={{ position:'absolute', right:0, top:'15%', width:5, height:'70%', cursor:'ew-resize', zIndex:10 }}/>
        <div onMouseDown={e => beginResize(e,'s')}
          style={{ position:'absolute', bottom:0, left:'15%', height:5, width:'70%', cursor:'ns-resize', zIndex:10 }}/>
        <div onMouseDown={e => beginResize(e,'se')}
          style={{ position:'absolute', right:0, bottom:0, width:18, height:18, cursor:'se-resize', zIndex:11,
            background:'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%)', borderRadius:'0 0 12px 0' }}/>
      </div>
    </>,
    document.body
  )
}
