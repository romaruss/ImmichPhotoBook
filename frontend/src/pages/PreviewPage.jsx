import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useT } from '../i18n.jsx'
import { DEFAULT_COVER_CONFIG, DEFAULT_COVER_FRONT, DEFAULT_COVER_INSIDE, DEFAULT_COVER_BACK, DEFAULT_SPINE, migrateCoverConfig, calcSpineWidthMm } from '../components/CoverConfig'
import CoverEditorModal from '../components/CoverEditorModal'
import LogViewer from '../components/LogViewer'
import { DividerCanvas, DividerEditorModal, migrateDividerStyle } from '../components/DividerEditor'
import ExportModal from '../components/ExportModal'
import ProjectModal from '../components/ProjectModal'
import RecalcMenu from '../components/RecalcMenu'
import { getPageDims, marginsForPage, slotRect, isMismatch, photoStyle } from '../utils/pageGeometry'
import MiniPage from '../components/preview/MiniPage'
import PhotoPickerModal from '../components/preview/PhotoPickerModal'
import AlbumPanel from '../components/preview/AlbumPanel'
import EditablePage, { autoNameSlots } from '../components/preview/EditablePage'
import CoverSpreadPage from '../components/preview/CoverSpreadPage'
import { BlankPage, makeBlankPage, ensureEvenPages } from '../components/preview/BlankPage'
import SpineStrip from '../components/preview/SpineStrip'

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PreviewPage({ devTools = false }) {
  const t = useT(); const tp = t.preview
  const navigate=useNavigate()
  const [layout,setLayout]=useState(null)
  const [currentPage,setCurrentPage]=useState(-1)
  const [photoAspects,setPhotoAspects]=useState({})
  const [photoTransforms,setPhotoTransforms]=useState({})  // key → {x,y,zoom}
  const originalTransformsRef = useRef({})  // immutable copy of algo-computed transforms
  const [photoPicker,setPhotoPicker]=useState(null)
  const [albumAssets,setAlbumAssets]=useState([])
  const [allAlbumAssets,setAllAlbumAssets]=useState([])
  const [mapUrl,setMapUrl]=useState(null)
  const [dividerMapUrls,setDividerMapUrls]=useState({})
  const [exporting,setExporting]=useState(false)
  const [recalculating,setRecalculating]=useState(false)
  const [logViewerOpen,setLogViewerOpen]=useState(false)
  const [toast,setToast]=useState(null)
  const [hasChanges,setHasChanges]=useState(false)
  const [recalcMenuOpen,setRecalcMenuOpen]=useState(false)
  const [projectModal,setProjectModal]=useState(null)  // null | 'save' | 'load'
  const [lastAutoSave,setLastAutoSave]=useState(null)
  const autoSaveTimerRef = useRef(null)
  const [profileMismatch,setProfileMismatch]=useState(null)   // {apiProfile, changes:{margini,formato}}
  const [profileApply,setProfileApply]=useState({margini:true,formato:false})
  const liveLayoutRef = useRef(null)
  const liveTransformsRef = useRef(null)
  const livePageRef = useRef(null)
  const recalcBtnRef = useRef(null)
  const sidebarListRef = useRef(null)
  const [panelOpen,setPanelOpen]=useState(()=>{try{return JSON.parse(localStorage.getItem('pb_panelOpen'))??true}catch{return true}})
  const [draggedAsset,setDraggedAsset]=useState(null)
  const [spreadView,setSpreadView]=useState(()=>{try{const v=localStorage.getItem('pb_spreadView');return v!==null?JSON.parse(v):true}catch{return true}})
  const [viewZoom,setViewZoom]=useState(1.0)
  const zoomStep=0.10
  const zoomMin=0.3
  const zoomMax=2.5
  const canvasAreaRef=useRef(null)
  const previewMainRef=useRef(null)
  const wheelHandlerRef=useRef(null)
  const [pageScaleBase,setPageScaleBase]=useState(0.8)   // single-page auto-fit scale
  const [spreadScaleBase,setSpreadScaleBase]=useState(0.6) // two-page spread auto-fit scale
  const [sidebarDrag,setSidebarDrag]=useState(null)
  const [leftSidebarOpen,setLeftSidebarOpen]=useState(true)
  const [coverEditOpen,setCoverEditOpen]=useState(false)  // false | tab-index 0-4
  const [exportModalOpen,setExportModalOpen]=useState(false)
  const [exportSettings,setExportSettings]=useState(null)
  const [highlightedAsset,setHighlightedAsset]=useState(null)  // asset_id highlighted in right panel
  const highlightRef=useRef(null)  // ref to highlighted element in AlbumPanel

  useEffect(() => {
    const stored = sessionStorage.getItem('photobook_layout')
    if (!stored) return
    let data = JSON.parse(stored)
    if (data.pages) {
      data = { ...data, pages: data.pages.map(pg => pg.items ? pg : {...pg, items: []}) }
    }
    if (data.pages && data.pages.length % 2 === 1) {
      data = { ...data, pages: ensureEvenPages(data.pages, data.profile) }
    }
    setLayout(data)
    // Load face-aware transforms from smart layout (if any)
    const storedTransforms = sessionStorage.getItem('photobook_transforms')
    if (storedTransforms) {
      try {
        const t = JSON.parse(storedTransforms)
        setPhotoTransforms(t)
        // Snapshot the algorithm-computed transforms — used by "ripristina" button
        originalTransformsRef.current = t
      } catch {}
    }
    if (data.locations?.length)
      axios.post('/api/map',{locations:data.locations, map_style: data.profile?.map_style||{}},{responseType:'blob'})
        .then(r=>setMapUrl(URL.createObjectURL(r.data))).catch(()=>{})
    // Per-divider album map URLs
    if (data.pages) {
      const mapStyle = data.profile?.map_style || {}
      data.pages.forEach((pg, idx) => {
        if (!pg._album_divider) return
        const locs = pg._album_info?.locations
        if (!locs?.length) return
        axios.post('/api/map', { locations:locs, map_style:mapStyle }, { responseType:'blob' })
          .then(r => setDividerMapUrls(prev => ({ ...prev, [idx]: URL.createObjectURL(r.data) })))
          .catch(() => {})
      })
    }
    // Profile mismatch check: compare embedded profile with current API profile
    if (data.profile?.id) {
      axios.get(`/api/profiles/${data.profile.id}`).then(r => {
        const api = r.data
        const cur = data.profile
        const marginiChanged = ['margin_mm','margin_top','margin_right','margin_bottom','margin_left']
          .some(f => (api[f]??null) !== (cur[f]??null))
        const formatoChanged = ['page_size','orientation']
          .some(f => (api[f]??null) !== (cur[f]??null))
        if (marginiChanged || formatoChanged) {
          setProfileMismatch({ apiProfile: api, changes: { margini:marginiChanged, formato:formatoChanged } })
          setProfileApply({ margini: marginiChanged, formato: false })
        }
      }).catch(()=>{})
    }

    const sortAssets = arr => [...(arr||[])].sort((a,b)=>(a.localDateTime||'').localeCompare(b.localDateTime||''))
    if (data._multi_album && data._album_ids?.length) {
      Promise.all(data._album_ids.map(id=>axios.get(`/api/albums/${id}`)))
        .then(results=>{
          const perAlbum = results.map(r=>sortAssets(r.data.assets))
          setAllAlbumAssets(perAlbum)
          setAlbumAssets(perAlbum.flat())
        }).catch(()=>{})
    } else if (data.album?.id) {
      axios.get(`/api/albums/${data.album.id}`)
        .then(r=>{ const s=sortAssets(r.data.assets); setAlbumAssets(s); setAllAlbumAssets([s]) }).catch(()=>{})
    }
  },[])

  // Sync sidebar page list to current page
  useEffect(() => {
    if (!sidebarListRef.current) return
    const active = sidebarListRef.current.querySelector('.page-thumb-item.active')
    if (active) active.scrollIntoView({ behavior:'smooth', block:'nearest' })
  }, [currentPage])

  // Keep live refs in sync (avoid stale closures in auto-save interval)
  useEffect(()=>{ liveLayoutRef.current = layout },[layout])
  useEffect(()=>{ liveTransformsRef.current = photoTransforms },[photoTransforms])
  useEffect(()=>{ livePageRef.current = currentPage },[currentPage])
  useEffect(()=>{ setExportSettings(null) },[layout?.profile])

  // Auto-save every 5 minutes to the currently open project (or a new draft)
  useEffect(()=>{
    if (!layout) return
    autoSaveTimerRef.current = setInterval(async () => {
      const lo = liveLayoutRef.current
      if (!lo) return
      const pid  = sessionStorage.getItem('photobook_project_id')
      const pname = sessionStorage.getItem('photobook_project_name') || `Bozza — ${lo.album?.albumName || 'progetto'}`
      const payload = {
        name: pname,
        album: lo.album,
        profile: lo.profile,
        pages: lo.pages,
        locations: lo.locations || [],
        photo_transforms: liveTransformsRef.current || {},
        current_page: livePageRef.current ?? 0,
      }
      try {
        if (pid) {
          await axios.put(`/api/projects/${pid}`, payload)
        } else {
          const res = await axios.post('/api/projects', payload)
          sessionStorage.setItem('photobook_project_id', res.data.id)
          sessionStorage.setItem('photobook_project_name', pname)
        }
        setLastAutoSave(new Date())
      } catch {}
    }, 5 * 60 * 1000)
    return () => clearInterval(autoSaveTimerRef.current)
  }, [!!layout])  // restart only when layout goes null↔loaded

  // Stable page dims as dep keys (safe when layout=null → defaults)
  const _pageSize=layout?.profile?.page_size??'20x30'
  const _orientation=layout?.profile?.orientation??'portrait'

  // Shared scale computation — called from useLayoutEffect, ResizeObserver and 100% button
  const computeScaleBases=useCallback(()=>{
    const el=canvasAreaRef.current
    if(!el) return
    const rect=el.getBoundingClientRect()
    if(!rect.width||!rect.height) return
    const [pw,ph]=getPageDims(layout?.profile)
    const availW=Math.max(80,rect.width-16)
    const availH=Math.max(80,rect.height-52)
    setPageScaleBase(Math.max(0.05,Math.min(availW/pw,availH/ph)))
    setSpreadScaleBase(Math.max(0.05,Math.min((availW-12)/(2*pw),availH/ph)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[_pageSize,_orientation])

  // Synchronous measurement before first paint — prevents 100% flicker on load
  useLayoutEffect(()=>{
    computeScaleBases()
  },[!!layout,computeScaleBases])

  // ResizeObserver for window resize / sidebar collapse / panel toggle
  useEffect(()=>{
    const el=canvasAreaRef.current
    if(!el) return
    const ro=new ResizeObserver(computeScaleBases)
    ro.observe(el)
    return()=>ro.disconnect()
  },[!!layout,computeScaleBases])

  // Native wheel listener (passive:false required for preventDefault)
  // Update ref each render so handler always sees latest state
  wheelHandlerRef.current = {spreadView, layout, setCurrentPage, setViewZoom, zoomMin, zoomMax}
  useEffect(()=>{
    const el=previewMainRef.current
    if(!el) return
    const handler=e=>{
      const {spreadView,layout,setCurrentPage,setViewZoom,zoomMin,zoomMax}=wheelHandlerRef.current
      let node=e.target
      while(node&&node!==el){
        const s=window.getComputedStyle(node)
        if(s.position==='fixed'||s.position==='sticky') return
        const oy=s.overflowY
        if((oy==='auto'||oy==='scroll'||oy==='overlay')&&
           node.scrollHeight>node.clientHeight+2&&
           ((e.deltaY>0&&node.scrollTop<node.scrollHeight-node.clientHeight-2)||
            (e.deltaY<0&&node.scrollTop>0))) return
        node=node.parentElement
      }
      e.preventDefault()
      if(e.ctrlKey){
        const delta=e.deltaY>0?-0.05:0.05
        setViewZoom(z=>Math.max(zoomMin,Math.min(zoomMax,+(z+delta).toFixed(2))))
        return
      }
      if(e.deltaY>0){
        setCurrentPage(p=>{
          if(spreadView&&p>=0&&p<(layout?.pages?.length??0)){const l=p%2===0?p-1:p;return Math.min(layout.pages.length,l+2)}
          return Math.min((layout?.pages?.length??0),p+1)
        })
      } else {
        setCurrentPage(p=>{
          if(spreadView&&p>=0){const l=p%2===0?p-1:p;return l===1?0:Math.max(-1,l-2)}
          return Math.max(-1,p-1)
        })
      }
    }
    el.addEventListener('wheel',handler,{passive:false})
    return ()=>el.removeEventListener('wheel',handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[!!layout])

  // Detect aspect ratios
  useEffect(()=>{
    if(!layout) return
    const seen=new Set()
    layout.pages.forEach(pg=>(pg.items||[]).forEach(id=>{
      const item=id.item
      if(item?.type==='photo'&&!photoAspects[item.asset_id]&&!seen.has(item.asset_id)){
        seen.add(item.asset_id)
        const img=new Image()
        img.onload=()=>setPhotoAspects(prev=>({...prev,[item.asset_id]:img.naturalWidth/img.naturalHeight}))
        img.src=`/api/thumb/${item.asset_id}?size=preview&t=${item._updated_at||''}`
      }
    }))
  },[layout])

  // Keyboard navigation
  useEffect(()=>{
    const onKey=e=>{
      if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT') return
      if(!layout) return
      if(e.key==='ArrowRight'||e.key==='ArrowDown') setCurrentPage(p=>{
        if(spreadView&&p>=0&&p<layout.pages.length){const l=p%2===0?p-1:p;return Math.min(layout.pages.length,l+2)}
        return Math.min(layout.pages.length,p+1)
      })
      if(e.key==='ArrowLeft'||e.key==='ArrowUp') setCurrentPage(p=>{
        if(spreadView&&p>=0){const l=p%2===0?p-1:p;return Math.max(-1,l-2)}
        return Math.max(-1,p-1)
      })
    }
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[layout])

  // Compute usage map AND which pages each asset appears on
  const usageMap   = {}
  const usagePages = {}  // assetId → [pageIdx, ...]
  if(layout) {
    layout.pages.forEach((pg, pi) => (pg.items||[]).forEach(id => {
      if(id.item?.type==='photo') {
        const aid = id.item.asset_id
        usageMap[aid]   = (usageMap[aid]   || 0) + 1
        usagePages[aid] = [...(usagePages[aid] || []), pi]
      }
    }))
  }

  const assetById = useMemo(() => Object.fromEntries(albumAssets.map(a=>[a.id,a])), [albumAssets])

  const persist=(nl)=>{sessionStorage.setItem('photobook_layout',JSON.stringify(nl));return nl}

  const applyProfileChanges=()=>{
    if(!profileMismatch) return
    const api=profileMismatch.apiProfile
    const np={...layout.profile}
    if(profileApply.margini)
      ['margin_mm','margin_top','margin_right','margin_bottom','margin_left']
        .forEach(f=>{ np[f]=api[f] })
    if(profileApply.formato)
      ['page_size','orientation']
        .forEach(f=>{ np[f]=api[f] })
    setLayout(prev=>persist({...prev,profile:np}))
    setHasChanges(true)
    setProfileMismatch(null)
  }

  const updatePage=useCallback((idx,newPage)=>{
    setLayout(prev=>{const pages=[...prev.pages];pages[idx]=newPage;return persist({...prev,pages})})
    setHasChanges(true)
  },[])

  const removePermanently=useCallback((assetId)=>{
    setLayout(prev=>{
      const perm=[...new Set([...(prev.permanently_removed||[]),assetId])]
      return persist({...prev,permanently_removed:perm})
    })
    setHasChanges(true)
  },[])

  // ── Page management ──────────────────────────────────────────────────────────
  const addPage = (afterIdx) => {
    // Add a blank page with the first available page type (or single slot)
    const profile = layout?.profile || {}
    const pts = profile.page_types || []
    const defaultPT = pts[0] || {id:'blank',label:'Vuota',slots:[{x:0,y:0,w:100,h:100}]}
    const newPage = {
      page_type_id: defaultPT.id,
      page_type: defaultPT,
      items: defaultPT.slots.map(slot=>({slot,item:null}))
    }
    setLayout(prev=>{
      const pages=[...prev.pages]
      pages.splice(afterIdx+1,0,newPage)
      return persist({...prev,pages:ensureEvenPages(pages,prev.profile)})
    })
    setCurrentPage(afterIdx+1)
    setHasChanges(true)
  }

  const removePage = (idx) => {
    if (!confirm(tp.confirmRemovePage)) return
    setLayout(prev=>{
      const pages=ensureEvenPages(prev.pages.filter((_,i)=>i!==idx),prev.profile)
      return persist({...prev,pages})
    })
    setCurrentPage(p=>Math.max(-1,Math.min(p,layout.pages.length-2)))
    setHasChanges(true)
  }

  const movePage = (fromIdx, toIdx) => {
    if (fromIdx===toIdx) return
    setLayout(prev=>{
      const pages=[...prev.pages]
      const [moved]=pages.splice(fromIdx,1)
      pages.splice(toIdx,0,moved)
      return persist({...prev,pages})
    })
    setCurrentPage(toIdx)
    setHasChanges(true)
  }

  const onTransformChange=useCallback((panKey,t)=>{
    setPhotoTransforms(prev=>{
      const next={...prev,[panKey]:t}
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
  },[])

  const onSwapTransforms=useCallback((keyA,keyB)=>{
    setPhotoTransforms(prev=>{
      const tA=prev[keyA]||{x:50,y:50,zoom:1}
      const tB=prev[keyB]||{x:50,y:50,zoom:1}
      const next={...prev,[keyA]:tB,[keyB]:tA}
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
  },[])

  const onSlotRemoved=useCallback((pgIdx, removedSlotIdx, oldCount)=>{
    setPhotoTransforms(prev=>{
      const next={...prev}
      delete next[`${pgIdx}_${removedSlotIdx}`]
      for(let i=removedSlotIdx+1;i<oldCount;i++){
        const key=`${pgIdx}_${i}`
        if(next[key]!==undefined){
          next[`${pgIdx}_${i-1}`]=next[key]
          delete next[key]
        }
      }
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
  },[])

  const openPicker=useCallback((pageIdx,slotIdx)=>{
    const albumIdx=layout?.pages[pageIdx]?._album_idx ?? 0
    setPhotoPicker({pageIdx,slotIdx,albumIdx})
  },[layout])

  const [mapPickerSlot, setMapPickerSlot] = useState(null)
  const [mapNPages, setMapNPages]           = useState('all')

  const doAddMap = useCallback(async(pageIdx, slotIdx, nPages) => {
    const allLocations = layout?.locations || []
    if (!allLocations.length) { alert('Nessun dato GPS disponibile per questo album'); return }
    const locations = (nPages === 'all' || isNaN(parseInt(nPages)))
      ? allLocations
      : allLocations.slice(0, Math.max(1, Math.min(parseInt(nPages) * 5, allLocations.length)))
    try {
      const r = await axios.post('/api/map', { locations, map_style: layout?.profile?.map_style || {} }, { responseType:'blob' })
      const mapUrl = URL.createObjectURL(r.data)
      const mapItem = { type:'map', _map_url: mapUrl, _n_pages: nPages }
      setLayout(prev=>{
        const pages = prev.pages.map((pg,pi)=>pi!==pageIdx?pg:{
          ...pg, items: pg.items.map((id,si)=>si!==slotIdx?id:{...id, item:mapItem})
        })
        return persist({...prev, pages})
      })
      setHasChanges(true)
    } catch(e) { alert('Errore generazione mappa: ' + e.message) }
    setMapPickerSlot(null)
  },[layout])

  const addMapToSlot=useCallback((pageIdx,slotIdx)=>{
    setMapPickerSlot({pageIdx,slotIdx})
    setMapNPages('all')
  },[])

  // Drop from album panel onto slot
  const handleDropFromPanel=useCallback((pageIdx,slotIdx,assetId)=>{
    const asset=albumAssets.find(a=>a.id===assetId)
    if(!asset) return
    const exif=asset.exifInfo||{}
    const desc=(exif.description||asset.description||'').trim()
    const photoItem={type:'photo',asset_id:asset.id,description:desc,
      originalFileName:asset.originalFileName||'',localDateTime:asset.localDateTime||'',
      exif,has_caption:!!desc,_updated_at:asset.updatedAt||''}
    setLayout(prev=>{
      const pages=prev.pages.map((pg,pi)=>pi!==pageIdx?pg:{
        ...pg,items:pg.items.map((id,si)=>si!==slotIdx?id:{...id,item:photoItem})
      })
      return persist({...prev,pages})
    })
    // Reset transform for this slot so new photo starts centered
    setPhotoTransforms(prev=>{
      const next={...prev}
      delete next[`${pageIdx}_${slotIdx}`]
      sessionStorage.setItem('photobook_transforms', JSON.stringify(next))
      return next
    })
    setHasChanges(true)
  },[albumAssets])

  const onPhotoSelected=useCallback((asset)=>{
    if(!photoPicker||!layout) return
    const {pageIdx,slotIdx}=photoPicker
    handleDropFromPanel(pageIdx,slotIdx,asset.id)
    setPhotoPicker(null)
  },[photoPicker,layout,handleDropFromPanel])

  const addCaption=useCallback((pageIdx,slotIdx)=>{
    setLayout(prev=>{
      const page=prev.pages[pageIdx]; const items=page.items
      const item=items[slotIdx].item
      const captionItem={type:'caption',text:item?.description||'',for_asset_id:item?.asset_id||'',originalFileName:item?.originalFileName||''}
      let newItems
      if(!item){
        // Empty slot: convert it directly to caption
        newItems=items.map((id,i)=>i===slotIdx?{...id,item:captionItem}:id)
      } else {
        const emptyIdx=items.findIndex((id,i)=>i!==slotIdx&&!id.item)
        if(emptyIdx>=0){
          newItems=items.map((id,i)=>i===emptyIdx?{...id,item:captionItem}:id)
        } else {
          const slot=items[slotIdx].slot
          const photoSlot={...slot,h:parseFloat((slot.h*0.68).toFixed(2))}
          const capSlot={x:slot.x,y:parseFloat((slot.y+slot.h*0.68).toFixed(2)),w:slot.w,h:parseFloat((slot.h*0.32).toFixed(2))}
          newItems=items.map((id,i)=>i===slotIdx?{slot:photoSlot,item:id.item}:id)
          newItems.push({slot:capSlot,item:captionItem})
        }
      }
      const newPages=prev.pages.map((pg,pi)=>pi!==pageIdx?pg:{
        ...pg,items:newItems,page_type_id:'custom',
        page_type:{id:'custom',label:'Custom',slots:newItems.map(i=>i.slot)}
      })
      return persist({...prev,pages:newPages})
    })
    setHasChanges(true)
  },[])

  // ── Helper: collect photo items from a page range (deduplicated) ──────────
  const collectPhotos = (pages, from, to) => {
    const items=[], seen=new Set()
    pages.slice(from, to).forEach(pg=>(pg.items||[]).forEach(id=>{
      const it=id.item
      if(it?.type==='photo'&&!seen.has(it.asset_id)){seen.add(it.asset_id);items.push(it)}
    }))
    return items
  }

  // ── Helper: greedy orientation swap within one page ─────────────────────
  const optimizePageOrientation = (page, aspects) => {
    const items = page.items.map(id=>({...id}))
    const pIdx = items.map((id,i)=>id.item?.type==='photo'?i:-1).filter(i=>i>=0)
    if(pIdx.length<=1) return page
    const score = arr => pIdx.reduce((s,i)=>{
      const ar=aspects[arr[i].item?.asset_id]; return s+(isMismatch(ar,arr[i].slot)?1:0)},0)
    let cur=items, improved=true
    while(improved){
      improved=false
      for(let a=0;a<pIdx.length;a++) for(let b=a+1;b<pIdx.length;b++){
        const ai=pIdx[a],bi=pIdx[b]
        const sw=cur.map((id,i)=>i===ai?{...id,item:cur[bi].item}:i===bi?{...id,item:cur[ai].item}:id)
        if(score(sw)<score(cur)){cur=sw;improved=true}
      }
    }
    return {...page,items:cur}
  }

  // ── 1. Consolida fino alla pagina corrente, ricalcola il resto ──────────────
  //    - Blocca pagine 0..currentPage (inclusa)
  //    - Copertine e divisori DOPO currentPage restano intatti (posizione preservata)
  //    - Pagine fotografiche successive vengono ricostruite con le opzioni originali
  //    - Reinserisce foto tolte dall'utente (non quelle rimosse definitivamente o
  //      escluse dall'algoritmo per qualità/duplicati)
  const recalcFromNext=async()=>{
    const lockUntil=Math.max(0,currentPage)
    setRecalculating(true)
    try{
      const lockedPages=layout.pages.slice(0,lockUntil+1)
      const restPages  =layout.pages.slice(lockUntil+1)

      const isProtected=pg=>!!(pg._album_cover||pg._album_divider||pg._album_separator)

      // Foto già nelle pagine bloccate → da escludere
      const lockedIds=new Set()
      lockedPages.forEach(pg=>(pg.items||[]).forEach(id=>{
        if(id.item?.type==='photo') lockedIds.add(id.item.asset_id)
      }))

      // Foto rimosse definitivamente dall'utente → non reinserire
      const permRemovedIds=new Set(layout.permanently_removed||[])

      // Foto escluse dall'algoritmo (qualità, duplicati) → non reinserire
      const excludedIds=new Set((layout.excluded_photos||[]).map(e=>e.asset_id))

      // Foto dalle pagine fotografiche del resto (non protette)
      const photoRestPages=restPages.filter(pg=>!isProtected(pg))
      const restPhotos=collectPhotos(photoRestPages,0)
      const seenInRest=new Set(restPhotos.map(p=>p.asset_id))

      // Foto dell'album non nelle pagine bloccate, non rimosse definitivamente,
      // non escluse dall'algoritmo, non già presenti nel resto
      const unusedPhotos=albumAssets
        .filter(a=>(a.type||'IMAGE').toUpperCase()!=='VIDEO')
        .filter(a=>!lockedIds.has(a.id)&&!permRemovedIds.has(a.id)&&!excludedIds.has(a.id)&&!seenInRest.has(a.id))
        .map(asset=>{
          const exif=asset.exifInfo||{}
          const desc=(exif.description||asset.description||'').trim()
          return{type:'photo',asset_id:asset.id,description:desc,
            originalFileName:asset.originalFileName||'',
            localDateTime:asset.localDateTime||'',exif,has_caption:!!desc,_updated_at:asset.updatedAt||''}
        })

      // Pool finale: foto dal resto + foto non usate; dedup
      const seenFinal=new Set()
      const photoItems=[...restPhotos,...unusedPhotos].filter(p=>{
        if(seenFinal.has(p.asset_id)) return false
        seenFinal.add(p.asset_id); return true
      })

      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'info');return}

      const r=await axios.post('/api/layout/recalculate',{
        photo_items:photoItems,
        profile_id:layout.profile.id,
        gen_config:layout.gen_config||{},
      })

      // Interleave: mantieni le pagine protette nelle loro posizioni originali
      const newRecalcPages=(r.data.pages||[]).map(pg=>({...pg,items:pg.items||[]}))
      let rIdx=0
      const newRestPages=[]
      for(const pg of restPages){
        if(isProtected(pg)){
          newRestPages.push(pg)
        } else {
          if(rIdx<newRecalcPages.length) newRestPages.push(newRecalcPages[rIdx++])
          // se il ricalcolo restituisce meno pagine, la pagina viene eliminata
        }
      }
      // Eventuali pagine ricalcolate in eccesso → append
      while(rIdx<newRecalcPages.length) newRestPages.push(newRecalcPages[rIdx++])

      setLayout(prev=>persist({...prev,pages:[...lockedPages,...newRestPages],page_logs:null}))
      setHasChanges(false)
      showToast(tp.recalcToasts.fromNext(lockUntil+1),'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 2. Ricalcola solo questa pagina ─────────────────────────────────────────
  const recalcThisPage=async()=>{
    if(currentPage<0) return
    setRecalculating(true)
    try{
      const photoItems=collectPhotos([layout.pages[currentPage]],0)
      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'error');return}
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const pages=[...prev.pages]
        pages.splice(currentPage,1,...r.data.pages)
        return persist({...prev,pages})
      })
      showToast(tp.recalcToasts.thisPage,'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 3. Comprimi pagine con slot vuoti ───────────────────────────────────────
  const recalcCompress=async()=>{
    const fromIdx=Math.max(0,currentPage)
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,fromIdx)
      if(!photoItems.length){showToast(tp.recalcToasts.noPhotos,'error');return}
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>{
        const locked=prev.pages.slice(0,fromIdx)
        return persist({...prev,pages:[...locked,...r.data.pages],page_logs:null})
      })
      showToast(tp.recalcToasts.compress,'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── 4. Ricomincia tutto da zero ──────────────────────────────────────────────
  const recalcAll=async()=>{
    if(!window.confirm(tp.recalcConfirmAll)) return
    setRecalculating(true)
    try{
      const photoItems=collectPhotos(layout.pages,0)
      const r=await axios.post('/api/layout/recalculate',{photo_items:photoItems,profile_id:layout.profile.id})
      setLayout(prev=>persist({...prev,pages:r.data.pages,page_logs:null}))
      setHasChanges(false);setCurrentPage(0)
      showToast(tp.recalcToasts.all,'success')
    }catch{showToast(tp.recalcToasts.recalcError,'error')}
    finally{setRecalculating(false)}
  }

  // ── Salva layout custom nel profilo ─────────────────────────────────────────
  const saveCustomLayout = async (slots) => {
    if (!layout?.profile) return
    const ori = layout.profile.orientation || 'portrait'
    const newPT = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      label: autoNameSlots(slots, ori),
      pref: 'any',
      slots: slots.map(s => ({...s})),
    }
    const updatedProfile = {
      ...layout.profile,
      page_types: [...(layout.profile.page_types || []), newPT],
    }
    try {
      await axios.put(`/api/profiles/${layout.profile.id}`, updatedProfile)
      setLayout(prev => persist({ ...prev, profile: updatedProfile }))
      showToast(`Layout "${newPT.label}" salvato nel profilo`, 'success')
    } catch {
      showToast('Errore salvataggio layout', 'error')
    }
  }

  // ── Dispatcher ───────────────────────────────────────────────────────────────
  const handleRecalcAction = (id) => {
    setRecalcMenuOpen(false)
    const map={
      from_next: recalcFromNext,
      this_page: recalcThisPage,
      compress:  recalcCompress,
      full:      recalcAll,
    }
    map[id]?.()
  }

  const exportBook=async(format='pdf', quality='hires', settingsOverride=null)=>{
    if(!layout) return; setExporting(true)
    try{
      const baseCover = layout.profile?.cover || {}
      const coverOverride = settingsOverride ? {
        ...baseCover,
        cover_paper_gsm:       settingsOverride.cover_paper_gsm,
        spine_width_mm:        settingsOverride.spine_width_mm,
        export_as_spread:      settingsOverride.export_as_spread,
        export_cover_separate: settingsOverride.export_cover_separate,
      } : (baseCover || null)
      const profileOverride = settingsOverride ? {
        body_paper_gsm: settingsOverride.body_paper_gsm,
        export_dpi:     settingsOverride.export_dpi,
        color_profile:  settingsOverride.color_profile,
        crop_marks:     settingsOverride.crop_marks,
      } : null
      const isCoverSeparate = settingsOverride?.export_cover_separate ?? baseCover?.export_cover_separate
      const r=await axios.post('/api/export',{
        album_id:layout.album.id,
        profile_id:layout.profile.id,
        pages:layout.pages,
        locations:layout.locations||[],
        photo_transforms:photoTransforms,
        cover_override:coverOverride,
        profile_override:profileOverride,
        format,
        quality,
      },{responseType:'blob'})
      const url=URL.createObjectURL(r.data)
      const a=document.createElement('a');a.href=url
      const ext = format==='svg' ? '_svg.zip' : isCoverSeparate ? '_export.zip' : '.pdf'
      a.download=`${layout.album.albumName||'fotolibro'}${ext}`
      a.click(); URL.revokeObjectURL(url)
      showToast(format==='svg'?tp.svgDownloaded:tp.pdfDownloaded,'success')
    }catch(e){
      if(e?.response?.status !== 499) showToast(tp.exportError,'error')
    }
    finally{setExporting(false)}
  }

  const showToast=(msg,type)=>{setToast({msg,type});setTimeout(()=>setToast(null),4000)}

  // Load a project from the modal
  const handleProjectLoad = (projectData) => {
    setLayout({
      album:     projectData.album,
      profile:   projectData.profile,
      pages:     projectData.pages,
      locations: projectData.locations || [],
    })
    if (projectData.photo_transforms) {
      setPhotoTransforms(projectData.photo_transforms)
      originalTransformsRef.current = projectData.photo_transforms
    }
    setCurrentPage(projectData.current_page ?? 0)
    setHasChanges(false)
    // reload album assets for the picker
    if (projectData.album?.id)
      axios.get(`/api/albums/${projectData.album.id}`)
        .then(r=>setAlbumAssets([...(r.data.assets||[])].sort((a,b)=>(a.localDateTime||'').localeCompare(b.localDateTime||'')))).catch(()=>{})
  }

  if(!layout) return(
    <div className="empty-state" style={{padding:'80px 40px'}}>
      <div className="icon">📖</div>
      <h3>{tp.noLayout}</h3>
      <p>{tp.noLayoutHint}</p>
      <button className="btn btn-primary mt-4" onClick={()=>navigate('/albums')}>{tp.goToAlbums}</button>
    </div>
  )

  const {album,profile,pages}=layout
  const allPageTypes=profile?.page_types||[]

  const [_pw,_ph]=getPageDims(profile)
  // Cover/quarta are always single-page even when spreadView=true
  const _isSpreadPage=spreadView&&currentPage>=0&&currentPage<pages.length
  const pageScale=Math.max(0.05,(_isSpreadPage?spreadScaleBase:pageScaleBase)*viewZoom)

  return(
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>

      {/* ── Left sidebar: page list ── */}
      <div className="preview-sidebar" style={{
        width: leftSidebarOpen ? 200 : 38,
        transition:'width 0.2s ease',
        overflow:'hidden',
        flexShrink:0,
        position:'relative',
      }}>
        {/* Collapse toggle — always visible */}
        <button
          onClick={()=>setLeftSidebarOpen(o=>!o)}
          title={leftSidebarOpen ? tp.collapseLeft : tp.expandLeft}
          style={{
            position:'absolute', right:0, top:'50%', transform:'translateY(-50%)',
            width:16, height:48,
            background:'var(--bg3)', border:'1px solid var(--border)', borderLeft:'none',
            borderRadius:'0 5px 5px 0', cursor:'pointer', zIndex:10,
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--text3)', fontSize:12,
          }}>
          {leftSidebarOpen ? '‹' : '›'}
        </button>

        {/* Full content — hidden when collapsed */}
        {leftSidebarOpen && (<>
        <div className="preview-sidebar-header">
          <h3 style={{fontFamily:'var(--font-display)',fontWeight:300,fontSize:16,marginBottom:2}}>{album.albumName}</h3>
          <p className="text-xs text-muted font-mono">{tp.pages(pages.length)} · {tp.photoCount(album.assetCount)}</p>
          <p className="text-xs text-muted" style={{marginTop:2}}>{tp.keyboard}</p>
          {/* Save / Load project */}
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <button className="btn" style={{flex:1,fontSize:10,justifyContent:'center',padding:'6px 4px'}}
              onClick={()=>setProjectModal('save')} title={tp.saveProjectTitle}>
              {tp.saveBtn}
            </button>
            <button className="btn" style={{flex:1,fontSize:10,justifyContent:'center',padding:'6px 4px'}}
              onClick={()=>setProjectModal('load')} title={tp.openProjectTitle2}>
              {tp.openBtn}
            </button>
          </div>
          {lastAutoSave && (
            <p style={{fontSize:9,color:'var(--text3)',textAlign:'center',marginTop:3,fontFamily:'var(--font-mono)'}}>
              ⏱ {lastAutoSave.toLocaleTimeString(t.albums.localeDateLocale,{hour:'2-digit',minute:'2-digit'})}
            </p>
          )}
          {/* Recalculate menu */}
          <div style={{position:'relative',marginTop:8}}>
            <button ref={recalcBtnRef} className="btn w-full" style={{fontSize:11,justifyContent:'space-between'}}
              onClick={()=>setRecalcMenuOpen(o=>!o)} disabled={recalculating}>
              <span>{recalculating?<><span className="spinner" style={{width:11,height:11}}/> {tp.recalcBusy}</>:tp.recalcBtn}</span>
              <span style={{opacity:0.5,fontSize:10}}>{recalcMenuOpen?'▲':'▼'}</span>
            </button>
            {recalcMenuOpen && !recalculating && (
              <RecalcMenu
                anchorRef={recalcBtnRef}
                currentPage={currentPage}
                totalPages={layout?.pages?.length||0}
                busy={recalculating}
                onAction={handleRecalcAction}
                onClose={()=>setRecalcMenuOpen(false)}
              />
            )}
          </div>
          {devTools && layout?.page_logs?.length > 0 && (
            <button className="btn w-full" style={{fontSize:11,marginTop:6}}
              onClick={()=>setLogViewerOpen(true)}>
              {tp.logBtn}
            </button>
          )}
        </div>
        <div ref={sidebarListRef} style={{flex:1,overflowY:'auto',padding:'8px 8px 0'}}>
          {/* Copertina fronte thumb */}
          <div className={`page-thumb-item${currentPage===-1?' active':''}`} onClick={()=>setCurrentPage(-1)}
            style={{outline:currentPage===-1?'2px solid #4ac585':'none',outlineOffset:'-2px'}}>
            <span className="page-num">C</span>
            {(()=>{
              const [pw,ph]=getPageDims(profile)
              const isL=profile?.orientation==='landscape'
              const tw=isL?44:28, th=isL?28:40
              const cover=migrateCoverConfig(layout.profile?.cover,layout.profile?.cover_style)
              const bg=(cover.front||DEFAULT_COVER_FRONT).bg||'#0a0a0e'
              return <div style={{width:tw,height:th,background:bg,borderRadius:2,flexShrink:0}}/>
            })()}
            <span className="text-xs text-muted">{tp.panelFront}</span>
          </div>

          {/* Page thumbs — draggable for reorder */}
          {pages.map((page,idx)=>(
            <div key={idx}
              draggable
              onDragStart={e=>{e.dataTransfer.setData('page-idx',String(idx));setSidebarDrag(idx)}}
              onDragEnd={()=>setSidebarDrag(null)}
              onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}}
              onDrop={e=>{
                e.preventDefault()
                const fromIdx=parseInt(e.dataTransfer.getData('page-idx'),10)
                if(!isNaN(fromIdx)&&fromIdx!==idx) movePage(fromIdx,idx)
                setSidebarDrag(null)
              }}
              className={`page-thumb-item${currentPage===idx?' active':''}`}
              style={{
                opacity: sidebarDrag===idx ? 0.45 : 1,
                cursor:'grab',
                outline: currentPage===idx ? '2px solid #4ac585' : 'none',
                outlineOffset: '-2px',
              }}
              onClick={()=>setCurrentPage(idx)}>
              <span className="page-num">{idx+1}</span>
              <MiniPage page={page} profile={profile} scale={0.052}/>
              <div style={{flex:1,minWidth:0}}>
                <p className="text-xs" style={{color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {page.page_type?.label||tp.pageFallback}
                </p>
                <p className="text-xs text-muted">
                  {(page.items||[]).filter(i=>i.item?.type==='photo').length}📷 {(page.items||[]).filter(i=>i.item?.type==='caption').length}💬 {(page.items||[]).filter(i=>!i.item).length}○
                </p>
              </div>
              {/* Per-page actions */}
              <div style={{display:'flex',flexDirection:'column',gap:2,flexShrink:0}}>
                <button
                  title={tp.addPageHint}
                  onClick={e=>{e.stopPropagation();addPage(idx)}}
                  style={{width:16,height:16,background:'none',border:'1px solid var(--border)',
                    borderRadius:3,cursor:'pointer',fontSize:10,color:'var(--text3)',lineHeight:1,
                    display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
                {pages.length>1&&(
                  <button
                    title={tp.removePageHint}
                    onClick={e=>{e.stopPropagation();removePage(idx)}}
                    style={{width:16,height:16,background:'none',border:'1px solid var(--border)',
                      borderRadius:3,cursor:'pointer',fontSize:10,color:'#e05050',lineHeight:1,
                      display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
                )}
              </div>
            </div>
          ))}

          {/* Add page at end */}
          <div
            style={{margin:'6px 0 6px',padding:'6px 8px',borderRadius:6,border:'1px dashed var(--border)',
              cursor:'pointer',display:'flex',alignItems:'center',gap:6,
              color:'var(--text3)',fontSize:11,
            }}
            onClick={()=>addPage(pages.length-1)}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--gold)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <span style={{fontSize:14}}>+</span>
            <span>{tp.addPageHint}</span>
          </div>

          {/* Quarta di copertina thumb */}
          <div className={`page-thumb-item${currentPage===pages.length?' active':''}`}
            onClick={()=>setCurrentPage(pages.length)}
            style={{marginBottom:8,outline:currentPage===pages.length?'2px solid #4ac585':'none',outlineOffset:'-2px'}}>
            <span className="page-num">Q</span>
            {(()=>{
              const [pw,ph]=getPageDims(profile)
              const isL=profile?.orientation==='landscape'
              const tw=isL?44:28, th=isL?28:40
              const cover=migrateCoverConfig(layout.profile?.cover,layout.profile?.cover_style)
              const bg=(cover.back||DEFAULT_COVER_BACK).bg||'#0a0a0e'
              return <div style={{width:tw,height:th,background:bg,borderRadius:2,flexShrink:0}}/>
            })()}
            <span className="text-xs text-muted">{tp.panelBack}</span>
          </div>
        </div>
        <div style={{padding:'8px 12px',borderTop:'1px solid var(--border)',flexShrink:0}}>
          <button className="btn btn-primary w-full" style={{justifyContent:'center',fontSize:12}}
            onClick={()=>setExportModalOpen(true)} disabled={exporting}>
            {exporting ? <><span className="spinner" style={{width:12,height:12}}/> {tp.exporting}</> : tp.exportBtn}
          </button>
        </div>
        {exportModalOpen && (
          <ExportModal layout={layout} onExport={exportBook} exporting={exporting}
            onClose={()=>setExportModalOpen(false)}
            externalSettings={exportSettings} onSettingsChange={setExportSettings}/>
        )}

        </>)}
      </div>

      {/* ── Main canvas ── */}
      <div ref={previewMainRef} className="preview-main" style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0,alignItems:'stretch',padding:0,gap:0}}>
        {/* Profile mismatch banner */}
        {profileMismatch && (
          <div style={{
            display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
            padding:'8px 14px', background:'rgba(212,170,50,0.12)',
            borderBottom:'1px solid rgba(212,170,50,0.35)', flexShrink:0,
          }}>
            <span style={{fontSize:12,color:'var(--gold)',fontWeight:500,flexShrink:0}}>⚠ Profilo modificato</span>
            <span style={{fontSize:11,color:'var(--text2)',flex:1,minWidth:160}}>
              Le impostazioni del profilo di stampa sono cambiate. Applica le modifiche selezionate mantenendo pagine e foto.
            </span>
            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              {profileMismatch.changes.margini && (
                <label style={{display:'flex',gap:5,alignItems:'center',fontSize:12,cursor:'pointer',color:'var(--text)'}}>
                  <input type="checkbox" checked={profileApply.margini}
                    onChange={e=>setProfileApply(p=>({...p,margini:e.target.checked}))}/>
                  Margini
                </label>
              )}
              {profileMismatch.changes.formato && (
                <label style={{display:'flex',gap:5,alignItems:'center',fontSize:12,cursor:'pointer',color:'var(--text)'}}>
                  <input type="checkbox" checked={profileApply.formato}
                    onChange={e=>setProfileApply(p=>({...p,formato:e.target.checked}))}/>
                  Formato pagina
                </label>
              )}
              <button className="btn btn-sm btn-primary" style={{fontSize:11,padding:'3px 12px'}}
                disabled={!profileApply.margini&&!profileApply.formato}
                onClick={applyProfileChanges}>Applica</button>
              <button className="btn btn-sm" style={{fontSize:11,padding:'3px 8px'}}
                onClick={()=>setProfileMismatch(null)}>✕ Ignora</button>
            </div>
          </div>
        )}

        {/* Top bar: prev/next + spread toggle + add/remove page — one compact line */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'6px 12px', flexShrink:0, gap:6,
          borderBottom:'1px solid var(--border)', background:'var(--bg2)',
        }}>
          <button className="btn btn-ghost" style={{fontSize:12,padding:'4px 10px'}}
            onClick={()=>{
              if(currentPage===pages.length){
                // From quarta: go to last body page (or last spread in spread mode)
                setCurrentPage(pages.length-1)
              } else if(spreadView&&currentPage>=0){
                // In spread: step back by 2 (to prev pair), snap to odd index (left of pair).
                // l===1 means "spread 1" → go to spread 0 (currentPage=0, divider), not cover.
                const leftIdx=currentPage%2===0?currentPage-1:currentPage
                setCurrentPage(leftIdx===1?0:Math.max(-1,leftIdx-2))
              } else {
                setCurrentPage(p=>Math.max(-1,p-1))
              }
            }} disabled={currentPage<=-1}>{tp.prevBtn}</button>

          <div style={{display:'flex',alignItems:'center',gap:6,flex:1,justifyContent:'center'}}>
            <span className="text-sm font-mono text-muted" style={{minWidth:90,textAlign:'center'}}>
              {currentPage===-1?tp.coverFronte:currentPage===pages.length?tp.coverQuarta:tp.pageOf(currentPage+1, pages.length)}
            </span>
            {/* View zoom */}
            <div style={{display:'flex',gap:2,alignItems:'center',background:'var(--bg3)',borderRadius:5,padding:'2px 6px',border:'1px solid var(--border)'}}>
              <button onClick={()=>setViewZoom(z=>Math.max(zoomMin,+(z-zoomStep).toFixed(2)))}
                style={{padding:'1px 6px',border:'none',background:'transparent',cursor:'pointer',fontSize:14,color:'var(--text)',lineHeight:1}}
                title={tp.zoomOut}>−</button>
              <span onClick={()=>{setViewZoom(1);computeScaleBases()}} title={tp.resetZoom}
                style={{fontSize:10,fontFamily:'monospace',color:'var(--text2)',minWidth:34,textAlign:'center',cursor:'pointer'}}>
                {Math.round(viewZoom*100)}%</span>
              <button onClick={()=>setViewZoom(z=>Math.min(zoomMax,+(z+zoomStep).toFixed(2)))}
                style={{padding:'1px 6px',border:'none',background:'transparent',cursor:'pointer',fontSize:14,color:'var(--text)',lineHeight:1}}
                title={tp.zoomIn}>+</button>
            </div>
            {/* Spread / Single toggle */}
            <div style={{display:'flex',gap:1,background:'var(--bg3)',borderRadius:5,padding:2,border:'1px solid var(--border)'}}>
              <button onClick={()=>{setSpreadView(false);localStorage.setItem('pb_spreadView','false')}} title={tp.singlePageTitle}
                style={{padding:'2px 7px',borderRadius:3,border:'none',cursor:'pointer',fontSize:12,
                  background:!spreadView?'var(--bg)':'transparent',
                  color:!spreadView?'var(--text)':'var(--text3)'}}>□</button>
              <button onClick={()=>{setSpreadView(true);localStorage.setItem('pb_spreadView','true')}} title={tp.spreadTitle}
                style={{padding:'2px 7px',borderRadius:3,border:'none',cursor:'pointer',fontSize:12,
                  background:spreadView?'var(--bg)':'transparent',
                  color:spreadView?'var(--text)':'var(--text3)'}}>□□</button>
            </div>
            {/* +Pag and Elim always rendered for stable toolbar width;
                disabled/grey on cover/quarta pages so layout doesn't shift */}
            <button className="btn btn-sm"
              style={{fontSize:10,padding:'2px 8px',
                opacity: currentPage>=0&&currentPage<pages.length ? 1 : 0.3,
                pointerEvents: currentPage>=0&&currentPage<pages.length ? 'auto' : 'none'}}
              title={currentPage>=0&&currentPage<pages.length ? tp.addPageHint : tp.notOnCover}
              onClick={()=>currentPage>=0&&currentPage<pages.length&&addPage(currentPage)}>{tp.addPage}</button>
            <button className="btn btn-sm"
              style={{fontSize:10,padding:'2px 8px',
                background: currentPage>=0&&currentPage<pages.length&&pages.length>1 ? 'rgba(197,74,74,0.12)' : 'var(--bg3)',
                borderColor: currentPage>=0&&currentPage<pages.length&&pages.length>1 ? 'rgba(197,74,74,0.4)' : 'var(--border)',
                color: currentPage>=0&&currentPage<pages.length&&pages.length>1 ? '#e05050' : 'var(--text3)',
                opacity: currentPage>=0&&currentPage<pages.length&&pages.length>1 ? 1 : 0.3,
                pointerEvents: currentPage>=0&&currentPage<pages.length&&pages.length>1 ? 'auto' : 'none'}}
              title={currentPage>=0&&currentPage<pages.length&&pages.length>1 ? tp.removePageHint : tp.notOnCover}
              onClick={()=>currentPage>=0&&currentPage<pages.length&&pages.length>1&&removePage(currentPage)}>{tp.removePage}</button>
          </div>

          <button className="btn btn-ghost" style={{fontSize:12,padding:'4px 10px'}}
            onClick={()=>{
              if(spreadView&&currentPage>=0&&currentPage<pages.length){
                // In spread: step forward by 2 (to next pair), snap to odd index
                const leftIdx=currentPage%2===0?currentPage-1:currentPage
                setCurrentPage(Math.min(pages.length,leftIdx+2))
              } else {
                setCurrentPage(p=>Math.min(pages.length,p+1))
              }
            }} disabled={currentPage>=pages.length}>{tp.nextBtn}</button>
        </div>

        {/* Canvas area: getBoundingClientRect (border-box) gives stable dims unaffected by scrollbars */}
        <div ref={canvasAreaRef} style={{flex:1,overflow:'auto',display:'flex',alignItems:'flex-start',justifyContent:'flex-start',padding:'16px 8px',minHeight:0,minWidth:0}}>

        {(currentPage===-1||currentPage===pages.length)?(
          /* ── Copertina fronte (−1) or Quarta di copertina (pages.length) ── */
          (()=>{
            const [pw,ph] = getPageDims(layout.profile)
            const coverW  = Math.round(pw * pageScale)
            const coverH  = Math.round(ph * pageScale)
            const cover   = migrateCoverConfig(layout.profile?.cover, layout.profile?.cover_style)
            const pw_mm   = pw / 2.835
            const spMm    = cover.spine_width_mm ?? calcSpineWidthMm(pages.length, layout.profile?.body_paper_gsm ?? 90)
            const spW     = Math.max(6, Math.round(coverW * spMm / pw_mm))
            const albumYear = album.dateRange ? album.dateRange.slice(-4) : String(new Date().getFullYear())
            const albumInfo = { albumName:album.albumName, assetCount:album.assetCount, dateRange:album.dateRange }
            const isFronte  = currentPage === -1
            const coverStyle = isFronte ? (cover.front || DEFAULT_COVER_FRONT) : (cover.back || DEFAULT_COVER_BACK)
            const spine     = cover.spine || DEFAULT_SPINE
            return (
              <div style={{margin:'auto',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
                <div style={{display:'flex',flexDirection:'row',alignItems:'stretch',gap:0,
                  boxShadow:'0 16px 64px rgba(0,0,0,0.55)',borderRadius:2,overflow:'hidden',
                  cursor:'pointer'}}
                  onClick={()=>setCoverEditOpen(isFronte ? 0 : 3)}>
                  {/* Dorso a sinistra per fronte, a destra per quarta */}
                  {isFronte && (
                    <SpineStrip spine={spine} albumName={album.albumName} albumYear={albumYear}
                      widthPx={spW} heightPx={coverH}/>
                  )}
                  <DividerCanvas
                    style={coverStyle}
                    albumInfo={albumInfo}
                    canvasW={coverW} canvasH={coverH}
                    readOnly
                    dividerMapUrl={mapUrl}/>
                  {!isFronte && (
                    <SpineStrip spine={spine} albumName={album.albumName} albumYear={albumYear}
                      widthPx={spW} heightPx={coverH}/>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {isFronte ? tp.coverFronte : tp.coverQuarta}
                  {' · '}{tp.coverSpineEstimated(spMm)}
                </p>
                <p className="text-xs text-muted">{tp.coverClickToEdit}</p>
              </div>
            )
          })()
        ) : spreadView ? (
          /* ── Spread view: 2 pages side by side, fill available space ── */
          (() => {
            const cover   = migrateCoverConfig(layout.profile?.cover, layout.profile?.cover_style)
            const leftIdx  = currentPage % 2 === 0 ? currentPage - 1 : currentPage
            const rightIdx = leftIdx + 1
            const leftPage  = leftIdx >= 0 ? pages[leftIdx]  : null
            const rightPage = rightIdx < pages.length ? pages[rightIdx] : null
            const isSeconda = leftIdx < 0
            const isTerza   = rightIdx >= pages.length
            const albumInfo = { albumName:album.albumName, assetCount:album.assetCount, dateRange:album.dateRange }
            return (
              <div style={{margin:'auto',display:'flex',gap:12,alignItems:'flex-start'}}>
                {/* Left page */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}
                  onPointerDownCapture={()=>setCurrentPage(leftIdx)}>
                  {leftPage ? (
                    <EditablePage
                      page={leftPage} pageIdx={leftIdx}
                      profile={profile} allPageTypes={allPageTypes}
                      photoAspects={photoAspects} photoTransforms={photoTransforms}
                      originalTransforms={originalTransformsRef.current}
                      onTransformChange={onTransformChange}
                      onSwapTransforms={onSwapTransforms}
                      onSlotRemoved={onSlotRemoved}
                      onUpdatePage={p=>updatePage(leftIdx,p)}
                      onOpenPicker={openPicker} onAddCaption={addCaption}
                      onDrop={handleDropFromPanel}
                      onPhotoClick={aid=>{ setHighlightedAsset(aid); if(!panelOpen) setPanelOpen(true) }}
                      onAddMap={addMapToSlot}
                      isActive={currentPage===leftIdx} zoomFactor={viewZoom} fixedScale={pageScale}
                      dividerMapUrl={dividerMapUrls[leftIdx]}
                      assets={allAlbumAssets[leftPage?._album_idx??0]??albumAssets}
                      assetById={assetById}
                      onSaveCustomLayout={saveCustomLayout}
                      onRemovePermanently={removePermanently}/>
                  ) : (
                    <CoverSpreadPage
                      coverStyle={cover.inside_front||DEFAULT_COVER_INSIDE}
                      albumInfo={albumInfo}
                      profile={profile} allPageTypes={allPageTypes}
                      dividerMapUrl={mapUrl}
                      fixedScale={pageScale}
                      onClick={()=>setCoverEditOpen(1)}/>
                  )}
                  {leftPage
                    ? <p className="text-xs text-muted mt-1">{tp.pageFallback} {leftIdx+1}</p>
                    : <><p className="text-xs text-muted mt-1">{tp.coverSeconda}</p><p className="text-xs text-muted">{tp.coverClickToEdit}</p></>}
                </div>
                {/* Right page */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}
                  onPointerDownCapture={()=>setCurrentPage(rightIdx)}>
                  {rightPage ? (
                    <EditablePage
                      page={rightPage} pageIdx={rightIdx}
                      profile={profile} allPageTypes={allPageTypes}
                      photoAspects={photoAspects} photoTransforms={photoTransforms}
                      originalTransforms={originalTransformsRef.current}
                      onTransformChange={onTransformChange}
                      onSwapTransforms={onSwapTransforms}
                      onSlotRemoved={onSlotRemoved}
                      onUpdatePage={p=>updatePage(rightIdx,p)}
                      onOpenPicker={openPicker} onAddCaption={addCaption}
                      onDrop={handleDropFromPanel}
                      onPhotoClick={aid=>{ setHighlightedAsset(aid); if(!panelOpen) setPanelOpen(true) }}
                      onAddMap={addMapToSlot}
                      isActive={currentPage===rightIdx} zoomFactor={viewZoom} fixedScale={pageScale}
                      dividerMapUrl={dividerMapUrls[rightIdx]}
                      assets={allAlbumAssets[rightPage?._album_idx??0]??albumAssets}
                      assetById={assetById}
                      onSaveCustomLayout={saveCustomLayout}
                      onRemovePermanently={removePermanently}/>
                  ) : (
                    <CoverSpreadPage
                      coverStyle={cover.inside_back||DEFAULT_COVER_INSIDE}
                      albumInfo={albumInfo}
                      profile={profile} allPageTypes={allPageTypes}
                      dividerMapUrl={mapUrl}
                      fixedScale={pageScale}
                      onClick={()=>setCoverEditOpen(2)}/>
                  )}
                  {rightPage
                    ? <p className="text-xs text-muted mt-1">{tp.pageFallback} {rightIdx+1}</p>
                    : <><p className="text-xs text-muted mt-1">{tp.coverTerza}</p><p className="text-xs text-muted">{tp.coverClickToEdit}</p></>}
                </div>
              </div>
            )
          })()
        ):(
          <div style={{margin:'auto',width:Math.round(_pw*pageScale)}}>
          <EditablePage
            page={pages[currentPage]}
            pageIdx={currentPage}
            profile={profile}
            allPageTypes={allPageTypes}
            photoAspects={photoAspects}
            photoTransforms={photoTransforms}
            originalTransforms={originalTransformsRef.current}
            onTransformChange={onTransformChange}
            onSwapTransforms={onSwapTransforms}
            onSlotRemoved={onSlotRemoved}
            onUpdatePage={p=>updatePage(currentPage,p)}
            onOpenPicker={openPicker}
            onAddCaption={addCaption}
            onDrop={handleDropFromPanel}
            onPhotoClick={aid=>{ setHighlightedAsset(aid); if(!panelOpen) setPanelOpen(true) }}
            onAddMap={addMapToSlot}
            isActive={true} zoomFactor={viewZoom} fixedScale={pageScale}
            dividerMapUrl={dividerMapUrls[currentPage]}
            assets={allAlbumAssets[pages[currentPage]?._album_idx??0]??albumAssets}
            assetById={assetById}
            onSaveCustomLayout={saveCustomLayout}
            onRemovePermanently={removePermanently}
          />
          </div>
        )}
        </div>{/* end canvas area */}
      </div>

      {/* ── Right panel: album photos ── */}
      <AlbumPanel
        assets={albumAssets}
        presorted={allAlbumAssets.length > 1}
        usageMap={usageMap}
        usagePages={usagePages}
        open={panelOpen}
        onToggle={()=>setPanelOpen(o=>{localStorage.setItem('pb_panelOpen',!o);return !o})}
        onDragStart={setDraggedAsset}
        onNavigate={pi=>setCurrentPage(pi)}
        highlightedAsset={highlightedAsset}
        onClearHighlight={()=>setHighlightedAsset(null)}
        excludedPhotos={layout?.excluded_photos || []}
        permanentlyRemoved={layout?.permanently_removed || []}
      />

      {photoPicker&&(
        <PhotoPickerModal assets={albumAssets} usageMap={usageMap}
          allAlbumAssets={allAlbumAssets}
          albumIdx={photoPicker?.albumIdx ?? 0}
          albumNames={layout?._album_names}
          onSelect={onPhotoSelected} onClose={()=>setPhotoPicker(null)}/>
      )}

      {mapPickerSlot&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,
          display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={()=>setMapPickerSlot(null)}>
          <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:10,
            padding:24,minWidth:300,maxWidth:400,boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}
            onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 16px',fontSize:15}}>🗺 Inserisci mappa GPS</h3>
            <label style={{fontSize:12,color:'var(--text2)',display:'block',marginBottom:10}}>
              Pagine da coprire
            </label>
            <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="radio" name="mapNPages" checked={mapNPages==='all'}
                  onChange={()=>setMapNPages('all')}/>
                Tutto l'album
              </label>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="radio" name="mapNPages" checked={mapNPages!=='all'}
                  onChange={()=>setMapNPages(mapNPages==='all'?'10':mapNPages)}/>
                Prime
                <input type="number" min={1} max={999} value={mapNPages==='all'?'':mapNPages}
                  disabled={mapNPages==='all'}
                  onChange={e=>setMapNPages(e.target.value||'1')}
                  onClick={()=>{ if(mapNPages==='all') setMapNPages('10') }}
                  style={{width:60,padding:'2px 6px',background:'var(--bg3)',
                    border:'1px solid var(--border)',color:'var(--text)',borderRadius:4,fontSize:13}}/>
                pagine
              </label>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button className="btn" onClick={()=>setMapPickerSlot(null)}>Annulla</button>
              <button className="btn btn-primary"
                onClick={()=>doAddMap(mapPickerSlot.pageIdx,mapPickerSlot.slotIdx,mapNPages)}>
                Inserisci mappa
              </button>
            </div>
          </div>
        </div>
      )}

      {projectModal && (
        <ProjectModal
          mode={projectModal}
          layout={layout}
          photoTransforms={photoTransforms}
          currentPage={currentPage}
          onClose={()=>setProjectModal(null)}
          onLoad={handleProjectLoad}
        />
      )}

      {toast&&<div className={`toast ${toast.type}`}>{toast.msg}</div>}
  {devTools && logViewerOpen && layout?.page_logs?.length > 0 && (
    <LogViewer
      pageLogs={layout.page_logs}
      excludedPhotos={layout.excluded_photos || []}
      currentPage={currentPage - 1}
      onNavigate={(idx)=>{ setCurrentPage(idx + 1) }}
      onClose={()=>setLogViewerOpen(false)}
    />
  )}
  {coverEditOpen !== false && (
    <CoverEditorModal
      cover={layout.profile?.cover}
      onChange={newCover=>{
        setLayout(prev=>persist({...prev,profile:{...prev.profile,cover:newCover}}))
        setHasChanges(true)
      }}
      onClose={()=>setCoverEditOpen(false)}
      profile={layout.profile}
      albumInfo={{ albumName:album.albumName, assetCount:album.assetCount, dateRange:album.dateRange }}
      mapUrl={mapUrl}
      assets={albumAssets}
      numBodyPages={pages.length}
      initialTab={coverEditOpen}
    />
  )}
    </div>
  )
}
