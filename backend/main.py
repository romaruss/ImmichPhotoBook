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
async def generate_layout_new(req: GenerateRequest):
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

    # Enrich assets with people/faces + checksum when needed
    # (album endpoint returns limited fields; full asset API has people, checksum, thumbhash)
    needs_faces = cfg.get("face_crop", True)
    needs_dedup = cfg.get("remove_duplicates", False)
    if needs_faces or needs_dedup:
        enrich_fields = []
        if needs_faces:
            enrich_fields.extend(["people", "faces"])
        if needs_dedup:
            enrich_fields.extend(["checksum", "thumbhash"])
        assets = await ic.enrich_assets(assets, fields=enrich_fields)

    pages, transforms, log_text = generate_album(assets, profile, cfg)
    locations = extract_gps_locations(assets)

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

async def _fetch_photos(asset_ids: set, hires: bool = False) -> dict:
    """
    Fetch photos for export.
    hires=True  → original file from Immich (print quality)
    hires=False → thumbnail JPEG (fast preview)
    Batched to avoid overwhelming Immich.
    """
    photo_cache: dict[str, bytes] = {}
    ids    = list(asset_ids)
    BATCH  = 5 if hires else 10
    total  = len(ids)

    async def fetch_one(aid: str):
        try:
            if hires:
                data, _ = await ic.get_asset_original(aid)
            else:
                data = await ic.get_asset_thumbnail(aid, "thumbnail")
            photo_cache[aid] = data
        except Exception:
            try:
                data = await ic.get_asset_thumbnail(aid, "preview")
                photo_cache[aid] = data
            except Exception:
                try:
                    data = await ic.get_asset_thumbnail(aid, "thumbnail")
                    photo_cache[aid] = data
                except Exception as e:
                    logger.warning(f"Could not fetch photo {aid}: {e}")

    mode = "originali (hi-res)" if hires else "thumbnail (anteprima)"
    logger.info(f"Fetching {total} photos [{mode}]")
    for i in range(0, total, BATCH):
        batch = ids[i:i + BATCH]
        await asyncio.gather(*[fetch_one(aid) for aid in batch])
        done_so_far = min(i + BATCH, total)
        pct = 10 + int(done_so_far / total * 60)   # 10% → 70%
        _set_progress(pct, f"Scaricamento foto {done_so_far}/{total}")
        logger.info(f"  Fetch: {done_so_far}/{total}")

    logger.info(f"Fetch done: {len(photo_cache)}/{total}")
    return photo_cache

@app.post("/api/export")
async def export_book(req: ExportRequest):
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
            map_image = generate_map_image(req.locations, 800, 400)

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

        # PDF
        _set_progress(75, "Composizione PDF…")
        try:
            pdf_bytes = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: generate_pdf(
                        album=album_info, pages=req.pages, profile=profile,
                        photo_cache=photo_cache, map_image=map_image,
                    )
                ),
                timeout=300,
            )
        except asyncio.TimeoutError:
            logger.error("PDF timeout")
            _export_progress.update({"pct": 0, "done": True, "error": "timeout"})
            raise HTTPException(500, "PDF generation timed out")
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
    """
    Fetch photos for export. hires=True fetches the original file (for PDF/SVG print quality).
    Falls back to 'preview' then 'thumbnail' on error.
    Batched in groups of 5 (originals are large).
    """
    photo_cache: dict[str, bytes] = {}
    ids = list(asset_ids)
    BATCH = 5 if hires else 10

    async def fetch_one(aid: str):
        try:
            if hires:
                data, _ = await ic.get_asset_original(aid)
            else:
                data = await ic.get_asset_thumbnail(aid, "thumbnail")
            photo_cache[aid] = data
        except Exception:
            try:
                data = await ic.get_asset_thumbnail(aid, "preview")
                photo_cache[aid] = data
            except Exception:
                try:
                    data = await ic.get_asset_thumbnail(aid, "thumbnail")
                    photo_cache[aid] = data
                except Exception as e:
                    logger.warning(f"Could not fetch photo {aid}: {e}")

    total = len(ids)
    mode  = "original (hi-res)" if hires else "thumbnail"
    logger.info(f"Fetching {total} photos for export [{mode}] — batches of {BATCH}")
    for i in range(0, total, BATCH):
        batch = ids[i:i + BATCH]
        await asyncio.gather(*[fetch_one(aid) for aid in batch])
        logger.info(f"  Photo fetch: {min(i+BATCH, total)}/{total}")

    logger.info(f"Fetch complete: {len(photo_cache)}/{total} retrieved")
    return photo_cache

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

# ─── DEBUG: Immich raw asset data ────────────────────────────────────────────

@app.get("/api/debug/asset/{asset_id}")
async def debug_asset(asset_id: str):
    """Returns raw Immich data for a single asset — for debugging face/checksum fields."""
    try:
        async with __import__('httpx').AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{ic.get_base_url()}/assets/{asset_id}",
                headers=ic.get_headers()
            )
            r.raise_for_status()
            data = r.json()
        # Return only the fields relevant to faces/dedup
        relevant = {
            "id":                data.get("id"),
            "originalFileName":  data.get("originalFileName"),
            "localDateTime":     data.get("localDateTime"),
            "checksum":          data.get("checksum"),
            "thumbhash":         data.get("thumbhash"),
            "isFavorite":        data.get("isFavorite"),
            "exifInfo_keys":     list((data.get("exifInfo") or {}).keys()),
            "people":            data.get("people"),
            "faces":             data.get("faces"),
            "hasMetadata":       "people" in data or "faces" in data,
            "_all_keys":         list(data.keys()),
        }
        return relevant
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
                        "id":               data.get("id"),
                        "checksum":         data.get("checksum"),
                        "thumbhash":        data.get("thumbhash"),
                        "isFavorite":       data.get("isFavorite"),
                        "people":           data.get("people"),
                        "faces":            data.get("faces"),
                        "_all_keys":        list(data.keys()),
                    }
                })
            except Exception as e:
                results.append({"id": a.get("id"), "error": str(e)})
    return {"album_id": album_id, "n_total": len(album.get("assets",[])), "samples": results}
