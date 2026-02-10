/**
 * build.js — Inyecta TITILER_URL en index.html durante el build de Vercel.
 *
 * Se ejecuta automáticamente con `npm run build`.
 * La variable se configura en Vercel Dashboard → Settings → Environment Variables.
 *
 * Variables requeridas en Vercel env vars:
 *   TITILER_URL              → URL del servicio TiTiler en Cloud Run
 *   GCS_BUCKET               → nombre del bucket (usado por api/signed-urls.js)
 *   GCS_SERVICE_ACCOUNT_JSON → JSON del service account (usado por api/signed-urls.js)
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');

const TITILER_URL = process.env.TITILER_URL || 'TU_TITILER_URL_AQUI';

html = html.replace("'TU_TITILER_URL_AQUI'", `'${TITILER_URL}'`);

fs.writeFileSync(htmlPath, html, 'utf-8');

console.log(`✅ Build completo:`);
console.log(`   TITILER_URL = ${TITILER_URL}`);
