import { useState, useEffect } from 'react'
import axios from 'axios'
import PageTypeEditor from '../components/PageTypeEditor'

const PAGE_SIZES = ['A4','A3','A5','20x20','20x30','30x30','30x40','Letter','Custom']
const DEFAULT_PROFILE = {
  name: '',
  page_size: '20x30',
  orientation: 'portrait',
  duplex: false,
  margin_mm: 5,
  bleed: false,
  bleed_mm: 3,
  gap_mm: 3,
  page_types: [],
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | profile object
  const [form, setForm] = useState(DEFAULT_PROFILE)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => { loadProfiles() }, [])

  const loadProfiles = async () => {
    const r = await axios.get('/api/profiles')
    setProfiles(r.data)
  }

  const startNew = () => {
    setForm({ ...DEFAULT_PROFILE, page_types: [] })
    setEditing('new')
  }

  const startEdit = async (profile) => {
    const r = await axios.get(`/api/profiles/${profile.id}`)
    setForm(r.data)
    setEditing(r.data)
  }

  const save = async () => {
    if (!form.name.trim()) { showToast('Inserisci un nome per il profilo', 'error'); return }
    setSaving(true)
    try {
      if (editing === 'new') {
        await axios.post('/api/profiles', form)
      } else {
        await axios.put(`/api/profiles/${editing.id}`, form)
      }
      await loadProfiles()
      setEditing(null)
      showToast('Profilo salvato', 'success')
    } catch (e) {
      showToast('Errore nel salvataggio', 'error')
    } finally {
      setSaving(false)
    }
  }

  const del = async (profile) => {
    if (!confirm(`Eliminare il profilo "${profile.name}"?`)) return
    await axios.delete(`/api/profiles/${profile.id}`)
    loadProfiles()
  }

  const showToast = (msg, type) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }))

  if (editing) {
    return (
      <>
        <div className="page-header">
          <div className="flex items-center justify-between">
            <div>
              <h2>{editing === 'new' ? 'Nuovo profilo di stampa' : `Modifica: ${editing.name}`}</h2>
              <p>Configura le impostazioni per la tua stamperia</p>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setEditing(null)}>← Annulla</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner"/> : '💾'} Salva profilo
              </button>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="card">
            <div className="card-title">Informazioni generali</div>
            <div className="form-group">
              <label className="form-label">Nome del profilo</label>
              <input className="form-input" placeholder="es. Fotolibro 20x30 lucido" value={form.name} onChange={e => set('name', e.target.value)}/>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Formato pagina</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Dimensione pagina</label>
                <select className="form-select" value={form.page_size} onChange={e => set('page_size', e.target.value)}>
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Orientamento</label>
                <select className="form-select" value={form.orientation} onChange={e => set('orientation', e.target.value)}>
                  <option value="portrait">Verticale (Portrait)</option>
                  <option value="landscape">Orizzontale (Landscape)</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.duplex} onChange={e => set('duplex', e.target.checked)}/>
                Stampa fronte/retro (duplex) — aggiunge una pagina vuota dopo ogni coppia
              </label>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Margini e spaziatura</div>
            <div className="form-row-3">
              <div className="form-group">
                <label className="form-label">Margine (mm)</label>
                <input type="number" className="form-input" min={0} max={50} step={0.5} value={form.margin_mm} onChange={e => set('margin_mm', parseFloat(e.target.value))}/>
                <p className="text-xs text-muted mt-1">Spazio tra foto e bordo pagina</p>
              </div>
              <div className="form-group">
                <label className="form-label">Spazio tra foto (mm)</label>
                <input type="number" className="form-input" min={0} max={30} step={0.5} value={form.gap_mm} onChange={e => set('gap_mm', parseFloat(e.target.value))}/>
                <p className="text-xs text-muted mt-1">Gutter tra le foto nella stessa pagina</p>
              </div>
              <div className="form-group">
                <label className="form-label">Abbondanza (mm)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label className="checkbox-label" style={{ flexShrink: 0 }}>
                    <input type="checkbox" checked={form.bleed} onChange={e => set('bleed', e.target.checked)}/>
                    Attiva
                  </label>
                  <input type="number" className="form-input" min={0} max={10} step={0.5} value={form.bleed_mm} disabled={!form.bleed} onChange={e => set('bleed_mm', parseFloat(e.target.value))} style={{ opacity: form.bleed ? 1 : 0.4 }}/>
                </div>
                <p className="text-xs text-muted mt-1">Area extra che verrà rifilata in stampa</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Pagine tipo</div>
            <p className="text-sm text-muted mb-4">
              Definisci i layout di pagina disponibili. Il sistema sceglierà casualmente tra questi durante l'impaginazione automatica.
              Puoi ridimensionare gli slot trascinando le linee dorate nel canvas.
            </p>
            <PageTypeEditor
              pageTypes={form.page_types}
              onChange={(pt) => set('page_types', pt)}
            />
          </div>
        </div>
        {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2>Profili di stampa</h2>
            <p>Gestisci i tuoi preset di stampa riutilizzabili</p>
          </div>
          <button className="btn btn-primary" onClick={startNew}>+ Nuovo profilo</button>
        </div>
      </div>
      <div className="page-body">
        {profiles.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📐</div>
            <h3>Nessun profilo</h3>
            <p>Crea il tuo primo profilo di stampa per iniziare</p>
            <button className="btn btn-primary mt-4" onClick={startNew}>Crea profilo</button>
          </div>
        ) : (
          <div className="profile-list">
            {profiles.map(p => (
              <div key={p.id} className="profile-item">
                <div className="profile-item-info">
                  <h3>{p.name}</h3>
                  <p>
                    {p.page_size} · {p.orientation === 'portrait' ? 'Verticale' : 'Orizzontale'}
                    {p.duplex ? ' · Fronte/Retro' : ''}
                    {p.bleed ? ` · Abbondanza ${p.bleed_mm}mm` : ''}
                    {' · '}{(p.page_types || []).length} pagine tipo
                  </p>
                </div>
                <div className="profile-item-actions">
                  <button className="btn btn-sm" onClick={() => startEdit(p)}>✏️ Modifica</button>
                  <button className="btn btn-sm btn-danger" onClick={() => del(p)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </>
  )
}
