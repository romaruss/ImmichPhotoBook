import { useState } from 'react'
import { useT } from '../../i18n.jsx'

// ── Photo picker modal ────────────────────────────────────────────────────────
export default function PhotoPickerModal({ assets, allAlbumAssets, albumIdx, albumNames, usageMap, onSelect, onClose }) {
  const tp = useT().preview
  const [filter,setFilter] = useState('')
  const isMulti = allAlbumAssets?.length > 1
  const [showAll,setShowAll] = useState(false)
  const base = (isMulti && !showAll ? (allAlbumAssets[albumIdx] || assets) : assets)
    .filter(a=>(a.type||'IMAGE').toUpperCase()!=='VIDEO')
  const filtered = base.filter(a=>!filter||(a.originalFileName||'').toLowerCase().includes(filter.toLowerCase()))
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--bg2)',borderRadius:12,padding:24,width:680,maxHeight:'82vh',display:'flex',flexDirection:'column',border:'1px solid var(--border)',boxShadow:'0 24px 80px rgba(0,0,0,0.6)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <h3 style={{fontFamily:'var(--font-display)',fontWeight:300,fontSize:20}}>{tp.pickerTitle}</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>
        {isMulti&&(
          <div style={{display:'flex',gap:4,marginBottom:10,background:'var(--bg3)',borderRadius:6,padding:3}}>
            <button onClick={()=>setShowAll(false)}
              style={{flex:1,padding:'4px 8px',borderRadius:4,border:'none',cursor:'pointer',fontSize:12,
                background:!showAll?'var(--gold)':'transparent',color:!showAll?'#0a0a0c':'var(--text)',fontWeight:!showAll?700:400}}>
              {albumNames?.[albumIdx] || `Album ${albumIdx+1}`}
            </button>
            <button onClick={()=>setShowAll(true)}
              style={{flex:1,padding:'4px 8px',borderRadius:4,border:'none',cursor:'pointer',fontSize:12,
                background:showAll?'var(--gold)':'transparent',color:showAll?'#0a0a0c':'var(--text)',fontWeight:showAll?700:400}}>
              {tp.pickerAllAlbums}
            </button>
          </div>
        )}
        <input className="form-input" placeholder={tp.pickerSearch} style={{marginBottom:10}} value={filter} onChange={e=>setFilter(e.target.value)} autoFocus/>
        <div style={{overflowY:'auto',flex:1}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8}}>
            {filtered.map(asset=>{
              const uses=usageMap[asset.id]||0
              const bc=uses>1?'#e89a3a':uses===1?'#4ac585':'#e05050'
              return (
                <div key={asset.id} onClick={()=>onSelect(asset)}
                  style={{cursor:'pointer',borderRadius:6,overflow:'hidden',aspectRatio:'1',position:'relative',
                    border:`2px solid ${bc}`,transition:'border-color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=bc}>
                  <img src={`/api/thumb/${asset.id}`} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                  {uses===0&&<div style={{position:'absolute',inset:0,background:'rgba(220,50,50,0.35)',pointerEvents:'none'}}/>}
                  {uses>1&&<div style={{position:'absolute',top:3,right:3,background:'#e89a3a',color:'#000',fontSize:9,padding:'1px 5px',borderRadius:3,fontWeight:700}}>{uses}×</div>}
                </div>
              )
            })}
          </div>
          {filtered.length===0&&<p style={{textAlign:'center',padding:32,color:'var(--text3)'}}>{tp.pickerNoResults}</p>}
        </div>
      </div>
    </div>
  )
}
