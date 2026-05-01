/**
 * LoginGate.jsx — Schermata di login per PhotoBook Studio.
 * Mostrata solo se PHOTOBOOK_TOKEN è impostato nel backend.
 * Se l'auth è disabilitata (/api/auth/status → enabled:false) mostra i figli direttamente.
 */
import { useState, useEffect } from 'react'
import axios from 'axios'

export default function LoginGate({ children }) {
  const [status, setStatus] = useState('checking') // checking | ok | login
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Check if auth is enabled and if we already have a valid session
    axios.get('/api/auth/status')
      .then(r => {
        if (!r.data.enabled) { setStatus('ok'); return }
        // Auth is enabled — try a lightweight call to see if token/cookie is valid
        axios.get('/api/profiles')
          .then(() => setStatus('ok'))
          .catch(e => {
            if (e.response?.status === 401) setStatus('login')
            else setStatus('ok') // network error → let through
          })
      })
      .catch(() => setStatus('ok')) // if status endpoint fails, don't block
  }, [])

  const handleLogin = async (e) => {
    e?.preventDefault()
    if (!password.trim()) return
    setLoading(true); setError('')
    try {
      const r = await axios.post('/api/auth/login', { password })
      // Store token for axios to use on subsequent requests
      axios.defaults.headers.common['Authorization'] = `Bearer ${r.data.token}`
      setStatus('ok')
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore di connessione')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'checking') {
    return (
      <div style={{ position:'fixed', inset:0, background:'#0c0d10',
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:18, height:18, border:'2px solid #d4aa5a',
          borderTopColor:'transparent', borderRadius:'50%',
          animation:'spin 0.8s linear infinite' }}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (status === 'ok') return children

  // Login form
  return (
    <div style={{ position:'fixed', inset:0, background:'#0c0d10',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:"'Sora','Segoe UI',sans-serif" }}>
      <div style={{ width:340, background:'#13141a', border:'1px solid #252830',
        borderRadius:12, padding:40, boxShadow:'0 32px 80px rgba(0,0,0,0.7)' }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>📖</div>
          <h1 style={{ fontSize:20, fontWeight:700, color:'#d4aa5a',
            letterSpacing:'-0.02em', margin:0 }}>PhotoBook Studio</h1>
          <p style={{ fontSize:12, color:'#5a5650', marginTop:4 }}>Accesso protetto</p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:11, color:'#a8a49c',
              marginBottom:6, fontFamily:"'JetBrains Mono',monospace",
              textTransform:'uppercase', letterSpacing:'0.08em' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              placeholder="Inserisci la password di accesso"
              style={{ width:'100%', padding:'10px 14px', fontSize:13,
                background:'#1a1c24', border:`1px solid ${error ? '#e05050' : '#252830'}`,
                borderRadius:7, color:'#e8e5de', outline:'none',
                boxSizing:'border-box', transition:'border-color 0.15s' }}
              onFocus={e => { if (!error) e.target.style.borderColor = '#d4aa5a' }}
              onBlur={e => { if (!error) e.target.style.borderColor = '#252830' }}
            />
            {error && (
              <p style={{ fontSize:11, color:'#e05050', marginTop:6, margin:'6px 0 0' }}>
                ⚠ {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{ width:'100%', padding:'11px 0', fontSize:13, fontWeight:600,
              background: loading || !password.trim() ? '#1a1c24' : '#d4aa5a',
              color: loading || !password.trim() ? '#5a5650' : '#0a0a0c',
              border:'none', borderRadius:7, cursor: loading ? 'wait' : 'pointer',
              transition:'background 0.15s, color 0.15s' }}>
            {loading ? 'Accesso in corso…' : 'Accedi'}
          </button>
        </form>
      </div>
    </div>
  )
}
