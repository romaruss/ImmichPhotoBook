import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'
import { useT } from './i18n.jsx'
import ConfigPage from './pages/ConfigPage'
import HomePage from './pages/HomePage'
import ProfilesPage from './pages/ProfilesPage'
import AlbumsPage from './pages/AlbumsPage'
import PreviewPage from './pages/PreviewPage'

function Shell() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [connected, setConnected] = useState(null)
  const [navCollapsed, setNavCollapsed] = useState(false)

  useEffect(() => {
    axios.get('/api/config/test')
      .then(r => setConnected(r.data.connected))
      .catch(() => setConnected(false))
  }, [])

  const NAV = [
    { path: '/',         label: 'Home',           icon: '🏠' },
    { path: '/config',   label: t.nav.config,     icon: '⚙️' },
    { path: '/profiles', label: t.nav.profiles,   icon: '📐' },
    { path: '/albums',   label: t.nav.albums,     icon: '🖼️' },
    { path: '/preview',  label: t.nav.preview,    icon: '📖' },
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
          title={navCollapsed ? 'Espandi menu' : 'Comprimi menu'}
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
            <span className={`conn-dot${connected === true ? ' ok' : connected === false ? ' err' : ''}`}/>
            {connected === true
              ? t.connection.connected
              : connected === false
              ? t.connection.disconnected
              : t.connection.checking}
          </div>
        )}
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/"         element={<HomePage />} />
          <Route path="/config"   element={<ConfigPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/profiles/:pid" element={<ProfilesPage />} />
          <Route path="/albums"   element={<AlbumsPage />} />
          <Route path="/preview"  element={<PreviewPage />} />
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
