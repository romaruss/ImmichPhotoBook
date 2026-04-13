import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'

// ── Smart Layout config modal ─────────────────────────────────────────────────
function SmartConfigModal({ onClose }) {
  const t = useT()
  const sc = t.smartConfig
  const [cfg, setCfg]     = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    axios.get('/api/smart-config').then(r => setCfg(r.data)).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await axios.put('/api/smart-config', cfg)
      setToast({ type:'success', msg:sc.savedOk })
      setTimeout(onClose, 1200)
    } catch {
      setToast({ type:'error', msg:sc.savedErr })
    } finally { setSaving(false) }
  }

  const reset = async () => {
    const r = await axios.get('/api/smart-config')
    // reset to defaults
    const defaults = {
      event_gap_min: 60, min_quality: 0.05, similarity_threshold: 0.97,
      max_per_page: 6, remove_duplicates: true, quality_filter: true,
      rhythm_alternation: true,
    }
    setCfg(defaults)
  }

  const set = (k, v) => setCfg(p => ({...p, [k]: v}))

  if (!cfg) return null

  const PARAMS = sc.sections

  return createPortal(
    <>
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:8000}}
        onClick={e=>e.target===e.currentTarget&&onClose()}/>
      <div style={{
        position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
        width:560,maxHeight:'85vh',
        background:'var(--bg2)',border:'1px solid var(--border)',
        borderRadius:12,boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        zIndex:8001,display:'flex',flexDirection:'column',overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{padding:'18px 24px 14px',borderBottom:'1px solid var(--border)',
          background:'var(--bg3)',flexShrink:0,
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{fontFamily:'var(--font-display)',fontWeight:300,fontSize:20,marginBottom:2}}>
              ✨ Configurazione Smart Layout
            </h3>
            <p style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>
              Regola i parametri dell'analisi automatica delle foto
            </p>
          </div>
          <button onClick={onClose}
            style={{background:'none',border:'none',color:'var(--text3)',fontSize:20,cursor:'pointer'}}>✕</button>
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:'auto',padding:24}}>
          {PARAMS.map(section => (
            <div key={section.section} style={{marginBottom:24}}>
              <p style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--gold)',
                textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12,
                paddingBottom:6,borderBottom:'1px solid var(--border)'}}>
                {section.section}
              </p>
              {section.fields.map(field => {
                const isDisabled = field.disabledWhen ? field.disabledWhen(cfg) : false
                return (
                <div key={field.key} style={{marginBottom:16, opacity:isDisabled?0.45:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:4}}>
                    <label style={{fontSize:13,color:'var(--text)',flex:1}}>{field.label}</label>
                    {field.type === 'bool' ? (
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:isDisabled?'not-allowed':'pointer',flexShrink:0}}>
                        <input type="checkbox" checked={!!cfg[field.key]} disabled={isDisabled}
                          onChange={e=>!isDisabled&&set(field.key,e.target.checked)}
                          style={{accentColor:'var(--gold)',width:16,height:16}}/>
                        <span style={{fontSize:12,color:cfg[field.key]?'var(--gold)':'var(--text3)'}}>
                          {cfg[field.key]?'Attivo':'Disattivo'}
                        </span>
                      </label>
                    ) : (
                      <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                        <input type="range" disabled={isDisabled}
                          min={field.min} max={field.max} step={field.step}
                          value={cfg[field.key]}
                          onChange={e=>!isDisabled&&set(field.key,parseFloat(e.target.value))}
                          style={{width:120,accentColor:'var(--gold)'}}/>
                        <input type="number" disabled={isDisabled}
                          min={field.min} max={field.max} step={field.step}
                          value={cfg[field.key]}
                          onChange={e=>!isDisabled&&set(field.key,parseFloat(e.target.value)||field.min)}
                          style={{width:64,textAlign:'right',
                            background:'var(--bg3)',border:'1px solid var(--border)',
                            color:'var(--text)',borderRadius:4,padding:'3px 6px',fontSize:12}}/>
                      </div>
                    )}
                  </div>
                  <p style={{fontSize:11,color:'var(--text3)',lineHeight:1.5}}>{field.help}</p>
                </div>
              )})}
            </div>
          ))}

          {/* Quality score guide */}
          <div style={{background:'var(--bg3)',borderRadius:8,padding:14,marginTop:8}}>
            <p style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)',marginBottom:8,
              textTransform:'uppercase',letterSpacing:'0.08em'}}>Come viene calcolata la qualità</p>
            {sc.qualityComponents.map(([pct,name,desc])=>(
              <div key={name} style={{display:'flex',gap:10,marginBottom:6,alignItems:'flex-start'}}>
                <span style={{fontSize:12,fontWeight:700,color:'var(--gold)',width:32,flexShrink:0}}>{pct}</span>
                <div>
                  <span style={{fontSize:12,color:'var(--text)'}}>{name}</span>
                  <span style={{fontSize:11,color:'var(--text3)',marginLeft:6}}>{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{padding:'14px 24px',borderTop:'1px solid var(--border)',
          background:'var(--bg3)',flexShrink:0,
          display:'flex',gap:10,justifyContent:'space-between',alignItems:'center'}}>
          <button className="btn btn-sm" onClick={reset}>↺ Ripristina default</button>
          <div style={{display:'flex',gap:10}}>
            {toast&&<span style={{fontSize:12,color:toast.type==='success'?'var(--success)':'var(--danger)'}}>{toast.msg}</span>}
            <button className="btn" onClick={onClose}>Annulla</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving?<><span className="spinner" style={{width:12,height:12}}/> Salvo…</>:sc.saveBtn}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ── Main AlbumsPage ────────────────────────────────────────────────────────────
export default function AlbumsPage() {
  const navigate = useNavigate()
  const t = useT()
  const a = t.albums
  const [albums, setAlbums]             = useState([])
  const [profiles, setProfiles]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedAlbums, setSelectedAlbums] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [generating, setGenerating]     = useState(false)
  const [error, setError]               = useState(null)
  const [search, setSearch]             = useState('')
  const [showSmartConfig, setShowSmartConfig] = useState(false)

  useEffect(() => {
    Promise.all([
      axios.get('/api/albums').catch(() => ({ data: [] })),
      axios.get('/api/profiles').catch(() => ({ data: [] })),
    ]).then(([ar, pr]) => {
      const sorted = (ar.data || []).sort((a,b) => new Date(b.endDate||0) - new Date(a.endDate||0))
      setAlbums(sorted)
      setProfiles(pr.data || [])
      if (pr.data?.length) setSelectedProfile(pr.data[0].id)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  const toggleAlbum = (id) =>
    setSelectedAlbums(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])

  const generate = async (mode = 'manual') => {
    if (!selectedAlbums.length) return
    if (!selectedProfile) { alert('Seleziona un profilo di stampa'); return }
    setGenerating(true)
    try {
      const albumId  = selectedAlbums[0]
      const endpoint = mode === 'smart' ? '/api/layout/smart' : '/api/layout'
      const r = await axios.post(endpoint, { album_id: albumId, profile_id: selectedProfile })
      // Store layout (without photo_transforms which go to separate storage)
      const { photo_transforms, ...layoutData } = r.data
      sessionStorage.setItem('photobook_layout', JSON.stringify(layoutData))
      // Smart layout may include suggested face-aware transforms
      if (photo_transforms && Object.keys(photo_transforms).length > 0) {
        sessionStorage.setItem('photobook_transforms', JSON.stringify(photo_transforms))
      } else {
        sessionStorage.removeItem('photobook_transforms')
      }
      navigate('/preview')
    } catch (e) {
      alert('Errore: ' + (e.response?.data?.detail || e.message))
    } finally { setGenerating(false) }
  }

  const filtered = albums.filter(a => a.albumName?.toLowerCase().includes(search.toLowerCase()))

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:12 }}>
      <span className="spinner" style={{ width:32, height:32 }}/>
      <p className="text-muted">Caricamento album da Immich…</p>
    </div>
  )

  if (error) return (
    <div className="empty-state" style={{ padding:'80px 40px' }}>
      <div className="icon">⚠️</div>
      <h3>Errore di connessione</h3>
      <p>{error}</p>
    </div>
  )

  return (
    <>
      <div className="page-header">
        <h2>Seleziona album</h2>
        <p>Scegli uno o più album da Immich per creare il tuo fotolibro</p>
      </div>

      <div className="page-body">
        <div className="card" style={{ marginBottom:24 }}>
          <div className="flex gap-4 items-center" style={{ flexWrap:'wrap' }}>
            {/* Profile selector */}
            <div style={{ flex:1, minWidth:200 }}>
              <label className="form-label">Profilo di stampa</label>
              {profiles.length === 0 ? (
                <p className="text-sm" style={{ color:'var(--accent)' }}>
                  ⚠ Nessun profilo.{' '}
                  <a href="#" onClick={()=>navigate('/profiles')} style={{ color:'var(--gold)' }}>Creane uno →</a>
                </p>
              ) : (
                <select className="form-select" value={selectedProfile}
                  onChange={e=>setSelectedProfile(e.target.value)}>
                  {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>

            {/* Search */}
            <div style={{ flex:2, minWidth:200 }}>
              <label className="form-label">Cerca album</label>
              <input className="form-input" placeholder={a.searchPlaceholder}
                value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>

            {/* Generate buttons */}
            <div style={{ alignSelf:'flex-end', display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn btn-primary btn-lg"
                onClick={()=>generate('smart')}
                disabled={!selectedAlbums.length||generating||!selectedProfile}
                title="Analizza qualità, raggruppa per eventi temporali, sceglie layout ottimali">
                {generating?<span className="spinner"/>:'✨'} Smart Layout
              </button>
              <button className="btn btn-sm"
                onClick={()=>setShowSmartConfig(true)}
                title="Configura i parametri dello Smart Layout"
                style={{ alignSelf:'center' }}>
                ⚙
              </button>
              <button className="btn btn-lg"
                onClick={()=>generate('manual')}
                disabled={!selectedAlbums.length||generating||!selectedProfile}
                title="Usa i profili pagina definiti nel profilo di stampa">
                {generating?<span className="spinner"/>:'📖'} Layout manuale
              </button>
            </div>
          </div>

          {/* Selected albums tags */}
          {selectedAlbums.length > 0 && (
            <div className="flex gap-2 mt-2" style={{ flexWrap:'wrap' }}>
              {selectedAlbums.map(id => {
                const a = albums.find(x=>x.id===id)
                return a ? (
                  <span key={id} className="tag gold">
                    {a.albumName}
                    <span style={{ cursor:'pointer', marginLeft:6, opacity:0.7 }}
                      onClick={()=>toggleAlbum(id)}>✕</span>
                  </span>
                ) : null
              })}
            </div>
          )}
        </div>

        {/* Album grid */}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🖼️</div>
            <h3>Nessun album trovato</h3>
            <p>{albums.length===0?'Nessun album su Immich':`Nessun risultato per "${search}"`}</p>
          </div>
        ) : (
          <div className="album-grid">
            {filtered.map(album => (
              <div key={album.id}
                className={`album-card${selectedAlbums.includes(album.id)?' selected':''}`}
                onClick={()=>toggleAlbum(album.id)}>
                <div className="album-thumb">
                  {album.albumThumbnailAssetId ? (
                    <img src={`/api/thumb/${album.albumThumbnailAssetId}`} alt={album.albumName} loading="lazy"/>
                  ) : (
                    <div className="album-thumb-placeholder">📷</div>
                  )}
                  {selectedAlbums.includes(album.id) && (
                    <div style={{ position:'absolute', top:8, right:8, background:'var(--gold)',
                      borderRadius:'50%', width:24, height:24, display:'flex',
                      alignItems:'center', justifyContent:'center',
                      fontSize:14, fontWeight:700, color:'#0a0a0c' }}>✓</div>
                  )}
                </div>
                <div className="album-info">
                  <h3>{album.albumName}</h3>
                  <p>{album.assetCount||0} foto{album.endDate?` · ${album.endDate?.slice(0,7)}`:''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSmartConfig && <SmartConfigModal onClose={()=>setShowSmartConfig(false)}/>}
    </>
  )
}
