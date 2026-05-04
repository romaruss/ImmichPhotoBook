"""
album_generator.py — Motore di generazione layout per PhotoBook Studio

Unico punto di ingresso: generate_album(assets, profile, config) → (pages, transforms, log)
"""

from __future__ import annotations
import math, hashlib, re
from datetime import datetime, timedelta
from typing import Any

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
}

FALLBACK_PAGE_TYPES = [
    {"id": "f1", "label": "1 foto",       "slots": [{"x":0,"y":0,"w":100,"h":100}]},
    {"id": "f2", "label": "2 affiancate", "slots": [{"x":0,"y":0,"w":50,"h":100},{"x":50,"y":0,"w":50,"h":100}]},
    {"id": "f4", "label": "4 griglia",    "slots": [{"x":0,"y":0,"w":50,"h":50},{"x":50,"y":0,"w":50,"h":50},
                                                     {"x":0,"y":50,"w":50,"h":50},{"x":50,"y":50,"w":50,"h":50}]},
]
FULL_PAGE_TYPE = {"id": "__full__", "label": "Pagina intera", "slots": [{"x":0,"y":0,"w":100,"h":100}]}


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
    Ritorna (larghezza_display, altezza_display) tenendo conto dell'orientamento EXIF.

    Le fotocamere spesso salvano fisicamente i pixel come landscape e memorizzano
    l'orientamento desiderato in un tag EXIF. In questi casi exifImageWidth > exifImageHeight
    anche se la foto visualizzata è portrait.

    Tag EXIF orientation:
      1 = normale
      2 = specchio orizzontale
      3 = 180°
      4 = specchio verticale
      5 = 90° CW + specchio
      6 = 90° CW         ← portrait da DSLR/telefono landscape
      7 = 90° CCW + specchio
      8 = 90° CCW        ← portrait ruotato
    Per 5,6,7,8 le dimensioni fisiche sono invertite rispetto al display.
    """
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
        if size < 0.01:
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








def _face_would_be_clipped(face: dict, photo_ar: float, slot_ar: float) -> bool:
    """
    Verifica se il volto sarebbe tagliato quando la foto viene messa nello slot.
    
    La foto viene sempre scalata per riempire lo slot (objectFit: cover).
    Se photo_ar > slot_ar → foto più larga → verrà ritagliata ai lati.
    Se photo_ar < slot_ar → foto più alta → verrà ritagliata sopra/sotto.
    
    Controlla se il volto cade nella zona ritagliata.
    """
    cx, cy = face["cx"], face["cy"]
    fw, fh = face["x2"] - face["x1"], face["y2"] - face["y1"]

    if abs(photo_ar - slot_ar) < 0.1:
        # AR molto simile → quasi nessun ritaglio
        return False

    if photo_ar > slot_ar:
        # Foto più larga: ritaglio laterale. Fraction visibile in X:
        visible_w = slot_ar / photo_ar
        # L'immagine è centrata → margine ritagliato su ogni lato = (1-visible_w)/2
        margin = (1 - visible_w) / 2
        face_left_edge  = cx - fw / 2
        face_right_edge = cx + fw / 2
        # Il volto è tagliato se esce dalla zona visibile [margin, 1-margin]
        if face_left_edge < margin or face_right_edge > (1 - margin):
            return True
    else:
        # Foto più alta: ritaglio verticale. Fraction visibile in Y:
        visible_h = photo_ar / slot_ar
        margin = (1 - visible_h) / 2
        face_top_edge    = cy - fh / 2
        face_bottom_edge = cy + fh / 2
        if face_top_edge < margin or face_bottom_edge > (1 - margin):
            return True

    return False




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
    prominent = [f for f in faces if f.get("size", 0) >= 0.02] or faces
    if not prominent:
        return {"x": 50.0, "y": 50.0, "zoom": 1.0}

    bb_x1 = min(f["x1"] for f in prominent)
    bb_y1 = min(f["y1"] for f in prominent)
    bb_x2 = max(f["x2"] for f in prominent)
    bb_y2 = max(f["y2"] for f in prominent)
    cx    = (bb_x1 + bb_x2) / 2
    cy    = (bb_y1 + bb_y2) / 2

    MARGIN  = 0.05   # 5% margine minimo dai bordi slot
    TARGET  = 0.38   # posiziona il centro dei volti al 38% dall'alto slot

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

    pan_x = max(5.0, min(95.0, pan_x))
    pan_y = max(5.0, min(95.0, pan_y))

    return {"x": round(pan_x, 1), "y": round(pan_y, 1), "zoom": 1.0}








def _has_prominent_face(photo: Photo) -> bool:
    """True se la foto ha un volto che occupa almeno il 10% dell'immagine."""
    face = _get_face_region(photo)
    return face is not None and face["size"] >= 0.02


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
        key = (round(lat, 3), round(lon, 3))
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
    max_hamming     = max(0, int((1 - threshold) * 128))
    time_window_sec = max(30, int((1 - threshold) * 1200))

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
            visual_ok = (dh_p is not None and dh_k is not None
                         and _hamming(dh_p, dh_k) <= max_hamming)

            # ── Criterio burst (nome base + tempo) ────────────────────────────
            burst_ok = (bool(bn_p) and bool(bn_k) and bn_p == bn_k
                        and dt_p is not None and dt_k is not None
                        and abs((dt_p - dt_k).total_seconds()) <= time_window_sec)

            if visual_ok and burst_ok:
                dist   = _hamming(dh_p, dh_k)
                better = p if _photo_quality(p) > _photo_quality(k) else k
                worse  = k if better is p else p
                log.append(f"  DUPLICATO rimosso: {worse.get('originalFileName','?')} "
                            f"→ tenuto: {better.get('originalFileName','?')} "
                            f"(hamming={dist}/{max_hamming}, finestra={time_window_sec}s)")
                excluded.append({
                    'asset_id':      worse.get('id', ''),
                    'filename':      worse.get('originalFileName', ''),
                    'datetime':      worse.get('localDateTime', ''),
                    'reason':        'duplicate_visual',
                    'detail':        (f"visivo+burst: hamming={dist}, "
                                     f"entro {time_window_sec}s da '{better.get('originalFileName','?')}'"),
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
        score += orientation_violations * 10_000
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
            score += unfilled_cap_slots * 5_000
            detail.append(f"empty_caption_slot={unfilled_cap_slots}×5000")
        if captions_available > 0:
            # Layout has caption slot AND photos have descriptions: strong bonus
            cap_bonus = captions_available * 200
            score -= cap_bonus
            detail.append(f"caption_match_bonus={captions_available}×-200={-cap_bonus}")
    if n_caption_slots == 0 and n_caps_on_page > 0:
        # Photos have descriptions but layout has no caption slot: strong penalty
        pen = n_caps_on_page * 300
        score += pen
        detail.append(f"has_caption_no_cap_slot={n_caps_on_page}×300={pen}")

    # ── 2. Slot vuoti (penalizza layout troppo grandi rispetto alle foto) ─────
    # Caption slots are filled with text, not photos — exclude them from this count.
    empty_slots = max(0, n_photo_slots - n_photos)
    if empty_slots > 0:
        # Penalizza in proporzione: 1 slot vuoto ok, 2+ molto penalizzati
        score += (empty_slots ** 2) * 200
        detail.append(f"empty_slots={empty_slots}×{empty_slots*200}")

    # ── 3. Differenza dal target di slot ──────────────────────────────────────
    # density 100 → 1 slot target, density 0 → max_slots
    # Both effective_slots and max_slots count only photo slots (caption slots are bonus).
    effective_slots = max(1, n_photo_slots)
    slot_target = max(1, round(1 + (max_slots - 1) * (1 - density_target / 100)))
    slot_target = min(slot_target, n_photos)
    diff = abs(effective_slots - slot_target)
    density_penalty = (diff ** 2) * 50
    score += density_penalty
    detail.append(f"slot_diff=|{n_photo_slots}-{slot_target}|²×50={density_penalty}")

    # ── 4. Volto tagliato ─────────────────────────────────────────────────────
    # Penalità LIEVE — influenza la scelta ma non la domina.
    # La regola orientamento è già la principale difesa per i volti.
    face_penalty = 0.0
    for slot, photo in zip(slots, assigned):
        if photo is None:
            continue
        face = _get_face_region(photo)
        if face is not None and face["size"] >= 0.12:   # ignora volti piccoli/lontani
            p_ar = _photo_ar(photo)
            s_ar = _slot_ar(slot, page_ar)
            if _face_would_be_clipped(face, p_ar, s_ar):
                face_penalty += 30 * face["size"]
    score += face_penalty
    if face_penalty > 0:
        detail.append(f"face_penalty={face_penalty:.1f}")

    # ── 5. Diversità: penalizza layout già molto usati ────────────────────────
    pid   = pt.get("id", "")
    usage = usage_counter.get(pid, 0)
    score += usage * 8
    detail.append(f"usage={usage}×8={usage*8}")

    # ── 6. Bonus per layout mai usato ────────────────────────────────────────
    if usage == 0:
        score -= 30
        detail.append("unused_bonus=-30")

    # ── 7. Ritmo visivo ───────────────────────────────────────────────────────
    if rhythm and prev_dense is not None:
        is_dense = ns >= 3
        if is_dense == prev_dense:
            score += 4
            detail.append("rhythm_penalty=4")

    if verbose_log is not None:
        verbose_log.append(f"      {pt.get('label','?'):25s} score={score:7.1f}  [{', '.join(detail)}]")

    if _return_breakdown:
        no_cap_pen = (n_caps_on_page * 300) if (n_caption_slots == 0 and n_caps_on_page > 0) else 0
        return score, {
            'orient_violations': orientation_violations,
            'orient_score':      orientation_violations * 10_000,
            'cap_unfilled':      unfilled_cap_slots,
            'cap_score':         unfilled_cap_slots * 5_000,
            'cap_bonus':         cap_bonus,
            'no_cap_penalty':    no_cap_pen,
            'empty_slots':       empty_slots,
            'empty_score':       (empty_slots**2)*200,
            'slot_target':       slot_target,
            'slot_diff':         diff,
            'density_score':     density_penalty,
            'face_penalty':      round(face_penalty, 1),
            'usage':             usage,
            'usage_score':       usage * 8,
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



def _make_photo_item(photo: Photo) -> Item:
    exif = photo.get("exifInfo") or {}
    desc = (exif.get("description") or photo.get("description") or "").strip()
    return {
        "type":             "photo",
        "asset_id":         photo["id"],
        "description":      desc,
        "originalFileName": photo.get("originalFileName", ""),
        "localDateTime":    photo.get("localDateTime", ""),
        "exif":             exif,
        "has_caption":      bool(desc),
        "isFavorite":       bool(photo.get("isFavorite")),
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
) -> list[Page]:
    if not photos:
        return []

    density      = config.get("density", 75)
    rhythm       = config.get("rhythm_alternation", True)
    face_crop    = config.get("face_crop", True)
    favs_full    = config.get("favorites_full_page", False)
    fill_map     = config.get("fill_empty_with_map", False)
    auto_captions = config.get("auto_captions", True)

    # Pre-filter page_types: when auto_captions=False, exclude layouts with caption slots
    page_types_no_cap = [pt for pt in page_types if not any(s.get("slot_type") == "caption" for s in pt.get("slots", []))]
    pt_pool = page_types if auto_captions else (page_types_no_cap or page_types)

    # GPS locations for the whole group (used to fill empty slots with a map)
    group_gps: list[dict] = _extract_gps(photos) if fill_map else []

    pages: list[Page] = []
    remaining = list(photos)
    prev_dense: bool | None = None

    page_logs: list[dict] = []
    while remaining:
        _page_candidates = []
        photo = remaining[0]

        # Foto preferita → pagina intera
        if favs_full and photo.get("isFavorite"):
            pt    = FULL_PAGE_TYPE
            n_photo_sl, n_cap_sl = 1, 0
            _page_candidates = [{'id':'__full__','label':'Pagina intera','score':0,'winner':True,'breakdown':{'total':0,'orient_violations':0,'n_photo_slots':1,'n_caption_slots':0,'unused_bonus':False,'rhythm_penalty':False}}]
            chunk = [photo]
            remaining = remaining[1:]
            log.append(f"  [★ PREFERITA] {photo.get('originalFileName','?')} → pagina intera")
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
            pt, _page_candidates = _best_page_type(
                pt_pool, effective, usage_counter, density, rhythm, prev_dense,
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
                if auto_captions and descriptions_queue:
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

            item = _make_photo_item(photo_a)
            items.append({"slot": slot, "item": item})

            # ── Logging orientamento ──
            is_portrait_photo = _photo_is_portrait(photo_a)
            is_portrait_slot  = _slot_is_portrait(slot, page_ar)
            match_icon = "✓" if is_portrait_photo == is_portrait_slot else "⚠ MISMATCH"
            log.append(
                f"  {match_icon} {photo_a.get('originalFileName','?')} "
                f"({'V' if is_portrait_photo else 'H'}) → Slot {si+1} "
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
                    prominent = [f for f in all_faces if f.get("size",0) >= 0.02]
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
                prom2  = [f for f in faces2 if f.get('size',0)>=0.02]
                fr2    = _get_face_region(pr2) if pr2 else None
                p_ar2  = _photo_ar(pr2) if pr2 else 1.0
                s_ar2  = _slot_ar(slot2, page_ar)
                clipped= _face_would_be_clipped(fr2,p_ar2,s_ar2) if fr2 and fr2.get('size',0)>=0.12 else False
                tr2    = transforms.get(f'{pg_idx}_{si2}',{'x':50,'y':50,'zoom':1.0})
                q_score = round(_photo_quality(pr2), 3) if pr2 else None
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
                    'faces':{'count':len(faces2),'prominent':len(prom2),
                             'bbox':[round(min(f['x1'] for f in prom2 or faces2),3),
                                     round(min(f['y1'] for f in prom2 or faces2),3),
                                     round(max(f['x2'] for f in prom2 or faces2),3),
                                     round(max(f['y2'] for f in prom2 or faces2),3)] if (prom2 or faces2) else None,
                             'would_clip':clipped} if faces2 else None,
                    'transform':tr2,'quality_score':q_score})
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
        pages.append({'page_type_id':tid,'page_type':pt,'items':items})

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

    for label, group in units:
        log.append(f"─── {label.upper()} ({len(group)} foto) ───")
        group_pages, group_logs = _make_pages_from_group(
            group, page_types, usage_counter, cfg, transforms, log, label, len(all_pages), page_ar
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


