import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'
import { useT } from './i18n.jsx'
import { version as APP_VERSION } from '../package.json'

const GITHUB_REPO = 'romaruss/ImmichPhotoBook'

function isNewer(current, latest) {
  const a = current.split('.').map(Number)
  const b = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true
    if ((b[i] || 0) < (a[i] || 0)) return false
  }
  return false
}
import ConfigPage from './pages/ConfigPage'
import HomePage from './pages/HomePage'
import ProfilesPage from './pages/ProfilesPage'
import AlbumsPage from './pages/AlbumsPage'
import PreviewPage from './pages/PreviewPage'
import DeepConfigPage from './pages/DeepConfigPage'

function Shell() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [connected, setConnected] = useState(null)
  const [navCollapsed, setNavCollapsed] = useState(() => location.pathname.startsWith('/preview'))
  const [latestVersion, setLatestVersion] = useState(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoDismissed, setDemoDismissed] = useState(false)
  const [devTools, setDevTools] = useState(false)

  useEffect(() => {
    axios.get('/api/config/test')
      .then(r => { setConnected(r.data.connected); setDemoMode(!!r.data.demo); setDevTools(!!r.data.dev_tools) })
      .catch(() => setConnected(false))
  }, [])

  useEffect(() => {
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      .then(r => r.json())
      .then(d => { const tag = (d.tag_name || '').replace(/^v/, ''); if (tag) setLatestVersion(tag) })
      .catch(() => {})
  }, [])

  const updateAvailable = latestVersion && isNewer(APP_VERSION, latestVersion)

  // Auto-collapse nav when entering preview
  useEffect(() => {
    if (location.pathname.startsWith('/preview')) setNavCollapsed(true)
  }, [location.pathname])

  const NAV = [
    { path: '/',         label: t.nav.home,       icon: '🏠' },
    { path: '/config',   label: t.nav.config,     icon: '⚙️' },
    { path: '/profiles', label: t.nav.profiles,   icon: '📐' },
    { path: '/albums',   label: t.nav.albums,     icon: '🖼️' },
    { path: '/preview',  label: t.nav.preview,    icon: '📖' },
    ...(devTools ? [{ path: '/deep-config', label: t.nav.deepConfig, icon: '🔧' }] : []),
  ]

  const currentPath = '/' + location.pathname.split('/')[1]
  const isActive = (path) => path === '/' ? location.pathname === '/' : currentPath === path

  return (
    <div className="app-shell">
      <aside className="sidebar" style={{
        width: navCollapsed ? 48 : 220,
        minWidth: navCollapsed ? 48 : 220,
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* Collapse toggle tab — always visible on the right edge */}
        <button
          onClick={() => setNavCollapsed(c => !c)}
          title={navCollapsed ? t.nav.expandMenu : t.nav.collapseMenu}
          style={{
            position: 'absolute',
            right: 0, top: '50%', transform: 'translateY(-50%)',
            width: 16, height: 48,
            background: 'var(--bg3)',
            border: '1px solid var(--border)', borderRight: 'none',
            borderRadius: '5px 0 0 5px',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: 'var(--text3)',
            zIndex: 20,
          }}>
          {navCollapsed ? '›' : '‹'}
        </button>

        {!navCollapsed && (
          <div className="sidebar-logo">
            <h1>{t.app.title}<span>{t.app.subtitle}</span><br/>{t.app.subtitle2 || ''}</h1>
            <p>{t.app.tagline}</p>
          </div>
        )}

        <nav className="sidebar-nav" style={{ paddingTop: navCollapsed ? 16 : 16 }}>
          {NAV.map(item => (
            <div key={item.path}
              className={`nav-item${isActive(item.path) ? ' active' : ''}`}
              onClick={() => navigate(item.path)}
              title={item.label}
              style={{
                justifyContent: navCollapsed ? 'center' : undefined,
                padding: navCollapsed ? '10px 0' : undefined,
              }}>
              <span className="icon">{item.icon}</span>
              {!navCollapsed && item.label}
            </div>
          ))}
        </nav>

        {!navCollapsed && (
          <div className="sidebar-bottom">
            <div className="sidebar-conn">
              <span className={`conn-dot${connected === true ? ' ok' : connected === false ? ' err' : ''}`}/>
              {connected === true
                ? t.connection.connected
                : connected === false
                ? t.connection.disconnected
                : t.connection.checking}
            </div>
            <div className="sidebar-version">
              <span>v{APP_VERSION}</span>
              {updateAvailable && (
                <a
                  href={`https://github.com/${GITHUB_REPO}/releases/latest`}
                  target="_blank" rel="noreferrer"
                  className="update-badge"
                  title={t.app.updateTooltip(latestVersion)}
                >
                  ↑ v{latestVersion}
                </a>
              )}
            </div>
          </div>
        )}
      </aside>
      <main className="main-content">
        {demoMode && !demoDismissed && (
          <div style={{
            background: 'rgba(212,170,90,0.12)', borderBottom: '1px solid rgba(212,170,90,0.35)',
            padding: '9px 20px', display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12, color: 'var(--text2)',
          }}>
            <span>🎭</span>
            <span>{t.app.demoBanner}</span>
            <a href="https://github.com/romaruss/ImmichPhotoBook" target="_blank" rel="noreferrer"
              style={{ color: 'var(--gold)', marginLeft: 4 }}>
              {t.app.demoBannerLink} →
            </a>
            <button onClick={() => setDemoDismissed(true)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none',
                color: 'var(--text3)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>
              ✕
            </button>
          </div>
        )}
        <Routes>
          <Route path="/"         element={<HomePage />} />
          <Route path="/config"   element={<ConfigPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/profiles/:pid" element={<ProfilesPage />} />
          <Route path="/albums"   element={<AlbumsPage />} />
          <Route path="/preview"  element={<PreviewPage devTools={devTools} />} />
          <Route path="/deep-config" element={<DeepConfigPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
