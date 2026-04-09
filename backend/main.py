import json, os, uuid, asyncio, logging
from pathlib import Path
from typing import Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
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
CACHE_DIR    = DATA_DIR / "cache"
EXPORT_DIR   = DATA_DIR / "exports"
PROJECTS_DIR = DATA_DIR / "projects"
SMART_CONFIG_PATH = DATA_DIR / "smart_config.json"

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
)

# ─── CONFIG ──────────────────────────────────────────────────────────────────

class ConfigModel(BaseModel):
    immich_url: str
    api_key: str

@app.get("/api/config")
async def get_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {"immich_url": "", "api_key": ""}

@app.post("/api/config")
async def save_config(cfg: ConfigModel):
    CONFIG_PATH.write_text(json.dumps(cfg.dict(), indent=2))
    return {"ok": True}

@app.get("/api/config/test")
async def test_config():
    ok = await ic.test_connection()
    return {"connected": ok}

# ─── PROFILES ────────────────────────────────────────────────────────────────

class Profile(BaseModel):
    name: str
    page_size: str = "20x30"
    orientation: str = "portrait"
    duplex: bool = False
    margin_mm: float = 5.0
    bleed: bool = False
    bleed_mm: float = 3.0
    gap_mm: float = 3.0
    page_types: list[dict] = []

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

@app.post("/api/map")
async def get_map(req: MapRequest):
    img_bytes = generate_map_image(req.locations, 800, 400)
    if img_bytes:
        return Response(img_bytes, media_type="image/png")
    raise HTTPException(404, "No locations")

# ─── PDF + SVG EXPORT ────────────────────────────────────────────────────────

class ExportRequest(BaseModel):
    album_id: str
    profile_id: str
    pages: list[dict]
    locations: list[dict] = []
    photo_transforms: dict = {}   # pan/zoom per slot
    format: str = "pdf"           # "pdf" | "svg"

async def _fetch_photos(asset_ids: set) -> dict:
    photo_cache = {}
    async def fetch_one(aid):
        try:
            data = await ic.get_asset_thumbnail(aid, "preview")
            photo_cache[aid] = data
        except Exception:
            try:
                data = await ic.get_asset_thumbnail(aid, "thumbnail")
                photo_cache[aid] = data
            except Exception as e:
                logger.warning(f"Could not fetch {aid}: {e}")
    await asyncio.gather(*[fetch_one(aid) for aid in asset_ids])
    return photo_cache

@app.post("/api/export")
async def export_book(req: ExportRequest):
    try:
        album = await ic.get_album_detail(req.album_id)
    except Exception as e:
        raise HTTPException(502, f"Immich error: {e}")

    path = PROFILES_DIR / f"{req.profile_id}.json"
    if not path.exists():
        raise HTTPException(404, "Profile not found")
    profile = json.loads(path.read_text())

    # Collect asset IDs
    asset_ids = set()
    for page in req.pages:
        for item_data in page.get("items", []):
            item = item_data.get("item")
            if item and item.get("type") == "photo":
                asset_ids.add(item["asset_id"])

    photo_cache = await _fetch_photos(asset_ids)

    map_image = None
    if req.locations:
        map_image = generate_map_image(req.locations, 800, 400)

    album_info = {
        "albumName": album.get("albumName", ""),
        "description": album.get("description", ""),
        "assets": album.get("assets", []),
    }
    album_slug = (album.get("albumName") or "fotolibro").replace(" ", "_")

    if req.format == "svg":
        try:
            zip_bytes = generate_svg_zip(
                album=album_info,
                pages=req.pages,
                profile=profile,
                photo_cache=photo_cache,
                pan_offsets=req.photo_transforms,
                map_image=map_image,
            )
        except Exception as e:
            logger.exception("SVG export failed")
            raise HTTPException(500, f"SVG error: {e}")
        return Response(
            zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{album_slug}_svg.zip"'}
        )

    # Default: PDF
    try:
        pdf_bytes = generate_pdf(
            album=album_info,
            pages=req.pages,
            profile=profile,
            photo_cache=photo_cache,
            map_image=map_image,
        )
    except Exception as e:
        logger.exception("PDF generation failed")
        raise HTTPException(500, f"PDF error: {e}")

    return Response(
        pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{album_slug}.pdf"'}
    )

@app.get("/api/page-sizes")
async def page_sizes():
    return [{"key": k, "w": v[0], "h": v[1]} for k, v in PAGE_SIZES_MM.items()]

# ─── HEALTHCHECK ─────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

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

if frontend_dist:
    logger.info(f"Serving frontend from {frontend_dist}")
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    logger.warning("Frontend dist not found. Run 'npm run build' in frontend/")
    @app.get("/")
    async def root():
        return {"status": "API running", "message": "Frontend not built. Run: cd frontend && npm run build"}
