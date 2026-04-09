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


def _pick_page_type(page_types: list[dict], rng: random.Random,
                    min_slots: int, remaining_units: int) -> dict:
    """
    Choose a page type that has at least `min_slots` slots.
    Weights toward larger pages when many units remain.
    """
    suitable = [
        pt for pt in page_types
        if len(pt.get("slots") or [{"x": 0, "y": 0, "w": 100, "h": 100}]) >= min_slots
    ]
    if not suitable:
        suitable = page_types  # fallback: may have fewer slots than needed

    # Weight by slot count (more slots = more probable when items remain)
    weights = [
        len(pt.get("slots") or [{"x": 0, "y": 0, "w": 100, "h": 100}])
        for pt in suitable
    ]
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
    Pack flow items into pages, respecting caption co-location.

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
        unit_size = len(unit)          # 1 or 2
        remaining = len(units) - unit_idx

        pt = _pick_page_type(page_types, rng, min_slots=unit_size, remaining_units=remaining)
        slots = pt.get("slots") or default_slot_grid(1)

        page_items: list[dict] = []
        slot_i = 0

        # ── Place current unit first ──────────────────────────────────────
        for item in unit:
            if slot_i < len(slots):
                page_items.append({"slot": slots[slot_i], "item": item})
                slot_i += 1
        unit_idx += 1

        # ── Fill remaining slots with single-item units ───────────────────
        while slot_i < len(slots) and unit_idx < len(units):
            next_unit = units[unit_idx]
            if len(next_unit) == 1:
                page_items.append({"slot": slots[slot_i], "item": next_unit[0]})
                slot_i += 1
                unit_idx += 1
            elif slot_i + len(next_unit) <= len(slots):
                # Multi-item unit fits remaining slots exactly
                for item in next_unit:
                    if slot_i < len(slots):
                        page_items.append({"slot": slots[slot_i], "item": item})
                        slot_i += 1
                unit_idx += 1
            else:
                # Multi-item unit would need to split — leave slots empty
                break

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
