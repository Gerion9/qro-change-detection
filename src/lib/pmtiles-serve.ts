/**
 * src/lib/pmtiles-serve.ts
 * Sirve archivos PMTiles soportando HTTP Range requests.
 *
 * Patrón idéntico al de la otra app Blackprint:
 *   - El frontend pide `pmtiles:///api/pmtiles/landcover_2016`
 *   - La librería PMTiles hace Range requests automáticamente
 *   - Esta función lee el rango desde GCS y lo devuelve como 206 Partial Content
 */

import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getGcsClient, getGcsBucket, getGcsPrefix } from './gcs';

/* ---------- Tipos ---------- */

export type PmtilesSource = { bucket: string; object: string };

/* ---------- Caché de metadata (tamaño + etag) ---------- */

interface FileMeta {
  size: number;
  etag: string;
  fetchedAt: number;
}

const metaCache = new Map<string, FileMeta>();
const META_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function getFileMeta(source: PmtilesSource): Promise<FileMeta> {
  const key = `${source.bucket}/${source.object}`;
  const cached = metaCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < META_TTL_MS) return cached;

  const storage = getGcsClient();
  const [metadata] = await storage.bucket(source.bucket).file(source.object).getMetadata();

  const meta: FileMeta = {
    size: Number(metadata.size ?? 0),
    etag: String(metadata.etag ?? metadata.md5Hash ?? Date.now()),
    fetchedAt: Date.now(),
  };
  metaCache.set(key, meta);
  return meta;
}

/* ---------- Parse Range header ---------- */

function parseRange(header: string | null, fileSize: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (start >= fileSize || end >= fileSize || start > end) return null;
  return { start, end };
}

/* ---------- Función principal ---------- */

export async function servePmtilesRange(
  request: NextRequest,
  source: PmtilesSource,
): Promise<NextResponse> {
  try {
    const meta = await getFileMeta(source);
    const rangeHeader = request.headers.get('range');
    const range = parseRange(rangeHeader, meta.size);

    const commonHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'ETag': `"${meta.etag}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag',
    };

    // Sin Range → devolver metadata (HEAD-like) con el tamaño
    if (!range) {
      return new NextResponse(null, {
        status: 200,
        headers: {
          ...commonHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(meta.size),
        },
      });
    }

    // Con Range → leer el fragmento desde GCS
    const { start, end } = range;
    const storage = getGcsClient();
    const gcsStream = storage
      .bucket(source.bucket)
      .file(source.object)
      .createReadStream({ start, end: end + 1 }); // GCS end is exclusive

    // Convertir Node.js stream a Web ReadableStream
    const webStream = Readable.toWeb(gcsStream) as ReadableStream;

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${meta.size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  } catch (err: any) {
    console.error('[PMTiles] Error:', err.message);
    return NextResponse.json(
      { error: 'Error al leer PMTiles', detail: err.message },
      { status: 500 },
    );
  }
}

