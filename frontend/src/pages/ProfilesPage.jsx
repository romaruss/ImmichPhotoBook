import { useState, useEffect, useRef, createContext, useContext } from 'react'
import axios from 'axios'
import { useT } from '../i18n.jsx'
import PageTypeEditor from '../components/PageTypeEditor'
import CoverStyleEditor, { DEFAULT_COVER } from '../components/CoverEditor'

// Standard page sizes with mm dimensions
const STANDARD_SIZES = [
  { id:'A4',     name:'A4',     w:210, h:297 },
  { id:'A3',     name:'A3',     w:297, h:420 },
  { id:'A5',     name:'A5',     w:148, h:210 },
  { id:'20x20',  name:'20×20',  w:200, h:200 },
  { id:'20x30',  name:'20×30',  w:200, h:300 },
  { id:'30x30',  name:'30×30',  w:300, h:300 },
  { id:'30x40',  name:'30×40',  w:300, h:400 },
  { id:'Letter', name:'Letter', w:216, h:279 },
]

const TILE_STYLES = [
  { id:'alidade_smooth',      label:'Alidade Smooth',       desc:'Scuro minimalista (default)' },
  { id:'alidade_smooth_dark', label:'Alidade Dark',          desc:'Molto scuro, alto contrasto' },
  { id:'stamen_terrain',      label:'Terrain',              desc:'Rilievi e contorni naturali' },
  { id:'stamen_toner',        label:'Toner',                desc:'Bianco e nero ad alto contrasto' },
  { id:'osm_bright',          label:'OSM Bright',           desc:'Classico OpenStreetMap chiaro' },
  { id:'outdoors',            label:'Outdoors',             desc:'Stile escursionistico/outdoor' },
]

const DEFAULT_MAP_STYLE = {
  tile_style:    'alidade_smooth',
  marker_color:  '#d4aa5a',
  marker_size:   10,
  marker_shape:  'circle',
  show_route:    true,
  route_color:   '#b48a3a',
  route_width:   2,
  bg_color:      '#0d1117',
  grid_color:    '#19202a',
  label_color:   '#c8b994',
}

const MARKER_SHAPES = [
  { id: 'circle',  label: 'Cerchio',  icon: (c) =>
    <svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="9" fill={c} fillOpacity=".25"/><circle cx="14" cy="14" r="5" fill={c}/></svg> },
  { id: 'square',  label: 'Quadrato', icon: (c) =>
    <svg width="28" height="28" viewBox="0 0 28 28"><rect x="5" y="5" width="18" height="18" fill={c} fillOpacity=".25"/><rect x="9" y="9" width="10" height="10" fill={c}/></svg> },
  { id: 'diamond', label: 'Rombo',    icon: (c) =>
    <svg width="28" height="28" viewBox="0 0 28 28"><polygon points="14,3 25,14 14,25 3,14" fill={c} fillOpacity=".25"/><polygon points="14,8 20,14 14,20 8,14" fill={c}/></svg> },
  { id: 'pin',     label: 'Pin',      icon: (c) =>
    <svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="10" r="8" fill={c} fillOpacity=".25"/><polygon points="10,14 18,14 14,25" fill={c} fillOpacity=".25"/><circle cx="14" cy="10" r="5" fill={c}/></svg> },
]

const DEFAULT_PROFILE = {
  name:'', page_size:'20x30', orientation:'portrait', duplex:false,
  margin_mm:5, margin_top:5, margin_right:5, margin_bottom:5, margin_left:5,
  bleed:false, bleed_mm:3, gap_mm:3, page_types:[],
  export_dpi: 300,
  color_profile: 'srgb',
  caption_style:{ font:'Georgia, serif', size:13, color:'#e8e6e0', align:'center', valign:'center', bg:'#111116', italic:true, bold:false },
  cover_style: { ...DEFAULT_COVER },
  map_style: { ...DEFAULT_MAP_STYLE },
}

// ── Section open/close state persisted in session ────────────────────────────
const SectionOpenCtx = createContext(null)

// ── Collapsible card ──────────────────────────────────────────────────────────
function CollapsibleCard({ title, defaultOpen = true, actions, children }) {
  const openMap = useContext(SectionOpenCtx)
  const [open, setOpen] = useState(() =>
    openMap && title in openMap.current ? openMap.current[title] : defaultOpen
  )
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (openMap) {
      openMap.current[title] = next
      try { sessionStorage.setItem('pb_profile_sections', JSON.stringify(openMap.current)) }
      catch {}
    }
  }
  return (
    <div className="card" style={{ padding:0, overflow:'hidden' }}>
      <div
        style={{
          display:'flex', alignItems:'center', gap:8,
          padding:'12px 20px', cursor:'pointer',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          background:'var(--bg3)', userSelect:'none',
        }}
        onClick={toggle}
      >
        <span style={{
          fontSize:9, color:'var(--text3)', display:'inline-block', flexShrink:0,
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition:'transform 0.15s',
        }}>▶</span>
        <span className="card-title" style={{ margin:0, flex:1 }}>{title}</span>
        {actions && (
          <div onClick={e => e.stopPropagation()} style={{ display:'flex', gap:6 }}>
            {actions}
          </div>
        )}
      </div>
      {open && <div style={{ padding:'16px 20px' }}>{children}</div>}
    </div>
  )
}

// ── Custom size manager panel ─────────────────────────────────────────────────
function CustomSizeManager({ customSizes, onAdd, onDelete }) {
  const [newName, setNewName] = useState('')
  const [newW, setNewW]       = useState(200)
  const [newH, setNewH]       = useState(300)

  const handleAdd = async () => {
    if (!newName.trim()) return
    await onAdd({ name: newName.trim(), w_mm: newW, h_mm: newH })
    setNewName('')
  }

  return (
    <div style={{ background:'var(--bg3)', border:'1px solid var(--border)',
      borderRadius:8, padding:16, marginBottom:12 }}>
      <p style={{ fontSize:11, fontWeight:600, color:'var(--text)', marginBottom:10 }}>
        Aggiungi formato personalizzato
      </p>
      <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap', marginBottom:12 }}>
        <div>
          <label className="form-label">Nome formato</label>
          <input className="form-input" style={{ width:150 }} placeholder="es. 21×21 quadrato"
            value={newName} onChange={e=>setNewName(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleAdd()}/>
        </div>
        <div>
          <label className="form-label">Larghezza (mm)</label>
          <input type="number" className="form-input" style={{ width:80 }}
            min={50} max={1200} value={newW} onChange={e=>setNewW(+e.target.value||200)}/>
        </div>
        <div style={{ marginTop:20, color:'var(--text3)' }}>×</div>
        <div>
          <label className="form-label">Altezza (mm)</label>
          <input type="number" className="form-input" style={{ width:80 }}
            min={50} max={1200} value={newH} onChange={e=>setNewH(+e.target.value||300)}/>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleAdd}
          disabled={!newName.trim()} style={{ marginBottom:1 }}>
          + Aggiungi
        </button>
      </div>

      {customSizes.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {customSizes.map(cs=>(
            <div key={cs.id} style={{ display:'flex', alignItems:'center', gap:6,
              background:'var(--bg2)', border:'1px solid var(--border)',
              borderRadius:5, padding:'4px 10px', fontSize:11 }}>
              <span style={{ color:'var(--text)' }}>{cs.name}</span>
              <span style={{ color:'var(--text3)', fontFamily:'var(--font-mono)', fontSize:10 }}>
                {cs.w_mm}×{cs.h_mm}mm
              </span>
              <button onClick={()=>onDelete(cs.id)}
                style={{ background:'none', border:'none', color:'var(--text3)',
                  cursor:'pointer', fontSize:13, lineHeight:1, padding:'0 0 0 4px' }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Margin input: uncontrolled locally to avoid focus loss ────────────────────
function MarginInput({ side, label, formValue, onCommit }) {
  const [txt, setTxt] = useState(String(formValue ?? 5))
  useEffect(() => { setTxt(String(formValue ?? 5)) }, [formValue])
  const commit = (raw) => {
    const v = parseFloat(raw)
    onCommit(side, isNaN(v) ? 0 : v)
  }
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
      <label style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{label}</label>
      <input type="number" className="form-input" min={0} max={50} step={0.5}
        value={txt}
        onChange={e => setTxt(e.target.value)}
        onBlur={e => { commit(e.target.value) }}
        onKeyDown={e => { if(e.key==='Enter') { commit(e.target.value); e.target.blur() } }}
        style={{width:64,textAlign:'center'}}/>
      <span style={{fontSize:9,color:'var(--text3)'}}>mm</span>
    </div>
  )
}

// ── Map live preview panel ────────────────────────────────────────────────────
function MapPreviewPanel({ previewUrl, loading, onRefresh }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, position:'sticky', top:20 }}>
      <label className="form-label" style={{marginBottom:0}}>Anteprima live · Torino</label>
      <div style={{
        width:300, height:300, borderRadius:8, overflow:'hidden',
        background:'var(--bg3)', border:'1px solid var(--border)',
        display:'flex', alignItems:'center', justifyContent:'center',
        position:'relative', flexShrink:0,
      }}>
        {loading && (
          <div style={{
            position:'absolute', inset:0, display:'flex', alignItems:'center',
            justifyContent:'center', background:'rgba(0,0,0,.5)', zIndex:2,
          }}>
            <span style={{color:'var(--gold)', fontSize:24}}>⟳</span>
          </div>
        )}
        {previewUrl
          ? <img src={previewUrl} alt="map preview"
              style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}}/>
          : !loading && (
            <span style={{color:'var(--text3)', fontSize:12, textAlign:'center', padding:16}}>
              Clicca "Aggiorna" per generare l'anteprima
            </span>
          )
        }
      </div>
      <button className="btn btn-sm" onClick={onRefresh} disabled={loading}
        style={{fontSize:11, opacity: loading ? 0.6 : 1}}>
        {loading ? '⟳ Caricamento…' : '↺ Aggiorna anteprima'}
      </button>
      <p className="text-xs text-muted" style={{margin:0}}>
        Usa il renderer PIL (fallback). Le tile online si vedono nell'album.
      </p>
    </div>
  )
}

export default function ProfilesPage() {
  const t = useT()
  const p = t.profiles
  const [profiles, setProfiles]       = useState([])
  const [customSizes, setCustomSizes] = useState([])
  const [editing, setEditing]         = useState(null)
  const [form, setForm]               = useState(DEFAULT_PROFILE)
  const [saving, setSaving]           = useState(false)
  const [toast, setToast]             = useState(null)
  const [showCustomSizeMgr, setShowCustomSizeMgr] = useState(false)
  const [ptKey, setPtKey]             = useState(0)
  const [marginLocked, setMarginLocked] = useState(true)
  const [mapPreviewUrl, setMapPreviewUrl]   = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewTimerRef  = useRef(null)
  const sectionOpenRef   = useRef((() => {
    try { return JSON.parse(sessionStorage.getItem('pb_profile_sections') || '{}') }
    catch { return {} }
  })())

  const refreshMapPreview = async (style) => {
    setPreviewLoading(true)
    try {
      const resp = await axios.post('/api/map-preview', { map_style: style }, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      setMapPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    } catch {}
    finally { setPreviewLoading(false) }
  }

  useEffect(() => {
    loadProfiles()
    loadCustomSizes()
  }, [])

  const loadProfiles = async () => {
    try {
      const r = await axios.get('/api/profiles')
      setProfiles(r.data)
    } catch {}
  }

  const loadCustomSizes = async () => {
    try {
      const r = await axios.get('/api/custom-sizes')
      setCustomSizes(r.data)
    } catch {}
  }

  const addCustomSize = async (size) => {
    const r = await axios.post('/api/custom-sizes', size)
    setCustomSizes(prev => [...prev, r.data])
    showToast(`Formato "${size.name}" aggiunto ✓`, 'success')
  }

  const deleteCustomSize = async (sid) => {
    await axios.delete(`/api/custom-sizes/${sid}`)
    setCustomSizes(prev => prev.filter(cs => cs.id !== sid))
  }

  const startNew = () => {
    setForm({ ...DEFAULT_PROFILE, page_types:[] })
    setPtKey(0)
    setEditing('new')
  }

  const startEdit = async (profile) => {
    const r = await axios.get(`/api/profiles/${profile.id}`)
    setForm({ ...DEFAULT_PROFILE, ...r.data })
    setPtKey(k => k + 1)
    setEditing(r.data)
  }

  const duplicate = async (profile) => {
    try {
      await axios.post(`/api/profiles/${profile.id}/duplicate`)
      await loadProfiles()
      showToast(p.duplicateOk, 'success')
    } catch {
      showToast(p.duplicateError, 'error')
    }
  }

  const save = async () => {
    if (!form.name.trim()) { showToast(p.noNameError, 'error'); return }
    setSaving(true)
    try {
      if (editing === 'new') await axios.post('/api/profiles', form)
      else await axios.put(`/api/profiles/${editing.id}`, form)
      await loadProfiles()
      setEditing(null)
      showToast(p.savedOk, 'success')
    } catch { showToast(p.savedError, 'error') }
    finally { setSaving(false) }
  }

  const del = async (profile) => {
    if (!confirm(p.deleteConfirm(profile.name))) return
    await axios.delete(`/api/profiles/${profile.id}`)
    loadProfiles()
  }

  const showToast = (msg, type) => {
    setToast({msg,type})
    setTimeout(()=>setToast(null), 3000)
  }

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }))

  const allSizes = [
    ...STANDARD_SIZES,
    ...customSizes.map(cs => ({ id: cs.id, name: cs.name, w: cs.w_mm, h: cs.h_mm, custom: true })),
  ]

  const selectedSizeObj = allSizes.find(s => s.id === form.page_size)

  // ── Debounced map preview refresh when map_style changes ─────────────────────
  const _mapStyleKey = JSON.stringify(form.map_style)
  useEffect(() => {
    if (!editing) return
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    previewTimerRef.current = setTimeout(() => {
      refreshMapPreview({ ...DEFAULT_MAP_STYLE, ...(form.map_style || {}) })
    }, 700)
    return () => clearTimeout(previewTimerRef.current)
  }, [_mapStyleKey, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Editor view ───────────────────────────────────────────────────────────────
  if (editing) {
    const ms    = { ...DEFAULT_MAP_STYLE, ...(form.map_style || {}) }
    const setMs = (k, v) => set('map_style', { ...ms, [k]: v })

    return (
      <SectionOpenCtx.Provider value={sectionOpenRef}>
        <div className="page-header">
          <div className="flex items-center justify-between">
            <div>
              <h2>{editing === 'new' ? p.newTitle : `${p.editTitle} ${editing.name}`}</h2>
              <span className="text-muted">{p.subtitle2}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-sm" style={{fontSize:11}} title="Esporta profilo completo come JSON"
                onClick={()=>{
                  const data={...form,_exported_from:'photobook-studio',_version:1,date:new Date().toISOString()}
                  const a=document.createElement('a')
                  a.href='data:application/json,'+encodeURIComponent(JSON.stringify(data,null,2))
                  a.download=`profilo-${(form.name||'profilo').replace(/\s+/g,'_')}.json`
                  a.click()
                }}>⬇ Esporta profilo</button>
              <label className="btn btn-sm" style={{fontSize:11,cursor:'pointer'}} title="Importa profilo da JSON">
                ⬆ Importa profilo
                <input type="file" accept=".json" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0]; if(!file) return
                  const reader=new FileReader()
                  reader.onload=ev=>{
                    try{
                      const d=JSON.parse(ev.target.result)
                      if(d && (d.page_size || d.page_types)){
                        const imported={...DEFAULT_PROFILE,...d}
                        delete imported._exported_from; delete imported._version; delete imported.date
                        delete imported.id
                        setForm(imported)
                        setPtKey(k => k + 1)
                        showToast(`✓ Profilo "${d.name||'?'}" importato`, 'success')
                      } else showToast('File non valido: non è un profilo PhotoBook','error')
                    }catch{showToast('Errore nel leggere il file JSON','error')}
                  }
                  reader.readAsText(file)
                  e.target.value=''
                }}/>
              </label>
              <button className="btn" onClick={() => setEditing(null)}>{p.cancelBtn}</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner"/> : null} {p.saveBtn}
              </button>
            </div>
          </div>
        </div>
        <div className="page-body">

          {/* ── General ─────────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.generalCard}>
            <div className="form-group">
              <label className="form-label">{p.nameLabel}</label>
              <input className="form-input" placeholder={p.namePlaceholder}
                value={form.name} onChange={e=>set('name',e.target.value)}/>
            </div>
          </CollapsibleCard>

          {/* ── Format ──────────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.formatCard}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" style={{ display:'flex', justifyContent:'space-between' }}>
                  <span>{p.pageSizeLabel}</span>
                  <button className="btn btn-sm" style={{ fontSize:10 }}
                    onClick={()=>setShowCustomSizeMgr(s=>!s)}>
                    {showCustomSizeMgr ? '✕ Chiudi' : '+ Formato custom'}
                  </button>
                </label>

                {showCustomSizeMgr && (
                  <CustomSizeManager
                    customSizes={customSizes}
                    onAdd={addCustomSize}
                    onDelete={deleteCustomSize}/>
                )}

                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:4 }}>
                  {allSizes.map(sz => {
                    const active = form.page_size === sz.id
                    return (
                      <button key={sz.id} onClick={()=>set('page_size', sz.id)}
                        style={{
                          padding:'6px 12px', borderRadius:5, cursor:'pointer', fontSize:12,
                          border:`2px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                          background: active ? 'var(--gold-dim)' : 'var(--bg3)',
                          color: active ? 'var(--gold)' : 'var(--text2)',
                          fontFamily: 'var(--font-mono)',
                        }}>
                        <div style={{ fontWeight:600 }}>{sz.name}</div>
                        <div style={{ fontSize:10, opacity:0.7 }}>{sz.w}×{sz.h}mm</div>
                        {sz.custom && <div style={{ fontSize:9, color:'var(--gold)', opacity:0.7 }}>custom</div>}
                      </button>
                    )
                  })}
                </div>
                {selectedSizeObj && (
                  <p className="text-xs text-muted mt-2">
                    Selezionato: <strong>{selectedSizeObj.name}</strong> — {selectedSizeObj.w}×{selectedSizeObj.h}mm
                  </p>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">{p.orientLabel}</label>
                <select className="form-select" value={form.orientation} onChange={e=>set('orientation',e.target.value)}>
                  <option value="portrait">{p.portrait}</option>
                  <option value="landscape">{p.landscape}</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.duplex} onChange={e=>set('duplex',e.target.checked)}/>
                {p.duplexLabel}
              </label>
            </div>
          </CollapsibleCard>

          {/* ── Margins ─────────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.marginsCard}>
            {(()=>{
              const handleMargin = (side, v) => {
                if (marginLocked) {
                  set('margin_top', v); set('margin_right', v)
                  set('margin_bottom', v); set('margin_left', v)
                  set('margin_mm', v)
                } else {
                  set(side, v)
                  const sides = ['margin_top','margin_right','margin_bottom','margin_left']
                  const vals = sides.map(s => s===side ? v : (form[s]??form.margin_mm??5))
                  set('margin_mm', parseFloat((vals.reduce((a,b)=>a+b,0)/4).toFixed(2)))
                }
              }
              const mv = (side) => form[side] ?? form.margin_mm ?? 5
              return (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:10}}>
                    <span className="text-xs text-muted">Margini (mm)</span>
                    <button onClick={()=>setMarginLocked(l=>!l)}
                      style={{padding:'2px 8px',borderRadius:5,border:'1px solid var(--border)',
                        cursor:'pointer',fontSize:10,
                        background:marginLocked?'var(--gold-dim)':'var(--bg3)',
                        color:marginLocked?'var(--gold)':'var(--text3)'}}>
                      {marginLocked?p.marginLocked:p.marginUnlocked}
                    </button>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8,maxWidth:320}}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <MarginInput side="margin_top" label={p.marginTop} formValue={mv('margin_top')} onCommit={handleMargin}/>
                      <div style={{flex:1,height:1,background:'var(--border)'}}/>
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'flex-end'}}>
                      <MarginInput side="margin_left" label={p.marginOuter} formValue={mv('margin_left')} onCommit={handleMargin}/>
                      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'0 4px'}}>
                        <span style={{fontSize:9,color:'var(--text3)',textAlign:'center',lineHeight:1.3}}>Rilegatura → interno</span>
                        <div style={{width:'100%',height:1,background:'var(--border)'}}/>
                        <span style={{fontSize:9,color:'var(--text3)',textAlign:'center'}}>← esterno</span>
                      </div>
                      <MarginInput side="margin_right" label={p.marginInner} formValue={mv('margin_right')} onCommit={handleMargin}/>
                    </div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <MarginInput side="margin_bottom" label={p.marginBottom} formValue={mv('margin_bottom')} onCommit={handleMargin}/>
                      <div style={{flex:1,height:1,background:'var(--border)'}}/>
                    </div>
                    <p style={{fontSize:10,color:'var(--text3)',lineHeight:1.4,marginTop:2}}>
                      {p.marginBindingNote}
                    </p>
                  </div>
                </div>
              )
            })()}
            <div className="form-row" style={{marginTop:16}}>
              <div className="form-group">
                <label className="form-label">{p.gapLabel}</label>
                <input type="number" className="form-input" min={0} max={30} step={0.5}
                  defaultValue={form.gap_mm}
                  onBlur={e=>{ const v=parseFloat(e.target.value); if(!isNaN(v)) set('gap_mm',v) }}
                  onKeyDown={e=>{ if(e.key==='Enter'){ const v=parseFloat(e.target.value); if(!isNaN(v)) set('gap_mm',v); e.target.blur() }}}/>
                <p className="text-xs text-muted mt-1">{p.gapHint}</p>
              </div>
              <div className="form-group">
                <label className="form-label">{p.bleedLabel}</label>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <label className="checkbox-label" style={{ flexShrink:0 }}>
                    <input type="checkbox" checked={form.bleed} onChange={e=>set('bleed',e.target.checked)}/>
                    {p.bleedActive}
                  </label>
                  <input type="number" className="form-input" min={0} max={10} step={0.5}
                    value={form.bleed_mm} disabled={!form.bleed}
                    onChange={e=>set('bleed_mm',parseFloat(e.target.value))}
                    style={{ opacity:form.bleed?1:0.4 }}/>
                </div>
                <p className="text-xs text-muted mt-1">{p.bleedHint}</p>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input type="checkbox" checked={!!form.crop_marks}
                    onChange={e=>set('crop_marks', e.target.checked)}/>
                  {p.cropMarksLabel || 'Crocini di stampa'}
                </label>
                <p className="text-xs text-muted mt-1">
                  {p.cropMarksHint || 'Segni di taglio agli angoli per la tipografia. Richiede abbondanza attiva.'}
                </p>
              </div>
            </div>
          </CollapsibleCard>

          {/* ── PDF export ──────────────────────────────────────────────────── */}
          <CollapsibleCard title="Esportazione PDF">
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">Risoluzione foto</label>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <input type="number" className="form-input" min={72} max={600} step={1}
                    defaultValue={form.export_dpi||300}
                    onBlur={e=>{ const v=parseInt(e.target.value); if(!isNaN(v)&&v>=72) set('export_dpi',v) }}
                    onKeyDown={e=>{ if(e.key==='Enter'){const v=parseInt(e.target.value);if(!isNaN(v)&&v>=72){set('export_dpi',v);e.target.blur()}} }}
                    style={{width:80}}/>
                  <span style={{fontSize:12,color:'var(--text3)'}}>dpi</span>
                </div>
                <p className="text-xs text-muted mt-1">{p.exportDpiHint}</p>
              </div>

              <div className="form-group" style={{gridColumn:'span 2'}}>
                <label className="form-label">Profilo colore</label>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>RGB</span>
                      <div style={{display:'flex',gap:4}}>
                        {[
                          ['srgb',      'sRGB IEC61966',   'Standard web e consumer.'],
                          ['adobe_rgb', 'Adobe RGB (1998)', 'Gamut più ampio. Per laboratori professionali.'],
                        ].map(([v,lbl,hint])=>(
                          <button key={v} onClick={()=>set('color_profile',v)} title={hint}
                            style={{padding:'4px 8px',fontSize:10,borderRadius:5,cursor:'pointer',
                              border:`1px solid ${form.color_profile===v?'var(--gold)':'var(--border)'}`,
                              background:form.color_profile===v?'var(--gold-dim)':'var(--bg3)',
                              color:form.color_profile===v?'var(--gold)':'var(--text2)'}}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>CMYK — per offset professionale</span>
                      <div style={{display:'flex',gap:4}}>
                        {[
                          ['fogra39', 'FOGRA39', 'ISO Coated v2 — standard europeo.'],
                          ['fogra51', 'FOGRA51', 'PSO Coated v3 — versione aggiornata.'],
                          ['swop',    'SWOP',    'US Web Coated — standard USA.'],
                        ].map(([v,lbl,hint])=>(
                          <button key={v} onClick={()=>set('color_profile',v)} title={hint}
                            style={{padding:'4px 8px',fontSize:10,borderRadius:5,cursor:'pointer',
                              border:`1px solid ${form.color_profile===v?'#7eb8d4':'var(--border)'}`,
                              background:form.color_profile===v?'rgba(126,184,212,0.15)':'var(--bg3)',
                              color:form.color_profile===v?'#7eb8d4':'var(--text2)'}}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted" style={{lineHeight:1.5}}>
                    {form.color_profile==='fogra39' && '✓ FOGRA39 (ISO Coated v2) — profilo disponibile sul sistema'}
                    {form.color_profile==='fogra51' && '⚠ FOGRA51 — richiede ICC file installato sul server.'}
                    {form.color_profile==='swop'    && '⚠ SWOP — richiede ICC file installato sul server.'}
                    {form.color_profile==='adobe_rgb' && '⚠ Adobe RGB — verifica con il laboratorio.'}
                    {form.color_profile==='srgb'    && 'sRGB: profilo standard, compatibile con tutti i laboratori.'}
                  </p>
                </div>
              </div>
            </div>
          </CollapsibleCard>

          {/* ── Divisore di album ────────────────────────────────────────────── */}
          <CollapsibleCard title="Divisore di album"
            actions={
              <p className="text-xs text-muted" style={{margin:0,whiteSpace:'nowrap'}}>
                Pagina separatrice tra album — sempre su pagina dispari (destra)
              </p>
            }>
            <div className="form-row-3" style={{marginBottom:16}}>
              <div className="form-group">
                <label className="form-label">Sfondo</label>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input type="color"
                    value={(form.divider_style||{}).bg||'#13141a'}
                    onChange={e=>set('divider_style',{...(form.divider_style||{}),bg:e.target.value})}
                    style={{width:36,height:36,border:'none',cursor:'pointer',borderRadius:4}}/>
                  <span className="text-xs text-muted">{(form.divider_style||{}).bg||'#13141a'}</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Colore accento</label>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input type="color"
                    value={(form.divider_style||{}).accent_color||'#d4aa5a'}
                    onChange={e=>set('divider_style',{...(form.divider_style||{}),accent_color:e.target.value})}
                    style={{width:36,height:36,border:'none',cursor:'pointer',borderRadius:4}}/>
                  <span className="text-xs text-muted">{(form.divider_style||{}).accent_color||'#d4aa5a'}</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Colore testo</label>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input type="color"
                    value={(form.divider_style||{}).text_color||'#f0ede6'}
                    onChange={e=>set('divider_style',{...(form.divider_style||{}),text_color:e.target.value})}
                    style={{width:36,height:36,border:'none',cursor:'pointer',borderRadius:4}}/>
                  <span className="text-xs text-muted">{(form.divider_style||{}).text_color||'#f0ede6'}</span>
                </div>
              </div>
            </div>

            <div style={{marginBottom:8}}>
              <p className="text-sm text-muted" style={{marginBottom:8}}>
                Layout slots della pagina divisore. Oltre a foto e didascalie puoi inserire
                contenuto dinamico: <strong>nome album</strong>, <strong>numero foto</strong>,
                <strong>anno</strong>, <strong>mappa GPS</strong>.
              </p>
              <PageTypeEditor
                key={`divider_${ptKey}`}
                pageTypes={form.divider_style?.page_types || [
                  {id:'div_default',label:'Default',slots:[{x:0,y:0,w:100,h:100}]}
                ]}
                onChange={pts => set('divider_style', {
                  ...(form.divider_style||{}),
                  page_types: pts,
                  slots: pts[0]?.slots || [],
                })}
                extraItemTypes={[
                  {type:'album_name',  label:'📛 Nome album',   icon:'📛'},
                  {type:'photo_count', label:'🔢 Numero foto',  icon:'🔢'},
                  {type:'year',        label:'📅 Anno',         icon:'📅'},
                  {type:'map',         label:'🗺 Mappa GPS',    icon:'🗺'},
                ]}
              />
            </div>
            {(()=>{
              const ds = form.divider_style || {}
              const bg = ds.bg || '#13141a'
              const accent = ds.accent_color || '#d4aa5a'
              const textColor = ds.text_color || '#f0ede6'
              const sizeEntry = allSizes.find(s => s.id === form.page_size) || {w:200,h:300}
              let [pw, ph] = [sizeEntry.w, sizeEntry.h]
              if (form.orientation === 'landscape') [pw, ph] = [ph, pw]
              const maxW = 160, scale = maxW / pw
              const W = maxW, H = Math.round(ph * scale)
              return (
                <div style={{marginTop:12,display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                  <p className="text-xs text-muted">Anteprima divisore</p>
                  <div style={{width:W,height:H,background:bg,borderRadius:3,
                    boxShadow:'0 4px 16px rgba(0,0,0,0.5)',overflow:'hidden',
                    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8}}>
                    <div style={{width:'55%',height:1,background:accent+'88'}}/>
                    <p style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:Math.round(14*scale),
                      color:textColor,textAlign:'center',margin:0}}>
                      {form.name || 'Nome album'}
                    </p>
                    <p style={{fontSize:Math.round(8*scale),color:accent,fontFamily:'var(--font-mono)',margin:0}}>
                      42 fotografie · 2024
                    </p>
                    <div style={{width:'55%',height:1,background:accent+'88'}}/>
                  </div>
                </div>
              )
            })()}
          </CollapsibleCard>

          <div style={{display:'flex',justifyContent:'flex-end',marginTop:-6,marginBottom:4}}>
            <button className="btn btn-sm btn-primary" style={{fontSize:10,padding:'3px 10px'}}
              onClick={save} disabled={saving}>{saving?p.saving:p.saveQuick}</button>
          </div>

          {/* ── Page types ──────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.pageTypesCard}
            actions={<>
              <button className="btn btn-sm" style={{fontSize:10}} title="Esporta layout pagine come JSON"
                onClick={()=>{
                  const data={page_types:form.page_types,exported_from:form.name,date:new Date().toISOString()}
                  const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(data,null,2))
                  a.download=`layouts-${(form.name||'profilo').replace(/\s+/g,'_')}.json`;a.click()
                }}>⬇ Esporta layout</button>
              <label className="btn btn-sm" style={{fontSize:10,cursor:'pointer'}} title="Importa layout da JSON">
                ⬆ Importa layout
                <input type="file" accept=".json" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0]; if(!file) return
                  const r=new FileReader(); r.onload=ev=>{
                    try{
                      const d=JSON.parse(ev.target.result)
                      if(d.page_types&&Array.isArray(d.page_types)){
                        const existing = form.page_types || []
                        let merged
                        if(existing.length === 0){
                          merged = d.page_types
                        } else {
                          const choice = window.confirm(
                            `Importare ${d.page_types.length} layout da "${d.exported_from || 'file'}"?\n\n` +
                            `OK = Aggiungi ai ${existing.length} layout esistenti\n` +
                            `Annulla = Sostituisci tutti i layout esistenti`
                          )
                          merged = choice ? [...existing, ...d.page_types] : d.page_types
                        }
                        set('page_types', merged)
                        setPtKey(k => k + 1)
                        showToast(p.importLayoutsOk(d.page_types.length, d.exported_from), 'success')
                      } else showToast(p.importLayoutsErr,'error')
                    }catch{showToast(p.importJsonErr,'error')}
                  }; r.readAsText(file)
                  e.target.value=''
                }}/>
              </label>
            </>}>
            <p className="text-sm text-muted mb-4">{p.pageTypesHint}</p>
            <PageTypeEditor
              key={`${editing === 'new' ? 'new' : editing.id}_${ptKey}`}
              pageTypes={form.page_types}
              orientation={form.orientation}
              onChange={pt => set('page_types', pt)}
            />
          </CollapsibleCard>

          <div style={{display:'flex',justifyContent:'flex-end',marginTop:-6,marginBottom:4}}>
            <button className="btn btn-sm btn-primary" style={{fontSize:10,padding:'3px 10px'}}
              onClick={save} disabled={saving}>{saving?p.saving:p.saveQuick}</button>
          </div>

          {/* ── Caption style ────────────────────────────────────────────────── */}
          <CollapsibleCard title="Stile didascalie">
            <p className="text-sm text-muted mb-4">
              Stile di default per tutte le didascalie di questo profilo. Ogni didascalia può avere uno stile personalizzato.
            </p>
            {(() => {
              const cs = form.caption_style || {}
              const setCs = (key, val) => set('caption_style', { ...cs, [key]: val })
              const FONTS = [
                { label:'Georgia (serif)',      value:'Georgia, serif' },
                { label:'Times New Roman',      value:'"Times New Roman", serif' },
                { label:'Garamond',             value:'Garamond, serif' },
                { label:'Helvetica / Arial',    value:'Helvetica, Arial, sans-serif' },
                { label:'Futura / Trebuchet',   value:'"Trebuchet MS", sans-serif' },
                { label:'Courier (mono)',        value:'"Courier New", monospace' },
              ]
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Font</label>
                      <select className="form-select" value={cs.font||'Georgia, serif'}
                        onChange={e=>setCs('font', e.target.value)}>
                        {FONTS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Dimensione (px)</label>
                      <input type="number" className="form-input" min={8} max={72} step={1}
                        value={cs.size||13} onChange={e=>setCs('size', +e.target.value)}/>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Colore testo</label>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <input type="color" value={cs.color||'#e8e6e0'}
                          onChange={e=>setCs('color', e.target.value)}
                          style={{ width:40, height:34, padding:2, border:'1px solid var(--border)', borderRadius:5, cursor:'pointer' }}/>
                        <input className="form-input" style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:12 }}
                          value={cs.color||'#e8e6e0'} onChange={e=>setCs('color', e.target.value)}/>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Colore sfondo</label>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <input type="color" value={cs.bg||'#111116'}
                          onChange={e=>setCs('bg', e.target.value)}
                          style={{ width:40, height:34, padding:2, border:'1px solid var(--border)', borderRadius:5, cursor:'pointer' }}/>
                        <input className="form-input" style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:12 }}
                          value={cs.bg||'#111116'} onChange={e=>setCs('bg', e.target.value)}/>
                      </div>
                    </div>
                  </div>

                  <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
                    <div className="form-group">
                      <label className="form-label">Stile</label>
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={()=>setCs('bold', !cs.bold)}
                          style={{ width:36,height:34,borderRadius:5,border:'1px solid var(--border)',
                            cursor:'pointer',fontWeight:'bold',fontSize:14,
                            background:cs.bold?'var(--gold-dim)':'var(--bg3)',
                            color:cs.bold?'var(--gold)':'var(--text2)' }}>B</button>
                        <button onClick={()=>setCs('italic', !cs.italic)}
                          style={{ width:36,height:34,borderRadius:5,border:'1px solid var(--border)',
                            cursor:'pointer',fontStyle:'italic',fontSize:14,
                            background:cs.italic?'var(--gold-dim)':'var(--bg3)',
                            color:cs.italic?'var(--gold)':'var(--text2)' }}>I</button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Allineamento orizzontale</label>
                      <div style={{ display:'flex', gap:6 }}>
                        {[['left','←'],['center','↔'],['right','→']].map(([v,icon])=>(
                          <button key={v} onClick={()=>setCs('align', v)}
                            style={{ width:36,height:34,borderRadius:5,border:'1px solid var(--border)',
                              cursor:'pointer',fontSize:14,
                              background:cs.align===v?'var(--gold-dim)':'var(--bg3)',
                              color:cs.align===v?'var(--gold)':'var(--text2)' }}>{icon}</button>
                        ))}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Allineamento verticale</label>
                      <div style={{ display:'flex', gap:6 }}>
                        {[['flex-start','↑'],['center','↕'],['flex-end','↓']].map(([v,icon])=>(
                          <button key={v} onClick={()=>setCs('valign', v)}
                            style={{ width:36,height:34,borderRadius:5,border:'1px solid var(--border)',
                              cursor:'pointer',fontSize:14,
                              background:cs.valign===v?'var(--gold-dim)':'var(--bg3)',
                              color:cs.valign===v?'var(--gold)':'var(--text2)' }}>{icon}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Anteprima</label>
                    <div style={{
                      height:70, background:cs.bg||'#111116', borderRadius:6,
                      display:'flex', alignItems:cs.valign||'center', justifyContent:cs.align||'center',
                      padding:'8px 16px', border:'1px solid var(--border)',
                    }}>
                      <span style={{
                        fontFamily: cs.font||'Georgia, serif',
                        fontSize: Math.min(cs.size||13, 18),
                        color: cs.color||'#e8e6e0',
                        fontWeight: cs.bold ? 'bold' : 'normal',
                        fontStyle: cs.italic ? 'italic' : 'normal',
                        textAlign: cs.align||'center',
                      }}>
                        {p.captionPreview}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CollapsibleCard>

          {/* ── GPS Map style ────────────────────────────────────────────────── */}
          <CollapsibleCard title="🗺 Stile mappa GPS" defaultOpen={false}
            actions={<>
              <button className="btn btn-sm" style={{fontSize:10}}
                title="Esporta impostazioni mappa come JSON"
                onClick={()=>{
                  const a=document.createElement('a')
                  a.href='data:application/json,'+encodeURIComponent(JSON.stringify(ms,null,2))
                  a.download=`map-style-${(form.name||'profilo').replace(/\s+/g,'_')}.json`
                  a.click()
                }}>⬇ Esporta</button>
              <label className="btn btn-sm" style={{fontSize:10,cursor:'pointer'}}
                title="Importa impostazioni mappa da JSON">
                ⬆ Importa
                <input type="file" accept=".json" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0]; if(!file) return
                  const r=new FileReader(); r.onload=ev=>{
                    try{
                      const d=JSON.parse(ev.target.result)
                      set('map_style', {...DEFAULT_MAP_STYLE, ...d})
                      showToast('✓ Stile mappa importato', 'success')
                    }catch{ showToast('Errore nel leggere il file JSON', 'error') }
                  }; r.readAsText(file); e.target.value=''
                }}/>
              </label>
              <button className="btn btn-sm" style={{fontSize:10}}
                onClick={()=>set('map_style', {...DEFAULT_MAP_STYLE})}>
                ↺ Default
              </button>
            </>}>

            {/* Main grid: settings left, live preview right */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 316px', gap:28, alignItems:'start'}}>

              {/* ── Settings column ── */}
              <div style={{display:'flex', flexDirection:'column', gap:20}}>

                {/* Tile style */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Stile tiles online (Stadia Maps)</label>
                  <p className="text-xs text-muted" style={{marginBottom:8}}>
                    Richiede API key. Senza key viene usato il renderer PIL (colori a destra).
                  </p>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    {TILE_STYLES.map(ts => (
                      <label key={ts.id}
                        style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',
                          padding:'6px 10px',borderRadius:5,
                          background: ms.tile_style===ts.id ? 'var(--gold-dim)' : 'var(--bg3)',
                          border:`1px solid ${ms.tile_style===ts.id?'var(--gold)':'var(--border)'}`,
                        }}>
                        <input type="radio" name="tile_style" value={ts.id}
                          checked={ms.tile_style===ts.id}
                          onChange={()=>setMs('tile_style',ts.id)}
                          style={{accentColor:'var(--gold)'}}/>
                        <div>
                          <div style={{fontSize:12,color:'var(--text)',fontWeight:ms.tile_style===ts.id?600:400}}>
                            {ts.label}
                          </div>
                          <div style={{fontSize:10,color:'var(--text3)'}}>{ts.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Marker */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Marcatore posizione</label>

                  {/* Shape selector */}
                  <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap'}}>
                    {MARKER_SHAPES.map(sh => (
                      <button key={sh.id}
                        onClick={()=>setMs('marker_shape', sh.id)}
                        title={sh.label}
                        style={{
                          display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                          padding:'8px 10px', borderRadius:6, cursor:'pointer', border:'none',
                          background: ms.marker_shape===sh.id ? 'var(--gold-dim)' : 'var(--bg3)',
                          outline: ms.marker_shape===sh.id ? '1.5px solid var(--gold)' : '1.5px solid var(--border)',
                        }}>
                        {sh.icon(ms.marker_color || '#d4aa5a')}
                        <span style={{fontSize:10, color: ms.marker_shape===sh.id ? 'var(--gold)' : 'var(--text3)'}}>
                          {sh.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Color + Size */}
                  <div style={{display:'flex',gap:16,alignItems:'flex-end',flexWrap:'wrap'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>Colore</span>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <input type="color" value={ms.marker_color}
                          onChange={e=>setMs('marker_color',e.target.value)}
                          style={{width:36,height:36,border:'none',cursor:'pointer',borderRadius:4}}/>
                        <input className="form-input" style={{width:80,fontFamily:'var(--font-mono)',fontSize:11}}
                          value={ms.marker_color} onChange={e=>setMs('marker_color',e.target.value)}/>
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>Dimensione px</span>
                      <input type="number" className="form-input" min={4} max={30} step={1}
                        value={ms.marker_size} onChange={e=>setMs('marker_size',+e.target.value)}
                        style={{width:70}}/>
                    </div>
                  </div>
                </div>

                {/* Route */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Linea percorso</label>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                      <input type="checkbox" checked={ms.show_route}
                        onChange={e=>setMs('show_route',e.target.checked)}
                        style={{accentColor:'var(--gold)'}}/>
                      <span style={{fontSize:12,color:'var(--text)'}}>Mostra linea di percorso</span>
                    </label>
                    <div style={{display:'flex',gap:16,alignItems:'flex-end',flexWrap:'wrap',opacity:ms.show_route?1:0.4}}>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <span style={{fontSize:11,color:'var(--text3)'}}>Colore</span>
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          <input type="color" value={ms.route_color}
                            onChange={e=>setMs('route_color',e.target.value)}
                            disabled={!ms.show_route}
                            style={{width:36,height:36,border:'none',cursor:'pointer',borderRadius:4}}/>
                          <input className="form-input" style={{width:80,fontFamily:'var(--font-mono)',fontSize:11}}
                            value={ms.route_color} onChange={e=>setMs('route_color',e.target.value)}
                            disabled={!ms.show_route}/>
                        </div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <span style={{fontSize:11,color:'var(--text3)'}}>Spessore px</span>
                        <input type="number" className="form-input" min={1} max={8} step={1}
                          value={ms.route_width} onChange={e=>setMs('route_width',+e.target.value)}
                          disabled={!ms.show_route} style={{width:70}}/>
                      </div>
                    </div>
                  </div>
                </div>

                {/* PIL fallback colors */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Colori renderer PIL (fallback)</label>
                  <p className="text-xs text-muted" style={{marginBottom:8}}>
                    Sfondo, griglia ed etichette quando le tiles online non sono disponibili.
                  </p>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {[
                      ['bg_color',    'Sfondo'],
                      ['grid_color',  'Griglia'],
                      ['label_color', 'Etichette'],
                    ].map(([key, label]) => (
                      <div key={key} style={{display:'flex',alignItems:'center',gap:8}}>
                        <input type="color" value={ms[key]}
                          onChange={e=>setMs(key,e.target.value)}
                          style={{width:28,height:28,border:'none',cursor:'pointer',borderRadius:3}}/>
                        <input className="form-input" style={{width:80,fontFamily:'var(--font-mono)',fontSize:11}}
                          value={ms[key]} onChange={e=>setMs(key,e.target.value)}/>
                        <span style={{fontSize:12,color:'var(--text3)'}}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* ── Live preview column ── */}
              <MapPreviewPanel
                previewUrl={mapPreviewUrl}
                loading={previewLoading}
                onRefresh={() => refreshMapPreview(ms)}
              />

            </div>

          </CollapsibleCard>

          {/* ── Cover editor ────────────────────────────────────────────────── */}
          <CollapsibleCard title="Stile copertina" defaultOpen={false}
            actions={<>
              <button className="btn btn-sm" style={{fontSize:10}} title="Esporta stile copertina"
                onClick={()=>{
                  const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(form.cover_style||{},null,2))
                  a.download=`cover-style-${(form.name||'profilo').replace(/\s+/g,'_')}.json`;a.click()
                }}>⬇ Esporta stile</button>
              <label className="btn btn-sm" style={{fontSize:10,cursor:'pointer'}} title="Importa stile copertina">
                ⬆ Importa stile
                <input type="file" accept=".json" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0]; if(!file) return
                  const r=new FileReader(); r.onload=ev=>{
                    try{const d=JSON.parse(ev.target.result);set('cover_style',d);showToast(p.importCoverOk,'success')}
                    catch{showToast(p.importCoverErr,'error')}
                  };r.readAsText(file);e.target.value=''
                }}/>
              </label>
            </>}>
            <p className="text-sm text-muted mb-4">
              Imposta il layout visivo della copertina per questo profilo. Puoi salvare stili personalizzati riutilizzabili.
            </p>
            {(()=>{
              const sizeEntry = allSizes.find(s => s.id === form.page_size) || {w:200,h:300}
              let [pw, ph] = [sizeEntry.w, sizeEntry.h]
              if (form.orientation === 'landscape') [pw, ph] = [ph, pw]
              const maxD = 160
              const isLand = form.orientation === 'landscape'
              const cW = isLand ? maxD : Math.round(maxD * pw / ph)
              const cH = isLand ? Math.round(maxD * ph / pw) : maxD
              return (
                <CoverStyleEditor
                  value={form.cover_style || DEFAULT_COVER}
                  onChange={cs => set('cover_style', cs)}
                  albumName={form.name || p.namePlaceholder.replace('es. ','')}
                  coverWidth={cW}
                  coverHeight={cH}
                  mapUrl={null}/>
              )
            })()}
          </CollapsibleCard>

          <div style={{display:'flex',justifyContent:'flex-end',marginTop:-6,marginBottom:4}}>
            <button className="btn btn-sm btn-primary" style={{fontSize:10,padding:'3px 10px'}}
              onClick={save} disabled={saving}>{saving?p.saving:p.saveQuick}</button>
          </div>

        </div>
        {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
      </SectionOpenCtx.Provider>
    )
  }

  // ── Profile list view ─────────────────────────────────────────────────────────
  const getSizeLabel = (page_size) => {
    const found = allSizes.find(s => s.id === page_size)
    return found ? `${found.name} (${found.w}×${found.h}mm)` : page_size
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2>{p.title}</h2>
            <span className="text-muted">{p.subtitle}</span>
          </div>
          <button className="btn btn-primary" onClick={startNew}>{p.newBtn}</button>
        </div>
      </div>
      <div className="page-body">
        {profiles.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📐</div>
            <h3>{p.noProfiles}</h3>
            <p>{p.noProfilesHint}</p>
            <button className="btn btn-primary mt-4" onClick={startNew}>{p.createBtn}</button>
          </div>
        ) : (
          <div className="profile-list">
            {profiles.map(prof=>(
              <div key={prof.id} className="profile-item">
                <div className="profile-item-info">
                  <h3>{prof.name}</h3>
                  <p>
                    {getSizeLabel(prof.page_size)} · {prof.orientation==='portrait'?p.portrait.split(' ')[0]:p.landscape.split(' ')[0]}
                    {prof.duplex?' · F/R':''}
                    {prof.bleed?` · Abbondanza ${prof.bleed_mm}mm`:''}
                    {` · ${(prof.page_types||[]).length} pagine tipo`}
                  </p>
                </div>
                <div className="profile-item-actions">
                  <button className="btn btn-sm" onClick={()=>startEdit(prof)}>{p.editBtn}</button>
                  <button className="btn btn-sm" onClick={()=>duplicate(prof)} title="Duplica profilo">
                    ⧉ Duplica
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={()=>del(prof)}>{p.deleteBtn}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </>
  )
}
