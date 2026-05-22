"""demo_data.py — Static fake Immich data for DEMO_MODE."""
import hashlib
import uuid as _uuid
from datetime import datetime, timedelta


def _uid(n: int) -> str:
    return str(_uuid.UUID(int=n))

def _sha(n: int) -> str:
    return hashlib.sha256(str(n).encode()).hexdigest()[:32]

# ── GPS locations ──────────────────────────────────────────────────────────────

_TOSCANA_GPS = [
    ("Florence",      "Italy", 43.7696, 11.2558),
    ("Siena",         "Italy", 43.3186, 11.3307),
    ("Pisa",          "Italy", 43.7228, 10.4017),
    ("Lucca",         "Italy", 43.8430, 10.5060),
    ("Volterra",      "Italy", 43.4017, 10.8602),
    ("San Gimignano", "Italy", 43.4677, 11.0432),
]
_DOLOMITI_GPS = [
    ("Bolzano",  "Italy", 46.4983, 11.3548),
    ("Ortisei",  "Italy", 46.5741, 11.6736),
    ("Merano",   "Italy", 46.6712, 11.1582),
    ("Cortina",  "Italy", 46.5405, 12.1357),
    ("Brunico",  "Italy", 46.7968, 11.9384),
]
_BARCELLONA_GPS = [
    ("Barcelona", "Spain", 41.4036, 2.1744),
    ("Barcelona", "Spain", 41.4145, 2.1527),
    ("Barcelona", "Spain", 41.3830, 2.1763),
    ("Barcelona", "Spain", 41.3803, 2.1906),
    ("Barcelona", "Spain", 41.3888, 2.1590),
]

# ── Face helpers ───────────────────────────────────────────────────────────────

def _make_faces(n: int, w: int, h: int, specs: list) -> list:
    """specs: list of (name, (x1f, y1f, x2f, y2f)) in 0..1 fractions."""
    people = []
    for i, (name, (x1f, y1f, x2f, y2f)) in enumerate(specs):
        base = n * 10000 + i * 1000
        people.append({
            "id": _uid(base + 1),
            "name": name,
            "faces": [{
                "id": _uid(base + 2),
                "boundingBoxX1": int(x1f * w),
                "boundingBoxY1": int(y1f * h),
                "boundingBoxX2": int(x2f * w),
                "boundingBoxY2": int(y2f * h),
                "imageWidth": w,
                "imageHeight": h,
            }]
        })
    return people

# ── Asset builder ──────────────────────────────────────────────────────────────

def _asset(n: int, date: datetime, picsum_id: int, w: int, h: int,
           gps=None, faces=None, caption: str = "", fav: bool = False) -> dict:
    exif: dict = {
        "exifImageWidth": w, "exifImageHeight": h,
        "make": "Canon", "model": "EOS R6",
        "fNumber": 2.8, "exposureTime": "1/250", "iso": 400,
        "focalLength": 50.0,
    }
    if gps:
        city, country, lat, lon = gps
        exif.update({"latitude": lat, "longitude": lon, "city": city, "country": country})
    return {
        "id": _uid(n),
        "fileCreatedAt": date.isoformat() + "Z",
        "localDateTime": date.isoformat(),
        "originalFileName": f"DEMO_{n:04d}.jpg",
        "type": "IMAGE",
        "isFavorite": fav,
        "description": caption,
        "checksum": _sha(n),
        "exifInfo": exif,
        "people": _make_faces(n, w, h, faces) if faces else [],
        "_picsum_id": picsum_id,
        "_width": w,
        "_height": h,
    }

def _g(locations: list, i: int):
    return locations[i % len(locations)]

# ── Album 1: Toscana 2023 (18 photos, picsum 10–27) ───────────────────────────

_T0 = datetime(2023, 7, 1, 9, 0, 0)
_TOS_WH = [
    (1280, 853), (1280, 853), (854, 1280), (1280, 853), (1280, 853), (854, 1280),
    (1280, 853), (1280, 853), (854, 1280), (1280, 853), (1280, 853), (854, 1280),
    (1280, 853), (1280, 853), (854, 1280), (1280, 853), (1280, 853), (854, 1280),
]
_TOS_CAP = {2: "Duomo di Firenze all'alba", 5: "Le torri di San Gimignano",
            11: "Piazza del Campo, Siena",  15: "Torre di Pisa al tramonto"}
_TOS_FAV = {2, 5, 11, 15}
_TOS = [_asset(_i + 1, _T0 + timedelta(hours=_i * 8), 10 + _i, *_TOS_WH[_i],
               gps=_g(_TOSCANA_GPS, _i), caption=_TOS_CAP.get(_i + 1, ""),
               fav=(_i + 1 in _TOS_FAV)) for _i in range(18)]

# ── Album 2: Dolomiti Estate (17 photos, picsum 28–44) ────────────────────────

_D0 = datetime(2023, 8, 1, 8, 0, 0)
_DOL_WH = [
    (1280, 853), (1280, 853), (1280, 853), (854, 1280), (1280, 853), (1280, 853),
    (854, 1280), (1280, 853), (1280, 853), (854, 1280), (1280, 853), (1280, 853),
    (854, 1280), (1280, 853), (1280, 853), (854, 1280), (1280, 853),
]
_DOL_CAP = {19: "Le Tre Cime di Lavaredo", 23: "Lago di Braies al mattino",
            30: "Panorama dal Sass Pordoi"}
_DOL_FAV = {19, 23, 30}
_DOL = [_asset(_i + 19, _D0 + timedelta(hours=_i * 9), 28 + _i, *_DOL_WH[_i],
               gps=_g(_DOLOMITI_GPS, _i), caption=_DOL_CAP.get(_i + 19, ""),
               fav=(_i + 19 in _DOL_FAV)) for _i in range(17)]

# ── Album 3: Famiglia (13 photos, picsum 45–57, faces) ────────────────────────

_F0 = datetime(2023, 12, 25, 10, 0, 0)
_FAM_WH = [
    (854, 1280), (1280, 853), (854, 1280), (854, 1280), (1280, 853),
    (854, 1280), (854, 1280), (1280, 853), (854, 1280), (854, 1280),
    (1280, 853), (854, 1280), (854, 1280),
]
_FAM_CAP = {36: "Natale in famiglia", 39: "Compleanno di Marco", 43: "Primavera 2024"}
_FAM_FAV = {36, 39, 43}
_MARCO = ("Marco Rossi", (0.05, 0.04, 0.48, 0.40))
_LAURA = ("Laura Rossi", (0.52, 0.04, 0.95, 0.40))
_FAM_FACES = {
    36: [_MARCO, _LAURA], 37: [_MARCO], 38: [_LAURA], 39: [_MARCO, _LAURA],
    40: [_MARCO], 41: [_LAURA], 42: [_MARCO, _LAURA], 43: [_MARCO],
    44: [_LAURA, _MARCO], 45: [_MARCO], 46: [_LAURA], 47: [_MARCO, _LAURA],
    48: [_MARCO],
}
_FAM = [_asset(_i + 36, _F0 + timedelta(days=_i * 8), 45 + _i, *_FAM_WH[_i],
               gps=None, faces=_FAM_FACES.get(_i + 36),
               caption=_FAM_CAP.get(_i + 36, ""),
               fav=(_i + 36 in _FAM_FAV)) for _i in range(13)]

# ── Album 4: Barcellona 2024 (16 photos, picsum 58–73) ────────────────────────

_B0 = datetime(2024, 4, 1, 10, 0, 0)
_BAR_WH = [
    (1280, 853), (854, 1280), (1280, 853), (1280, 853), (854, 1280), (1280, 853),
    (1280, 853), (854, 1280), (1280, 853), (1280, 853), (854, 1280), (1280, 853),
    (854, 1280), (1280, 853), (1280, 853), (854, 1280),
]
_BAR_CAP = {49: "Sagrada Família al tramonto", 53: "Park Güell — mosaici di Gaudí",
            58: "Vista dal Monte Tibidabo"}
_BAR_FAV = {49, 53, 58}
_BAR = [_asset(_i + 49, _B0 + timedelta(hours=_i * 10), 58 + _i, *_BAR_WH[_i],
               gps=_g(_BARCELLONA_GPS, _i), caption=_BAR_CAP.get(_i + 49, ""),
               fav=(_i + 49 in _BAR_FAV)) for _i in range(16)]

# ── Lookup maps ────────────────────────────────────────────────────────────────

ALL_ASSETS = _TOS + _DOL + _FAM + _BAR
ASSET_MAP: dict[str, dict] = {a["id"]: a for a in ALL_ASSETS}

# ── Albums ────────────────────────────────────────────────────────────────────

def _album(n: int, name: str, desc: str, assets: list, end_iso: str) -> dict:
    return {
        "id": _uid(1000 + n),
        "albumName": name,
        "description": desc,
        "assetCount": len(assets),
        "shared": False,
        "albumThumbnailAssetId": assets[0]["id"] if assets else None,
        "startDate": assets[0]["fileCreatedAt"] if assets else None,
        "endDate": end_iso,
        "assets": assets,
    }

DEMO_ALBUM_DETAILS: dict[str, dict] = {
    _uid(1001): _album(1, "Toscana 2023",   "Estate in Toscana tra arte, vino e paesaggi mozzafiato", _TOS, "2023-07-15T00:00:00"),
    _uid(1002): _album(2, "Dolomiti Estate","Trekking e panorami sulle Dolomiti",                      _DOL, "2023-08-15T00:00:00"),
    _uid(1003): _album(3, "Famiglia",       "Momenti con la famiglia",                                 _FAM, "2024-03-28T00:00:00"),
    _uid(1004): _album(4, "Barcellona 2024","Viaggio in Catalogna, Gaudí e tapas",                     _BAR, "2024-04-17T00:00:00"),
}

DEMO_ALBUMS: list[dict] = [
    {k: v for k, v in det.items() if k != "assets"}
    for det in DEMO_ALBUM_DETAILS.values()
]
