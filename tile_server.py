"""
tile_server.py -- Servidor local de tiles para imagenes satelitales (COGs)

Lee los archivos COG con GDAL y genera tiles PNG de 256x256 px.
SOLO se usa para desarrollo local. En produccion, Vercel usa api/tile.js.

Requisitos:
    pip install numpy pillow
    conda install -c conda-forge gdal   (o pip install gdal)

Uso:
    python tile_server.py
    -> http://localhost:3001/tiles/satellite_2017/{z}/{x}/{y}.png
    -> http://localhost:3001/tiles/satellite_2024/{z}/{x}/{y}.png

    O se lanza automaticamente desde dev-server.js (npm run dev)
"""

import math
import os
import io
import time
import json
from pathlib import Path
from collections import OrderedDict
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

import numpy as np
from osgeo import gdal
from PIL import Image

gdal.UseExceptions()

# =========================================================================
# Config
# =========================================================================
PORT = int(os.environ.get("TILE_PORT", "3001"))
TILE_SIZE = 256
CACHE_MAX = 2000

# Buscar COGs en este orden:
#   1. Variable de entorno RASTER_DIR
#   2. ../TO_GOOGLE_CLOUD/raster/  (estructura deploy/)
#   3. ../../GCloud_Upload/raster/  (estructura original del proyecto)
def find_raster_dir():
    if os.environ.get("RASTER_DIR"):
        return Path(os.environ["RASTER_DIR"])

    candidates = [
        Path(__file__).parent / ".." / "TO_GOOGLE_CLOUD" / "raster",
        Path(__file__).parent / ".." / ".." / "GCloud_Upload" / "raster",
        Path(__file__).parent / ".." / ".." / "deploy" / "TO_GOOGLE_CLOUD" / "raster",
    ]
    for c in candidates:
        resolved = c.resolve()
        if resolved.exists() and (resolved / "satellite_2024_cog.tif").exists():
            return resolved

    # Fallback
    return Path(__file__).parent / ".." / "TO_GOOGLE_CLOUD" / "raster"


RASTER_DIR = find_raster_dir()
SOURCES = {
    "satellite_2017": str(RASTER_DIR / "satellite_2017_cog.tif"),
    "satellite_2024": str(RASTER_DIR / "satellite_2024_cog.tif"),
}

# =========================================================================
# Tile cache (LRU)
# =========================================================================
tile_cache = OrderedDict()


def get_cached(key):
    if key in tile_cache:
        tile_cache.move_to_end(key)
        return tile_cache[key]
    return None


def set_cached(key, data):
    if len(tile_cache) >= CACHE_MAX:
        tile_cache.popitem(last=False)
    tile_cache[key] = data


# =========================================================================
# GDAL dataset pool
# =========================================================================
datasets = {}


def get_dataset(source_name):
    if source_name not in datasets:
        fpath = SOURCES.get(source_name)
        if not fpath or not os.path.exists(fpath):
            return None
        ds = gdal.Open(fpath, gdal.GA_ReadOnly)
        if ds is None:
            return None

        gt = ds.GetGeoTransform()
        info = {
            "ds": ds,
            "width": ds.RasterXSize,
            "height": ds.RasterYSize,
            "bands": ds.RasterCount,
            "gt": gt,
            "originX": gt[0],
            "originY": gt[3],
            "pixelW": gt[1],
            "pixelH": gt[5],
        }
        info["west"] = gt[0]
        info["north"] = gt[3]
        info["east"] = gt[0] + gt[1] * ds.RasterXSize
        info["south"] = gt[3] + gt[5] * ds.RasterYSize

        datasets[source_name] = info
        print(f"  Opened: {fpath}")
        print(f"    Size: {info['width']} x {info['height']} px, {info['bands']} bands")
        print(f"    Pixel: {info['pixelW']:.2f}m")

    return datasets[source_name]


# =========================================================================
# Web Mercator helpers
# =========================================================================
EARTH_HALF = 20037508.342789244


def tile_bbox(z, x, y):
    """Returns (west, south, east, north) in EPSG:3857."""
    tile_size = (2 * EARTH_HALF) / (2 ** z)
    west = -EARTH_HALF + x * tile_size
    east = -EARTH_HALF + (x + 1) * tile_size
    north = EARTH_HALF - y * tile_size
    south = EARTH_HALF - (y + 1) * tile_size
    return west, south, east, north


# =========================================================================
# Render a single tile
# =========================================================================
_empty_img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
_empty_buf = io.BytesIO()
_empty_img.save(_empty_buf, "PNG")
EMPTY_PNG = _empty_buf.getvalue()


def render_tile(source_name, z, x, y):
    info = get_dataset(source_name)
    if info is None:
        return None

    ds = info["ds"]
    west, south, east, north = tile_bbox(z, x, y)

    if west >= info["east"] or east <= info["west"]:
        return EMPTY_PNG
    if south >= info["north"] or north <= info["south"]:
        return EMPTY_PNG

    px0 = (west - info["originX"]) / info["pixelW"]
    py0 = (north - info["originY"]) / info["pixelH"]
    px1 = (east - info["originX"]) / info["pixelW"]
    py1 = (south - info["originY"]) / info["pixelH"]

    px0_c = max(0, int(math.floor(px0)))
    py0_c = max(0, int(math.floor(py0)))
    px1_c = min(info["width"], int(math.ceil(px1)))
    py1_c = min(info["height"], int(math.ceil(py1)))

    win_w = px1_c - px0_c
    win_h = py1_c - py0_c
    if win_w <= 0 or win_h <= 0:
        return EMPTY_PNG

    total_px_w = px1 - px0
    total_px_h = py1 - py0

    out_x0 = max(0, int(round((px0_c - px0) / total_px_w * TILE_SIZE)))
    out_y0 = max(0, int(round((py0_c - py0) / total_px_h * TILE_SIZE)))
    out_x1 = min(TILE_SIZE, int(round((px1_c - px0) / total_px_w * TILE_SIZE)))
    out_y1 = min(TILE_SIZE, int(round((py1_c - py0) / total_px_h * TILE_SIZE)))

    out_w = out_x1 - out_x0
    out_h = out_y1 - out_y0
    if out_w <= 0 or out_h <= 0:
        return EMPTY_PNG

    try:
        data = ds.ReadRaster(
            px0_c, py0_c, win_w, win_h,
            out_w, out_h,
            band_list=list(range(1, min(info["bands"], 3) + 1)),
            buf_type=gdal.GDT_Byte,
        )
    except Exception as e:
        print(f"  ReadRaster error: {e}")
        return EMPTY_PNG

    if data is None:
        return EMPTY_PNG

    bands_read = min(info["bands"], 3)
    arr = np.frombuffer(data, dtype=np.uint8).reshape(bands_read, out_h, out_w)

    rgba = np.zeros((TILE_SIZE, TILE_SIZE, 4), dtype=np.uint8)

    for b in range(bands_read):
        rgba[out_y0:out_y1, out_x0:out_x1, b] = arr[b]
    if bands_read == 1:
        rgba[out_y0:out_y1, out_x0:out_x1, 1] = arr[0]
        rgba[out_y0:out_y1, out_x0:out_x1, 2] = arr[0]

    r = rgba[out_y0:out_y1, out_x0:out_x1, 0]
    g = rgba[out_y0:out_y1, out_x0:out_x1, 1]
    b_ch = rgba[out_y0:out_y1, out_x0:out_x1, 2]
    is_data = ~((r == 0) & (g == 0) & (b_ch == 0))
    rgba[out_y0:out_y1, out_x0:out_x1, 3] = is_data.astype(np.uint8) * 255

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=6)
    return buf.getvalue()


# =========================================================================
# HTTP Server
# =========================================================================
class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silenciar logs por request

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok",
                "sources": list(SOURCES.keys()),
                "cache_size": len(tile_cache),
            }).encode())
            return

        if path == "/sources":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                "sources": list(SOURCES.keys()),
                "tileUrl": "/tiles/{source}/{z}/{x}/{y}.png",
            }).encode())
            return

        if path.startswith("/tiles/"):
            parts = path.split("/")
            if len(parts) != 6:
                self.send_error(400, "Invalid tile path")
                return

            source = parts[2]
            try:
                z = int(parts[3])
                x = int(parts[4])
                y = int(parts[5].replace(".png", ""))
            except ValueError:
                self.send_error(400, "Invalid tile coordinates")
                return

            if source not in SOURCES:
                self.send_error(404, f"Unknown source: {source}")
                return

            cache_key = f"{source}/{z}/{x}/{y}"
            cached = get_cached(cache_key)
            if cached:
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.send_header("X-Cache", "HIT")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(cached)
                return

            t0 = time.time()
            try:
                png_data = render_tile(source, z, x, y)
            except Exception as e:
                print(f"  Error rendering {cache_key}: {e}")
                self.send_error(500, str(e))
                return

            if png_data is None:
                self.send_error(404, "Source not available")
                return

            elapsed = (time.time() - t0) * 1000
            if elapsed > 100:
                print(f"  Slow tile: {cache_key} ({elapsed:.0f}ms)")

            set_cached(cache_key, png_data)

            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("X-Cache", "MISS")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(png_data)
            return

        self.send_error(404, "Not found")


def main():
    print()
    print("=" * 60)
    print("  Blackprint Tile Server (Python/GDAL)")
    print(f"  http://localhost:{PORT}")
    print(f"  RASTER_DIR: {RASTER_DIR}")
    print()
    print("  Tile URLs:")
    for name, fpath in SOURCES.items():
        exists = "[OK]" if os.path.exists(fpath) else "[MISSING]"
        size = f"({os.path.getsize(fpath) / 1024 / 1024:.0f} MB)" if os.path.exists(fpath) else ""
        print(f"    {exists} http://localhost:{PORT}/tiles/{name}/{{z}}/{{x}}/{{y}}.png {size}")
    print()
    print("=" * 60)
    print()

    for name in SOURCES:
        if os.path.exists(SOURCES[name]):
            get_dataset(name)

    server = HTTPServer(("0.0.0.0", PORT), TileHandler)
    print(f"  Server listening on port {PORT}...")
    print(f"  Press Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()

