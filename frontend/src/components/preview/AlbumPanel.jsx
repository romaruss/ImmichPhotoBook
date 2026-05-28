import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n.jsx'

export default function AlbumPanel({ assets, presorted, usageMap, usagePages, open, onToggle, onDragStart, onNavigate, highlightedAsset, onClearHighlight, excludedPhotos = [], permanentlyRemoved = [] }) {
  const t = useT()
  const tp = t.preview
  const [filter, setFilter]         = useState('')
  const [view, setView]             = useState(()=>{try{const v=localStorage.getItem('pb_view');return v!==null?JSON.parse(v):2}catch{return 2}})
  const [statusFilter, setStatusFilter] = useState('all')
  const [previewAsset, setPreviewAsset] = useState(null)  // foto ingrandita
  const highlightRef = useRef(null)  // ref to highlighted photo item

  // Scroll highlighted asset into view when it changes
  useEffect(() => {
    if (highlightedAsset && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior:'smooth', block:'nearest' })
    }
  }, [highlightedAsset])

  const sortedAssets = presorted
    ? assets.filter(a => (a.type||'IMAGE').toUpperCase() !== 'VIDEO')
    : [...assets].filter(a => (a.type||'IMAGE').toUpperCase() !== 'VIDEO')
        .sort((a,b)=>(a.localDateTime||'').localeCompare(b.localDateTime||''))

  const excludedMap = Object.fromEntries((excludedPhotos||[]).map(e => [e.asset_id, e]))
  const permRemovedSet = new Set(permanentlyRemoved)
  const filtered = sortedAssets.filter(a => {
    const uses = usageMap[a.id] || 0
    if (statusFilter === 'unused' && uses > 0)  return false
    if (statusFilter === 'multi'  && uses < 2)  return false
    if (filter && !(a.originalFileName || '').toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const used   = Object.values(usageMap).filter(v => v > 0).length
  const multi  = Object.values(usageMap).filter(v => v > 1).length
  const unused = sortedAssets.length - used  // sortedAssets already excludes videos

  const borderColor = (id) => {
    const u = usageMap[id] || 0
    if (u === 0)  return '#e05050'
    if (u > 1)    return '#e89a3a'
    return '#4ac585'
  }

  const altText = (asset) => {
    const u = usageMap[asset.id] || 0
    const pages = usagePages[asset.id] || []
    const name  = asset.originalFileName || asset.id
    return tp.panelAlt(name, u, pages)
  }

  // Tracks which occurrence index was last shown per asset (for cycling)
  const occurrenceCursor = useRef({})

  // Click su foto: se non usata → preview ingrandita; se usata → cicla tra le occorrenze
  const handlePhotoClick = (asset) => {
    const pages_list = usagePages[asset.id] || []
    if (pages_list.length === 0) {
      setPreviewAsset(asset)
      return
    }
    const cur = occurrenceCursor.current[asset.id] || 0
    const targetPage = pages_list[cur % pages_list.length]
    occurrenceCursor.current[asset.id] = (cur + 1) % pages_list.length
    onNavigate(targetPage)
  }

  return (
    <>
    {/* Modal anteprima foto */}
    {previewAsset && createPortal(
      <>
        <div
          onClick={() => setPreviewAsset(null)}
          style={{
            position:'fixed', inset:0, zIndex:9990,
            background:'rgba(0,0,0,0.82)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position:'relative', maxWidth:'90vw', maxHeight:'90vh',
              display:'flex', flexDirection:'column', alignItems:'center', gap:12,
            }}>
            {/* X button */}
            <button
              onClick={() => setPreviewAsset(null)}
              style={{
                position:'absolute', top:-14, right:-14, zIndex:1,
                width:32, height:32, borderRadius:'50%',
                background:'var(--bg2)', border:'1px solid var(--border)',
                color:'var(--text)', fontSize:18, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center',
                lineHeight:1,
              }}>✕</button>
            {/* Immagine */}
            {(()=>{
              const uses  = usageMap[previewAsset.id] || 0
              const pages = usagePages[previewAsset.id] || []
              const excl  = excludedMap[previewAsset.id]
              const isPerm = permRemovedSet.has(previewAsset.id)
              const borderClr = uses > 0 ? '#4ac585' : '#e05050'
              let statusLabel, statusColor
              if (uses > 0) {
                statusLabel = tp.panelUsedInPages(pages)
                statusColor = '#4ac585'
              } else if (isPerm) {
                statusLabel = tp.panelExcludedPermanent
                statusColor = '#e05050'
              } else if (excl) {
                const r = excl.reason || ''
                if (r === 'quality')
                  statusLabel = tp.panelExcludedQuality(excl.detail || '')
                else if (r.startsWith('duplicate'))
                  statusLabel = tp.panelExcludedDuplicate(excl.detail || '')
                else
                  statusLabel = tp.panelExcludedUnknown(excl.detail || '')
                statusColor = '#e05050'
              } else {
                statusLabel = tp.panelNotUsedNoReason
                statusColor = '#e89a3a'
              }
              return (<>
                <img
                  src={`/api/thumb/${previewAsset.id}?size=preview`}
                  alt={previewAsset.originalFileName || previewAsset.id}
                  style={{
                    maxWidth:'85vw', maxHeight:'76vh',
                    objectFit:'contain', borderRadius:6,
                    boxShadow:'0 8px 40px rgba(0,0,0,0.8)',
                    border:`2px solid ${borderClr}`,
                  }}
                />
                <div style={{ textAlign:'center', maxWidth:'80vw' }}>
                  <p style={{
                    fontSize:12, color:'rgba(255,255,255,0.75)',
                    fontFamily:'var(--font-mono)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    marginBottom:4,
                  }}>
                    {previewAsset.originalFileName || previewAsset.id}
                  </p>
                  <p style={{ fontSize:11, color: statusColor, fontFamily:'var(--font-mono)' }}>
                    {statusLabel}
                  </p>
                </div>
              </>)
            })()}
          </div>
        </div>
      </>,
      document.body
    )}
    <div style={{
      width: open ? 200 : 30,
      flexShrink: 0, transition: 'width 0.22s ease',
      background: 'var(--bg2)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
    }}>
      <button onClick={onToggle}
        title={open ? tp.collapsePanel : tp.expandPanel}
        style={{
          position:'absolute', left:0, top:'50%', transform:'translateY(-50%)',
          width:16, height:48, background:'var(--bg3)',
          border:'1px solid var(--border)', borderRight:'none',
          borderRadius:'5px 0 0 5px', cursor:'pointer', zIndex:10,
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'var(--text3)', fontSize:12,
        }}>
        {open ? '›' : '‹'}
      </button>

      {open && (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',marginLeft:16}}>

          {/* Header */}
          <div style={{padding:'10px 8px 6px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
            <p style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text3)',
              textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5}}>
              {tp.panelPhotos(assets.length)}
            </p>

            {/* Status filter */}
            <div style={{display:'flex',gap:3,marginBottom:6}}>
              {[['all',tp.panelAll],['unused',tp.panelUnused],['multi',tp.panelMulti]].map(([k,l])=>(
                <button key={k}
                  onClick={()=>setStatusFilter(k)}
                  title={l}
                  style={{
                    flex:1, fontSize:10, padding:'3px 0',
                    border:`1px solid ${statusFilter===k?'var(--gold)':'var(--border)'}`,
                    background: statusFilter===k?'var(--gold-dim)':'transparent',
                    color: statusFilter===k?'var(--gold)':'var(--text3)',
                    borderRadius:4, cursor:'pointer',
                  }}>{l}</button>
              ))}
            </div>

            {/* Search */}
            <input className="form-input" style={{fontSize:10,padding:'4px 7px'}}
              placeholder={tp.panelSearch} value={filter} onChange={e=>setFilter(e.target.value)}/>

            {/* View mode */}
            <div style={{display:'flex',gap:3,marginTop:5}}>
              {[1,2,3].map(n=>(
                <button key={n} onClick={()=>{setView(n);localStorage.setItem('pb_view',n)}}
                  style={{
                    flex:1, fontSize:10, padding:'2px 0',
                    border:`1px solid ${view===n?'var(--gold)':'var(--border)'}`,
                    background: view===n?'var(--gold-dim)':'transparent',
                    color: view===n?'var(--gold)':'var(--text3)',
                    borderRadius:4, cursor:'pointer',
                  }}>{n}×</button>
              ))}
            </div>
          </div>

          {/* Stats row */}
          <div style={{padding:'4px 8px',borderBottom:'1px solid var(--border)',
            fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',
            display:'flex',gap:8,flexShrink:0}}>
            <span style={{color:'#4ac585'}}>✓{used}</span>
            <span style={{color:'#e89a3a'}}>×{multi}</span>
            <span style={{color:'#e05050'}}>○{unused}</span>
          </div>

          {/* Photo list — scroll container with minHeight:0 so flex shrink works */}
          <div style={{
            flex: 1, minHeight: 0,  /* CRITICAL: without this flex child never shrinks */
            overflowY: 'auto', overflowX: 'hidden',
            padding: '6px 6px 0',
          }}>
            {/* Inner grid/list wrapper — NOT the scroll container */}
            {view === 1 ? (
              <div style={{ display:'flex', flexDirection:'column', gap:5, paddingBottom:6 }}>
                {filtered.map(asset => {
                  const uses  = usageMap[asset.id] || 0
                  const pages = usagePages[asset.id] || []
                  const bc    = borderColor(asset.id)
                  const alt   = altText(asset)
                  const firstPage = pages[0]
                  return (
                    <div key={asset.id}
                      ref={highlightedAsset===asset.id ? highlightRef : null}
                      draggable
                      onDragStart={e=>{e.dataTransfer.setData('asset_id',asset.id);onDragStart(asset)}}
                      onClick={()=>{ handlePhotoClick(asset); onClearHighlight?.() }}
                      onDoubleClick={()=>setPreviewAsset(asset)}
                      title={alt}
                      style={{
                        display:'flex', gap:6, alignItems:'center', flexShrink:0,
                        cursor:firstPage!==undefined?'pointer':'grab',
                        borderRadius:4, padding:'3px 5px',
                        border: highlightedAsset===asset.id
                          ? '2px solid var(--gold)'
                          : `1.5px solid ${bc}`,
                        background: highlightedAsset===asset.id ? 'var(--gold-dim)' : 'transparent',
                        opacity:uses===0?0.65:1,
                        transition:'background 0.1s, border-color 0.1s',
                        boxShadow: highlightedAsset===asset.id ? '0 0 0 2px rgba(212,170,90,0.25)' : 'none',
                      }}
                      onMouseEnter={e=>{if(highlightedAsset!==asset.id)e.currentTarget.style.background='var(--bg3)'}}
                      onMouseLeave={e=>{if(highlightedAsset!==asset.id)e.currentTarget.style.background='transparent'}}>
                      <div style={{width:38,height:38,flexShrink:0,borderRadius:3,
                        overflow:'hidden',background:'var(--bg3)',position:'relative'}}>
                        <img src={`/api/thumb/${asset.id}`} alt={alt} loading="lazy"
                          style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                        {uses>1&&<div style={{position:'absolute',top:1,right:1,
                          background:'#e89a3a',color:'#000',fontSize:8,
                          padding:'1px 3px',borderRadius:2,fontWeight:700}}>{uses}×</div>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontSize:9,color:'var(--text2)',overflow:'hidden',
                          textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:'var(--font-mono)'}}>
                          {(asset.originalFileName||asset.id).replace(/\.[^.]+$/,'')}
                        </p>
                        <p style={{fontSize:8,color:'var(--text3)',marginTop:1}}>
                          {uses===0?tp.panelNotUsedLabel:pages.length?tp.panelPageHint(pages):`${uses}×`}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: view===2 ? '1fr 1fr' : '1fr 1fr 1fr',
                gap: 4,
                paddingBottom: 6,
              }}>
                {filtered.map(asset => {
                  const uses  = usageMap[asset.id] || 0
                  const pages = usagePages[asset.id] || []
                  const bc    = borderColor(asset.id)
                  const alt   = altText(asset)
                  const firstPage = pages[0]
                  return (
                    <div key={asset.id}
                      ref={highlightedAsset===asset.id ? highlightRef : null}
                      draggable
                      onDragStart={e=>{e.dataTransfer.setData('asset_id',asset.id);onDragStart(asset)}}
                      onClick={()=>{ handlePhotoClick(asset); onClearHighlight?.() }}
                      onDoubleClick={()=>setPreviewAsset(asset)}
                      title={alt}
                      style={{
                        position:'relative', width:'100%', paddingTop:'100%',
                        cursor:(usageMap[asset.id]||0)===0?'zoom-in':firstPage!==undefined?'pointer':'grab',
                        borderRadius:4, overflow:'hidden',
                        border: highlightedAsset===asset.id
                          ? '2px solid var(--gold)'
                          : `2px solid ${bc}`,
                        opacity:uses===0?0.6:1,
                        transition:'box-shadow 0.12s, border-color 0.12s',
                        boxSizing:'border-box',
                        boxShadow: highlightedAsset===asset.id ? '0 0 0 3px rgba(212,170,90,0.4)' : 'none',
                      }}
                      onMouseEnter={e=>{
                        if(highlightedAsset!==asset.id){
                          e.currentTarget.style.boxShadow='0 0 0 2px var(--gold)'
                          e.currentTarget.style.borderColor='var(--gold)'
                        }
                      }}
                      onMouseLeave={e=>{
                        if(highlightedAsset!==asset.id){
                          e.currentTarget.style.boxShadow='none'
                          e.currentTarget.style.borderColor=bc
                        }
                      }}>
                      {/* Content inside the aspect-ratio box */}
                      <div style={{position:'absolute',inset:0}}>
                        <img src={`/api/thumb/${asset.id}`} alt={alt} loading="lazy"
                          style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                        {uses===0&&<div style={{position:'absolute',inset:0,background:'rgba(220,50,50,0.35)',pointerEvents:'none'}}/>}
                        {uses>1&&<div style={{position:'absolute',top:2,right:2,
                          background:'#e89a3a',color:'#000',fontSize:8,
                          padding:'1px 3px',borderRadius:2,fontWeight:700,lineHeight:1.3}}>{uses}×</div>}
                        {pages.length>0&&firstPage!==undefined&&(
                          <div style={{position:'absolute',bottom:0,left:0,right:0,textAlign:'center',
                            fontSize:8,color:'rgba(255,255,255,0.85)',fontFamily:'var(--font-mono)',
                            background:'rgba(0,0,0,0.45)',lineHeight:1.6}}>p.{firstPage+1}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length===0&&(
              <p style={{textAlign:'center',color:'var(--text3)',fontSize:10,padding:'20px 0'}}>
                {filter||statusFilter!=='all'?tp.panelNoResults:tp.panelNoPhotos}
              </p>
            )}
          </div>

          <div style={{padding:'5px 8px',borderTop:'1px solid var(--border)',
            fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',flexShrink:0}}>
            {tp.panelDragHint}
          </div>
        </div>
      )}
    </div>
    </>
  )
}
