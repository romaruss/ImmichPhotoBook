"""
album_generator.py — Motore di generazione layout per PhotoBook Studio

Unico punto di ingresso: generate_album(assets, profile, config) → (pages, transforms, log)
"""

from __future__ import annotations
import math, hashlib, re
from datetime import datetime, timedelta
from typing import Any
from config_loader import cfg

Photo  = dict[str, Any]
Slot   = dict[str, float]
Item   = dict[str, Any]
Page   = dict[str, Any]
Log    = list[str]

DEFAULT_CONFIG: dict[str, Any] = {
    "temporal_clustering":   False,
    "event_gap_min":         60,
    "favorites_full_page":   False,
    "face_crop":             True,
    "quality_filter":        False,
    "min_quality":           0.6,
    "remove_duplicates":     False,
    "similarity_threshold":  0.83,
    "rhythm_alternation":    True,
    "density":               75,
    "fill_empty_with_map":   False,
    "photo_badges":          True,
    "event_caption_pages":   True,
}

FALLBACK_PAGE_TYPES = [
    {"id": "f1", "label": "1 foto",       "slots": [{"x":0,"y":0,"w":100,"h":100}]},
    {"id": "f2", "label": "2 affiancate", "slots": [{"x":0,"y":0,"w":50,"h":100},{"x":50,"y":0,"w":50,"h":100}]},
    {"id": "f4", "label": "4 griglia",    "slots": [{"x":0,"y":0,"w":50,"h":50},{"x":50,"y":0,"w":50,"h":50},
                                                     {"x":0,"y":50,"w":50,"h":50},{"x":50,"y":50,"w":50,"h":50}]},
]
FULL_PAGE_TYPE = {"id": "__full__", "label": "Pagina intera", "slots": [{"x":0,"y":0,"w":100,"h":100,"slot_type":"photo"}]}


# ── Helpers fondamentali ───────────────────────────────────────────────────────

# Standard page sizes in mm (width x height)
_PAGE_SIZES_MM = {
    'A4': (210,297), 'A3': (297,420), 'A5': (148,210),
    '20x20': (200,200), '20x30': (200,300), '30x30': (300,300),
    '30x40': (300,400), 'Letter': (216,279),
}

def _get_page_ar(profile: dict) -> float:
    """Physical width/height aspect ratio of the page (including orientation swap)."""
    size = profile.get('page_size', '20x30')
    w, h = _PAGE_SIZES_MM.get(size, (200, 300))
    if size not in _PAGE_SIZES_MM:
        parts = size.split('x')
        if len(parts) == 2:
            try: w, h = float(parts[0]), float(parts[1])
            except: pass
    if profile.get('orientation') == 'landscape':
        w, h = h, w
    return w / h if h else 1.0


def _slot_is_portrait(slot: Slot, page_ar: float = 1.0) -> bool:
    """True if the slot is physically portrait-oriented.
    page_ar: physical w/h of the full page (accounts for orientation).
    slot.w and slot.h are percentages, so actual AR = (w/h) * page_ar."""
    pct_ar = slot.get("w", 1) / slot.get("h", 1) if slot.get("h", 1) else 1.0
    return (pct_ar * page_ar) < 1.0


def _slot_ar(slot: Slot, page_ar: float = 1.0) -> float:
    """Physical AR of the slot = percentage AR multiplied by page AR."""
    pct_ar = slot.get("w", 1) / slot.get("h", 1) if slot.get("h", 1) else 1.0
    return pct_ar * page_ar




def _count_slot_types(slots: list[Slot]) -> tuple[int, int]:
    """Return (n_photo_slots, n_caption_slots). Default is photo if not set."""
    n_caption = sum(1 for s in slots if s.get("slot_type") == "caption")
    n_photo   = len(slots) - n_caption
    return n_photo, n_caption

def _display_dims(photo: Photo) -> tuple[float, float]:
    """
    Ritorna (larghezza_display, altezza_display) tenendo conto dell'orientamento EXIF
    o delle dimensioni effettive della thumbnail Immich (che riflette anche le rotazioni
    applicate dall'utente tramite l'interfaccia di Immich).
    """
    # Prefer thumbnail dims: they reflect Immich UI edits (rotation, crop)
    tw = photo.get("_thumb_w")
    th = photo.get("_thumb_h")
    if tw and th:
        return float(tw), float(th)
    # Fallback: EXIF dims with orientation correction
    exif = photo.get("exifInfo") or {}
    w = float(exif.get("exifImageWidth")  or exif.get("imageWidth")  or 1)
    h = float(exif.get("exifImageHeight") or exif.get("imageHeight") or 1)
    try:
        orient = int(exif.get("orientation") or 1)
    except (ValueError, TypeError):
        orient = 1
    if orient in (5, 6, 7, 8):
        w, h = h, w   # swap: dimensioni fisiche invertite rispetto al display
    return w, h


def _photo_is_portrait(photo: Photo) -> bool:
    w, h = _display_dims(photo)
    return (h > w) if (w and h) else True



def _photo_ar(photo: Photo) -> float:
    w, h = _display_dims(photo)
    return w / h if h else 1.0



def _photo_dt(photo: Photo) -> datetime | None:
    """Parse Immich timestamp. Handles: 2025-07-10T16:58:56, ...Z, ...+00:00, with/without ms."""
    ts = photo.get("localDateTime") or photo.get("fileCreatedAt") or ""
    if not ts:
        return None
    # Strip timezone suffix (Z or +HH:MM) — we only need local time
    ts_clean = ts.replace("Z", "").replace("+00:00", "")
    # Try fixed-length slices (correct approach — NOT len(format_string))
    for fmt, length in [
        ("%Y-%m-%dT%H:%M:%S.%f", 26),
        ("%Y-%m-%dT%H:%M:%S",    19),
        ("%Y-%m-%dT%H:%M",       16),
        ("%Y-%m-%d",             10),
    ]:
        try:
            return datetime.strptime(ts_clean[:length], fmt)
        except Exception:
            pass
    return None



def _photo_quality(photo: Photo) -> float:
    score = 0.5
    exif = photo.get("exifInfo") or {}
    if photo.get("isFavorite"):
        score += 0.3
    w = exif.get("exifImageWidth") or exif.get("imageWidth") or 0
    h = exif.get("exifImageHeight") or exif.get("imageHeight") or 0
    if w and h:
        mp = (w * h) / 1_000_000
        score += min(0.2, mp / 50)
    return min(1.0, max(0.0, score))


# ── Rilevamento volti ──────────────────────────────────────────────────────────



def _get_all_faces(photo: Photo) -> list[dict]:
    """
    Restituisce TUTTI i volti normalizzati dell'asset Immich (coordinate 0..1).

    Immich esegue la face detection sull'immagine ORIENTATA (dopo aver applicato
    il tag EXIF orientation). Le bounding box sono quindi in coordinate display.
    La normalizzazione deve usare le dimensioni DISPLAY (non fisiche), altrimenti
    per le foto con rotation tag le coordinate risultanti sono sbagliate.
    """
    img_w, img_h = _display_dims(photo)

    def normalize_bbox(x1r, y1r, x2r, y2r, face_w=None, face_h=None):
        # Immich stores face detection image dims in face data (imageWidth/imageHeight).
        # The bbox is in that preview space, NOT in the original full-res space.
        # Use face_w/face_h when available; fall back to display dims of original.
        w = face_w if (face_w and face_w > 1) else img_w
        h = face_h if (face_h and face_h > 1) else img_h
        if w > 1 and h > 1 and (x2r > 1.0 or y2r > 1.0):
            x1, y1, x2, y2 = x1r/w, y1r/h, x2r/w, y2r/h
        else:
            x1, y1, x2, y2 = x1r, y1r, x2r, y2r
        x1, y1 = max(0.0, min(1.0, x1)), max(0.0, min(1.0, y1))
        x2, y2 = max(0.0, min(1.0, x2)), max(0.0, min(1.0, y2))
        size = max(x2 - x1, y2 - y1)
        if size < cfg('face', 'min_face_size'):
            return None
        return {"cx": (x1+x2)/2, "cy": (y1+y2)/2, "size": size,
                "x1": x1, "y1": y1, "x2": x2, "y2": y2}

    faces = []
    for person in (photo.get("people") or []):
        for face in (person.get("faces") or []):
            f = normalize_bbox(
                face.get("boundingBoxX1", 0), face.get("boundingBoxY1", 0),
                face.get("boundingBoxX2", 0), face.get("boundingBoxY2", 0),
                face.get("imageWidth"), face.get("imageHeight"),
            )
            if f:
                faces.append(f)
    if not faces:
        for face in (photo.get("faces") or []):
            f = normalize_bbox(
                face.get("boundingBoxX1", 0), face.get("boundingBoxY1", 0),
                face.get("boundingBoxX2", 0), face.get("boundingBoxY2", 0),
                face.get("imageWidth"), face.get("imageHeight"),
            )
            if f:
                faces.append(f)
    return faces


def _get_face_region(photo: Photo) -> dict | None:
    """Restituisce il volto principale (più grande) — usato per scoring e clipping check."""
    faces = _get_all_faces(photo)
    return max(faces, key=lambda f: f["size"]) if faces else None


def _merged_face(faces: list[dict]) -> dict | None:
    """Bbox unito di tutte le facce — usato per il clipping check multi-volto."""
    if not faces:
        return None
    x1 = min(f["x1"] for f in faces)
    y1 = min(f["y1"] for f in faces)
    x2 = max(f["x2"] for f in faces)
    y2 = max(f["y2"] for f in faces)
    return {"x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "cx": (x1+x2)/2, "cy": (y1+y2)/2,
            "size": max(x2-x1, y2-y1)}








def _face_would_be_clipped(face: dict, photo_ar: float, slot_ar: float) -> bool:
    """
    True se NON esiste alcun pan che mantenga il face bbox interamente visibile
    nello slot con margine 5% (stessa logica di _face_transform).

    Metodo: calcola pan_min e pan_max che tengono rispettivamente il bordo
    inferiore/destro e superiore/sinistro del bbox dentro lo slot con MARGIN.
    Se pan_min > pan_max non esiste pan valido → faccia tagliata.
    """
    MARGIN = cfg('face', 'clip_check_margin')
    x1, y1, x2, y2 = face["x1"], face["y1"], face["x2"], face["y2"]

    if abs(photo_ar - slot_ar) < cfg('face', 'clip_check_ar_tolerance'):
        return False

    if photo_ar >= slot_ar:
        # Fit sull'altezza: overflow orizzontale
        ratio_x   = photo_ar / slot_ar
        overflow_x = ratio_x - 1
        if overflow_x < cfg('face', 'clip_check_overflow_min'):
            return False
        pan_x_max = (x1 * ratio_x - MARGIN)       / overflow_x * 100
        pan_x_min = (x2 * ratio_x - (1 - MARGIN)) / overflow_x * 100
        return pan_x_min > pan_x_max
    else:
        # Fit sulla larghezza: overflow verticale
        ratio_y   = slot_ar / photo_ar
        overflow_y = ratio_y - 1
        if overflow_y < cfg('face', 'clip_check_overflow_min'):
            return False
        pan_y_max = (y1 * ratio_y - MARGIN)       / overflow_y * 100
        pan_y_min = (y2 * ratio_y - (1 - MARGIN)) / overflow_y * 100
        return pan_y_min > pan_y_max




def _face_transform(faces: list[dict], photo_ar: float, slot_ar: float) -> dict:
    """
    Calcola il transform {x, y, zoom} per posizionare i volti nel terzo superiore
    dello slot, senza tagliarli.

    Principio (objectFit: cover):
      • photo_ar >= slot_ar → fit sull'ALTEZZA → pan X efficace, pan Y = 50
      • photo_ar < slot_ar  → fit sulla LARGHEZZA → pan Y efficace, pan X = 50

    Strategia per il pan efficace:
      Target: centrare il gruppo di volti al 38% dall'alto dello slot (terzo superiore).
      Formula: pan_target = (face_center * ratio - TARGET) / overflow * 100

      Vincoli (applicati con clamp):
        pan_max: bb_y1 visibile con 5% margine sopra (non tagliare la testa)
        pan_min: bb_y2 visibile con 5% margine sotto (non tagliare il mento)

      Il clamp risolve entrambi i casi:
        - Volto in basso (bb_y ~0.5): pan_target alto → clamped da pan_max → spinge su quanto possibile
        - Volto in alto (bb_y ~0.2): pan_target basso → non clamped → posizione naturale
    """
    prominent = [f for f in faces if f.get("size", 0) >= cfg('face', 'prominent_threshold')] or faces
    if not prominent:
        return {"x": 50.0, "y": 50.0, "zoom": 1.0}

    bb_x1 = min(f["x1"] for f in prominent)
    bb_y1 = min(f["y1"] for f in prominent)
    bb_x2 = max(f["x2"] for f in prominent)
    bb_y2 = max(f["y2"] for f in prominent)
    cx    = (bb_x1 + bb_x2) / 2
    cy    = (bb_y1 + bb_y2) / 2

    MARGIN  = cfg('face', 'pan_margin')   # 5% margine minimo dai bordi slot
    TARGET  = cfg('face', 'target_y_position')   # posiziona il centro dei volti al 38% dall'alto slot

    if photo_ar >= slot_ar:
        # ── Fit sull'altezza: pan X ───────────────────────────────────────────
        ratio_x   = photo_ar / slot_ar
        overflow_x = ratio_x - 1
        if overflow_x > 0.01:
            pan_x_target = (cx * ratio_x - TARGET) / overflow_x * 100
            pan_x_max    = (bb_x1 * ratio_x - MARGIN) / overflow_x * 100
            pan_x_min    = (bb_x2 * ratio_x - (1 - MARGIN)) / overflow_x * 100
            pan_x = max(pan_x_min, min(pan_x_max, pan_x_target))
        else:
            pan_x = cx * 100
        pan_y = 50.0

    else:
        # ── Fit sulla larghezza: pan Y ────────────────────────────────────────
        ratio_y   = slot_ar / photo_ar
        overflow_y = ratio_y - 1
        if overflow_y > 0.01:
            pan_y_target = (cy * ratio_y - TARGET) / overflow_y * 100
            pan_y_max    = (bb_y1 * ratio_y - MARGIN) / overflow_y * 100
            pan_y_min    = (bb_y2 * ratio_y - (1 - MARGIN)) / overflow_y * 100
            pan_y = max(pan_y_min, min(pan_y_max, pan_y_target))
        else:
            pan_y = 50.0
        pan_x = 50.0

    pan_x = max(cfg('face', 'pan_x_min'), min(cfg('face', 'pan_x_max'), pan_x))
    pan_y = max(cfg('face', 'pan_x_min'), min(cfg('face', 'pan_x_max'), pan_y))

    return {"x": round(pan_x, 1), "y": round(pan_y, 1), "zoom": 1.0}








def _has_prominent_face(photo: Photo) -> bool:
    """True se la foto ha un volto che occupa almeno il 10% dell'immagine."""
    face = _get_face_region(photo)
    return face is not None and face["size"] >= cfg('face', 'prominent_threshold')


# ── Rimozione duplicati (corretta) ────────────────────────────────────────────

def _hamming(a: int, b: int) -> int:
    """Hamming distance between two 64-bit hashes (count of differing bits)."""
    return bin(a ^ b).count('1')


def _extract_gps(photos: list[Photo]) -> list[dict]:
    """Extract unique GPS locations from a list of photos."""
    locations: list[dict] = []
    seen: set[tuple] = set()
    for p in photos:
        exif = p.get("exifInfo") or {}
        try:
            lat = float(exif.get("latitude") or 0)
            lon = float(exif.get("longitude") or 0)
            if lat == 0.0 and lon == 0.0:
                continue
        except (TypeError, ValueError):
            continue
        key = (round(lat, cfg('duplicates', 'gps_coord_rounding')), round(lon, cfg('duplicates', 'gps_coord_rounding')))
        if key in seen:
            continue
        seen.add(key)
        locations.append({
            "lat": lat, "lon": lon,
            "name": (exif.get("city") or exif.get("state") or "").strip(),
        })
    return locations


def _dedup_key(photo: Photo) -> tuple:
    """
    Chiave di deduplicazione basata su dati EFFETTIVI dell'asset, non sulla risoluzione.
    Usa: checksum Immich (se disponibile) + filename + timestamp al minuto.
    Due foto sono candidate duplicati solo se scattate entro 2 minuti l'una dall'altra
    E hanno lo stesso filename base (burst) OPPURE lo stesso checksum.
    """
    checksum = photo.get("checksum") or ""
    name = photo.get("originalFileName") or ""
    dt = _photo_dt(photo)
    base_name = re.sub(r'[_\-]\d+(\.\w+)$', r'\1', name)
    return checksum if checksum else f"{base_name}_{dt.strftime('%Y%m%d%H%M') if dt else 'nodate'}"




def _filter_duplicates(photos: list[Photo], threshold: float, log: Log) -> tuple[list[Photo], list[dict]]:
    """
    Rimuove duplicati in 2 fasi:
    1. Checksum identici (stesso file binario)
    2. Loop unificato: dHash (se disponibile) + burst shot (nome base + finestra temporale)
       Ogni foto viene confrontata con tutte quelle già mantenute usando entrambi i criteri.

    threshold (0-1):
      0.99 → max_hamming=1  (quasi identici)
      0.92 → max_hamming=10 (foto quasi identiche, ≤10 bit diversi su 128)
      0.80 → max_hamming=25 (foto molto simili)
    """
    if not photos:
        return photos, []

    excluded: list[dict] = []

    # ── 1. Checksum identici ──────────────────────────────────────────────────
    by_checksum: dict[str, list[Photo]] = {}
    no_checksum: list[Photo] = []
    for p in photos:
        cs = p.get("checksum") or ""
        if cs:
            by_checksum.setdefault(cs, []).append(p)
        else:
            no_checksum.append(p)

    after_cs: list[Photo] = []
    for cs, group in by_checksum.items():
        if len(group) == 1:
            after_cs.append(group[0])
        else:
            best = max(group, key=_photo_quality)
            after_cs.append(best)
            for p in group:
                if p is not best:
                    log.append(f"  DUPLICATO (checksum) rimosso: {p.get('originalFileName','?')} "
                               f"(tenuto: {best.get('originalFileName','?')})")
                    excluded.append({
                        'asset_id':      p.get('id', ''),
                        'filename':      p.get('originalFileName', ''),
                        'datetime':      p.get('localDateTime', ''),
                        'reason':        'duplicate_checksum',
                        'detail':        f"file identico a '{best.get('originalFileName','?')}'",
                        'kept_filename': best.get('originalFileName', ''),
                        'kept_asset_id': best.get('id', ''),
                    })

    # ── 2. Loop unificato: dHash AND burst (entrambi richiesti) ──────────────
    # Foto esclusa solo se ENTRAMBI i criteri corrispondono:
    #   - dHash ≤ max_hamming (simile visivamente)
    #   - nome base uguale + entro finestra temporale (burst shot)
    # Foto senza dHash non vengono mai escluse (criterio visivo non verificabile).
    max_hamming     = max(0, int((1 - threshold) * cfg('duplicates', 'dhash_size') ** 2 * 2))
    time_window_sec = max(30, int((1 - threshold) * cfg('duplicates', 'burst_time_window_base_sec')))

    all_remaining = sorted(after_cs + no_checksum, key=lambda p: _photo_dt(p) or datetime.min)
    kept: list[Photo] = []
    n_combined = 0

    for p in all_remaining:
        dh_p   = p.get("_dhash")
        dt_p   = _photo_dt(p)
        name_p = (p.get("originalFileName") or "").rsplit(".", 1)[0].lower()
        bn_p   = re.sub(r'\d+$', '', name_p)

        matched = False
        for i, k in enumerate(kept):
            dh_k   = k.get("_dhash")
            name_k = (k.get("originalFileName") or "").rsplit(".", 1)[0].lower()
            bn_k   = re.sub(r'\d+$', '', name_k)
            dt_k   = _photo_dt(k)

            # ── Criterio visivo (dHash) ───────────────────────────────────────
            dist = _hamming(dh_p, dh_k) if (dh_p is not None and dh_k is not None) else None
            visual_ok = dist is not None and dist <= max_hamming

            # ── Criterio burst (nome base + tempo) ────────────────────────────
            burst_ok = (bool(bn_p) and bool(bn_k) and bn_p == bn_k
                        and dt_p is not None and dt_k is not None
                        and abs((dt_p - dt_k).total_seconds()) <= time_window_sec)

            # Match if: same perceptual hash (dist=0, same photo different name/metadata)
            # OR visually similar AND same burst pattern (same shot sequence)
            if visual_ok and (dist == 0 or burst_ok):
                better = p if _photo_quality(p) > _photo_quality(k) else k
                worse  = k if better is p else p
                match_type = "identico" if dist == 0 else "visivo+burst"
                log.append(f"  DUPLICATO rimosso: {worse.get('originalFileName','?')} "
                            f"→ tenuto: {better.get('originalFileName','?')} "
                            f"(hamming={dist}/{max_hamming}, {match_type})")
                excluded.append({
                    'asset_id':      worse.get('id', ''),
                    'filename':      worse.get('originalFileName', ''),
                    'datetime':      worse.get('localDateTime', ''),
                    'reason':        'duplicate_visual',
                    'detail':        (f"{match_type}: hamming={dist}, "
                                     f"{'nomi diversi' if dist==0 and not burst_ok else f'entro {time_window_sec}s'} "
                                     f"da '{better.get('originalFileName','?')}'"),
                    'kept_filename': better.get('originalFileName', ''),
                    'kept_asset_id': better.get('id', ''),
                    'hamming':       dist,
                    'max_hamming':   max_hamming,
                })
                if better is p:
                    kept[i] = p
                matched = True
                n_combined += 1
                break

        if not matched:
            kept.append(p)

    n_with_dhash = sum(1 for p in all_remaining if p.get("_dhash") is not None)
    log.append(f"  Rimozione duplicati: {len(photos)} → {len(kept)} foto "
               f"({n_combined} visivo+burst, hamming≤{max_hamming}, finestra={time_window_sec}s, "
               f"soglia={threshold}, dHash su {n_with_dhash}/{len(all_remaining)} foto)")
    return kept, excluded


def _compute_similarity_scores(photos: list[Photo]) -> dict[str, float | None]:
    """For each photo compute similarity to nearest neighbor (0=unique, 1=identical)."""
    scores: dict[str, float | None] = {}
    for i, p in enumerate(photos):
        pid = p.get("id", "")
        dh = p.get("_dhash")
        if dh is None or len(photos) < 2:
            scores[pid] = None
            continue
        _max_dist = cfg('duplicates', 'dhash_size') ** 2 * 2
        min_dist = _max_dist
        for j, k in enumerate(photos):
            if i == j:
                continue
            dh2 = k.get("_dhash")
            if dh2 is not None:
                min_dist = min(min_dist, _hamming(dh, dh2))
        scores[pid] = round(1 - min_dist / _max_dist, 3)
    return scores


# ── Filtro qualità ─────────────────────────────────────────────────────────────



def _filter_quality(photos: list[Photo], threshold: float, log: Log) -> tuple[list[Photo], list[dict]]:
    out, excluded = [], []
    for p in photos:
        q = _photo_quality(p)
        if q >= threshold:
            out.append(p)
        else:
            log.append(f"  ESCLUSA qualità={q:.2f} < {threshold:.2f}: {p.get('originalFileName','?')}")
            excluded.append({
                'asset_id':     p.get('id', ''),
                'filename':     p.get('originalFileName', ''),
                'datetime':     p.get('localDateTime', ''),
                'reason':       'quality',
                'detail':       f'qualità {q:.2f} < soglia {threshold:.2f}',
                'quality_score': round(q, 3),
            })
    log.append(f"  Filtro qualità: {len(photos)} → {len(out)} foto ({len(excluded)} escluse)")
    return out, excluded


# ── Clustering temporale ───────────────────────────────────────────────────────



def _cluster_events(photos: list[Photo], gap_minutes: int) -> list[list[Photo]]:
    if not photos:
        return []
    with_dt = [(p, _photo_dt(p)) for p in photos]
    with_dt.sort(key=lambda x: x[1] or datetime.min)

    events: list[list[Photo]] = []
    current: list[Photo] = []
    prev_dt: datetime | None = None

    for photo, dt in with_dt:
        if prev_dt is None or dt is None:
            current.append(photo)
        elif (dt - prev_dt) > timedelta(minutes=gap_minutes):
            if current:
                events.append(current)
            current = [photo]
        else:
            current.append(photo)
        if dt:
            prev_dt = dt

    if current:
        events.append(current)
    return events


# ── Assegnazione foto → slot ───────────────────────────────────────────────────



def _merge_small_groups(
    groups: list[list[Photo]],
    min_cluster_size: int,
) -> list[tuple[str, list[Photo]]]:
    """
    Riorganizza i gruppi per la generazione delle pagine.

    Un gruppo con >= min_cluster_size foto è "significativo" e viene trattato
    come un'unità indipendente (le sue foto stanno sempre insieme).

    I gruppi piccoli (< min_cluster_size) vengono accumulati in un "pool libero"
    che viene impaginato in modo denso, senza barriere artificiali.
    Il pool libero viene emesso prima di ogni gruppo significativo.

    Ritorna lista di (label, [photos]) pronti per _make_pages_from_group.
    """
    units: list[tuple[str, list[Photo]]] = []
    free_pool: list[Photo] = []
    free_labels: list[str] = []

    def flush_pool():
        if free_pool:
            label = f"libere ({','.join(free_labels[:3])}{'…' if len(free_labels)>3 else ''})"
            units.append((label, list(free_pool)))
            free_pool.clear()
            free_labels.clear()

    for i, group in enumerate(groups):
        if len(group) >= min_cluster_size:
            # Emetti prima il pool libero accumulato
            flush_pool()
            # Poi questo gruppo significativo
            units.append((f"cluster {i+1}", group))
        else:
            # Accoda al pool libero (mantiene ordine temporale)
            free_pool.extend(group)
            free_labels.append(str(i+1))

    flush_pool()
    return units



    """
    Portrait photo → portrait slot, landscape → landscape slot.
    INVIOLABILE. I residui (mismatch inevitabili) vanno agli slot rimasti.
    """
    n      = min(len(photos), len(slots))
    ps     = list(photos[:n])
    ss     = list(slots[:n])
    result: list[Photo | None] = [None] * n

    p_port_idx = [i for i, s in enumerate(ss) if _slot_is_portrait(s, page_ar)]
    p_land_idx = [i for i, s in enumerate(ss) if not _slot_is_portrait(s, page_ar)]
    f_port     = [p for p in ps if _photo_is_portrait(p)]
    f_land     = [p for p in ps if not _photo_is_portrait(p)]

    for si, photo in zip(p_port_idx, f_port):
        result[si] = photo
    for si, photo in zip(p_land_idx, f_land):
        result[si] = photo

    used     = {id(p) for p in result if p is not None}
    leftover = [p for p in ps if id(p) not in used]
    empty    = [i for i in range(n) if result[i] is None]
    for si, photo in zip(empty, leftover):
        result[si] = photo

    result += [None] * (len(slots) - n)
    return result


# ── Selezione page type ────────────────────────────────────────────────────────



def _assign_to_slots(photos: list[Photo], slots: list[Slot], page_ar: float = 1.0) -> list[Photo | None]:
    """
    Assegna le foto agli slot FOTO rispettando l'orientamento.
    Gli slot DIDASCALIA non ricevono mai foto — rimangono None qui,
    verranno popolati con testo in _make_pages_from_group.

    Regole:
      - slot_type == "caption" → sempre None (testo, non foto)
      - slot_type == "photo"   → foto per orientamento
    """
    result: list[Photo | None] = [None] * len(slots)

    # Solo slot foto (non caption) ricevono foto
    photo_slot_idx = [i for i, s in enumerate(slots) if s.get("slot_type") != "caption"]

    n = min(len(photos), len(photo_slot_idx))
    ps = list(photos[:n])
    ss = [slots[i] for i in photo_slot_idx[:n]]

    p_port_idx = [photo_slot_idx[i] for i, s in enumerate(ss) if _slot_is_portrait(s, page_ar)]
    p_land_idx = [photo_slot_idx[i] for i, s in enumerate(ss) if not _slot_is_portrait(s, page_ar)]
    f_port     = [p for p in ps if _photo_is_portrait(p)]
    f_land     = [p for p in ps if not _photo_is_portrait(p)]

    for si, photo in zip(p_port_idx, f_port):
        result[si] = photo
    for si, photo in zip(p_land_idx, f_land):
        result[si] = photo

    # Leftover (orientation mismatch) → fill remaining empty photo slots
    used = {id(p) for p in result if p is not None}
    leftover = [p for p in ps if id(p) not in used]
    empty_photo_slots = [i for i in photo_slot_idx if result[i] is None]
    for si, photo in zip(empty_photo_slots, leftover):
        result[si] = photo

    return result


def _score_page_type(
    pt: dict,
    photos: list[Photo],
    usage_counter: dict[str, int],
    density_target: int,
    rhythm: bool,
    prev_dense: bool | None,
    max_slots: int,
    page_ar: float = 1.0,
    verbose_log: list | None = None,
    _return_breakdown: bool = False,
) -> float | tuple:
    """
    Punteggio per un page type dato un gruppo di foto (più basso = migliore).
    Pesi calibrati per garantire diversità senza sacrificare le regole fondamentali.

    Priorità (in ordine di importanza):
      1. Violazioni orientamento  ×10000  — INVIOLABILE
      2. Slot vuoti eccessivi     ×200    — evita layout molto più grandi del necessario
      3. Differenza dal target    ×20     — densità richiesta
      4. Volto tagliato           ×30×dim — preferenza lieve, non dominante
      5. Diversità layout         ×8      — penalizza chi è già molto usato
      6. Bonus layout mai usato   -30     — premia i layout nuovi
      7. Ritmo visivo             ×4      — alterna dense/rade
    """
    slots = pt.get("slots", [])
    ns    = len(slots)
    if ns == 0:
        return 9_999_999

    n_photo_slots, n_caption_slots = _count_slot_types(slots)
    n_photos    = len(photos)
    n_with_cap  = sum(1 for p in photos if p.get("has_caption"))
    # Caption slots don't receive photos — chunk size = photo slots only
    photos_for  = photos[:n_photo_slots]
    assigned    = _assign_to_slots(photos_for, slots, page_ar)

    score = 0.0
    detail = []

    # ── 1. Violazione orientamento ────────────────────────────────────────────
    orientation_violations = 0
    for slot, photo in zip(slots, assigned):
        if photo is not None and _photo_is_portrait(photo) != _slot_is_portrait(slot, page_ar):
            orientation_violations += 1
    if orientation_violations:
        score += orientation_violations * cfg('layout_scoring', 'penalty_orientation_violation')
        detail.append(f"orient_viol={orientation_violations}×10000")

    # ── 1b. Caption slot matching ────────────────────────────────────────────
    # Caption slots will contain text from photos on this page.
    # STRONG preference: if ANY photo has a description → pick layout with caption slot.
    # Heavy penalty: caption slot exists but no photo has description (slot stays empty).
    n_photos_on_page = len(photos_for)  # photos that will actually go on this page
    # Count captions across the full batch: if layout wins, captioned photos are prioritized
    # in chunk assignment, so any captioned photo in the batch can fill the caption slot.
    n_caps_in_batch = sum(1 for p in photos if p.get("has_caption"))
    n_caps_on_page  = min(n_caps_in_batch, n_photo_slots)
    unfilled_cap_slots = 0
    cap_bonus = 0
    if n_caption_slots > 0:
        captions_available = min(n_caps_on_page, n_caption_slots)
        unfilled_cap_slots = n_caption_slots - captions_available
        if unfilled_cap_slots > 0:
            # Caption slot would stay empty: very heavy penalty
            score += unfilled_cap_slots * cfg('layout_scoring', 'penalty_empty_caption_slot')
            detail.append(f"empty_caption_slot={unfilled_cap_slots}×5000")
        if captions_available > 0:
            # Layout has caption slot AND photos have descriptions: strong bonus
            cap_bonus = captions_available * cfg('layout_scoring', 'bonus_caption_match')
            score -= cap_bonus
            detail.append(f"caption_match_bonus={captions_available}×-200={-cap_bonus}")
    if n_caption_slots == 0 and n_caps_on_page > 0:
        # Photos have descriptions but layout has no caption slot: strong penalty
        pen = n_caps_on_page * cfg('layout_scoring', 'penalty_caption_no_slot')
        score += pen
        detail.append(f"has_caption_no_cap_slot={n_caps_on_page}×300={pen}")

    # ── 2. Slot vuoti (penalizza layout troppo grandi rispetto alle foto) ─────
    # Caption slots are filled with text, not photos — exclude them from this count.
    empty_slots = max(0, n_photo_slots - n_photos)
    if empty_slots > 0:
        # Penalizza in proporzione: 1 slot vuoto ok, 2+ molto penalizzati
        score += (empty_slots ** 2) * cfg('layout_scoring', 'penalty_empty_photo_slot')
        detail.append(f"empty_slots={empty_slots}×{empty_slots*200}")

    # ── 3. Differenza dal target di slot ──────────────────────────────────────
    # density 100 → 1 slot target, density 0 → max_slots
    # Both effective_slots and max_slots count only photo slots (caption slots are bonus).
    effective_slots = max(1, n_photo_slots)
    slot_target = max(1, round(1 + (max_slots - 1) * (1 - density_target / 100)))
    slot_target = min(slot_target, n_photos)
    diff = abs(effective_slots - slot_target)
    density_penalty = (diff ** 2) * cfg('layout_scoring', 'penalty_density_deviation')
    score += density_penalty
    detail.append(f"slot_diff=|{n_photo_slots}-{slot_target}|²×50={density_penalty}")

    # ── 4. Volto tagliato ─────────────────────────────────────────────────────
    # Penalità LIEVE — influenza la scelta ma non la domina.
    # La regola orientamento è già la principale difesa per i volti.
    face_penalty = 0.0
    for slot, photo in zip(slots, assigned):
        if photo is None:
            continue
        faces_all = _get_all_faces(photo)
        face = _merged_face(faces_all)
        if face is not None and face["size"] >= cfg('layout_scoring', 'face_clip_penalty_min_size'):   # ignora volti piccoli/lontani
            p_ar = _photo_ar(photo)
            s_ar = _slot_ar(slot, page_ar)
            if _face_would_be_clipped(face, p_ar, s_ar):
                face_penalty += cfg('layout_scoring', 'face_clip_penalty_weight') * face["size"]
    score += face_penalty
    if face_penalty > 0:
        detail.append(f"face_penalty={face_penalty:.1f}")

    # ── 5. Diversità: penalizza layout già molto usati ────────────────────────
    pid   = pt.get("id", "")
    usage = usage_counter.get(pid, 0)
    score += usage * cfg('layout_scoring', 'layout_reuse_penalty')
    detail.append(f"usage={usage}×8={usage*8}")

    # ── 6. Bonus per layout mai usato ────────────────────────────────────────
    if usage == 0:
        score -= cfg('layout_scoring', 'unused_layout_bonus')
        detail.append("unused_bonus=-30")

    # ── 7. Ritmo visivo ───────────────────────────────────────────────────────
    if rhythm and prev_dense is not None:
        is_dense = ns >= 3
        if is_dense == prev_dense:
            score += cfg('layout_scoring', 'rhythm_alternation_penalty')
            detail.append("rhythm_penalty=4")

    if verbose_log is not None:
        verbose_log.append(f"      {pt.get('label','?'):25s} score={score:7.1f}  [{', '.join(detail)}]")

    if _return_breakdown:
        no_cap_pen = (n_caps_on_page * cfg('layout_scoring', 'penalty_caption_no_slot')) if (n_caption_slots == 0 and n_caps_on_page > 0) else 0
        return score, {
            'orient_violations': orientation_violations,
            'orient_score':      orientation_violations * cfg('layout_scoring', 'penalty_orientation_violation'),
            'cap_unfilled':      unfilled_cap_slots,
            'cap_score':         unfilled_cap_slots * cfg('layout_scoring', 'penalty_empty_caption_slot'),
            'cap_bonus':         cap_bonus,
            'no_cap_penalty':    no_cap_pen,
            'empty_slots':       empty_slots,
            'empty_score':       (empty_slots**2)*cfg('layout_scoring', 'penalty_empty_photo_slot'),
            'slot_target':       slot_target,
            'slot_diff':         diff,
            'density_score':     density_penalty,
            'face_penalty':      round(face_penalty, 1),
            'usage':             usage,
            'usage_score':       usage * cfg('layout_scoring', 'layout_reuse_penalty'),
            'unused_bonus':      usage == 0,
            'rhythm_penalty':    bool(rhythm and prev_dense is not None and (ns>=3) == prev_dense),
            'total':             round(score, 1),
            'n_photo_slots':     n_photo_slots,
            'n_caption_slots':   n_caption_slots,
        }
    return score


def _best_page_type(
    page_types: list[dict],
    photos: list[Photo],
    usage_counter: dict[str, int],
    density_target: int,
    rhythm: bool,
    prev_dense: bool | None,
    page_ar: float = 1.0,
    verbose_log: list | None = None,
    _return_candidates: bool = False,
) -> dict | tuple:
    if not photos:
        return page_types[0] if page_types else FALLBACK_PAGE_TYPES[0]

    # max_slots counts only PHOTO slots (not caption slots) so density targets are correct.
    max_slots = max((_count_slot_types(pt.get("slots", []))[0] for pt in page_types), default=1)
    n_photos  = len(photos)

    # Candidati: layout con almeno 1 slot foto.
    # Il limite superiore usa solo gli slot FOTO — un layout con 1 foto + N didascalie
    # è valido anche per 1 sola foto (gli slot didascalia non contano come "vuoti").
    _max_photo_slots_allowed = max(n_photos * 2, 1)
    candidates = [
        pt for pt in page_types
        if 1 <= _count_slot_types(pt.get("slots", []))[0] <= _max_photo_slots_allowed
    ]
    if not candidates:
        candidates = page_types

    scored = []
    for i, pt in enumerate(candidates):
        if _return_candidates:
            sc, bkd = _score_page_type(
                pt, photos, usage_counter, density_target, rhythm, prev_dense,
                max_slots, page_ar, verbose_log, _return_breakdown=True)
            scored.append((sc, i, pt, bkd))
        else:
            sc = _score_page_type(
                pt, photos, usage_counter, density_target, rhythm, prev_dense,
                max_slots, page_ar, verbose_log)
            scored.append((sc, i, pt, None))
    scored.sort(key=lambda x: x[0])
    if _return_candidates:
        cand_list = [{'id': pt.get('id',''), 'label': pt.get('label','?'),
                      'score': round(sc,1), 'winner': idx==0, 'breakdown': bkd}
                     for idx,(sc,_,pt,bkd) in enumerate(scored)]
        return scored[0][2], cand_list
    return scored[0][2]


# ── Costruzione items ──────────────────────────────────────────────────────────



def _best_hero_layout(photo: Photo, pt_pool: list[dict], page_ar: float, n_fillers: int = 0) -> dict:
    """
    For favorites_full_page:
    - Orientation match (portrait→portrait or landscape→landscape): single-slot full page.
    - Orientation mismatch: multi-slot layout where the largest photo slot matches the
      photo's orientation (photo goes in that slot, other slots filled with nearby photos).
    Falls back to FULL_PAGE_TYPE when no suitable layout found.
    """
    def photo_slots(pt):
        return [s for s in pt.get("slots", []) if s.get("slot_type", "photo") == "photo"]

    ph_portrait = _photo_is_portrait(photo)

    # ── Case 1: orientation match → prefer single-slot layouts ──────────────────
    single_slot = [pt for pt in pt_pool if len(photo_slots(pt)) == 1]
    matching_single = [pt for pt in single_slot if _slot_is_portrait(photo_slots(pt)[0], page_ar) == ph_portrait]

    def _slot_area(pt):
        s = photo_slots(pt)[0]
        return s.get("w", 0) * s.get("h", 0)

    def hero_slot(pt):
        slots = photo_slots(pt)
        return max(slots, key=lambda s: s.get("w", 0) * s.get("h", 0))

    if matching_single:
        return max(matching_single, key=_slot_area)

    # ── Case 2: multi-slot with hero matching orientation, only if enough filler
    #    photos available to fill remaining photo slots (no map fallbacks) ──────────
    multi_slot = [pt for pt in pt_pool if len(photo_slots(pt)) >= 2]
    matching_multi = [pt for pt in multi_slot if _slot_is_portrait(hero_slot(pt), page_ar) == ph_portrait]
    # Only accept multi-slot if we have enough non-favorite photos to fill all non-hero slots
    fillable_multi = [pt for pt in matching_multi if len(photo_slots(pt)) - 1 <= n_fillers]

    if fillable_multi:
        return max(fillable_multi, key=lambda pt: hero_slot(pt).get("w", 0) * hero_slot(pt).get("h", 0))

    # ── Case 3: any single-slot (orientation mismatch tolerated) ─────────────────
    if single_slot:
        return max(single_slot, key=_slot_area)

    # ── Case 4: multi-slot as last resort ────────────────────────────────────────
    if matching_multi:
        return max(matching_multi, key=lambda pt: hero_slot(pt).get("w", 0) * hero_slot(pt).get("h", 0))

    if multi_slot:
        return max(multi_slot, key=lambda pt: hero_slot(pt).get("w", 0) * hero_slot(pt).get("h", 0))

    return FULL_PAGE_TYPE


_MONTH_NAMES: dict[str, list[str]] = {
    "it": ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"],
    "en": ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
}

def _fmt_date(dt, lang: str = "it") -> str:
    months = _MONTH_NAMES.get(lang) or _MONTH_NAMES["it"]
    return f"{dt.day} {months[dt.month - 1]} {dt.year}"


def _badge_date_str(photo: Photo, lang: str = "it") -> str:
    dt = _photo_dt(photo)
    if not dt:
        return ""
    return _fmt_date(dt, lang)


def _badge_location_str(photo: Photo, lang: str = "it") -> str:
    exif = photo.get("exifInfo") or {}
    return (exif.get("city") or exif.get("state") or "").strip()


def _make_photo_item(photo: Photo, add_badges: bool = False, lang: str = "it") -> Item:
    exif = photo.get("exifInfo") or {}
    desc = (exif.get("description") or photo.get("description") or "").strip()
    badge_date = _badge_date_str(photo, lang)
    badge_loc  = _badge_location_str(photo, lang)
    item: Item = {
        "type":             "photo",
        "asset_id":         photo["id"],
        "description":      desc,
        "originalFileName": photo.get("originalFileName", ""),
        "localDateTime":    photo.get("localDateTime", ""),
        "exif":             exif,
        "has_caption":      bool(desc),
        "isFavorite":       bool(photo.get("isFavorite")),
        "_updated_at":      photo.get("updatedAt", ""),
        "_badge_date":      badge_date,
        "_badge_location":  badge_loc,
    }
    if add_badges:
        parts = [p for p in [badge_loc, badge_date] if p]
        if parts:
            item["badges"] = [{"id": "auto", "text": " · ".join(parts), "type": "auto"}]
    return item


# ── Event caption helpers ─────────────────────────────────────────────────────

def _event_majority_location(photos: list[Photo], lang: str = "it") -> str:
    """Return the most common location (POI or city) among event photos."""
    from collections import Counter
    locations = [_badge_location_str(p, lang) for p in photos if _badge_location_str(p, lang)]
    if not locations:
        return ""
    return Counter(locations).most_common(1)[0][0]


def _event_date_range_str(photos: list[Photo], lang: str = "it") -> str:
    """Return a human-readable date range for an event."""
    dates = sorted((_photo_dt(p) for p in photos if _photo_dt(p)))
    if not dates:
        return ""
    first, last = dates[0], dates[-1]
    months = _MONTH_NAMES.get(lang) or _MONTH_NAMES["it"]
    def mon(dt): return months[dt.month - 1]
    if first.date() == last.date():
        return f"{first.day} {mon(first)} {first.year}"
    if first.month == last.month and first.year == last.year:
        return f"{first.day} – {last.day} {mon(last)} {last.year}"
    if first.year == last.year:
        return f"{first.day} {mon(first)} – {last.day} {mon(last)} {last.year}"
    return f"{first.day} {mon(first)} {first.year} – {last.day} {mon(last)} {last.year}"


def _find_mixed_caption_page_type(page_types: list[dict]) -> dict | None:
    """Return a page type that has both photo slots AND at least one caption slot.
    Never returns a pure caption-only page. Returns None if no suitable type found."""
    for pt in page_types:
        slots = pt.get("slots", [])
        n_photo, n_cap = _count_slot_types(slots)
        if n_photo >= 1 and n_cap >= 1:
            return pt
    return None


def _make_event_caption_page(photos: list[Photo], page_types: list[dict], lang: str = "it") -> Page | None:
    """Build an intro caption page for a temporal event using a mixed photo+caption page type."""
    pt = _find_mixed_caption_page_type(page_types)
    if pt is None:
        return None  # no suitable page type in profile — skip
    loc  = _event_majority_location(photos)
    date = _event_date_range_str(photos, lang)
    parts = [p for p in [loc, date] if p]
    if not parts:
        return None
    text = " · ".join(parts)
    items = [
        {
            "slot": s,
            "item": {"type": "caption", "text": text} if s.get("slot_type") == "caption" else None,
        }
        for s in pt.get("slots", [])
    ]
    return {
        "page_type_id":      pt.get("id"),
        "page_type":         pt,
        "items":             items,
        "_is_event_caption": True,
    }


# ── Generazione pagine da un gruppo ───────────────────────────────────────────



def _make_pages_from_group(
    photos: list[Photo],
    page_types: list[dict],
    usage_counter: dict[str, int],
    config: dict,
    transforms: dict,
    log: Log,
    group_label: str,
    page_offset: int,
    page_ar: float = 1.0,
    similarity_scores: dict | None = None,
    event_caption_text: str = "",
) -> list[Page]:
    if not photos:
        return []

    density       = config.get("density", 75)
    rhythm        = config.get("rhythm_alternation", True)
    face_crop     = config.get("face_crop", True)
    favs_full     = config.get("favorites_full_page", False)
    fill_map      = config.get("fill_empty_with_map", False)
    auto_captions = config.get("auto_captions", True)
    photo_badges  = config.get("photo_badges", False)
    lang          = config.get("lang", "it")

    # Pre-filter page_types: when auto_captions=False, exclude layouts with caption slots
    page_types_no_cap = [pt for pt in page_types if not any(s.get("slot_type") == "caption" for s in pt.get("slots", []))]
    pt_pool = page_types if auto_captions else (page_types_no_cap or page_types)

    # GPS locations for the whole group (used to fill empty slots with a map)
    group_gps: list[dict] = _extract_gps(photos) if fill_map else []

    pages: list[Page] = []
    remaining = list(photos)
    prev_dense: bool | None = None
    _first_page = True  # used to inject event_caption_text on first page

    page_logs: list[dict] = []
    while remaining:
        _page_candidates = []
        photo = remaining[0]

        # Foto preferita → pagina hero (orientamento rispettato)
        # - orientamenti uguali → pagina singola (1 slot)
        # - orientamenti diversi → layout multi-slot dove lo slot più grande corrisponde
        #   all'orientamento della foto; gli altri slot sono riempiti con foto successive
        if favs_full and photo.get("isFavorite"):
            _n_fillers = sum(1 for p in remaining[1:] if not p.get("isFavorite"))
            pt    = _best_hero_layout(photo, pt_pool, page_ar, n_fillers=_n_fillers)
            n_photo_sl, n_cap_sl = _count_slot_types(pt.get("slots", []))
            _page_candidates = [{'id':pt.get('id','__full__'),'label':pt.get('label','Pagina intera'),'score':0,'winner':True,'breakdown':{'total':0,'orient_violations':0,'n_photo_slots':n_photo_sl,'n_caption_slots':n_cap_sl,'unused_bonus':False,'rhythm_penalty':False}}]
            # Favorite goes first; fill extra photo slots with non-favorite successors
            # (never consume another favorite — stop before the next ★)
            fillers = []
            if n_photo_sl > 1:
                for p in remaining[1:]:
                    if len(fillers) >= n_photo_sl - 1:
                        break
                    if not p.get("isFavorite"):
                        fillers.append(p)
            chunk = [photo] + fillers
            # Remove all used photos from remaining
            used_ids = {id(p) for p in chunk}
            remaining = [p for p in remaining if id(p) not in used_ids]
            note = f" (+{len(fillers)} foto)" if fillers else ""
            log.append(f"  [★ PREFERITA] {photo.get('originalFileName','?')} → {pt.get('label','pagina intera')}{note}")
        else:
            # When favorites_full_page is on, clip the visible window so a multi-slot page
            # cannot consume a favorite photo that is deeper in remaining.
            # (remaining[0] is already confirmed non-favorite — the if-branch above handles it)
            effective = remaining
            if favs_full:
                next_fav = next((i for i, p in enumerate(remaining[1:], 1) if p.get("isFavorite")), None)
                if next_fav is not None:
                    effective = remaining[:next_fav]
                    log.append(f"  [★ FINESTRA] Foto preferita tra {next_fav} posizione/i — "
                               f"impaginando solo {next_fav} foto prima")

            # Quante foto usare per questa pagina?
            max_slots_all = max((len(pt.get("slots", [])) for pt in pt_pool), default=1)
            # On first page with event caption: prefer page types that have a caption slot
            _active_pool = pt_pool
            if _first_page and event_caption_text:
                _cap_pool = [p for p in pt_pool
                             if _count_slot_types(p.get("slots", []))[1] >= 1
                             and _count_slot_types(p.get("slots", []))[0] >= 1]
                if _cap_pool:
                    _active_pool = _cap_pool
            pt, _page_candidates = _best_page_type(
                _active_pool, effective, usage_counter, density, rhythm, prev_dense,
                page_ar, _return_candidates=True)
            slots_all = pt.get("slots", [])
            n_photo_sl, n_cap_sl = _count_slot_types(slots_all)
            # Chunk = only photo slots count; caption slots hold text not photos
            n_slots = len(slots_all)
            if n_cap_sl > 0 and n_photo_sl > 0:
                # Caption layout: prioritize captioned photos so the slot is filled
                has_cap = [p for p in effective if p.get("has_caption")]
                no_cap  = [p for p in effective if not p.get("has_caption")]
                chunk   = (has_cap + no_cap)[:n_photo_sl]
            else:
                chunk = effective[:n_photo_sl] if n_photo_sl > 0 else effective[:1]
            # Remove chunk photos from remaining by identity (order may have changed)
            chunk_ids = {id(p) for p in chunk}
            remaining = [p for p in remaining if id(p) not in chunk_ids]

        # Log caption-slot decision for this page
        n_chunk_with_desc = sum(1 for p in chunk if p.get("has_caption"))
        if n_cap_sl > 0:
            if n_chunk_with_desc > 0:
                log.append(f"  [T✓] '{pt.get('label','?')}': {n_cap_sl} slot T — "
                           f"{n_chunk_with_desc}/{len(chunk)} foto con descrizione → verrà inserita")
            else:
                log.append(f"  [T⚠] '{pt.get('label','?')}': {n_cap_sl} slot T ma nessuna foto ha descrizione (slot rimane vuoto)")
        elif n_chunk_with_desc > 0:
            log.append(f"  [T↷] '{pt.get('label','?')}': {n_chunk_with_desc}/{len(chunk)} foto con descrizione, "
                       f"nessuno slot T nel layout (descrizione non inserita)")

        usage_counter[pt.get("id", "")] = usage_counter.get(pt.get("id", ""), 0) + 1
        slots     = list(pt.get("slots", [{"x":0,"y":0,"w":100,"h":100}]))
        n_slots   = len(slots)
        prev_dense = n_slots >= 3

        # Assegna foto agli slot rispettando orientamento
        assigned = _assign_to_slots(chunk, slots, page_ar)

        # Favorite hero guarantee: ensure the favorite (chunk[0]) lands in the
        # largest photo slot (hero slot), swapping with whoever is there.
        if favs_full and chunk and chunk[0].get("isFavorite") and len(chunk) > 1:
            photo_slot_idx = [i for i, s in enumerate(slots) if s.get("slot_type") != "caption"]
            if photo_slot_idx:
                hero_idx = max(photo_slot_idx, key=lambda i: slots[i].get("w", 0) * slots[i].get("h", 0))
                fav_idx  = next((i for i, p in enumerate(assigned) if p is not None and p.get("isFavorite")), None)
                if fav_idx is not None and fav_idx != hero_idx:
                    assigned[fav_idx], assigned[hero_idx] = assigned[hero_idx], assigned[fav_idx]

        items: list[dict] = []
        page_num = page_offset + len(pages)

        # Build a list of descriptions from photos on this page (for caption slots)
        # Use each photo's description once; queue them in order
        descriptions_queue = [
            (photo_a, (photo_a.get("exifInfo") or {}).get("description") or photo_a.get("description") or "")
            for photo_a in chunk
            if ((photo_a.get("exifInfo") or {}).get("description") or photo_a.get("description") or "").strip()
        ]

        for si, (slot, photo_a) in enumerate(zip(slots, assigned)):
            slot_type = slot.get("slot_type", "photo")

            # ── Caption slot → fill with text, never a photo ──────────────────
            if slot_type == "caption":
                if _first_page and event_caption_text:
                    caption_item = {"type": "caption", "text": event_caption_text}
                    items.append({"slot": slot, "item": caption_item})
                    log.append(f"  [📅 EVENTO] Slot {si+1} didascalia → '{event_caption_text[:60]}'")
                elif auto_captions and descriptions_queue:
                    src_photo, desc_text = descriptions_queue.pop(0)
                    caption_item = {
                        "type":           "caption",
                        "text":           desc_text.strip(),
                        "for_asset_id":   src_photo["id"],
                        "originalFileName": src_photo.get("originalFileName",""),
                    }
                    items.append({"slot": slot, "item": caption_item})
                    log.append(f"  [T] Slot {si+1} didascalia → '{desc_text[:40]}…' [{src_photo.get('originalFileName','')}]")
                else:
                    reason = "auto_captions disattivato" if not auto_captions else "nessuna descrizione disponibile"
                    items.append({"slot": slot, "item": None})
                    log.append(f"  [T] Slot {si+1} didascalia → vuoto ({reason})")
                continue

            # ── Photo slot → fill with photo (or map if empty and fill_map=True) ──
            if photo_a is None:
                if fill_map and group_gps:
                    items.append({"slot": slot, "item": {"type": "map", "locations": group_gps}})
                    log.append(f"  [🗺] Slot {si+1} vuoto → mappa GPS ({len(group_gps)} location)")
                else:
                    items.append({"slot": slot, "item": None})
                continue

            item = _make_photo_item(photo_a, add_badges=photo_badges, lang=lang)
            items.append({"slot": slot, "item": item})

            # ── Logging orientamento ──
            is_portrait_photo = _photo_is_portrait(photo_a)
            is_portrait_slot  = _slot_is_portrait(slot, page_ar)
            match_icon = "✓" if is_portrait_photo == is_portrait_slot else "⚠ MISMATCH"
            tw = photo_a.get("_thumb_w"); th = photo_a.get("_thumb_h")
            exif = photo_a.get("exifInfo") or {}
            ew = exif.get("exifImageWidth") or exif.get("imageWidth") or "?"
            eh = exif.get("exifImageHeight") or exif.get("imageHeight") or "?"
            orient = exif.get("orientation", 1)
            dim_src = f"thumb:{tw}×{th}" if (tw and th) else f"exif:{ew}×{eh}(rot{orient})"
            log.append(
                f"  {match_icon} {photo_a.get('originalFileName','?')} "
                f"({'V' if is_portrait_photo else 'H'}) [{dim_src}] → Slot {si+1} "
                f"({'V' if is_portrait_slot else 'H'}) | layout: {pt.get('label','?')} | {group_label}"
            )

            # ── Face crop ──
            if face_crop:
                all_faces = _get_all_faces(photo_a)
                if all_faces:
                    p_ar = _photo_ar(photo_a)
                    s_ar = _slot_ar(slot, page_ar)
                    main_face = max(all_faces, key=lambda f: f["size"])
                    would_clip = _face_would_be_clipped(main_face, p_ar, s_ar)
                    transform = _face_transform(all_faces, p_ar, s_ar)
                    key = f"{page_num}_{si}"
                    transforms[key] = transform
                    prominent = [f for f in all_faces if f.get("size",0) >= cfg('face', 'prominent_threshold')]
                    clip_note = " ⚠ VOLTO TAGLIATO" if would_clip else ""
                    log.append(
                        f"    → {len(all_faces)} volto/i ({len(prominent)} in primo piano), "
                        f"bbox gruppo=({min(f['x1'] for f in prominent or all_faces):.2f}-"
                        f"{max(f['x2'] for f in prominent or all_faces):.2f}, "
                        f"{min(f['y1'] for f in prominent or all_faces):.2f}-"
                        f"{max(f['y2'] for f in prominent or all_faces):.2f}), "
                        f"AR foto={p_ar:.2f} slot={s_ar:.2f}"
                        f"{clip_note}"
                        f" → pan ({transform['x']:.0f}%,{transform['y']:.0f}%) zoom={transform['zoom']:.2f}"
                    )

        tid = pt.get("id", "custom")
        pg_idx = page_offset + len(pages)
        # Build structured slot-level log
        slot_logs = []
        for si2, it2 in enumerate(items):
            slot2 = it2['slot']; item2 = it2['item']; stype = slot2.get('slot_type','photo')
            if stype == 'caption':
                slot_logs.append({'slot_idx':si2,'slot_type':'caption',
                    'empty':item2 is None,'text':(item2 or {}).get('text',''),
                    'for_asset':(item2 or {}).get('for_asset_id','')})
            elif item2 and item2.get('type')=='map':
                slot_logs.append({'slot_idx':si2,'slot_type':'map',
                    'map_key':item2.get('map_key','')})
            elif item2 and item2.get('type')=='photo':
                pr2 = next((p for p in chunk if p.get('id')==item2.get('asset_id')),None)
                faces2 = _get_all_faces(pr2) if pr2 else []
                prom2  = [f for f in faces2 if f.get('size',0)>=cfg('face', 'prominent_threshold')]
                p_ar2  = _photo_ar(pr2) if pr2 else 1.0
                s_ar2  = _slot_ar(slot2, page_ar)
                mf2    = _merged_face(prom2 or faces2)
                clipped= _face_would_be_clipped(mf2,p_ar2,s_ar2) if mf2 and mf2.get('size',0)>=cfg('layout_scoring', 'face_clip_penalty_min_size') else False
                tr2    = transforms.get(f'{pg_idx}_{si2}',{'x':50,'y':50,'zoom':1.0})
                q_score  = round(_photo_quality(pr2), 3) if pr2 else None
                sim_score = (similarity_scores or {}).get(item2.get('asset_id', ''))
                tw2 = pr2.get('_thumb_w') if pr2 else None
                th2 = pr2.get('_thumb_h') if pr2 else None
                exif2 = (pr2.get('exifInfo') or {}) if pr2 else {}
                ew2 = exif2.get('exifImageWidth') or exif2.get('imageWidth') or '?'
                eh2 = exif2.get('exifImageHeight') or exif2.get('imageHeight') or '?'
                dim_src2 = f'thumb:{tw2}x{th2}' if (tw2 and th2) else f'exif:{ew2}x{eh2}(rot{exif2.get("orientation",1)})'
                slot_logs.append({'slot_idx':si2,'slot_type':'photo',
                    'asset_id':item2.get('asset_id',''),'filename':item2.get('originalFileName',''),
                    'datetime':item2.get('localDateTime',''),
                    'photo_portrait':_photo_is_portrait(pr2) if pr2 else None,
                    'slot_portrait':_slot_is_portrait(slot2,page_ar),
                    'orient_match':(_photo_is_portrait(pr2)==_slot_is_portrait(slot2,page_ar)) if pr2 else None,
                    'has_caption':item2.get('has_caption',False),
                    'description':item2.get('description',''),
                    'is_favorite':item2.get('isFavorite',False),
                    'photo_ar':round(p_ar2,3),'slot_ar':round(s_ar2,3),
                    'dim_src':dim_src2,
                    'faces':{'count':len(faces2),'prominent':len(prom2),
                             'bbox':[round(min(f['x1'] for f in prom2 or faces2),3),
                                     round(min(f['y1'] for f in prom2 or faces2),3),
                                     round(max(f['x2'] for f in prom2 or faces2),3),
                                     round(max(f['y2'] for f in prom2 or faces2),3)] if (prom2 or faces2) else None,
                             'would_clip':clipped} if faces2 else None,
                    'transform':tr2,'quality_score':q_score,'similarity_score':sim_score})
            else:
                slot_logs.append({'slot_idx':si2,'slot_type':'photo','empty':True})
        page_logs.append({'page_num':pg_idx+1,'group':group_label,
            'page_type_label':pt.get('label','?'),'page_type_id':tid,
            'is_favorite':bool(favs_full and len(chunk)==1 and chunk[0].get('isFavorite')),
            'candidates':_page_candidates,'slots':slot_logs,
            'prev_dense':bool(prev_dense) if prev_dense is not None else None,
            'is_dense':n_slots>=3,
            'n_photos_with_desc':n_chunk_with_desc,
            'n_caption_slots':n_cap_sl})
        # Deduplicate badges within the page: same text → keep only first occurrence
        if photo_badges:
            seen_badge_texts: set[str] = set()
            for id_ in items:
                it = id_.get("item")
                if it and it.get("type") == "photo" and it.get("badges"):
                    unique = []
                    for b in it["badges"]:
                        if b.get("text") not in seen_badge_texts:
                            seen_badge_texts.add(b.get("text", ""))
                            unique.append(b)
                    it["badges"] = unique

        pages.append({'page_type_id':tid,'page_type':pt,'items':items})
        _first_page = False

    return pages, page_logs


# ── Entry point ────────────────────────────────────────────────────────────────



def generate_album(
    assets: list[Photo],
    profile: dict,
    config: dict,
) -> tuple[list[Page], dict, str]:
    """
    Genera il layout dell'album.
    Returns: (pages, photo_transforms, log_text)
    """
    cfg = {**DEFAULT_CONFIG, **{k: v for k, v in config.items() if v is not None}}

    log: Log = []
    log.append("═══ PhotoBook Studio — Log generazione album ═══")
    log.append(f"  Profilo: {profile.get('name','?')}")
    log.append(f"  Foto in input: {len(assets)}")
    log.append(f"  Config: density={cfg.get('density',75)}%, "
               f"clustering={'on' if cfg.get('temporal_clustering') else 'off'}, "
               f"favorites={'on' if cfg.get('favorites_full_page') else 'off'}, "
               f"face_crop={'on' if cfg.get('face_crop') else 'off'}, "
               f"quality_filter={'on' if cfg.get('quality_filter') else 'off'}, "
               f"dedup={'on' if cfg.get('remove_duplicates') else 'off'}, "
               f"rhythm={'on' if cfg.get('rhythm_alternation') else 'off'}")
    log.append("")

    page_types = profile.get("page_types") or FALLBACK_PAGE_TYPES
    if not profile.get("page_types"):
        log.append("  ATTENZIONE: nessun page type nel profilo, uso fallback standard")

    # Exclude disabled page types and wrong-orientation page types
    profile_orientation = profile.get("orientation", "portrait")
    page_types = [
        pt for pt in page_types
        if pt.get("enabled", True)
        and pt.get("orientation", "any") in ("any", profile_orientation)
    ]
    if not page_types:
        page_types = FALLBACK_PAGE_TYPES
        log.append("  ATTENZIONE: nessun page type attivo/compatibile, uso fallback standard")

    # Compute physical page AR (accounts for page size + orientation)
    page_ar = _get_page_ar(profile)
    log.append(f"  Formato pagina: {profile.get('page_size','?')} {profile.get('orientation','portrait')} → page_ar={page_ar:.3f}")

    log.append(f"  Pagine tipo disponibili ({len(page_types)}):")
    for pt in page_types:
        slots = pt.get("slots", [])
        n_photo_sl, n_cap_sl = _count_slot_types(slots)
        n_port = sum(1 for s in slots if s.get("slot_type")!="caption" and _slot_is_portrait(s, page_ar))
        n_land = n_photo_sl - n_port
        log.append(f"    • {pt.get('label','?'):30s} — {len(slots)} slot "
                   f"({'V' if n_port else ''}{'+' if n_port and n_land else ''}{'H' if n_land else ''})")
    log.append("")

    # Ordina per data
    photos = sorted(assets, key=lambda a: (a.get("localDateTime") or a.get("fileCreatedAt") or ""))
    log.append(f"  Ordinate per data.")

    # Annotate each asset with has_caption (checks Immich exif.description and asset.description).
    # Must happen BEFORE quality/dedup filters so the flag survives into scoring.
    for photo in photos:
        desc = ((photo.get("exifInfo") or {}).get("description") or photo.get("description") or "").strip()
        photo["has_caption"] = bool(desc)
    n_with_desc = sum(1 for p in photos if p.get("has_caption"))
    log.append(f"  Foto con descrizione Immich: {n_with_desc}/{len(photos)}"
               + (" → preferenza per layout con slot didascalia (T)" if n_with_desc else ""))

    n_with_favs = sum(1 for p in photos if p.get("isFavorite"))
    if cfg.get("favorites_full_page"):
        if n_with_favs:
            log.append(f"  Foto preferite (★): {n_with_favs}/{len(photos)} → ognuna avrà pagina intera")
        else:
            log.append(f"  Foto preferite (★): nessuna trovata nell'album (controlla che le foto siano marcate in Immich)")
    log.append("")

    # Filtri
    all_excluded: list[dict] = []

    if cfg.get("quality_filter"):
        log.append("─── Filtro qualità ───")
        photos, excl_q = _filter_quality(photos, float(cfg.get("min_quality", 0.05)), log)
        all_excluded.extend(excl_q)
        log.append("")

    if cfg.get("remove_duplicates"):
        log.append("─── Rimozione duplicati ───")
        photos, excl_d = _filter_duplicates(photos, float(cfg.get("similarity_threshold", 0.92)), log)
        all_excluded.extend(excl_d)
        log.append("")

    similarity_scores = _compute_similarity_scores(photos)

    log.append(f"  Foto da impaginare: {len(photos)}")
    log.append("")

    # Analisi volti
    n_with_faces = sum(1 for p in photos if _get_face_region(p) is not None)
    has_people_data = any(p.get("people") or p.get("faces") for p in photos[:5])
    log.append(f"  Dati volti Immich disponibili: {'sì' if has_people_data else 'NO — i dati people/faces non sono stati caricati (verifica arricchimento asset)'}")
    log.append(f"  Foto con volti rilevati: {n_with_faces}/{len(photos)}")
    log.append("")

    # Clustering e raggruppamento
    if cfg.get("temporal_clustering"):
        gap = int(cfg.get("event_gap_min", 60))
        raw_groups = _cluster_events(photos, gap)
        log.append(f"─── Clustering temporale (gap={gap}min) → {len(raw_groups)} gruppi raw ───")
        for i, g in enumerate(raw_groups):
            dt = _photo_dt(g[0])
            log.append(f"  Gruppo {i+1}: {len(g)} foto, prima={dt.strftime('%Y-%m-%d %H:%M') if dt else '?'}")
        log.append("")

        # Soglia cluster "significativo": 2 foto bastano per costituire un evento.
        # Non dipende dai layout disponibili — un evento può essere piccolo.
        min_cluster = 2

        units = _merge_small_groups(raw_groups, min_cluster)

        # Conta i pool liberi per il log
        n_free  = sum(1 for lbl,_ in units if lbl.startswith("libere"))
        n_clust = sum(1 for lbl,_ in units if lbl.startswith("cluster"))
        log.append(f"  Dopo merge: {len(units)} unità di impaginazione "
                   f"({n_clust} cluster significativi + {n_free} pool di foto isolate)")
        log.append("")
    else:
        units = [("principale", photos)]
        log.append("  Clustering: off — tutte le foto in un gruppo")
        log.append("")

    # Generazione pagine
    transforms: dict = {}
    usage_counter: dict[str, int] = {}
    all_pages: list[Page] = []
    all_page_logs: list[dict] = []
    event_caption_pages = cfg.get("event_caption_pages", False)
    _lang = cfg.get("lang", "it")

    for label, group in units:
        log.append(f"─── {label.upper()} ({len(group)} foto) ───")

        # Compute event caption text for this cluster (injected into first page's caption slot)
        _event_cap_text = ""
        if event_caption_pages and cfg.get("temporal_clustering") and label.startswith("cluster") and group:
            loc  = _event_majority_location(group, _lang)
            date = _event_date_range_str(group, _lang)
            parts = [p for p in [loc, date] if p]
            if parts:
                _event_cap_text = " · ".join(parts)
                log.append(f"  [📅 EVENTO] Didascalia evento da inserire: '{_event_cap_text}'")

        group_pages, group_logs = _make_pages_from_group(
            group, page_types, usage_counter, cfg, transforms, log, label, len(all_pages), page_ar,
            similarity_scores=similarity_scores,
            event_caption_text=_event_cap_text,
        )
        all_pages.extend(group_pages)
        all_page_logs.extend(group_logs)
        log.append("")

    # Riepilogo
    n_placed    = sum(1 for p in all_pages for id_ in p["items"] if id_.get("item"))
    n_faces_ok  = len(transforms)
    n_mismatches = sum(
        1 for p in all_pages for id_ in p["items"]
        if id_.get("item") and id_["item"].get("type") == "photo"
        and _photo_is_portrait({"exifInfo": id_["item"].get("exif", {})}) != _slot_is_portrait(id_["slot"], page_ar)
    )
    log.append("═══ Riepilogo ═══")
    log.append(f"  Foto impaginate:  {n_placed}")
    log.append(f"  Pagine generate:  {len(all_pages)}")
    log.append(f"  Crop volti:       {n_faces_ok}")
    log.append(f"  Mismatch orient.: {n_mismatches} (0 = ottimale)")
    if all_excluded:
        n_qual = sum(1 for e in all_excluded if e['reason'] == 'quality')
        n_dup  = sum(1 for e in all_excluded if e['reason'].startswith('duplicate'))
        log.append(f"  Foto escluse:     {len(all_excluded)} "
                   f"(qualità: {n_qual}, duplicati: {n_dup})")
    log.append("  Utilizzo layout:")
    for pt in page_types:
        cnt = usage_counter.get(pt.get("id", ""), 0)
        if cnt:
            log.append(f"    {pt.get('label','?'):30s}: {cnt:3d} pagine")
    log.append("═══ Fine ═══")

    return all_pages, transforms, "\n".join(log), all_page_logs, all_excluded


def recalculate_from_items(photo_items: list[dict], profile: dict, config: dict) -> tuple[list[dict], str]:
    """
    Re-run _make_pages_from_group on already-processed photo items (from a prior layout).
    Items use layout format (asset_id, exif, isFavorite …) which is converted to Photo
    format expected by the scoring / placement engine.
    Quality filtering and dedup are NOT re-applied — items are taken as-is.
    Returns: (pages, log_text)
    """
    log: list[str] = []
    log.append("═══ PhotoBook Studio — Log ricalcolo ═══")
    log.append(f"  Profilo: {profile.get('name','?')}")
    log.append(f"  Foto in input: {len(photo_items)}")

    page_types = profile.get("page_types") or FALLBACK_PAGE_TYPES
    profile_orientation = profile.get("orientation", "portrait")
    page_types = [
        pt for pt in page_types
        if pt.get("enabled", True)
        and pt.get("orientation", "any") in ("any", profile_orientation)
    ] or FALLBACK_PAGE_TYPES

    page_ar = _get_page_ar(profile)
    log.append(f"  Formato: {profile.get('page_size','?')} {profile_orientation} → page_ar={page_ar:.3f}")
    log.append(f"  Tipi pagina disponibili: {len(page_types)}")
    if config:
        log.append(f"  Config: {config}")
    log.append("")

    def _to_photo(item: dict) -> dict:
        """Convert a layout photo item back to a Photo-compatible dict."""
        exif = item.get("exif", {}) or {}
        return {
            "id":               item.get("asset_id", ""),
            "asset_id":         item.get("asset_id", ""),
            "exifInfo":         exif,
            "exif":             exif,
            "description":      item.get("description", ""),
            "originalFileName": item.get("originalFileName", ""),
            "localDateTime":    item.get("localDateTime", ""),
            "has_caption":      item.get("has_caption", False),
            "isFavorite":       item.get("isFavorite", False),
            "_updated_at":      item.get("_updated_at", ""),
            "_badge_date":      item.get("_badge_date", ""),
            "_badge_location":  item.get("_badge_location", ""),
            "badges":           item.get("badges", []),
            "people":           [],
            "faces":            [],
        }

    photos = [_to_photo(it) for it in photo_items if it.get("type") == "photo"]
    log.append(f"  Foto valide (type=photo): {len(photos)}")
    if not photos:
        log.append("  ATTENZIONE: nessuna foto valida — ricalcolo saltato")
        return [], "\n".join(log)

    usage_counter: dict[str, int] = {}
    transforms: dict = {}

    import logging as _logging
    _log = _logging.getLogger(__name__)
    _log.info(f"[recalc] {len(photos)} foto, {len(page_types)} tipi pagina, page_ar={page_ar:.3f}")
    for pt in page_types[:3]:
        _log.info(f"[recalc]   page_type '{pt.get('label')}' slots={len(pt.get('slots') or [])}")

    pages, _page_logs = _make_pages_from_group(
        photos=photos,
        page_types=page_types,
        usage_counter=usage_counter,
        config=config,
        transforms=transforms,
        log=log,
        group_label="recalc",
        page_offset=0,
        page_ar=page_ar,
    )
    _log.info(f"[recalc] → {len(pages)} pagine, items per pagina: {[len(p.get('items') or []) for p in pages]}")
    log.append("")
    log.append(f"  Pagine generate: {len(pages)}")
    return pages, "\n".join(log)

