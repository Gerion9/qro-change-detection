/**
 * src/lib/gcs.ts
 * Google Cloud Storage client wrapper for Next.js (node runtime).
 *
 * Soporta credenciales via:
 *   1. BQ_SERVICE_ACCOUNT_JSON  (JSON crudo en env var — recomendado para Vercel)
 *   2. GOOGLE_APPLICATION_CREDENTIALS (ruta a archivo JSON — para dev local)
 *   3. ADC (Application Default Credentials) como fallback
 *
 * Patrón: singleton global para reutilizar conexión entre invocaciones.
 */

import { Storage, type StorageOptions } from '@google-cloud/storage';

/* ---------- Singleton global (sobrevive entre invocaciones en Vercel) ------ */

declare global {
  // eslint-disable-next-line no-var
  var __gcsClient: Storage | undefined;
}

function buildStorageOptions(): StorageOptions {
  // 1. JSON crudo en env var (Vercel)
  const raw = process.env.BQ_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    try {
      const credentials = JSON.parse(raw);
      console.log('[GCS] Usando credenciales de BQ_SERVICE_ACCOUNT_JSON');
      return { credentials };
    } catch {
      console.warn('[GCS] BQ_SERVICE_ACCOUNT_JSON no es JSON válido, ignorando');
    }
  }

  // 2. Ruta a archivo
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFile) {
    console.log('[GCS] Usando GOOGLE_APPLICATION_CREDENTIALS:', keyFile);
    return { keyFilename: keyFile };
  }

  // 3. ADC fallback
  console.log('[GCS] Usando Application Default Credentials');
  return {};
}

export function getGcsClient(): Storage {
  if (globalThis.__gcsClient) return globalThis.__gcsClient;
  const opts = buildStorageOptions();
  globalThis.__gcsClient = new Storage(opts);
  return globalThis.__gcsClient;
}

/** Helper: nombre del bucket desde env */
export function getGcsBucket(): string {
  const b = (process.env.GCS_BUCKET ?? '').trim();
  if (!b) throw new Error('Falta la variable de entorno GCS_BUCKET');
  return b;
}

/** Helper: prefijo dentro del bucket */
export function getGcsPrefix(): string {
  return (process.env.GCS_PREFIX ?? 'TO_GOOGLE_CLOUD').trim();
}

