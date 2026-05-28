import { getPageDims, slotRect } from '../../utils/pageGeometry'

// ── Mini thumbnail ────────────────────────────────────────────────────────────
export default function MiniPage({ page, profile, scale=0.07 }) {
  const [pw,ph] = getPageDims(profile)
  return (
    <div style={{width:pw*scale,height:ph*scale,background:'#e8e4dc',position:'relative',overflow:'hidden',flexShrink:0}}>
      {(page?.items||[]).map((id,i)=>{
        const r=slotRect(id.slot||{x:0,y:0,w:100,h:100},pw,ph,profile,scale,null)
        const s={position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,overflow:'hidden'}
        const item=id.item
        if(!item) return <div key={i} style={{...s,background:'#c8c5be'}}/>
        if(item.type==='caption') return <div key={i} style={{...s,background:'#111116'}}/>
        if(item.type==='map') return <div key={i} style={{...s,background:'#0d1117'}}><img src={`/api/mapcache/${item.map_key}`} alt="mappa GPS" loading="lazy" style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/></div>
        return <div key={i} style={s}><img src={`/api/thumb/${item.asset_id}`} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/></div>
      })}
    </div>
  )
}
