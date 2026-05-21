"""
map_generator.py

Genera un'immagine mappa per le posizioni GPS delle foto.

Strategia:
  1. Prova tiles Stadia Maps via staticmap (solo sfondo, senza marcatori nativi)
  2. Overlay PIL: route + marcatori con forma/colore dal map_style
  3. Se tiles falliscono → renderer PIL minimalista completo
"""

import io
import json
import math
import logging
import os
from PIL import Image, ImageDraw
import PIL.Image
if not hasattr(PIL.Image, 'ANTIALIAS'):
    PIL.Image.ANTIALIAS = PIL.Image.LANCZOS

logger = logging.getLogger(__name__)

# Tile providers that don't require an API key
_FREE_TILE_URLS: dict[str, str] = {
    "osm":          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "carto_light":  "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    "carto_dark":   "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    "osm_bright":   "https://tile.openstreetmap.org/{z}/{x}/{y}.png",  # osm_bright → standard OSM
}

# Stadia Maps styles (require API key for reliable access)
_STADIA_STYLES: set[str] = {
    "alidade_smooth", "alidade_smooth_dark", "stamen_terrain",
    "stamen_toner", "outdoors",
}


def _get_stadia_key() -> str | None:
    """Read Stadia API key: env var → config file → docker secret."""
    key = os.getenv("STADIA_MAPS_API_KEY", "").strip()
    if key:
        return key
    try:
        data_dir = os.getenv("PHOTOBOOK_DATA_DIR", "/data")
        cfg_path = os.path.join(data_dir, "config.json")
        if os.path.exists(cfg_path):
            cfg = json.loads(open(cfg_path).read())
            k = (cfg.get("stadia_api_key") or "").strip()
            if k:
                return k
    except Exception:
        pass
    secret_path = "/run/secrets/stadia_api_key"
    if os.path.exists(secret_path):
        try:
            k = open(secret_path).read().strip()
            if k:
                return k
        except Exception:
            pass
    return None


def _hex_to_rgb(hex_str: str) -> tuple:
    h = (hex_str or '#888888').lstrip('#')
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return (136, 136, 136)


DEFAULT_MAP_STYLE = {
    "tile_style":    "alidade_smooth",
    "marker_color":  "#d4aa5a",
    "marker_size":   10,
    "marker_shape":  "circle",   # circle | square | diamond | pin
    "show_route":    True,
    "route_color":   "#b48a3a",
    "route_width":   2,
    "bg_color":      "#0d1117",
    "grid_color":    "#19202a",
    "label_color":   "#c8b994",
}

# Mercator helpers (mirrors staticmap internals, avoids private import)
def _lon_to_tx(lon: float, zoom: int) -> float:
    return ((lon + 180.0) / 360.0) * (2 ** zoom)

def _lat_to_ty(lat: float, zoom: int) -> float:
    lat_r = math.radians(lat)
    return (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * (2 ** zoom)


def _overlay_on_tile(
    tile_img: Image.Image,
    locations: list[dict],
    sm,          # StaticMap instance after render() — has .zoom, .x_center, .y_center, .tile_size
    style: dict,
) -> Image.Image:
    """Draw route + custom-shaped markers on top of a staticmap tile image."""
    s        = style
    DOT_IN   = _hex_to_rgb(s.get("marker_color", "#d4aa5a"))
    DOT_RING = DOT_IN + (80,)
    ROUTE_C  = _hex_to_rgb(s.get("route_color", "#b48a3a")) + (100,)
    m_shape  = s.get("marker_shape", "circle")
    m_size   = max(3, int(s.get("marker_size", 10)))
    r_inner  = max(2, m_size // 2)
    r_outer  = r_inner + max(3, m_size // 2)
    show_rt  = bool(s.get("show_route", True))
    route_w  = max(1, int(s.get("route_width", 2)))

    w, h     = tile_img.size
    zoom     = sm.zoom
    cx       = sm.x_center
    cy       = sm.y_center
    ts       = sm.tile_size

    def to_px(lat, lon):
        tx = _lon_to_tx(lon, zoom)
        ty = _lat_to_ty(lat, zoom)
        return int((tx - cx) * ts + w / 2), int((ty - cy) * ts + h / 2)

    overlay = Image.new("RGBA", tile_img.size, (0, 0, 0, 0))
    draw    = ImageDraw.Draw(overlay, "RGBA")
    pts     = [to_px(loc["lat"], loc["lon"]) for loc in locations]

    # Route
    if show_rt and len(pts) > 1:
        for i in range(len(pts) - 1):
            draw.line([pts[i], pts[i + 1]], fill=ROUTE_C, width=route_w)

    # Markers
    def _marker(px, py):
        if m_shape == "square":
            draw.rectangle([(px-r_outer, py-r_outer), (px+r_outer, py+r_outer)], fill=DOT_RING)
            draw.rectangle([(px-r_inner, py-r_inner), (px+r_inner, py+r_inner)], fill=DOT_IN + (255,))
        elif m_shape == "diamond":
            draw.polygon([(px, py-r_outer), (px+r_outer, py), (px, py+r_outer), (px-r_outer, py)], fill=DOT_RING)
            draw.polygon([(px, py-r_inner), (px+r_inner, py), (px, py+r_inner), (px-r_inner, py)], fill=DOT_IN + (255,))
        elif m_shape == "pin":
            cy2 = py - r_inner
            draw.ellipse([(px-r_outer, cy2-r_outer), (px+r_outer, cy2+r_outer)], fill=DOT_RING)
            draw.polygon([(px-r_inner, cy2), (px+r_inner, cy2), (px, py+r_inner)], fill=DOT_RING)
            draw.ellipse([(px-r_inner, cy2-r_inner), (px+r_inner, cy2+r_inner)], fill=DOT_IN + (255,))
        else:  # circle
            draw.ellipse([(px-r_outer, py-r_outer), (px+r_outer, py+r_outer)], fill=DOT_RING)
            draw.ellipse([(px-r_inner, py-r_inner), (px+r_inner, py+r_inner)], fill=DOT_IN + (255,))

    for px, py in pts:
        _marker(px, py)

    result = Image.alpha_composite(tile_img.convert("RGBA"), overlay)
    return result.convert("RGB")


def generate_map_image(
    locations: list[dict],
    width: int = 800,
    height: int = 400,
    map_style: dict | None = None,
) -> bytes | None:
    if not locations:
        return None

    s = {**DEFAULT_MAP_STYLE, **(map_style or {})}

    tile_style   = s.get("tile_style", "alidade_smooth")
    marker_color = s.get("marker_color", "#d4aa5a")

    # Determine tile URL
    if tile_style == "minimal":
        return _draw_minimal_map(locations, width, height, s)
    elif tile_style in _STADIA_STYLES:
        api_key = _get_stadia_key()
        url = f"https://tiles.stadiamaps.com/tiles/{tile_style}/{{z}}/{{x}}/{{y}}.png"
        if api_key:
            url += f"?api_key={api_key}"
    elif tile_style in _FREE_TILE_URLS:
        url = _FREE_TILE_URLS[tile_style]
    else:
        url = f"https://tiles.stadiamaps.com/tiles/{tile_style}/{{z}}/{{x}}/{{y}}.png"
        api_key = _get_stadia_key()
        if api_key:
            url += f"?api_key={api_key}"

    try:
        from staticmap import StaticMap, CircleMarker

        m = StaticMap(width, height, url_template=url)
        # Add 1 px markers only for bounding-box / zoom computation — not drawn visibly
        for loc in locations:
            m.add_marker(CircleMarker((loc["lon"], loc["lat"]), marker_color, 1))

        tile_img = m.render()

        # Overlay route + custom-shaped markers on top of tile background
        final_img = _overlay_on_tile(tile_img, locations, m, s)

        buf = io.BytesIO()
        final_img.save(buf, format="PNG")
        data = buf.getvalue()

        if len(data) > 5000:
            return data

    except Exception as e:
        logger.info(f"OSM tiles unavailable ({e}), using PIL map")

    return _draw_minimal_map(locations, width, height, s)


def _draw_minimal_map(
    locations: list[dict],
    width: int,
    height: int,
    style: dict | None = None,
) -> bytes:
    s = {**DEFAULT_MAP_STYLE, **(style or {})}

    BG         = _hex_to_rgb(s["bg_color"])
    GRID       = _hex_to_rgb(s["grid_color"])
    DOT_IN     = _hex_to_rgb(s["marker_color"])
    LABEL      = _hex_to_rgb(s["label_color"])
    ROUTE_C    = _hex_to_rgb(s["route_color"])
    show_route = bool(s.get("show_route", True))
    route_w    = max(1, int(s.get("route_width", 2)))
    m_size     = max(3, int(s.get("marker_size", 10)))
    m_shape    = s.get("marker_shape", "circle")
    r_inner    = max(2, m_size // 2)
    r_outer    = r_inner + max(3, m_size // 2)

    DOT_RING = DOT_IN + (80,)
    ROUTE    = ROUTE_C + (80,)
    BORDER   = (40, 50, 65)
    DIM      = (100, 110, 130)

    PAD = 40

    lats = [l["lat"] for l in locations]
    lons = [l["lon"] for l in locations]

    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    if max_lat - min_lat < 0.01:
        min_lat -= 0.05; max_lat += 0.05
    if max_lon - min_lon < 0.01:
        min_lon -= 0.05; max_lon += 0.05

    lat_span = max_lat - min_lat
    lon_span = max_lon - min_lon

    def to_px(lat, lon):
        x = PAD + (lon - min_lon) / lon_span * (width  - 2 * PAD)
        y = PAD + (max_lat - lat) / lat_span * (height - 2 * PAD)
        return int(x), int(y)

    img  = Image.new("RGBA", (width, height), BG + (255,))
    draw = ImageDraw.Draw(img, "RGBA")

    # Grid
    n_grid = 8
    for i in range(1, n_grid):
        gx = i * width  // n_grid
        gy = i * height // n_grid
        draw.line([(gx, 0), (gx, height)], fill=GRID + (255,), width=1)
        draw.line([(0, gy), (width, gy)], fill=GRID + (255,), width=1)

    # Border
    draw.rectangle([(0, 0), (width-1, height-1)], outline=BORDER + (255,), width=2)

    # Route
    if show_route and len(locations) > 1:
        route_img = Image.new("RGBA", (width, height), (0,)*4)
        rdraw = ImageDraw.Draw(route_img, "RGBA")
        pts = [to_px(l["lat"], l["lon"]) for l in locations]
        for i in range(len(pts)-1):
            rdraw.line([pts[i], pts[i+1]], fill=ROUTE, width=route_w)
        img = Image.alpha_composite(img, route_img)
        draw = ImageDraw.Draw(img, "RGBA")

    def _draw_marker(drw, px, py):
        if m_shape == "square":
            drw.rectangle([(px-r_outer, py-r_outer), (px+r_outer, py+r_outer)], fill=DOT_RING)
            drw.rectangle([(px-r_inner, py-r_inner), (px+r_inner, py+r_inner)], fill=DOT_IN + (255,))
        elif m_shape == "diamond":
            drw.polygon([(px, py-r_outer), (px+r_outer, py), (px, py+r_outer), (px-r_outer, py)], fill=DOT_RING)
            drw.polygon([(px, py-r_inner), (px+r_inner, py), (px, py+r_inner), (px-r_inner, py)], fill=DOT_IN + (255,))
        elif m_shape == "pin":
            cy = py - r_inner
            drw.ellipse([(px-r_outer, cy-r_outer), (px+r_outer, cy+r_outer)], fill=DOT_RING)
            drw.polygon([(px-r_inner, cy), (px+r_inner, cy), (px, py+r_inner)], fill=DOT_RING)
            drw.ellipse([(px-r_inner, cy-r_inner), (px+r_inner, cy+r_inner)], fill=DOT_IN + (255,))
        else:  # circle
            drw.ellipse([(px-r_outer, py-r_outer), (px+r_outer, py+r_outer)], fill=DOT_RING)
            drw.ellipse([(px-r_inner, py-r_inner), (px+r_inner, py+r_inner)], fill=DOT_IN + (255,))

    # Markers + labels
    seen_labels: set[str] = set()
    for loc in locations:
        px, py = to_px(loc["lat"], loc["lon"])
        _draw_marker(draw, px, py)

        name = (loc.get("name") or "").strip()
        if name and name not in seen_labels:
            seen_labels.add(name)
            lx = min(px + r_inner + 4, width  - len(name)*5 - 4)
            ly = max(py - 18, 4)
            tw = len(name) * 5 + 6
            draw.rectangle([(lx-2, ly-1), (lx+tw, ly+11)], fill=BG + (180,))
            draw.text((lx, ly), name, fill=LABEL + (255,))

    img = img.convert("RGB")

    # Footer
    draw2 = ImageDraw.Draw(img)
    coord_txt = (
        f"{min_lat:.2f}°N–{max_lat:.2f}°N  "
        f"{min_lon:.2f}°E–{max_lon:.2f}°E  "
        f"· {len(locations)} location"
    )
    draw2.rectangle([(0, height-20), (width, height)], fill=(8, 12, 18))
    draw2.text((8, height-14), coord_txt, fill=DIM + (255,))

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
