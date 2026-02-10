/**
 * /api/tile -- Sirve tiles PNG desde COGs en GCS (bucket privado).
 *
 * GET /api/tile?year=2017&z=15&x=123&y=456
 * GET /api/tile?test=1               → devuelve un tile PNG de prueba
 * GET /api/tile?debug=1&year=2024    → devuelve JSON con info de diagnóstico
 *
 * Variables de entorno:
 *   GCS_BUCKET               → nombre del bucket
 *   GCS_SERVICE_ACCOUNT_JSON → JSON del service account
 */

const { Storage } = require('@google-cloud/storage');

const TILE_SIZE = 256;
const ORIGIN_SHIFT = 20037508.342789244;

// 1×1 transparent PNG precalculado (sin dependencias)
const EMPTY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==',
    'base64'
);

// Cache de URLs firmadas
let urlCache = {};
let urlCacheTime = 0;

async function getCogUrl(year) {
    const now = Date.now();
    if (urlCache[year] && (now - urlCacheTime) < 3_000_000) {
        return urlCache[year];
    }
    const creds = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON);
    const storage = new Storage({ credentials: creds });
    const [url] = await storage.bucket(process.env.GCS_BUCKET)
        .file(`TO_GOOGLE_CLOUD/raster/satellite_${year}_cog.tif`)
        .getSignedUrl({ version: 'v4', action: 'read', expires: now + 3_600_000 });
    urlCache[year] = url;
    urlCacheTime = now;
    return url;
}

function tileBounds(z, x, y) {
    const size = (2 * ORIGIN_SHIFT) / (1 << z);
    return [
        -ORIGIN_SHIFT + x * size,
         ORIGIN_SHIFT - (y + 1) * size,
        -ORIGIN_SHIFT + (x + 1) * size,
         ORIGIN_SHIFT - y * size
    ];
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // ─── TEST MODE: retorna un tile rojo para verificar que la función corre ───
    if (req.query.test === '1') {
        try {
            const sharp = (await import('sharp')).default;
            const png = await sharp({
                create: { width: 256, height: 256, channels: 4,
                    background: { r: 255, g: 0, b: 0, alpha: 128 } }
            }).png().toBuffer();
            res.setHeader('Content-Type', 'image/png');
            return res.send(png);
        } catch (e) {
            return res.status(200).json({ 
                test: 'FAILED', 
                error: e.message,
                stack: e.stack?.split('\n').slice(0, 5)
            });
        }
    }

    // ─── DEBUG MODE: retorna JSON con info de diagnóstico ───
    if (req.query.debug === '1') {
        const info = {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            env: {
                GCS_BUCKET: process.env.GCS_BUCKET ? '✅ set' : '❌ missing',
                GCS_SERVICE_ACCOUNT_JSON: process.env.GCS_SERVICE_ACCOUNT_JSON ? '✅ set' : '❌ missing',
            },
            modules: {}
        };

        // Test imports
        try { await import('geotiff'); info.modules.geotiff = '✅'; }
        catch (e) { info.modules.geotiff = `❌ ${e.message}`; }

        try { await import('sharp'); info.modules.sharp = '✅'; }
        catch (e) { info.modules.sharp = `❌ ${e.message}`; }

        // Test signed URL generation
        if (req.query.year) {
            try {
                const url = await getCogUrl(req.query.year);
                info.signedUrl = url.substring(0, 100) + '...';
                
                // Test HEAD request to see if file exists
                const resp = await fetch(url, { method: 'HEAD' });
                info.gcsFileStatus = resp.status;
                info.gcsFileSize = resp.headers.get('content-length');
                info.gcsContentType = resp.headers.get('content-type');
            } catch (e) {
                info.signedUrlError = e.message;
            }
        }

        return res.status(200).json(info);
    }

    // ─── NORMAL MODE: servir tile ───
    const year = req.query.year;
    const z = parseInt(req.query.z);
    const x = parseInt(req.query.x);
    const y = parseInt(req.query.y);

    if (!['2017', '2024'].includes(year) || [z, x, y].some(isNaN)) {
        return res.status(400).json({ error: 'Usa: ?year=2017&z=15&x=123&y=456' });
    }

    try {
        // Dynamic imports (geotiff v2+ es ESM-only)
        const { fromUrl } = await import('geotiff');
        const sharp = (await import('sharp')).default;

        // 1) URL firmada
        const cogUrl = await getCogUrl(year);

        // 2) Abrir COG
        const tiff = await fromUrl(cogUrl);

        // 3) Bounds del tile
        const [tW, tS, tE, tN] = tileBounds(z, x, y);
        const neededRes = (tE - tW) / TILE_SIZE;

        // 4) Mejor overview
        const count = await tiff.getImageCount();
        let img = await tiff.getImage(0);
        let imgRes = Math.abs(img.getResolution()[0]);

        for (let i = 1; i < count; i++) {
            const candidate = await tiff.getImage(i);
            const candRes = Math.abs(candidate.getResolution()[0]);
            if (candRes <= neededRes * 1.5 && candRes > imgRes) {
                img = candidate;
                imgRes = candRes;
            }
        }

        // 5) Pixel coords
        const [oX, oY] = img.getOrigin();
        const [rX, rY] = img.getResolution();
        const w = img.getWidth();
        const h = img.getHeight();

        const fL = (tW - oX) / rX;
        const fT = (tN - oY) / rY;
        const fR = (tE - oX) / rX;
        const fB = (tS - oY) / rY;
        const fW = fR - fL;
        const fH = fB - fT;

        const cL = Math.max(0, Math.floor(fL));
        const cT = Math.max(0, Math.floor(fT));
        const cR = Math.min(w, Math.ceil(fR));
        const cB = Math.min(h, Math.ceil(fB));

        // Tile fuera del area → transparente
        if (cR <= cL || cB <= cT) {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
            return res.send(EMPTY_PNG);
        }

        const outW = Math.max(1, Math.round(TILE_SIZE * (cR - cL) / fW));
        const outH = Math.max(1, Math.round(TILE_SIZE * (cB - cT) / fH));
        const outX = Math.max(0, Math.round(TILE_SIZE * (cL - fL) / fW));
        const outY = Math.max(0, Math.round(TILE_SIZE * (cT - fT) / fH));

        // 6) Leer pixels
        const rasters = await img.readRasters({
            window: [cL, cT, cR, cB],
            width: outW,
            height: outH,
            interleave: true
        });

        const channels = img.getSamplesPerPixel();
        const dataBuffer = Buffer.from(rasters);

        // 7) Convertir a PNG
        let png;
        if (outW === TILE_SIZE && outH === TILE_SIZE && outX === 0 && outY === 0) {
            png = await sharp(dataBuffer, {
                raw: { width: TILE_SIZE, height: TILE_SIZE, channels }
            }).png().toBuffer();
        } else {
            const overlay = await sharp(dataBuffer, {
                raw: { width: outW, height: outH, channels }
            }).ensureAlpha().png().toBuffer();

            png = await sharp({
                create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 } }
            })
            .composite([{ input: overlay, left: outX, top: outY }])
            .png()
            .toBuffer();
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
        return res.send(png);

    } catch (err) {
        console.error(`[tile error] year=${year} z=${z} x=${x} y=${y}:`, err.message);
        // SIEMPRE devolver PNG transparente (nunca HTML ni JSON en error)
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(EMPTY_PNG);
    }
};
