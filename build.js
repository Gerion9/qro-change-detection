/**
 * build.js — Inyecta variables de entorno en index.html durante el deploy.
 *
 * Vercel ejecuta este script automáticamente antes de servir el sitio.
 * Las variables se configuran en el Dashboard de Vercel:
 *   Settings → Environment Variables
 *
 * Variables requeridas:
 *   GCS_BUCKET   → nombre del bucket en Google Cloud Storage
 *   TITILER_URL  → URL del servicio TiTiler en Cloud Run
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');

const GCS_BUCKET = process.env.GCS_BUCKET || 'TU_BUCKET_AQUI';
const TITILER_URL = process.env.TITILER_URL || 'TU_TITILER_URL_AQUI';

html = html.replace("'TU_BUCKET_AQUI'", `'${GCS_BUCKET}'`);
html = html.replace("'TU_TITILER_URL_AQUI'", `'${TITILER_URL}'`);

fs.writeFileSync(htmlPath, html, 'utf-8');

console.log(`✅ Build completo:`);
console.log(`   GCS_BUCKET  = ${GCS_BUCKET}`);
console.log(`   TITILER_URL = ${TITILER_URL}`);

