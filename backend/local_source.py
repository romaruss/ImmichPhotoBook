"""
local_source.py — Local folder photo source.
Implements the same async API surface as immich_client.py so that
source_router.py can proxy either module transparently.

Folder layout expected (configurable via local_photos_path in config.json):
    /data/local_photos/
        AlbumName/
            photo1.jpg
            photo2.jpg
        AnotherAlbum/
            ...

Supported extensions: jpg, jpeg, png, tiff, tif, heic, webp
"""

import asyncio
import hashlib
import io
import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path("/data/config.json")
_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".heic", ".webp"}

# ── Path resolution cache ─────────────────────────────────────────────────────
_path_cache: dict[str, str] = {}   # asset_id -> absolute path string
_cache_root: str = ""              # root used to build current cache


def _load_config() -> dict:
    if _CONFIG_PATH.exists():
        try:
            return json.loads(_CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}


def get_local_root() -> Path:
    p = _load_config().get("local_photos_path", "").strip()
    return Path(p) if p else Path("/data/local_photos")


def get_base_url() -> str:
    return ""


def get_headers() -> dict:
    return {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _asset_id(rel_path: str) -> str:
    return hashlib.md5(rel_path.encode()).hexdigest()


def _album_id(folder_name: str) -> str:
    return hashlib.md5(folder_name.encode()).hexdigest()


def _ensure_cache() -> None:
    global _cache_root
    root = get_local_root()
    root_str = str(root)
    if _cache_root == root_str:
        return
    _path_cache.clear()
    _cache_root = root_str
    if not root.exists():
        return
    for f in root.rglob("*"):
        if f.is_file() and f.suffix.lower() in _EXTS:
            rel = str(f.relative_to(root))
            _path_cache[_asset_id(rel)] = str(f)


def _resolve_path(asset_id: str) -> str | None:
    _ensure_cache()
    return _path_cache.get(asset_id)


def _gps_to_decimal(dms, ref) -> float | None:
    if not dms or not ref:
        return None
    try:
        d = float(dms[0])
        m = float(dms[1])
        s = float(dms[2])
        dec = d + m / 60 + s / 3600
        if ref in ("S", "W"):
            dec = -dec
        return dec
    except Exception:
        return None


def _extract_exif(path: Path) -> dict:
    result: dict = {
        "dateTimeOriginal": None,
        "latitude": None,
        "longitude": None,
        "city": None,
        "state": None,
        "country": None,
        "description": "",
        "exifImageWidth": None,
        "exifImageHeight": None,
    }
    try:
        from PIL import Image, ExifTags
        with Image.open(path) as img:
            result["exifImageWidth"], result["exifImageHeight"] = img.size
            raw = img._getexif()  # type: ignore[attr-defined]
            if not raw:
                return result
            tags = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}

            dt_str = tags.get("DateTimeOriginal") or tags.get("DateTime")
            if dt_str:
                try:
                    result["dateTimeOriginal"] = (
                        str(dt_str)[:10].replace(":", "-") + "T" + str(dt_str)[11:19]
                    )
                except Exception:
                    pass

            gps_raw = tags.get("GPSInfo")
            if gps_raw:
                gps = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_raw.items()}
                result["latitude"]  = _gps_to_decimal(gps.get("GPSLatitude"),  gps.get("GPSLatitudeRef"))
                result["longitude"] = _gps_to_decimal(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))

            desc = tags.get("ImageDescription") or tags.get("UserComment") or ""
            if isinstance(desc, bytes):
                desc = desc.decode("utf-8", errors="ignore").strip("\x00").strip()
            result["description"] = str(desc).strip() if desc else ""
    except Exception as e:
        logger.debug(f"EXIF extraction failed for {path}: {e}")
    return result


def _make_thumbnail(path: Path, max_size: int = 320) -> bytes:
    from PIL import Image
    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85, optimize=True)
        return buf.getvalue()


def _load_folder_assets(root: Path, folder: Path) -> list[dict]:
    assets = []
    for f in sorted(folder.iterdir()):
        if not f.is_file() or f.suffix.lower() not in _EXTS:
            continue
        rel = str(f.relative_to(root))
        aid = _asset_id(rel)
        _path_cache[aid] = str(f)   # populate cache while we're scanning
        exif = _extract_exif(f)

        dt_iso = exif["dateTimeOriginal"]
        if not dt_iso:
            try:
                dt_iso = datetime.fromtimestamp(f.stat().st_mtime).isoformat()[:19]
            except Exception:
                dt_iso = "1970-01-01T00:00:00"

        assets.append({
            "id":               aid,
            "type":             "IMAGE",
            "originalFileName": f.name,
            "localDateTime":    dt_iso,
            "fileCreatedAt":    dt_iso,
            "isFavorite":       False,
            "exifInfo":         exif,
            "people":           [],
            "_local_path":      str(f),
        })
    return sorted(assets, key=lambda a: a["localDateTime"])


# ── Public API (mirrors immich_client.py) ─────────────────────────────────────

async def test_connection() -> bool:
    root = get_local_root()
    return root.exists() and root.is_dir()


async def get_albums() -> list:
    root = get_local_root()
    if not root.exists():
        return []
    result = []
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        photos = [f for f in d.iterdir() if f.is_file() and f.suffix.lower() in _EXTS]
        if not photos:
            continue
        result.append({
            "id":          _album_id(d.name),
            "albumName":   d.name,
            "description": "",
            "assetCount":  len(photos),
            "assets":      [],
        })
    return result


async def get_album_detail(album_id: str) -> dict:
    root = get_local_root()
    if root.exists():
        for d in root.iterdir():
            if d.is_dir() and _album_id(d.name) == album_id:
                assets = _load_folder_assets(root, d)
                return {
                    "id":          album_id,
                    "albumName":   d.name,
                    "description": "",
                    "assetCount":  len(assets),
                    "assets":      assets,
                }
    raise Exception(f"Local album not found: {album_id}")


async def get_asset_thumbnail(asset_id: str, size: str = "thumbnail") -> bytes:
    path = _resolve_path(asset_id)
    if not path:
        raise Exception(f"Local asset not found: {asset_id}")
    max_size = 320 if size == "thumbnail" else 1024
    return _make_thumbnail(Path(path), max_size)


async def get_asset_original(asset_id: str, client=None) -> tuple[bytes, str]:
    path = _resolve_path(asset_id)
    if not path:
        raise Exception(f"Local asset not found: {asset_id}")
    p = Path(path)
    data = p.read_bytes()
    ct_map = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png",
        "tiff": "image/tiff", "tif": "image/tiff",
        "webp": "image/webp",
    }
    ct = ct_map.get(p.suffix.lower().lstrip("."), "image/jpeg")
    return data, ct


async def get_asset_detail(asset_id: str) -> dict:
    path = _resolve_path(asset_id)
    if not path:
        raise Exception(f"Local asset not found: {asset_id}")
    p = Path(path)
    exif = _extract_exif(p)
    dt_iso = exif["dateTimeOriginal"] or "1970-01-01T00:00:00"
    return {
        "id":               asset_id,
        "type":             "IMAGE",
        "originalFileName": p.name,
        "localDateTime":    dt_iso,
        "fileCreatedAt":    dt_iso,
        "isFavorite":       False,
        "exifInfo":         exif,
        "people":           [],
    }


async def update_asset_description(asset_id: str, description: str) -> bool:
    return True


async def fetch_assets_bulk(
    asset_ids: list[str],
    hires: bool = False,
    on_progress=None,
    max_concurrent: int = 4,
) -> dict[str, bytes]:
    results: dict[str, bytes] = {}
    total = len(asset_ids)
    done = 0
    sem = asyncio.Semaphore(max_concurrent)

    async def _one(aid: str) -> None:
        nonlocal done
        async with sem:
            try:
                if hires:
                    data, _ = await get_asset_original(aid)
                else:
                    data = await get_asset_thumbnail(aid, "thumbnail")
                if data:
                    results[aid] = data
            except Exception as e:
                logger.debug(f"local_source: skip {aid}: {e}")
            done += 1
            if on_progress:
                on_progress(done, total)

    await asyncio.gather(*[_one(aid) for aid in asset_ids])
    return results


async def enrich_assets(assets: list[dict], fields: list[str] = None) -> list[dict]:
    return assets
