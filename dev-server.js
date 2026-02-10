/**
 * dev-server.js -- Servidor local de desarrollo.
 *
 * Lanza TODO lo necesario con un solo comando:
 *   1. Express (puerto 3000) -> HTML + PMTiles + /api/signed-urls + /api/tile proxy
 *   2. Python tile_server.py (puerto 3001) -> tiles de imagenes satelitales (COGs)
 *
 * Uso:
 *   cd deploy/TO_GITHUB_VERCEL
 *   npm install
 *   npm run dev        (o: node dev-server.js)
 *   -> Abrir http://localhost:3000
 */

const express = require('express');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = 3000;
const PYTHON_TILE_PORT = 3001;

// -- Rutas locales a los datos --
const DATA_DIR = path.join(__dirname, '..', 'TO_GOOGLE_CLOUD');
const PMTILES_DIR = path.join(DATA_DIR, 'vector', 'pmtiles');
const RASTER_DIR = path.join(DATA_DIR, 'raster');

// -- Ruta al tile_server.py LOCAL (dentro de TO_GITHUB_VERCEL) --
const TILE_SERVER_PY = path.join(__dirname, 'tile_server.py');

// ==================================================================
// /api/signed-urls -> devuelve URLs locales
// ==================================================================
app.get('/api/signed-urls', (req, res) => {
    const base = `http://localhost:${PORT}/data/pmtiles`;
    const files = [
        'landcover_2016', 'landcover_2024', 'landcover_change',
        'single_tree_2016', 'single_tree_2024', 'single_tree_change'
    ];
    const urls = {};
    files.forEach(f => {
        urls[`vector/pmtiles/${f}.pmtiles`] = `${base}/${f}.pmtiles`;
    });
    // Los COGs se sirven via /api/tile -> proxy a Python
    urls['raster/satellite_2017_cog.tif'] = 'local';
    urls['raster/satellite_2024_cog.tif'] = 'local';

    console.log('[API] /api/signed-urls -> URLs locales generadas');
    res.json(urls);
});

// ==================================================================
// /api/tile -> proxy al tile server Python (puerto 3001)
// ==================================================================
app.get('/api/tile', (req, res) => {
    const { year, z, x, y } = req.query;
    const tileUrl = `http://localhost:${PYTHON_TILE_PORT}/tiles/satellite_${year}/${z}/${x}/${y}.png`;

    http.get(tileUrl, (proxyRes) => {
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        proxyRes.pipe(res);
    }).on('error', (err) => {
        console.error(`[tile proxy] Error: ${err.message}`);
        const emptyPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
            'Nl7BcQAAAABJRU5ErkJggg==', 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.send(emptyPng);
    });
});

// ==================================================================
// Servir PMTiles con Range Requests + CORS
// ==================================================================
app.use('/data/pmtiles', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}, express.static(PMTILES_DIR, { acceptRanges: true }));

// ==================================================================
// Servir el HTML (public/)
// ==================================================================
app.use(express.static('public'));

// ==================================================================
// Lanzar Python tile server automaticamente
// ==================================================================
function startPythonTileServer() {
    if (!fs.existsSync(TILE_SERVER_PY)) {
        console.log('  [!] tile_server.py no encontrado');
        console.log(`      Esperado en: ${TILE_SERVER_PY}`);
        return null;
    }

    if (!fs.existsSync(RASTER_DIR)) {
        console.log(`  [!] RASTER_DIR no encontrado: ${RASTER_DIR}`);
        console.log('      Las imagenes satelitales no estaran disponibles.');
        return null;
    }

    console.log(`  [PY] Iniciando Python tile server en puerto ${PYTHON_TILE_PORT}...`);
    console.log(`  [PY] RASTER_DIR = ${RASTER_DIR}`);
    console.log(`  [PY] Script    = ${TILE_SERVER_PY}`);

    const py = spawn('python', [TILE_SERVER_PY], {
        env: {
            ...process.env,
            RASTER_DIR: RASTER_DIR,
            TILE_PORT: String(PYTHON_TILE_PORT),
            PYTHONIOENCODING: 'utf-8'
        },
        stdio: ['pipe', 'pipe', 'pipe']
    });

    py.stdout.on('data', (d) => {
        d.toString().trim().split('\n').forEach(line => {
            if (line.trim()) console.log(`  [PY] ${line}`);
        });
    });
    py.stderr.on('data', (d) => {
        d.toString().trim().split('\n').forEach(line => {
            if (line.trim()) console.log(`  [PY:err] ${line}`);
        });
    });
    py.on('close', (code) => {
        if (code) console.log(`  [!] Python tile server termino con codigo ${code}`);
    });

    return py;
}

// ==================================================================
// Iniciar todo
// ==================================================================
console.log('');
console.log('========================================================');
console.log('  BlackPrint Map Viewer -- Dev Server');
console.log('========================================================');
console.log('');

const pyProcess = startPythonTileServer();

app.listen(PORT, () => {
    console.log('');
    console.log(`  [OK] Mapa:            http://localhost:${PORT}`);
    console.log(`  [OK] API signed-urls:  http://localhost:${PORT}/api/signed-urls`);
    console.log(`  [OK] API tile:         http://localhost:${PORT}/api/tile?year=2024&z=14&x=3620&y=7228`);
    console.log(`  [OK] PMTiles:          http://localhost:${PORT}/data/pmtiles/`);
    console.log(`  [OK] Python tiles:     http://localhost:${PYTHON_TILE_PORT}/health`);
    console.log('');
    console.log('  Abre http://localhost:3000 en tu browser');
    console.log('  Ctrl+C para detener');
    console.log('');
});

// Cleanup
process.on('SIGINT', () => {
    if (pyProcess) pyProcess.kill();
    process.exit();
});
process.on('SIGTERM', () => {
    if (pyProcess) pyProcess.kill();
    process.exit();
});
