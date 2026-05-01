"""
map_generator.py

Genera un'immagine mappa per le posizioni GPS delle foto.

Strategia:
  1. Prova a scaricare tiles OpenStreetMap via staticmap
  2. Se fallisce, genera una mappa minimalista elegante con PIL:
     - Sfondo scuro con griglia sottile
     - Punti dorati per ogni location
     - Linee di connessione in ordine cronologico
     - Etichette luogo
     - Riquadro di coordinate
"""

import io
import math
import logging
from PIL import Image, ImageDraw, ImageFont
import PIL.Image
if not hasattr(PIL.Image, 'ANTIALIAS'):
    PIL.Image.ANTIALIAS = PIL.Image.LANCZOS

logger = logging.getLogger(__name__)


import os
import io

def generate_map_image(locations: list[dict], width: int = 800, height: int = 400) -> bytes | None:
    if not locations:
        return None

    # Recupera la chiave: prima prova da variabile d'ambiente, 
    # poi prova a leggere da un file secret di Docker
    api_key = os.getenv("STADIA_MAPS_API_KEY")
    
    # Se la chiave non è in env, prova a cercarla nel file dei secrets
    secret_path = "/run/secrets/stadia_api_key"
    if not api_key and os.path.exists(secret_path):
        with open(secret_path, "r") as f:
            api_key = f.read().strip()

    try:
        from staticmap import StaticMap, CircleMarker
        
        # Costruisci l'URL dinamicamente
        url = f"https://tiles.stadiamaps.com/tiles/alidade_smooth/{{z}}/{{x}}/{{y}}.png?api_key={api_key}"
        
        m = StaticMap(width, height, url_template=url)
        
        for loc in locations:
            m.add_marker(CircleMarker((loc["lon"], loc["lat"]), "#d4aa5a", 10))
            
        img = m.render()
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        
        if len(data) > 5000:
            return data
            
    except Exception as e:
        logger.info(f"OSM tiles unavailable ({e}), using PIL map")

    return _draw_minimal_map(locations, width, height)
    
def _draw_minimal_map(locations: list[dict], width: int, height: int) -> bytes:
    """
    Mappa elegante stile "pianeta notturno":
    - Sfondo #0d1117 con griglia in grigio molto scuro
    - Linea di percorso in oro tenue
    - Punto pieno dorato per ogni location
    - Etichetta luogo (se disponibile)
    - Bordo sottile + titolo coordinate in basso
    """
    BG       = (13, 17, 23)
    GRID     = (25, 32, 42)
    ROUTE    = (180, 140, 60, 80)    # oro semitrasparente (RGBA)
    DOT_IN   = (212, 170, 90)        # oro pieno
    DOT_RING = (212, 170, 90, 80)    # oro trasparente (alone)
    LABEL    = (200, 185, 148)       # oro chiaro
    BORDER   = (40, 50, 65)
    DIM      = (100, 110, 130)       # testo dimensioni

    PAD = 40   # pixel di padding attorno all'extent geografico

    lats = [l["lat"] for l in locations]
    lons = [l["lon"] for l in locations]

    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    # Se tutte le location sono identiche, allarga artificialmente
    if max_lat - min_lat < 0.01: min_lat -= 0.05; max_lat += 0.05
    if max_lon - min_lon < 0.01: min_lon -= 0.05; max_lon += 0.05

    lat_span = max_lat - min_lat
    lon_span = max_lon - min_lon

    def to_px(lat, lon):
        # Mercator-like scaling for lat
        x = PAD + (lon - min_lon) / lon_span * (width  - 2 * PAD)
        y = PAD + (max_lat - lat) / lat_span * (height - 2 * PAD)
        return int(x), int(y)

    img  = Image.new("RGBA", (width, height), BG + (255,))
    draw = ImageDraw.Draw(img, "RGBA")

    # ── Griglia ──────────────────────────────────────────────────────────────
    n_grid = 8
    for i in range(1, n_grid):
        gx = i * width  // n_grid
        gy = i * height // n_grid
        draw.line([(gx, 0), (gx, height)], fill=GRID + (255,), width=1)
        draw.line([(0, gy), (width, gy)], fill=GRID + (255,), width=1)

    # ── Bordo ────────────────────────────────────────────────────────────────
    draw.rectangle([(0, 0), (width-1, height-1)], outline=BORDER + (255,), width=2)

    # ── Linee di percorso ────────────────────────────────────────────────────
    if len(locations) > 1:
        route_img = Image.new("RGBA", (width, height), (0,)*4)
        rdraw = ImageDraw.Draw(route_img, "RGBA")
        pts = [to_px(l["lat"], l["lon"]) for l in locations]
        for i in range(len(pts)-1):
            rdraw.line([pts[i], pts[i+1]], fill=ROUTE, width=2)
        img = Image.alpha_composite(img, route_img)
        draw = ImageDraw.Draw(img, "RGBA")

    # ── Punti ─────────────────────────────────────────────────────────────────
    seen_labels: set[str] = set()
    for idx, loc in enumerate(locations):
        px, py = to_px(loc["lat"], loc["lon"])

        # Alone
        r_outer = 14
        draw.ellipse([(px-r_outer, py-r_outer), (px+r_outer, py+r_outer)],
                     fill=DOT_RING)
        # Punto pieno
        r_inner = 5
        draw.ellipse([(px-r_inner, py-r_inner), (px+r_inner, py+r_inner)],
                     fill=DOT_IN + (255,))

        # Etichetta
        name = (loc.get("name") or "").strip()
        if name and name not in seen_labels:
            seen_labels.add(name)
            # Posiziona etichetta evitando bordi
            lx = min(px + 10, width  - len(name)*5 - 4)
            ly = max(py - 18, 4)
            # Sfondo etichetta
            tw = len(name) * 5 + 6
            draw.rectangle([(lx-2, ly-1), (lx+tw, ly+11)],
                            fill=(13, 17, 23, 180))
            draw.text((lx, ly), name, fill=LABEL + (255,))

    img = img.convert("RGB")

    # ── Footer coordinate ─────────────────────────────────────────────────────
    draw2 = ImageDraw.Draw(img)
    coord_txt = (f"{min_lat:.2f}°N–{max_lat:.2f}°N  "
                 f"{min_lon:.2f}°E–{max_lon:.2f}°E  "
                 f"· {len(locations)} location")
    # Rettangolo footer
    draw2.rectangle([(0, height-20), (width, height)],
                    fill=(8, 12, 18))
    draw2.text((8, height-14), coord_txt, fill=DIM + (255,))

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
