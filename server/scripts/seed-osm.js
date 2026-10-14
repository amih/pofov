// Imports every amenity=public_bookcase from OpenStreetMap (ODbL, © OpenStreetMap
// contributors). Safe to re-run: existing OSM rows are updated in place.
//   node scripts/seed-osm.js                # whole world, in tiles
//   node scripts/seed-osm.js 29,34,34,36    # one bbox: south,west,north,east
import { pool } from '../src/db.js';
import { shortCode } from '../src/util.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(bbox) {
  const query = `[out:json][timeout:300];nwr["amenity"="public_bookcase"](${bbox});out center tags;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'POFOV seed (https://pofov.com)' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(330_000),
      });
      if (res.ok) return (await res.json()).elements;
      console.log(`  ${new URL(url).host} ${res.status}, retrying`);
    } catch (err) {
      console.log(`  ${new URL(url).host} ${err.message}, retrying`);
    }
    await sleep(15000 * (attempt + 1));
  }
  throw new Error(`Overpass failed for ${bbox}`);
}

async function upsert(elements) {
  let n = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const t = el.tags ?? {};
    const name = t.name || t['name:en'] || null;
    const description = [t.description, t.operator && `Operator: ${t.operator}`, t.opening_hours && `Hours: ${t.opening_hours}`]
      .filter(Boolean).join('\n') || null;
    const restricted = t.access === 'private' || t.access === 'customers' || t.indoor === 'yes';
    await pool.query(
      `INSERT INTO locations(code, name, description, geom, source, osm_type, osm_id, status, restricted)
       VALUES ($1, $2, $3, ST_MakePoint($4, $5)::geography, 'osm', $6, $7, 'approved', $8)
       ON CONFLICT (osm_type, osm_id) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, geom = EXCLUDED.geom, restricted = EXCLUDED.restricted`,
      [shortCode(), name, description, lon, lat, el.type, el.id, restricted],
    );
    n++;
  }
  return n;
}

// Most bookcases are in Europe, so tiles are small enough there to keep each query light.
function worldTiles() {
  const tiles = [];
  for (let s = -60; s < 80; s += 10) {
    for (let w = -180; w < 180; w += 20) tiles.push(`${s},${w},${s + 10},${w + 20}`);
  }
  return tiles;
}

const tiles = process.argv[2] ? [process.argv[2]] : worldTiles();
let total = 0;
for (const [i, bbox] of tiles.entries()) {
  const elements = await overpass(bbox);
  total += await upsert(elements);
  console.log(`[${i + 1}/${tiles.length}] ${bbox}: ${elements.length}`);
  if (tiles.length > 1) await sleep(2000);
}
console.log(`upserted ${total}`);
await pool.end();
