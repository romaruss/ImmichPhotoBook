import { useState, useEffect } from 'react'
import axios from 'axios'
import { useT, useLang, LOCALES } from '../i18n.jsx'

export default function ConfigPage() {
  const t = useT()
  const { lang, setLang } = useLang()
  const [cfg, setCfg]     = useState({ immich_url: '', api_key: '' })
  const [saving, setSaving]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus]   = useState(null)

  useEffect(() => {
    axios.get('/api/config').then(r => setCfg(r.data))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await axios.post('/api/config', cfg)
      setStatus({ type: 'success', msg: t.config.saved })
    } catch {
      setStatus({ type: 'error', msg: t.config.saveError })
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
      setStatus({
        type: r.data.connected ? 'success' : 'error',
        msg:  r.data.connected ? t.config.testOk : t.config.testFail,
      })
    } catch {
      setStatus({ type: 'error', msg: t.config.testError })
    } finally {
      setTesting(false)
      setTimeout(() => setStatus(null), 5000)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>{t.config.title}</h2>
        <p>{t.config.subtitle}</p>
      </div>
      <div className="page-body" style={{ maxWidth: 640 }}>

        <div className="card">
          <div className="card-title">{t.config.langTitle}</div>
          <div className="flex gap-2">
            {Object.entries(LOCALES).map(([code, { label }]) => (
              <button key={code}
                className={`btn${lang === code ? ' btn-primary' : ''}`}
                onClick={() => setLang(code)}
                style={{ minWidth: 110 }}>
                {code === 'it' ? '🇮🇹' : '🇬🇧'} {label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t.config.cardTitle}</div>
          <div className="form-group">
            <label className="form-label">{t.config.urlLabel}</label>
            <input className="form-input"
              placeholder={t.config.urlPlaceholder}
              value={cfg.immich_url}
              onChange={e => setCfg(p => ({ ...p, immich_url: e.target.value }))}/>
            <p className="text-xs text-muted mt-1">{t.config.urlHint}</p>
          </div>
          <div className="form-group">
            <label className="form-label">{t.config.apiKeyLabel}</label>
            <input className="form-input" type="password"
              placeholder={cfg.api_key_set ? '(chiave già configurata — lascia invariato per mantenerla)' : (t.config.apiKeyPlaceholder)}
              value={cfg.api_key}
              onChange={e => setCfg(p => ({ ...p, api_key: e.target.value }))}
              style={{ fontFamily: cfg.api_key && cfg.api_key.includes('•') ? 'monospace' : undefined }}/>
            <p className="text-xs text-muted mt-1">{t.config.apiKeyHint}</p>
          </div>
          {status && (
            <div className={`toast ${status.type}`}
              style={{ position:'relative', bottom:'auto', right:'auto', marginBottom:16 }}>
              {status.msg}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner"/> : '💾'} {t.config.save}
            </button>
            <button className="btn" onClick={test} disabled={testing}>
              {testing ? <span className="spinner"/> : '🔗'} {t.config.test}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t.config.guideTitle}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {t.config.guideSteps.map(([n, title, desc]) => (
              <div key={n} className="flex gap-3 items-center">
                <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--gold-dim)',
                  border:'1px solid rgba(212,170,90,0.3)', display:'flex', alignItems:'center',
                  justifyContent:'center', fontSize:12, color:'var(--gold)',
                  fontFamily:'var(--font-mono)', flexShrink:0 }}>{n}</div>
                <div>
                  <strong style={{ fontSize:13 }}>{title}</strong>
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
