import { useState, useEffect } from 'react'
import axios from 'axios'
import { useT } from '../i18n.jsx'
import PageTypeEditor from '../components/PageTypeEditor'

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

const DEFAULT_PROFILE = {
  name:'', page_size:'20x30', orientation:'portrait', duplex:false,
  margin_mm:5, bleed:false, bleed_mm:3, gap_mm:3, page_types:[],
  caption_style:{ font:'Georgia, serif', size:13, color:'#e8e6e0', align:'center', valign:'center', bg:'#111116', italic:true, bold:false },
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

// ── Main ProfilesPage ─────────────────────────────────────────────────────────
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
    setEditing('new')
  }

  const startEdit = async (profile) => {
    const r = await axios.get(`/api/profiles/${profile.id}`)
    setForm(r.data)
    setEditing(r.data)
  }

  const duplicate = async (profile) => {
    try {
      await axios.post(`/api/profiles/${profile.id}/duplicate`)
      await loadProfiles()
      showToast('Profilo duplicato ✓', 'success')
    } catch {
      showToast('Errore nella duplicazione', 'error')
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

  // All sizes: standard + custom, with mm dimensions
  const allSizes = [
    ...STANDARD_SIZES,
    ...customSizes.map(cs => ({ id: cs.id, name: cs.name, w: cs.w_mm, h: cs.h_mm, custom: true })),
  ]

  const selectedSizeObj = allSizes.find(s => s.id === form.page_size)

  // ── Editor view ───────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <>
        <div className="page-header">
          <div className="flex items-center justify-between">
            <div>
              <h2>{editing === 'new' ? p.newTitle : `${p.editTitle} ${editing.name}`}</h2>
              <span className="text-muted">{p.subtitle2}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setEditing(null)}>{p.cancelBtn}</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner"/> : null} {p.saveBtn}
              </button>
            </div>
          </div>
        </div>
        <div className="page-body">

          {/* General */}
          <div className="card">
            <div className="card-title">{p.generalCard}</div>
            <div className="form-group">
              <label className="form-label">{p.nameLabel}</label>
              <input className="form-input" placeholder={p.namePlaceholder}
                value={form.name} onChange={e=>set('name',e.target.value)}/>
            </div>
          </div>

          {/* Format */}
          <div className="card">
            <div className="card-title">{p.formatCard}</div>
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

                {/* Size selector grid */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:4 }}>
                  {allSizes.map(sz => {
                    const active = form.page_size === sz.id
                    return (
                      <button key={sz.id}
                        onClick={()=>set('page_size', sz.id)}
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
          </div>

          {/* Margins */}
          <div className="card">
            <div className="card-title">{p.marginsCard}</div>
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">{p.marginLabel}</label>
                <input type="number" className="form-input" min={0} max={50} step={0.5}
                  value={form.margin_mm} onChange={e=>set('margin_mm',parseFloat(e.target.value))}/>
                <p className="text-xs text-muted mt-1">{p.marginHint}</p>
              </div>
              <div className="form-group">
                <label className="form-label">{p.gapLabel}</label>
                <input type="number" className="form-input" min={0} max={30} step={0.5}
                  value={form.gap_mm} onChange={e=>set('gap_mm',parseFloat(e.target.value))}/>
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
            </div>
          </div>

          {/* Page types — pass a stable key so PageTypeEditor doesn't reset on every onChange */}
          <div className="card">
            <div className="card-title">{p.pageTypesCard}</div>
            <p className="text-sm text-muted mb-4">{p.pageTypesHint}</p>
            <PageTypeEditor
              key={editing === 'new' ? 'new' : editing.id}
              pageTypes={form.page_types}
              orientation={form.orientation}
              onChange={pt => set('page_types', pt)}
            />
          </div>

          {/* Caption style defaults */}
          <div className="card">
            <div className="card-title">Stile didascalie</div>
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
                  {/* Font */}
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

                  {/* Style toggles + alignment */}
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

                  {/* Preview */}
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
                        Testo didascalia di esempio
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
        {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
      </>
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
                    {getSizeLabel(prof.page_size)} · {prof.orientation==='portrait'?'Verticale':'Orizzontale'}
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
