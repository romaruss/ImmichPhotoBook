/**
 * CoverConfig.js — data model and defaults for the 5-element cover structure.
 *
 * cover: {
 *   front:        divider_style   — copertina fronte
 *   inside_front: divider_style   — seconda di copertina
 *   inside_back:  divider_style   — terza di copertina
 *   back:         divider_style   — quarta di copertina
 *   spine:        spine_style     — dorso
 *   spine_width_mm:        float|null   — null = auto-calculated
 *   cover_paper_gsm:       float        — grammatura carta copertina
 *   export_as_spread:      bool         — stampa spread unico o pagine singole
 *   export_cover_separate: bool         — file PDF separato per copertina
 * }
 */

// ── Cover page defaults (divider_style format) ────────────────────────────────

export const DEFAULT_COVER_FRONT = {
  bg: '#0a0a0e',
  elements: [
    { id:'e_title',    type:'title',       enabled:true,  x:50, y:38, font:'display', font_size:5.5, color:'#f0ede6', align:'center', opacity:100 },
    { id:'e_subtitle', type:'subtitle',    enabled:false, x:50, y:50, font:'sans',    font_size:2.8, color:'#b8b0a0', align:'center', opacity:100 },
    { id:'e_date',     type:'date_range',  enabled:true,  x:50, y:62, font:'mono',    font_size:2.2, color:'#d4aa5a', align:'center', opacity:100 },
    { id:'e_count',    type:'photo_count', enabled:false, x:50, y:69, font:'mono',    font_size:2.2, color:'#d4aa5a', align:'center', opacity:100 },
    { id:'e_map',      type:'map',         enabled:false, x:50, y:25, w:55, h:35, opacity:90 },
    { id:'e_photo',    type:'photo',       enabled:false, x:50, y:25, w:40, h:30, opacity:100 },
    { id:'e_text1',    type:'text_custom', enabled:false, x:50, y:80, font:'sans', font_size:2.2, color:'#ffffff', align:'center', opacity:100, text:'' },
  ],
  lines: [
    { id:'l1', orientation:'h', x:50, y:44, length:55, thickness:1, color:'#d4aa5a', opacity:50 },
    { id:'l2', orientation:'h', x:50, y:67, length:55, thickness:1, color:'#d4aa5a', opacity:30 },
  ],
  layer_order: ['e_title','e_subtitle','e_date','e_count','e_map','e_photo','l1','l2','e_text1'],
}

export const DEFAULT_COVER_INSIDE = {
  bg: '#f5f4f0',
  elements: [
    { id:'e_title',    type:'title',       enabled:false, x:50, y:38, font:'display', font_size:5.5, color:'#1a1a1a', align:'center', opacity:100 },
    { id:'e_subtitle', type:'subtitle',    enabled:false, x:50, y:50, font:'sans',    font_size:2.8, color:'#555555', align:'center', opacity:100 },
    { id:'e_date',     type:'date_range',  enabled:false, x:50, y:62, font:'mono',    font_size:2.2, color:'#8a7a5a', align:'center', opacity:100 },
    { id:'e_count',    type:'photo_count', enabled:false, x:50, y:69, font:'mono',    font_size:2.2, color:'#8a7a5a', align:'center', opacity:100 },
    { id:'e_map',      type:'map',         enabled:false, x:50, y:25, w:55, h:35, opacity:90 },
    { id:'e_photo',    type:'photo',       enabled:false, x:50, y:25, w:40, h:30, opacity:100 },
    { id:'e_text1',    type:'text_custom', enabled:false, x:50, y:80, font:'sans', font_size:2.2, color:'#1a1a1a', align:'center', opacity:100, text:'' },
  ],
  lines: [
    { id:'l1', orientation:'h', x:50, y:44, length:55, thickness:1, color:'#8a7a5a', opacity:30 },
  ],
  layer_order: ['e_title','e_subtitle','e_date','e_count','e_map','e_photo','l1','e_text1'],
}

export const DEFAULT_COVER_BACK = {
  bg: '#0a0a0e',
  elements: [
    { id:'e_title',    type:'title',       enabled:false, x:50, y:38, font:'display', font_size:5.5, color:'#f0ede6', align:'center', opacity:100 },
    { id:'e_subtitle', type:'subtitle',    enabled:false, x:50, y:50, font:'sans',    font_size:2.8, color:'#b8b0a0', align:'center', opacity:100 },
    { id:'e_date',     type:'date_range',  enabled:false, x:50, y:62, font:'mono',    font_size:2.2, color:'#d4aa5a', align:'center', opacity:100 },
    { id:'e_count',    type:'photo_count', enabled:false, x:50, y:69, font:'mono',    font_size:2.2, color:'#d4aa5a', align:'center', opacity:100 },
    { id:'e_map',      type:'map',         enabled:false, x:50, y:25, w:55, h:35, opacity:90 },
    { id:'e_photo',    type:'photo',       enabled:false, x:50, y:25, w:40, h:30, opacity:100 },
    { id:'e_text1',    type:'text_custom', enabled:false, x:50, y:80, font:'sans', font_size:2.2, color:'#ffffff', align:'center', opacity:100, text:'' },
  ],
  lines: [
    { id:'l1', orientation:'h', x:50, y:44, length:55, thickness:1, color:'#d4aa5a', opacity:40 },
  ],
  layer_order: ['e_title','e_subtitle','e_date','e_count','e_map','e_photo','l1','e_text1'],
}

// ── Spine defaults ────────────────────────────────────────────────────────────

export const DEFAULT_SPINE = {
  bg: '#0a0a0e',
  title_enabled: true,
  title_color: '#f0ede6',
  title_size_pct: 2.5,
  title_pos: 'center',
  subtitle_enabled: false,
  subtitle_color: '#b8b0a0',
  subtitle_size_pct: 1.8,
  subtitle_pos: 'center',
  year_enabled: true,
  year_color: '#d4aa5a',
  year_size_pct: 1.5,
  year_pos: 'center',
  custom_text: '',
  custom_text_enabled: false,
  custom_text_color: '#ffffff',
  custom_text_size_pct: 1.8,
  custom_text_pos: 'center',
  spine_rotate_180: false,
}

// ── Full cover config default ─────────────────────────────────────────────────

export const DEFAULT_COVER_CONFIG = {
  front:                 null,   // populated on first use via migrateCoverConfig
  inside_front:          null,
  inside_back:           null,
  back:                  null,
  spine:                 null,
  spine_width_mm:        null,   // null = auto-calculated from body_paper_gsm + page count
  cover_paper_gsm:       300.0,
  export_as_spread:      false,
  export_cover_separate: false,
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Estimate spine width in mm.
 * Formula: num_leaves × (body_paper_gsm / 800)
 * A 90gsm paper sheet is ~0.1mm thick; higher gsm = thicker.
 */
export function calcSpineWidthMm(numBodyPages, bodyPaperGsm = 90.0) {
  const numLeaves = Math.max(1, Math.ceil(numBodyPages / 2))
  return +(numLeaves * bodyPaperGsm / 800).toFixed(1)
}

/**
 * Merge missing elements/lines from defaultPage into existing page config.
 * New elements are added with enabled:false so they don't disturb existing layouts.
 */
function mergePageElements(page, defaultPage) {
  if (!page) return { ...defaultPage }
  const existingEls    = page.elements || []
  const existingIds    = new Set(existingEls.map(e => e.id))
  const addedEls       = (defaultPage.elements || []).filter(e => !existingIds.has(e.id)).map(e => ({ ...e, enabled: false }))
  const existingLines  = page.lines || []
  const existingLineIds = new Set(existingLines.map(l => l.id))
  const addedLines     = (defaultPage.lines || []).filter(l => !existingLineIds.has(l.id)).map(l => ({ ...l, opacity: 0 }))
  const baseOrder      = page.layer_order || [...existingEls.map(e => e.id), ...existingLines.map(l => l.id)]
  const newIds         = [...addedEls.map(e => e.id), ...addedLines.map(l => l.id)]
  return {
    ...page,
    elements:    [...existingEls, ...addedEls],
    lines:       [...existingLines, ...addedLines],
    layer_order: [...baseOrder, ...newIds],
  }
}

/**
 * Ensure a cover config has all 5 elements populated with defaults.
 * Migrates from legacy cover_style if needed.
 */
export function migrateCoverConfig(cover, oldCoverStyle) {
  // Already new format
  if (cover?.front) {
    return {
      ...DEFAULT_COVER_CONFIG,
      ...cover,
      front:        mergePageElements(cover.front,        DEFAULT_COVER_FRONT),
      inside_front: mergePageElements(cover.inside_front, DEFAULT_COVER_INSIDE),
      inside_back:  mergePageElements(cover.inside_back,  DEFAULT_COVER_INSIDE),
      back:         mergePageElements(cover.back,         DEFAULT_COVER_BACK),
      spine:        { ...DEFAULT_SPINE, ...(cover.spine || {}) },
    }
  }
  // Migrate from legacy cover_style
  const cs = oldCoverStyle || {}
  const accentColor = cs.accent_color || '#d4aa5a'
  const textColor   = cs.text_color   || '#f0ede6'
  return {
    ...DEFAULT_COVER_CONFIG,
    front: {
      ...DEFAULT_COVER_FRONT,
      bg: cs.bg || DEFAULT_COVER_FRONT.bg,
      elements: DEFAULT_COVER_FRONT.elements.map(el => ({
        ...el,
        color: el.type === 'title' ? textColor
          : ['subtitle','date_range','photo_count'].includes(el.type) ? accentColor
          : el.color,
      })),
      lines: DEFAULT_COVER_FRONT.lines.map(l => ({ ...l, color: accentColor })),
    },
    inside_front: { ...DEFAULT_COVER_INSIDE },
    inside_back:  { ...DEFAULT_COVER_INSIDE },
    back:         { ...DEFAULT_COVER_BACK },
    spine:        { ...DEFAULT_SPINE },
  }
}
