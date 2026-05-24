# Preview and Export

The **Preview** page (`/preview`) is the interactive editor where you review and fine-tune the generated layout before exporting. This page documents every editing feature and both export formats (PDF and SVG ZIP).

---

## Table of Contents

- [Interactive Preview Features](#interactive-preview-features)
- [Page Manipulation](#page-manipulation)
- [Photo Swap and Assignment](#photo-swap-and-assignment)
- [Inline Captions](#inline-captions)
- [Cover Editor](#cover-editor)
- [Divider Pages](#divider-pages)
- [Two-Page Spread View](#two-page-spread-view)
- [Export Modal](#export-modal)
- [PDF Export — Technical Details](#pdf-export--technical-details)
- [SVG Export — Technical Details](#svg-export--technical-details)
- [Caption Sync to Immich](#caption-sync-to-immich)

---

## Interactive Preview Features

The preview page renders each book page as a scalable representation using the slot geometry defined in the print profile. The page list is shown as a vertical scroll of page thumbnails.

### Pan and Zoom

Each page in the preview supports:

- **Zoom**: scroll wheel or pinch gesture to zoom into a page for detailed inspection
- **Pan**: click-and-drag to pan the view while zoomed in

This allows you to verify face cropping, caption text, and small-detail layout decisions without exporting.

### Keyboard Navigation

- Arrow keys step through pages
- `Escape` exits zoom mode
- `Z` resets zoom to fit

---

## Page Manipulation

### Add Page

Click **Add page** (+ button in the sidebar or toolbar) to insert a blank page. You can then assign photos to its slots manually.

### Remove Page

Click the **Delete** icon on any page to remove it from the book. Photos that were assigned to the deleted page are returned to the unassigned pool.

### Reorder Pages

Pages can be reordered by drag-and-drop in the page list sidebar. The rendering order updates immediately.

### Change Page Layout

Each page has a **layout picker** accessible from its context menu. Selecting a different page type (slot layout) from the profile recalculates slot positions for the current photo assignments. If the new layout has fewer slots than the current one, surplus photos are unassigned.

---

## Photo Swap and Assignment

### Swapping Between Slots

You can drag a photo from one slot to another (within the same page or across pages) to reorder them. The face-aware crop is recalculated automatically when a photo is moved to a slot with a different aspect ratio.

### Replacing a Photo

Click on any filled slot and choose **Replace** to open the asset picker. The picker shows all unassigned photos from the current album. You can also search by filename or date.

### Unassigning a Photo

Right-click a slot (or use the context menu) and choose **Remove photo**. The slot becomes empty and the photo returns to the unassigned pool.

### Unassigned Photos Pool

The **Unassigned** panel (accessible from the sidebar) shows all photos from the album that have not been placed on any page. You can drag photos from this panel onto empty slots.

---

## Inline Captions

Caption slots (type `"caption"` in the page type definition) show an inline text field in the preview.

- Click any caption slot to enter edit mode
- Type or paste your text; multi-line text is supported
- Press `Enter` for a new line, `Escape` or click outside to confirm
- The caption text is stored in the page JSON and rendered verbatim in the exported PDF/SVG

Caption text is independent per slot. When a photo also has a description in Immich, the description is pre-filled into the caption slot during layout generation, but you can overwrite it.

See [Caption Sync to Immich](#caption-sync-to-immich) for how to write captions back.

---

## Cover Editor

The **Cover** editor is accessible via the **Cover** tab at the top of the Preview page (or via the **Edit Cover** button).

The cover editor shows:
- **Front cover** (right side, recto)
- **Spine** (centre strip, width estimated from page count and `body_paper_gsm`)
- **Back cover** (left side, verso)
- **Front/back flaps** (if the profile defines them)

Each cover section uses the slot definitions from the `cover` array in the print profile. You can:
- Assign photos to cover photo slots
- Edit caption/title text in cover caption slots
- Change the cover layout (using page type templates from the profile)

The estimated spine width is displayed and updated dynamically as you add or remove pages.

---

## Divider Pages

**Divider pages** are special pages inserted automatically between event clusters during smart layout generation. They serve as visual section breaks.

A divider page typically contains:
- An event title (date range, location name if GPS reverse-geocoding is available)
- A GPS map showing the cluster's photo locations
- A full-bleed photo from the cluster (the highest-quality image)

You can:
- **Edit divider text** inline (same as caption editing)
- **Replace the background photo** by clicking the photo slot
- **Delete a divider** if you prefer a seamless flow between sections
- **Add a divider** manually between any two pages via the right-click page context menu

---

## Two-Page Spread View

Click **Spread view** (or press `S`) to switch from single-page to two-page spread display. This simulates the open book showing left (verso) and right (recto) pages side by side.

Spread view is useful for:
- Checking that photos do not create distracting visual conflicts across the spine
- Verifying that full-bleed photos that span both pages (if supported by your profile) are aligned
- Reviewing the overall rhythm of the book

Note: full cross-page (bleed-across-spine) photo slots are not currently supported; each page is independent.

---

## Export Modal

Click **Export** (top-right button in the preview toolbar) to open the export modal.

### Export Options

| Option | Description |
|--------|-------------|
| **Format** | PDF or SVG ZIP |
| **DPI** | Override the profile's `export_dpi` for this export (150–600) |
| **Color profile** | Override the profile's `color_profile` for this export |
| **Include cover** | Whether to include the cover pages in the export |
| **Page range** | Export all pages or a specific range (e.g. pages 3–10 for a reprint) |
| **Bleed** | Toggle bleed on/off for this export (overrides profile setting) |
| **Crop marks** | Toggle crop marks (only available if bleed is enabled) |

After clicking **Export**, the server generates the file and the browser automatically downloads it when ready. Large books (300 DPI, 100+ pages) may take 30–90 seconds.

Available ICC profiles are fetched from `GET /api/export/color_profiles` and listed in the modal dropdown.

---

## PDF Export — Technical Details

The PDF is generated by `backend/pdf_generator.py` using **ReportLab**.

### Process

1. **Page setup**: ReportLab canvas is created at the artboard size (trim size + bleed on all sides if enabled)
2. **Photo download**: full-resolution photos are downloaded from Immich (or demo URLs) asynchronously, up to `concurrent_hires_downloads` at a time (default: 4)
3. **Photo processing** (per photo, via Pillow):
   - Crop to the stored crop rectangle
   - Resize to the slot size at `export_dpi` (bilinear interpolation)
   - If CMYK profile selected: apply ICC color transform using Pillow's `ImageCms`
   - JPEG-encode at `jpeg_quality` (default: 92)
4. **Page rendering** (ReportLab, per page):
   - Draw background (white or profile-defined color)
   - For each photo slot: draw the JPEG image at computed coordinates
   - For each caption slot: draw text with `caption_style` (font, size, color, alignment, background fill)
   - For GPS map slots (title/divider): draw the map image generated by `map_generator.py`
5. **Bleed and crop marks**: if `bleed` enabled, extend background fills to the bleed edge; if `crop_marks` enabled, draw 0.25 pt lines at each corner outside the bleed area with `bleed_mark_length_mm` length
6. **ICC embedding**: the selected ICC output profile is embedded in the PDF's `OutputIntents` dictionary
7. **Spine and cover**: cover pages are rendered first (front cover, then body pages, then back cover)

### Title Page

The title page (page 1) includes:
- A full-bleed GPS map covering the top `title_page_map_height_frac` (default: 0.6 = 60%) of the page
- A gradient overlay blending the map into the page background
- Album title text (from Immich album name) in large display type
- Date range of the album's photos

### Margin Handling

Margins are applied as offsets to all slot coordinates. For duplex (double-sided) printing, `margin_left` and `margin_right` are swapped on even-numbered pages (verso pages) so the wider binding margin is always on the spine side.

---

## SVG Export — Technical Details

The SVG export is generated by `backend/svg_exporter.py`.

### Process

1. For each page, a standalone SVG document is created at the trim size (in mm, with `viewBox` in mm)
2. Photos are downloaded, cropped, resized (max dimension: `max_image_dimension_px`, default: 2000 px), and JPEG-encoded
3. Each JPEG is base64-encoded and embedded as a `<image xlink:href="data:image/jpeg;base64,…">` element
4. Caption text is rendered as `<text>` SVG elements with the `caption_style` attributes
5. GPS maps are embedded as base64 images in the same way
6. If bleed is enabled, crop mark lines are drawn as `<line>` elements outside the trim box
7. All page SVG files are bundled into a **ZIP archive** and written to `/data/exports/{uuid}.zip`

### Advantages of SVG Export

- Pages are **fully editable** in vector editors (Inkscape, Adobe Illustrator, Affinity Designer)
- Text remains as `<text>` elements (not rasterised), so it can be restyled
- Useful for print shops that prefer vector-based files or need to make final adjustments

### Limitations

- Photos are embedded as rasterised JPEG (not vector) — SVG does not support re-editing photo crops
- ICC color management is not embedded in SVG files; manage color profiles at the application layer before export

---

## Caption Sync to Immich

PhotoBook Studio can **write captions back to Immich** so the descriptions you craft in the book editor are preserved in your Immich library.

### How It Works

When you click **Sync captions to Immich** (in the Preview toolbar or Export modal), the frontend sends the current caption data to the backend. For each photo that has a non-empty caption:

```
PUT /api/assets/{asset_id}   (Immich API)
Body: { "description": "<caption text>" }
```

This is executed via `immich_client.update_asset_description(asset_id, description)`.

The caption is stored in Immich as the asset's EXIF **ImageDescription** field.

### Requirements

- The Immich API key must have `Asset:Update` permission
- Demo mode does not support caption sync (writes are silently discarded)

### Conflict Behaviour

Caption sync is a one-way write: it overwrites the existing Immich description for each asset without checking for conflicts. If another user or process updated the description in Immich between the last load and the sync, those changes will be overwritten. There is no merge/diff mechanism.
