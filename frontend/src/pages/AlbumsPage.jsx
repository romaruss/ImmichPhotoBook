import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'

// ── Default config ─────────────────────────────────────────────────────────────
const DEFAULTS = {
  temporal_clustering:  false,
  event_gap_min:        60,
  favorites_full_page:  false,
  face_crop:            true,
  quality_filter:       false,
  min_quality:          0.05,
  remove_duplicates:    false,
  similarity_threshold: 0.92,
  rhythm_alternation:   true,
  density:              75,
}

const STORAGE_KEY = 'photobook_gen_config'

function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } }
  catch { return { ...DEFAULTS } }
}

// ── Config modal ───────────────────────────────────────────────────────────────
function ConfigModal({ config, onChange, onClose }) {
  const [local, setLocal] = useState({ ...config })
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }))

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    onChange(local)
    onClose()
  }

  const reset = () => setLocal({ ...DEFAULTS })

  const Section = ({ title }) => (
    <p style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--gold)',
      textTransform:'uppercase', letterSpacing:'0.1em', marginTop:20, marginBottom:10,
      paddingBottom:5, borderBottom:'1px solid var(--border)' }}>{title}</p>
  )

  const Toggle = ({ k, label, help, disabled }) => (
    <div style={{ marginBottom:12, opacity:disabled?0.4:1 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <label style={{ fontSize:13, color:'var(--text)', flex:1, cursor:disabled?'not-allowed':'pointer' }}
          onClick={() => !disabled && set(k, !local[k])}>
          {label}
        </label>
        <div onClick={() => !disabled && set(k, !local[k])}
          style={{
            width:38, height:20, borderRadius:10, cursor:disabled?'not-allowed':'pointer',
            background: local[k] ? 'var(--gold)' : 'var(--bg3)',
            border: '1px solid var(--border)', position:'relative', flexShrink:0,
            transition:'background 0.2s',
          }}>
          <div style={{
            position:'absolute', top:2,
            left: local[k] ? 18 : 2,
            width:14, height:14, borderRadius:'50%',
            background: local[k] ? '#000' : 'var(--text3)',
            transition:'left 0.2s',
          }}/>
        </div>
      </div>
      {help && <p style={{ fontSize:11, color:'var(--text3)', marginTop:3, lineHeight:1.5 }}>{help}</p>}
    </div>
  )

  // SliderInput: separate component so useState/useEffect hooks are valid
  const SliderInput = ({ k, label, help, min, max, step, unit, disabled }) => {
    const [txt, setTxt] = useState(String(local[k]))
    useEffect(()=>setTxt(String(local[k])),[local[k]])
    const commit = (raw) => {
      const v = parseFloat(raw)
      if (!isNaN(v)) { const cl = Math.min(max, Math.max(min, v)); set(k, cl); setTxt(String(cl)) }
      else setTxt(String(local[k]))
    }
    return (
      <div style={{ marginBottom:14, opacity:disabled?0.4:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:3 }}>
          <label style={{ fontSize:13, color:'var(--text)', flex:1 }}>{label}</label>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="range" min={min} max={max} step={step}
              value={local[k]} disabled={disabled}
              onChange={e=>{ if(!disabled){ const v=parseFloat(e.target.value); set(k,v); setTxt(String(v)) } }}
              style={{ width:110, accentColor:'var(--gold)', cursor:'pointer' }}/>
            <input type="number" min={min} max={max} step={step}
              value={txt} disabled={disabled}
              onChange={e=>!disabled&&setTxt(e.target.value)}
              onBlur={e=>!disabled&&commit(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'){ commit(e.target.value); e.target.blur() } }}
              style={{ width:58, textAlign:'right', background:'var(--bg3)',
                border:'1px solid var(--border)', color:'var(--text)',
                borderRadius:4, padding:'3px 6px', fontSize:12 }}/>
            {unit && <span style={{ fontSize:11, color:'var(--text3)', minWidth:24 }}>{unit}</span>}
          </div>
        </div>
        {help && <p style={{ fontSize:11, color:'var(--text3)', lineHeight:1.5 }}>{help}</p>}
      </div>
    )
  }
  const Slider = SliderInput  // alias for backward compat

  return createPortal(
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:8000 }}
        onClick={e=>e.target===e.currentTarget&&onClose()}/>
      <div style={{
        position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        width:580, maxHeight:'88vh',
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        zIndex:8001, display:'flex', flexDirection:'column', overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{ padding:'16px 24px 12px', borderBottom:'1px solid var(--border)',
          background:'var(--bg3)', flexShrink:0,
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:20, marginBottom:2 }}>
              ⚙ Opzioni generazione album
            </h3>
            <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
              Tutte le impostazioni sono facoltative — la logica base funziona senza attivarne nessuna
            </p>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:'var(--text3)', fontSize:22, cursor:'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 24px' }}>

          {/* Density */}
          <Section title="Densità dell'album"/>
          <Slider k="density" min={0} max={100} step={5} unit="%"
            label="Proporzione foto / pagine"
            help={`${local.density}% — ${
              local.density >= 90 ? '1 foto per pagina (album minimalista)' :
              local.density >= 60 ? 'bilanciato (default: 75%)' :
              'molte foto per pagina (album denso)'
            }. 100 = una foto per pagina, 0 = massima densità.`}/>

          {/* Temporal clustering */}
          <Section title="a) Clustering temporale"/>
          <Toggle k="temporal_clustering" label="Raggruppa foto per evento"
            help="Mantiene insieme le foto scattate nello stesso lasso di tempo. Le foto senza data restano nella logica base."/>
          <Slider k="event_gap_min" min={5} max={1440} step={5} unit="min"
            label="Soglia di tempo tra eventi"
            disabled={!local.temporal_clustering}
            help={`Foto con più di ${local.event_gap_min} minuti di distanza dalla precedente iniziano un nuovo evento.`}/>

          {/* Favorites */}
          <Section title="b) Foto preferite"/>
          <Toggle k="favorites_full_page" label="Foto con ★ su pagina intera"
            help="Le foto con il cuore in Immich vengono posizionate da sole su una pagina intera."/>

          {/* Face crop */}
          <Section title="c) Centratura sui volti"/>
          <Toggle k="face_crop" label="Centra il crop sui volti"
            help="Quando viene inserita una foto con volti in primo piano, il crop viene centrato automaticamente sul viso."/>

          {/* Quality filter */}
          <Section title="d) Filtro qualità"/>
          <Toggle k="quality_filter" label="Escludi foto sotto la soglia di qualità"
            help="Calcola un punteggio basato su risoluzione e metadati, ed esclude le foto con punteggio troppo basso."/>
          <Slider k="min_quality" min={0} max={1} step={0.01} unit=""
            label="Soglia qualità minima"
            disabled={!local.quality_filter}
            help={`Soglia: ${local.min_quality.toFixed(2)}. Le foto con punteggio inferiore vengono escluse. Il punteggio è calcolato su risoluzione, metadati e stato preferito.`}/>

          {/* Duplicates */}
          <Section title="e) Rimozione duplicati"/>
          <Toggle k="remove_duplicates" label="Rimuovi foto quasi identiche"
            help="Rimuove foto con caratteristiche simili, tenendo quella con qualità più alta."/>
          <Slider k="similarity_threshold" min={0.5} max={1} step={0.01} unit=""
            label="Soglia similarità"
            disabled={!local.remove_duplicates}
            help={`Soglia: ${local.similarity_threshold.toFixed(2)}. Più alta = solo duplicati quasi identici. Più bassa = rimuove anche foto simili ma non identiche.`}/>

          {/* Rhythm */}
          <Section title="f) Ritmo visivo"/>
          <Toggle k="rhythm_alternation" label="Alterna layout densi e minimali"
            help="Evita di mettere troppe pagine con 4-6 foto di fila — alterna con pagine più ariose."/>

        </div>

        {/* Footer */}
        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)',
          background:'var(--bg3)', flexShrink:0,
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <button className="btn btn-sm" onClick={reset}>↺ Ripristina default</button>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn" onClick={onClose}>Annulla</button>
            <button className="btn btn-primary" onClick={save}>✓ Salva e chiudi</button>
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

  const [albums, setAlbums]               = useState([])
  const [profiles, setProfiles]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [selectedAlbums, setSelectedAlbums] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [generating, setGenerating]       = useState(false)
  const [error, setError]                 = useState(null)
  const [search, setSearch]               = useState('')
  const [showConfig, setShowConfig]       = useState(false)
  const [genConfig, setGenConfig]         = useState(loadConfig)

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

  const generate = async () => {
    if (!selectedAlbums.length) return
    if (!selectedProfile) { alert('Seleziona un profilo di stampa'); return }
    setGenerating(true)
    try {
      if (selectedAlbums.length === 1) {
        // ── Single album ────────────────────────────────────────────────────
        const r = await axios.post('/api/layout/generate', {
          album_id: selectedAlbums[0], profile_id: selectedProfile, config: genConfig,
        })
        const { photo_transforms, ...layoutData } = r.data
        sessionStorage.setItem('photobook_layout', JSON.stringify(layoutData))
        if (photo_transforms && Object.keys(photo_transforms).length > 0)
          sessionStorage.setItem('photobook_transforms', JSON.stringify(photo_transforms))
        else
          sessionStorage.removeItem('photobook_transforms')
      } else {
        // ── Multi-album: concatenate with cover pages ────────────────────────
        // Generate each album separately, then merge
        const results = await Promise.all(
          selectedAlbums.map(id =>
            axios.post('/api/layout/generate', {
              album_id: id, profile_id: selectedProfile, config: genConfig,
            })
          )
        )
        // Use first album's metadata as "root"
        const first = results[0].data
        const BLANK_PAGE = { page_type_id:'__blank__', page_type:{id:'__blank__',label:'Pagina vuota',slots:[]}, items:[] }
        
        // Build merged pages: for each album add cover-indicator + blank + pages
        // (actual cover rendering is in PreviewPage; we mark album boundaries with a special flag)
        let allPages = []
        let allTransforms = {}
        let pageOffset = 0
        
        results.forEach((r, i) => {
          const { photo_transforms = {}, pages = [] } = r.data
          
          if (i > 0) {
            // New album section: ensure it starts on an odd page (right-hand page)
            // Add blank page if needed so next page is odd-numbered (1-based)
            if ((allPages.length + 1) % 2 === 0) {
              // current length is odd (0-indexed), next would be even (0-indexed = odd 1-based) → add blank
              allPages.push({...BLANK_PAGE, _album_separator: true})
              pageOffset++
            }
            // Insert an "album cover marker" page
            allPages.push({
              ...BLANK_PAGE,
              _album_cover: true,
              _album_info: { albumName: r.data.album.albumName, assetCount: r.data.album.assetCount },
            })
            pageOffset++
            // Blank spacer after cover (before content)
            allPages.push({...BLANK_PAGE, _album_separator: true})
            pageOffset++
          }
          
          // Remap transforms with correct page offset
          Object.entries(photo_transforms).forEach(([key, val]) => {
            const [pi, si] = key.split('_').map(Number)
            allTransforms[`${pi + pageOffset}_${si}`] = val
          })
          
          allPages = [...allPages, ...pages]
          pageOffset += pages.length
        })
        
        const mergedLayout = {
          ...first,
          pages: allPages,
          _multi_album: true,
          _album_count: selectedAlbums.length,
        }
        sessionStorage.setItem('photobook_layout', JSON.stringify(mergedLayout))
        if (Object.keys(allTransforms).length > 0)
          sessionStorage.setItem('photobook_transforms', JSON.stringify(allTransforms))
        else
          sessionStorage.removeItem('photobook_transforms')
      }
      navigate('/preview')
    } catch (e) {
      alert('Errore: ' + (e.response?.data?.detail || e.message))
    } finally { setGenerating(false) }
  }


  const filtered = albums.filter(al => al.albumName?.toLowerCase().includes(search.toLowerCase()))

  // Count active options for badge
  const activeCount = [
    genConfig.temporal_clustering,
    genConfig.favorites_full_page,
    !genConfig.face_crop,      // face_crop ON is default, so badge only if disabled
    genConfig.quality_filter,
    genConfig.remove_duplicates,
    !genConfig.rhythm_alternation,
    genConfig.density !== 75,
  ].filter(Boolean).length

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
        <p>Scegli un album da Immich e genera il layout del fotolibro</p>
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
              <input className="form-input" placeholder="Cerca per nome…"
                value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>

            {/* Generate + config */}
            <div style={{ alignSelf:'flex-end', display:'flex', gap:6, alignItems:'center' }}>
              <button className="btn btn-primary btn-lg"
                onClick={generate}
                disabled={!selectedAlbums.length || generating || !selectedProfile}>
                {generating ? <><span className="spinner" style={{ width:14, height:14 }}/> Generazione…</> : '📖 Genera album'}
              </button>

              {/* Gear icon with badge */}
              <div style={{ position:'relative' }}>
                <button className="btn btn-sm" title="Opzioni generazione"
                  onClick={() => setShowConfig(true)}
                  style={{ width:36, height:36, fontSize:16, padding:0,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: activeCount > 0 ? 'var(--gold-dim)' : undefined,
                    borderColor: activeCount > 0 ? 'var(--gold)' : undefined }}>
                  ⚙
                </button>
                {activeCount > 0 && (
                  <span style={{
                    position:'absolute', top:-5, right:-5,
                    width:16, height:16, borderRadius:'50%',
                    background:'var(--gold)', color:'#000',
                    fontSize:9, fontWeight:700, display:'flex',
                    alignItems:'center', justifyContent:'center',
                    pointerEvents:'none',
                  }}>{activeCount}</span>
                )}
              </div>

            </div>
          </div>

          {/* Selected albums */}
          {selectedAlbums.length > 0 && (
            <div className="flex gap-2 mt-2" style={{ flexWrap:'wrap' }}>
              {selectedAlbums.map(id => {
                const al = albums.find(x=>x.id===id)
                return al ? (
                  <span key={id} className="tag gold">
                    {al.albumName}
                    <span style={{ cursor:'pointer', marginLeft:6, opacity:0.7 }}
                      onClick={()=>toggleAlbum(id)}>✕</span>
                  </span>
                ) : null
              })}
            </div>
          )}

          {/* Active options summary */}
          {activeCount > 0 && (
            <div style={{ marginTop:10, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:11, color:'var(--text3)' }}>Opzioni attive:</span>
              {genConfig.temporal_clustering && (
                <span className="tag">Clustering {genConfig.event_gap_min}min</span>
              )}
              {genConfig.favorites_full_page && <span className="tag">★ Pagina intera</span>}
              {!genConfig.face_crop && <span className="tag">Volti: off</span>}
              {genConfig.quality_filter && (
                <span className="tag">Qualità ≥{(genConfig.min_quality*100).toFixed(0)}%</span>
              )}
              {genConfig.remove_duplicates && (
                <span className="tag">Dedup {(genConfig.similarity_threshold*100).toFixed(0)}%</span>
              )}
              {!genConfig.rhythm_alternation && <span className="tag">Ritmo: off</span>}
              {genConfig.density !== 75 && (
                <span className="tag">Densità {genConfig.density}%</span>
              )}
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

      {showConfig && (
        <ConfigModal
          config={genConfig}
          onChange={setGenConfig}
          onClose={() => setShowConfig(false)}/>
      )}
    </>
  )
}
