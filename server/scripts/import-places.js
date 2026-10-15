// Loads GeoNames cities1000 (every town with 1000+ people; CC BY 4.0, geonames.org)
// into `places`, then assigns each library to its nearest town. Safe to re-run.
//   node scripts/import-places.js [DATA_DIR]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pool, tx } from '../src/db.js';

const DUMP = 'https://download.geonames.org/export/dump/';
const dir = process.argv[2] || join(process.env.HOME, 'seferehov-data', 'geonames');
mkdirSync(dir, { recursive: true });

async function download(name) {
  const file = join(dir, name);
  if (!existsSync(file)) {
    const res = await fetch(DUMP + name, { headers: { 'User-Agent': 'Seferehov (https://seferehov.com)' } });
    if (!res.ok) throw new Error(`GeoNames ${name}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

const text = execFileSync('unzip', ['-p', await download('cities1000.zip'), 'cities1000.txt'], { maxBuffer: 1 << 30 }).toString('utf8');

// Hebrew names: GeoNames lists several per place (e.g. Jerusalem also has "Aelia Capitolina"),
// so prefer the preferred/short ones and never a historic or colloquial one.
const HEBREW_SCRIPT = /^[\u200E\u200F]?[\u0590-\u05FF]/;
const hebrew = new Map(); // geonameid -> [score, name]
const alt = spawn('unzip', ['-p', await download('alternateNamesV2.zip'), 'alternateNamesV2.txt']);
for await (const line of createInterface({ input: alt.stdout })) {
  // id, geonameid, isolanguage, name, isPreferredName, isShortName, isColloquial, isHistoric, from, to
  const f = line.split('\t');
  if (f[2] !== 'he' || f[6] === '1' || f[7] === '1' || !HEBREW_SCRIPT.test(f[3])) continue;
  const score = (f[4] === '1' ? 2 : 0) + (f[5] === '1' ? 1 : 0);
  const prev = hebrew.get(f[1]);
  if (!prev || score > prev[0]) hebrew.set(f[1], [score, f[3]]);
}

const NIQQUD = /[\u0591-\u05C7\u200E\u200F]/g; // vowel points + direction marks
// Neighbourhoods and historical/abandoned places: a library there belongs to the city around it.
const SKIP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
const slugify = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';

const rows = [];
for (const line of text.split('\n')) {
  if (!line) continue;
  // geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, country, cc2, admin1-4, population, ...
  const f = line.split('\t');
  if (SKIP.has(f[7])) continue;
  const he = hebrew.get(f[0])?.[1] ?? f[3]?.split(',').find((n) => HEBREW_SCRIPT.test(n));
  rows.push([Number(f[0]), f[1], he ? he.replace(NIQQUD, '').trim() : null, slugify(f[2] || f[1]), f[8], Number(f[14]) || 0, Number(f[5]), Number(f[4])]);
}

await tx(async (c) => {
  await c.query('CREATE TEMP TABLE p_in (LIKE places) ON COMMIT DROP');
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const vals = chunk.map((_, j) => `($${j * 8 + 1},$${j * 8 + 2},$${j * 8 + 3},$${j * 8 + 4},$${j * 8 + 5},$${j * 8 + 6},ST_MakePoint($${j * 8 + 7},$${j * 8 + 8})::geography)`);
    await c.query(`INSERT INTO p_in (id, name, name_he, slug, country, population, geom) VALUES ${vals.join(',')}`, chunk.flat());
  }
  await c.query('UPDATE locations SET place_id = NULL WHERE place_id IS NOT NULL AND place_id NOT IN (SELECT id FROM p_in)');
  await c.query('DELETE FROM places WHERE id NOT IN (SELECT id FROM p_in)');
  await c.query(`INSERT INTO places SELECT * FROM p_in
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, name_he = EXCLUDED.name_he, slug = EXCLUDED.slug,
      country = EXCLUDED.country, population = EXCLUDED.population, geom = EXCLUDED.geom`);
});
console.log('places', rows.length);

const { rowCount } = await pool.query('UPDATE locations SET place_id = nearest_place(geom)');
const { n } = (await pool.query('SELECT count(*)::int AS n FROM locations WHERE place_id IS NULL')).rows[0];
console.log('libraries assigned', rowCount, 'without a town', n);
await pool.end();
