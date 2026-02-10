/**
 * /api/tile — Sirve tiles PNG desde COGs en GCS (bucket privado).
 *
 * GET /api/tile?year=2017&z=15&x=123&y=456   → tile PNG
 * GET /api/tile?test=1                        → tile rojo de prueba (verifica sharp)
 * GET /api/tile?debug=1&year=2024             → JSON diagnóstico
 *
 * Flujo:
 *   1. Genera signed URL interna (nunca expuesta al browser)
 *   2. geotiff.js abre el COG via esa URL (Range requests internos)
 *   3. Lee los pixels del tile, convierte a PNG con sharp
 *   4. Devuelve PNG al browser
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getGcsClient, getGcsBucket, getGcsPrefix } from '@/lib/gcs';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TILE_SIZE = 256;
const ORIGIN_SHIFT = 20037508.342789244;

// 1×1 transparent PNG (precalculado, sin dependencias)
const EMPTY_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

// Archivos COG permitidos
const COG_FILES: Record<string, string> = {
  '2017': 'raster/satellite_2017_cog.tif',
  '2024': 'raster/satellite_2024_cog.tif',
};

/* ---------- Caché de signed URLs internos ---------- */

let urlCache: Record<string, string> = {};
let urlCacheTime = 0;

async function getCogSignedUrl(year: string): Promise<string> {
  const now = Date.now();
  // Reutilizar URL si tiene menos de 50 min (firmadas por 60 min)
  if (urlCache[year] && now - urlCacheTime < 3_000_000) {
    return urlCache[year];
  }

  const storage = getGcsClient();
  const bucket = getGcsBucket();
  const prefix = getGcsPrefix();
  const objectPath = `${prefix}/${COG_FILES[year]}`;

  const [url] = await storage.bucket(bucket).file(objectPath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: now + 3_600_000, // 1 hora
  });

  urlCache[year] = url;
  urlCacheTime = now;
  return url;
}

/* ---------- Web Mercator math ---------- */

function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * ORIGIN_SHIFT) / (1 << z);
  return [
    -ORIGIN_SHIFT + x * size,       // west
     ORIGIN_SHIFT - (y + 1) * size, // south
    -ORIGIN_SHIFT + (x + 1) * size, // east
     ORIGIN_SHIFT - y * size,       // north
  ];
}

/* ---------- Handler ---------- */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // ─── TEST MODE ───
  if (searchParams.get('test') === '1') {
    try {
      const sharp = (await import('sharp')).default;
      const png = await sharp({
        create: {
          width: 256, height: 256, channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 128 },
        },
      }).png().toBuffer();

      return new NextResponse(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png' },
      });
    } catch (e: any) {
      return NextResponse.json({ test: 'FAILED', error: e.message });
    }
  }

  // ─── DEBUG MODE ───
  if (searchParams.get('debug') === '1') {
    const info: Record<string, any> = {
      node: process.version,
      env: {
        GCS_BUCKET: process.env.GCS_BUCKET ? '✅' : '❌',
        GCS_PREFIX: process.env.GCS_PREFIX ?? '(default: TO_GOOGLE_CLOUD)',
        BQ_SERVICE_ACCOUNT_JSON: process.env.BQ_SERVICE_ACCOUNT_JSON ? '✅' : '❌',
      },
      modules: {},
    };

    try { await import('geotiff'); info.modules.geotiff = '✅'; }
    catch (e: any) { info.modules.geotiff = `❌ ${e.message}`; }

    try { await import('sharp'); info.modules.sharp = '✅'; }
    catch (e: any) { info.modules.sharp = `❌ ${e.message}`; }

    const year = searchParams.get('year');
    if (year && COG_FILES[year]) {
      try {
        const url = await getCogSignedUrl(year);
        info.signedUrl = url.substring(0, 120) + '...';
        const resp = await fetch(url, { method: 'HEAD' });
        info.gcsStatus = resp.status;
        info.gcsSize = resp.headers.get('content-length');
      } catch (e: any) {
        info.signedUrlError = e.message;
      }
    }

    return NextResponse.json(info);
  }

  // ─── NORMAL: servir tile ───
  const year = searchParams.get('year') ?? '';
  const z = parseInt(searchParams.get('z') ?? '', 10);
  const x = parseInt(searchParams.get('x') ?? '', 10);
  const y = parseInt(searchParams.get('y') ?? '', 10);

  if (!COG_FILES[year] || [z, x, y].some(isNaN)) {
    return NextResponse.json(
      { error: 'Uso: ?year=2017&z=15&x=123&y=456' },
      { status: 400 },
    );
  }

  // ?verbose=1 → devuelve errores como JSON en vez de PNG vacío (para diagnóstico)
  const verbose = searchParams.get('verbose') === '1';

  try {
    const { fromUrl } = await import('geotiff');
    const sharp = (await import('sharp')).default;

    // 1) Signed URL interna
    const cogUrl = await getCogSignedUrl(year);

    // 2) Abrir COG
    const tiff = await fromUrl(cogUrl);

    // 3) Imagen principal: obtener geo-referencia y dimensiones
    const mainImg = await tiff.getImage(0);
    const [oX, oY] = mainImg.getOrigin();
    const [rX, rY] = mainImg.getResolution();
    const mainW = mainImg.getWidth();
    const mainH = mainImg.getHeight();
    const bandCount = mainImg.getSamplesPerPixel();
    const photometric = mainImg.fileDirectory?.PhotometricInterpretation;

    // 4) Bounds del tile en EPSG:3857
    const [tW, tS, tE, tN] = tileBounds(z, x, y);

    // 5) Pixel coords en la imagen principal (full-res)
    const fL = (tW - oX) / rX;
    const fT = (tN - oY) / rY;
    const fR = (tE - oX) / rX;
    const fB = (tS - oY) / rY;
    const fW = fR - fL;
    const fH = fB - fT;

    // Tile fuera del área → transparente
    if (fR <= 0 || fB <= 0 || fL >= mainW || fT >= mainH) {
      return new NextResponse(EMPTY_PNG, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, s-maxage=86400, max-age=3600' },
      });
    }

    // 6) Encontrar el mejor overview del COG
    //    Buscamos un overview cuya resolución sea ≥ 256 px para este tile.
    //    NO llamamos getResolution()/getOrigin() en overviews (crashean),
    //    calculamos proporcionalmente por dimensiones.
    const imageCount = await tiff.getImageCount();
    let bestImg = mainImg;
    let bestW = mainW;
    let bestH = mainH;

    for (let i = 1; i < imageCount; i++) {
      try {
        const ovr = await tiff.getImage(i);
        const ovrW = ovr.getWidth();
        const ovrH = ovr.getHeight();
        // ¿Cuántos pixels del overview cubriría este tile?
        const ovrTilePixels = Math.abs(fW) * (ovrW / mainW);
        // Usar este overview si todavía da ≥ 256 px por tile
        if (ovrTilePixels >= TILE_SIZE) {
          bestImg = ovr;
          bestW = ovrW;
          bestH = ovrH;
        }
      } catch { /* skip bad overviews */ }
    }

    // 7) Convertir coordenadas de pixel del full-res al overview elegido
    const scaleX = bestW / mainW;
    const scaleY = bestH / mainH;

    const cL = Math.max(0, Math.floor(fL * scaleX));
    const cT = Math.max(0, Math.floor(fT * scaleY));
    const cR = Math.min(bestW, Math.ceil(fR * scaleX));
    const cB = Math.min(bestH, Math.ceil(fB * scaleY));

    if (cR <= cL || cB <= cT) {
      return new NextResponse(EMPTY_PNG, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, s-maxage=86400, max-age=3600' },
      });
    }

    const readW = cR - cL;
    const readH = cB - cT;

    // 8) Leer pixels del overview a resolución nativa (SIN resampling en geotiff.js)
    const rasters = await bestImg.readRasters({
      window: [cL, cT, cR, cB],
      interleave: true,
    });

    const pixelCount = readW * readH;
    const raw = new Uint8Array((rasters as any).buffer ?? (rasters as unknown as ArrayBuffer));

    // 9) Pasar datos directo — geotiff.js ya maneja la conversión
    //    YCbCr→RGB internamente al decodificar los tiles JPEG.
    //    NO hacemos conversión manual (causa doble-conversión e
    //    inconsistencia de colores entre tiles).
    const channels: 3 | 4 = Math.min(bandCount, 4) as 3 | 4;
    const pixelData = Buffer.from(raw.buffer, raw.byteOffset, pixelCount * channels);

    // verbose=1 → diagnóstico
    if (verbose) {
      const sample = [];
      for (let i = 0; i < Math.min(5, pixelCount); i++) {
        const off = i * channels;
        sample.push({ r: pixelData[off], g: pixelData[off + 1], b: pixelData[off + 2] });
      }
      return NextResponse.json({
        step: '9-passthrough',
        mainSize: [mainW, mainH],
        overviewUsed: { w: bestW, h: bestH, scale: [scaleX, scaleY] },
        readWindow: [cL, cT, cR, cB],
        readSize: [readW, readH],
        bandCount, channels, photometric,
        colorFix: 'none (geotiff.js handles JPEG YCbCr internally)',
        sample,
      });
    }

    // 10) Crear PNG con sharp: leer a raw → resize a 256×256
    //     Calculamos qué porción del tile de 256×256 ocupa esta lectura
    const outX = Math.max(0, Math.round(TILE_SIZE * (cL / scaleX - fL) / fW));
    const outY = Math.max(0, Math.round(TILE_SIZE * (cT / scaleY - fT) / fH));
    const outW = Math.min(TILE_SIZE - outX, Math.max(1, Math.round(TILE_SIZE * readW / (fW * scaleX))));
    const outH = Math.min(TILE_SIZE - outY, Math.max(1, Math.round(TILE_SIZE * readH / (fH * scaleY))));

    // Resize los pixels leídos al tamaño de salida
    const resized = await sharp(pixelData, {
      raw: { width: readW, height: readH, channels },
    }).resize(outW, outH).ensureAlpha().png().toBuffer();

    let png: Buffer;
    if (outW === TILE_SIZE && outH === TILE_SIZE && outX === 0 && outY === 0) {
      png = resized;
    } else {
      png = await sharp({
        create: {
          width: TILE_SIZE, height: TILE_SIZE, channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: resized, left: outX, top: outY }])
        .png()
        .toBuffer();
    }

    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, s-maxage=86400, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error(`[tile error] year=${year} z=${z} x=${x} y=${y}:`, err.message, err.stack?.split('\n').slice(0, 3));
    if (verbose) {
      return NextResponse.json({
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 5),
        year, z, x, y,
      }, { status: 500 });
    }
    return new NextResponse(EMPTY_PNG, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    });
  }
}

