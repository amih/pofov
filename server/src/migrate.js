import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pool, tx } from './db.js';

const dir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(name)) continue;
  const sql = await readFile(join(dir, name), 'utf8');
  await tx(async (c) => {
    await c.query(sql);
    await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
  });
  console.log('applied', name);
}
await pool.end();
