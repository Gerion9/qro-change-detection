/**
 * /api/pmtiles/[layer]
 *
 * Proxy de PMTiles desde GCS privado.
 * Soporta HTTP Range requests (obligatorio para el protocolo PMTiles).
 *
 * Capas disponibles:
 *   /api/pmtiles/landcover_2016
 *   /api/pmtiles/landcover_2024
 *   /api/pmtiles/landcover_change
 *   /api/pmtiles/single_tree_2016
 *   /api/pmtiles/single_tree_2024
 *   /api/pmtiles/single_tree_change
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { servePmtilesRange, type PmtilesSource } from '@/lib/pmtiles-serve';
import { getGcsBucket, getGcsPrefix } from '@/lib/gcs';

export const runtime = 'nodejs';

// Whitelist de capas permitidas → ruta dentro del bucket
const ALLOWED_LAYERS: Record<string, string> = {
  landcover_2016:    'vector/pmtiles/landcover_2016.pmtiles',
  landcover_2024:    'vector/pmtiles/landcover_2024.pmtiles',
  landcover_change:  'vector/pmtiles/landcover_change.pmtiles',
  single_tree_2016:  'vector/pmtiles/single_tree_2016.pmtiles',
  single_tree_2024:  'vector/pmtiles/single_tree_2024.pmtiles',
  single_tree_change:'vector/pmtiles/single_tree_change.pmtiles',
};

export async function GET(
  request: NextRequest,
  { params }: { params: { layer: string } },
) {
  const layer = params.layer;
  const objectPath = ALLOWED_LAYERS[layer];

  if (!objectPath) {
    return NextResponse.json(
      { error: `Capa desconocida: ${layer}`, available: Object.keys(ALLOWED_LAYERS) },
      { status: 404 },
    );
  }

  const bucket = getGcsBucket();
  const prefix = getGcsPrefix();
  const source: PmtilesSource = { bucket, object: `${prefix}/${objectPath}` };

  return servePmtilesRange(request, source);
}

