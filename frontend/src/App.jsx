import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'
import { useT } from './i18n.jsx'
import ConfigPage from './pages/ConfigPage'
import ProfilesPage from './pages/ProfilesPage'
import AlbumsPage from './pages/AlbumsPage'
import PreviewPage from './pages/PreviewPage'

function Shell() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [connected, setConnected] = useState(null)

  useEffect(() => {
    axios.get('/api/config/test')
      .then(r => setConnected(r.data.connected))
      .catch(() => setConnected(false))
  }, [])

  const NAV = [
    { path: '/config',   label: t.nav.config,   icon: '⚙️' },
    { path: '/profiles', label: t.nav.profiles,  icon: '📐' },
    { path: '/albums',   label: t.nav.albums,    icon: '🖼️' },
    { path: '/preview',  label: t.nav.preview,   icon: '📖' },
  ]

  const currentPath = '/' + location.pathname.split('/')[1]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>{t.app.title}<span>{t.app.subtitle}</span><br/>{t.app.subtitle2 || ''}</h1>
          <p>{t.app.tagline}</p>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <div key={item.path}
              className={`nav-item${currentPath === item.path ? ' active' : ''}`}
              onClick={() => navigate(item.path)}>
              <span className="icon">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`conn-dot${connected === true ? ' ok' : connected === false ? ' err' : ''}`}/>
          {connected === true
            ? t.connection.connected
            : connected === false
            ? t.connection.disconnected
            : t.connection.checking}
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/"         element={<ConfigPage />} />
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
