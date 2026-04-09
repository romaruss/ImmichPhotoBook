import { useState, useEffect } from 'react'
import axios from 'axios'

export default function ConfigPage() {
  const [cfg, setCfg] = useState({ immich_url: '', api_key: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    axios.get('/api/config').then(r => setCfg(r.data))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await axios.post('/api/config', cfg)
      setStatus({ type: 'success', msg: 'Configurazione salvata' })
    } catch {
      setStatus({ type: 'error', msg: 'Errore nel salvataggio' })
    } finally {
      setSaving(false)
      setTimeout(() => setStatus(null), 3000)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      await axios.post('/api/config', cfg)
      const r = await axios.get('/api/config/test')
      setStatus({ type: r.data.connected ? 'success' : 'error', msg: r.data.connected ? '✓ Connessione a Immich riuscita!' : '✗ Impossibile connettersi a Immich. Controlla URL e API key.' })
    } catch {
      setStatus({ type: 'error', msg: 'Errore durante il test' })
    } finally {
      setTesting(false)
      setTimeout(() => setStatus(null), 5000)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Configurazione</h2>
        <p>Connetti PhotoBook Studio al tuo server Immich</p>
      </div>
      <div className="page-body" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="card-title">Connessione Immich</div>

          <div className="form-group">
            <label className="form-label">URL del server Immich</label>
            <input
              className="form-input"
              placeholder="http://immich:2283 oppure http://192.168.1.100:2283"
              value={cfg.immich_url}
              onChange={e => setCfg(p => ({ ...p, immich_url: e.target.value }))}
            />
            <p className="text-xs text-muted mt-1">
              Inserisci l'URL interno del tuo server Immich (senza /api finale)
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              className="form-input"
              type="password"
              placeholder="La tua API key di Immich"
              value={cfg.api_key}
              onChange={e => setCfg(p => ({ ...p, api_key: e.target.value }))}
            />
            <p className="text-xs text-muted mt-1">
              Generala in Immich → Account Settings → API Keys
            </p>
          </div>

          {status && (
            <div className={`toast ${status.type}`} style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16 }}>
              {status.msg}
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner"/> : '💾'} Salva
            </button>
            <button className="btn" onClick={test} disabled={testing}>
              {testing ? <span className="spinner"/> : '🔗'} Testa connessione
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Guida rapida</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              ['1', 'Configura', 'Inserisci l\'URL di Immich e la tua API key, poi testa la connessione'],
              ['2', 'Profili di stampa', 'Crea un profilo con le dimensioni del foglio, margini, abbondanza e layout delle pagine'],
              ['3', 'Seleziona album', 'Scegli uno o più album da Immich e il profilo da usare, poi genera il layout'],
              ['4', 'Anteprima', 'Rivedi e modifica la disposizione delle foto pagina per pagina'],
              ['5', 'Esporta', 'Genera il PDF pronto per la stamperia'],
            ].map(([n, title, desc]) => (
              <div key={n} className="flex gap-3 items-center">
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--gold-dim)', border: '1px solid rgba(212,170,90,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--gold)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{n}</div>
                <div>
                  <strong style={{ fontSize: 13 }}>{title}</strong>
                  <p className="text-xs text-muted">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
