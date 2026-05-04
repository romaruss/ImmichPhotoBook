/**
 * DividerEditor.jsx — Reusable editor for album divider pages.
 *
 * Data model (divider_style):
 *   bg:          "#rrggbb"          — solid background colour
 *   elements:    [...]              — ordered list; positions in % of page (centre anchor)
 *   lines:       [...]              — separator lines
 *   layer_order: [id, ...]         — unified z-order (index 0 = backmost, last = frontmost)
 *
 * Exports:
 *   DEFAULT_DIVIDER_STYLE
 *   migrateDividerStyle(ds)
 *   DividerCanvas             — standalone canvas renderer (PreviewPage)
 *   DividerEditorModal        — full-screen modal (PreviewPage live editing)
 *   default DividerEditor     — full editor (ProfilesPage)
 */

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

const uid   = () => Math.random().toString(36).slice(2, 9)
const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v))

// ── Default style ─────────────────────────────────────────────────────────────

export const DEFAULT_DIVIDER_STYLE = {
  bg: '#13141a',
  elements: [
    { id:'e_title',    type:'title',       enabled:true,  x:50, y:38, font:'display', font_size:5.5, color:'#f0ede6', align:'center', opacity:100 },
    { id:'e_subtitle', type:'subtitle',    enabled:true,  x:50, y:50, font:'sans',    font_size:2.8, color:'#b8b0a0', align:'center', opacity:100 },
    { id:'e_date',     type:'date_range',  enabled:true,  x:50, y:61, font:'mono',    font_size:2.2, color:'#d4aa5a', align:'center', opacity:100 },
    { id:'e_count',    type:'photo_count', enabled:true,  x:50, y:68, font:'mono',    font_size:2.2, color:'#d4aa5a', align:'center', opacity:100 },
    { id:'e_map',      type:'map',         enabled:false, x:50, y:25, w:55, h:35, opacity:90 },
    { id:'e_photo',    type:'photo',       enabled:false, x:50, y:25, w:40, h:30, opacity:100 },
    { id:'e_text1',    type:'text_custom', enabled:false, x:50, y:80, font:'sans', font_size:2.2, color:'#ffffff', align:'center', opacity:100, text:'Testo personalizzato' },
  ],
  lines: [
    { id:'l1', orientation:'h', x:50, y:44, length:55, thickness:1, color:'#d4aa5a', opacity:50 },
    { id:'l2', orientation:'h', x:50, y:73, length:55, thickness:1, color:'#d4aa5a', opacity:50 },
  ],
  layer_order: ['e_title','e_subtitle','e_date','e_count','e_map','e_photo','l1','l2','e_text1'],
}

// ── Migration from old format ─────────────────────────────────────────────────

export function migrateDividerStyle(ds) {
  if (!ds) return { ...DEFAULT_DIVIDER_STYLE }
  if (ds.elements) {
    // New format — ensure layer_order is present
    if (!ds.layer_order) {
      return {
        ...ds,
        layer_order: [
          ...(ds.elements||[]).map(e => e.id),
          ...(ds.lines||[]).map(l => l.id),
        ],
      }
    }
    return ds
  }
  // Old format migration
  const accent  = ds.accent_color || '#d4aa5a'
  const textCol = ds.text_color   || '#f0ede6'
  return {
    bg: ds.bg || '#13141a',
    elements: DEFAULT_DIVIDER_STYLE.elements.map(el => ({
      ...el,
      color: el.type === 'title'
        ? textCol
        : ['subtitle','date_range','photo_count'].includes(el.type) ? accent : el.color,
    })),
    lines: DEFAULT_DIVIDER_STYLE.lines.map(l => ({ ...l, color: accent })),
    layer_order: [
      ...DEFAULT_DIVIDER_STYLE.elements.map(e => e.id),
      ...DEFAULT_DIVIDER_STYLE.lines.map(l => l.id),
    ],
  }
}

// ── Element metadata ──────────────────────────────────────────────────────────

const EL_META = {
  title:       { label:'Titolo album',     icon:'📛', block:false },
  subtitle:    { label:'Sottotitolo',      icon:'📝', block:false },
  date_range:  { label:'Date (da … a …)', icon:'📅', block:false },
  photo_count: { label:'Numero di foto',   icon:'🔢', block:false },
  text_custom: { label:'Testo libero',     icon:'✏️', block:false },
  map:         { label:'Mappa GPS',        icon:'🗺', block:true  },
  photo:       { label:'Slot fotografico', icon:'📷', block:true  },
}

const FONT_FAMILY = {
  display: 'var(--font-display, Georgia, serif)',
  serif:   'Georgia, "Times New Roman", serif',
  sans:    'var(--font-body, system-ui, sans-serif)',
  mono:    'var(--font-mono, monospace)',
}

// ── Resize handles (8 points around a block element) ─────────────────────────

const HANDLES = [
  { id:'nw', css:{ top:0,    left:0,    transform:'translate(-50%,-50%)' }, cursor:'nw-resize' },
  { id:'n',  css:{ top:0,    left:'50%',transform:'translate(-50%,-50%)' }, cursor:'ns-resize' },
  { id:'ne', css:{ top:0,    right:0,   transform:'translate(50%,-50%)'  }, cursor:'ne-resize' },
  { id:'e',  css:{ top:'50%',right:0,   transform:'translate(50%,-50%)'  }, cursor:'ew-resize' },
  { id:'se', css:{ bottom:0, right:0,   transform:'translate(50%,50%)'   }, cursor:'se-resize' },
  { id:'s',  css:{ bottom:0, left:'50%',transform:'translate(-50%,50%)'  }, cursor:'ns-resize' },
  { id:'sw', css:{ bottom:0, left:0,    transform:'translate(-50%,50%)'  }, cursor:'sw-resize' },
  { id:'w',  css:{ top:'50%',left:0,    transform:'translate(-50%,-50%)' }, cursor:'ew-resize' },
]

function resizeSetup(el, handle, cW, cH) {
  const cx = el.x / 100 * cW
  const cy = el.y / 100 * cH
  const hw = (el.w || 40) / 100 * cW / 2
  const hh = (el.h || 30) / 100 * cH / 2
  const FIXED = {
    nw:{x:cx+hw,y:cy+hh,axis:'corner'}, ne:{x:cx-hw,y:cy+hh,axis:'corner'},
    sw:{x:cx+hw,y:cy-hh,axis:'corner'}, se:{x:cx-hw,y:cy-hh,axis:'corner'},
    n:{x:cx,y:cy+hh,axis:'y'}, s:{x:cx,y:cy-hh,axis:'y'},
    e:{x:cx-hw,y:cy,axis:'x'}, w:{x:cx+hw,y:cy,axis:'x'},
  }
  const INIT = {
    nw:{x:cx-hw,y:cy-hh}, ne:{x:cx+hw,y:cy-hh},
    sw:{x:cx-hw,y:cy+hh}, se:{x:cx+hw,y:cy+hh},
    n:{x:cx,y:cy-hh}, s:{x:cx,y:cy+hh},
    e:{x:cx+hw,y:cy}, w:{x:cx-hw,y:cy},
  }
  return { fixed:FIXED[handle], init:INIT[handle], hw, hh }
}

function computeResize(d, me) {
  const dx = me.clientX - d.sx, dy = me.clientY - d.sy
  const dragX = d.init.x + dx, dragY = d.init.y + dy
  let newCx, newCy, newW, newH
  if (d.fixed.axis === 'corner') {
    const [mnX,mxX] = [Math.min(d.fixed.x,dragX), Math.max(d.fixed.x,dragX)]
    const [mnY,mxY] = [Math.min(d.fixed.y,dragY), Math.max(d.fixed.y,dragY)]
    newW = Math.max(5, mxX-mnX) / d.cW * 100
    newH = Math.max(5, mxY-mnY) / d.cH * 100
    newCx = (mnX+mxX)/2 / d.cW * 100
    newCy = (mnY+mxY)/2 / d.cH * 100
  } else if (d.fixed.axis === 'y') {
    const [mnY,mxY] = [Math.min(d.fixed.y,dragY), Math.max(d.fixed.y,dragY)]
    newH = Math.max(5, mxY-mnY) / d.cH * 100
    newCy = (mnY+mxY)/2 / d.cH * 100
    newW = d.hw*2 / d.cW * 100
    newCx = d.fixed.x / d.cW * 100
  } else {
    const [mnX,mxX] = [Math.min(d.fixed.x,dragX), Math.max(d.fixed.x,dragX)]
    newW = Math.max(5, mxX-mnX) / d.cW * 100
    newCx = (mnX+mxX)/2 / d.cW * 100
    newH = d.hh*2 / d.cH * 100
    newCy = d.fixed.y / d.cH * 100
  }
  return {
    x: clamp(newCx, newW/2+1, 100-newW/2-1),
    y: clamp(newCy, newH/2+1, 100-newH/2-1),
    w: newW, h: newH,
  }
}

// ── DividerCanvas ─────────────────────────────────────────────────────────────

export function DividerCanvas({
  style,
  albumInfo,
  canvasW,
  canvasH,
  selectedId,
  onSelect,
  onDrag,
  onResize,
  readOnly = false,
  dividerMapUrl,
}) {
  const ds  = style || DEFAULT_DIVIDER_STYLE
  const ai  = albumInfo || {}
  const ref = useRef(null)
  const dragRef = useRef(null)

  const previewText = (el) => {
    if (el.type === 'text_custom') return el.text || 'Testo personalizzato'
    if (el.custom_text != null && el.custom_text !== '') return el.custom_text
    if (el.type === 'title')       return ai.albumName   || 'Nome album'
    if (el.type === 'subtitle')    return ai.description || 'Descrizione album'
    if (el.type === 'date_range')  return ai.dateRange   || 'Dal 1 gen — al 31 dic 2024'
    if (el.type === 'photo_count') return ai.assetCount != null ? `${ai.assetCount} fotografie` : '42 fotografie'
    return ''
  }

  const beginDrag = (e, id, resizeHandle = null) => {
    if (readOnly || !ref.current) return
    e.preventDefault(); e.stopPropagation()
    const rect = ref.current.getBoundingClientRect()
    onSelect?.(id)

    if (resizeHandle) {
      const el = (ds.elements||[]).find(x => x.id === id)
      if (!el) return
      const { fixed, init, hw, hh } = resizeSetup(el, resizeHandle, rect.width, rect.height)
      dragRef.current = { type:'resize', id, sx:e.clientX, sy:e.clientY, fixed, init, hw, hh, cW:rect.width, cH:rect.height }
      const onMove = (me) => {
        const d = dragRef.current; if (!d || d.type !== 'resize') return
        onResize?.(d.id, computeResize(d, me))
      }
      const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      return
    }

    const target = [...(ds.elements||[]), ...(ds.lines||[])].find(x => x.id === id)
    if (!target) return
    dragRef.current = { type:'drag', id, sx:e.clientX, sy:e.clientY, ox:target.x, oy:target.y, cW:rect.width, cH:rect.height }
    const onMove = (me) => {
      const d = dragRef.current; if (!d || d.type !== 'drag') return
      const nx = clamp(d.ox + (me.clientX-d.sx)/d.cW*100, 2, 98)
      const ny = clamp(d.oy + (me.clientY-d.sy)/d.cH*100, 2, 98)
      onDrag?.(d.id, nx, ny)
    }
    const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const selRing = (id) => id === selectedId ? { outline:'2px solid #4ac585', outlineOffset:2 } : {}

  // Build unified render list sorted by layer_order (index 0 = backmost)
  const allItemsFlat = [...(ds.elements||[]), ...(ds.lines||[])]
  const order = ds.layer_order || allItemsFlat.map(x => x.id)
  const sortedItems = [
    ...order.map(id => allItemsFlat.find(x => x.id === id)).filter(Boolean),
    ...allItemsFlat.filter(x => !order.includes(x.id)),
  ]

  return (
    <div ref={ref}
      style={{ width:canvasW, height:canvasH, background:ds.bg||'#13141a',
               position:'relative', overflow:'hidden', borderRadius:2,
               userSelect:'none', WebkitUserSelect:'none', flexShrink:0 }}
      onClick={() => onSelect?.(null)}
    >
      {sortedItems.map((item, zPos) => {
        const zIdx = 3 + zPos

        // Line item — has `orientation` field
        if ('orientation' in item) {
          const l = item
          const isH = l.orientation !== 'v'
          return (
            <div key={l.id}
              style={{ position:'absolute',
                left:`${l.x}%`, top:`${l.y}%`,
                transform:'translate(-50%,-50%)',
                padding: isH ? '6px 0' : '0 6px',
                width:  isH ? `${l.length}%` : undefined,
                height: !isH ? `${l.length}%` : undefined,
                boxSizing:'border-box',
                cursor: readOnly ? 'default' : 'move',
                zIndex: zIdx,
                ...selRing(l.id),
              }}
              onMouseDown={e => beginDrag(e, l.id)}
              onClick={e => { e.stopPropagation(); onSelect?.(l.id) }}
            >
              <div style={{
                width:  isH ? '100%' : `${l.thickness||1}px`,
                height: isH ? `${l.thickness||1}px` : '100%',
                background: l.color||'#d4aa5a',
                opacity: (l.opacity??50) / 100,
              }}/>
            </div>
          )
        }

        // Element item
        const el = item
        if (el.enabled === false) return null
        const meta  = EL_META[el.type] || {}
        const isBlk = meta.block
        const isSel = el.id === selectedId

        if (!isBlk) {
          const TX = { left:'translate(0,-50%)', center:'translate(-50%,-50%)', right:'translate(-100%,-50%)' }
          const tx = TX[el.align||'center'] || 'translate(-50%,-50%)'
          return (
            <div key={el.id}
              style={{ position:'absolute',
                left:`${el.x}%`, top:`${el.y}%`,
                transform: tx,
                fontFamily: FONT_FAMILY[el.font||'sans'],
                fontSize: (el.font_size||3) / 100 * canvasH,
                fontWeight: el.type === 'title' ? 700 : 400,
                color: el.color||'#fff',
                opacity: (el.opacity??100) / 100,
                textAlign: el.align||'center',
                whiteSpace:'nowrap', maxWidth:'90%',
                overflow:'hidden', textOverflow:'ellipsis',
                cursor: readOnly ? 'default' : 'move',
                pointerEvents:'auto', zIndex: zIdx,
                ...selRing(el.id),
              }}
              onMouseDown={e => beginDrag(e, el.id)}
              onClick={e => { e.stopPropagation(); onSelect?.(el.id) }}
            >
              {previewText(el)}
            </div>
          )
        }

        // Block element (map / photo)
        const opct    = (el.opacity ?? 90) / 100
        const bgColor = el.type === 'map'
          ? `rgba(26,48,64,${opct})` : `rgba(42,30,53,${opct})`
        const photoId = el.photo_id || ai.best_photo_id
        const hasPhoto = el.type === 'photo' && !!photoId
        const hasMap   = el.type === 'map'   && !!dividerMapUrl

        return (
          <div key={el.id}
            style={{ position:'absolute',
              left:`${el.x}%`, top:`${el.y}%`,
              transform:'translate(-50%,-50%)',
              width:`${el.w||40}%`, height:`${el.h||30}%`,
              background: (hasPhoto || hasMap) ? 'transparent' : bgColor,
              border: isSel ? '1px solid #4ac585' : `1px dashed rgba(255,255,255,${0.25 * opct + 0.05})`,
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor: readOnly ? 'default' : 'move',
              pointerEvents:'auto', zIndex: zIdx,
              boxSizing:'border-box', overflow:'hidden',
            }}
            onMouseDown={e => beginDrag(e, el.id)}
            onClick={e => { e.stopPropagation(); onSelect?.(el.id) }}
          >
            {hasPhoto ? (
              <img src={`/api/thumb/${photoId}`} alt="" draggable={false}
                style={{ width:'100%', height:'100%', objectFit:'cover', opacity:opct, display:'block', pointerEvents:'none' }}/>
            ) : hasMap ? (
              <img src={dividerMapUrl} alt="" draggable={false}
                style={{ width:'100%', height:'100%', objectFit:'cover', opacity:opct, display:'block', pointerEvents:'none' }}/>
            ) : (
              <span style={{ fontSize: Math.max(9, canvasH * 0.04), opacity:0.5 }}>
                {meta.icon}
              </span>
            )}

            {isSel && !readOnly && HANDLES.map(h => (
              <div key={h.id}
                style={{
                  position:'absolute',
                  width:9, height:9,
                  background:'#4ac585',
                  border:'1.5px solid #fff',
                  borderRadius:2,
                  cursor: h.cursor,
                  zIndex: 20,
                  ...h.css,
                }}
                onMouseDown={e => { e.stopPropagation(); beginDrag(e, el.id, h.id) }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Property sub-panels ───────────────────────────────────────────────────────

const Row = ({ label, children, style: s }) => (
  <div className="form-group" style={{ marginBottom:5, ...s }}>
    <label className="form-label" style={{ fontSize:11, marginBottom:2 }}>{label}</label>
    {children}
  </div>
)

const Sld = ({ min, max, step=1, value, onChange }) => (
  <input type="range" min={min} max={max} step={step} value={value}
    onChange={e => onChange(+e.target.value)} style={{ width:'100%' }}/>
)

function ColorRow({ label, value, onChange }) {
  return (
    <Row label={label}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <input type="color" value={value||'#ffffff'}
          onChange={e => onChange(e.target.value)}
          style={{ width:32, height:32, border:'none', cursor:'pointer', borderRadius:4 }}/>
        <span className="text-xs text-muted">{value||'#ffffff'}</span>
      </div>
    </Row>
  )
}

function TextElProps({ el, onChange }) {
  const up = p => onChange({ ...el, ...p })
  return (
    <>
      {(el.type === 'title' || el.type === 'subtitle') && (
        <Row label="Testo personalizzato">
          <input className="form-input" style={{fontSize:11}}
            value={el.custom_text ?? ''}
            onChange={e => up({ custom_text: e.target.value || undefined })}
            placeholder={el.type === 'title' ? 'lascia vuoto = nome album' : 'lascia vuoto = descrizione album'}/>
        </Row>
      )}
      {el.type === 'text_custom' && (
        <Row label="Testo">
          <input className="form-input" style={{fontSize:11}}
            value={el.text || ''}
            onChange={e => up({ text: e.target.value })}
            placeholder="Testo personalizzato"/>
        </Row>
      )}
      <ColorRow label="Colore testo" value={el.color} onChange={c => up({ color:c })}/>
      <Row label="Font">
        <select className="form-input" style={{ fontSize:11 }}
          value={el.font||'sans'} onChange={e => up({ font:e.target.value })}>
          <option value="display">Display (serif)</option>
          <option value="serif">Serif</option>
          <option value="sans">Sans-serif</option>
          <option value="mono">Monospace</option>
        </select>
      </Row>
      <Row label={`Dimensione ${(el.font_size||3).toFixed(1)}% h.`}>
        <Sld min={0.5} max={15} step={0.1} value={el.font_size||3} onChange={v => up({ font_size:v })}/>
      </Row>
      <Row label="Allineamento">
        <div style={{ display:'flex', gap:3 }}>
          {[['left','←',8],['center','⟺',50],['right','→',92]].map(([a,lbl,xDef]) => (
            <button key={a} onClick={() => up({ align:a, x:xDef })} style={{
              flex:1, padding:'3px 0', fontSize:13,
              background: (el.align||'center')===a ? 'var(--gold)' : 'var(--bg3)',
              color:       (el.align||'center')===a ? '#000' : 'var(--text3)',
              border:'1px solid var(--border)', borderRadius:5, cursor:'pointer',
            }}>{lbl}</button>
          ))}
        </div>
      </Row>
      <Row label={`Opacità ${el.opacity??100}%`}>
        <Sld min={0} max={100} value={el.opacity??100} onChange={v => up({ opacity:v })}/>
      </Row>
      <div style={{ display:'flex', gap:6 }}>
        <Row label={`X ${Math.round(el.x)}%`} style={{ flex:1, marginBottom:0 }}>
          <Sld min={2} max={98} value={el.x} onChange={v => up({ x:v })}/>
        </Row>
        <Row label={`Y ${Math.round(el.y)}%`} style={{ flex:1, marginBottom:0 }}>
          <Sld min={2} max={98} value={el.y} onChange={v => up({ y:v })}/>
        </Row>
      </div>
    </>
  )
}

function BlockElProps({ el, onChange, assets }) {
  const up = p => onChange({ ...el, ...p })
  return (
    <>
      {el.type === 'photo' && assets?.length > 0 && (
        <Row label="Scegli foto">
          <div style={{ display:'flex', flexWrap:'wrap', gap:3, maxHeight:110, overflowY:'auto', padding:2 }}>
            {assets.map(a => (
              <div key={a.id}
                onClick={() => up({ photo_id: a.id })}
                title={a.originalFileName || a.id}
                style={{
                  width:36, height:36, cursor:'pointer', borderRadius:4,
                  overflow:'hidden', flexShrink:0, boxSizing:'border-box',
                  border: el.photo_id === a.id ? '2px solid #4ac585' : '2px solid transparent',
                }}>
                <img src={`/api/thumb/${a.id}`} alt="" draggable={false}
                  style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
              </div>
            ))}
          </div>
        </Row>
      )}
      <p className="text-xs text-muted" style={{ margin:'0 0 6px' }}>
        Trascina i bordi sull'anteprima per ridimensionare
      </p>
      <div style={{ display:'flex', gap:6 }}>
        <Row label={`L ${Math.round(el.w||40)}%`} style={{ flex:1 }}>
          <Sld min={5} max={100} value={el.w||40} onChange={v => up({ w:v })}/>
        </Row>
        <Row label={`H ${Math.round(el.h||30)}%`} style={{ flex:1 }}>
          <Sld min={5} max={100} value={el.h||30} onChange={v => up({ h:v })}/>
        </Row>
      </div>
      <Row label={`Opacità ${el.opacity??90}%`}>
        <Sld min={0} max={100} value={el.opacity??90} onChange={v => up({ opacity:v })}/>
      </Row>
      <div style={{ display:'flex', gap:6 }}>
        <Row label={`X ${Math.round(el.x)}%`} style={{ flex:1, marginBottom:0 }}>
          <Sld min={2} max={98} value={el.x} onChange={v => up({ x:v })}/>
        </Row>
        <Row label={`Y ${Math.round(el.y)}%`} style={{ flex:1, marginBottom:0 }}>
          <Sld min={2} max={98} value={el.y} onChange={v => up({ y:v })}/>
        </Row>
      </div>
    </>
  )
}

function LineProps({ line, onChange, onDelete }) {
  const up = p => onChange({ ...line, ...p })
  return (
    <>
      <Row label="Orientamento">
        <div style={{ display:'flex', gap:3 }}>
          {[['h','— Orizz.'],['v','| Vert.']].map(([v,lbl]) => (
            <button key={v} onClick={() => up({ orientation:v })} style={{
              flex:1, padding:'3px 0', fontSize:11,
              background: (line.orientation||'h')===v ? 'var(--gold)' : 'var(--bg3)',
              color:       (line.orientation||'h')===v ? '#000' : 'var(--text3)',
              border:'1px solid var(--border)', borderRadius:5, cursor:'pointer',
            }}>{lbl}</button>
          ))}
        </div>
      </Row>
      <div style={{ display:'flex', gap:6 }}>
        <Row label={`Lung. ${line.length||55}%`} style={{ flex:1 }}>
          <Sld min={5} max={100} value={line.length||55} onChange={v => up({ length:v })}/>
        </Row>
        <Row label={`Sp. ${line.thickness||1}px`} style={{ flex:1 }}>
          <Sld min={1} max={60} value={line.thickness||1} onChange={v => up({ thickness:v })}/>
        </Row>
      </div>
      <ColorRow label="Colore" value={line.color||'#d4aa5a'} onChange={c => up({ color:c })}/>
      <Row label={`Opacità ${line.opacity??50}%`}>
        <Sld min={0} max={100} value={line.opacity??50} onChange={v => up({ opacity:v })}/>
      </Row>
      <div style={{ display:'flex', gap:6 }}>
        <Row label={`X ${Math.round(line.x)}%`} style={{ flex:1, marginBottom:0 }}>
          <Sld min={2} max={98} value={line.x} onChange={v => up({ x:v })}/>
        </Row>
        <Row label={`Y ${Math.round(line.y)}%`} style={{ flex:1, marginBottom:0 }}>
          <Sld min={2} max={98} value={line.y} onChange={v => up({ y:v })}/>
        </Row>
      </div>
      <button onClick={onDelete} style={{ width:'100%', padding:'5px 0', fontSize:11,
        color:'#e05050', background:'none', border:'1px solid #e05050',
        borderRadius:5, cursor:'pointer', marginTop:6 }}>
        ✕ Rimuovi linea
      </button>
    </>
  )
}

// ── PresetPanel ───────────────────────────────────────────────────────────────

const PRESETS_KEY = 'divider_presets_v1'
function PresetPanel({ ds, onLoad }) {
  const load = () => { try { return JSON.parse(localStorage.getItem(PRESETS_KEY)||'[]') } catch { return [] } }
  const [presets, setPresets] = useState(load)
  const [name, setName]       = useState('')
  const save = () => {
    if (!name.trim()) return
    const np = [{ name:name.trim(), style:ds, ts:Date.now() }, ...presets.filter(p=>p.name!==name.trim())].slice(0,20)
    setPresets(np); localStorage.setItem(PRESETS_KEY, JSON.stringify(np)); setName('')
  }
  const del = (n) => {
    const np = presets.filter(p=>p.name!==n)
    setPresets(np); localStorage.setItem(PRESETS_KEY, JSON.stringify(np))
  }
  return (
    <div style={{ marginTop:8, borderTop:'1px solid var(--border)', paddingTop:8 }}>
      <p style={{ fontSize:10, color:'var(--text3)', margin:'0 0 5px' }}>Preset</p>
      <div style={{ display:'flex', gap:3, marginBottom:5 }}>
        <input className="form-input" style={{ fontSize:10, flex:1, padding:'2px 5px' }}
          value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&save()} placeholder="Nome preset"/>
        <button onClick={save} style={{ fontSize:9, padding:'2px 6px', background:'var(--bg3)',
          border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>
          Salva
        </button>
      </div>
      <div style={{ maxHeight:120, overflowY:'auto' }}>
        {presets.length === 0 && <p style={{ fontSize:9, color:'var(--text3)', textAlign:'center', margin:'6px 0' }}>Nessun preset</p>}
        {presets.map(p => (
          <div key={p.name} style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 0' }}>
            <button onClick={()=>onLoad(p.style)} style={{ flex:1, textAlign:'left', fontSize:10,
              padding:'3px 5px', background:'var(--bg3)', border:'1px solid var(--border)',
              borderRadius:4, cursor:'pointer', color:'var(--text)',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
              title={`Carica: ${p.name}`}>
              {p.name}
            </button>
            <button onClick={()=>del(p.name)} style={{ fontSize:9, padding:'2px 5px',
              background:'none', border:'1px solid #e05050', borderRadius:4,
              cursor:'pointer', color:'#e05050', flexShrink:0 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page size catalogue ───────────────────────────────────────────────────────

const PAGE_SIZES = [
  { id:'A4', w:210, h:297 }, { id:'A3', w:297, h:420 }, { id:'A5', w:148, h:210 },
  { id:'20x20', w:200, h:200 }, { id:'20x30', w:200, h:300 },
  { id:'30x30', w:300, h:300 }, { id:'30x40', w:300, h:400 },
  { id:'Letter', w:216, h:279 },
]

// ── DividerEditor ─────────────────────────────────────────────────────────────

export default function DividerEditor({ value, onChange, profile, albumInfo, canvasWidth = 300, assets, dividerMapUrl }) {
  const ds = migrateDividerStyle(value)
  const [selectedId, setSelectedId] = useState(null)
  const [dragId, setDragId]           = useState(null)
  const [dropTargetId, setDropTargetId] = useState(null)

  const sz = PAGE_SIZES.find(s => s.id === (profile?.page_size||'A4')) || { w:210, h:297 }
  let [pw, ph] = [sz.w, sz.h]
  if (profile?.orientation === 'landscape') [pw, ph] = [ph, pw]
  const canvasW = canvasWidth
  const canvasH = Math.round(ph / pw * canvasW)

  const commit = (patch) => onChange({ ...ds, ...patch })

  const updateEl   = (id, fn) => commit({ elements: ds.elements.map(e => e.id===id ? fn(e) : e) })
  const updateLine = (id, fn) => commit({ lines: (ds.lines||[]).map(l => l.id===id ? fn(l) : l) })
  const toggleEl   = (id)     => updateEl(id, e => ({ ...e, enabled: e.enabled === false }))

  const getOrder = () => ds.layer_order || [
    ...(ds.elements||[]).map(e => e.id),
    ...(ds.lines||[]).map(l => l.id),
  ]

  const addLine = () => {
    const nl = { id:uid(), orientation:'h', x:50, y:50, length:55, thickness:1, color:'#d4aa5a', opacity:50 }
    commit({ lines:[...(ds.lines||[]), nl], layer_order:[...getOrder(), nl.id] })
    setSelectedId(nl.id)
  }

  const addCustomText = () => {
    const ne = { id:uid(), type:'text_custom', enabled:true, x:50, y:80, font:'sans', font_size:2.2, color:'#ffffff', align:'center', opacity:100, text:'Testo personalizzato' }
    commit({ elements:[...(ds.elements||[]), ne], layer_order:[...getOrder(), ne.id] })
    setSelectedId(ne.id)
  }

  const deleteLine = (id) => {
    commit({
      lines: (ds.lines||[]).filter(l => l.id !== id),
      layer_order: getOrder().filter(x => x !== id),
    })
    if (selectedId === id) setSelectedId(null)
  }

  // Reorder: drag fromId onto toId in the display list (front at top = reversed layer_order).
  // "Insert at position" semantics: item takes the drop target's display position.
  const reorderItems = (fromId, toId) => {
    const order = getOrder()
    const displayOrder = [...order].reverse()  // front first
    const fromDispIdx = displayOrder.indexOf(fromId)
    const toDispIdx   = displayOrder.indexOf(toId)
    if (fromDispIdx < 0 || toDispIdx < 0 || fromDispIdx === toDispIdx) return
    displayOrder.splice(fromDispIdx, 1)
    const adjustedToIdx = displayOrder.indexOf(toId)
    // dragging forward (from front towards back): insert after target
    // dragging backward (from back towards front): insert before target
    if (fromDispIdx < toDispIdx) {
      displayOrder.splice(adjustedToIdx + 1, 0, fromId)
    } else {
      displayOrder.splice(adjustedToIdx, 0, fromId)
    }
    commit({ layer_order: [...displayOrder].reverse() })
  }

  const handleDrag = (id, nx, ny) => {
    if (ds.elements?.some(e => e.id===id)) updateEl(id,   e => ({...e, x:nx, y:ny}))
    else                                    updateLine(id, l => ({...l, x:nx, y:ny}))
  }

  const handleResize = (id, { x, y, w, h }) => {
    updateEl(id, e => ({ ...e, x, y, w, h }))
  }

  const selEl   = ds.elements?.find(e => e.id===selectedId)
  const selLine = (ds.lines||[]).find(l => l.id===selectedId)
  const selMeta = selEl ? (EL_META[selEl.type]||{}) : null

  // Build display list: front at top (reversed layer_order)
  const allItemsFlat = [...(ds.elements||[]), ...(ds.lines||[])]
  const layerOrder   = ds.layer_order || allItemsFlat.map(x => x.id)
  const orderedFlat  = layerOrder.map(id => allItemsFlat.find(x => x.id===id)).filter(Boolean)
  const displayItems = [...orderedFlat].reverse()

  return (
    <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>

      {/* ── Col 1: Canvas ── */}
      <div style={{ flexShrink:0, display:'flex', flexDirection:'column', gap:4 }}>
        <p className="text-xs text-muted" style={{ margin:0, fontSize:10 }}>
          Trascina → sposta &nbsp;·&nbsp; Bordi verdi → ridimensiona
        </p>
        <DividerCanvas
          style={ds} albumInfo={albumInfo}
          canvasW={canvasW} canvasH={canvasH}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDrag={handleDrag}
          onResize={handleResize}
          dividerMapUrl={dividerMapUrl}
        />
        <p className="text-xs text-muted" style={{ margin:0, textAlign:'center', maxWidth:canvasW, fontSize:10 }}>
          Clicca per selezionare
        </p>
      </div>

      {/* ── Col 2: Unified layers list ── */}
      <div style={{
        width:182, flexShrink:0,
        maxHeight: canvasH + 28, overflowY:'auto',
        display:'flex', flexDirection:'column', gap:8,
      }}>

        {/* Background */}
        <div className="form-group" style={{ marginBottom:0 }}>
          <label className="form-label" style={{ fontSize:11 }}>Sfondo</label>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input type="color" value={ds.bg||'#13141a'}
              onChange={e => commit({ bg:e.target.value })}
              style={{ width:28, height:28, border:'none', cursor:'pointer', borderRadius:4 }}/>
            <span className="text-xs text-muted" style={{ fontSize:10 }}>{ds.bg||'#13141a'}</span>
          </div>
        </div>

        {/* Unified layers — drag to reorder, front at top */}
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:5 }}>
            <p className="form-label" style={{ fontSize:11, margin:0, flex:1 }}>Livelli</p>
            <button onClick={addLine} style={{ fontSize:10, padding:'2px 7px',
              background:'var(--bg3)', border:'1px solid var(--border)',
              borderRadius:4, cursor:'pointer', color:'var(--text)' }}>
              + Linea
            </button>
            <button onClick={addCustomText} style={{ fontSize:10, padding:'2px 7px',
              background:'var(--bg3)', border:'1px solid var(--border)',
              borderRadius:4, cursor:'pointer', color:'var(--text)' }}>
              + Testo
            </button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {displayItems.map(item => {
              const isLine = 'orientation' in item
              const m      = isLine ? null : (EL_META[item.type] || {})
              const label  = isLine
                ? `Linea (${item.orientation==='v' ? 'vert.' : 'orizz.'})`
                : (m?.label || item.type)
              const icon   = isLine
                ? (item.orientation==='v' ? '|' : '—')
                : (m?.icon || '?')
              const enabled     = isLine ? true : item.enabled !== false
              const sel         = selectedId === item.id
              const isDragging  = dragId === item.id
              const isDropTgt   = dropTargetId === item.id && dragId !== item.id

              return (
                <div key={item.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(item.id) }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetId(item.id) }}
                  onDrop={e => { e.preventDefault(); if (dragId && dragId !== item.id) reorderItems(dragId, item.id); setDragId(null); setDropTargetId(null) }}
                  onDragEnd={() => { setDragId(null); setDropTargetId(null) }}
                  onClick={() => setSelectedId(sel ? null : item.id)}
                  style={{
                    display:'flex', alignItems:'center', gap:5,
                    padding:'5px 5px', borderRadius:5, cursor:'grab',
                    opacity: isDragging ? 0.35 : 1,
                    background: isDropTgt ? 'rgba(74,197,133,0.12)' : sel ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: isDropTgt ? '1px solid #4ac585' : sel ? '1px solid var(--gold)' : '1px solid transparent',
                    userSelect:'none',
                  }}
                >
                  <span style={{ fontSize:10, color:'var(--text3)', flexShrink:0 }}>⠿</span>
                  {!isLine ? (
                    <input type="checkbox"
                      checked={enabled}
                      onChange={() => toggleEl(item.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ cursor:'pointer', flexShrink:0, width:12, height:12 }}/>
                  ) : (
                    <span style={{ width:12, flexShrink:0 }}/>
                  )}
                  <span style={{
                    fontSize: isLine ? 14 : 15, flexShrink:0, lineHeight:1,
                    fontFamily: isLine ? 'monospace' : 'inherit',
                    color: isLine ? 'var(--text3)' : 'inherit',
                  }}>{icon}</span>
                  <span style={{ fontSize:13, flex:1, lineHeight:1.3,
                    color: enabled ? 'var(--text)' : 'var(--text3)',
                    textDecoration: enabled ? 'none' : 'line-through',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}>{label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display:'flex', gap:4, marginTop:8 }}>
          <button onClick={() => {
            const blob = new Blob([JSON.stringify(ds, null, 2)], {type:'application/json'})
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href=url; a.download='divider_style.json'; a.click()
            URL.revokeObjectURL(url)
          }} style={{ flex:1, fontSize:9, padding:'3px 0', background:'var(--bg3)',
            border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text3)' }}>
            ⬇ Esporta JSON
          </button>
          <label style={{ flex:1, fontSize:9, padding:'3px 0', background:'var(--bg3)',
            border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text3)',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            ⬆ Importa JSON
            <input type="file" accept=".json" hidden onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              const reader = new FileReader()
              reader.onload = ev => {
                try { onChange(migrateDividerStyle(JSON.parse(ev.target.result))) } catch {}
              }
              reader.readAsText(f)
              e.target.value = ''
            }}/>
          </label>
        </div>

        <PresetPanel ds={ds} onLoad={style => { onChange(migrateDividerStyle(style)); setSelectedId(null) }} />
      </div>

      {/* ── Col 3: Properties panel ── */}
      <div style={{
        flex:'1 1 0', minWidth:150,
        maxHeight: canvasH + 28, overflowY:'auto',
      }}>
        {(selEl || selLine) ? (
          <div style={{ padding:8, background:'var(--bg3)', borderRadius:7,
            border:'1px solid var(--border)' }}>
            <p style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--font-mono)', margin:'0 0 7px' }}>
              {selEl ? selMeta?.label : `Linea (${selLine?.orientation==='v' ? 'verticale' : 'orizzontale'})`}
            </p>
            {selEl && !selMeta?.block && (
              <TextElProps el={selEl} onChange={e => updateEl(selEl.id, ()=>e)}/>
            )}
            {selEl && selMeta?.block && (
              <BlockElProps el={selEl} onChange={e => updateEl(selEl.id, ()=>e)} assets={assets}/>
            )}
            {selLine && (
              <LineProps line={selLine}
                onChange={l => updateLine(selLine.id, ()=>l)}
                onDelete={() => deleteLine(selLine.id)}/>
            )}
          </div>
        ) : (
          <div style={{ padding:'12px 8px' }}>
            <p className="text-xs text-muted" style={{ fontSize:10, margin:0 }}>
              ← Seleziona un elemento per modificarne le proprietà
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── DividerEditorModal ────────────────────────────────────────────────────────

export function DividerEditorModal({ value, onChange, onClose, profile, albumInfo, dividerMapUrl, assets }) {
  const [local, setLocal] = useState(() => migrateDividerStyle(value))
  const [size, setSize]   = useState({ w: null, h: null })
  const modalRef          = useRef(null)
  const resizeDragRef     = useRef(null)

  const beginResize = (e, edge) => {
    e.preventDefault(); e.stopPropagation()
    if (!modalRef.current) return
    const rect = modalRef.current.getBoundingClientRect()
    resizeDragRef.current = { edge, sx:e.clientX, sy:e.clientY, iw:rect.width, ih:rect.height }
    const onMove = (me) => {
      const d = resizeDragRef.current; if (!d) return
      const dx = me.clientX - d.sx, dy = me.clientY - d.sy
      setSize(s => ({
        w: (edge==='e' || edge==='se') ? Math.max(480, d.iw+dx) : s.w,
        h: (edge==='s' || edge==='se') ? Math.max(360, d.ih+dy) : s.h,
      }))
    }
    const onUp = () => {
      resizeDragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const canvasWidth = size.w ? Math.max(320, Math.round(size.w - 340)) : 400

  return createPortal(
    <>
      <div
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:9100 }}
        onClick={onClose}
        onWheel={e => e.stopPropagation()}
      />
      <div
        ref={modalRef}
        style={{
          position:'fixed', top:'4%', left:'50%', transform:'translateX(-50%)',
          width: size.w ? size.w : 'min(920px, 96vw)',
          height: size.h ? size.h : undefined,
          maxHeight: size.h ? undefined : '92vh',
          background:'var(--bg2)', border:'1px solid var(--border)',
          borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
          zIndex:9101, display:'flex', flexDirection:'column', overflow:'hidden',
        }}
        onWheel={e => e.stopPropagation()}
      >
        <div style={{ padding:'13px 18px', borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <h3 style={{ fontFamily:'var(--font-display)', fontWeight:300, fontSize:17, margin:0 }}>
            Stile pagina divisore
          </h3>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-sm btn-primary"
              onClick={() => { onChange(local); onClose() }}>
              Applica
            </button>
            <button onClick={onClose} style={{ background:'none', border:'none',
              fontSize:18, color:'var(--text3)', cursor:'pointer' }}>✕</button>
          </div>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:20 }}>
          <DividerEditor
            value={local} onChange={setLocal}
            profile={profile} albumInfo={albumInfo}
            canvasWidth={canvasWidth}
            dividerMapUrl={dividerMapUrl}
            assets={assets}
          />
        </div>

        {/* Resize handles */}
        <div onMouseDown={e => beginResize(e, 'e')}
          style={{ position:'absolute', right:0, top:'15%', width:5, height:'70%',
            cursor:'ew-resize', zIndex:10 }}/>
        <div onMouseDown={e => beginResize(e, 's')}
          style={{ position:'absolute', bottom:0, left:'15%', height:5, width:'70%',
            cursor:'ns-resize', zIndex:10 }}/>
        <div onMouseDown={e => beginResize(e, 'se')}
          style={{ position:'absolute', right:0, bottom:0, width:18, height:18,
            cursor:'se-resize', zIndex:11,
            background:'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%)',
            borderRadius:'0 0 12px 0' }}/>
      </div>
    </>,
    document.body,
  )
}
