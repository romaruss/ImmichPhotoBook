import { useState, useEffect } from 'react'
import axios from 'axios'
import { useT, useLang, LOCALES } from '../i18n.jsx'

export default function ConfigPage() {
  const t = useT()
  const { lang, setLang } = useLang()
  const [cfg, setCfg]     = useState({ immich_url: '', api_key: '', stadia_api_key: '' })
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
              placeholder={cfg.api_key_set ? t.config.apiKeySetPlaceholder : t.config.apiKeyPlaceholder}
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
          <div className="card-title">{t.config.mapsTitle}</div>
          <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
            {t.config.mapsHint}<br/>
            {t.config.mapsHintKey}
          </p>
          <div className="form-group">
            <label className="form-label">
              {t.config.stadiaKeyLabel}
              {cfg.stadia_api_key_set && !cfg.stadia_api_key?.includes('•') === false &&
                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{t.config.stadiaKeySetBadge}</span>}
            </label>
            <input className="form-input" type="password"
              placeholder={cfg.stadia_api_key_set ? t.config.stadiaKeySetPlaceholder : t.config.stadiaKeyPlaceholder}
              value={cfg.stadia_api_key || ''}
              onChange={e => setCfg(p => ({ ...p, stadia_api_key: e.target.value }))}/>
            <p className="text-xs text-muted mt-1">
              {t.config.stadiaKeyLinkText}{' '}
              <a href="https://client.stadiamaps.com/signup/" target="_blank" rel="noreferrer"
                style={{ color: 'var(--gold)' }}>stadiamaps.com</a>.{' '}
              {t.config.stadiaKeyHint2}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginTop: 4 }}>
            {t.config.mapProviders.map(p => (
              <span key={p.label} style={{ background: 'var(--bg3)', border: '1px solid var(--border)',
                padding: '3px 8px', borderRadius: 4, color: 'var(--text2)' }}>
                {p.label} <span style={{ color: 'var(--text3)' }}>— {p.hint}</span>
              </span>
            ))}
          </div>
          <div className="flex gap-2" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner"/> : '💾'} {t.config.save}
            </button>
          </div>
        </div>

      </div>
    </>
  )
}
