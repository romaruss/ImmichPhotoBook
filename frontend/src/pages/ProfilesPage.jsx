import { useState, useEffect, useRef, createContext, useContext } from 'react'
import axios from 'axios'
import { useT } from '../i18n.jsx'
import PageTypeEditor from '../components/PageTypeEditor'
import { DEFAULT_COVER_CONFIG, DEFAULT_COVER_FRONT, DEFAULT_COVER_BACK, migrateCoverConfig, calcSpineWidthMm } from '../components/CoverConfig'
import DividerEditor from '../components/DividerEditor'
import CoverEditorModal from '../components/CoverEditorModal'

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
  // Stadia Maps — richiedono API key (gratuita su stadiamaps.com)
  { id:'alidade_smooth',      label:'Alidade Smooth',      desc:'Scuro minimalista',               provider:'stadia' },
  { id:'alidade_smooth_dark', label:'Alidade Dark',        desc:'Molto scuro, alto contrasto',     provider:'stadia' },
  { id:'stamen_terrain',      label:'Terrain',             desc:'Rilievi e contorni naturali',     provider:'stadia' },
  { id:'stamen_toner',        label:'Toner',               desc:'Bianco e nero ad alto contrasto', provider:'stadia' },
  { id:'outdoors',            label:'Outdoors',            desc:'Stile escursionistico/outdoor',   provider:'stadia' },
  // Gratuiti — nessuna API key richiesta
  { id:'osm',                 label:'OpenStreetMap',       desc:'Classico OSM — gratuito',         provider:'free' },
  { id:'carto_light',         label:'CartoDB Light',       desc:'Pulito chiaro — gratuito',        provider:'free' },
  { id:'carto_dark',          label:'CartoDB Dark',        desc:'Scuro moderno — gratuito',        provider:'free' },
  { id:'minimal',             label:'Minimale (PIL)',       desc:'Nessun tile, solo grafica vettoriale', provider:'free' },
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
  cover_style: null,
  cover: null,
  body_paper_gsm: 90,
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
  const pc = useT().profiles
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
        {pc.addCustomFormatTitle}
      </p>
      <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap', marginBottom:12 }}>
        <div>
          <label className="form-label">{pc.formatNameLabel}</label>
          <input className="form-input" style={{ width:150 }} placeholder={pc.formatNamePlaceholder}
            value={newName} onChange={e=>setNewName(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleAdd()}/>
        </div>
        <div>
          <label className="form-label">{pc.formatWidthLabel}</label>
          <input type="number" className="form-input" style={{ width:80 }}
            min={50} max={1200} value={newW} onChange={e=>setNewW(+e.target.value||200)}/>
        </div>
        <div style={{ marginTop:20, color:'var(--text3)' }}>×</div>
        <div>
          <label className="form-label">{pc.formatHeightLabel}</label>
          <input type="number" className="form-input" style={{ width:80 }}
            min={50} max={1200} value={newH} onChange={e=>setNewH(+e.target.value||300)}/>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleAdd}
          disabled={!newName.trim()} style={{ marginBottom:1 }}>
          {pc.formatAddBtn}
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
      <label style={{fontSize:10,color:'var(--text3)',textAlign:'center',lineHeight:1.3,maxWidth:90}}>{label}</label>
      <input type="number" className="form-input" min={0} max={50} step={0.5}
        value={txt}
        onChange={e => { setTxt(e.target.value); commit(e.target.value) }}
        onBlur={e => { commit(e.target.value) }}
        onKeyDown={e => { if(e.key==='Enter') { commit(e.target.value); e.target.blur() } }}
        style={{width:76,textAlign:'center'}}/>
      <span style={{fontSize:9,color:'var(--text3)'}}>mm</span>
    </div>
  )
}

// ── Map live preview panel ────────────────────────────────────────────────────
function MapPreviewPanel({ previewUrl, loading, onRefresh }) {
  const pm = useT().profiles
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, position:'sticky', top:20 }}>
      <label className="form-label" style={{marginBottom:0}}>{pm.mapPreviewLabel}</label>
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
              {pm.mapPreviewClickHint}
            </span>
          )
        }
      </div>
      <button className="btn btn-sm" onClick={onRefresh} disabled={loading}
        style={{fontSize:11, opacity: loading ? 0.6 : 1}}>
        {pm.mapPreviewRefresh(loading)}
      </button>
      <p className="text-xs text-muted" style={{margin:0}}>
        {pm.mapPreviewHint}
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
  const [marginLocked, setMarginLocked] = useState(() => localStorage.getItem('pb_margin_locked') !== '0')
  const [mapPreviewUrl, setMapPreviewUrl]   = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [stadiaKeySet, setStadiaKeySet]     = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle') // 'idle'|'pending'|'saving'|'saved'|'error'
  const [coverEditorOpen, setCoverEditorOpen] = useState(false)
  const previewTimerRef   = useRef(null)
  const autoSaveTimerRef  = useRef(null)
  const originalFormRef   = useRef(null)  // snapshot at edit-start for "Scarta modifiche"
  const formInitKeyRef    = useRef(null)  // JSON key at edit-start to skip spurious first-render save
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
    axios.get('/api/config').then(r => setStadiaKeySet(!!r.data.stadia_api_key_set)).catch(() => {})
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
    showToast(p.formatAddedOk(size.name), 'success')
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
    const data = { ...DEFAULT_PROFILE, ...r.data }
    setForm(data)
    originalFormRef.current = data
    formInitKeyRef.current  = JSON.stringify(data)
    setPtKey(k => k + 1)
    setEditing(r.data)
    setAutoSaveStatus('idle')
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

  // Manual save — only used for new profile creation
  const save = async () => {
    if (!form.name.trim()) { showToast(p.noNameError, 'error'); return }
    setSaving(true)
    try {
      const r = await axios.post('/api/profiles', form)
      const created = r.data
      await loadProfiles()
      // Transition to edit mode so auto-save takes over from here
      const fullProfile = { ...DEFAULT_PROFILE, ...created }
      setForm(fullProfile)
      originalFormRef.current = fullProfile
      formInitKeyRef.current  = JSON.stringify(fullProfile)
      setEditing(created)
      setAutoSaveStatus('idle')
      showToast(p.savedOk, 'success')
    } catch { showToast(p.savedError, 'error') }
    finally { setSaving(false) }
  }

  // Discard: restore server to snapshot taken at edit-start
  const discardChanges = async () => {
    if (!editing || editing === 'new' || !originalFormRef.current) return
    try {
      await axios.put(`/api/profiles/${editing.id}`, originalFormRef.current)
      await loadProfiles()
      setForm({ ...originalFormRef.current })
      formInitKeyRef.current = JSON.stringify(originalFormRef.current)
      setPtKey(k => k + 1)
      setAutoSaveStatus('idle')
      showToast(p.discardOk, 'success')
    } catch { showToast(p.discardError, 'error') }
  }

  // Close: flush any pending auto-save, then exit editor
  const handleClose = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (autoSaveStatus === 'pending' && editing && editing !== 'new' && form.name.trim()) {
      try { await axios.put(`/api/profiles/${editing.id}`, form); await loadProfiles() }
      catch {}
    }
    setEditing(null)
    setAutoSaveStatus('idle')
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

  // ── Auto-save (edit mode only, 800ms debounce) ────────────────────────────────
  const _formKey = JSON.stringify(form)
  useEffect(() => {
    if (!editing || editing === 'new' || !form.name.trim()) return
    if (_formKey === formInitKeyRef.current) return  // skip spurious first-render trigger
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    setAutoSaveStatus('pending')
    const snapshot = form
    const profileId = editing.id
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        await axios.put(`/api/profiles/${profileId}`, snapshot)
        loadProfiles()
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus(s => s === 'saved' ? 'idle' : s), 2500)
      } catch {
        setAutoSaveStatus('error')
      }
    }, 800)
    return () => clearTimeout(autoSaveTimerRef.current)
  }, [_formKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
              <button className="btn btn-sm" style={{fontSize:11}} title={p.exportProfileBtn}
                onClick={()=>{
                  const data={...form,_exported_from:'photobook-studio',_version:1,date:new Date().toISOString()}
                  const a=document.createElement('a')
                  a.href='data:application/json,'+encodeURIComponent(JSON.stringify(data,null,2))
                  a.download=`profilo-${(form.name||'profilo').replace(/\s+/g,'_')}.json`
                  a.click()
                }}>{p.exportProfileBtn}</button>
              <label className="btn btn-sm" style={{fontSize:11,cursor:'pointer'}} title={p.importProfileBtn}>
                {p.importProfileBtn}
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
                        showToast(p.profileImported(d.name||'?'), 'success')
                      } else showToast(p.invalidProfile,'error')
                    }catch{showToast(p.importJsonErr,'error')}
                  }
                  reader.readAsText(file)
                  e.target.value=''
                }}/>
              </label>
              {editing === 'new' ? (
                <>
                  <button className="btn" onClick={() => setEditing(null)}>{p.cancelBtn}</button>
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? <span className="spinner"/> : null} {p.saveBtn}
                  </button>
                </>
              ) : (
                <>
                  <span style={{ fontSize:11, display:'flex', alignItems:'center', gap:4,
                    color: autoSaveStatus==='error' ? '#e05050'
                         : autoSaveStatus==='saving'||autoSaveStatus==='pending' ? 'var(--gold)'
                         : autoSaveStatus==='saved' ? '#4ac585' : 'transparent' }}>
                    {autoSaveStatus==='pending' ? p.autoSavePending
                   : autoSaveStatus==='saving'  ? p.autoSaveSaving
                   : autoSaveStatus==='saved'   ? p.autoSaved
                   : autoSaveStatus==='error'   ? p.autoSaveError : '·'}
                  </span>
                  <button className="btn btn-sm" onClick={discardChanges} title={p.discardBtnTitle}>
                    {p.discardBtn}
                  </button>
                  <button className="btn btn-primary" onClick={handleClose}>
                    {p.closeEditorBtn}
                  </button>
                </>
              )}
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
                    {showCustomSizeMgr ? p.closeCustomFormat : p.addCustomFormat}
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
                    {p.selectedSizeInfo(selectedSizeObj.name, selectedSizeObj.w, selectedSizeObj.h)}
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
              {form.duplex && (
                <p className="text-xs text-muted" style={{marginTop:4,marginLeft:22}}>
                  {p.duplexHint}
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">{p.bodyGsmLabel}
                <span className="text-xs text-muted" style={{fontWeight:400,marginLeft:6}}>
                  {p.bodyGsmHint2}
                </span>
              </label>
              <input type="number" className="form-input" style={{width:100}}
                min={40} max={350} step={10}
                value={form.body_paper_gsm ?? 90}
                onChange={e=>set('body_paper_gsm', +e.target.value)}
                onBlur={e=>set('body_paper_gsm', Math.max(40,Math.min(350,+e.target.value||90)))}/>
              <span className="text-xs text-muted" style={{marginLeft:6}}>
                {p.bodyGsmTypical}
              </span>
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
              const toggleLocked = (val) => {
                setMarginLocked(val)
                localStorage.setItem('pb_margin_locked', val ? '1' : '0')
              }
              return (
                <div>
                  {/* Mode toggle — segmented control */}
                  <div style={{display:'flex',borderRadius:7,overflow:'hidden',
                    border:'1px solid var(--border)',marginBottom:14,fontSize:11}}>
                    <button onClick={()=>toggleLocked(true)}
                      style={{flex:1,padding:'8px 0',border:'none',borderRight:'1px solid var(--border)',
                        cursor:'pointer',fontWeight:marginLocked?600:400,
                        background:marginLocked?'var(--gold-dim)':'var(--bg3)',
                        color:marginLocked?'var(--gold)':'var(--text3)',transition:'background 0.15s,color 0.15s'}}>
                      {p.singleMarginBtn}
                    </button>
                    <button onClick={()=>toggleLocked(false)}
                      style={{flex:1,padding:'8px 0',border:'none',
                        cursor:'pointer',fontWeight:!marginLocked?600:400,
                        background:!marginLocked?'rgba(100,160,200,0.13)':'var(--bg3)',
                        color:!marginLocked?'#7eb8d4':'var(--text3)',transition:'background 0.15s,color 0.15s'}}>
                      {p.multiMarginBtn}
                    </button>
                  </div>

                  {/* Margin inputs */}
                  {marginLocked ? (
                    <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12}}>
                      <MarginInput side="margin_top" label={p.singleMarginDesc}
                        formValue={mv('margin_top')} onCommit={handleMargin}/>
                      <span style={{fontSize:10,color:'var(--text3)',lineHeight:1.5}}>
                        {p.singleMarginNote}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div style={{display:'flex',gap:10,alignItems:'flex-end',marginBottom:6,flexWrap:'wrap'}}>
                        <MarginInput side="margin_top"    label={p.marginTop}    formValue={mv('margin_top')}    onCommit={handleMargin}/>
                        <MarginInput side="margin_bottom" label={p.marginBottom} formValue={mv('margin_bottom')} onCommit={handleMargin}/>
                        <MarginInput side="margin_left"   label={p.marginOuter}  formValue={mv('margin_left')}   onCommit={handleMargin}/>
                        <MarginInput side="margin_right"  label={p.marginInner}  formValue={mv('margin_right')}  onCommit={handleMargin}/>
                      </div>
                      <p style={{fontSize:10,color:'var(--text3)',lineHeight:1.4,marginBottom:12}}>
                        {p.innerMarginHint}
                      </p>
                    </div>
                  )}

                  {/* Gap + Bleed + Crop marks — compact row */}
                  <div style={{display:'flex',gap:0,alignItems:'stretch',flexWrap:'wrap',
                    paddingTop:12,borderTop:'1px solid var(--border)'}}>
                    {/* Spazio tra foto */}
                    <div style={{display:'flex',flexDirection:'column',gap:5,
                      paddingRight:20,marginRight:20,borderRight:'1px solid var(--border)'}}>
                      <label style={{fontSize:10,color:'var(--text3)'}}>{p.gapSubLabel}</label>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <input type="number" className="form-input" min={0} max={30} step={0.5}
                          defaultValue={form.gap_mm} style={{width:76}}
                          onBlur={e=>{ const v=parseFloat(e.target.value); if(!isNaN(v)) set('gap_mm',v) }}
                          onKeyDown={e=>{ if(e.key==='Enter'){ const v=parseFloat(e.target.value); if(!isNaN(v)) set('gap_mm',v); e.target.blur() }}}/>
                        <span style={{fontSize:10,color:'var(--text3)'}}>mm</span>
                      </div>
                    </div>

                    {/* Abbondanza */}
                    <div style={{display:'flex',flexDirection:'column',gap:5,
                      paddingRight:20,marginRight:20,borderRight:'1px solid var(--border)'}}>
                      <label style={{fontSize:10,color:'var(--text3)'}}>{p.bleedSubLabel}</label>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <label className="checkbox-label" style={{flexShrink:0}}>
                          <input type="checkbox" checked={form.bleed} onChange={e=>set('bleed',e.target.checked)}/>
                          {p.bleedActiveLabel}
                        </label>
                        <input type="number" className="form-input" min={0} max={10} step={0.5}
                          value={form.bleed_mm} disabled={!form.bleed}
                          onChange={e=>set('bleed_mm',parseFloat(e.target.value))}
                          style={{width:70,opacity:form.bleed?1:0.4}}/>
                        <span style={{fontSize:10,color:'var(--text3)',opacity:form.bleed?1:0.4}}>mm</span>
                      </div>
                    </div>

                    {/* Crocini di stampa */}
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      <label style={{fontSize:10,color:'var(--text3)'}}>{p.cropMarksSubLabel}</label>
                      <label className="checkbox-label" style={{fontSize:11}}>
                        <input type="checkbox" checked={!!form.crop_marks}
                          onChange={e=>set('crop_marks',e.target.checked)}/>
                        {p.bleedActiveLabel}
                      </label>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CollapsibleCard>

          {/* ── PDF export ──────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.pdfExportCard}>
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">{p.dpiLabel2}</label>
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
                <label className="form-label">{p.colorProfileLabel2}</label>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{p.colorGroupRgb}</span>
                      <div style={{display:'flex',gap:4}}>
                        {['srgb','adobe_rgb'].map(v=>(
                          <button key={v} onClick={()=>set('color_profile',v)} title={p.colorProfileDesc[v]}
                            style={{padding:'4px 8px',fontSize:10,borderRadius:5,cursor:'pointer',
                              border:`1px solid ${form.color_profile===v?'var(--gold)':'var(--border)'}`,
                              background:form.color_profile===v?'var(--gold-dim)':'var(--bg3)',
                              color:form.color_profile===v?'var(--gold)':'var(--text2)'}}>
                            {p.colorProfiles[v]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{p.colorGroupCmyk2}</span>
                      <div style={{display:'flex',gap:4}}>
                        {['fogra39','fogra51','swop'].map(v=>(
                          <button key={v} onClick={()=>set('color_profile',v)} title={p.colorProfileDesc[v]}
                            style={{padding:'4px 8px',fontSize:10,borderRadius:5,cursor:'pointer',
                              border:`1px solid ${form.color_profile===v?'#7eb8d4':'var(--border)'}`,
                              background:form.color_profile===v?'rgba(126,184,212,0.15)':'var(--bg3)',
                              color:form.color_profile===v?'#7eb8d4':'var(--text2)'}}>
                            {p.colorProfiles[v]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted" style={{lineHeight:1.5}}>
                    {p.colorProfileStatus[form.color_profile]}
                  </p>
                </div>
              </div>
            </div>
          </CollapsibleCard>

          {/* ── Divisore di album ────────────────────────────────────────────── */}
          <CollapsibleCard title={p.dividerCard}
            actions={
              <p className="text-xs text-muted" style={{margin:0,whiteSpace:'nowrap'}}>
                {p.dividerCardHint}
              </p>
            }>
            <DividerEditor
              value={form.divider_style}
              onChange={ds => set('divider_style', ds)}
              profile={form}
              canvasWidth={460}
            />
          </CollapsibleCard>

          {/* ── Page types ──────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.pageTypesCard}
            actions={<>
              <button className="btn btn-sm" style={{fontSize:10}} title={p.exportLayoutsTitle}
                onClick={()=>{
                  const data={page_types:form.page_types,exported_from:form.name,date:new Date().toISOString()}
                  const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(data,null,2))
                  a.download=`layouts-${(form.name||'profilo').replace(/\s+/g,'_')}.json`;a.click()
                }}>{p.exportLayouts}</button>
              <label className="btn btn-sm" style={{fontSize:10,cursor:'pointer'}} title={p.importLayoutsTitle}>
                {p.importLayouts}
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
                          const choice = window.confirm(p.importLayoutsConfirm(d.page_types.length, d.exported_from, existing.length))
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

          {/* ── Caption style ────────────────────────────────────────────────── */}
          <CollapsibleCard title={p.captionCard}>
            <p className="text-sm text-muted mb-4">{p.captionCardHint2}</p>
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
                      <label className="form-label">{p.captionFontLabel}</label>
                      <select className="form-select" value={cs.font||'Georgia, serif'}
                        onChange={e=>setCs('font', e.target.value)}>
                        {FONTS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{p.captionSizeLabel}</label>
                      <input type="number" className="form-input" min={8} max={72} step={1}
                        value={cs.size||13} onChange={e=>setCs('size', +e.target.value)}/>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{p.captionColorLabel}</label>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <input type="color" value={cs.color||'#e8e6e0'}
                          onChange={e=>setCs('color', e.target.value)}
                          style={{ width:40, height:34, padding:2, border:'1px solid var(--border)', borderRadius:5, cursor:'pointer' }}/>
                        <input className="form-input" style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:12 }}
                          value={cs.color||'#e8e6e0'} onChange={e=>setCs('color', e.target.value)}/>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{p.captionBgLabel}</label>
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
                      <label className="form-label">{p.captionStyleLabel}</label>
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
                      <label className="form-label">{p.captionAlignHLabel}</label>
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
                      <label className="form-label">{p.captionAlignVLabel}</label>
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
                    <label className="form-label">{p.captionPreviewLabel}</label>
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
          <CollapsibleCard title={p.mapCard} defaultOpen={false}
            actions={<>
              <button className="btn btn-sm" style={{fontSize:10}}
                onClick={()=>{
                  const a=document.createElement('a')
                  a.href='data:application/json,'+encodeURIComponent(JSON.stringify(ms,null,2))
                  a.download=`map-style-${(form.name||'profilo').replace(/\s+/g,'_')}.json`
                  a.click()
                }}>{p.mapExportBtn}</button>
              <label className="btn btn-sm" style={{fontSize:10,cursor:'pointer'}}>
                {p.mapImportBtn}
                <input type="file" accept=".json" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0]; if(!file) return
                  const r=new FileReader(); r.onload=ev=>{
                    try{
                      const d=JSON.parse(ev.target.result)
                      set('map_style', {...DEFAULT_MAP_STYLE, ...d})
                      showToast(p.mapImportedOk, 'success')
                    }catch{ showToast(p.importJsonErr, 'error') }
                  }; r.readAsText(file); e.target.value=''
                }}/>
              </label>
              <button className="btn btn-sm" style={{fontSize:10}}
                onClick={()=>set('map_style', {...DEFAULT_MAP_STYLE})}>
                {p.mapDefaultBtn}
              </button>
            </>}>

            {/* Main grid: settings left, live preview right */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 316px', gap:28, alignItems:'start'}}>

              {/* ── Settings column ── */}
              <div style={{display:'flex', flexDirection:'column', gap:20}}>

                {/* Tile style */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">{p.tileProviderLabel}</label>
                  <p className="text-xs text-muted" style={{marginBottom:8}}>
                    {p.tileProviderHint(p.impostazioni).split(p.impostazioni)[0]}
                    <a href="#" onClick={e=>{e.preventDefault();window.location.href='/config'}}
                      style={{color:'var(--gold)'}}>{p.impostazioni}</a>
                    {p.tileProviderHint(p.impostazioni).split(p.impostazioni)[1]}
                    {!stadiaKeySet && <span style={{color:'var(--danger)',marginLeft:6}}>{p.stadiaKeyMissing}</span>}
                  </p>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    {TILE_STYLES.map(ts => {
                      const needsKey = ts.provider === 'stadia'
                      const warn = needsKey && !stadiaKeySet
                      return (
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
                          <div style={{flex:1}}>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <span style={{fontSize:12,color:'var(--text)',fontWeight:ms.tile_style===ts.id?600:400}}>
                                {ts.label}
                              </span>
                              <span style={{fontSize:9,padding:'1px 5px',borderRadius:3,
                                background: needsKey ? 'rgba(200,80,80,0.18)' : 'rgba(80,180,80,0.18)',
                                color: needsKey ? (warn?'var(--danger)':'var(--text3)') : '#6db96d',
                                border: `1px solid ${needsKey?(warn?'rgba(200,80,80,0.4)':'var(--border)'):'rgba(80,180,80,0.3)'}`,
                              }}>
                                {needsKey ? (stadiaKeySet ? p.tileStadiaBadge : p.tileKeyMissing) : p.tileFreeLabel}
                              </span>
                            </div>
                            <div style={{fontSize:10,color:'var(--text3)'}}>{p.tileDescs[ts.id] || ts.desc}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/* Marker */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">{p.markerLabel}</label>

                  {/* Shape selector */}
                  <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap'}}>
                    {MARKER_SHAPES.map(sh => (
                      <button key={sh.id}
                        onClick={()=>setMs('marker_shape', sh.id)}
                        title={p.markerShapeLabels[sh.id] || sh.label}
                        style={{
                          display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                          padding:'8px 10px', borderRadius:6, cursor:'pointer', border:'none',
                          background: ms.marker_shape===sh.id ? 'var(--gold-dim)' : 'var(--bg3)',
                          outline: ms.marker_shape===sh.id ? '1.5px solid var(--gold)' : '1.5px solid var(--border)',
                        }}>
                        {sh.icon(ms.marker_color || '#d4aa5a')}
                        <span style={{fontSize:10, color: ms.marker_shape===sh.id ? 'var(--gold)' : 'var(--text3)'}}>
                          {p.markerShapeLabels[sh.id] || sh.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Color + Size */}
                  <div style={{display:'flex',gap:16,alignItems:'flex-end',flexWrap:'wrap'}}>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>{p.markerColorLabel2}</span>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <input type="color" value={ms.marker_color}
                          onChange={e=>setMs('marker_color',e.target.value)}
                          style={{width:36,height:36,border:'none',cursor:'pointer',borderRadius:4}}/>
                        <input className="form-input" style={{width:80,fontFamily:'var(--font-mono)',fontSize:11}}
                          value={ms.marker_color} onChange={e=>setMs('marker_color',e.target.value)}/>
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <span style={{fontSize:11,color:'var(--text3)'}}>{p.markerSizeLabel2}</span>
                      <input type="number" className="form-input" min={4} max={30} step={1}
                        value={ms.marker_size} onChange={e=>setMs('marker_size',+e.target.value)}
                        style={{width:70}}/>
                    </div>
                  </div>
                </div>

                {/* Route */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">{p.routeLabel}</label>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                      <input type="checkbox" checked={ms.show_route}
                        onChange={e=>setMs('show_route',e.target.checked)}
                        style={{accentColor:'var(--gold)'}}/>
                      <span style={{fontSize:12,color:'var(--text)'}}>{p.routeShowLabel}</span>
                    </label>
                    <div style={{display:'flex',gap:16,alignItems:'flex-end',flexWrap:'wrap',opacity:ms.show_route?1:0.4}}>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <span style={{fontSize:11,color:'var(--text3)'}}>{p.routeColorLabel}</span>
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
                        <span style={{fontSize:11,color:'var(--text3)'}}>{p.routeThicknessLabel}</span>
                        <input type="number" className="form-input" min={1} max={8} step={1}
                          value={ms.route_width} onChange={e=>setMs('route_width',+e.target.value)}
                          disabled={!ms.show_route} style={{width:70}}/>
                      </div>
                    </div>
                  </div>
                </div>

                {/* PIL fallback colors */}
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">{p.pilFallbackCard}</label>
                  <p className="text-xs text-muted" style={{marginBottom:8}}>
                    {p.pilFallbackHint}
                  </p>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {[
                      ['bg_color',    p.pilBgLabel],
                      ['grid_color',  p.pilGridLabel],
                      ['label_color', p.pilLabelLabel],
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

          {/* ── Copertina settings ──────────────────────────────────────────── */}
          <CollapsibleCard title={p.coverCard2} defaultOpen={false}
            actions={<>
              <button className="btn btn-sm btn-primary" style={{fontSize:10}}
                onClick={()=>setCoverEditorOpen(true)}>
                {p.coverEditBtn}
              </button>
              <button className="btn btn-sm" style={{fontSize:10}}
                onClick={()=>{
                  const cov = migrateCoverConfig(form.cover, form.cover_style)
                  const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(cov,null,2))
                  a.download=`cover-${(form.name||'profilo').replace(/\s+/g,'_')}.json`;a.click()
                }}>{p.coverExportBtn}</button>
              <label className="btn btn-sm" style={{fontSize:10,cursor:'pointer'}}>
                {p.coverImportBtn}
                <input type="file" accept=".json" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0]; if(!file) return
                  const r=new FileReader(); r.onload=ev=>{
                    try{const d=JSON.parse(ev.target.result);set('cover',d);showToast(p.importCoverOk,'success')}
                    catch{showToast(p.importCoverErr,'error')}
                  };r.readAsText(file);e.target.value=''
                }}/>
              </label>
            </>}>
            <p className="text-sm text-muted mb-4">{p.coverDesc}</p>

            {/* Dorso */}
            <div style={{display:'flex',flexDirection:'column',gap:10,padding:'12px',
              background:'var(--bg3)',borderRadius:8,border:'1px solid var(--border)',marginBottom:12}}>
              <p style={{margin:0,fontSize:12,fontWeight:600,color:'var(--text)'}}>{p.coverSpineSectionLabel}</p>
              {(()=>{
                const cover     = migrateCoverConfig(form.cover, form.cover_style)
                const numPages  = 100
                const bodyGsm   = form.body_paper_gsm ?? 90
                const estimated = calcSpineWidthMm(numPages, bodyGsm)
                const override  = cover.spine_width_mm
                const displayW  = override ?? estimated
                return (
                  <>
                    <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                      <div className="form-group" style={{marginBottom:0,flex:'1 1 140px'}}>
                        <label className="form-label" style={{fontSize:11}}>{p.coverSpineWidthLabel}</label>
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          <input type="number" className="form-input" style={{width:80}}
                            min={1} max={80} step={0.5}
                            value={displayW}
                            onChange={e=>set('cover',{...cover,spine_width_mm:Math.max(1,Math.min(80,+e.target.value||5))})}/>
                          <button className="btn btn-sm" style={{fontSize:10}}
                            title={p.coverSpineAutoTitle}
                            onClick={()=>set('cover',{...cover,spine_width_mm:null})}>
                            {p.coverSpineAutoBtn(override!==null&&override!==undefined)}
                          </button>
                        </div>
                        <p className="text-xs text-muted" style={{marginTop:2}}>
                          {p.coverSpineEstimate(estimated, bodyGsm)}
                        </p>
                      </div>
                      <div className="form-group" style={{marginBottom:0,flex:'1 1 140px'}}>
                        <label className="form-label" style={{fontSize:11}}>{p.coverGsmLabel}</label>
                        <input type="number" className="form-input" style={{width:80}}
                          min={100} max={600} step={10}
                          value={cover.cover_paper_gsm ?? 300}
                          onChange={e=>set('cover',{...cover,cover_paper_gsm:+e.target.value})}
                          onBlur={e=>set('cover',{...cover,cover_paper_gsm:Math.max(100,Math.min(600,+e.target.value||300))})}/>
                        <span className="text-xs text-muted" style={{marginLeft:6}}>{p.coverGsmTypical}</span>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Export options — mutually exclusive */}
            {(()=>{
              const cover = migrateCoverConfig(form.cover, form.cover_style)
              const setExportMode = (mode) => set('cover', {
                ...cover,
                export_as_spread:      mode === 'spread',
                export_cover_separate: mode === 'separate',
              })
              const mode = cover.export_as_spread ? 'spread' : cover.export_cover_separate ? 'separate' : 'none'
              const te = t.export
              return (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <label className="checkbox-label">
                    <input type="radio" name="cover_export_mode" value="none"
                      checked={mode==='none'} onChange={()=>setExportMode('none')}/>
                    <span>{te.coverNone}</span>
                  </label>
                  <label className="checkbox-label">
                    <input type="radio" name="cover_export_mode" value="spread"
                      checked={mode==='spread'} onChange={()=>setExportMode('spread')}/>
                    <span>
                      {te.coverSpread}
                      <span className="text-xs text-muted" style={{marginLeft:6,fontWeight:400}}>
                        {te.coverSpreadHint}
                      </span>
                    </span>
                  </label>
                  <label className="checkbox-label">
                    <input type="radio" name="cover_export_mode" value="separate"
                      checked={mode==='separate'} onChange={()=>setExportMode('separate')}/>
                    <span>
                      {te.coverSeparate}
                      <span className="text-xs text-muted" style={{marginLeft:6,fontWeight:400}}>
                        {te.coverSeparateHint}
                      </span>
                    </span>
                  </label>
                </div>
              )
            })()}
          </CollapsibleCard>

        </div>
        {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
        {coverEditorOpen && (
          <CoverEditorModal
            cover={form.cover}
            onChange={newCover => set('cover', newCover)}
            onClose={() => setCoverEditorOpen(false)}
            profile={form}
            albumInfo={{ albumName: form.name || p.newTitle, assetCount: 0, dateRange: '' }}
            numBodyPages={100}
          />
        )}
        {editing !== 'new' && autoSaveStatus !== 'idle' && (
          <div style={{
            position:'fixed', bottom:24, right:24, zIndex:9999,
            padding:'8px 16px', borderRadius:8, fontSize:12, fontWeight:500,
            boxShadow:'0 4px 16px rgba(0,0,0,0.35)',
            background:'var(--bg2)', border:'1px solid var(--border)',
            color: autoSaveStatus==='error'   ? '#e05050'
                 : autoSaveStatus==='saving'||autoSaveStatus==='pending' ? 'var(--gold)'
                 : '#4ac585',
            transition:'opacity 0.3s',
          }}>
            {autoSaveStatus==='pending' ? p.autoSavePending
           : autoSaveStatus==='saving'  ? p.autoSaveSaving
           : autoSaveStatus==='saved'   ? p.autoSaved
           : p.autoSaveError}
          </div>
        )}
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
                    {getSizeLabel(prof.page_size)} · {prof.orientation==='portrait' ? p.portraitShort : p.landscapeShort}
                    {prof.duplex ? ` · ${p.duplexShort}` : ''}
                    {prof.bleed ? ` · ${p.bleedInfo(prof.bleed_mm)}` : ''}
                    {` · ${p.pageTypesCount((prof.page_types||[]).length)}`}
                  </p>
                </div>
                <div className="profile-item-actions">
                  <button className="btn btn-sm" onClick={()=>startEdit(prof)}>{p.editBtn}</button>
                  <button className="btn btn-sm" onClick={()=>duplicate(prof)} title={p.duplicateBtn}>
                    {p.duplicateBtn}
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
