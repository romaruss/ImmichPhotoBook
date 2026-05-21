"""
smart_layout.py — Layout automatico intelligente per fotolibri

Pipeline:
  1. cluster_events()        → raggruppa per gap temporale (configurabile on/off)
  2. score_quality()         → punteggio risoluzione+nitidezza+luminosità
  3. remove_duplicates()     → elimina foto simili (istogramma normalizzato, fix bug)
  4. _get_face_region()      → estrae bbox volti da metadati Immich
  5. _select_template()      → sceglie layout: priorità a "full page" per preferiti e foto con volti grandi
  6. _assign_slots()         → assegna foto agli slot con crop centrato sui volti
  7. smart_generate_layout() → entry point, ritorna pages + suggested_transforms
"""

import io
import math
import logging
from datetime import datetime
from typing import Optional
from PIL import Image, ImageFilter
from config_loader import cfg

# Re-use the production-quality face detection from album_generator
from album_generator import (
    _get_all_faces as _ag_get_all_faces,
    _get_face_region as _ag_get_face_region,
    _face_transform as _ag_face_transform,
    _face_would_be_clipped as _ag_face_would_be_clipped,
    _merged_face as _ag_merged_face,
    _display_dims as _ag_display_dims,
    _get_page_ar as _ag_page_ar,
)

logger = logging.getLogger(__name__)

# ─── Configurazione runtime ────────────────────────────────────────────────────

_DEFAULTS: dict = {
    "event_gap_min":        60,
    "event_clustering":     True,    # on/off del clustering temporale
    "min_quality":          0.05,
    "similarity_threshold": 0.97,    # ora correttamente in [0,1]
    "max_per_page":         6,
    "remove_duplicates":    True,
    "quality_filter":       True,
    "rhythm_alternation":   True,
    "favorite_full_page":   True,    # foto preferite → pagina intera
    "face_aware_crop":      True,    # centra sulle facce, evita il taglio
}

_config: dict = dict(_DEFAULTS)

def apply_config(cfg: dict):
    global _config
    _config = {**_DEFAULTS, **cfg}

apply_config({})

# ─── 1. Clustering temporale ──────────────────────────────────────────────────

def _parse_dt(s: str) -> Optional[datetime]:
    if not s:
        return None
    clean = s.replace("T", " ").replace("Z", "")[:19]
    for fmt, n in [("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16), ("%Y-%m-%d", 10)]:
        try:
            return datetime.strptime(clean[:n], fmt)
        except ValueError:
            continue
    return None


def cluster_events(assets: list[dict]) -> list[list[dict]]:
    """
    Raggruppa le foto in eventi. Se event_clustering è False,
    ritorna tutto in un unico evento.
    """
    if not assets:
        return []
    if not _config.get("event_clustering", True):
        return [list(assets)]   # tutti in un evento unico

    gap_min = float(_config.get("event_gap_min", 60))
    sorted_assets = sorted(assets, key=lambda a: a.get("localDateTime", ""))
    events: list[list[dict]] = [[sorted_assets[0]]]

    for asset in sorted_assets[1:]:
        prev_dt = _parse_dt(events[-1][-1].get("localDateTime", ""))
        curr_dt = _parse_dt(asset.get("localDateTime", ""))
        new_event = False
        if prev_dt and curr_dt:
            gap = (curr_dt - prev_dt).total_seconds() / 60.0
            if gap > gap_min:
                new_event = True
        if new_event:
            events.append([])
        events[-1].append(asset)

    return events


# ─── 2. Qualità foto ──────────────────────────────────────────────────────────

def _load_thumb(img_bytes: bytes, max_dim: int = 256) -> Optional[Image.Image]:
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        return img
    except Exception:
        return None


def _sharpness(img: Image.Image) -> float:
    try:
        gray = img.convert("L")
        lap  = gray.filter(ImageFilter.FIND_EDGES)
        pixels = list(lap.getdata())
        mean = sum(pixels) / len(pixels)
        var  = sum((p - mean)**2 for p in pixels) / len(pixels)
        return min(1.0, var / cfg('quality', 'sharpness_variance_divisor'))
    except Exception:
        return 0.5


def _brightness(img: Image.Image) -> float:
    try:
        gray = img.convert("L")
        mean = sum(gray.getdata()) / (img.width * img.height) / 255.0
        return max(0.0, 1.0 - 2.0 * abs(mean - cfg('quality', 'brightness_target')))
    except Exception:
        return 0.5


def _resolution_score(asset: dict) -> float:
    exif = asset.get("exifInfo", {}) or {}
    w = exif.get("exifImageWidth") or exif.get("imageWidth") or 0
    h = exif.get("exifImageHeight") or exif.get("imageHeight") or 0
    mp = (w * h) / 1_000_000
    if mp <= 0:
        fs = asset.get("fileSize") or asset.get("originalFileSize") or 0
        mp = max(0.5, fs / 500_000)
    return min(1.0, mp / cfg('quality', 'megapixel_reference'))


def score_quality(asset: dict, img_bytes: Optional[bytes] = None) -> float:
    res = _resolution_score(asset)
    if img_bytes:
        thumb = _load_thumb(img_bytes)
        if thumb:
            # Sharpness (blur detection) weighted 3× more than resolution
            return cfg('quality', 'weight_resolution') * res + cfg('quality', 'weight_sharpness') * _sharpness(thumb) + cfg('quality', 'weight_brightness') * _brightness(thumb)
    return 0.3 * res + 0.7 * 0.5


# ─── 3. Rimozione duplicati ────────────────────────────────────────────────────

def _color_histogram(img: Image.Image, bins: int | None = None) -> list[float]:
    """Istogramma per canale normalizzato a [0,1] per canale (somma per canale = 1)."""
    if bins is None:
        bins = cfg('quality', 'histogram_bins')
    _thumb_size = cfg('quality', 'histogram_thumb_size')
    img_sm = img.resize((_thumb_size, _thumb_size), Image.LANCZOS)
    hist: list[float] = []
    for ch in range(3):
        channel = [p[ch] for p in img_sm.getdata()]
        bucket  = 256 // bins
        counts  = [0] * bins
        for v in channel:
            counts[min(v // bucket, bins - 1)] += 1
        total = sum(counts) or 1
        hist.extend(c / total for c in counts)
    return hist


def _histogram_similarity(h1: list[float], h2: list[float], n_channels: int = 3) -> float:
    """
    Coefficiente di Bhattacharyya normalizzato in [0,1].
    FIX: divide per n_channels perché ogni canale contribuisce max 1.0.
    """
    raw = sum(math.sqrt(a * b) for a, b in zip(h1, h2))
    return raw / n_channels


def remove_duplicates(
    assets_with_scores: list[tuple[dict, float, Optional[bytes]]]
) -> list[dict]:
    """
    Rimuove foto simili (istogramma colore), tenendo quella con score più alto.
    Score e similarity ora confrontati correttamente.
    """
    ordered = sorted(assets_with_scores, key=lambda x: -x[1])
    kept: list[dict] = []
    histograms: list[list[float]] = []
    do_dedup   = _config.get("remove_duplicates", True)
    do_quality = _config.get("quality_filter", True)
    threshold  = float(_config.get("similarity_threshold", 0.97))

    for asset, score, img_bytes in ordered:
        if do_quality and score < float(_config.get("min_quality", 0.05)):
            logger.debug(f"Quality skip: {asset.get('originalFileName','')} score={score:.3f}")
            continue

        if do_dedup and img_bytes:
            try:
                thumb = _load_thumb(img_bytes)
                if thumb:
                    hist   = _color_histogram(thumb)
                    is_dup = any(_histogram_similarity(hist, ex) > threshold
                                 for ex in histograms)
                    if is_dup:
                        logger.debug(f"Duplicate skip: {asset.get('originalFileName','')}")
                        continue
                    histograms.append(hist)
            except Exception as e:
                logger.debug(f"Histogram error: {e}")

        kept.append(asset)

    return kept


# ─── 4. Analisi volti (face-aware crop) ───────────────────────────────────────

def _get_face_region(asset: dict) -> Optional[dict]:
    """
    Estrae la bounding box del volto principale dall'asset Immich.
    Ritorna {'cx': 0..1, 'cy': 0..1, 'size': 0..1} oppure None.

    Immich (v1.90+) include people[].faces[].boundingBoxX1/Y1/X2/Y2
    come frazioni 0..1 dell'immagine originale.
    """
    people = asset.get("people") or []
    if not people:
        return None

    # Prendi il primo volto della prima persona (il più importante)
    faces = people[0].get("faces") or []
    if not faces:
        return None

    face = faces[0]
    x1 = face.get("boundingBoxX1", 0)
    y1 = face.get("boundingBoxY1", 0)
    x2 = face.get("boundingBoxX2", 1)
    y2 = face.get("boundingBoxY2", 1)

    # Centro e dimensione relativa del volto
    cx   = (x1 + x2) / 2
    cy   = (y1 + y2) / 2
    size = max(x2 - x1, y2 - y1)  # dimensione normalizzata

    return {"cx": cx, "cy": cy, "size": size}


def _face_safe_transform(face: Optional[dict], photo_ar: float, slot_ar: float) -> dict:
    """
    Calcola il transform {x, y, zoom} ottimale per centrare i volti e
    non tagliarli. Se il volto è troppo grande per lo slot, suggerisce zoom.
    """
    if face is None:
        return {"x": 50, "y": 50, "zoom": 1.0}

    # Pan offset: percentuale di spostamento sull'overflow
    pan_x = face["cx"] * 100   # 0-100
    pan_y = face["cy"] * 100   # 0-100

    # Aggiusta leggermente: sposta il volto più in alto (testa non tagliata)
    pan_y = max(10, pan_y - face["size"] * 30)

    return {"x": pan_x, "y": pan_y, "zoom": 1.0}


def _face_fits_slot(face: Optional[dict], photo_ar: float, slot_ar: float) -> bool:
    """
    Verifica se il volto è contenuto nella zona visibile dello slot.
    Ritorna False se lo slot tagliava probabilmente il volto.
    """
    if face is None:
        return True

    face_size = face["size"]

    # Se il volto occupa >30% dell'immagine, è un primo piano importante
    if face_size > cfg('face', 'close_up_threshold'):
        # Il volto deve stare entro l'80% centrale dello slot
        cx, cy = face["cx"], face["cy"]
        if cx < cfg('face', 'lateral_position_min') or cx > cfg('face', 'lateral_position_max'):
            return False   # volto troppo ai bordi laterali
        if cy < cfg('face', 'vertical_position_min') or cy > cfg('face', 'vertical_position_max'):
            return False   # testa troppo vicina al bordo superiore
    return True


# ─── 5. Template layouts ──────────────────────────────────────────────────────

TEMPLATES: dict[str, dict] = {
    # 1 foto
    "full":            {"label":"Pagina intera",           "n":1, "slots":[{"x":0,"y":0,"w":100,"h":100}],                                                                                                        "portrait_ok":True, "landscape_ok":True},
    "portrait_center": {"label":"Ritratto centrato",       "n":1, "slots":[{"x":10,"y":0,"w":80,"h":100}],                                                                                                        "portrait_ok":True, "landscape_ok":False},
    "landscape_hero":  {"label":"Paesaggio hero",          "n":1, "slots":[{"x":0,"y":20,"w":100,"h":60}],                                                                                                        "portrait_ok":False,"landscape_ok":True},
    # 2 foto
    "two_vertical":    {"label":"2 verticali",             "n":2, "slots":[{"x":0,"y":0,"w":50,"h":100},{"x":50,"y":0,"w":50,"h":100}],                                                                          "portrait_ok":True, "landscape_ok":False},
    "two_horizontal":  {"label":"2 orizzontali",           "n":2, "slots":[{"x":0,"y":0,"w":100,"h":50},{"x":0,"y":50,"w":100,"h":50}],                                                                          "portrait_ok":False,"landscape_ok":True},
    "hero_side":       {"label":"Hero + lato",             "n":2, "slots":[{"x":0,"y":0,"w":65,"h":100},{"x":65,"y":0,"w":35,"h":100}],                                                                          "portrait_ok":True, "landscape_ok":False},
    "hero_strip":      {"label":"Hero + striscia",         "n":2, "slots":[{"x":0,"y":0,"w":100,"h":70},{"x":0,"y":70,"w":100,"h":30}],                                                                          "portrait_ok":False,"landscape_ok":True},
    "asym_top":        {"label":"Grande sopra",            "n":2, "slots":[{"x":0,"y":0,"w":100,"h":62},{"x":0,"y":62,"w":100,"h":38}],                                                                          "portrait_ok":True, "landscape_ok":True},
    # 2 foto + didascalia
    "photo_caption_v": {"label":"Foto + didascalia lat.",  "n":2, "slots":[{"x":0,"y":0,"w":68,"h":100},{"x":68,"y":0,"w":32,"h":100}],                                                                          "portrait_ok":True, "landscape_ok":False, "last_is_caption":True},
    "photo_caption_h": {"label":"Foto + didascalia sotto", "n":2, "slots":[{"x":0,"y":0,"w":100,"h":72},{"x":0,"y":72,"w":100,"h":28}],                                                                          "portrait_ok":True, "landscape_ok":True,  "last_is_caption":True},
    # 3 foto
    "three_top_two":   {"label":"Tre (1+2)",               "n":3, "slots":[{"x":0,"y":0,"w":100,"h":55},{"x":0,"y":55,"w":50,"h":45},{"x":50,"y":55,"w":50,"h":45}],                                            "portrait_ok":False,"landscape_ok":True},
    "three_left_two":  {"label":"Tre (1+2 col.)",          "n":3, "slots":[{"x":0,"y":0,"w":60,"h":100},{"x":60,"y":0,"w":40,"h":50},{"x":60,"y":50,"w":40,"h":50}],                                            "portrait_ok":True, "landscape_ok":False},
    "three_strip":     {"label":"Tre orizzontali",         "n":3, "slots":[{"x":0,"y":0,"w":100,"h":33},{"x":0,"y":33.5,"w":100,"h":33},{"x":0,"y":67,"w":100,"h":33}],                                         "portrait_ok":False,"landscape_ok":True},
    # 4 foto
    "four_grid":       {"label":"Griglia 2×2",             "n":4, "slots":[{"x":0,"y":0,"w":50,"h":50},{"x":50,"y":0,"w":50,"h":50},{"x":0,"y":50,"w":50,"h":50},{"x":50,"y":50,"w":50,"h":50}],               "portrait_ok":True, "landscape_ok":True},
    "four_hero_three": {"label":"Hero + 3 piccole",        "n":4, "slots":[{"x":0,"y":0,"w":65,"h":100},{"x":65,"y":0,"w":35,"h":33},{"x":65,"y":33.5,"w":35,"h":33},{"x":65,"y":67,"w":35,"h":33}],           "portrait_ok":True, "landscape_ok":False},
    # 5 foto
    "five_collage":    {"label":"Collage 5",               "n":5, "slots":[{"x":0,"y":0,"w":60,"h":55},{"x":60,"y":0,"w":40,"h":55},{"x":0,"y":55,"w":33,"h":45},{"x":33,"y":55,"w":33,"h":45},{"x":66,"y":55,"w":34,"h":45}], "portrait_ok":True,"landscape_ok":True},
    # 6 foto
    "six_grid":        {"label":"Griglia 3×2",             "n":6, "slots":[{"x":0,"y":0,"w":33,"h":50},{"x":33.5,"y":0,"w":33,"h":50},{"x":67,"y":0,"w":33,"h":50},{"x":0,"y":50,"w":33,"h":50},{"x":33.5,"y":50,"w":33,"h":50},{"x":67,"y":50,"w":33,"h":50}], "portrait_ok":True,"landscape_ok":True},
}

FULL_TEMPLATE = TEMPLATES["full"]


def _is_portrait(asset: dict) -> bool:
    w, h = _ag_display_dims(asset)
    return (h > w) if (w and h) else True


def _is_favorite(asset: dict) -> bool:
    return bool(asset.get("isFavorite") or asset.get("favorite"))


def _has_large_face(asset: dict) -> bool:
    """True se la foto ha un volto in primo piano (size > 25%)."""
    face = _get_face_region(asset)
    return face is not None and face["size"] > cfg('face', 'large_face_threshold')


def _slot_is_portrait(slot: dict) -> bool:
    return slot.get("h", 0) > slot.get("w", 0)


def _orientation_score(tpl: dict, photos: list[dict]) -> int:
    """
    Conta quante coppie (foto, slot) hanno orientamento corrispondente
    nel template dato. Più alto = template più adatto a queste foto.
    """
    slots = tpl["slots"]
    n = min(len(photos), len(slots))
    portrait_photos  = sum(1 for p in photos[:n] if _is_portrait(p))
    landscape_photos = n - portrait_photos
    portrait_slots   = sum(1 for s in slots[:n] if _slot_is_portrait(s))
    landscape_slots  = n - portrait_slots
    return min(portrait_photos, portrait_slots) + min(landscape_photos, landscape_slots)


def _assign_photos_to_slots_smart(photos: list[dict], slots: list[dict]) -> list[dict | None]:
    """
    Assegna le foto agli slot massimizzando i match di orientamento:
      - foto verticali  → slot verticali
      - foto orizzontali → slot orizzontali
    I residui (numero diverso) vengono assegnati agli slot restanti.
    """
    n = min(len(photos), len(slots))
    photos_n = list(photos[:n])
    slots_n  = list(slots[:n])

    portrait_slot_idx  = [i for i, s in enumerate(slots_n) if _slot_is_portrait(s)]
    landscape_slot_idx = [i for i, s in enumerate(slots_n) if not _slot_is_portrait(s)]
    portrait_photos    = [p for p in photos_n if _is_portrait(p)]
    landscape_photos   = [p for p in photos_n if not _is_portrait(p)]

    result: list[dict | None] = [None] * n

    for si, photo in zip(portrait_slot_idx, portrait_photos):
        result[si] = photo
    for si, photo in zip(landscape_slot_idx, landscape_photos):
        result[si] = photo

    used = set(id(p) for p in result if p is not None)
    leftover = [p for p in photos_n if id(p) not in used]
    empty    = [i for i, r in enumerate(result) if r is None]
    for si, photo in zip(empty, leftover):
        result[si] = photo

    result += [None] * (len(slots) - n)
    return result


def _pick_template(photos: list[dict], prev_density: str) -> dict:
    """
    Sceglie il template migliore per un gruppo di foto.
    Criterio primario: massimizza il numero di coppie (foto, slot) con
    orientamento corrispondente (portrait↔portrait, landscape↔landscape).
    Criterio secondario: ritmo editoriale (alterna denso/minimale).
    """
    n = min(len(photos), int(_config.get("max_per_page", 6)))
    chunk = photos[:n]

    candidates = [
        t for t in TEMPLATES.values()
        if t["n"] == n
        and not t.get("last_is_caption")
    ]
    if not candidates:
        by_n = sorted(TEMPLATES.values(), key=lambda t: abs(t["n"] - n))
        candidates = [by_n[0]]

    # Punteggio orientamento per ogni template candidato
    scored = sorted(
        candidates,
        key=lambda t: (
            -_orientation_score(t, chunk),   # più match = meglio (negato per sort asc)
            # Ritmo: se alternation attivo, penalizza template dello stesso tipo
            (1 if _config.get("rhythm_alternation", True) and
             ((prev_density == "high" and t["n"] >= 3) or
              (prev_density == "low"  and t["n"] <= 2)) else 0),
        )
    )
    return scored[0]



# ─── 6. Costruzione pagine ────────────────────────────────────────────────────

def _make_photo_item(asset: dict) -> dict:
    exif = asset.get("exifInfo", {}) or {}
    desc = (exif.get("description") or asset.get("description") or "").strip()
    return {
        "type":             "photo",
        "asset_id":         asset["id"],
        "description":      desc,
        "originalFileName": asset.get("originalFileName", ""),
        "localDateTime":    asset.get("localDateTime", ""),
        "exif":             exif,
        "has_caption":      bool(desc),
        "isFavorite":       _is_favorite(asset),
        "_updated_at":      asset.get("updatedAt", ""),
    }


def _make_caption_item(asset: dict) -> dict:
    exif = asset.get("exifInfo", {}) or {}
    desc = (exif.get("description") or asset.get("description") or "").strip()
    return {
        "type":             "caption",
        "text":             desc,
        "for_asset_id":     asset["id"],
        "originalFileName": asset.get("originalFileName", ""),
    }


def _photo_ar(asset: dict) -> float:
    w, h = _ag_display_dims(asset)
    return (w / h) if h else 1.0


def _slot_ar(slot: dict, page_ar: float = 1.0) -> float:
    pct_ar = slot["w"] / slot["h"] if slot["h"] else 1.0
    return pct_ar * page_ar


def _build_pages_for_event(
    event_photos: list[dict],
    scored: dict[str, float],
    prev_density: str,
    suggested_transforms: dict,
    page_ar: float = 1.0,
) -> tuple[list[dict], str]:
    """
    Costruisce pagine per un evento:
    - Le foto preferite vanno in pagine intere (se favorite_full_page è attivo)
    - Le foto con volti grandi in primo piano evitano slot che le tagliano
    - Il transform suggerito viene salvato in suggested_transforms
    """
    favor_full = _config.get("favorite_full_page", True)
    face_aware = _config.get("face_aware_crop", True)
    max_pp     = int(_config.get("max_per_page", 6))

    # Separa i preferiti
    favorites = [p for p in event_photos if favor_full and _is_favorite(p)]
    regulars  = [p for p in event_photos if not (favor_full and _is_favorite(p))]

    pages: list[dict] = []
    density = prev_density

    # ── Foto preferite → pagina intera ────────────────────────────────────────
    for fav in favorites:
        p_ar  = _photo_ar(fav)
        transform = _ag_face_transform(_ag_get_all_faces(fav), p_ar, 1.0) if face_aware else {"x":50,"y":50,"zoom":1.0}
        item  = _make_photo_item(fav)
        page_idx = len(pages)   # sarà l'indice nella lista pages
        suggested_transforms[f"_event_page_{page_idx}_0"] = transform
        pages.append({
            "page_type_id": "full",
            "page_type":    {**FULL_TEMPLATE, "label": "Pagina intera (preferita ★)"},
            "items": [{"slot": FULL_TEMPLATE["slots"][0], "item": item}],
        })
        density = "low"

    # ── Foto normali ──────────────────────────────────────────────────────────
    def sort_key(a):
        return (-scored.get(a["id"], 0), a.get("localDateTime", ""))

    sorted_photos = sorted(regulars, key=sort_key)
    remaining = list(sorted_photos)

    while remaining:
        chunk_n = min(max_pp, len(remaining))
        chunk   = remaining[:chunk_n]

        # Controlla se qualche foto ha un volto che non si adatta al template scelto
        tpl = _pick_template(chunk, density)

        # face_aware: check face fit — if solo photo with bad fit, upgrade to full page
        if face_aware and chunk_n == 1:
            all_faces = _ag_get_all_faces(chunk[0])
            face = _ag_merged_face(all_faces)
            p_ar = _photo_ar(chunk[0])
            slot = tpl["slots"][0]
            s_ar = _slot_ar(slot, page_ar)
            if face and _ag_face_would_be_clipped(face, p_ar, s_ar):
                tpl = FULL_TEMPLATE

        remaining = remaining[chunk_n:]

        slots   = [dict(s) for s in tpl["slots"]]
        n_slots = len(slots)

        # ── Orientation-aware slot assignment ─────────────────────────────
        # Separate photo slots from caption slot (last slot if last_is_caption)
        is_cap_tpl = tpl.get("last_is_caption", False)
        photo_slots   = slots[:-1] if is_cap_tpl else slots
        caption_slot  = slots[-1]  if is_cap_tpl else None

        # Assign photos to photo slots respecting orientation
        assigned_photos = _assign_photos_to_slots_smart(chunk, photo_slots)

        items: list[dict] = []
        for si, (slot, photo) in enumerate(zip(photo_slots, assigned_photos)):
            if photo is not None:
                items.append({"slot": slot, "item": _make_photo_item(photo)})
                # Store face transform for this slot
                if face_aware:
                    p_ar  = _photo_ar(photo)
                    s_ar  = _slot_ar(slot, page_ar)
                    transform = _ag_face_transform(_ag_get_all_faces(photo), p_ar, s_ar)
                    key = f"_event_page_{len(pages)}_{si}"
                    suggested_transforms[key] = transform
            else:
                items.append({"slot": slot, "item": None})

        if caption_slot is not None:
            # Use the last assigned photo as caption reference
            ref = next((p for p in reversed(assigned_photos) if p is not None), None)
            if ref:
                exif = ref.get("exifInfo", {}) or {}
                has_desc = (exif.get("description") or ref.get("description") or "").strip()
                items.append({"slot": caption_slot, "item": _make_caption_item(ref) if has_desc else None})
            else:
                items.append({"slot": caption_slot, "item": None})

        density = "high" if n_slots >= 3 else "low"
        tid = f"smart_{tpl['label'].replace(' ', '_').replace('(','').replace(')','').lower()}"
        pages.append({
            "page_type_id": tid,
            "page_type":    {"id": tid, "label": tpl["label"], "slots": slots},
            "items":        items,
        })

    return pages, density


# ─── API pubblica ──────────────────────────────────────────────────────────────

def smart_generate_layout(
    assets: list[dict],
    photo_cache: dict[str, bytes],
    page_ar: float = 1.0,
) -> tuple[list[dict], dict]:
    """
    Entry point principale.

    Ritorna:
      (pages, suggested_transforms)

    pages               — lista di page dict per il frontend
    suggested_transforms — dict {panKey: {x,y,zoom}} con i crop ottimali calcolati
                           dal rilevamento volti. Il frontend li può applicare
                           automaticamente come posizione iniziale di ogni foto.
    """
    if not assets:
        return [], {}

    # Populate display dims from cached thumbnails (reflects Immich rotations/edits)
    for a in assets:
        thumb = photo_cache.get(a["id"])
        if thumb and not a.get("_thumb_w"):
            try:
                with Image.open(io.BytesIO(thumb)) as _img:
                    a["_thumb_w"], a["_thumb_h"] = _img.size
            except Exception:
                pass

    # Score qualità
    scored: dict[str, float] = {
        a["id"]: score_quality(a, photo_cache.get(a["id"]))
        for a in assets
    }

    # Rimozione duplicati (ora con similarity normalizzata [0,1])
    triples = [(a, scored[a["id"]], photo_cache.get(a["id"])) for a in assets]
    filtered = remove_duplicates(triples)
    if not filtered:
        logger.warning("All assets removed by filters, using original list")
        filtered = assets

    logger.info(f"Smart layout: {len(assets)} assets → {len(filtered)} after dedup")

    # Clustering temporale
    events = cluster_events(filtered)
    logger.info(f"Events: {len(events)}")

    all_pages: list[dict] = []
    suggested_transforms: dict = {}
    density = "none"

    for event in events:
        event_pages, density = _build_pages_for_event(
            event, scored, density, suggested_transforms, page_ar
        )
        # Remap transform keys: _event_page_N_SI → "globalPageIdx_SI"
        offset = len(all_pages)
        remapped: dict = {}
        for k, v in list(suggested_transforms.items()):
            if k.startswith("_event_page_"):
                parts = k.split("_")
                page_n, slot_n = int(parts[3]), int(parts[4])
                new_key = f"{page_n + offset}_{slot_n}"
                remapped[new_key] = v
        # Clear event-relative keys and add remapped
        for k in list(suggested_transforms.keys()):
            if k.startswith("_event_page_"):
                del suggested_transforms[k]
        suggested_transforms.update(remapped)
        all_pages.extend(event_pages)

    return all_pages, suggested_transforms


def smart_extract_gps(assets: list[dict]) -> list[dict]:
    from layout_engine import extract_gps_locations
    return extract_gps_locations(assets)
