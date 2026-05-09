import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'

function ProjectRow({ project, fmt, onLoad, onDelete, selected }) {
  const t = useT(); const tp = t.preview
  return (
    <div
      onClick={() => onLoad(project.id)}
      style={{
        display:'flex', gap:12, alignItems:'center',
        padding:'12px 14px', borderRadius:8, cursor:'pointer',
        border: selected ? '1px solid var(--gold)' : '1px solid var(--border)',
        marginBottom:8,
        transition:'background 0.12s, border-color 0.12s',
        background: selected ? 'var(--gold-dim,rgba(212,175,55,0.08))' : 'var(--bg3)',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.background='var(--bg)'; e.currentTarget.style.borderColor='var(--gold)' } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.background='var(--bg3)'; e.currentTarget.style.borderColor='var(--border)' } }}>
      <span style={{ fontSize:24, flexShrink:0 }}>📖</span>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:14, fontWeight:500, color:'var(--text)', marginBottom:2,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {project.name}
        </p>
        <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
          {project.album_name} · {project.page_count} pag.
          {project.profile_name ? ` · ${project.profile_name}` : ''}
        </p>
        <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', marginTop:2 }}>
          {project.saved_at ? `Salvato: ${fmt(project.saved_at)}` : ''}
        </p>
      </div>
      <button
        onClick={e => onDelete(project.id, project.name, e)}
        title="Elimina progetto"
        style={{ background:'none', border:'1px solid var(--border)',
          color:'var(--text3)', borderRadius:5, padding:'4px 8px',
          cursor:'pointer', fontSize:12, flexShrink:0 }}>
        🗑️
      </button>
    </div>
  )
}

export default function ProjectModal({ mode, layout, photoTransforms, currentPage, onClose, onLoad }) {
  // mode: 'save' | 'load'
  const t = useT(); const tp = t.preview
  const [projects, setProjects]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [projectName, setProjectName] = useState(() => {
    const storedName = sessionStorage.getItem('photobook_project_name')
    const storedId   = sessionStorage.getItem('photobook_project_id')
    if (storedId && storedName) return storedName
    return layout ? tp.projectDefaultName(layout.album?.albumName) : ''
  })
  const [saving, setSaving]       = useState(false)
  const [savedId, setSavedId]     = useState(null)   // current open project ID (for update)
  const [toast, setToast]         = useState(null)
  const nameRef = useRef()

  useEffect(() => {
    const stored = sessionStorage.getItem('photobook_project_id')
    if (stored) setSavedId(stored)
    loadList()   // carica lista in entrambe le modalità
    if (mode === 'save' && nameRef.current) setTimeout(()=>nameRef.current?.select(), 100)
  }, [mode])

  const loadList = async () => {
    setLoading(true)
    try {
      const list = (await axios.get('/api/projects')).data
      setProjects(list)
      // Pre-fill project name from the currently open project (not generic album name)
      if (mode === 'save') {
        const sid = sessionStorage.getItem('photobook_project_id')
        if (sid) {
          const existing = list.find(p => String(p.id) === String(sid))
          if (existing) setProjectName(existing.name)
        }
      }
    }
    catch { setToast({ type:'error', msg:tp.projectListError }) }
    finally { setLoading(false) }
  }

  const handleSave = async () => {
    if (!projectName.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: projectName.trim(),
        album: layout.album,
        profile: layout.profile,
        pages: layout.pages,
        locations: layout.locations || [],
        photo_transforms: photoTransforms,
        current_page: currentPage,
      }
      // Read from sessionStorage (not state) so handleSaveNew (which removes the key) works correctly
      const sid = sessionStorage.getItem('photobook_project_id')
      let res
      if (sid) {
        res = await axios.put(`/api/projects/${sid}`, payload)
        setToast({ type:'success', msg:tp.projectSavedOk })
      } else {
        res = await axios.post('/api/projects', payload)
        sessionStorage.setItem('photobook_project_id', res.data.id)
        setSavedId(res.data.id)
        setToast({ type:'success', msg:tp.projectNewSavedOk })
      }
      sessionStorage.setItem('photobook_project_name', projectName.trim())
      setTimeout(onClose, 1200)
    } catch {
      setToast({ type:'error', msg:tp.projectSaveError })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveNew = async () => {
    setSavedId(null)
    sessionStorage.removeItem('photobook_project_id')
    sessionStorage.removeItem('photobook_project_name')
    await handleSave()
  }

  // In save mode: select project as overwrite target (never loads/replaces current work)
  const handleSelectForSave = (pid) => {
    const project = projects.find(p => String(p.id) === String(pid))
    if (!project) return
    setProjectName(project.name)
    setSavedId(String(pid))
    sessionStorage.setItem('photobook_project_id', String(pid))
    sessionStorage.setItem('photobook_project_name', project.name)
    if (nameRef.current) { nameRef.current.focus(); nameRef.current.select() }
  }

  // In load mode: actually loads the project (replaces current work)
  const handleLoad = async (pid) => {
    try {
      const r = await axios.get(`/api/projects/${pid}`)
      sessionStorage.setItem('photobook_layout', JSON.stringify({
        album: r.data.album,
        profile: r.data.profile,
        pages: r.data.pages,
        locations: r.data.locations || [],
      }))
      sessionStorage.setItem('photobook_project_id', pid)
      sessionStorage.setItem('photobook_project_name', r.data.name || '')
      onLoad(r.data)   // parent aggiorna stato
      onClose()
    } catch {
      setToast({ type:'error', msg:tp.projectLoadError })
    }
  }

  const handleDelete = async (pid, name, e) => {
    e.stopPropagation()
    if (!window.confirm(`Eliminare il progetto "${name}"?`)) return
    await axios.delete(`/api/projects/${pid}`)
    setProjects(p => p.filter(x => x.id !== pid))
  }

  const fmt = iso => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })
  }

  return createPortal(
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:8000 }}
        onClick={e => e.target===e.currentTarget && onClose()}/>
      <div style={{
        position:'fixed', top:'50%', left:'50%',
        transform:'translate(-50%,-50%)',
        width: 520, maxHeight:'80vh',
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        zIndex:8001, display:'flex', flexDirection:'column', overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:'var(--bg3)', flexShrink:0 }}>
          <div>
            <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:20, marginBottom:2 }}>
              {mode === 'save' ? '💾 Salva progetto' : '📂 Apri progetto'}
            </h3>
            <p style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>
              {mode === 'save'
                ? 'Salva il layout corrente per riprendere in un altro momento'
                : 'Seleziona un progetto salvato per caricarlo'}
            </p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none',
            color:'var(--text3)', fontSize:20, cursor:'pointer', padding:'0 4px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:24 }}>

          {mode === 'save' && (
            <div>
              <label className="form-label">Nome del progetto</label>
              <input ref={nameRef} className="form-input" value={projectName}
                onChange={e => setProjectName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="es. Vacanze estate 2024"/>
              <p className="text-xs text-muted" style={{ marginTop:6 }}>
                {savedId
                  ? `Premi "Aggiorna" per sovrascrivere, oppure "Salva come nuovo" per una copia`
                  : 'Verrà creato un nuovo progetto'}
              </p>

              <div style={{ display:'flex', gap:10, marginTop:20 }}>
                {savedId && (
                  <button className="btn btn-primary" style={{ flex:1, justifyContent:'center' }}
                    onClick={handleSave} disabled={saving || !projectName.trim()}>
                    {saving ? <><span className="spinner" style={{width:13,height:13}}/> Salvataggio…</> : '💾 Aggiorna'}
                  </button>
                )}
                <button className={`btn ${savedId ? '' : 'btn-primary'}`}
                  style={{ flex:1, justifyContent:'center' }}
                  onClick={savedId ? handleSaveNew : handleSave}
                  disabled={saving || !projectName.trim()}>
                  {saving ? <><span className="spinner" style={{width:13,height:13}}/> Salvataggio…</>
                    : savedId ? tp.projectSaveNewBtn : '💾 Salva'}
                </button>
              </div>

              <hr className="divider"/>
              <p className="text-xs text-muted mb-4">
                Sovrascivi un progetto esistente — <em>clicca per selezionare</em>
              </p>
              {loading && <div style={{ textAlign:'center', padding:16 }}><span className="spinner"/></div>}
              {!loading && projects.length === 0 && (
                <p className="text-sm text-muted" style={{ textAlign:'center', padding:16 }}>
                  Nessun progetto salvato
                </p>
              )}
              {!loading && projects.map(p => (
                <ProjectRow key={p.id} project={p} fmt={fmt}
                  selected={String(p.id) === String(savedId)}
                  onLoad={handleSelectForSave} onDelete={handleDelete}/>
              ))}
              {!loading && projects.length === 0 && (
                <button className="btn btn-sm" onClick={loadList} style={{ marginTop:8 }}>
                  Aggiorna lista
                </button>
              )}
            </div>
          )}

          {mode === 'load' && (
            <div>
              {loading && <div style={{ textAlign:'center', padding:32 }}><span className="spinner" style={{ width:24, height:24 }}/></div>}
              {!loading && projects.length === 0 && (
                <div className="empty-state" style={{ padding:'40px 0' }}>
                  <div className="icon" style={{ fontSize:36 }}>📭</div>
                  <h3 style={{ fontSize:18 }}>Nessun progetto salvato</h3>
                  <p>Usa "Salva progetto" dall'anteprima per conservare il tuo lavoro</p>
                </div>
              )}
              {!loading && projects.map(p => (
                <ProjectRow key={p.id} project={p} fmt={fmt} onLoad={handleLoad} onDelete={handleDelete}/>
              ))}
            </div>
          )}
        </div>

        {toast && (
          <div style={{ padding:'12px 24px', borderTop:'1px solid var(--border)',
            background: toast.type==='success' ? 'rgba(74,197,133,0.1)' : 'rgba(197,74,74,0.1)',
            color: toast.type==='success' ? 'var(--success)' : 'var(--danger)',
            fontSize:13, flexShrink:0 }}>
            {toast.msg}
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
