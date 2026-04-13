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
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
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
