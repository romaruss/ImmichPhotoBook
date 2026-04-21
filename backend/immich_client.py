import httpx
import json
import os

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

async def test_connection():
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{get_base_url()}/server/ping", headers=get_headers())
            return r.status_code == 200
    except Exception:
        return False

async def get_albums():
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{get_base_url()}/albums", headers=get_headers())
        r.raise_for_status()
        return r.json()

async def get_album_detail(album_id: str):
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(
            f"{get_base_url()}/albums/{album_id}",
            headers=get_headers(),
            params={"withoutAssets": "false"}
        )
        r.raise_for_status()
        return r.json()

async def get_asset_thumbnail(asset_id: str, size: str = "thumbnail") -> bytes:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{get_base_url()}/assets/{asset_id}/thumbnail",
            headers={**get_headers(), "Accept": "image/jpeg"},
            params={"size": size}
        )
        r.raise_for_status()
        return r.content

async def get_asset_original(asset_id: str) -> tuple[bytes, str]:
    """
    Fetch the highest-quality version of an asset, preferring the edited/rotated version.

    Immich stores edits (rotation, crop, retouch) as a sidecar. The 'preview' size
    thumbnail always reflects edits. The 'original' endpoint may return the raw unedited
    file for photos edited inside Immich.

    Strategy:
      1. Try /assets/{id}/thumbnail?size=preview  — always reflects Immich edits, JPEG
      2. Fallback to /assets/{id}/original        — raw file (may be unedited)
    """
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        # Step 1: edited preview (reflects all Immich edits)
        try:
            r = await client.get(
                f"{get_base_url()}/assets/{asset_id}/thumbnail",
                headers={**get_headers(), "Accept": "image/jpeg"},
                params={"size": "preview"},
            )
            if r.status_code == 200:
                return r.content, "image/jpeg"
        except Exception:
            pass

        # Step 2: raw original file
        r = await client.get(
            f"{get_base_url()}/assets/{asset_id}/original",
            headers={**get_headers(), "Accept": "*/*"}
        )
        r.raise_for_status()
        ct = r.headers.get("content-type", "image/jpeg")
        return r.content, ct

async def update_asset_description(asset_id: str, description: str) -> bool:
    """Update the description field of an asset in Immich."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.put(
                f"{get_base_url()}/assets/{asset_id}",
                headers={**get_headers(), "Content-Type": "application/json"},
                json={"description": description}
            )
            return r.status_code in (200, 204)
    except Exception:
        return False

async def get_asset_detail(asset_id: str) -> dict:
    """Fetch full asset detail including people/faces and checksum."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{get_base_url()}/assets/{asset_id}",
            headers=get_headers()
        )
        r.raise_for_status()
        return r.json()

async def enrich_assets(assets: list[dict], fields: list[str] = None) -> list[dict]:
    """
    Fetches full asset details for a list of assets in parallel (batch of 20).
    Merges the extra fields (people, checksum, thumbhash, isFavorite) into each asset.
    Only fetches if the fields are not already present.
    
    fields: list of field names to check — if all present in first asset, skip enrichment.
    """
    import asyncio
    if not assets:
        return assets

    check_fields = fields or ["people", "checksum"]
    first = assets[0]
    # If the first asset already has these fields populated, no need to enrich
    if all(first.get(f) is not None for f in check_fields):
        return assets

    BATCH = 20
    enriched = list(assets)

    async def fetch_one(idx: int, asset: dict):
        try:
            detail = await get_asset_detail(asset["id"])
            # Merge fields that were missing
            for field in ["people", "faces", "checksum", "thumbhash", "isFavorite",
                          "localDateTime", "fileCreatedAt", "exifInfo"]:
                if detail.get(field) is not None:
                    enriched[idx] = {**enriched[idx], field: detail[field]}
        except Exception:
            pass  # Keep original data if fetch fails

    for start in range(0, len(assets), BATCH):
        batch = assets[start:start + BATCH]
        await asyncio.gather(*[fetch_one(start + i, a) for i, a in enumerate(batch)])

    return enriched
