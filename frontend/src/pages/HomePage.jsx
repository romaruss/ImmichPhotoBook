/**
 * HomePage.jsx — Dashboard principale di PhotoBook Studio.
 * Landing page con stato sistema, accesso rapido ai progetti e CTA principale.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, sub, onClick, accent = false, disabled = false }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, minWidth: 160,
        background: hover ? 'var(--bg3)' : 'var(--bg2)',
        border: `1px solid ${accent && !disabled ? 'rgba(212,170,90,0.35)' : 'var(--border)'}`,
        borderRadius: 10, padding: '20px 22px',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s, border-color 0.15s, transform 0.15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        opacity: disabled ? 0.5 : 1,
      }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
      <div style={{
        fontSize: 32, fontWeight: 700, lineHeight: 1,
        color: accent ? 'var(--gold)' : 'var(--text)',
        fontFamily: "'JetBrains Mono', monospace",
        marginBottom: 4,
      }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'JetBrains Mono', monospace" }}>{sub}</div>}
    </div>
  )
}

// ── Project row ───────────────────────────────────────────────────────────────
function ProjectRow({ project, onOpen, onDelete }) {
  const [hover, setHover] = useState(false)
  const fmt = iso => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const diffH = (now - d) / 3_600_000
    if (diffH < 1)   return `${Math.round(diffH * 60)} min fa`
    if (diffH < 24)  return `${Math.round(diffH)}h fa`
    if (diffH < 168) return `${Math.round(diffH / 24)}g fa`
    return d.toLocaleDateString('it-IT')
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px', borderRadius: 8,
        background: hover ? 'var(--bg3)' : 'transparent',
        border: '1px solid transparent',
        borderColor: hover ? 'var(--border)' : 'transparent',
        transition: 'all 0.12s', cursor: 'pointer',
      }}
      onClick={() => onOpen(project.id)}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>📂</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name || 'Progetto senza nome'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
          {[project.album_name, project.profile_name, project.page_count ? `${project.page_count} pag.` : null]
            .filter(Boolean).join(' · ')}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'JetBrains Mono', monospace",
        flexShrink: 0, textAlign: 'right' }}>
        {fmt(project.updated_at || project.saved_at)}
      </div>
      {hover && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(project.id, project.name) }}
          style={{ background: 'none', border: 'none', color: 'var(--text3)',
            cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0,
            borderRadius: 4, lineHeight: 1 }}
          title="Elimina progetto">
          🗑
        </button>
      )}
      <div style={{ fontSize: 14, color: 'var(--gold)', flexShrink: 0 }}>→</div>
    </div>
  )
}

// ── Main HomePage ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const t = useT()
  const navigate = useNavigate()
  const [connected, setConnected] = useState(null)   // null=checking, true, false
  const [version, setVersion]       = useState(null)
  const [profileCount, setProfileCount] = useState(null)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      axios.get('/api/config/test').then(r => setConnected(r.data.connected)).catch(() => setConnected(false)),
      axios.get('/api/health').then(r => setVersion(r.data.version)).catch(() => {}),
      axios.get('/api/profiles').then(r => setProfileCount(r.data.length)).catch(() => setProfileCount(0)),
      axios.get('/api/projects').then(r => setProjects(r.data || [])).catch(() => setProjects([])),
    ]).finally(() => setLoading(false))
  }, [])

  const loadProject = async (pid) => {
    try {
      const r = await axios.get(`/api/projects/${pid}`)
      sessionStorage.setItem('photobook_layout', JSON.stringify({
        album: r.data.album, profile: r.data.profile,
        pages: r.data.pages, locations: r.data.locations || [],
        page_logs: r.data.page_logs || [],
      }))
      if (r.data.photo_transforms && Object.keys(r.data.photo_transforms).length)
        sessionStorage.setItem('photobook_transforms', JSON.stringify(r.data.photo_transforms))
      else
        sessionStorage.removeItem('photobook_transforms')
      sessionStorage.setItem('photobook_project_id', pid)
      navigate('/preview')
    } catch { alert('Errore nel caricamento del progetto') }
  }

  const deleteProject = async (pid, name) => {
    if (!window.confirm(`Eliminare il progetto "${name}"?`)) return
    await axios.delete(`/api/projects/${pid}`)
    setProjects(p => p.filter(x => x.id !== pid))
  }

  const lastProject = projects[0] || null
  const connOk = connected === true
  const connFail = connected === false

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 32px' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{
          fontSize: 32, fontWeight: 700, color: 'var(--gold)',
          fontFamily: "'Sora', sans-serif", letterSpacing: '-0.03em',
          lineHeight: 1.1, margin: 0,
        }}>
          PhotoBook Studio
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text3)', marginTop: 8 }}>
          Crea fotolibri di stampa professionale dalle tue raccolte Immich
        </p>
      </div>

      {/* ── Status bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: 8, marginBottom: 36,
        background: connOk ? 'rgba(93,189,122,0.08)' : connFail ? 'rgba(224,80,80,0.08)' : 'var(--bg2)',
        border: `1px solid ${connOk ? 'rgba(93,189,122,0.3)' : connFail ? 'rgba(224,80,80,0.3)' : 'var(--border)'}`,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: connOk ? '#5dbd7a' : connFail ? '#e05050' : '#5a5650',
          boxShadow: connOk ? '0 0 6px #5dbd7a' : connFail ? '0 0 6px #e05050' : 'none',
        }}/>
        <span style={{ fontSize: 13, color: connOk ? '#5dbd7a' : connFail ? '#e05050' : 'var(--text3)' }}>
          {connected === null
            ? 'Verifica connessione a Immich…'
            : connOk
            ? 'Connesso a Immich ✓'
            : 'Immich non raggiungibile — controlla le impostazioni'}
        </span>
        {connFail && (
          <button onClick={() => navigate('/config')}
            style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11,
              background: 'var(--bg3)', border: '1px solid var(--border)',
              color: 'var(--text2)', borderRadius: 5, cursor: 'pointer' }}>
            ⚙ Configurazione
          </button>
        )}
        {!connFail && version && (
          <span style={{ marginLeft: 'auto', fontSize: 10,
            color: 'var(--text3)', fontFamily: "'JetBrains Mono', monospace",
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '2px 8px' }}>
            v{version}
          </span>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 36, flexWrap: 'wrap' }}>
        <StatCard
          icon="📐"
          value={loading ? '…' : profileCount ?? 0}
          label="Profili di stampa"
          sub={profileCount === 0 ? 'Nessuno ancora — creane uno' : profileCount === 1 ? '1 profilo configurato' : `${profileCount} profili configurati`}
          onClick={() => navigate('/profiles')}
          accent={profileCount > 0}
        />
        <StatCard
          icon="💾"
          value={loading ? '…' : projects.length}
          label="Progetti salvati"
          sub={projects.length === 0 ? 'Nessuno ancora' : `Ultimo: ${projects[0]?.name || '—'}`}
          onClick={() => projects.length > 0 && loadProject(projects[0].id)}
          accent={projects.length > 0}
          disabled={projects.length === 0}
        />
        <StatCard
          icon="🖼"
          value="→"
          label="Album Immich"
          sub="Sfoglia e seleziona"
          onClick={() => navigate('/albums')}
          accent
        />
      </div>

      {/* ── Main CTA ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(212,170,90,0.12) 0%, rgba(212,170,90,0.04) 100%)',
        border: '1px solid rgba(212,170,90,0.3)',
        borderRadius: 12, padding: '28px 32px', marginBottom: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
        flexWrap: 'wrap',
      }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0, marginBottom: 6 }}>
            Crea un nuovo fotolibro
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>
            Seleziona un album da Immich, scegli il profilo e genera il layout automaticamente
          </p>
        </div>
        <button
          onClick={() => navigate('/albums')}
          disabled={!connOk}
          style={{
            padding: '12px 28px', fontSize: 14, fontWeight: 600,
            background: connOk ? 'var(--gold)' : 'var(--bg3)',
            color: connOk ? '#0a0a0c' : 'var(--text3)',
            border: 'none', borderRadius: 8,
            cursor: connOk ? 'pointer' : 'not-allowed',
            transition: 'opacity 0.15s', flexShrink: 0,
          }}>
          📖 Genera album
        </button>
      </div>

      {/* ── Recent projects ── */}
      {projects.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12 }}>
            <h3 style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em',
              margin: 0, fontWeight: 400 }}>
              Progetti recenti
            </h3>
          </div>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden', padding: '6px 0' }}>
            {projects.slice(0, 6).map(p => (
              <ProjectRow
                key={p.id} project={p}
                onOpen={loadProject}
                onDelete={deleteProject}
              />
            ))}
            {projects.length > 6 && (
              <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text3)',
                textAlign: 'center', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                e altri {projects.length - 6} progetti — aprili dall'anteprima con 📂
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty state (no projects yet) ── */}
      {!loading && projects.length === 0 && profileCount === 0 && (
        <div style={{ marginTop: 8, padding: '32px 0', textAlign: 'center',
          color: 'var(--text3)', fontSize: 13 }}>
          <p style={{ marginBottom: 20, lineHeight: 1.6 }}>
            Per iniziare: <strong style={{color:'var(--text2)'}}>1</strong> crea un profilo di stampa →{' '}
            <strong style={{color:'var(--text2)'}}>2</strong> seleziona un album →{' '}
            <strong style={{color:'var(--text2)'}}>3</strong> genera il layout
          </p>
          <button onClick={() => navigate('/profiles')}
            style={{ padding: '10px 24px', fontSize: 13, background: 'var(--bg3)',
              border: '1px solid var(--border)', color: 'var(--text2)',
              borderRadius: 7, cursor: 'pointer' }}>
            📐 Crea il primo profilo
          </button>
        </div>
      )}

      {/* ── Quick links ── */}
      <div style={{ display: 'flex', gap: 8, marginTop: 40, flexWrap: 'wrap' }}>
        {[
          { label: '⚙ Configurazione', path: '/config' },
          { label: '📐 Profili di stampa', path: '/profiles' },
          { label: '🖼 Album & Layout', path: '/albums' },
        ].map(({ label, path }) => (
          <button key={path} onClick={() => navigate(path)}
            style={{ padding: '7px 14px', fontSize: 12,
              background: 'var(--bg2)', border: '1px solid var(--border)',
              color: 'var(--text3)', borderRadius: 6, cursor: 'pointer',
              transition: 'color 0.1s, border-color 0.1s' }}
            onMouseEnter={e => { e.target.style.color='var(--text)'; e.target.style.borderColor='var(--text3)' }}
            onMouseLeave={e => { e.target.style.color='var(--text3)'; e.target.style.borderColor='var(--border)' }}>
            {label}
          </button>
        ))}
      </div>

    </div>
  )
}
