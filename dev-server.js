/**
 * dev-server.js — Servidor local para desarrollo.
 *
 * Simula las rutas de Vercel (/api/signed-urls, /api/tile)
 * usando archivos locales en lugar de Google Cloud Storage.
 *
 * Uso:
 *   cd deploy/TO_GITHUB_VERCEL
 *   npm install
 *   node dev-server.js
 *   → Abrir http://localhost:3000
 */

const express = require('express');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = 3000;
const PYTHON_TILE_PORT = 3001;

// ── Rutas locales a los archivos de datos ──
const DATA_DIR = path.join(__dirname, '..', 'TO_GOOGLE_CLOUD');
const PMTILES_DIR = path.join(DATA_DIR, 'vector', 'pmtiles');
const RASTER_DIR = path.join(DATA_DIR, 'raster');

// ══════════════════════════════════════════════════════════════
// RUTA: /api/signed-urls — devuelve URLs locales para PMTiles
// ══════════════════════════════════════════════════════════════
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
    // Los COGs se sirven por /api/tile (proxy a Python tile server)
    urls['raster/satellite_2017_cog.tif'] = 'local';
    urls['raster/satellite_2024_cog.tif'] = 'local';

    console.log('[API] /api/signed-urls → URLs locales generadas');
    res.json(urls);
});

// ══════════════════════════════════════════════════════════════
// RUTA: /api/tile — proxy al tile server Python en puerto 8080
// ══════════════════════════════════════════════════════════════
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
        // Retornar tile transparente 1x1 PNG como fallback
        const emptyPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
            'Nl7BcQAAAABJRU5ErkJggg==', 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.send(emptyPng);
    });
});

// ══════════════════════════════════════════════════════════════
// Servir PMTiles como archivos estáticos con Range Requests
// ══════════════════════════════════════════════════════════════
app.use('/data/pmtiles', (req, res, next) => {
    // Headers necesarios para Range Requests (PMTiles)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}, express.static(PMTILES_DIR, {
    acceptRanges: true
}));

// ══════════════════════════════════════════════════════════════
// Servir el HTML
// ══════════════════════════════════════════════════════════════
app.use(express.static('public'));

// ══════════════════════════════════════════════════════════════
// Lanzar Python tile server automáticamente
// ══════════════════════════════════════════════════════════════
function startPythonTileServer() {
    const tileServerScript = path.join(
        __dirname, '..', '..', 'GCloud_Upload', 'tile-server', 'tile_server.py'
    );

    if (!fs.existsSync(tileServerScript)) {
        console.log('  ⚠️  tile_server.py no encontrado — tiles satelitales no disponibles');
        console.log(`     Esperado en: ${tileServerScript}`);
        return null;
    }

    console.log(`  🐍 Iniciando Python tile server en puerto ${PYTHON_TILE_PORT}...`);
    const py = spawn('python', [tileServerScript], {
        env: { ...process.env, RASTER_DIR: RASTER_DIR },
        stdio: ['pipe', 'pipe', 'pipe']
    });

    py.stdout.on('data', (d) => console.log(`  [py] ${d.toString().trim()}`));
    py.stderr.on('data', (d) => console.log(`  [py] ${d.toString().trim()}`));
    py.on('close', (code) => {
        if (code) console.log(`  ⚠️  Python tile server terminó con código ${code}`);
    });

    return py;
}

// ══════════════════════════════════════════════════════════════
// Iniciar todo
// ══════════════════════════════════════════════════════════════
const pyProcess = startPythonTileServer();

app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  BlackPrint Map Viewer — Dev Server              ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  🌍  http://localhost:${PORT}                       ║`);
    console.log('║                                                  ║');
    console.log('║  Rutas:                                          ║');
    console.log('║    /                  → Mapa (index.html)        ║');
    console.log('║    /api/signed-urls   → URLs locales PMTiles     ║');
    console.log('║    /api/tile          → Proxy a Python tile srv  ║');
    console.log('║    /data/pmtiles/     → PMTiles estáticos        ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
});

// Cleanup al cerrar
process.on('SIGINT', () => {
    if (pyProcess) pyProcess.kill();
    process.exit();
});
process.on('SIGTERM', () => {
    if (pyProcess) pyProcess.kill();
    process.exit();
});
