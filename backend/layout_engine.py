"""
layout_engine.py

Regole di impaginazione:
  - Le didascalie DEVONO stare sulla stessa pagina della foto a cui si riferiscono.
  - Le foto con didascalia vengono trattate come "unità" inscindibili (2 slot).
  - Le unità vengono imballate nelle pagine in modo da non spezzarle.
  - I slot rimanenti vengono riempiti con foto singole o lasciati vuoti.
"""

import random
from typing import Optional


# ── Default slot grids (% coordinates) ───────────────────────────────────────

def default_slot_grid(n: int) -> list[dict]:
    grids = {
        1: [{"x": 0,  "y": 0,  "w": 100, "h": 100}],
        2: [{"x": 0,  "y": 0,  "w": 100, "h": 50},
            {"x": 0,  "y": 50, "w": 100, "h": 50}],
        3: [{"x": 0,  "y": 0,  "w": 100, "h": 40},
            {"x": 0,  "y": 40, "w": 50,  "h": 60},
            {"x": 50, "y": 40, "w": 50,  "h": 60}],
        4: [{"x": 0,  "y": 0,  "w": 50,  "h": 50},
            {"x": 50, "y": 0,  "w": 50,  "h": 50},
            {"x": 0,  "y": 50, "w": 50,  "h": 50},
            {"x": 50, "y": 50, "w": 50,  "h": 50}],
    }
    return grids.get(n, grids[1])


# ── Build content flow ────────────────────────────────────────────────────────

def build_flow(assets: list[dict]) -> list[dict]:
    """
    Build the ordered flow of photo items (with has_caption flag).
    Caption items are separate entries immediately after their photo.
    """
    flow: list[dict] = []
    for asset in assets:
        exif = asset.get("exifInfo", {}) or {}
        desc = (
            exif.get("description")
            or asset.get("description")
            or ""
        ).strip()

        photo_item = {
            "type": "photo",
            "asset_id": asset["id"],
            "description": desc,
            "originalFileName": asset.get("originalFileName", ""),
            "localDateTime": asset.get("localDateTime", ""),
            "exif": exif,
            "has_caption": bool(desc),
        }
        flow.append(photo_item)

        if desc:
            flow.append({
                "type": "caption",
                "text": desc,
                "for_asset_id": asset["id"],
                "originalFileName": asset.get("originalFileName", ""),
            })

    return flow


def rebuild_flow_from_photos(photo_items: list[dict]) -> list[dict]:
    """
    Given a list of photo items (without captions), rebuild the full flow
    re-inserting caption items for photos that have descriptions.
    Used by the recalculate endpoint.
    """
    flow: list[dict] = []
    for item in photo_items:
        flow.append(item)
        if item.get("has_caption") and item.get("description"):
            flow.append({
                "type": "caption",
                "text": item["description"],
                "for_asset_id": item["asset_id"],
                "originalFileName": item.get("originalFileName", ""),
            })
    return flow


# ── Layout allocation ─────────────────────────────────────────────────────────

def _group_into_units(flow: list[dict]) -> list[list[dict]]:
    """
    Group flow items into placement units.
    A photo with a caption forms a 2-item unit (must go on same page).
    A solo photo is a 1-item unit.
    """
    units: list[list[dict]] = []
    i = 0
    while i < len(flow):
        item = flow[i]
        # Check: is the next item the caption for this photo?
        if (
            item.get("type") == "photo"
            and item.get("has_caption")
            and i + 1 < len(flow)
            and flow[i + 1].get("type") == "caption"
            and flow[i + 1].get("for_asset_id") == item.get("asset_id")
        ):
            units.append([item, flow[i + 1]])  # inseparable pair
            i += 2
        else:
            units.append([item])
            i += 1
    return units


def _slot_is_portrait(slot: dict) -> bool:
    """True se lo slot è più alto che largo (verticale)."""
    return slot.get("h", 0) > slot.get("w", 0)


def _photo_is_portrait_from_item(item: dict) -> bool:
    """Rileva l'orientamento di un item foto dalla sua EXIF."""
    exif = item.get("exif", {}) or {}
    w = exif.get("exifImageWidth") or exif.get("imageWidth") or 0
    h = exif.get("exifImageHeight") or exif.get("imageHeight") or 0
    if w and h:
        return h > w
    return True   # default: portrait


def _orientation_match_score(page_type: dict, photo_items: list[dict]) -> int:
    """
    Calcola quanti foto-slot pairs hanno orientamento corrispondente.
    Ritorna un conteggio di match (più alto = meglio).
    Usato da _pick_page_type per scegliere il template più adatto.
    """
    slots = page_type.get("slots") or []
    # Considera solo gli slot foto (esclude caption, che sono solitamente orizzontali)
    photo_slots = [s for s in slots]  # tutti gli slot possono essere foto
    
    # Conteggio orientamenti nei due pool
    photo_portraits  = sum(1 for p in photo_items if _photo_is_portrait_from_item(p))
    photo_landscapes = len(photo_items) - photo_portraits
    slot_portraits   = sum(1 for s in photo_slots[:len(photo_items)] if _slot_is_portrait(s))
    slot_landscapes  = len(photo_slots[:len(photo_items)]) - slot_portraits
    
    # Match: quante coppie (foto, slot) hanno lo stesso orientamento
    matched_portrait  = min(photo_portraits,  slot_portraits)
    matched_landscape = min(photo_landscapes, slot_landscapes)
    return matched_portrait + matched_landscape


def _assign_photos_to_slots(photo_items: list[dict], slots: list[dict]) -> list[dict | None]:
    """
    Assegna le foto agli slot massimizzando i match di orientamento:
      - foto verticali  → slot verticali
      - foto orizzontali → slot orizzontali

    Ritorna una lista ordinata di item (stesso ordine degli slot).
    Gli slot in eccesso rispetto alle foto ricevono None.
    
    Algoritmo greedy O(n):
    1. Separa foto e slot per orientamento
    2. Abbina verticali con verticali, orizzontali con orizzontali
    3. I residui (disallineamenti inevitabili) vengono assegnati ai restanti
    """
    n = min(len(photo_items), len(slots))
    photos = list(photo_items[:n])
    target_slots = list(slots[:n])

    # Classifica slot e foto
    portrait_slot_idx  = [i for i, s in enumerate(target_slots) if _slot_is_portrait(s)]
    landscape_slot_idx = [i for i, s in enumerate(target_slots) if not _slot_is_portrait(s)]
    portrait_photos    = [p for p in photos if _photo_is_portrait_from_item(p)]
    landscape_photos   = [p for p in photos if not _photo_is_portrait_from_item(p)]

    # Abbina per orientamento
    result: list[dict | None] = [None] * n
    
    # Prima: verticali nelle slot verticali
    for si, pi_photo in zip(portrait_slot_idx, portrait_photos):
        result[si] = pi_photo
    
    # Poi: orizzontali nelle slot orizzontali
    for si, pi_photo in zip(landscape_slot_idx, landscape_photos):
        result[si] = pi_photo

    # Residui (foto che non hanno trovato uno slot del loro orientamento)
    used = set(id(p) for p in result if p is not None)
    remaining = [p for p in photos if id(p) not in used]
    empty_slots = [i for i, r in enumerate(result) if r is None]
    for si, photo in zip(empty_slots, remaining):
        result[si] = photo

    # Pad con None se slots > photos
    result += [None] * (len(slots) - n)
    return result


def _pick_page_type(page_types: list[dict], rng: random.Random,
                    min_slots: int, remaining_units: int,
                    next_photos: list[dict] | None = None) -> dict:
    """
    Sceglie il page type più adatto considerando l'orientamento delle foto.
    Se next_photos è fornito, preferisce il template con il miglior match
    di orientamento slot↔foto. Tra i template a pari score, usa il peso
    per numero di slot.
    """
    suitable = [
        pt for pt in page_types
        if len(pt.get("slots") or [{"x": 0, "y": 0, "w": 100, "h": 100}]) >= min_slots
    ]
    if not suitable:
        suitable = page_types

    if next_photos:
        # Seleziona il template con il miglior match di orientamento
        scored = sorted(
            suitable,
            key=lambda pt: (
                -_orientation_match_score(pt, next_photos),          # più match = meglio
                -len(pt.get("slots") or [{"x":0,"y":0,"w":100,"h":100}])  # parità → più slot
            )
        )
        return scored[0]

    # Fallback: peso per numero di slot (comportamento originale)
    weights = [len(pt.get("slots") or [{"x": 0, "y": 0, "w": 100, "h": 100}]) for pt in suitable]
    total = sum(weights)
    r = rng.random() * total
    cumulative = 0.0
    for pt, w in zip(suitable, weights):
        cumulative += w
        if r <= cumulative:
            return pt
    return suitable[-1]



def generate_layout(flow: list[dict], profile: dict) -> list[dict]:
    """
    Pack flow items into pages, respecting caption co-location and
    matching photo orientation to slot orientation.

    For each page:
      1. Look at the next N photos to be placed
      2. Pick the page_type whose slots best match their orientations
         (portrait photo → portrait slot, landscape → landscape slot)
      3. Assign photos to slots using orientation-greedy matching

    Returns list of page dicts:
      { page_type_id, page_type, items: [{slot, item}] }
    """
    page_types = profile.get("page_types") or []
    if not page_types:
        page_types = [{"id": "default", "label": "1 foto",
                       "slots": default_slot_grid(1)}]

    units = _group_into_units(flow)
    pages: list[dict] = []
    rng = random.Random(42)
    unit_idx = 0

    while unit_idx < len(units):
        unit = units[unit_idx]
        unit_size = len(unit)
        remaining = len(units) - unit_idx

        # ── Peek at upcoming photo items for orientation matching ─────────
        # Collect the photos from the current unit plus the next few single-item units
        # to give _pick_page_type enough context to choose the best template.
        peek_photos: list[dict] = [item for item in unit if item.get("type") == "photo"]
        peek_idx = unit_idx + 1
        while peek_idx < len(units) and len(peek_photos) < 6:
            for item in units[peek_idx]:
                if item.get("type") == "photo":
                    peek_photos.append(item)
            peek_idx += 1

        pt = _pick_page_type(page_types, rng,
                             min_slots=unit_size,
                             remaining_units=remaining,
                             next_photos=peek_photos or None)
        slots = pt.get("slots") or default_slot_grid(1)

        page_items: list[dict] = []
        slot_i = 0

        # ── Place current unit's items into slots ─────────────────────────
        # For a unit that is (photo, caption), always place photo first in its
        # slot, then caption in the next — they stay together.
        for item in unit:
            if slot_i < len(slots):
                page_items.append({"slot": slots[slot_i], "item": item})
                slot_i += 1
        unit_idx += 1

        # ── Fill remaining slots with upcoming single-item units ──────────
        # Collect all photos that will fill remaining slots, then assign
        # them with orientation matching before appending.
        fill_candidates: list[dict] = []
        fill_unit_indices: list[int] = []

        tmp_idx = unit_idx
        tmp_slot = slot_i
        while tmp_slot < len(slots) and tmp_idx < len(units):
            next_unit = units[tmp_idx]
            if len(next_unit) == 1:
                fill_candidates.append(next_unit[0])
                fill_unit_indices.append(tmp_idx)
                tmp_slot += 1
                tmp_idx += 1
            elif tmp_slot + len(next_unit) <= len(slots):
                for item in next_unit:
                    fill_candidates.append(item)
                    fill_unit_indices.append(tmp_idx)
                    tmp_slot += 1
                tmp_idx += 1
            else:
                break

        if fill_candidates:
            remaining_slots = slots[slot_i : slot_i + len(fill_candidates)]
            # Extract photo items for orientation matching (keep captions in order)
            photo_fills    = [c for c in fill_candidates if c.get("type") == "photo"]
            non_photo_fills = [c for c in fill_candidates if c.get("type") != "photo"]

            # Orientation-aware assignment for photos
            assigned = _assign_photos_to_slots(photo_fills, remaining_slots)
            # Re-merge non-photo items into their original positions
            photo_iter = iter(assigned)
            final_assigned: list[dict | None] = []
            fill_types = [c.get("type") for c in fill_candidates]
            photo_ptr = 0
            non_photo_ptr = 0
            for ftype in fill_types:
                if ftype == "photo":
                    final_assigned.append(assigned[photo_ptr] if photo_ptr < len(assigned) else None)
                    photo_ptr += 1
                else:
                    final_assigned.append(non_photo_fills[non_photo_ptr] if non_photo_ptr < len(non_photo_fills) else None)
                    non_photo_ptr += 1

            for s, item in zip(remaining_slots, final_assigned):
                page_items.append({"slot": s, "item": item})
                slot_i += 1

            # Advance unit_idx past consumed units
            unit_idx = fill_unit_indices[-1] + 1

        # ── Empty remaining slots ─────────────────────────────────────────
        while slot_i < len(slots):
            page_items.append({"slot": slots[slot_i], "item": None})
            slot_i += 1

        pages.append({
            "page_type_id": pt.get("id", "default"),
            "page_type": pt,
            "items": page_items,
        })

    return pages


# ── GPS extraction ────────────────────────────────────────────────────────────

def extract_gps_locations(assets: list[dict]) -> list[dict]:
    locations: list[dict] = []
    seen: set[tuple] = set()

    for asset in assets:
        exif = asset.get("exifInfo", {}) or {}
        lat = exif.get("latitude")
        lon = exif.get("longitude")
        if lat is None or lon is None:
            continue
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            continue

        key = (round(lat, 3), round(lon, 3))
        if key in seen:
            continue
        seen.add(key)

        locations.append({
            "lat": lat,
            "lon": lon,
            "asset_id": asset["id"],
            "name": (exif.get("city") or exif.get("state") or
                     asset.get("originalFileName", "")),
        })

    return locations
