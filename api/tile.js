/**
 * /api/tile -- Sirve tiles PNG desde COGs en GCS (bucket privado).
 *
 * Uso: GET /api/tile?year=2017&z=15&x=123&y=456
 *
 * Flujo:
 *   1. Genera URL firmada para el COG en GCS
 *   2. Lee la porcion correcta del COG usando geotiff.js (HTTP Range Requests)
 *   3. Convierte a PNG con sharp
 *   4. Devuelve el tile (Vercel lo cachea en su CDN por 24h)
 *
 * Variables de entorno:
 *   GCS_BUCKET               -> nombre del bucket
 *   GCS_SERVICE_ACCOUNT_JSON -> JSON del service account
 */

const { Storage } = require('@google-cloud/storage');

const TILE_SIZE = 256;
const ORIGIN_SHIFT = 20037508.342789244;

// -- Cache de URLs firmadas --
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
        .file(`raster/satellite_${year}_cog.tif`)
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

async function emptyTilePng() {
    // 1x1 transparent PNG (smallest valid PNG)
    return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNl7BcQAAAABJRU5ErkJggg==',
        'base64'
    );
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const year = req.query.year;
    const z = parseInt(req.query.z);
    const x = parseInt(req.query.x);
    const y = parseInt(req.query.y);

    if (!['2017', '2024'].includes(year) || [z, x, y].some(isNaN)) {
        return res.status(400).json({ error: 'Params invalidos: ?year=2017&z=15&x=123&y=456' });
    }

    try {
        // Dynamic import porque geotiff es ESM-only en v2+
        const { fromUrl } = await import('geotiff');
        const sharp = (await import('sharp')).default;

        // 1) URL firmada del COG
        const cogUrl = await getCogUrl(year);

        // 2) Abrir COG via HTTP Range Requests
        const tiff = await fromUrl(cogUrl);

        // 3) Bounds del tile en EPSG:3857
        const [tW, tS, tE, tN] = tileBounds(z, x, y);
        const neededRes = (tE - tW) / TILE_SIZE;

        // 4) Seleccionar mejor overview
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

        // 5) Metadata
        const [oX, oY] = img.getOrigin();
        const [rX, rY] = img.getResolution();
        const w = img.getWidth();
        const h = img.getHeight();

        // 6) Tile a coordenadas pixel
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

        if (cR <= cL || cB <= cT) {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
            return res.send(await emptyTilePng());
        }

        const outW = Math.max(1, Math.round(TILE_SIZE * (cR - cL) / fW));
        const outH = Math.max(1, Math.round(TILE_SIZE * (cB - cT) / fH));
        const outX = Math.max(0, Math.round(TILE_SIZE * (cL - fL) / fW));
        const outY = Math.max(0, Math.round(TILE_SIZE * (cT - fT) / fH));

        // 9) Leer pixels
        const rasters = await img.readRasters({
            window: [cL, cT, cR, cB],
            width: outW,
            height: outH,
            interleave: true
        });

        const channels = img.getSamplesPerPixel();
        const dataBuffer = Buffer.from(rasters);

        // 10) Convertir a PNG
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
                create: {
                    width: TILE_SIZE, height: TILE_SIZE, channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
            .composite([{ input: overlay, left: outX, top: outY }])
            .png()
            .toBuffer();
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
        return res.send(png);

    } catch (err) {
        console.error('[tile error]', err.message);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.send(await emptyTilePng());
    }
};
