import { useState, useEffect, useRef } from 'react'
import { getPageDims } from '../../utils/pageGeometry'
import { DividerCanvas } from '../../components/DividerEditor'

// ── CoverSpreadPage: DividerCanvas in spread with ghost toolbar for alignment ──
export default function CoverSpreadPage({ coverStyle, albumInfo, profile, allPageTypes, dividerMapUrl, onClick, fixedScale=null }) {
  const [pw, ph] = getPageDims(profile)
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(570)

  useEffect(() => {
    if (fixedScale != null) return
    if (!containerRef.current) return
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width || 570))
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [fixedScale])

  const maxH_px = typeof window !== 'undefined' ? window.innerHeight * 0.65 : 600
  const scale = fixedScale != null ? fixedScale : Math.min(containerW / pw, maxH_px / ph)
  const W = Math.round(pw * scale)
  const H = Math.round(ph * scale)
  // Match LayoutPickerDropdown button height: SlotPreview SVG height + padding
  const slotPreviewH = Math.round(ph / pw * 52)

  return (
    <div ref={containerRef} style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center' }}>
      {allPageTypes.length > 0 && (
        <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8, flexShrink:0, visibility:'hidden' }}>
          <span className="text-xs text-muted" style={{ flexShrink:0 }}>Layout:</span>
          <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:6,
            fontSize:11, padding:'3px 6px',
            background:'var(--bg3)', border:'1px solid var(--border)',
            color:'var(--text)', borderRadius:5, minHeight: slotPreviewH }}>—</div>
          <button className="btn btn-sm" style={{ fontSize:10, flexShrink:0, padding:'3px 8px' }}>+ Slot</button>
        </div>
      )}
      <div style={{ borderRadius:2, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
        cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}>
        <DividerCanvas
          style={coverStyle}
          albumInfo={albumInfo}
          canvasW={W} canvasH={H}
          readOnly dividerMapUrl={dividerMapUrl}/>
      </div>
    </div>
  )
}
