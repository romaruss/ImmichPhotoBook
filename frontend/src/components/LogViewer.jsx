/**
 * LogViewer.jsx — Pannello debug interattivo generazione album.
 * 3 colonne: lista pagine/escluse | dettaglio | candidati con punteggi.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'

const C = {
  bg:'#0c0d10', bg2:'#13141a', bg3:'#1a1c24', border:'#252830',
  gold:'#d4aa5a', goldDim:'rgba(212,170,90,0.13)',
  blue:'#4a9edd', blueDim:'rgba(74,158,221,0.12)',
  green:'#5dbd7a', greenDim:'rgba(93,189,122,0.12)',
  red:'#e05050',  redDim:'rgba(224,80,80,0.12)',
  cyan:'#4dcfcf', text:'#e8e5de', text2:'#a8a49c', text3:'#5a5650',
  mono:"'JetBrains Mono','Fira Code',monospace",
}

// ── Micro-components ──────────────────────────────────────────────────────────
function Tag({ color, children }) {
  return (
    <span style={{display:'inline-block',fontFamily:C.mono,fontSize:10,
      padding:'2px 6px',borderRadius:3,lineHeight:1.4,
      background:color+'22',border:`1px solid ${color}44`,color}}>
      {children}
    </span>
  )
}

function ScoreBar({ score, max=10000, label, warn=500, danger=5000 }) {
  const pct = Math.min(100, (score/max)*100)
  const col = score>=danger?C.red:score>=warn?C.gold:C.green
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
      {label && <span style={{fontSize:10,color:C.text3,fontFamily:C.mono,minWidth:130,flexShrink:0}}>{label}</span>}
      <div style={{flex:1,height:4,background:C.bg3,borderRadius:2,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',background:col,borderRadius:2,transition:'width 0.2s'}}/>
      </div>
      <span style={{fontSize:10,fontFamily:C.mono,color:col,minWidth:44,textAlign:'right'}}>
        {score>=10000?'∞':score.toFixed(0)}
      </span>
    </div>
  )
}

// ── CandidateRow ──────────────────────────────────────────────────────────────
function CandidateRow({ cand, expanded, onToggle }) {
  const b = cand.breakdown||{}
  return (
    <div style={{border:`1px solid ${cand.winner?C.gold+'55':C.border}`,borderRadius:6,
      marginBottom:5,overflow:'hidden',background:cand.winner?C.goldDim:C.bg3}}>
      <button onClick={onToggle} style={{width:'100%',display:'flex',alignItems:'center',
        gap:8,padding:'8px 10px',background:'none',border:'none',cursor:'pointer',textAlign:'left'}}>
        <span style={{fontSize:13,minWidth:18}}>{cand.winner?'🏆':'·'}</span>
        <span style={{flex:1,fontSize:11,fontFamily:C.mono,fontWeight:cand.winner?700:400,
          color:cand.winner?C.gold:C.text2}}>
          {cand.label}
        </span>
        {(b.orient_violations||0)>0 && <Tag color={C.red}>⚠ orient.</Tag>}
        {(b.cap_unfilled||0)>0     && <Tag color={C.red}>⚠ T vuoto</Tag>}
        {b.unused_bonus             && <Tag color={C.green}>nuovo</Tag>}
        <span style={{fontSize:12,fontFamily:C.mono,
          color:cand.score>=5000?C.red:cand.score>=1000?C.gold:C.green}}>
          {cand.score>=10000?'∞':cand.score.toFixed(0)} pt
        </span>
        <span style={{color:C.text3,fontSize:10}}>{expanded?'▲':'▼'}</span>
      </button>

      {expanded && (
        <div style={{padding:'4px 10px 12px',borderTop:`1px solid ${C.border}`}}>
          <div style={{marginTop:8}}>
            <ScoreBar score={b.orient_score||0} max={20000}
              label={`Orientamento ×${b.orient_violations||0}`} danger={9999} warn={1}/>
            <ScoreBar score={b.cap_score||0} max={10000}
              label={`Slot T vuoti ×${b.cap_unfilled||0}`} danger={4999} warn={1}/>
            <ScoreBar score={b.empty_score||0} max={2000}
              label={`Slot vuoti ×${b.empty_slots||0}`} danger={800} warn={200}/>
            <ScoreBar score={b.density_score||0} max={200}
              label={`Densità diff=${b.slot_diff||0}`} danger={100} warn={40}/>
            <ScoreBar score={b.face_penalty||0} max={800}
              label="Volto tagliato" danger={300} warn={100}/>
            <ScoreBar score={b.usage_score||0} max={80}
              label={`Utilizzo ×${b.usage||0}`} danger={50} warn={16}/>
          </div>
          {b.unused_bonus    && <div style={{fontSize:10,color:C.green,fontFamily:C.mono,marginTop:4}}>↳ Bonus nuovo layout: −30 pt</div>}
          {b.rhythm_penalty  && <div style={{fontSize:10,color:C.gold,fontFamily:C.mono,marginTop:2}}>↳ Penalità ritmo: +4 pt</div>}
          <div style={{fontSize:9,color:C.text3,fontFamily:C.mono,marginTop:6}}>
            {`slot_foto:${b.n_photo_slots??'?'}  slot_T:${b.n_caption_slots??'?'}  target_densità:${b.slot_target??'?'}`}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PhotoCropPreview ──────────────────────────────────────────────────────────
function PhotoCropPreview({ assetId, photoAr, slotAr, transform, faces }) {
  const tr   = transform || { x: 50, y: 50, zoom: 1 }
  const pa   = parseFloat(photoAr) || 1
  const sa   = parseFloat(slotAr)  || 1
  const zoom = Math.max(1, parseFloat(tr.zoom) || 1)
  const panX = (tr.x ?? 50) / 100
  const panY = (tr.y ?? 50) / 100

  let visW, visH
  if (pa >= sa) {
    visW = (sa / pa) / zoom
    visH = 1 / zoom
  } else {
    visW = 1 / zoom
    visH = (pa / sa) / zoom
  }
  visW = Math.min(1, visW)
  visH = Math.min(1, visH)

  const slotL = Math.max(0, Math.min(1 - visW, panX * (1 - visW)))
  const slotT = Math.max(0, Math.min(1 - visH, panY * (1 - visH)))

  const DIM       = 'rgba(0,0,0,0.58)'
  const fb        = faces?.bbox
  const faceColor = faces?.would_clip ? C.red : C.green
  const H = 130
  return (
    <div style={{ position:'relative', height:H, width:`${pa * H}px`, maxWidth:'100%',
                  background:'#111', borderRadius:5, overflow:'hidden',
                  border:`1px solid ${C.border}`, marginBottom:6, flexShrink:0 }}>
      <img src={`/api/thumb/${assetId}?size=preview`} alt=""
           style={{ position:'absolute', inset:0, width:'100%', height:'100%',
                    objectFit:'cover', display:'block' }} />
      <div style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
        <div style={{ position:'absolute', left:0, top:0, right:0,
                      height:`${slotT*100}%`, background:DIM }} />
        <div style={{ position:'absolute', left:0, right:0, bottom:0,
                      top:`${(slotT+visH)*100}%`, background:DIM }} />
        <div style={{ position:'absolute', top:`${slotT*100}%`, left:0,
                      width:`${slotL*100}%`, height:`${visH*100}%`, background:DIM }} />
        <div style={{ position:'absolute', top:`${slotT*100}%`, right:0,
                      left:`${(slotL+visW)*100}%`, height:`${visH*100}%`, background:DIM }} />
      </div>
      <div style={{ position:'absolute', pointerEvents:'none',
        left:`${slotL*100}%`, top:`${slotT*100}%`,
        width:`${visW*100}%`, height:`${visH*100}%`,
        border:`2px solid ${C.gold}`,
        boxShadow:`inset 0 0 0 1px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.4)` }}>
        <span style={{ position:'absolute', bottom:2, right:3, fontSize:7,
          color:C.gold, fontFamily:C.mono, background:'rgba(0,0,0,0.75)',
          padding:'1px 3px', borderRadius:2, lineHeight:1.5 }}>slot</span>
      </div>
      {fb && (
        <div style={{ position:'absolute', pointerEvents:'none',
          left:`${fb[0]*100}%`, top:`${fb[1]*100}%`,
          width:`${(fb[2]-fb[0])*100}%`, height:`${(fb[3]-fb[1])*100}%`,
          border:`1.5px solid ${faceColor}`,
          background:`${faceColor}1a`, borderRadius:2 }}>
          <span style={{ position:'absolute', top:1, left:2, fontSize:8,
            color:faceColor, fontFamily:C.mono, background:'rgba(0,0,0,0.75)',
            padding:'0 2px', borderRadius:2, lineHeight:1.6 }}>👤</span>
        </div>
      )}
      <div style={{ position:'absolute', top:3, left:3, display:'flex', gap:4, pointerEvents:'none' }}>
        <span style={{ fontSize:7, fontFamily:C.mono, color:C.gold,
          background:'rgba(0,0,0,0.75)', padding:'1px 4px', borderRadius:2 }}>▪ slot</span>
        {fb && <span style={{ fontSize:7, fontFamily:C.mono, color:faceColor,
          background:'rgba(0,0,0,0.75)', padding:'1px 4px', borderRadius:2 }}>▪ volto</span>}
      </div>
    </div>
  )
}

// ── SlotCard ─────────────────────────────────────────────────────────────────
function SlotCard({ slot }) {
  const isCaption = slot.slot_type==='caption'

  if (isCaption) return (
    <div style={{border:`1px solid ${C.blue}44`,borderRadius:6,background:C.blueDim,padding:10,marginBottom:6}}>
      <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:6}}>
        <Tag color={C.blue}>T</Tag>
        <span style={{fontSize:11,color:C.blue,fontFamily:C.mono}}>Slot didascalia #{slot.slot_idx+1}</span>
        {slot.empty && <Tag color={C.red}>⚠ vuoto</Tag>}
      </div>
      {slot.text
        ? <div style={{fontSize:11,color:C.text2,lineHeight:1.5,fontStyle:'italic',
            borderLeft:`2px solid ${C.blue}55`,paddingLeft:8}}>"{slot.text}"</div>
        : <div style={{fontSize:10,color:C.text3,fontFamily:C.mono}}>Nessuna descrizione disponibile</div>
      }
    </div>
  )

  if (slot.slot_type === 'map') return (
    <div style={{border:`1px solid ${C.cyan}44`,borderRadius:6,background:C.bg3,padding:10,marginBottom:6}}>
      <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:8}}>
        <Tag color={C.cyan}>🗺</Tag>
        <span style={{fontSize:11,color:C.cyan,fontFamily:C.mono}}>Slot #{slot.slot_idx+1} — Mappa GPS</span>
      </div>
      {slot.map_key && (
        <img src={`/api/mapcache/${slot.map_key}`} alt="mappa GPS"
          style={{width:'100%',maxHeight:160,objectFit:'contain',borderRadius:5,
            border:`1px solid ${C.cyan}44`,background:C.bg}}/>
      )}
    </div>
  )

  if (slot.empty) return (
    <div style={{border:`1px solid ${C.border}`,borderRadius:6,padding:10,marginBottom:6,opacity:.5}}>
      <span style={{fontSize:11,color:C.text3,fontFamily:C.mono}}>📷 Slot #{slot.slot_idx+1} — vuoto</span>
    </div>
  )

  const tr    = slot.transform||{x:50,y:50,zoom:1}
  const faces = slot.faces
  const ok    = slot.orient_match

  return (
    <div style={{border:`1px solid ${ok?C.green+'44':C.red+'66'}`,borderRadius:6,
      background:ok?C.greenDim:C.redDim,padding:10,marginBottom:6}}>

      <div style={{display:'flex',gap:9,alignItems:'flex-start',marginBottom:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,fontFamily:C.mono,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {slot.filename||slot.asset_id}
          </div>
          {slot.datetime && <div style={{fontSize:10,color:C.text3,fontFamily:C.mono,marginTop:2}}>{slot.datetime?.slice(0,16).replace('T',' ')}</div>}
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:5}}>
            <Tag color={slot.photo_portrait?C.cyan:'#a07fd4'}>{slot.photo_portrait?'↕ V':'↔ H'} foto</Tag>
            <Tag color={slot.slot_portrait ?C.cyan:'#a07fd4'}>{slot.slot_portrait ?'↕ V':'↔ H'} slot</Tag>
            {ok ? <Tag color={C.green}>✓ orient. match</Tag> : <Tag color={C.red}>⚠ mismatch</Tag>}
            {slot.has_caption   && <Tag color={C.gold}>💬 desc.</Tag>}
            {slot.is_favorite   && <Tag color={C.gold}>★ pref.</Tag>}
          </div>
        </div>
      </div>

      <div style={{display:'flex',gap:12,marginBottom:8}}>
        <span style={{fontSize:10,fontFamily:C.mono,color:C.text3}}>AR foto: <span style={{color:C.text2}}>{slot.photo_ar}</span></span>
        <span style={{fontSize:10,fontFamily:C.mono,color:C.text3}}>AR slot: <span style={{color:C.text2}}>{slot.slot_ar}</span></span>
        <span style={{fontSize:10,fontFamily:C.mono,color:C.text3}}>
          Pan: <span style={{color:C.cyan}}>x={tr.x}% y={tr.y}%</span>
          {tr.zoom!==1 && <> · zoom=<span style={{color:C.cyan}}>{tr.zoom}×</span></>}
        </span>
      </div>

      {slot.asset_id && (
        <PhotoCropPreview
          assetId={slot.asset_id}
          photoAr={slot.photo_ar}
          slotAr={slot.slot_ar}
          transform={tr}
          faces={faces}
        />
      )}

      {faces && (
        <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:6,
          padding:'5px 8px',background:C.bg3,borderRadius:4,
          border:`1px solid ${faces.would_clip?C.red+'44':C.border}`}}>
          <span style={{fontSize:11}}>👤</span>
          <span style={{fontSize:11,fontWeight:600,color:C.text,fontFamily:C.mono}}>
            {faces.count} volt{faces.count===1?'o':'i'}
            {faces.prominent>0&&` (${faces.prominent} in primo piano)`}
          </span>
          {faces.would_clip ? <Tag color={C.red}>⚠ tagliato</Tag> : <Tag color={C.green}>✓ visibile</Tag>}
          {faces.bbox && (
            <span style={{fontSize:9,color:C.text3,fontFamily:C.mono,marginLeft:'auto'}}>
              [{faces.bbox.map(v=>v.toFixed(2)).join(', ')}]
            </span>
          )}
        </div>
      )}

      {slot.quality_score != null && (
        <div style={{marginTop:6}}>
          <ScoreBar
            score={Math.round((1 - slot.quality_score) * 100)}
            max={100}
            label={`Qualità: ${slot.quality_score}`}
            warn={35} danger={65}/>
        </div>
      )}

      {slot.similarity_score != null && (
        <div style={{marginTop:3}}>
          <ScoreBar
            score={Math.round(slot.similarity_score * 100)}
            max={100}
            label={`Somiglianza: ${slot.similarity_score}`}
            warn={70} danger={90}/>
        </div>
      )}

      {slot.has_caption && slot.description && (
        <div style={{fontSize:10,color:C.gold,fontFamily:C.mono,
          background:C.goldDim,borderRadius:4,padding:'5px 8px',
          borderLeft:`2px solid ${C.gold}`}}>
          💬 "{slot.description.slice(0,90)}{slot.description.length>90?'…':''}"
        </div>
      )}
    </div>
  )
}

// ── PageRow (sidebar) ─────────────────────────────────────────────────────────
function PageRow({ pg, active, onClick }) {
  const winner  = pg.candidates?.[0]
  const score   = winner?.score??0
  const hasIssue = pg.slots?.some(s =>
    s.orient_match===false || s.faces?.would_clip || (s.slot_type==='caption'&&s.empty))

  return (
    <button onClick={onClick} style={{width:'100%',display:'flex',alignItems:'center',
      gap:8,padding:'8px 10px',background:'none',
      border:`1px solid ${active?C.gold+'55':'transparent'}`,borderRadius:5,
      cursor:'pointer',textAlign:'left',
      background:active?C.goldDim:'transparent',transition:'background 0.1s'}}>
      <span style={{fontSize:10,fontFamily:C.mono,color:C.text3,minWidth:24,textAlign:'right'}}>{pg.page_num}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontFamily:C.mono,color:active?C.gold:C.text2,
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pg.page_type_label}</div>
        <div style={{fontSize:9,color:C.text3,fontFamily:C.mono,marginTop:1,
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pg.group}</div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:2,alignItems:'flex-end',flexShrink:0}}>
        {hasIssue  && <span style={{fontSize:9,color:C.red}}>⚠</span>}
        {pg.is_favorite && <span style={{fontSize:10,color:C.gold}}>★</span>}
        <span style={{fontSize:9,fontFamily:C.mono,
          color:score>=5000?C.red:score>=1000?C.gold:C.green}}>
          {score>=10000?'∞':score.toFixed(0)}
        </span>
      </div>
    </button>
  )
}

// ── ExcludedRow (sidebar) ─────────────────────────────────────────────────────
function ExcludedRow({ ex, active, onClick }) {
  const isQuality = ex.reason === 'quality'
  const isVisual  = ex.reason === 'duplicate_visual'
  const color = isQuality ? C.gold : isVisual ? C.cyan : C.red
  const icon  = isQuality ? '🎚' : isVisual ? '👁' : '🔁'
  const label = isQuality ? 'qual.' : isVisual ? 'visivo' : 'burst'
  return (
    <button onClick={onClick} style={{width:'100%',display:'flex',alignItems:'center',
      gap:8,padding:'7px 10px',background:active?color+'18':'transparent',
      border:`1px solid ${active?color+'55':'transparent'}`,borderRadius:5,
      cursor:'pointer',textAlign:'left',transition:'background 0.1s'}}>
      <span style={{fontSize:12,flexShrink:0}}>{icon}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontFamily:C.mono,color:active?color:C.text2,
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {ex.filename||ex.asset_id||'?'}
        </div>
        {ex.datetime && (
          <div style={{fontSize:9,color:C.text3,fontFamily:C.mono,marginTop:1}}>
            {ex.datetime.slice(0,10)}
          </div>
        )}
      </div>
      <Tag color={color}>{label}</Tag>
    </button>
  )
}

// ── ExcludedDetail (center pane) ──────────────────────────────────────────────
function ExcludedDetail({ ex }) {
  const isQuality = ex.reason === 'quality'
  const isVisual  = ex.reason === 'duplicate_visual'
  const isDup     = ex.reason?.startsWith('duplicate')
  const color     = isQuality ? C.gold : isVisual ? C.cyan : C.red

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <span style={{fontSize:20}}>{isQuality?'🎚':isVisual?'👁':'🔁'}</span>
        <div>
          <div style={{fontSize:14,fontWeight:700,color,fontFamily:C.mono}}>
            {ex.filename||ex.asset_id}
          </div>
          {ex.datetime && (
            <div style={{fontSize:11,color:C.text3,fontFamily:C.mono,marginTop:2}}>
              {ex.datetime.slice(0,16).replace('T',' ')}
            </div>
          )}
        </div>
      </div>

      {/* Reason */}
      <div style={{background:C.bg3,border:`1px solid ${color}44`,
        borderRadius:7,padding:'10px 14px',marginBottom:14}}>
        <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:6,
          textTransform:'uppercase',letterSpacing:'0.08em'}}>
          Motivo esclusione
        </div>
        <Tag color={color}>
          {isQuality ? 'Qualità insufficiente' :
           ex.reason==='duplicate_checksum' ? 'File identico (checksum)' :
           isVisual ? 'Quasi-identica (dHash)' :
           'Burst shot duplicato'}
        </Tag>
        <div style={{fontSize:12,color:C.text2,marginTop:8,lineHeight:1.6}}>
          {ex.detail}
        </div>
      </div>

      {/* Quality bar */}
      {isQuality && ex.quality_score != null && (
        <div style={{background:C.bg3,border:`1px solid ${C.border}`,
          borderRadius:7,padding:'10px 14px',marginBottom:14}}>
          <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:8,
            textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Punteggio qualità
          </div>
          <ScoreBar
            score={Math.round((1 - ex.quality_score) * 100)}
            max={100}
            label={`Score: ${ex.quality_score}`}
            warn={50} danger={80}/>
          <div style={{fontSize:10,color:C.text3,fontFamily:C.mono,marginTop:4}}>
            ↳ Qualità calcolata su risoluzione, megapixel, stato preferito
          </div>
        </div>
      )}

      {/* Hamming distance bar (for visual duplicates) */}
      {isVisual && ex.hamming != null && (
        <div style={{background:C.bg3,border:`1px solid ${C.cyan}44`,
          borderRadius:7,padding:'10px 14px',marginBottom:14}}>
          <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:8,
            textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Distanza Hamming (dHash 64-bit)
          </div>
          <ScoreBar
            score={ex.hamming}
            max={ex.max_hamming > 0 ? ex.max_hamming * 3 : 10}
            label={`${ex.hamming} bit diversi (soglia: ≤${ex.max_hamming})`}
            warn={Math.ceil((ex.max_hamming||5) * 0.6)}
            danger={ex.max_hamming||5}/>
          <div style={{fontSize:10,color:C.text3,fontFamily:C.mono,marginTop:4}}>
            ↳ 0 = identiche · 64 = opposte · soglia attuale = {ex.max_hamming} bit
          </div>
        </div>
      )}

      {/* Side-by-side thumbnails for visual duplicates */}
      {isVisual && ex.kept_asset_id && ex.asset_id && (
        <div style={{background:C.bg3,border:`1px solid ${C.cyan}44`,
          borderRadius:7,padding:'10px 14px',marginBottom:14}}>
          <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:8,
            textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Confronto visivo
          </div>
          <div style={{display:'flex',gap:10,alignItems:'flex-end'}}>
            <div style={{flex:1,textAlign:'center'}}>
              <img src={`/api/thumb/${ex.kept_asset_id}`} alt=""
                style={{width:'100%',maxHeight:180,objectFit:'contain',
                  borderRadius:5,border:`2px solid ${C.green}`,background:C.bg}}/>
              <div style={{fontSize:9,color:C.green,fontFamily:C.mono,marginTop:4}}>
                ✓ {ex.kept_filename||'mantenuta'}
              </div>
            </div>
            <div style={{fontSize:16,color:C.text3,flexShrink:0,paddingBottom:20}}>≈</div>
            <div style={{flex:1,textAlign:'center'}}>
              <img src={`/api/thumb/${ex.asset_id}`} alt=""
                style={{width:'100%',maxHeight:180,objectFit:'contain',
                  borderRadius:5,border:`2px solid ${C.red}`,background:C.bg,
                  opacity:0.65,filter:'grayscale(20%)'}}/>
              <div style={{fontSize:9,color:C.red,fontFamily:C.mono,marginTop:4}}>
                ⊘ {ex.filename||'esclusa'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kept photo (for checksum/burst duplicates) */}
      {isDup && !isVisual && ex.kept_filename && (
        <div style={{background:C.bg3,border:`1px solid ${C.green}44`,
          borderRadius:7,padding:'10px 14px',marginBottom:14}}>
          <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:8,
            textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Foto mantenuta
          </div>
          <div style={{fontSize:12,fontFamily:C.mono,color:C.green}}>
            ✓ {ex.kept_filename}
          </div>
          {ex.kept_asset_id && (
            <div style={{marginTop:8}}>
              <img src={`/api/thumb/${ex.kept_asset_id}`} alt=""
                style={{maxHeight:100,borderRadius:5,border:`1px solid ${C.border}`}}/>
            </div>
          )}
        </div>
      )}

      {/* Thumbnail of excluded (non-visual dups and quality) */}
      {ex.asset_id && !isVisual && (
        <div style={{marginTop:4}}>
          <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:6,
            textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Anteprima esclusa
          </div>
          <img src={`/api/thumb/${ex.asset_id}`} alt=""
            style={{maxHeight:120,borderRadius:5,border:`1px solid ${C.border}`,opacity:0.6,
              filter:'grayscale(30%)'}}/>
        </div>
      )}
    </div>
  )
}

// ── Main LogViewer ────────────────────────────────────────────────────────────
export default function LogViewer({ pageLogs, excludedPhotos=[], currentPage, onNavigate, onClose }) {
  const [viewMode, setViewMode]   = useState('pages')  // 'pages' | 'excluded'
  const [sel, setSel]             = useState(Math.max(0, currentPage>=0?currentPage:0))
  const [selEx, setSelEx]         = useState(0)
  const [expCand, setExpCand]     = useState(null)
  const [search, setSearch]       = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const listRef = useRef(null)

  useEffect(() => {
    if (currentPage>=0 && currentPage<pageLogs.length) setSel(currentPage)
  }, [currentPage, pageLogs.length])

  useEffect(() => {
    if (viewMode==='pages')
      listRef.current?.querySelector(`[data-pg="${sel}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'})
  }, [sel, viewMode])

  const pg = pageLogs[sel]
  const ex = excludedPhotos[selEx]

  const stats = useMemo(() => {
    let orient=0, clip=0, capEmpty=0, perfect=0
    pageLogs.forEach(p => {
      let ok=true
      p.slots?.forEach(s => {
        if(s.orient_match===false){orient++;ok=false}
        if(s.faces?.would_clip){clip++;ok=false}
        if(s.slot_type==='caption'&&s.empty){capEmpty++;ok=false}
      })
      if(ok) perfect++
    })
    const nQual    = excludedPhotos.filter(e=>e.reason==='quality').length
    const nVisual  = excludedPhotos.filter(e=>e.reason==='duplicate_visual').length
    const nDup     = excludedPhotos.filter(e=>e.reason?.startsWith('duplicate')).length
    return {orient,clip,capEmpty,perfect,total:pageLogs.length,nQual,nDup,nVisual,nExcl:excludedPhotos.length}
  }, [pageLogs, excludedPhotos])

  // Pages-per-group count from all pageLogs (for separator badges)
  const groupPageCount = useMemo(() => {
    const m = {}
    pageLogs.forEach(p => { const g = p.group||'principale'; m[g] = (m[g]||0)+1 })
    return m
  }, [pageLogs])

  // Human-readable group label
  const groupLabel = (g='') => {
    if (!g || g === 'principale') return null  // no clustering → no separator needed
    if (g.startsWith('cluster')) return { icon:'📅', text:`Evento ${g.replace('cluster','').trim()}`, color:C.cyan }
    if (g.startsWith('libere'))  return { icon:'🗂', text:'Foto isolate', color:C.gold }
    return { icon:'📷', text: g, color: C.text3 }
  }

  const filtered = useMemo(() => pageLogs.filter(p => {
    if (onlyIssues && !p.slots?.some(s=>s.orient_match===false||s.faces?.would_clip||(s.slot_type==='caption'&&s.empty))) return false
    if (search) {
      const q=search.toLowerCase()
      return p.page_type_label.toLowerCase().includes(q) || p.group.toLowerCase().includes(q) ||
             p.slots?.some(s=>(s.filename||'').toLowerCase().includes(q)||(s.text||'').toLowerCase().includes(q))
    }
    return true
  }), [pageLogs, onlyIssues, search])

  const filteredEx = useMemo(() => {
    if (!search) return excludedPhotos
    const q = search.toLowerCase()
    return excludedPhotos.filter(e =>
      (e.filename||'').toLowerCase().includes(q) ||
      (e.detail||'').toLowerCase().includes(q) ||
      (e.kept_filename||'').toLowerCase().includes(q))
  }, [excludedPhotos, search])

  if (!pg) return null

  return createPortal(
    <div style={{position:'fixed',inset:0,zIndex:9500,
      display:'flex',flexDirection:'column',background:'rgba(0,0,0,0.88)',backdropFilter:'blur(3px)'}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',
        background:C.bg,margin:16,borderRadius:12,
        border:`1px solid ${C.border}`,boxShadow:'0 32px 96px rgba(0,0,0,0.8)',
        overflow:'hidden',maxHeight:'calc(100vh - 32px)'}}>

        {/* ── Header ── */}
        <div style={{display:'flex',alignItems:'center',gap:16,
          padding:'12px 20px',borderBottom:`1px solid ${C.border}`,
          background:C.bg3,flexShrink:0}}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:15,fontWeight:700,color:C.gold,fontFamily:C.mono,letterSpacing:'0.04em'}}>
                🔍 Log impaginazione
              </span>
              <span style={{fontSize:11,color:C.text3,fontFamily:C.mono}}>{stats.total} pagine</span>
            </div>
            <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
              <Tag color={C.green}>✓ {stats.perfect} perfette</Tag>
              {stats.orient>0   && <Tag color={C.red}>⚠ {stats.orient} mismatch orient.</Tag>}
              {stats.clip>0     && <Tag color={C.red}>⚠ {stats.clip} volti tagliati</Tag>}
              {stats.capEmpty>0 && <Tag color={C.gold}>⚠ {stats.capEmpty} slot T vuoti</Tag>}
              {stats.nExcl>0    && (
                <button onClick={()=>setViewMode('excluded')}
                  style={{background:C.redDim,border:`1px solid ${C.red}44`,color:C.red,
                    borderRadius:3,padding:'2px 6px',fontSize:10,cursor:'pointer',fontFamily:C.mono}}>
                  ⊘ {stats.nExcl} foto escluse
                  {stats.nQual>0&&` (qual. ${stats.nQual})`}
                  {stats.nVisual>0&&` (👁 ${stats.nVisual})`}
                  {(stats.nDup-stats.nVisual)>0&&` (burst ${stats.nDup-stats.nVisual})`}
                </button>
              )}
            </div>
          </div>
          <button onClick={onClose}
            style={{background:'none',border:`1px solid ${C.border}`,color:C.text3,
              borderRadius:6,width:30,height:30,cursor:'pointer',fontSize:16,
              display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>

        {/* ── 3-pane body ── */}
        <div style={{flex:1,display:'flex',overflow:'hidden'}}>

          {/* Left: page list OR excluded list */}
          <div style={{width:210,borderRight:`1px solid ${C.border}`,display:'flex',flexDirection:'column',flexShrink:0}}>

            {/* View toggle */}
            <div style={{display:'flex',borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              {[['pages','Pagine'],['excluded','Escluse']].map(([mode,label])=>(
                <button key={mode} onClick={()=>setViewMode(mode)}
                  style={{flex:1,padding:'7px 4px',fontSize:11,fontFamily:C.mono,
                    background:viewMode===mode?C.bg:'transparent',
                    border:'none',borderRight:mode==='pages'?`1px solid ${C.border}`:'none',
                    color:viewMode===mode?C.gold:C.text3,cursor:'pointer',
                    fontWeight:viewMode===mode?700:400}}>
                  {label}
                  {mode==='excluded'&&stats.nExcl>0&&(
                    <span style={{marginLeft:4,fontSize:9,color:C.red}}>({stats.nExcl})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Search / filter */}
            <div style={{padding:'7px 10px',borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Cerca…"
                style={{width:'100%',background:C.bg,border:`1px solid ${C.border}`,
                  borderRadius:5,padding:'5px 8px',color:C.text,fontSize:11,
                  fontFamily:C.mono,outline:'none',
                  ...(viewMode==='excluded'?{}:{marginBottom:6})}}/>
              {viewMode==='pages'&&(
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',
                  fontSize:10,color:C.text3,fontFamily:C.mono,marginTop:6}}>
                  <input type="checkbox" checked={onlyIssues} onChange={e=>setOnlyIssues(e.target.checked)}/>
                  Solo pagine con problemi
                </label>
              )}
            </div>

            {/* List */}
            <div ref={listRef} style={{flex:1,overflowY:'auto'}}>
              {viewMode==='pages' && (
                <>
                  {filtered.map((p, fi) => {
                    const ri    = pageLogs.indexOf(p)
                    const gl    = groupLabel(p.group)
                    const prevG = fi > 0 ? filtered[fi-1].group : null
                    const showSep = gl && p.group !== prevG
                    return (
                      <div key={ri} data-pg={ri}>
                        {showSep && (
                          <div style={{
                            padding:'6px 10px 5px',
                            marginTop: fi > 0 ? 6 : 0,
                            borderTop: fi > 0 ? `1px solid ${gl.color}33` : 'none',
                            borderLeft:`3px solid ${gl.color}`,
                            background:`${gl.color}0d`,
                            display:'flex', alignItems:'center', gap:6,
                          }}>
                            <span style={{fontSize:11}}>{gl.icon}</span>
                            <div style={{flex:1, minWidth:0}}>
                              <div style={{fontSize:10,fontFamily:C.mono,color:gl.color,
                                fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase'}}>
                                {gl.text}
                              </div>
                            </div>
                            <span style={{fontSize:9,fontFamily:C.mono,color:gl.color+'99',
                              flexShrink:0}}>
                              {groupPageCount[p.group]??'?'}p
                            </span>
                          </div>
                        )}
                        <PageRow pg={p} active={ri===sel}
                          onClick={()=>{setSel(ri);setExpCand(null)}}/>
                      </div>
                    )
                  })}
                  {filtered.length===0 && (
                    <div style={{padding:20,textAlign:'center',fontSize:11,color:C.text3}}>Nessuna pagina</div>
                  )}
                </>
              )}
              {viewMode==='excluded' && (
                <>
                  {filteredEx.length===0 && (
                    <div style={{padding:20,textAlign:'center',fontSize:11,color:C.text3}}>
                      {excludedPhotos.length===0?'Nessuna foto esclusa':'Nessun risultato'}
                    </div>
                  )}
                  {filteredEx.map((e,i) => {
                    const ri = excludedPhotos.indexOf(e)
                    return (
                      <div key={ri}>
                        <ExcludedRow ex={e} active={ri===selEx} onClick={()=>setSelEx(ri)}/>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>

          {/* Center: page detail OR excluded detail */}
          <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
            {viewMode==='pages' && pg && (
              <>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14,gap:12}}>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:3}}>
                      <span style={{fontSize:14,fontWeight:700,color:C.gold,fontFamily:C.mono}}>Pagina {pg.page_num}</span>
                      <span style={{fontSize:12,color:C.text2}}>—</span>
                      <span style={{fontSize:13,fontWeight:600,color:C.text}}>{pg.page_type_label}</span>
                      {pg.is_favorite && <Tag color={C.gold}>★ preferita</Tag>}
                    </div>
                    <div style={{fontSize:11,color:C.text3,fontFamily:C.mono,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      {(() => { const gl=groupLabel(pg.group); return gl
                        ? <span style={{color:gl.color,fontWeight:700}}>{gl.icon} {gl.text}</span>
                        : <span>{pg.group}</span>
                      })()}
                      {pg.prev_dense!==null&&<span style={{color:C.text3}}>{`· prev: ${pg.prev_dense?'densa':'rada'} · questa: ${pg.is_dense?'densa':'rada'}`}</span>}
                    </div>
                  </div>
                  <button onClick={()=>{onNavigate(sel);onClose()}}
                    style={{padding:'6px 14px',fontSize:11,fontFamily:C.mono,
                      background:C.goldDim,border:`1px solid ${C.gold}55`,
                      color:C.gold,borderRadius:6,cursor:'pointer',flexShrink:0}}>
                    → Vai alla pagina
                  </button>
                </div>

                {pg.candidates?.[0] && (
                  <div style={{background:C.bg3,border:`1px solid ${C.gold}33`,
                    borderRadius:6,padding:'8px 12px',marginBottom:16}}>
                    <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,marginBottom:6}}>PUNTEGGIO LAYOUT VINCITORE</div>
                    <ScoreBar score={pg.candidates[0].score}
                      max={Math.max(...pg.candidates.map(c=>c.score),100)}
                      label={pg.candidates[0].label} warn={500} danger={2000}/>
                  </div>
                )}

                {((pg.n_photos_with_desc||0)>0||(pg.n_caption_slots||0)>0)&&(
                  <div style={{background:C.bg3,border:`1px solid ${C.border}`,
                    borderRadius:6,padding:'8px 12px',marginBottom:12}}>
                    <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,
                      textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:5}}>
                      Descrizioni Immich
                    </div>
                    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{fontSize:11,color:C.text2}}>
                        💬 {pg.n_photos_with_desc||0} foto con descrizione
                      </span>
                      <span style={{fontSize:11,color:C.text3}}>·</span>
                      <span style={{fontSize:11,color:C.text2}}>
                        {pg.n_caption_slots||0} slot T nel layout
                      </span>
                      {(pg.n_photos_with_desc||0)>0&&(pg.n_caption_slots||0)>0&&
                        <Tag color={C.green}>✓ descrizioni inserite</Tag>}
                      {(pg.n_photos_with_desc||0)>0&&!(pg.n_caption_slots||0)&&
                        <Tag color={C.gold}>⚠ descrizioni non inserite</Tag>}
                      {!(pg.n_photos_with_desc||0)&&(pg.n_caption_slots||0)>0&&
                        <Tag color={C.red}>⚠ slot T senza testo</Tag>}
                    </div>
                  </div>
                )}

                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,
                    textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>
                    Slot ({pg.slots?.length||0})
                  </div>
                  {pg.slots?.map((s,i) => <SlotCard key={i} slot={s}/>)}
                </div>
              </>
            )}

            {viewMode==='excluded' && ex && <ExcludedDetail ex={ex}/>}
            {viewMode==='excluded' && !ex && excludedPhotos.length===0 && (
              <div style={{textAlign:'center',padding:40,color:C.text3,fontSize:13}}>
                Nessuna foto esclusa in questa generazione.<br/>
                <span style={{fontSize:11,marginTop:8,display:'block'}}>
                  Le foto escluse compaiono qui quando sono attivi i filtri qualità o rimozione duplicati.
                </span>
              </div>
            )}
          </div>

          {/* Right: candidates (only in pages mode) */}
          <div style={{width:290,borderLeft:`1px solid ${C.border}`,display:'flex',flexDirection:'column',flexShrink:0}}>
            {viewMode==='pages' ? (
              <>
                <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,background:C.bg3,flexShrink:0}}>
                  <div style={{fontSize:10,fontFamily:C.mono,color:C.text3,
                    textTransform:'uppercase',letterSpacing:'0.1em'}}>
                    Candidati ({pg.candidates?.length||0})
                  </div>
                  <div style={{fontSize:10,color:C.text3,marginTop:3}}>Clicca per il breakdown punteggio</div>
                </div>
                <div style={{flex:1,overflowY:'auto',padding:'10px 12px'}}>
                  {pg.candidates?.map((cand,i) => (
                    <CandidateRow key={i} cand={cand}
                      expanded={expCand===`${sel}_${i}`}
                      onToggle={()=>setExpCand(prev=>prev===`${sel}_${i}`?null:`${sel}_${i}`)}/>
                  ))}
                  {!pg.candidates?.length && (
                    <div style={{fontSize:11,color:C.text3,textAlign:'center',padding:20}}>Nessun candidato</div>
                  )}
                </div>
              </>
            ) : (
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',
                padding:20,textAlign:'center'}}>
                <div>
                  <div style={{fontSize:24,marginBottom:10}}>⊘</div>
                  <div style={{fontSize:11,color:C.text3,fontFamily:C.mono}}>
                    {stats.nQual>0&&<div style={{marginBottom:4}}>🎚 {stats.nQual} per qualità insufficiente</div>}
                    {stats.nVisual>0&&<div style={{marginBottom:4}}>👁 {stats.nVisual} duplicati visivi (dHash)</div>}
                    {(stats.nDup-stats.nVisual)>0&&<div>🔁 {stats.nDup-stats.nVisual} burst shot duplicati</div>}
                    {stats.nExcl===0&&<div>Nessuna foto esclusa</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer nav */}
        {viewMode==='pages' && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
            padding:'8px 16px',borderTop:`1px solid ${C.border}`,background:C.bg3,flexShrink:0}}>
            <button onClick={()=>setSel(p=>Math.max(0,p-1))} disabled={sel===0}
              style={{padding:'4px 14px',fontSize:11,fontFamily:C.mono,
                background:'none',border:`1px solid ${C.border}`,color:C.text2,
                borderRadius:5,cursor:sel===0?'not-allowed':'pointer',opacity:sel===0?.4:1}}>← Prec.</button>
            <span style={{fontSize:11,fontFamily:C.mono,color:C.text3}}>{sel+1} / {pageLogs.length}</span>
            <button onClick={()=>setSel(p=>Math.min(pageLogs.length-1,p+1))} disabled={sel>=pageLogs.length-1}
              style={{padding:'4px 14px',fontSize:11,fontFamily:C.mono,
                background:'none',border:`1px solid ${C.border}`,color:C.text2,
                borderRadius:5,cursor:sel>=pageLogs.length-1?'not-allowed':'pointer',opacity:sel>=pageLogs.length-1?.4:1}}>Succ. →</button>
          </div>
        )}
        {viewMode==='excluded' && excludedPhotos.length>0 && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
            padding:'8px 16px',borderTop:`1px solid ${C.border}`,background:C.bg3,flexShrink:0}}>
            <button onClick={()=>setSelEx(p=>Math.max(0,p-1))} disabled={selEx===0}
              style={{padding:'4px 14px',fontSize:11,fontFamily:C.mono,
                background:'none',border:`1px solid ${C.border}`,color:C.text2,
                borderRadius:5,cursor:selEx===0?'not-allowed':'pointer',opacity:selEx===0?.4:1}}>← Prec.</button>
            <span style={{fontSize:11,fontFamily:C.mono,color:C.text3}}>{selEx+1} / {excludedPhotos.length}</span>
            <button onClick={()=>setSelEx(p=>Math.min(excludedPhotos.length-1,p+1))} disabled={selEx>=excludedPhotos.length-1}
              style={{padding:'4px 14px',fontSize:11,fontFamily:C.mono,
                background:'none',border:`1px solid ${C.border}`,color:C.text2,
                borderRadius:5,cursor:selEx>=excludedPhotos.length-1?'not-allowed':'pointer',opacity:selEx>=excludedPhotos.length-1?.4:1}}>Succ. →</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
