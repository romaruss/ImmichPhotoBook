import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { useT } from '../i18n.jsx'

// ── ParamRow ─────────────────────────────────────────────────────────────────

function ParamRow({ sectionKey, paramKey, schema, value, defaultValue, onChange, onReset }) {
  const t    = useT()
  const dc   = t.deepConfig
  const loc  = t.deepConfigSchema?.[sectionKey]?.[paramKey] || {}
  const meta = schema[sectionKey]?.[paramKey] || {}
  const isModified = value !== defaultValue
  const type = meta.type || 'float'

  const inputStyle = {
    padding: '3px 8px', fontSize: 12, borderRadius: 5,
    border: `1px solid ${isModified ? 'var(--gold)' : 'var(--border)'}`,
    background: isModified ? 'rgba(212,170,90,0.08)' : 'var(--bg3)',
    color: 'var(--text)',
    width: type === 'color' ? 40 : type === 'bool' ? 'auto' : 110,
    height: 28,
    cursor: type === 'color' ? 'pointer' : undefined,
  }

  const handleChange = (e) => {
    let v = e.target.value
    if (type === 'int')   v = parseInt(v, 10)
    else if (type === 'float') v = parseFloat(v)
    else if (type === 'bool')  v = e.target.checked
    if (!isNaN(v) || type === 'color' || type === 'bool') onChange(sectionKey, paramKey, v)
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto auto',
      gap: 10,
      alignItems: 'start',
      padding: '8px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Label + description */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
            {loc.label || paramKey}
          </span>
          {isModified && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: 'var(--gold-dim)', color: 'var(--gold)',
              fontWeight: 600, letterSpacing: '0.04em',
            }}>
              {dc.modifiedBadge}
            </span>
          )}
        </div>
        {loc.description && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, lineHeight: 1.4 }}>
            {loc.description}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
          {dc.defaultLabel} <code style={{ fontSize: 10 }}>{String(defaultValue)}</code>
        </div>
      </div>

      {/* Input */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {type === 'bool' ? (
          <input type="checkbox" checked={!!value} onChange={handleChange}
            style={{ cursor: 'pointer', width: 14, height: 14 }}/>
        ) : (
          <input
            type={type === 'color' ? 'color' : 'number'}
            value={value}
            onChange={handleChange}
            min={meta.min}
            max={meta.max}
            step={meta.step ?? (type === 'int' ? 1 : 0.01)}
            style={inputStyle}
          />
        )}
      </div>

      {/* Min/max hint */}
      {type !== 'bool' && type !== 'color' && (
        <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'right', paddingTop: 6, whiteSpace: 'nowrap' }}>
          {meta.min !== undefined && `${meta.min} – ${meta.max}`}
        </div>
      )}

      {/* Reset button */}
      <button
        onClick={() => onReset(sectionKey, paramKey)}
        disabled={!isModified}
        title={dc.resetParam}
        style={{
          background: 'none', border: 'none', cursor: isModified ? 'pointer' : 'default',
          color: isModified ? 'var(--text3)' : 'var(--border)',
          fontSize: 14, padding: '4px 2px', lineHeight: 1,
        }}>
        ↺
      </button>
    </div>
  )
}

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ sectionKey, schema, current, defaults, onChange, onReset, search, open, onToggle }) {
  const t = useT()
  const sectionSchema = schema[sectionKey] || {}
  const locSection    = t.deepConfigSchema?.[sectionKey] || {}
  const sectionLabel  = locSection._label || sectionKey
  const params = Object.keys(sectionSchema).filter(k => k !== '_label')

  const filtered = search
    ? params.filter(k => {
        const loc = locSection[k] || {}
        const q = search.toLowerCase()
        return (
          k.toLowerCase().includes(q) ||
          (loc.label || '').toLowerCase().includes(q) ||
          (loc.description || '').toLowerCase().includes(q)
        )
      })
    : params

  if (filtered.length === 0) return null

  const modifiedCount = filtered.filter(k => current[sectionKey]?.[k] !== defaults[sectionKey]?.[k]).length

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', marginBottom: 12,
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
          {sectionLabel}
        </span>
        {modifiedCount > 0 && (
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 10,
            background: 'var(--gold-dim)', color: 'var(--gold)', fontWeight: 600,
          }}>
            {modifiedCount}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{filtered.length} param</span>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 8px' }}>
          {filtered.map(k => (
            <ParamRow
              key={k}
              sectionKey={sectionKey}
              paramKey={k}
              schema={schema}
              value={current[sectionKey]?.[k] ?? defaults[sectionKey]?.[k]}
              defaultValue={defaults[sectionKey]?.[k]}
              onChange={onChange}
              onReset={onReset}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── DeepConfigPage ────────────────────────────────────────────────────────────

export default function DeepConfigPage() {
  const t  = useT().deepConfig

  const [schema,   setSchema]   = useState(null)
  const [defaults, setDefaults] = useState(null)
  const [current,  setCurrent]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [status,   setStatus]   = useState(null)   // null | 'saved' | 'error'
  const [search,   setSearch]   = useState('')
  const [openSections, setOpenSections] = useState({})

  useEffect(() => {
    axios.get('/api/deep-config')
      .then(r => {
        setSchema(r.data.schema)
        setDefaults(r.data.defaults)
        setCurrent(r.data.current)
        const all = {}
        Object.keys(r.data.schema).forEach(k => { all[k] = true })
        setOpenSections(all)
      })
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false))
  }, [])

  const handleChange = (section, key, value) => {
    setCurrent(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }))
    setStatus(null)
  }

  const handleReset = (section, key) => {
    setCurrent(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: defaults[section][key] },
    }))
    setStatus(null)
  }

  const handleResetAll = () => {
    setCurrent(JSON.parse(JSON.stringify(defaults)))
    setStatus(null)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await axios.post('/api/deep-config', current)
      setStatus('saved')
      setTimeout(() => setStatus(null), 3000)
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const toggleSection = (key) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  const toggleAll = (open) => {
    const all = {}
    Object.keys(schema || {}).forEach(k => { all[k] = open })
    setOpenSections(all)
  }

  const totalModified = useMemo(() => {
    if (!current || !defaults) return 0
    let n = 0
    for (const sec of Object.keys(defaults)) {
      for (const k of Object.keys(defaults[sec] || {})) {
        if (current[sec]?.[k] !== defaults[sec]?.[k]) n++
      }
    }
    return n
  }, [current, defaults])

  const sections = schema ? Object.keys(schema) : []

  if (loading) return (
    <div style={{ padding: 32, color: 'var(--text3)', fontSize: 13 }}>…</div>
  )

  if (!schema) return (
    <div style={{ padding: 32, color: 'var(--error)', fontSize: 13 }}>{t.errorLoad}</div>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 22, margin: 0 }}>
          {t.title}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text3)', margin: '6px 0 0' }}>
          {t.subtitle}
        </p>
        <p style={{ fontSize: 11, color: 'var(--gold)', margin: '4px 0 0' }}>
          {t.reloadHint}
        </p>
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center',
        flexWrap: 'wrap', marginBottom: 16,
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', padding: '8px 0', borderBottom: '1px solid var(--border)',
      }}>
        <input
          type="search"
          className="form-input"
          placeholder={t.searchPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, fontSize: 12 }}
        />
        <button className="btn btn-sm" onClick={() => toggleAll(true)}
          style={{ fontSize: 11 }}>{t.expandAll}</button>
        <button className="btn btn-sm" onClick={() => toggleAll(false)}
          style={{ fontSize: 11 }}>{t.collapseAll}</button>
        <button className="btn btn-sm btn-danger"
          onClick={handleResetAll}
          disabled={totalModified === 0}
          style={{ fontSize: 11 }}>
          {t.resetAllBtn}
          {totalModified > 0 && ` (${totalModified})`}
        </button>
        <button
          className={`btn btn-sm btn-primary`}
          onClick={handleSave}
          disabled={saving}>
          {saving ? t.saving : t.saveBtn}
          {!saving && totalModified > 0 && ` (${totalModified})`}
        </button>
        {status === 'saved' && (
          <span style={{ fontSize: 12, color: 'var(--success, #4ade80)' }}>{t.saved}</span>
        )}
        {status === 'error' && (
          <span style={{ fontSize: 12, color: 'var(--error, #f87171)' }}>{t.errorSave}</span>
        )}
      </div>

      {/* Sections */}
      {sections.map(sectionKey => (
        <SectionCard
          key={sectionKey}
          sectionKey={sectionKey}
          schema={schema}
          current={current}
          defaults={defaults}
          onChange={handleChange}
          onReset={handleReset}
          search={search}
          open={!!openSections[sectionKey]}
          onToggle={() => toggleSection(sectionKey)}
        />
      ))}

      {search && sections.every(s => {
        const ss = schema[s] || {}
        const params = Object.keys(ss).filter(k => k !== '_label')
        return !params.some(k => {
          const meta = ss[k] || {}
          const q = search.toLowerCase()
          return k.toLowerCase().includes(q) ||
            (meta.label || '').toLowerCase().includes(q) ||
            (meta.description || '').toLowerCase().includes(q)
        })
      }) && (
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32, fontSize: 13 }}>
          {t.noResults}
        </div>
      )}
    </div>
  )
}
