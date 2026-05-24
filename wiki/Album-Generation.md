# Album Generation

Album generation is the process of transforming a raw list of Immich assets into an ordered sequence of pages with photos assigned to slots. This page documents every step of the pipeline, the algorithms involved, and all configurable parameters.

The main generation code lives in `backend/album_generator.py` (~1434 lines) and `backend/smart_layout.py` (~654 lines), coordinated through `backend/layout_engine.py` (~397 lines).

---

## Table of Contents

- [Pipeline Overview](#pipeline-overview)
- [Step 1 — Temporal Clustering](#step-1--temporal-clustering)
- [Step 2 — Quality Scoring](#step-2--quality-scoring)
- [Step 3 — Duplicate Removal](#step-3--duplicate-removal)
- [Step 4 — Face Detection](#step-4--face-detection)
- [Step 5 — Layout Selection](#step-5--layout-selection)
- [Step 6 — Slot Assignment and Face-Aware Crop](#step-6--slot-assignment-and-face-aware-crop)
- [Rhythm Alternation](#rhythm-alternation)
- [GPS Map Fill](#gps-map-fill)
- [Photo Badges](#photo-badges)
- [Event Caption Pages](#event-caption-pages)
- [Density Parameter](#density-parameter)
- [Smart Layout Pipeline](#smart-layout-pipeline)
- [Deep Config Parameters](#deep-config-parameters)

---

## Pipeline Overview

```
Immich asset list  (EXIF, GPS, face bbox, description)
        │
        ▼
1. cluster_events()
   Group photos into temporal events (time-gap based)
        │
        ▼
2. score_quality()
   Assign a quality score to each photo
        │
        ▼
3. remove_duplicates()
   Drop near-duplicate and burst shots
        │
        ▼
4. _get_all_faces()
   Parse face bounding boxes from Immich metadata
        │
        ▼
5. _select_template()
   Choose best page layout type for each group/page
        │
        ▼
6. _assign_slots()
   Assign photos to slots; compute face-aware crop rectangle
        │
        ▼
   List of Page objects  →  JSON response to browser
```

Each step is configurable via the [Deep Config](#deep-config-parameters) system.

---

## Step 1 — Temporal Clustering

### Purpose

Group photos into **events** (e.g. "morning hike", "dinner") so that each event gets its own section in the book, potentially with a divider page between sections.

### Algorithm

1. Sort all assets by `exif.dateTimeOriginal` (falls back to `fileCreatedAt`)
2. Iterate through the sorted list; compute the time delta between consecutive photos
3. If the delta exceeds the **cluster gap threshold** (default: 60 minutes), start a new cluster
4. Each cluster becomes an independent unit for layout

### When clustering is disabled

If the user disables clustering in the generation options, all photos are placed in a single cluster and treated as one continuous sequence.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cluster_gap_minutes` | 60 | Time gap (minutes) that triggers a new event cluster |
| `min_cluster_size` | 2 | Clusters with fewer photos than this are merged into the previous cluster |

---

## Step 2 — Quality Scoring

### Purpose

Rank photos so that the best ones get priority placement (full-page slots, prominent positions) and very low-quality photos can be filtered out or relegated to smaller slots.

### Score Formula

```
quality_score = (w_resolution × score_resolution)
              + (w_sharpness  × score_sharpness)
              + (w_brightness × score_brightness)
```

All component scores are normalised to `[0, 1]` before weighting.

### Resolution Score

```
score_resolution = min(1.0, (width × height) / (megapixel_reference × 1_000_000))
```

`megapixel_reference` (default: 12 MP) is the reference target. Photos at or above this resolution score 1.0; below it, the score scales linearly.

### Sharpness Score

Sharpness is estimated using the **Laplacian variance** of the image:

1. Decode the thumbnail (downloaded via Immich thumb endpoint)
2. Convert to grayscale
3. Apply a Laplacian kernel (edge detection)
4. Compute the variance of the resulting map

```
score_sharpness = min(1.0, laplacian_variance / sharpness_variance_divisor)
```

High variance = sharp edges = high sharpness. `sharpness_variance_divisor` (default: 500) is the normalisation divisor.

### Brightness Score

```
mean_brightness = mean pixel value of grayscale thumbnail  (0–255)
score_brightness = 1 - |mean_brightness - brightness_target| / brightness_target
```

`brightness_target` (default: 128) is the ideal mean brightness. Very dark or very blown-out photos score lower.

### Filtering

Photos with `quality_score < min_quality_threshold` are dropped from the layout. This threshold defaults to 0.2 and can be raised to enforce stricter quality requirements.

### Weights

| Parameter | Default |
|-----------|---------|
| `weight_resolution` | 0.4 |
| `weight_sharpness` | 0.4 |
| `weight_brightness` | 0.2 |

---

## Step 3 — Duplicate Removal

### Purpose

Remove redundant shots: near-identical frames from burst shooting, or accidentally duplicated imports.

### dHash (Difference Hash)

dHash is a **perceptual hash** algorithm:

1. Resize thumbnail to `(dhash_size + 1) × dhash_size` pixels (default: 9×8 = 72 pixels)
2. Convert to grayscale
3. For each row, compare adjacent pixel brightness: if left > right → bit 1, else → bit 0
4. Result: a 64-bit hash

Two photos are considered duplicates if their dHash Hamming distance is below the **duplicate threshold** (default: 0.83, meaning ≤ 83% of bits differ — equivalently, ≥ 17% similarity).

```
are_duplicates = (hamming_distance(hash_a, hash_b) / hash_bits) <= duplicate_threshold
```

When duplicates are found, the one with the **higher quality score** is kept; the others are discarded.

### Burst Detection

In addition to perceptual hashing, burst shots are detected by combining two signals:

- **Same GPS location**: GPS coordinates rounded to `gps_coord_rounding` decimal places (default: 3, ≈ 111 m precision) must match
- **Short time window**: photos taken within `burst_time_window_base_sec` seconds of each other (default: 10 s)

When both conditions are met, the group is treated as a burst and only the highest-quality photo is retained.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dhash_size` | 8 | Hash grid dimension (produces `dhash_size²` bits) |
| `duplicate_threshold` | 0.83 | Hamming distance ratio threshold |
| `burst_time_window_base_sec` | 10 | Max seconds between burst frames |
| `gps_coord_rounding` | 3 | Decimal places for GPS rounding in burst detection |

---

## Step 4 — Face Detection

### How Immich Provides Face Data

Immich performs face recognition automatically when the feature is enabled. For each asset, the Immich API returns an array of face objects, each with:

- `boundingBoxX1`, `boundingBoxY1`, `boundingBoxX2`, `boundingBoxY2` — pixel coordinates of the face bounding box
- `imageWidth`, `imageHeight` — full image dimensions (used for normalisation)
- `person.id`, `person.name` — linked person identity (if assigned)

PhotoBook Studio normalises these to the `[0.0, 1.0]` range:

```
face_x1 = boundingBoxX1 / imageWidth
face_y1 = boundingBoxY1 / imageHeight
face_x2 = boundingBoxX2 / imageWidth
face_y2 = boundingBoxY2 / imageHeight
```

### Merging Overlapping Boxes

When a photo contains multiple faces (e.g. a group photo), `_get_face_region()` computes a **merged bounding box** that encompasses all detected faces:

```
merged_x1 = min(face.x1 for all faces)
merged_y1 = min(face.y1 for all faces)
merged_x2 = max(face.x2 for all faces)
merged_y2 = max(face.y2 for all faces)
```

This merged box is used as the target for face-aware cropping.

### Face Size Classification

- **Prominent face**: face bounding box area > `prominent_threshold` (default: 0.05 = 5% of image area). These photos are preferred for full-page or large slots.
- **Close-up**: face bounding box area > `close_up_threshold` (default: 0.15). These are strongly preferred for full-page slots.

---

## Step 5 — Layout Selection

### Template Scoring

For each page (or event group), the algorithm scores every available **page type** (slot layout) from the profile:

```
template_score = base_score
               - penalty_orientation_violation  (if photo orientation ≠ slot orientation)
               - penalty_empty_caption_slot      (if no caption text available)
               + bonus_caption_match             (if caption slot available AND text present)
               - face_clip_penalty_weight × estimated_face_clip_fraction
               - rhythm_alternation_penalty      (if same template used on previous page)
               - layout_reuse_penalty × reuse_count
```

The template with the highest score is selected for that page.

### Face-Based Override

Photos with prominent faces (`prominent_threshold`) skip the scoring and are directly assigned to the **full-page slot** if one is available in the profile. This ensures portraits are never relegated to tiny slots.

Photos with the **"favorite"** flag set in Immich also receive preferential full-page placement.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `penalty_orientation_violation` | 2.0 | Score penalty when photo and slot orientation mismatch |
| `penalty_empty_caption_slot` | 0.5 | Penalty for wasting a caption slot |
| `bonus_caption_match` | 1.0 | Bonus when a caption slot is used and text is available |
| `face_clip_penalty_weight` | 3.0 | Weight for penalising layouts that would clip faces |
| `rhythm_alternation_penalty` | 0.3 | Penalty for using the same layout as the previous page |
| `layout_reuse_penalty` | 0.1 | Additional penalty per additional consecutive reuse |

---

## Step 6 — Slot Assignment and Face-Aware Crop

### Assignment

Once a template is selected for a page, photos are assigned to slots. The assignment tries to match photo orientation to slot orientation (landscape photo → landscape slot, portrait photo → portrait slot). If there are more photos than slots, the surplus photos are carried to the next page.

### Face-Aware Crop

For each `"photo"` slot, a **crop rectangle** is computed so that the subject's face stays centred and visible in the rendered slot.

The algorithm:

1. Compute the slot's aspect ratio: `slot_w / slot_h`
2. Crop the source image to this aspect ratio (maximising the crop area)
3. If the photo has face data:
   a. Compute the centre of the merged face bounding box: `(face_cx, face_cy)`
   b. Apply `target_y_position` bias (default: 0.35) — faces are positioned slightly above centre (rule-of-thirds)
   c. Translate the crop window so the face centre lands at `target_y_position × crop_height` from the top
   d. Check **clip avoidance**: if the crop window would clip any face box edge by more than `clip_check_margin` (default: 0.05 = 5%), shift the crop window to include the full face
   e. Apply `pan_margin` (default: 0.1) — keep a buffer of at least 10% of crop dimension around the face to avoid a too-tight frame
4. If no face data: centre-crop

The result is a `{crop_x, crop_y, crop_w, crop_h}` rectangle expressed as pixel coordinates in the full-resolution image, which is stored in the page JSON and used at PDF/SVG render time.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `min_face_size` | 0.02 | Minimum face bbox area fraction to consider (smaller faces are ignored) |
| `clip_check_margin` | 0.05 | Fraction of crop dimension below which face clipping is tolerated |
| `prominent_threshold` | 0.05 | Face area fraction above which a face is "prominent" |
| `pan_margin` | 0.1 | Minimum buffer around face as fraction of crop dimension |
| `target_y_position` | 0.35 | Vertical position of face centre in crop (0 = top, 1 = bottom) |
| `close_up_threshold` | 0.15 | Face area fraction above which photo is treated as close-up |

---

## Rhythm Alternation

Rhythm alternation prevents the book from feeling monotonous by penalising the reuse of the same page layout on consecutive pages. This is controlled by `rhythm_alternation_penalty` and `layout_reuse_penalty` in the scoring formula.

A healthy book alternates between:
- Full-page spreads (single large photo)
- Multi-slot pages (2–4 photos)
- Caption pages (text + photo)
- Divider pages (GPS map or event header)

---

## GPS Map Fill

When a page slot cannot be filled with a photo (because the cluster has fewer photos than slots), the slot can be filled with a **GPS map** instead of leaving it empty.

The map is generated by `map_generator.py`:
- Collects all GPS coordinates from photos in the current cluster
- Clusters nearby points and draws a route line connecting them chronologically
- Renders a tile image (Stadia Maps or OSM staticmap)
- Coloured markers are placed at each GPS cluster

Map fill is triggered automatically when the `use_map_fill` option is enabled in generation options.

Map parameters are configurable:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `marker_color` | `"#e74c3c"` | Hex color for GPS markers |
| `marker_size` | 8 | Marker radius in pixels |
| `route_width` | 2 | Route line width in pixels |
| `background_color` | `"#f8f9fa"` | Fallback background color |
| `grid_color` | `"#dee2e6"` | Grid line color |
| `grid_lines` | 5 | Number of grid lines per axis |
| `bbox_padding_deg` | 0.05 | Degrees of padding around GPS bounding box |

---

## Photo Badges

When **Photo Badges** is enabled in the generation options, each photo can display a small label overlay showing its date and/or location.

### Badge data sources

- **Date**: taken from the EXIF `dateTimeOriginal` field, formatted as `day month year` (e.g. `12 March 2024`). Month names follow the language set in the configuration (Italian or English).
- **Location**: city or state from the Immich EXIF data (`city` field, falling back to `state`).

### Badge deduplication

If multiple photos on the same page would produce identical badge text, only the first photo on that page shows the badge. Subsequent photos with the same badge text have it removed to avoid visual repetition.

### Badge appearance

Badge style (shape, position, colors, font size) is configured per profile — see [Print Profiles — Photo Badge Configuration](Print-Profiles.md#photo-badge-configuration).

### Interactive editor

In the preview editor, badges are shown as overlays on each photo. You can:
- Remove a badge by clicking the **✕** button on it.
- Add a badge to any photo that has date or location data via the **3-dot menu → Add badge**.

Badges are rendered in the exported PDF using the profile's badge configuration.

---

## Event Caption Pages

When both **Temporal Clustering** and **Event Caption Pages** are enabled, the first page of each event cluster automatically receives a caption overlay showing the cluster's date range and majority location.

### Caption text format

```
12–15 March 2024 · Florence
```

Date range spans from the first to the last photo in the cluster. If both dates are in the same month, only the day range is shown (`12–15 March 2024`). If they span months, both are written in full (`28 Feb – 3 March 2024`). Month names follow the configured language.

The location is the city/state that appears most frequently across photos in the cluster (GPS majority vote).

### Page type selection

The event caption is placed in a **caption slot** on the first page of the cluster — never on a full-page-photo layout. The algorithm looks for a page type in the profile that has **both at least one photo slot and at least one caption slot**. If no such mixed page type exists in the profile, the automatic caption is skipped for that cluster.

---

## Density Parameter

The **density** setting controls how many photos are packed per page on average. It is a multiplier applied to the slot count when selecting templates:

- `density = 1.0` (default) — use the natural slot count of each template
- `density < 1.0` — prefer templates with fewer slots (more whitespace, larger photos)
- `density > 1.0` — prefer templates with more slots (more photos per page, smaller)

This is a user-facing option in the **AlbumsPage** generation form, not a deep-config parameter.

---

## Smart Layout Pipeline

`smart_layout.py` wraps `album_generator` to provide a higher-level **auto-layout** mode accessible via `POST /api/generate/smart`.

Differences from standard generation:

1. Iterates over all clusters and generates pages cluster by cluster
2. Inserts **divider pages** automatically between clusters (with event date/location header)
3. Runs an additional pass to balance page counts per cluster (avoids one section being much longer than others)
4. Attempts to place the **best photo** from each cluster on its first page

Smart layout is the recommended starting point for a new book; the result can then be fine-tuned in the interactive preview.

---

## Deep Config Parameters

All generation parameters are managed through the [Deep Config system](Configuration.md#deep-config-system). They are grouped into sections:

| Section | Parameters |
|---------|-----------|
| `quality` | `sharpness_variance_divisor`, `brightness_target`, `megapixel_reference`, `histogram_bins`, `weight_resolution`, `weight_sharpness`, `weight_brightness` |
| `face` | `min_face_size`, `clip_check_margin`, `prominent_threshold`, `pan_margin`, `target_y_position`, `close_up_threshold` |
| `duplicates` | `dhash_size`, `duplicate_threshold`, `burst_time_window_base_sec`, `gps_coord_rounding` |
| `layout_scoring` | `penalty_orientation_violation`, `penalty_empty_caption_slot`, `bonus_caption_match`, `face_clip_penalty_weight`, `rhythm_alternation_penalty`, `layout_reuse_penalty` |
| `map` | `marker_color`, `marker_size`, `route_width`, `background_color`, `grid_color`, `grid_lines`, `bbox_padding_deg` |
| `pdf` | `jpeg_quality`, `bleed_mark_length_mm`, `title_page_map_height_frac`, `caption_font_size_factor` |
| `svg` | `max_image_dimension_px`, `jpeg_quality`, `title_font_size` |
| `performance` | `max_hires_photos`, `concurrent_hires_downloads`, `concurrent_thumb_downloads`, `pdf_timeout_per_page_sec` |

See [Configuration — Deep Config System](Configuration.md#deep-config-system) for how to edit these parameters.
