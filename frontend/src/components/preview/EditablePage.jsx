import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { getPageDims, slotRect, isMismatch, marginsForPage } from '../../utils/pageGeometry'
import { useT } from '../../i18n.jsx'
import SlotDividers from './SlotDividers'
import PhotoSlot from './PhotoSlot'
import MapSlot from './MapSlot'
import LayoutPickerDropdown from './LayoutPickerDropdown'
import { DividerCanvas, DividerEditorModal, migrateDividerStyle } from '../../components/DividerEditor'
import { DEFAULT_COVER_CONFIG } from '../../components/CoverConfig'

export function autoNameSlots(slots, orientation) {
  const pageAR = orientation === 'landscape' ? 504/360 : 360/504
  const photo = slots.filter(s => s.slot_type !== 'caption')
  const capt  = slots.filter(s => s.slot_type === 'caption')
  const n = photo.length
  const suffix = capt.length > 0 ? ` +${capt.length}T` : ''
  if (n === 0) return capt.length === 1 ? '1 didascalia' : `${capt.length} didascalie`
  const nPort = photo.filter(s => (s.w / (s.h || 1)) * pageAR < 1).length
  const nLand = n - nPort
  if (n === 1) return `1 ${nPort ? 'verticale' : 'orizzontale'}${suffix}`
  if (n === 2) {
    if (nPort === 2) return `2 verticali${suffix}`
    if (nLand === 2) return `2 orizzontali${suffix}`
    return `vert + oriz${suffix}`
  }
  if (n === 3) {
    const areas = photo.map(s => s.w * s.h)
    const maxA = Math.max(...areas), minA = Math.min(...areas)
    if (maxA / minA > 2) return `1 grande + 2${suffix}`
    return `3 foto${suffix}`
  }
  const areas = photo.map(s => s.w * s.h)
  const maxA = Math.max(...areas), minA = Math.min(...areas)
  if (maxA / minA < 1.4) {
    if (n === 4) return `4 griglia 2×2${suffix}`
    if (n === 6) return `6 griglia 3×2${suffix}`
  }
  return `${n} foto${suffix}`
}

export default function EditablePage({ page, pageIdx, profile, allPageTypes,
                        photoAspects, photoTransforms, originalTransforms,
                        onTransformChange, onSwapTransforms, onSlotRemoved,
                        onUpdatePage, onOpenPicker, onAddCaption,
                        onDrop, maxW=570, onPhotoClick, onAddMap, isActive=false, zoomFactor=1,
                        fixedScale=null,
                        dividerMapUrl, assets, assetById={}, onSaveCustomLayout,
                        onRemovePermanently }) {
  const t = useT(); const tp = t.preview
  const [pw,ph]=getPageDims(profile)
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(maxW)

  useEffect(()=>{
    if(fixedScale!=null) return
    if(!containerRef.current) return
    const ro = new ResizeObserver(([e])=> setContainerW(e.contentRect.width||maxW))
    ro.observe(containerRef.current)
    return ()=>ro.disconnect()
  },[maxW, fixedScale])

  const maxH_px = typeof window !== 'undefined' ? window.innerHeight * 0.65 : 600
  const scale = fixedScale != null ? fixedScale : Math.min(containerW/pw, maxH_px/ph) * zoomFactor
  const W=pw*scale, H=ph*scale

  const [dragFromIdx,setDragFromIdx]=useState(null)
  const [dragOverIdx,setDragOverIdx]=useState(null)
  const [editCaptionIdx,setEditCaptionIdx]=useState(null)
  const [captionToolbarMore,setCaptionToolbarMore]=useState(false)
  const [syncToImmich,setSyncToImmich]=useState(true)
  const [showSymbols,setShowSymbols]=useState(false)
  const textareaRef=useRef(null)
  const [editPhotoSlot,setEditPhotoSlot]=useState(null)
  const [editMapSlot,setEditMapSlot]=useState(null)
  const [slotMenu,setSlotMenu]=useState(null) // {x,y,yAbove,title,items:[{icon,label,action,color,danger}]}
  const [dividerEditOpen,setDividerEditOpen]=useState(false)

  const openSlotMenu=(e, title, items)=>{
    e.stopPropagation()
    const rect=e.currentTarget.closest('[data-slot-anchor]')?.getBoundingClientRect()
      || e.currentTarget.getBoundingClientRect()
    setSlotMenu({x:rect.left+rect.width/2, y:rect.bottom+8, yAbove:rect.top-8, title, items})
  }

  // Reset edit quando cambia pagina
  useEffect(()=>{setEditPhotoSlot(null);setEditCaptionIdx(null);setCaptionToolbarMore(false);setShowSymbols(false);setSlotMenu(null)},[pageIdx])

  useEffect(()=>{
    if(!slotMenu) return
    const close=e=>{ if(!e.target.closest?.('[data-slot-menu]')) setSlotMenu(null) }
    const esc=e=>{ if(e.key==='Escape') setSlotMenu(null) }
    setTimeout(()=>{ window.addEventListener('mousedown',close); window.addEventListener('keydown',esc) },0)
    return ()=>{ window.removeEventListener('mousedown',close); window.removeEventListener('keydown',esc) }
  },[slotMenu])

  // Quando si apre una caption: imposta syncToImmich in base a for_asset_id
  useEffect(()=>{
    if(editCaptionIdx!==null){
      const it=page.items[editCaptionIdx]?.item
      setSyncToImmich(!!it?.for_asset_id)
      setShowSymbols(false)
    }
  },[editCaptionIdx])

  const swapItems=(fromIdx,toIdx)=>{
    if(fromIdx===toIdx) return
    const ni=page.items.map(i=>({...i}))
    const tmp=ni[fromIdx].item;ni[fromIdx]={...ni[fromIdx],item:ni[toIdx].item};ni[toIdx]={...ni[toIdx],item:tmp}
    onUpdatePage({...page,items:ni})
    onSwapTransforms?.(`${pageIdx}_${fromIdx}`,`${pageIdx}_${toIdx}`)
  }

  const removeSlot=(slotIdx)=>{
    const items=page.items; if(items.length<=1) return
    const slot=items[slotIdx].slot; const EPS=1.5
    let mergeIdx=-1,mergeDir=null
    for(let i=0;i<items.length;i++){
      if(i===slotIdx) continue
      const s=items[i].slot
      if(Math.abs(s.y-slot.y)<EPS&&Math.abs(s.h-slot.h)<EPS){
        if(Math.abs((s.x+s.w)-slot.x)<EPS){mergeIdx=i;mergeDir='leftOf';break}
        if(Math.abs((slot.x+slot.w)-s.x)<EPS){mergeIdx=i;mergeDir='rightOf';break}
      }
      if(Math.abs(s.x-slot.x)<EPS&&Math.abs(s.w-slot.w)<EPS){
        if(Math.abs((s.y+s.h)-slot.y)<EPS){mergeIdx=i;mergeDir='above';break}
        if(Math.abs((slot.y+slot.h)-s.y)<EPS){mergeIdx=i;mergeDir='below';break}
      }
    }
    let newItems
    if(mergeIdx>=0){
      newItems=items.map((id,i)=>{
        if(i!==mergeIdx) return id
        const s={...id.slot}
        if(mergeDir==='leftOf')  s.w=parseFloat((s.w+slot.w).toFixed(2))
        if(mergeDir==='rightOf'){s.x=slot.x;s.w=parseFloat((s.w+slot.w).toFixed(2))}
        if(mergeDir==='above')   s.h=parseFloat((s.h+slot.h).toFixed(2))
        if(mergeDir==='below')  {s.y=slot.y;s.h=parseFloat((s.h+slot.h).toFixed(2))}
        return {...id,slot:s}
      }).filter((_,i)=>i!==slotIdx)
    } else {
      newItems=items.filter((_,i)=>i!==slotIdx)
    }
    setEditPhotoSlot(null)
    onUpdatePage({...page,items:newItems,page_type_id:'custom',
      page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}})
    onSlotRemoved?.(pageIdx, slotIdx, items.length)
  }

  const removeItem=(slotIdx)=>
    onUpdatePage({...page,items:page.items.map((id,i)=>i===slotIdx?{...id,item:null}:id)})

  const updateCaption=(slotIdx, text, style)=>
    onUpdatePage({...page,items:page.items.map((id,i)=>i===slotIdx
      ? {...id,item:{...id.item, ...(text!==undefined?{text}:{}), ...(style?{caption_style:style}:{})}}
      : id)})

  const addBadge=(slotIdx)=>{
    const id=page.items[slotIdx]; if(!id?.item) return
    const it=id.item
    const parts=[it._badge_location, it._badge_date].filter(Boolean)
    if(!parts.length) return
    const text=parts.join(' · ')
    const existing=(it.badges||[]).filter(b=>b.id!=='auto')
    const badge={id:'auto', text, type:'auto'}
    onUpdatePage({...page,items:page.items.map((id2,i)=>i===slotIdx
      ? {...id2,item:{...id2.item,badges:[...existing,badge]}}
      : id2)})
  }

  const removeBadge=(slotIdx, badgeId)=>
    onUpdatePage({...page,items:page.items.map((id,i)=>i===slotIdx
      ? {...id,item:{...id.item,badges:(id.item?.badges||[]).filter(b=>b.id!==badgeId)}}
      : id)})

  // Sync caption text back to Immich as asset description
  const syncCaptionToImmich = async (slotIdx) => {
    const id = page.items[slotIdx]
    if (!id?.item?.for_asset_id || !id.item.text) return
    try {
      await axios.post(`/api/assets/${id.item.for_asset_id}/description`, {
        asset_id: id.item.for_asset_id,
        description: id.item.text,
      })
    } catch(e) { console.warn('Immich sync failed', e) }
  }

  const changePageType=(ptId)=>{
    const pt=allPageTypes.find(p=>p.id===ptId);if(!pt) return
    // Merge visible items + previously pooled overflow so photos are restored when
    // switching back to a layout with more slots.
    const visible = page.items.map(i=>i.item).filter(Boolean)
    const pool    = (page._photo_pool||[]).filter(Boolean)
    const inView  = new Set(visible.map(i=>i.asset_id).filter(Boolean))
    const merged  = [...visible, ...pool.filter(i=>!inView.has(i.asset_id))]
    const newItems= pt.slots.map((slot,idx)=>({slot, item:merged[idx]??null}))
    const newPool = merged.slice(pt.slots.length)
    onUpdatePage({...page, page_type_id:ptId, page_type:pt, items:newItems, _photo_pool:newPool})
  }

  const addSlot=()=>{
    let bigIdx=0,bigArea=0
    page.items.forEach((id,i)=>{const a=id.slot.w*id.slot.h;if(a>bigArea){bigArea=a;bigIdx=i}})
    const slot=page.items[bigIdx].slot
    let s1,s2
    if(slot.w>=slot.h){
      const half=parseFloat((slot.w/2).toFixed(2))
      s1={...slot,w:half}
      s2={x:parseFloat((slot.x+half).toFixed(2)),y:slot.y,w:parseFloat((slot.w-half).toFixed(2)),h:slot.h}
    } else {
      const half=parseFloat((slot.h/2).toFixed(2))
      s1={...slot,h:half}
      s2={x:slot.x,y:parseFloat((slot.y+half).toFixed(2)),w:slot.w,h:parseFloat((slot.h-half).toFixed(2))}
    }
    const ni=[...page.items];ni[bigIdx]={...ni[bigIdx],slot:s1};ni.push({slot:s2,item:null})
    onUpdatePage({...page,items:ni,page_type_id:'custom',
      page_type:{id:'custom',label:'Custom',slots:ni.map(i=>i.slot)}})
  }


  // Special pages: album cover marker and blank separator
  if (page?._album_cover) {
    const cs = profile?.cover_style || {}
    return (
      <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
        <div style={{width:W,height:H,background:cs.bg||'#0a0a0e',
          boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,overflow:'hidden',
          display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:14}}>
          <div style={{width:'60%',height:1,background:(cs.accent_color||'#d4aa5a')+'99'}}/>
          <p style={{fontFamily:'var(--font-display)',fontWeight:300,
            fontSize:Math.round(24*scale*2),color:cs.text_color||'#f0ede6',textAlign:'center',padding:'0 16px'}}>
            {tp.sectionCover(page._album_info?.albumName)}
          </p>
          {page._album_info?.assetCount>0 && (
            <p style={{fontSize:Math.round(11*scale*2),color:cs.accent_color||'#d4aa5a',fontFamily:'var(--font-mono)'}}>
              {tp.photoCount(page._album_info.assetCount)}
            </p>
          )}
          <div style={{width:'60%',height:1,background:(cs.accent_color||'#d4aa5a')+'99'}}/>
        </div>
      </div>
    )
  }

  if (page?._album_separator) {
    return (
      <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
        <div style={{width:W,height:H,background:'#e8e4dc',
          boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,
          display:'flex',alignItems:'center',justifyContent:'center'}}>
          <p style={{fontSize:11,color:'#aaa',fontFamily:'var(--font-mono)'}}>{tp.blankPage}</p>
        </div>
      </div>
    )
  }

  const isDivider = !!page?._album_divider

  // Divider pages use a dedicated element-based renderer instead of the slot system.
  if (isDivider) {
    const ds = migrateDividerStyle(page._divider_style)
    return (
      <>
      <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
        {/* Ghost toolbar — same height as photo-page toolbar so spread alignment matches */}
        {allPageTypes.length>0 && (()=>{
          const slotPreviewH = Math.round(ph/pw * 52)
          return (
            <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8,flexShrink:0,visibility:'hidden'}}>
              <span className="text-xs text-muted" style={{flexShrink:0}}>Layout:</span>
              <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:6,
                fontSize:11,padding:'3px 6px',
                background:'var(--bg3)',border:'1px solid var(--border)',
                color:'var(--text)',borderRadius:5,minHeight:slotPreviewH}}>—</div>
              <button className="btn btn-sm" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}>+ Slot</button>
            </div>
          )
        })()}
        <div style={{position:'relative',flexShrink:0,cursor:'pointer'}} onClick={()=>setDividerEditOpen(true)}>
          <div style={{width:W,height:H,borderRadius:2,boxShadow:'0 16px 64px rgba(0,0,0,0.55)',overflow:'hidden'}}>
            <DividerCanvas
              style={ds}
              albumInfo={page._album_info}
              canvasW={W} canvasH={H}
              readOnly
              dividerMapUrl={dividerMapUrl}
            />
          </div>
        </div>
        <p className="text-xs text-muted" style={{marginTop:6}}>{tp.coverClickToEdit}</p>
      </div>
      {dividerEditOpen && (
        <DividerEditorModal
          value={ds}
          onChange={newDs=>onUpdatePage({...page,_divider_style:newDs})}
          onClose={()=>setDividerEditOpen(false)}
          profile={profile}
          albumInfo={page._album_info}
          dividerMapUrl={dividerMapUrl}
          assets={assets}
        />
      )}
      </>
    )
  }

  return (
    <>
    <div ref={containerRef} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
      {/* Page type switcher — custom picker with hover mini-preview */}
      {allPageTypes.length>0&&(
        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8,flexShrink:0}}>
          <span className="text-xs text-muted" style={{flexShrink:0}}>Layout:</span>
          <LayoutPickerDropdown
            allPageTypes={allPageTypes}
            currentId={page.page_type_id||''}
            profile={profile}
            onChange={changePageType}/>
          <button className="btn btn-sm" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}
            title={tp.addSlot} onClick={addSlot}>+ Slot</button>
          {page.page_type_id==='custom' && onSaveCustomLayout && (
            <button className="btn btn-sm btn-primary" style={{fontSize:10,flexShrink:0,padding:'3px 8px'}}
              title={tp.saveCustomLayoutTitle}
              onClick={()=>onSaveCustomLayout(page.items.map(i=>i.slot))}>
              {tp.saveBtn}
            </button>
          )}
        </div>
      )}

      {/* Page canvas */}
      {(
      <div style={{width:W,height:H,
        background: '#f0ece4',
        position:'relative',
        boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,overflow:'hidden',
        outline: isActive ? '3px solid #4ac585' : 'none', outlineOffset:'3px',
        userSelect:'none',WebkitUserSelect:'none'}}>
        {/* Margin overlay — shows actual margin lines per page */}
        {(()=>{
          const _mo = marginsForPage(profile, pageIdx+2)
          const bleedMm = profile?.bleed ? (profile?.bleed_mm||3) : 0
          const bleedPx = bleedMm * 2.835 * scale
          const mlPx = _mo.ml*scale, mrPx = _mo.mr*scale
          const mtPx = _mo.mt*scale, mbPx = _mo.mb*scale
          return (
            <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1}} overflow="visible">
              {/* Margin lines */}
              <line x1={mlPx} y1={0} x2={mlPx} y2={H} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              <line x1={W-mrPx} y1={0} x2={W-mrPx} y2={H} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              <line x1={0} y1={mtPx} x2={W} y2={mtPx} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              <line x1={0} y1={H-mbPx} x2={W} y2={H-mbPx} stroke="rgba(100,140,200,0.35)" strokeWidth={0.7} strokeDasharray="4,3"/>
              {/* Binding edge highlight */}
              {profile?.duplex && (
                <rect
                  x={(pageIdx+2)%2===0 ? W-mrPx-1 : mlPx-2}
                  y={0} width={3} height={H}
                  fill="rgba(212,170,90,0.18)"
                />
              )}
              {/* Bleed indicators (corner marks) */}
              {bleedMm > 0 && profile?.crop_marks && (
                <g stroke="rgba(200,0,0,0.4)" strokeWidth={0.7}>
                  <line x1={0} y1={bleedPx} x2={bleedPx*0.6} y2={bleedPx}/>
                  <line x1={bleedPx} y1={0} x2={bleedPx} y2={bleedPx*0.6}/>
                  <line x1={W} y1={bleedPx} x2={W-bleedPx*0.6} y2={bleedPx}/>
                  <line x1={W-bleedPx} y1={0} x2={W-bleedPx} y2={bleedPx*0.6}/>
                  <line x1={0} y1={H-bleedPx} x2={bleedPx*0.6} y2={H-bleedPx}/>
                  <line x1={bleedPx} y1={H} x2={bleedPx} y2={H-bleedPx*0.6}/>
                  <line x1={W} y1={H-bleedPx} x2={W-bleedPx*0.6} y2={H-bleedPx}/>
                  <line x1={W-bleedPx} y1={H} x2={W-bleedPx} y2={H-bleedPx*0.6}/>
                </g>
              )}
              {/* Margin labels on hover area */}
              <text x={mlPx/2} y={mtPx+14} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">
                {profile?.duplex && (pageIdx+2)%2!==0 ? `Int ${profile?.margin_right||profile?.margin_mm||5}mm` : `Ext ${profile?.margin_left||profile?.margin_mm||5}mm`}
              </text>
              <text x={W-mrPx/2} y={mtPx+14} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">
                {profile?.duplex && (pageIdx+2)%2!==0 ? `Ext ${profile?.margin_left||profile?.margin_mm||5}mm` : `Int ${profile?.margin_right||profile?.margin_mm||5}mm`}
              </text>
              <text x={W/2} y={mtPx-3} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">↑ {profile?.margin_top||profile?.margin_mm||5}mm</text>
              <text x={W/2} y={H-mbPx+9} textAnchor="middle" fontSize={7} fill="rgba(100,140,200,0.6)" fontFamily="monospace">↓ {profile?.margin_bottom||profile?.margin_mm||5}mm</text>
            </svg>
          )
        })()}

        {(page?.items||[]).map((id,slotIdx)=>{
          const slot=id.slot||{x:0,y:0,w:100,h:100}
          const item=id.item
          const r=slotRect(slot,pw,ph,profile,scale,pageIdx+2)
          const panKey=`${pageIdx}_${slotIdx}`
          const transform=photoTransforms[panKey]||{x:50,y:50,zoom:1}
          const photoAR=item?.type==='photo'?photoAspects[item.asset_id]:null
          const mismatch=item?.type==='photo'&&isMismatch(photoAR,slot)
          const isPhotoEdit=editPhotoSlot===slotIdx
          const isMapEdit=editMapSlot===slotIdx
          const isDragSrc=dragFromIdx===slotIdx
          const isDragTgt=dragOverIdx===slotIdx
          const isCaptionEdit=editCaptionIdx===slotIdx
          const canDrag=!!item&&!isPhotoEdit&&!isMapEdit&&!isCaptionEdit
          const outlineColor=isPhotoEdit||isMapEdit?'#6a8fd8':mismatch?'#e05050':isDragTgt?'var(--gold)':'transparent'
          const outlineStyle=isDragTgt?'2px dashed':'3px solid'

          return (
            <div key={slotIdx}
              onClick={()=>{ if(item?.type==='photo'&&!isPhotoEdit&&!isCaptionEdit) onPhotoClick?.(item.asset_id) }}
              draggable={canDrag}
              onDragStart={e=>{if(!canDrag){e.preventDefault();return};setDragFromIdx(slotIdx)}}
              onDragEnd={()=>{setDragFromIdx(null);setDragOverIdx(null)}}
              onDragOver={e=>{
                e.preventDefault()
                // Accetta anche drag dal pannello album
                setDragOverIdx(slotIdx)
              }}
              onDragLeave={()=>setDragOverIdx(null)}
              onDrop={e=>{
                e.preventDefault()
                const extAssetId=e.dataTransfer.getData('asset_id')
                if(extAssetId) {
                  onDrop(pageIdx,slotIdx,extAssetId)
                } else if(dragFromIdx!=null) {
                  swapItems(dragFromIdx,slotIdx)
                }
                setDragFromIdx(null);setDragOverIdx(null)
              }}
              style={{
                position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,
                overflow:'hidden',boxSizing:'border-box',
                outline:`${outlineStyle} ${outlineColor}`,outlineOffset:'-3px',
                zIndex:isDragSrc||isDragTgt?5:isPhotoEdit?8:1,
              }}>

              {/* Empty slot — ＋ opens picker directly, ⋮ opens full menu */}
              {!item&&(
                <>
                  <div
                    style={{width:'100%',height:'100%',background:'#d0cdc6',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      cursor:'pointer',userSelect:'none'}}
                    onClick={e=>{ e.stopPropagation(); onOpenPicker(pageIdx,slotIdx) }}>
                    <span style={{fontSize:Math.max(10,Math.min(22,r.w*0.18)),color:'#999',
                      fontFamily:'var(--font-mono)',lineHeight:1,pointerEvents:'none'}}>＋</span>
                  </div>
                  <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                    e.stopPropagation()
                    const canRemove=page.items.length>1
                    openSlotMenu(e, tp.slotMenuEmpty, [
                      {icon:'📷', label:tp.choosePhoto, action:()=>{ onOpenPicker(pageIdx,slotIdx); setSlotMenu(null) }, color:'#d4aa5a'},
                      {icon:'💬', label:tp.addCaptionBtn, action:()=>{ onAddCaption(pageIdx,slotIdx); setSlotMenu(null) }, color:'#4a9edd'},
                      {icon:'🗺',  label:tp.slotAddMap,  action:()=>{ onAddMap?.(pageIdx,slotIdx); setSlotMenu(null) }, color:'#5dbd7a'},
                      ...(canRemove?[{icon:'✕', label:tp.removeSlot, action:()=>{ removeSlot(slotIdx); setSlotMenu(null) }, danger:true}]:[]),
                    ])
                  }}>⋮</button>
                </>
              )}

              {/* Photo */}
              {item?.type==='photo'&&(
                <PhotoSlot
                  item={item}
                  slotW={r.w} slotH={r.h}
                  transform={transform}
                  photoAR={photoAR}
                  isEditMode={isPhotoEdit}
                  mismatch={mismatch}
                  onEnterEdit={()=>setEditPhotoSlot(slotIdx)}
                  onExitEdit={()=>setEditPhotoSlot(null)}
                  originalTransform={item?.type==='photo'
                    ? (originalTransforms?.[panKey] ?? {x:50, y:50, zoom:1})
                    : null}
                  onTransformChange={t=>onTransformChange(panKey,t)}
                  onResetTransform={(origT)=>{
                    onTransformChange(panKey, origT || {x:50, y:50, zoom:1})
                  }}
                />
              )}

              {/* Favorite / description badges — bottom-left to avoid mismatch badge overlap */}
              {item?.type==='photo'&&!isPhotoEdit&&(()=>{
                const asset = assetById[item.asset_id]
                if (!asset) return null
                const isFav = asset.isFavorite
                const hasDesc = !!(asset.description || asset.exifInfo?.description)
                if (!isFav && !hasDesc) return null
                const sz = Math.max(8,Math.min(14,r.w*0.1))
                return (
                  <div style={{ position:'absolute', bottom:3, left:3, display:'flex', gap:2,
                    pointerEvents:'auto', zIndex:4 }}>
                    {isFav  && <span title={tp.favoriteTitle} style={{ fontSize:sz,
                      lineHeight:1, filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.8))', cursor:'default' }}>⭐</span>}
                    {hasDesc && <span title={tp.captionBadgeTitle} style={{ fontSize:sz,
                      lineHeight:1, filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.8))', cursor:'default' }}>💬</span>}
                  </div>
                )
              })()}

              {/* Photo location/date badges overlay */}
              {item?.type==='photo'&&!isPhotoEdit&&(item.badges||[]).length>0&&(()=>{
                const bc = profile?.badge_config || {}
                const pos = bc.position || 'bottom-right'
                const shape = bc.shape || 'rounded'
                const fs = Math.max(6, (bc.font_size || 10) * scale)
                const br = shape==='pill' ? 99 : shape==='rounded' ? 4 : 1
                return (item.badges||[]).map(badge=>(
                  <div key={badge.id}
                    style={{
                      position:'absolute',
                      ...(pos.includes('top') ? {top: 4*scale} : {bottom: 4*scale}),
                      ...(pos.includes('left') ? {left: 4*scale} : {right: 4*scale}),
                      display:'flex', alignItems:'center', gap: 2*scale,
                      background: bc.bg_color || 'rgba(0,0,0,0.55)',
                      color: bc.text_color || '#ffffff',
                      fontSize: fs,
                      padding: `${1.5*scale}px ${5*scale}px`,
                      borderRadius: br,
                      zIndex:5, pointerEvents:'auto',
                      whiteSpace:'nowrap',
                    }}>
                    <span style={{lineHeight:1}}>{badge.text}</span>
                    <button
                      onClick={e=>{ e.stopPropagation(); removeBadge(slotIdx, badge.id) }}
                      title={tp.removeBadge}
                      style={{ background:'none', border:'none', cursor:'pointer',
                        color: bc.text_color || '#ffffff', padding:0, fontSize: fs,
                        lineHeight:1, opacity:0.75, marginLeft: 2*scale }}>✕</button>
                  </div>
                ))
              })()}

              {/* ⋮ button — opens floating action menu for photo slot */}
              {item?.type==='photo'&&!isPhotoEdit&&(
                <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                  e.stopPropagation()
                  const hasBadgeData=!!(item._badge_date||item._badge_location)
                  openSlotMenu(e, tp.slotMenuPhoto, [
                    {icon:'🖐', label: mismatch ? tp.repositionMismatch : tp.reposition, action:()=>{ setEditPhotoSlot(slotIdx); setSlotMenu(null) }, color: mismatch?'#e05050':undefined},
                    ...(hasBadgeData?[{icon:'🏷', label:tp.addBadge, action:()=>{ addBadge(slotIdx); setSlotMenu(null) }}]:[]),
                    {icon:'🗺', label:tp.slotInsertMap, action:()=>{ onAddMap?.(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'🔄', label:tp.changePhoto, action:()=>{ onOpenPicker(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'💬', label:tp.addCaption, action:()=>{ onAddCaption(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'🗑️', label:tp.removePhoto, action:()=>{ removeItem(slotIdx); setSlotMenu(null) }, danger:true},
                    {icon:'⛔', label:tp.removePermFromAlbum, action:()=>{ const aid=item.asset_id; removeItem(slotIdx); onRemovePermanently?.(aid); setSlotMenu(null) }, danger:true},
                  ])
                }}>⋮</button>
              )}



              {/* Map */}
              {item?.type==='map'&&(
                <MapSlot
                  item={item} slotW={r.w} slotH={r.h}
                  transform={transform}
                  isEditMode={isMapEdit}
                  onEnterEdit={()=>setEditMapSlot(slotIdx)}
                  onExitEdit={()=>setEditMapSlot(null)}
                  onTransformChange={t=>onTransformChange(panKey,t)}
                  onResetTransform={()=>onTransformChange(panKey,{x:50,y:50,zoom:1})}/>
              )}
              {/* ⋮ button — opens floating action menu for map slot */}
              {item?.type==='map'&&!isMapEdit&&(
                <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                  e.stopPropagation()
                  openSlotMenu(e, tp.slotMenuMap, [
                    {icon:'🖐', label:tp.mapReposition, action:()=>{ setEditMapSlot(slotIdx); setSlotMenu(null) }},
                    {icon:'🔄', label:tp.mapRegenerate, action:()=>{ onAddMap?.(pageIdx,slotIdx); setSlotMenu(null) }},
                    {icon:'🗑️', label:tp.mapRemove, action:()=>{ removeItem(slotIdx); setSlotMenu(null) }, danger:true},
                  ])
                }}>⋮</button>
              )}

              {/* Caption */}
              {item?.type==='caption'&&(()=>{
                const profileCs = profile?.caption_style || {}
                const sessionCs = (() => { try { return JSON.parse(sessionStorage.getItem('pb_caption_style')||'{}') } catch { return {} } })()
                const cs = { ...profileCs, ...sessionCs, ...(item.caption_style||{}) }
                const font          = cs.font          || 'Georgia, serif'
                const size          = cs.size          || 13
                const color         = cs.color         || '#e8e6e0'
                const bg            = cs.bg            || '#111116'
                const align         = cs.align         || 'left'
                const valign        = cs.valign        || 'center'
                const italic        = cs.italic        !== false
                const bold          = cs.bold          || false
                const underline     = cs.underline     || false
                const lineHeight    = cs.lineHeight    || 1.55
                const letterSpacing = cs.letterSpacing || 0

                const setCs = (key, val) => {
                  try {
                    const cur = JSON.parse(sessionStorage.getItem('pb_caption_style')||'{}')
                    sessionStorage.setItem('pb_caption_style', JSON.stringify({...cur, [key]: val}))
                  } catch {}
                  updateCaption(slotIdx, undefined, {...(item.caption_style||{}), [key]: val})
                }

                const insertSymbol = (sym) => {
                  const ta = textareaRef.current
                  if (!ta) return
                  const start = ta.selectionStart, end = ta.selectionEnd
                  const newText = ta.value.substring(0, start) + sym + ta.value.substring(end)
                  updateCaption(slotIdx, newText)
                  requestAnimationFrame(() => {
                    if (textareaRef.current) {
                      textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + sym.length
                      textareaRef.current.focus()
                    }
                  })
                }

                // ── Toolbar helpers ──────────────────────────────────
                const TB = (active, extra={}) => ({
                  width:22, height:22, flexShrink:0, padding:0,
                  border:`1px solid ${active?'rgba(212,170,90,0.55)':'rgba(255,255,255,0.12)'}`,
                  borderRadius:4, cursor:'pointer',
                  background: active?'rgba(212,170,90,0.22)':'rgba(255,255,255,0.07)',
                  color: active?'#f0c040':'#ccc', fontSize:11,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  ...extra,
                })
                const SEP = { width:1, height:16, background:'rgba(255,255,255,0.1)', flexShrink:0, margin:'0 2px' }
                const TEXT_PRESETS = ['#ffffff','#f0ede6','#e8e4d0','#d4aa5a','#a8cfe8','#c8a0e8','#a8e0b0','#111116']
                const BG_PRESETS   = ['#111116','#13141a','#1a1a2e','#0a0a0e','transparent','#f0ece4','#2a1a0e','#1a2a1a']
                const FONTS = [
                  ['Georgia, serif',                     'Georgia'],
                  ['"Playfair Display", Georgia, serif',  'Playfair'],
                  ['"Helvetica Neue", Arial, sans-serif', 'Helvetica'],
                  ['Montserrat, Arial, sans-serif',       'Montserrat'],
                  ['"Courier New", monospace',            'Courier'],
                  ['var(--font-display)',                 'Display'],
                  ['var(--font-mono)',                    'Mono'],
                ]

                if (isCaptionEdit) return (
                  <>
                    {/* Floating toolbar — portal to document.body, unaffected by slot size */}
                    {createPortal(
                      <div style={{
                        position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
                        width:'min(calc(100vw - 24px), 720px)',
                        background:'rgba(10,10,18,0.96)', backdropFilter:'blur(18px)',
                        borderRadius:14, border:'1px solid rgba(255,255,255,0.1)',
                        boxShadow:'0 8px 48px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)',
                        zIndex:9999, overflow:'hidden',
                        userSelect:'none', WebkitUserSelect:'none',
                      }}>
                        {/* ── Main row ── */}
                        <div onMouseDown={e=>e.preventDefault()} style={{
                          display:'flex', gap:3, padding:'7px 10px', alignItems:'center', flexWrap:'wrap',
                        }}>
                          <span style={{fontSize:8,color:'rgba(255,255,255,0.28)',fontFamily:'var(--font-mono)',
                            letterSpacing:'0.08em',flexShrink:0,marginRight:1}}>DIDASCALIA</span>
                          <div style={SEP}/>

                          {/* Font family */}
                          <select value={font} onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('font',e.target.value)}
                            style={{height:26,fontSize:11,background:'rgba(255,255,255,0.07)',
                              border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,
                              color:'#ddd',padding:'0 4px',flexShrink:0,maxWidth:94,cursor:'pointer'}}>
                            {FONTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>

                          {/* Font size ± */}
                          <div style={{display:'flex',alignItems:'center',gap:1,flexShrink:0}}>
                            <button onMouseDown={e=>{e.preventDefault();setCs('size',Math.max(6,size-1))}}
                              style={TB(false,{width:24,height:26,borderRadius:5})}>−</button>
                            <input type="number" min={6} max={120} value={size}
                              onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('size',+e.target.value)}
                              style={{width:34,height:26,background:'rgba(255,255,255,0.07)',
                                border:'1px solid rgba(255,255,255,0.12)',borderRadius:5,
                                color:'#ddd',fontSize:11,textAlign:'center',padding:0}}/>
                            <button onMouseDown={e=>{e.preventDefault();setCs('size',Math.min(120,size+1))}}
                              style={TB(false,{width:24,height:26,borderRadius:5})}>+</button>
                          </div>

                          <div style={SEP}/>

                          {/* B I U */}
                          <button onMouseDown={e=>{e.preventDefault();setCs('bold',!bold)}}
                            style={TB(bold,{width:26,height:26,borderRadius:5,fontSize:13})}><b>B</b></button>
                          <button onMouseDown={e=>{e.preventDefault();setCs('italic',!italic)}}
                            style={TB(italic,{width:26,height:26,borderRadius:5,fontSize:13})}><i>I</i></button>
                          <button onMouseDown={e=>{e.preventDefault();setCs('underline',!underline)}}
                            style={TB(underline,{width:26,height:26,borderRadius:5,fontSize:13,textDecoration:'underline'})}>U</button>

                          <div style={SEP}/>

                          {/* Text align */}
                          {[['←','left'],['↔','center'],['→','right']].map(([icon,v])=>(
                            <button key={v} onMouseDown={e=>{e.preventDefault();setCs('align',v)}}
                              style={TB(align===v,{width:26,height:26,borderRadius:5,fontSize:14})} title={v}>{icon}</button>
                          ))}

                          <div style={SEP}/>

                          {/* Text color swatches + picker */}
                          <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0}}>T</span>
                          {TEXT_PRESETS.map(c=>(
                            <button key={c} onMouseDown={e=>{e.preventDefault();setCs('color',c)}} title={c}
                              style={{width:18,height:18,flexShrink:0,borderRadius:4,background:c,cursor:'pointer',padding:0,
                                border:color===c?'2px solid #f0c040':'1px solid rgba(255,255,255,0.18)'}}/>
                          ))}
                          <input type="color" value={color} onMouseDown={e=>e.stopPropagation()}
                            onChange={e=>setCs('color',e.target.value)}
                            style={{width:22,height:22,flexShrink:0,padding:1,
                              border:'1px solid rgba(255,255,255,0.12)',borderRadius:5,cursor:'pointer',background:'transparent'}}/>

                          <div style={SEP}/>

                          {/* Ω Simboli */}
                          <button onMouseDown={e=>{e.preventDefault();setShowSymbols(p=>!p);setCaptionToolbarMore(false)}}
                            style={TB(showSymbols,{width:28,height:26,borderRadius:5,fontSize:14})} title="Inserisci simbolo">Ω</button>

                          {/* ⋯ More */}
                          <button onMouseDown={e=>{e.preventDefault();setCaptionToolbarMore(p=>!p);setShowSymbols(false)}}
                            style={TB(captionToolbarMore,{width:28,height:26,borderRadius:5,fontSize:16})} title="Più opzioni">⋯</button>

                          {/* Push right */}
                          <div style={{marginLeft:'auto',display:'flex',gap:5,flexShrink:0,alignItems:'center'}}>
                            {/* Immich sync toggle */}
                            <button
                              onMouseDown={e=>{e.preventDefault();if(item.for_asset_id) setSyncToImmich(p=>!p)}}
                              title={item.for_asset_id ? (syncToImmich?'Sincronizzazione Immich attiva':'Sincronizzazione Immich disattivata') : 'Nessuna foto abbinata'}
                              style={TB(syncToImmich&&!!item.for_asset_id,{padding:'0 8px',width:'auto',height:26,fontSize:9,
                                whiteSpace:'nowrap',borderRadius:5,
                                opacity:item.for_asset_id?1:0.35,cursor:item.for_asset_id?'pointer':'default'})}>
                              {syncToImmich&&item.for_asset_id?'↑ Immich':'○ Immich'}
                            </button>
                            <button onMouseDown={e=>{e.preventDefault();if(syncToImmich) syncCaptionToImmich(slotIdx);setEditCaptionIdx(null)}}
                              style={{...TB(false),width:30,height:30,background:'rgba(212,170,90,0.2)',
                                color:'#f0c040',border:'1px solid rgba(212,170,90,0.4)',
                                fontSize:16,borderRadius:8}} title="Fine (Esc)">✓</button>
                          </div>
                        </div>

                        {/* ── Symbol picker row ── */}
                        {showSymbols&&(
                          <div onMouseDown={e=>e.preventDefault()} style={{
                            display:'flex', gap:2, padding:'6px 10px', alignItems:'center', flexWrap:'wrap',
                            background:'rgba(4,4,10,0.65)',
                            borderTop:'1px solid rgba(255,255,255,0.07)',
                          }}>
                            {['©','®','™','—','–','•','…','°','×','÷','±','√','≈','≠','≤','≥',
                              '←','→','↑','↓','↔','↕','«','»','„','"','"','\'','\'','‰','€','£','¥','¢',
                              '½','¼','¾','¹','²','³','α','β','γ','δ','∞','♥','★','☆','✓','✗'].map(sym=>(
                              <button key={sym} onMouseDown={e=>{e.preventDefault();insertSymbol(sym)}}
                                style={{width:26,height:26,flexShrink:0,borderRadius:4,cursor:'pointer',padding:0,
                                  background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',
                                  color:'#ddd',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                {sym}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* ── Extended row ── */}
                        {captionToolbarMore&&(
                          <div onMouseDown={e=>e.preventDefault()} style={{
                            display:'flex', gap:3, padding:'6px 10px', alignItems:'center', flexWrap:'wrap',
                            background:'rgba(4,4,10,0.65)',
                            borderTop:'1px solid rgba(255,255,255,0.07)',
                          }}>
                            {/* Vertical align */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0}}>V-align</span>
                            {[['↑','flex-start'],['↕','center'],['↓','flex-end']].map(([icon,v])=>(
                              <button key={v} onMouseDown={e=>{e.preventDefault();setCs('valign',v)}}
                                style={TB(valign===v,{width:26,height:26,borderRadius:5})}>{icon}</button>
                            ))}

                            <div style={SEP}/>

                            {/* Bg color */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0}}>BG</span>
                            {BG_PRESETS.map(c=>(
                              <button key={c} onMouseDown={e=>{e.preventDefault();setCs('bg',c)}} title={c==='transparent'?tp.transparentColor:c}
                                style={{width:18,height:18,flexShrink:0,borderRadius:4,cursor:'pointer',padding:0,
                                  background:c==='transparent'?'none':c,
                                  border:bg===c?'2px solid #f0c040':c==='transparent'?'1px dashed rgba(255,255,255,0.3)':'1px solid rgba(255,255,255,0.18)'}}/>
                            ))}
                            <input type="color" value={bg==='transparent'?'#000000':bg} onMouseDown={e=>e.stopPropagation()}
                              onChange={e=>setCs('bg',e.target.value)}
                              style={{width:22,height:22,flexShrink:0,padding:1,
                                border:'1px solid rgba(255,255,255,0.12)',borderRadius:5,cursor:'pointer',background:'transparent'}}/>

                            <div style={SEP}/>

                            {/* Line height */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0,whiteSpace:'nowrap'}}>↕ interlinea</span>
                            <input type="range" min={0.9} max={3} step={0.05} value={lineHeight}
                              onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('lineHeight',parseFloat(e.target.value))}
                              style={{width:80,accentColor:'#d4aa5a',flexShrink:0}}/>
                            <span style={{fontSize:10,color:'#bbb',width:30,textAlign:'right',flexShrink:0}}>{lineHeight.toFixed(2)}</span>

                            <div style={SEP}/>

                            {/* Letter spacing */}
                            <span style={{fontSize:9,color:'rgba(255,255,255,0.35)',flexShrink:0,whiteSpace:'nowrap'}}>↔ spaziatura</span>
                            <input type="range" min={-2} max={10} step={0.5} value={letterSpacing}
                              onMouseDown={e=>e.stopPropagation()} onChange={e=>setCs('letterSpacing',parseFloat(e.target.value))}
                              style={{width:80,accentColor:'#d4aa5a',flexShrink:0}}/>
                            <span style={{fontSize:10,color:'#bbb',width:30,textAlign:'right',flexShrink:0}}>{letterSpacing}px</span>
                          </div>
                        )}
                      </div>,
                      document.body
                    )}

                    {/* Slot content — full-height textarea, gold outline shows active state */}
                    <div style={{width:'100%',height:'100%',background:bg,
                      outline:'2px solid rgba(212,170,90,0.55)',outlineOffset:'-2px'}}>
                      <textarea ref={textareaRef} autoFocus value={item.text||''}
                        onChange={e=>updateCaption(slotIdx, e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Escape'){ if(syncToImmich) syncCaptionToImmich(slotIdx); setEditCaptionIdx(null) } }}
                        style={{
                          width:'100%', height:'100%', background:'transparent',
                          border:'none', outline:'none', resize:'none', boxSizing:'border-box',
                          color, fontFamily:font, fontStyle:italic?'italic':'normal',
                          fontWeight:bold?'bold':'normal',
                          textDecoration:underline?'underline':'none',
                          fontSize:size, lineHeight, letterSpacing:letterSpacing?`${letterSpacing}px`:undefined,
                          padding:Math.max(6,r.w*0.04), textAlign:align,
                        }}/>
                    </div>
                  </>
                )

                // View mode
                return (
                  <div style={{width:'100%',height:'100%',background:bg,
                    display:'flex',alignItems:valign,
                    justifyContent:align==='left'?'flex-start':align==='right'?'flex-end':'center',
                    padding:Math.max(8,r.w*0.05),
                    cursor:'text'}}
                    onClick={()=>setEditCaptionIdx(slotIdx)}>
                    <span style={{color,fontFamily:font,fontStyle:italic?'italic':'normal',
                      fontWeight:bold?'bold':'normal',
                      textDecoration:underline?'underline':'none',
                      fontSize:size,textAlign:align,lineHeight,
                      letterSpacing:letterSpacing?`${letterSpacing}px`:undefined,
                      overflow:'hidden',display:'-webkit-box',
                      WebkitLineClamp:Math.max(2,Math.floor(r.h/((size||13)*(lineHeight||1.6)))),
                      WebkitBoxOrient:'vertical'}}>
                      {item.text||<span style={{opacity:0.32}}>{tp.captionPlaceholder}</span>}
                    </span>
                    <button className="slot-menu-btn" title="Azioni" onClick={e=>{
                      e.stopPropagation()
                      openSlotMenu(e, tp.slotMenuCaption, [
                        {icon:'✏️', label:tp.editCaption, action:()=>{ setEditCaptionIdx(slotIdx); setSlotMenu(null) }},
                        {icon:'🗑️', label:tp.captionRemove, action:()=>{ removeItem(slotIdx); setSlotMenu(null) }, danger:true},
                      ])
                    }}>⋮</button>
                  </div>
                )
              })()}
            </div>
          )
        })}

        {/* Slot dividers */}
        <SlotDividers items={page.items} pw={pw} ph={ph} profile={profile} scale={scale} pageNum={pageIdx+2}
          onUpdateItems={newItems=>onUpdatePage({...page,items:newItems,page_type_id:'custom',
            page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}})}/>
      </div>
      )}
    </div>

    {/* ── Floating slot action menu (portal, outside page canvas) ── */}
    {slotMenu && createPortal(
      (()=>{
        const VH=window.innerHeight, VW=window.innerWidth
        const menuH=32+slotMenu.items.length*46, menuW=200
        const fitsBelow=slotMenu.y+menuH<VH-12
        const top=fitsBelow?slotMenu.y:slotMenu.yAbove-menuH
        const left=Math.max(8,Math.min(slotMenu.x-menuW/2, VW-menuW-8))
        const arrowLeft=slotMenu.x-left
        return (
          <div data-slot-menu="1" style={{
            position:'fixed', top, left, width:menuW, zIndex:9900,
            background:'#1e2028', border:'1px solid #353840',
            borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.7)',
            overflow:'hidden',
          }}>
            {/* Arrow */}
            <div style={{position:'absolute',
              ...(fitsBelow
                ? {top:-6, borderBottom:'6px solid #353840'}
                : {bottom:-6, borderTop:'6px solid #353840'}),
              left:Math.max(10,Math.min(arrowLeft-6,menuW-22)),
              width:0,height:0,
              borderLeft:'6px solid transparent',borderRight:'6px solid transparent'}}/>
            <div style={{padding:'6px 8px',borderBottom:'1px solid #2a2d35',
              fontSize:10,color:'#6b7080',fontFamily:'var(--font-mono)',textAlign:'center',
              letterSpacing:'0.06em',textTransform:'uppercase'}}>
              {slotMenu.title}
            </div>
            {slotMenu.items.map(({icon,label,action,color,danger})=>{
              // Strip leading emoji/symbol from label when icon already shows it
              const displayLabel = icon ? label.replace(/^[^a-zA-ZÀ-ÖØ-öø-ÿ\d]+/, '').trim() : label
              return (
              <button key={label} onClick={action} style={{
                display:'flex',alignItems:'center',gap:10,width:'100%',padding:'11px 14px',
                background:'none',border:'none',cursor:'pointer',textAlign:'left',
                color: danger?'#e05050':'#e8e5de',
                fontSize:13,fontFamily:'var(--font-body)',
                borderBottom:'1px solid #2a2d35',transition:'background 0.12s'}}
                onMouseEnter={e=>e.currentTarget.style.background=danger?'rgba(224,80,80,0.08)':'rgba(255,255,255,0.05)'}
                onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <span style={{fontSize:18,lineHeight:1}}>{icon}</span>
                <span style={{fontWeight:500,color:color||(danger?'#e05050':'inherit')}}>{displayLabel}</span>
              </button>
            )})}
          </div>
        )
      })(),
      document.body
    )}
    </>
  )
}
