// Cuts out and straightens cover photos taken before cropping existed (or that failed).
// node --env-file=../.env scripts/crop-covers.js
import { many, pool } from '../src/db.js';
import { cropPhoto } from '../src/covers.js';

const rows = await many(`SELECT DISTINCT ON (path) id, path FROM photos WHERE kind IN ('cover', 'back') AND cropped_at IS NULL ORDER BY path, created_at`);
for (const r of rows) {
  const t0 = Date.now();
  const done = await cropPhoto(r.id).catch((err) => { console.log(r.path, 'error', err.message); return false; });
  console.log(r.path, done ? 'cropped' : 'left as is', `${Date.now() - t0} ms`);
}
await pool.end();
