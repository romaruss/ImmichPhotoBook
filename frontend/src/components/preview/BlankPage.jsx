import { useState, useEffect, useRef } from 'react'
import { getPageDims } from '../../utils/pageGeometry'

// ── BlankPage — stesse dimensioni e struttura di EditablePage ────────────────
// Replica pixel-perfect il layout di EditablePage: stesso ResizeObserver,
// stesso calcolo scale, stesso toolbar invisibile (visibility:hidden ma
// con le stesse dimensioni del toolbar reale → allineamento garantito da CSS).
export function BlankPage({ profile, allPageTypes, label, maxW=570, zoomFactor=1 }) {
  const [pw,ph]=getPageDims(profile)
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(maxW)

  useEffect(()=>{
    if(!containerRef.current) return
    const ro = new ResizeObserver(([e])=> setContainerW(e.contentRect.width||maxW))
    ro.observe(containerRef.current)
    return ()=>ro.disconnect()
  },[maxW])

  const maxH_px = typeof window !== 'undefined' ? window.innerHeight * 0.65 : 600
  const scale = Math.min(containerW/pw, maxH_px/ph) * zoomFactor
  const W = pw*scale, H = ph*scale

  return (
    <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
      {/* Toolbar fantasma: usa lo stesso markup del LayoutPickerDropdown (<div> non <select>)
          così l'altezza coincide con quella di EditablePage → pagine allineate nello spread. */}
      {allPageTypes.length>0 && (
        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8,flexShrink:0,visibility:'hidden'}}>
          <span className="text-xs text-muted" style={{flexShrink:0}}>Layout:</span>
          <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:6,
            fontSize:11,padding:'3px 6px',
            background:'var(--bg3)',border:'1px solid var(--border)',
            color:'var(--text)',borderRadius:5}}>—</div>
          <button className="btn btn-sm" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}>+ Slot</button>
        </div>
      )}
      <div style={{width:W,height:H,background:'#f0ece4',
        boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,flexShrink:0,
        display:'flex',alignItems:'center',justifyContent:'center'}}>
        <p style={{fontSize:11,color:'#c0bbb2',fontFamily:'var(--font-mono)',fontStyle:'italic'}}>
          {label || 'pagina vuota'}
        </p>
      </div>
    </div>
  )
}

// ── Blank page factory (used to pad pages.length to even) ─────────────────────
export function makeBlankPage(profile) {
  const pts = (profile?.page_types) || []
  const defaultPT = pts[0] || { id:'blank', label:'Vuota', slots:[{x:0,y:0,w:100,h:100}] }
  return {
    page_type_id: defaultPT.id,
    page_type: defaultPT,
    items: defaultPT.slots.map(slot => ({ slot, item: null }))
  }
}
export function ensureEvenPages(pagesArr, profile) {
  if (!pagesArr || pagesArr.length % 2 === 0) return pagesArr
  return [...pagesArr, makeBlankPage(profile)]
}
