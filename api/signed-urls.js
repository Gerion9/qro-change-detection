/**
 * /api/signed-urls — Genera URLs firmadas temporales para acceder al bucket privado.
 *
 * El browser llama a este endpoint UNA vez al cargar la página.
 * Recibe URLs firmadas (válidas 1 hora) para todos los archivos del mapa.
 * Así el bucket se queda privado y solo tu app puede acceder.
 *
 * Variables de entorno requeridas (en Vercel Dashboard):
 *   GCS_BUCKET                → nombre del bucket
 *   GCS_SERVICE_ACCOUNT_JSON  → contenido completo del JSON de service account
 */

const { Storage } = require('@google-cloud/storage');

// Archivos permitidos (whitelist de seguridad)
// Prefijo = la carpeta raíz dentro del bucket
const GCS_PREFIX = 'TO_GOOGLE_CLOUD';

const ALLOWED_FILES = [
  'vector/pmtiles/landcover_2016.pmtiles',
  'vector/pmtiles/landcover_2024.pmtiles',
  'vector/pmtiles/landcover_change.pmtiles',
  'vector/pmtiles/single_tree_2016.pmtiles',
  'vector/pmtiles/single_tree_2024.pmtiles',
  'vector/pmtiles/single_tree_change.pmtiles',
  'raster/satellite_2017_cog.tif',
  'raster/satellite_2024_cog.tif'
];

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const bucket = process.env.GCS_BUCKET;
    const credentials = JSON.parse(process.env.GCS_SERVICE_ACCOUNT_JSON);

    if (!bucket || !credentials) {
      return res.status(500).json({ error: 'Missing GCS_BUCKET or GCS_SERVICE_ACCOUNT_JSON env vars' });
    }

    const storage = new Storage({ credentials });
    const expiry = Date.now() + 60 * 60 * 1000; // 1 hora

    // Generar todas las URLs en paralelo
    const entries = await Promise.all(
      ALLOWED_FILES.map(async (file) => {
        const [url] = await storage.bucket(bucket).file(`${GCS_PREFIX}/${file}`).getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: expiry
        });
        return [file, url];
      })
    );

    const urls = Object.fromEntries(entries);

    // Cache por 50 minutos (las URLs valen 60 min)
    res.setHeader('Cache-Control', 'private, max-age=3000');
    return res.status(200).json(urls);

  } catch (err) {
    console.error('Error generating signed URLs:', err.message);
    return res.status(500).json({ error: 'Failed to generate signed URLs' });
  }
};

