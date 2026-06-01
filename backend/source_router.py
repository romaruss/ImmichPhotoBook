"""
source_router.py — Transparent proxy to either immich_client or local_source.
main.py uses `import source_router as ic` — all ic.* calls are forwarded here.
Selection is made at call time based on config.json source_type field.
"""

import json
from pathlib import Path

_CONFIG_PATH = Path("/data/config.json")


def _get_source():
    try:
        if _CONFIG_PATH.exists():
            cfg = json.loads(_CONFIG_PATH.read_text())
            if cfg.get("source_type") == "local":
                import local_source
                return local_source
    except Exception:
        pass
    import immich_client
    return immich_client


def __getattr__(name: str):
    return getattr(_get_source(), name)
