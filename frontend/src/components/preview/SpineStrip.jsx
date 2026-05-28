// ── SpineStrip ─────────────────────────────────────────────────────────────────
// Narrow vertical strip rendered beside copertina fronte (left) or quarta (right).
// rotate(-90deg): row left → visual bottom, row right → visual top.
// So: top-positioned items → rightZone (flex-end), bottom → leftZone (flex-start).
export default function SpineStrip({ spine, albumName, albumYear, widthPx, heightPx }) {
  const s   = spine || {}
  const bg  = s.bg || '#0a0a0e'
  const cap = (pct, def) => Math.max(6, Math.min(Math.round(widthPx * 0.72), Math.round(heightPx * (pct || def) / 100)))

  const allItems = [
    s.title_enabled !== false && albumName
      ? { pos: s.title_pos||'center', text: albumName, color: s.title_color||'#f0ede6',
          sz: cap(s.title_size_pct, 2.5), font:'var(--font-display, Georgia, serif)', ls:'0.04em' }
      : null,
    s.subtitle_enabled && albumName
      ? { pos: s.subtitle_pos||'center', text: '—', color: s.subtitle_color||'#b8b0a0',
          sz: cap(s.subtitle_size_pct, 1.8), font:'var(--font-body, sans-serif)', ls:0 }
      : null,
    s.year_enabled !== false && albumYear
      ? { pos: s.year_pos||'center', text: albumYear, color: s.year_color||'#d4aa5a',
          sz: cap(s.year_size_pct, 1.5), font:'var(--font-mono, monospace)', ls:0 }
      : null,
    s.custom_text_enabled && s.custom_text
      ? { pos: s.custom_text_pos||'center', text: s.custom_text, color: s.custom_text_color||'#fff',
          sz: cap(s.custom_text_size_pct, 1.8), font:'var(--font-body, sans-serif)', ls:0 }
      : null,
  ].filter(Boolean)

  const zone = (pos) => allItems.filter(i => i.pos === pos)
  const renderSpan = (item, i) => (
    <span key={i} style={{ fontSize:item.sz, color:item.color, fontFamily:item.font,
      letterSpacing:item.ls, whiteSpace:'nowrap' }}>
      {item.text}
    </span>
  )

  const rot180 = !!s.spine_rotate_180
  // rotate(-90deg): row-left → visual bottom, row-right → visual top
  // rotate( 90deg): row-left → visual top,    row-right → visual bottom
  const rotDeg = rot180 ? 90 : -90
  const leftZone  = rot180 ? zone('top')    : zone('bottom')
  const rightZone = rot180 ? zone('bottom') : zone('top')

  const centerItems = zone('center')
  return (
    <div style={{ width:widthPx, height:heightPx, background:bg, flexShrink:0,
      overflow:'hidden', borderRadius:2, position:'relative' }}>
      {/* Left/right zones via rotated row — center slot is a blank spacer */}
      <div style={{
        position:'absolute', left:'50%', top:'50%',
        width:heightPx,
        transform:`translate(-50%,-50%) rotate(${rotDeg}deg)`,
        display:'flex', flexDirection:'row', alignItems:'center',
        padding:'0 6px', boxSizing:'border-box',
      }}>
        <div style={{ flex:1, display:'flex', justifyContent:'flex-start', gap:3, overflow:'hidden' }}>
          {leftZone.map(renderSpan)}
        </div>
        <div style={{ flex:1 }} />
        <div style={{ flex:1, display:'flex', justifyContent:'flex-end', gap:3, overflow:'hidden' }}>
          {rightZone.map(renderSpan)}
        </div>
      </div>
      {/* Center items: own div anchored at spine midpoint so group is always centered */}
      {centerItems.length > 0 && (
        <div style={{
          position:'absolute', left:'50%', top:'50%',
          transform:`translate(-50%,-50%) rotate(${rotDeg}deg)`,
          display:'flex', flexDirection:'row', alignItems:'center',
          gap:3, whiteSpace:'nowrap',
          maxWidth: Math.round(heightPx * 0.34), overflow:'hidden',
        }}>
          {centerItems.map(renderSpan)}
        </div>
      )}
    </div>
  )
}
