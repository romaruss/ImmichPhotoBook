# Print Profiles

A **print profile** defines everything about the physical book you want to produce: page dimensions, margins, slot layouts, caption style, bleed settings, and color output parameters. Profiles are stored as JSON files in `/data/profiles/` and can be created, edited, duplicated, and deleted from the **Profiles** page in the UI.

---

## Table of Contents

- [What Is a Profile?](#what-is-a-profile)
- [Profile Fields Reference](#profile-fields-reference)
- [Page Sizes Catalogue](#page-sizes-catalogue)
- [The Slot System](#the-slot-system)
- [The Profile Editor](#the-profile-editor)
- [Cover and Spine](#cover-and-spine)
- [Bleed and Crop Marks](#bleed-and-crop-marks)
- [Margins — Uniform vs Per-Side vs Duplex](#margins--uniform-vs-per-side-vs-duplex)
- [Caption Style](#caption-style)
- [Photo Badge Configuration](#photo-badge-configuration)
- [Color Profiles](#color-profiles)
- [Export DPI Guide](#export-dpi-guide)

---

## What Is a Profile?

A profile is a reusable template that describes the **physical and visual properties** of a book. Once you create a profile (e.g. "A4 Portrait — Family Album"), you can use it for multiple projects. Changing the profile updates the layout for all future generations; existing saved projects retain the profile settings at save time.

Profiles are stored as `{uuid}.json` in `/data/profiles/`. The `GET /api/profiles` endpoint returns all profiles; `POST /api/profiles` creates a new one.

---

## Profile Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable profile name |
| `page_size` | string | One of the predefined sizes or `"custom"` |
| `orientation` | `"portrait"` \| `"landscape"` | Page orientation |
| `margin_mm` | number | Uniform margin applied to all four sides (mm). Overridden by per-side fields if present |
| `margin_top` | number | Top margin (mm) — if set, overrides `margin_mm` for the top edge |
| `margin_right` | number | Right margin (mm) |
| `margin_bottom` | number | Bottom margin (mm) |
| `margin_left` | number | Left margin (mm) |
| `bleed` | boolean | Enable bleed area (for offset printing) |
| `bleed_mm` | number | Bleed size in mm (typically 3 mm) |
| `gap_mm` | number | Gap between slots within a page (mm) |
| `page_types` | array | Array of page layout definitions (slots) — see [Slot System](#the-slot-system) |
| `caption_style` | object | Global caption text style — see [Caption Style](#caption-style) |
| `cover` | array | 5-element cover configuration — see [Cover and Spine](#cover-and-spine) |
| `export_dpi` | number | Target resolution for photo rasterisation (150–600) |
| `color_profile` | string | ICC color profile for output — see [Color Profiles](#color-profiles) |
| `crop_marks` | boolean | Include crop marks on bleed pages |
| `body_paper_gsm` | number | Paper weight (g/m²) used to estimate spine width |
| `map_style` | string | Stadia Maps style name for GPS maps (e.g. `"stamen_terrain"`) |

---

## Page Sizes Catalogue

| ID | Dimensions (mm) | Common Use |
|----|----------------|-----------|
| `a5` | 148 × 210 | Small softcover, pocket album |
| `a4` | 210 × 297 | Standard office/home print |
| `a3` | 297 × 420 | Large-format desktop |
| `20x20` | 200 × 200 | Square coffee-table book |
| `20x30` | 200 × 300 | Portrait softcover |
| `30x30` | 300 × 300 | Large square hardcover |
| `30x40` | 300 × 400 | Large portrait hardcover |
| `letter` | 215.9 × 279.4 | US Letter |
| `custom` | user-defined | Any width × height in mm |

Dimensions apply to the **trimmed** page (after bleed is removed). When bleed is enabled, the actual artboard (PDF media box) is larger by `bleed_mm` on each side.

Orientation (`portrait` / `landscape`) swaps width and height where applicable. Square formats (`20x20`, `30x30`) are orientation-neutral.

---

## The Slot System

A **page type** defines how photos and captions are arranged on a single page. It consists of:

- `label` — display name shown in the editor (e.g. `"2 photos side by side"`)
- `slots` — an array of slot objects

### Slot Object

```json
{
  "x": 0,
  "y": 0,
  "w": 50,
  "h": 100,
  "type": "photo"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `x` | number | Left edge as a percentage (0–100) of the page content area width |
| `y` | number | Top edge as a percentage (0–100) of the page content area height |
| `w` | number | Width as a percentage (0–100) of the page content area width |
| `h` | number | Height as a percentage (0–100) of the page content area height |
| `type` | `"photo"` \| `"caption"` | Whether this slot holds a photo or a text caption |

All coordinates are **relative to the content area** (page minus margins). A slot that fills the full page is `{x:0, y:0, w:100, h:100}`.

### Example Page Types

**Full page (1 photo):**
```json
{
  "label": "Full page",
  "slots": [
    { "x": 0, "y": 0, "w": 100, "h": 100, "type": "photo" }
  ]
}
```

**Two photos side by side:**
```json
{
  "label": "2 columns",
  "slots": [
    { "x": 0,  "y": 0, "w": 50, "h": 100, "type": "photo" },
    { "x": 50, "y": 0, "w": 50, "h": 100, "type": "photo" }
  ]
}
```

**Photo with caption bar at bottom:**
```json
{
  "label": "Photo + caption",
  "slots": [
    { "x": 0,  "y": 0,  "w": 100, "h": 85, "type": "photo"   },
    { "x": 0,  "y": 85, "w": 100, "h": 15, "type": "caption" }
  ]
}
```

### Slot Rules

- A page type can have **1 to 6 slots**
- Slots do not need to be adjacent or fill the entire page; gaps between slots are rendered as the page background
- The `gap_mm` profile parameter adds visual spacing between adjacent slots at render time (the slot percentages define the photo area including gap)
- Photo slots use face-aware cropping by default (see [Album Generation](Album-Generation.md))
- Caption slots display the photo's description text

---

## The Profile Editor

The **Profiles** page (`/profiles`) includes a visual slot editor:

1. Select a page type from the list (or click **Add page type**)
2. The canvas shows the page with draggable/resizable slot handles
3. **Drag** a slot boundary to resize adjacent slots — they snap to a configurable grid
4. **Snap** is enabled by default: slot edges snap to common fractions (25%, 33.3%, 50%, 66.6%, 75%) plus the margin boundaries
5. Click a slot to change its type (`photo` / `caption`) or remove it
6. Click **Add slot** to add a new slot to the current page type
7. Changes are saved when you click **Save profile**

The editor enforces that slot coordinates remain within `0–100` and prevents negative sizes.

---

## Cover and Spine

The `cover` field is a 5-element array describing the cover layout:

```
cover[0]  Front cover
cover[1]  Back cover
cover[2]  Spine
cover[3]  Front flap (for dustjacket / wrap formats)
cover[4]  Back flap
```

Each element follows the same slot/style format as a body page type. The **spine width** is automatically estimated from:

```
spine_width_mm = page_count × paper_thickness_per_page
paper_thickness_per_page ≈ body_paper_gsm / 1000 × 0.1 mm/gsm  (approximate)
```

This estimate is used for cover layout calculations. The actual value will vary by printer and paper stock — always verify with your print supplier.

---

## Bleed and Crop Marks

**Bleed** is extra image area that extends beyond the final trim edge, used in professional offset printing to prevent white slivers at page edges due to cutting tolerance.

When `bleed: true`:

- The PDF artboard (media box) is expanded by `bleed_mm` on all four sides
- Photos and backgrounds are extended to fill the bleed area
- If `crop_marks: true`, thin registration marks are drawn outside the bleed area to guide the trimmer

**Typical bleed settings:**
- `bleed_mm: 3` — standard for most offset printers
- `bleed_mm: 5` — larger tolerance for some digital printers

The trimmed (finished) page size always matches the `page_size` dimensions; bleed is additive.

---

## Margins — Uniform vs Per-Side vs Duplex

### Uniform margin

Set `margin_mm` to a single value. All four sides use the same margin.

### Per-side margins

Set any of `margin_top`, `margin_right`, `margin_bottom`, `margin_left`. Any field present overrides the `margin_mm` value for that side.

```json
{
  "margin_mm": 10,
  "margin_left": 20
}
```

In the above example, left margin is 20 mm (binding side) and all others are 10 mm.

### Duplex (binding) swap

When a book is printed double-sided and bound, the **inner margin** (binding side) must be wider than the outer. In duplex mode, PhotoBook Studio automatically swaps `margin_left` and `margin_right` on even pages so the wider margin always faces the spine. This is applied at PDF render time — you define margins for odd (recto) pages and the swap is automatic for even (verso) pages.

---

## Caption Style

The `caption_style` object controls how text appears in `"caption"` type slots:

| Field | Type | Description |
|-------|------|-------------|
| `font` | string | Font family name (must be available in the ReportLab font registry) |
| `size` | number | Base font size in points |
| `color` | string | CSS hex color for text (e.g. `"#222222"`) |
| `align` | `"left"` \| `"center"` \| `"right"` | Text alignment |
| `bg` | string | Background fill color for the caption slot (e.g. `"#ffffff"` or `"transparent"`) |

Text is multi-line; long captions are automatically wrapped and, if they exceed the slot height, truncated with an ellipsis.

---

## Photo Badge Configuration

The `badge_config` object in a profile controls the appearance of automatic photo badges (date/location overlays). Badges are enabled or disabled per generation run, but their visual style is defined in the profile.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether badges are active for this profile |
| `show_date` | boolean | `true` | Show the date in the badge |
| `show_location` | boolean | `true` | Show the location (city/state) in the badge |
| `position` | string | `"bottom-left"` | Badge corner: `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"` |
| `shape` | string | `"rounded"` | Badge shape: `"rect"` (sharp corners), `"rounded"`, `"pill"` |
| `bg_color` | string | `"rgba(0,0,0,0.55)"` | Background color (CSS hex or rgba) |
| `text_color` | string | `"#ffffff"` | Text color |
| `font_size` | number | `11` | Font size in points |

Badges are rendered in the PDF export using these settings. In the interactive preview, badges are shown as overlays and can be removed individually per photo (or added via the 3-dot slot menu).

See [Album Generation — Photo Badges](Album-Generation.md#photo-badges) for how badge content is generated.

---

## Color Profiles

The `color_profile` field selects the ICC profile embedded in the exported PDF. This is critical for professional printing because consumer screens use sRGB (additive RGB) while offset presses use CMYK (subtractive ink). Providing the correct ICC profile lets print RIPs convert colors accurately.

| Value | Profile | Color space | Notes |
|-------|---------|------------|-------|
| `srgb` | IEC 61966-2-1 sRGB | RGB | Default. Suitable for home/office printers and digital PDF delivery |
| `adobe_rgb` | Adobe RGB (1998) | RGB | Wider gamut than sRGB. Falls back to sRGB if not bundled |
| `fogra39` | ISO Coated v2 (FOGRA39) | CMYK | European offset print standard. Bundled |
| `fogra51` | ISO Coated v2 300% (FOGRA51) | CMYK | Lower ink limit variant. Falls back to sRGB if not bundled |
| `swop` | SWOP v2 | CMYK | US offset standard. Falls back to sRGB if not bundled |

Profiles marked as **bundled** are included in the Docker image inside `backend/icc/`. Profiles that fall back to sRGB are not included due to licensing restrictions; you can add them manually to the container if needed.

### Why CMYK matters

sRGB PDFs are technically valid for print, but colors may shift when the press RIP converts them. If you are ordering from a professional printer, ask which ICC profile they require — most European printers specify FOGRA39. Use `fogra39` for the most predictable output.

---

## Export DPI Guide

The `export_dpi` field controls the resolution at which photos are rasterised when embedded in the PDF. Higher DPI means larger files and longer export times.

| DPI | Use case | File size |
|-----|---------|-----------|
| 150 | Screen/web PDF, quick proofing | Small |
| 200 | Low-cost digital print | Medium |
| 300 | Standard professional print (recommended) | Medium-large |
| 400 | High-quality print with fine detail | Large |
| 600 | Maximum quality, large-format printing | Very large |

**Recommendation:** use **300 DPI** for standard photobooks ordered from a print-on-demand service. 150 DPI is sufficient for on-screen proofing. 600 DPI is only necessary for very large format prints (A2+) or extreme close-up detail.

The actual rendered resolution also depends on the source photo resolution in Immich. If the source image is lower resolution than `export_dpi` requires for the slot size, Pillow will upscale it (with interpolation), which may produce visible softness. The quality scoring system (see [Album Generation](Album-Generation.md)) penalises low-resolution photos to avoid this.
