"""
immich_client.py — Async HTTP client for Immich.
Uses a shared httpx.AsyncClient with connection pooling for the duration of each
fetch session, instead of creating a new client per request.
"""
import asyncio
import httpx
import json
import logging
import os

logger = logging.getLogger(__name__)

CONFIG_PATH = "/data/config.json"

def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {"immich_url": "", "api_key": ""}

def get_headers():
    cfg = load_config()
    return {"x-api-key": cfg.get("api_key", ""), "Accept": "application/json"}

def get_base_url():
    cfg = load_config()
    url = cfg.get("immich_url", "").rstrip("/")
    return f"{url}/api"

def _make_client(read_timeout: float = 60.0) -> httpx.AsyncClient:
    """Create a reusable async client with connection pooling and sane timeouts."""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=10.0,
            read=read_timeout,
            write=10.0,
            pool=5.0,
        ),
        limits=httpx.Limits(
            max_connections=20,
            max_keepalive_connections=10,
            keepalive_expiry=30.0,
        ),
        follow_redirects=True,
    )

async def test_connection() -> bool:
    try:
        async with _make_client(10.0) as client:
            r = await client.get(f"{get_base_url()}/server/ping", headers=get_headers())
            return r.status_code == 200
    except Exception:
        return False

async def get_albums() -> list:
    async with _make_client(30.0) as client:
        r = await client.get(f"{get_base_url()}/albums", headers=get_headers())
        r.raise_for_status()
        return r.json()

async def get_album_detail(album_id: str) -> dict:
    async with _make_client(60.0) as client:
        r = await client.get(
            f"{get_base_url()}/albums/{album_id}",
            headers=get_headers(),
            params={"withoutAssets": "false"},
        )
        r.raise_for_status()
        return r.json()

async def get_asset_thumbnail(asset_id: str, size: str = "thumbnail") -> bytes:
    async with _make_client(30.0) as client:
        r = await client.get(
            f"{get_base_url()}/assets/{asset_id}/thumbnail",
            headers={**get_headers(), "Accept": "image/jpeg"},
            params={"size": size, "edited": "true"},
        )
        r.raise_for_status()
        return r.content

async def get_asset_original(
    asset_id: str,
    client: httpx.AsyncClient | None = None,
) -> tuple[bytes, str]:
    """
    Fetch the highest-quality version of an asset.
    Strategy:
      1. /thumbnail?size=preview  (always reflects Immich edits, JPEG, ~2-5 MB)
      2. /assets/{id}/original    (raw file, may be RAW/TIFF, up to 30+ MB)

    Accepts an optional shared client for connection reuse during bulk fetch.
    """
    _client = client or _make_client(180.0)
    close_after = client is None

    async def _do(c: httpx.AsyncClient) -> tuple[bytes, str]:
        try:
            r = await c.get(
                f"{get_base_url()}/assets/{asset_id}/thumbnail",
                headers={**get_headers(), "Accept": "image/jpeg"},
                params={"size": "preview", "edited": "true"},
            )
            if r.status_code == 200 and len(r.content) > 1000:
                return r.content, "image/jpeg"
        except Exception as e:
            logger.debug(f"Preview fetch failed for {asset_id}: {e}")

        r = await c.get(
            f"{get_base_url()}/assets/{asset_id}/original",
            headers={**get_headers(), "Accept": "*/*"},
        )
        r.raise_for_status()
        return r.content, r.headers.get("content-type", "image/jpeg")

    if close_after:
        async with _make_client(180.0) as c:
            return await _do(c)
    return await _do(_client)

async def update_asset_description(asset_id: str, description: str) -> bool:
    try:
        async with _make_client(30.0) as client:
            r = await client.put(
                f"{get_base_url()}/assets/{asset_id}",
                headers={**get_headers(), "Content-Type": "application/json"},
                json={"description": description},
            )
            return r.status_code in (200, 204)
    except Exception:
        return False

async def get_asset_detail(asset_id: str) -> dict:
    async with _make_client(15.0) as client:
        r = await client.get(
            f"{get_base_url()}/assets/{asset_id}",
            headers=get_headers(),
        )
        r.raise_for_status()
        return r.json()

async def fetch_assets_bulk(
    asset_ids: list[str],
    hires: bool = False,
    on_progress: "callable | None" = None,
    max_concurrent: int = 4,
) -> dict[str, bytes]:
    """
    Fetch multiple assets efficiently using a single shared client and a semaphore
    to limit concurrency (avoid OOM and Immich overload).

    Args:
        asset_ids:      list of Immich asset UUIDs
        hires:          True = preview JPEG (~2-5MB), False = thumbnail (~60KB)
        on_progress:    callback(done: int, total: int) called after each fetch
        max_concurrent: max simultaneous requests (default 4 for hires, 8 for thumbs)

    Returns:
        dict mapping asset_id → bytes (missing assets are omitted, not None)
    """
    results: dict[str, bytes] = {}
    total = len(asset_ids)
    done_count = 0
    sem = asyncio.Semaphore(max_concurrent if hires else 8)

    # Use a single long-lived client for ALL fetches → connection pooling
    read_timeout = 180.0 if hires else 30.0
    async with _make_client(read_timeout) as client:

        async def fetch_one(aid: str):
            nonlocal done_count
            async with sem:
                for attempt in range(3):  # up to 3 attempts
                    try:
                        if hires:
                            data, _ = await get_asset_original(aid, client=client)
                        else:
                            data = await get_asset_thumbnail(aid, "thumbnail")
                        if data:
                            results[aid] = data
                        break
                    except (httpx.TimeoutException, httpx.NetworkError) as e:
                        if attempt == 2:
                            # Last attempt: try thumbnail fallback
                            try:
                                data = await client.get(
                                    f"{get_base_url()}/assets/{aid}/thumbnail",
                                    headers={**get_headers(), "Accept": "image/jpeg"},
                                    params={"size": "thumbnail", "edited": "true"},
                                )
                                if data.status_code == 200:
                                    results[aid] = data.content
                                    logger.warning(f"Used thumbnail fallback for {aid}")
                            except Exception:
                                logger.warning(f"Skipping {aid} after 3 failures: {e}")
                        else:
                            wait = 2 ** attempt   # 1s, 2s backoff
                            logger.debug(f"Retry {attempt+1} for {aid} after {wait}s")
                            await asyncio.sleep(wait)
                    except Exception as e:
                        logger.warning(f"Could not fetch {aid}: {e}")
                        break
                done_count += 1
                if on_progress:
                    on_progress(done_count, total)

        await asyncio.gather(*[fetch_one(aid) for aid in asset_ids])

    logger.info(f"Bulk fetch complete: {len(results)}/{total} assets fetched")
    return results

async def enrich_assets(assets: list[dict], fields: list[str] = None) -> list[dict]:
    """
    Fetch full asset details for enrichment (people, checksum, etc.)
    Uses a shared client with batches of 20.
    """
    if not assets:
        return assets

    # Use only fields that are exclusive to the individual asset API as early-exit indicators.
    # Fields like isFavorite are already present in album endpoint responses (always not-None),
    # so they cannot confirm that per-asset enrichment has been done.
    _ALBUM_ENDPOINT_FIELDS = frozenset({"isFavorite", "localDateTime", "fileCreatedAt", "originalFileName"})
    requested = fields or ["people", "checksum"]
    indicator_fields = [f for f in requested if f not in _ALBUM_ENDPOINT_FIELDS]
    check_fields = indicator_fields if indicator_fields else requested
    first = assets[0]
    if all(first.get(f) is not None for f in check_fields):
        return assets

    BATCH = 20
    enriched = list(assets)

    async with _make_client(15.0) as client:
        async def fetch_one(idx: int, asset: dict):
            try:
                r = await client.get(
                    f"{get_base_url()}/assets/{asset['id']}",
                    headers=get_headers(),
                )
                r.raise_for_status()
                detail = r.json()
                for field in ["people", "faces", "checksum", "thumbhash", "isFavorite",
                              "localDateTime", "fileCreatedAt", "exifInfo"]:
                    if detail.get(field) is not None:
                        enriched[idx] = {**enriched[idx], field: detail[field]}
            except Exception:
                pass

        for start in range(0, len(assets), BATCH):
            batch = assets[start:start + BATCH]
            await asyncio.gather(*[fetch_one(start + i, a) for i, a in enumerate(batch)])

    return enriched
