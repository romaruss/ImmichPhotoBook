import json, os, uuid, asyncio, logging, time, secrets
from collections import defaultdict
from pathlib import Path
from typing import Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.responses import Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import immich_client as ic
from layout_engine import (build_flow, generate_layout, extract_gps_locations,
                           default_slot_grid, rebuild_flow_from_photos)
from smart_layout import smart_generate_layout, smart_extract_gps, apply_config, _DEFAULTS as SMART_DEFAULTS
from map_generator import generate_map_image
from pdf_generator import generate_pdf, PAGE_SIZES_MM
from svg_exporter import generate_svg_zip

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path("/data")
PROFILES_DIR = DATA_DIR / "profiles"
CONFIG_PATH  = DATA_DIR / "config.json"

# ─── AUTH & RATE LIMITING ─────────────────────────────────────────────────────
# Set PHOTOBOOK_TOKEN env var to enable auth. If unset, access is unrestricted.
# Generate a token: python3 -c "import secrets; print(secrets.token_hex(32))"
_AUTH_TOKEN   = os.environ.get("PHOTOBOOK_TOKEN", "").strip()
_AUTH_ENABLED = bool(_AUTH_TOKEN)

_rate_buckets: dict = defaultdict(lambda: {"tokens": 10.0, "last": time.time()})

def _check_bucket(key: str, capacity: float, rate: float) -> bool:
    now = time.time()
    b = _rate_buckets[key]
    b["tokens"] = min(capacity, b["tokens"] + (now - b["last"]) * rate)
    b["last"] = now
    if b["tokens"] >= 1:
        b["tokens"] -= 1
        return True
    return False

def _ip(req: Request) -> str:
    xff = req.headers.get("x-forwarded-for", "")
    return (xff.split(",")[0].strip() or (req.client.host if req.client else "?"))

async def require_auth(req: Request):
    if not _AUTH_ENABLED:
        return
    header = req.headers.get("authorization", "")
    token  = header[7:].strip() if header.startswith("Bearer ") else req.cookies.get("pb_token", "")
    if not token or not secrets.compare_digest(token, _AUTH_TOKEN):
        raise HTTPException(401, "Autenticazione richiesta")

def rl_export(req: Request):
    if not _check_bucket(f"exp:{_ip(req)}", 4, 4/60):
        raise HTTPException(429, "Troppe richieste export. Riprova tra qualche minuto.")

def rl_generate(req: Request):
    if not _check_bucket(f"gen:{_ip(req)}", 10, 10/60):
        raise HTTPException(429, "Troppe richieste. Attendi un momento.")

def rl_api(req: Request):
    if not _check_bucket(f"api:{_ip(req)}", 120, 2.0):
        raise HTTPException(429, "Troppo traffico. Riprova tra poco.")
CACHE_DIR    = DATA_DIR / "cache"
EXPORT_DIR   = DATA_DIR / "exports"
PROJECTS_DIR = DATA_DIR / "projects"
SMART_CONFIG_PATH = DATA_DIR / "smart_config.json"

def _compute_dhash(img_bytes: bytes, size: int = 8) -> int | None:
    """64-bit difference hash (dHash) using only Pillow — ~1ms per thumbnail."""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes)).convert('L').resize((size + 1, size), Image.LANCZOS)
        px = list(img.getdata())
        return sum((px[i] > px[i + 1]) << i for i in range(size * size))
    except Exception:
        return None

for d in [PROFILES_DIR, CACHE_DIR, EXPORT_DIR, PROJECTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

def _load_smart_config() -> dict:
    if SMART_CONFIG_PATH.exists():
        try:
            return json.loads(SMART_CONFIG_PATH.read_text())
        except Exception:
            pass
    return dict(SMART_DEFAULTS)

# Apply smart layout config at startup
apply_config(_load_smart_config())

app = FastAPI(title="PhotoBook Creator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# ── Auth middleware: blocks /api/* unless valid token provided ─────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Always allow: auth endpoints, static files, SPA fallback
    if not path.startswith("/api/") or path.startswith("/api/auth"):
        return await call_next(request)
    if not _AUTH_ENABLED:
        return await call_next(request)
    header = request.headers.get("authorization", "")
    token  = header[7:].strip() if header.startswith("Bearer ") else request.cookies.get("pb_token", "")
    if token and secrets.compare_digest(token, _AUTH_TOKEN):
        return await call_next(request)
    return JSONResponse({"detail": "Autenticazione richiesta"}, status_code=401)

# ── Auth endpoints (no auth required) ─────────────────────────────────────────
@app.post("/api/auth/login")
async def login(request: Request):
    if not _AUTH_ENABLED:
        return {"ok": True, "token": ""}
    body = await request.json()
    password = body.get("password", "")
    if not password or not secrets.compare_digest(password, _AUTH_TOKEN):
        raise HTTPException(401, "Password errata")
    resp = JSONResponse({"ok": True, "token": _AUTH_TOKEN})
    resp.set_cookie("pb_token", _AUTH_TOKEN, httponly=True, samesite="strict", max_age=60*60*24*30)
    return resp

@app.post("/api/auth/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("pb_token")
    return resp

@app.get("/api/auth/status")
async def auth_status():
    return {"enabled": _AUTH_ENABLED}

# ─── CONFIG ──────────────────────────────────────────────────────────────────

class ConfigModel(BaseModel):
    immich_url: str
    api_key: str

@app.get("/api/config")
async def get_config():
    if CONFIG_PATH.exists():
        data = json.loads(CONFIG_PATH.read_text())
        # Never expose the real key to the frontend — return a masked version.
        # The frontend only needs to know if a key is set (to show "configured").
        key = data.get("api_key", "")
        if key:
            visible = key[:4] + "•" * max(0, len(key) - 8) + key[-4:] if len(key) > 8 else "•" * len(key)
            data["api_key"] = visible
            data["api_key_set"] = True
        else:
            data["api_key_set"] = False
        return data
    return {"immich_url": "", "api_key": "", "api_key_set": False}

@app.post("/api/config")
async def save_config(cfg: ConfigModel):
    # If the frontend sends back a masked key (e.g. "sk-••••••1234"),
    # keep the real existing key instead of overwriting with the masked one.
    payload = cfg.dict()
    if "•" in payload.get("api_key", ""):
        if CONFIG_PATH.exists():
            existing = json.loads(CONFIG_PATH.read_text())
            payload["api_key"] = existing.get("api_key", "")
    CONFIG_PATH.write_text(json.dumps(payload, indent=2))
    return {"ok": True}

@app.get("/api/config/test")
async def test_config():
    ok = await ic.test_connection()
    return {"connected": ok}

CUSTOM_SIZES_PATH = DATA_DIR / "custom_sizes.json"

def _load_custom_sizes() -> list:
    if CUSTOM_SIZES_PATH.exists():
        try: return json.loads(CUSTOM_SIZES_PATH.read_text())
        except Exception: pass
    return []

@app.get("/api/custom-sizes")
async def get_custom_sizes():
    return _load_custom_sizes()

class CustomSize(BaseModel):
    name: str
    w_mm: float
    h_mm: float

@app.post("/api/custom-sizes")
async def add_custom_size(size: CustomSize):
    sizes = _load_custom_sizes()
    entry = {"id": str(uuid.uuid4()), "name": size.name, "w_mm": size.w_mm, "h_mm": size.h_mm}
    sizes.append(entry)
    CUSTOM_SIZES_PATH.write_text(json.dumps(sizes, indent=2))
    return entry

@app.delete("/api/custom-sizes/{sid}")
async def delete_custom_size(sid: str):
    sizes = [s for s in _load_custom_sizes() if s.get("id") != sid]
    CUSTOM_SIZES_PATH.write_text(json.dumps(sizes, indent=2))
    return {"ok": True}

# ─── PROFILES ────────────────────────────────────────────────────────────────

class Profile(BaseModel):
    name: str
    page_size: str = "20x30"
    orientation: str = "portrait"
    duplex: bool = False
    margin_mm: float = 5.0
    margin_top: float | None = None     # if None, falls back to margin_mm
    margin_right: float | None = None
    margin_bottom: float | None = None
    margin_left: float | None = None
    bleed: bool = False
    bleed_mm: float = 3.0
    gap_mm: float = 3.0
    page_types: list[dict] = []
    caption_style: dict = {
        "font": "Georgia, serif",
        "size": 13,
        "color": "#e8e6e0",
        "align": "center",
        "valign": "center",
        "bg": "#111116",
        "italic": True,
        "bold": False,
    }
    cover_style: dict | None = None
    divider_style: dict | None = None  # layout della pagina divisore album
    map_style: dict | None = None
    export_dpi: int = 300
    color_profile: str = "srgb"    # srgb | adobe_rgb | fogra39 | fogra51 | swop
    crop_marks: bool = False        # stampa crocini di taglio agli angoli

@app.post("/api/profiles/{pid}/duplicate")
async def duplicate_profile(pid: str):
    path = PROFILES_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    data = json.loads(path.read_text())
    new_data = {**data, "name": f"{data.get('name','')} (copia)"}
    # Give fresh UUIDs to all page types
    new_data["page_types"] = [
        {**pt, "id": str(uuid.uuid4())}
        for pt in data.get("page_types", [])
    ]
    new_pid = str(uuid.uuid4())
    (PROFILES_DIR / f"{new_pid}.json").write_text(json.dumps(new_data, indent=2))
    new_data["id"] = new_pid
    return new_data

def _default_page_types():
    return [
        {"id": str(uuid.uuid4()), "label": "1 foto", "slots": default_slot_grid(1)},
        {"id": str(uuid.uuid4()), "label": "2 foto", "slots": default_slot_grid(2)},
        {"id": str(uuid.uuid4()), "label": "4 foto", "slots": default_slot_grid(4)},
    ]

@app.get("/api/profiles")
async def list_profiles():
    profiles = []
    for f in PROFILES_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            data["id"] = f.stem
            profiles.append(data)
        except Exception:
            pass
    return profiles

@app.post("/api/profiles")
async def create_profile(profile: Profile):
    pid = str(uuid.uuid4())
    data = profile.dict()
    if not data["page_types"]:
        data["page_types"] = _default_page_types()
    (PROFILES_DIR / f"{pid}.json").write_text(json.dumps(data, indent=2))
    data["id"] = pid
    return data

@app.put("/api/profiles/{pid}")
async def update_profile(pid: str, profile: Profile):
    path = PROFILES_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    data = profile.dict()
    path.write_text(json.dumps(data, indent=2))
    data["id"] = pid
    return data

@app.delete("/api/profiles/{pid}")
async def delete_profile(pid: str):
    path = PROFILES_DIR / f"{pid}.json"
    if path.exists():
        path.unlink()
    return {"ok": True}

@app.get("/api/profiles/{pid}")
async def get_profile(pid: str):
    path = PROFILES_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    data = json.loads(path.read_text())
    data["id"] = pid
    return data

# ─── ALBUMS ──────────────────────────────────────────────────────────────────

@app.get("/api/albums")
async def list_albums():
    try:
        albums = await ic.get_albums()
        return albums
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

@app.get("/api/albums/{album_id}")
async def get_album(album_id: str):
    try:
        album = await ic.get_album_detail(album_id)
        return album
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

# ─── PHOTO PROXY ─────────────────────────────────────────────────────────────

@app.get("/api/thumb/{asset_id}")
async def get_thumbnail(asset_id: str, size: str = "thumbnail"):
    cache_key = CACHE_DIR / f"{asset_id}_{size}.jpg"
    if cache_key.exists():
        return Response(cache_key.read_bytes(), media_type="image/jpeg")
    try:
        data = await ic.get_asset_thumbnail(asset_id, size)
        cache_key.write_bytes(data)
        return Response(data, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(502, f"Thumb error: {e}")

@app.get("/api/mapcache/{key}")
async def get_map_cache(key: str):
    """Serve a pre-generated map PNG from the cache."""
    cache_path = CACHE_DIR / f"{key}.png"
    if not cache_path.exists():
        raise HTTPException(404, "Map not found")
    return Response(cache_path.read_bytes(), media_type="image/png")

# ─── CAPTION → IMMICH DESCRIPTION ────────────────────────────────────────────

class CaptionSyncRequest(BaseModel):
    asset_id: str
    description: str

@app.post("/api/assets/{asset_id}/description")
async def sync_caption_description(asset_id: str, body: CaptionSyncRequest):
    """Sync a caption text back to the asset description in Immich."""
    ok = await ic.update_asset_description(asset_id, body.description)
    if not ok:
        raise HTTPException(500, "Failed to update description in Immich")
    return {"ok": True}

# ─── NEW UNIFIED LAYOUT GENERATOR ────────────────────────────────────────────

from album_generator import generate_album, DEFAULT_CONFIG
import tempfile, os as _os

# In-memory store for last generation log (keyed by session, simplified to one global)
_last_log: dict[str, str] = {}

class GenerateRequest(BaseModel):
    album_id: str
    profile_id: str
    config: dict = {}

@app.post("/api/layout/generate")
async def generate_layout_new(req: GenerateRequest, _rl: None = Depends(rl_generate)):
    """
    Unified layout generator — replaces /api/layout and /api/layout/smart.
    Uses the profile's page_types and the config options passed by the client.
    """
    try:
        album = await ic.get_album_detail(req.album_id)
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

    path = PROFILES_DIR / f"{req.profile_id}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    profile = json.loads(path.read_text())
    profile["id"] = req.profile_id

    assets = sorted(
        [a for a in album.get("assets", []) if a.get("type","IMAGE").upper() != "VIDEO"],
        key=lambda a: a.get("localDateTime", "")
    )

    cfg = req.config or {}

    # Enrich assets with people/faces + checksum + isFavorite when needed.
    # The album endpoint may return isFavorite unreliably — fetch from individual asset API
    # when favorites_full_page is on to guarantee accuracy.
    needs_faces = cfg.get("face_crop", True)
    needs_dedup = cfg.get("remove_duplicates", False)
    needs_favs  = cfg.get("favorites_full_page", False)
    if needs_faces or needs_dedup or needs_favs:
        enrich_fields = []
        if needs_faces:
            enrich_fields.extend(["people", "faces"])
        if needs_dedup:
            enrich_fields.extend(["checksum", "thumbhash"])
        if needs_favs:
            enrich_fields.append("isFavorite")
        assets = await ic.enrich_assets(assets, fields=enrich_fields)

    # Compute perceptual dHash from cached thumbnails for visual dedup.
    # Thumbnails (60KB) are fetched in bulk if not already cached.
    if needs_dedup:
        missing_ids = [a["id"] for a in assets
                       if not (CACHE_DIR / f"{a['id']}_thumbnail.jpg").exists()]
        if missing_ids:
            fetched = await ic.fetch_assets_bulk(missing_ids, hires=False, max_concurrent=8)
            for aid, data in fetched.items():
                try:
                    (CACHE_DIR / f"{aid}_thumbnail.jpg").write_bytes(data)
                except Exception:
                    pass
        for asset in assets:
            cache_path = CACHE_DIR / f"{asset['id']}_thumbnail.jpg"
            if cache_path.exists():
                try:
                    asset["_dhash"] = _compute_dhash(cache_path.read_bytes())
                except Exception:
                    pass

    pages, transforms, log_text, page_logs, excluded_photos = generate_album(assets, profile, cfg)
    locations = extract_gps_locations(assets)

    # Post-process map items: generate PNG, save to cache, replace locations with map_key
    if cfg.get("fill_empty_with_map"):
        import hashlib as _hl
        _map_style = profile.get("map_style") or {}
        # Build page_num → slot_idx → slot_log lookup for back-filling map_key
        plog_index: dict[int, dict[int, dict]] = {}
        for pl in page_logs:
            plog_index[pl["page_num"]] = {s["slot_idx"]: s for s in pl.get("slots", [])}
        for pi, page in enumerate(pages):
            page_num = pi + 1
            for si, it in enumerate(page.get("items", [])):
                item = it.get("item")
                if item and item.get("type") == "map":
                    locs = item.pop("locations", [])
                    if locs:
                        # Include map_style in cache key so style changes invalidate cache
                        key = "map_" + _hl.md5(
                            json.dumps({"locs": locs, "style": _map_style}, sort_keys=True).encode()
                        ).hexdigest()[:12]
                        cache_path = CACHE_DIR / f"{key}.png"
                        if not cache_path.exists():
                            img_bytes = generate_map_image(locs, 800, 500, map_style=_map_style)
                            if img_bytes:
                                cache_path.write_bytes(img_bytes)
                        item["map_key"] = key
                        # Propagate map_key to the corresponding slot_log
                        sl = plog_index.get(page_num, {}).get(si)
                        if sl:
                            sl["map_key"] = key

    # Store log for download
    _last_log["latest"] = log_text

    return {
        "album": {
            "id":          album["id"],
            "albumName":   album.get("albumName", ""),
            "description": album.get("description", ""),
            "assetCount":  len(assets),
        },
        "profile":          profile,
        "pages":            pages,
        "locations":        locations,
        "photo_transforms": transforms,
        "page_logs":        page_logs,
        "excluded_photos":  excluded_photos,
    }

@app.get("/api/layout/generate/log")
async def download_generation_log():
    """Download the log from the last album generation."""
    log = _last_log.get("latest", "Nessun log disponibile. Genera un album prima.")
    return Response(
        content=log.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="album_generation_log.txt"'},
    )

# ─── LAYOUT GENERATION ───────────────────────────────────────────────────────

class LayoutRequest(BaseModel):
    album_id: str
    profile_id: str

@app.post("/api/layout")
async def generate_layout_endpoint(req: LayoutRequest):
    # Load album
    try:
        album = await ic.get_album_detail(req.album_id)
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

    # Load profile
    path = PROFILES_DIR / f"{req.profile_id}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    profile = json.loads(path.read_text())
    profile["id"] = req.profile_id

    assets = sorted(
        album.get("assets", []),
        key=lambda a: a.get("localDateTime", "")
    )

    flow = build_flow(assets)
    pages = generate_layout(flow, profile)
    locations = extract_gps_locations(assets)

    return {
        "album": {
            "id": album["id"],
            "albumName": album.get("albumName", ""),
            "description": album.get("description", ""),
            "assetCount": len(assets),
        },
        "profile": profile,
        "pages": pages,
        "locations": locations,
    }


class RecalcRequest(BaseModel):
    photo_items: list[dict]   # photo items in desired order (no captions, no nulls)
    profile_id: str

@app.post("/api/layout/recalculate")
async def recalculate_layout(req: RecalcRequest):
    """Re-pack a custom-ordered list of photos into pages using the given profile."""
    path = PROFILES_DIR / f"{req.profile_id}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    profile = json.loads(path.read_text())
    profile["id"] = req.profile_id

    flow = rebuild_flow_from_photos(req.photo_items)
    pages = generate_layout(flow, profile)
    return {"pages": pages}


@app.get("/api/smart-config")
async def get_smart_config():
    cfg = _load_smart_config()
    return {**SMART_DEFAULTS, **cfg}

class SmartConfigModel(BaseModel):
    event_gap_min:        float = 60
    event_clustering:     bool  = True
    min_quality:          float = 0.05
    similarity_threshold: float = 0.97
    max_per_page:         int   = 6
    remove_duplicates:    bool  = True
    quality_filter:       bool  = True
    rhythm_alternation:   bool  = True
    favorite_full_page:   bool  = True
    face_aware_crop:      bool  = True

@app.put("/api/smart-config")
async def save_smart_config(cfg: SmartConfigModel):
    data = cfg.dict()
    SMART_CONFIG_PATH.write_text(json.dumps(data, indent=2))
    apply_config(data)
    return data

class SmartLayoutRequest(BaseModel):
    album_id:  str
    profile_id: str

@app.post("/api/layout/smart")
async def smart_layout_endpoint(req: SmartLayoutRequest):
    """Layout intelligente: analisi qualità, clustering, face-aware crop, preferiti."""
    try:
        album = await ic.get_album_detail(req.album_id)
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

    path = PROFILES_DIR / f"{req.profile_id}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    profile = json.loads(path.read_text())
    profile["id"] = req.profile_id

    assets = sorted(album.get("assets", []), key=lambda a: a.get("localDateTime", ""))

    photo_cache: dict[str, bytes] = {}

    async def fetch_thumb(asset_id: str):
        try:
            data = await ic.get_asset_thumbnail(asset_id, "thumbnail")
            photo_cache[asset_id] = data
        except Exception:
            pass

    await asyncio.gather(*[fetch_thumb(a["id"]) for a in assets])

    pages, suggested_transforms = smart_generate_layout(assets, photo_cache)
    locations = smart_extract_gps(assets)

    return {
        "album": {
            "id": album["id"],
            "albumName": album.get("albumName", ""),
            "description": album.get("description", ""),
            "assetCount": len(assets),
        },
        "profile": profile,
        "pages": pages,
        "locations": locations,
        "photo_transforms": suggested_transforms,  # crop centrati sui volti
        "engine": "smart",
    }

# ─── MAP ─────────────────────────────────────────────────────────────────────

class MapRequest(BaseModel):
    locations: list[dict]
    map_style: dict = {}

@app.post("/api/map")
async def get_map(req: MapRequest):
    img_bytes = generate_map_image(req.locations, 800, 400, map_style=req.map_style or {})
    if img_bytes:
        return Response(img_bytes, media_type="image/png")
    raise HTTPException(404, "No locations")

_TORINO_TEST = [
    {"lat": 45.0703, "lon": 7.6869, "name": "Torino"},
    {"lat": 45.0752, "lon": 7.6750, "name": "Porta Susa"},
    {"lat": 45.0637, "lon": 7.6919, "name": "Gran Madre"},
    {"lat": 45.0781, "lon": 7.6825, "name": "Lingotto"},
    {"lat": 45.0710, "lon": 7.7024, "name": "Sassi"},
]

class MapPreviewRequest(BaseModel):
    map_style: dict = {}

@app.post("/api/map-preview")
async def map_preview_endpoint(req: MapPreviewRequest):
    img_bytes = generate_map_image(_TORINO_TEST, 400, 400, map_style=req.map_style)
    if not img_bytes:
        raise HTTPException(404, "Generation failed")
    return Response(img_bytes, media_type="image/png")

# ─── PDF + SVG EXPORT ────────────────────────────────────────────────────────

class ExportRequest(BaseModel):
    album_id: str
    profile_id: str
    pages: list[dict]
    locations: list[dict] = []
    photo_transforms: dict = {}
    format: str = "pdf"           # "pdf" | "svg"
    quality: str = "hires"        # "hires" | "preview"

# ── Export progress tracking (in-memory, single-session) ─────────────────────
_export_progress: dict[str, Any] = {"pct": 0, "step": "", "done": False, "error": ""}

@app.get("/api/export/progress")
async def export_progress():
    return _export_progress

def _set_progress(pct: int, step: str):
    _export_progress.update({"pct": pct, "step": step, "done": False, "error": ""})

# Max foto hi-res in RAM contemporaneamente (evita OOM)
# 200 foto × ~4MB preview JPEG ≈ 800MB — limite ragionevole per un server entry-level
_MAX_HIRES_PHOTOS = 300

async def _fetch_photos(asset_ids: set, hires: bool = False) -> dict:
    """
    Fetch photos for export using a shared HTTP client with connection pooling.
    Limits concurrency via semaphore to avoid OOM and Immich overload.
    """
    ids   = list(asset_ids)
    total = len(ids)
    mode  = "preview hi-res" if hires else "thumbnail"
    logger.info(f"Fetching {total} photos [{mode}]")

    if hires and total > _MAX_HIRES_PHOTOS:
        raise ValueError(
            f"Troppo foto hi-res ({total} > {_MAX_HIRES_PHOTOS}). "
            f"Usa la modalità 'Anteprima' oppure dividi l'album in parti più piccole."
        )

    def on_progress(done: int, tot: int):
        pct = 10 + int(done / tot * 60)   # 10% → 70%
        _set_progress(pct, f"Scaricamento foto {done}/{tot}")

    photo_cache = await ic.fetch_assets_bulk(
        ids,
        hires=hires,
        on_progress=on_progress,
        max_concurrent=3 if hires else 8,
    )
    logger.info(f"Fetch done: {len(photo_cache)}/{total}")
    return photo_cache

@app.post("/api/export")
async def export_book(req: ExportRequest, _rl: None = Depends(rl_export)):
    _export_progress.update({"pct": 0, "step": "Avvio…", "done": False, "error": ""})
    try:
        _set_progress(2, "Caricamento album da Immich…")
        try:
            album = await ic.get_album_detail(req.album_id)
        except Exception as e:
            raise HTTPException(502, f"Immich error: {e}")

        path = PROFILES_DIR / f"{req.profile_id}.json"
        if not path.exists():
            raise HTTPException(404, "Profile not found")
        profile = json.loads(path.read_text())

        # Collect asset IDs from all pages
        asset_ids = set()
        for page in req.pages:
            for item_data in page.get("items", []):
                item = item_data.get("item")
                if item and item.get("type") == "photo":
                    asset_ids.add(item["asset_id"])

        _set_progress(8, f"Download {len(asset_ids)} foto…")
        hires = (req.quality != "preview")
        photo_cache = await _fetch_photos(asset_ids, hires=hires)

        _set_progress(72, "Generazione mappa GPS…")
        map_image = None
        if req.locations:
            map_image = generate_map_image(req.locations, 800, 400, map_style=profile.get("map_style"))

        album_info = {
            "albumName":   album.get("albumName", ""),
            "description": album.get("description", ""),
            "assets":      album.get("assets", []),
        }
        album_slug = (album.get("albumName") or "fotolibro").replace(" ", "_")

        if req.format == "svg":
            _set_progress(75, "Composizione SVG…")
            try:
                zip_bytes = generate_svg_zip(
                    album=album_info, pages=req.pages, profile=profile,
                    photo_cache=photo_cache, pan_offsets=req.photo_transforms,
                    map_image=map_image,
                )
            except Exception as e:
                logger.exception("SVG export failed")
                _export_progress.update({"pct": 0, "done": True, "error": str(e)})
                raise HTTPException(500, f"SVG error: {e}")
            _export_progress.update({"pct": 100, "step": "Completato", "done": True, "error": ""})
            return Response(
                zip_bytes, media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{album_slug}_svg.zip"'}
            )

        # PDF — run in thread executor so async loop stays responsive
        # Progress callback: called from worker thread, so use thread-safe update
        n_pages = len(req.pages)
        pdf_timeout = max(300, n_pages * 8)   # at least 8s per page, min 5min

        def _pdf_progress(page_idx: int, total_pages: int):
            pct = 75 + int(page_idx / max(total_pages, 1) * 22)  # 75% → 97%
            _set_progress(pct, f"Composizione PDF pagina {page_idx}/{total_pages}…")

        _set_progress(75, f"Composizione PDF ({n_pages} pagine)…")
        try:
            import gc
            pdf_bytes = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: generate_pdf(
                        album=album_info, pages=req.pages, profile=profile,
                        photo_cache=photo_cache, map_image=map_image,
                        on_page_progress=_pdf_progress,
                        pan_offsets=req.photo_transforms,
                    )
                ),
                timeout=pdf_timeout,
            )
            # Free photo cache memory immediately after PDF is built
            photo_cache.clear()
            gc.collect()
        except asyncio.TimeoutError:
            logger.error(f"PDF timeout after {pdf_timeout}s for {n_pages} pages")
            _export_progress.update({"pct": 0, "done": True,
                "error": f"Timeout ({pdf_timeout}s) — album troppo grande, prova con meno foto o qualità 'Anteprima'"})
            raise HTTPException(500, "PDF generation timed out")
        except ValueError as e:
            _export_progress.update({"pct": 0, "done": True, "error": str(e)})
            raise HTTPException(400, str(e))
        except Exception as e:
            logger.exception("PDF generation failed")
            _export_progress.update({"pct": 0, "done": True, "error": str(e)})
            raise HTTPException(500, f"PDF error: {e}")

        _export_progress.update({"pct": 100, "step": "Completato", "done": True, "error": ""})
        return Response(
            pdf_bytes, media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{album_slug}.pdf"'}
        )

    except HTTPException:
        raise
    except Exception as e:
        _export_progress.update({"pct": 0, "done": True, "error": str(e)})
        raise

@app.get("/api/page-sizes")
async def page_sizes():
    return [{"key": k, "w": v[0], "h": v[1]} for k, v in PAGE_SIZES_MM.items()]

# ─── HEALTHCHECK ─────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.8.0"}

# ─── PROJECTS (save / load / list / delete) ──────────────────────────────────

from datetime import datetime

class ProjectSave(BaseModel):
    name: str
    album: dict
    profile: dict
    pages: list[dict]
    locations: list[dict] = []
    photo_transforms: dict = {}   # pan/zoom state keyed by "pageIdx_slotIdx"
    current_page: int = 0

@app.get("/api/projects")
async def list_projects():
    projects = []
    for f in sorted(PROJECTS_DIR.glob("*.json"), key=lambda p: -p.stat().st_mtime):
        try:
            data = json.loads(f.read_text())
            projects.append({
                "id": f.stem,
                "name": data.get("name", "Senza nome"),
                "album_name": data.get("album", {}).get("albumName", ""),
                "saved_at": data.get("saved_at", ""),
                "page_count": len(data.get("pages", [])),
                "profile_name": data.get("profile", {}).get("name", ""),
            })
        except Exception:
            pass
    return projects

@app.post("/api/projects")
async def save_project(project: ProjectSave):
    pid = str(uuid.uuid4())
    data = project.dict()
    data["saved_at"] = datetime.now().isoformat(timespec="seconds")
    (PROJECTS_DIR / f"{pid}.json").write_text(json.dumps(data, indent=2))
    return {"id": pid, "saved_at": data["saved_at"]}

@app.get("/api/projects/{pid}")
async def load_project(pid: str):
    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(404, "Project not found")
    data = json.loads(path.read_text())
    data["id"] = pid
    return data

@app.put("/api/projects/{pid}")
async def update_project(pid: str, project: ProjectSave):
    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(404, "Project not found")
    data = project.dict()
    # preserve original saved_at, add updated_at
    existing = json.loads(path.read_text())
    data["saved_at"] = existing.get("saved_at", datetime.now().isoformat(timespec="seconds"))
    data["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(data, indent=2))
    return {"id": pid, "updated_at": data["updated_at"]}

@app.delete("/api/projects/{pid}")
async def delete_project(pid: str):
    path = PROJECTS_DIR / f"{pid}.json"
    if path.exists():
        path.unlink()
    return {"ok": True}

# ─── SERVE FRONTEND ──────────────────────────────────────────────────────────

# Search multiple locations: Docker path, local dev paths
_frontend_candidates = [
    Path("/app/frontend/dist"),          # Docker
    Path(__file__).parent / "frontend" / "dist",  # same dir
    Path(__file__).parent.parent / "frontend" / "dist",  # dev: backend/../frontend/dist
]
frontend_dist = next((p for p in _frontend_candidates if p.exists()), None)

# ─── DEBUG: Immich raw asset data ─────────────────────────────────────────────
# Defined BEFORE the SPA catch-all so FastAPI matches these routes first.

@app.get("/api/debug/asset/{asset_id}")
async def debug_asset(asset_id: str):
    """Returns raw Immich data for a single asset — for debugging face/checksum fields."""
    from album_generator import _display_dims, _get_all_faces
    try:
        async with __import__('httpx').AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{ic.get_base_url()}/assets/{asset_id}",
                headers=ic.get_headers()
            )
            r.raise_for_status()
            data = r.json()

        exif = data.get("exifInfo") or {}
        phys_w = exif.get("exifImageWidth") or exif.get("imageWidth") or 0
        phys_h = exif.get("exifImageHeight") or exif.get("imageHeight") or 0
        orientation = exif.get("orientation")
        disp_w, disp_h = _display_dims(data)
        normalized_faces = _get_all_faces(data)

        raw_faces = []
        for person in (data.get("people") or []):
            for face in (person.get("faces") or []):
                raw_faces.append({
                    "person": person.get("name"),
                    "x1": face.get("boundingBoxX1"),
                    "y1": face.get("boundingBoxY1"),
                    "x2": face.get("boundingBoxX2"),
                    "y2": face.get("boundingBoxY2"),
                    "face_imageW": face.get("imageWidth"),
                    "face_imageH": face.get("imageHeight"),
                })
        if not raw_faces:
            for face in (data.get("faces") or []):
                raw_faces.append({
                    "person": None,
                    "x1": face.get("boundingBoxX1"),
                    "y1": face.get("boundingBoxY1"),
                    "x2": face.get("boundingBoxX2"),
                    "y2": face.get("boundingBoxY2"),
                    "face_imageW": face.get("imageWidth"),
                    "face_imageH": face.get("imageHeight"),
                })

        return {
            "id":               data.get("id"),
            "originalFileName": data.get("originalFileName"),
            "exif": {
                "physicalW":    phys_w,
                "physicalH":    phys_h,
                "orientation":  orientation,
                "displayW":     disp_w,
                "displayH":     disp_h,
            },
            "raw_faces":        raw_faces,
            "normalized_faces": normalized_faces,
        }
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

@app.get("/api/debug/album/{album_id}/sample")
async def debug_album_sample(album_id: str, n: int = 3):
    """Returns raw Immich data for the first N assets of an album — for debugging."""
    try:
        album = await ic.get_album_detail(album_id)
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

    assets = (album.get("assets") or [])[:n]
    results = []
    async with __import__('httpx').AsyncClient(timeout=30) as client:
        for a in assets:
            try:
                r = await client.get(
                    f"{ic.get_base_url()}/assets/{a['id']}",
                    headers=ic.get_headers()
                )
                data = r.json() if r.status_code == 200 else {}
                results.append({
                    "from_album": {k: a.get(k) for k in ["id","originalFileName","localDateTime","checksum","thumbhash","isFavorite","people","faces"]},
                    "from_asset_api": {
                        "id":       data.get("id"),
                        "people":   data.get("people"),
                        "faces":    data.get("faces"),
                    }
                })
            except Exception as e:
                results.append({"id": a.get("id"), "error": str(e)})
    return {"album_id": album_id, "n_total": len(album.get("assets",[])), "samples": results}

# ─── SPA / static files ───────────────────────────────────────────────────────

if frontend_dist:
    logger.info(f"Serving frontend from {frontend_dist}")
    _assets = frontend_dist / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")
    _public = frontend_dist / "public"
    if _public.exists():
        app.mount("/public", StaticFiles(directory=str(_public)), name="public")

    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        candidate = frontend_dist / full_path
        if candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(frontend_dist / "index.html"))
else:
    logger.warning("Frontend dist not found. Run 'npm run build' in frontend/")
    @app.get("/")
    async def root():
        return {"status": "API running", "message": "Frontend not built. Run: cd frontend && npm run build"}
