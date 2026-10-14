// Imports every amenity=public_bookcase from OpenStreetMap (ODbL, © OpenStreetMap
// contributors). Safe to re-run: existing OSM rows are updated in place.
//   node scripts/seed-osm.js            # whole world
//   node scripts/seed-osm.js 29,34,34,36  # bbox south,west,north,east
import { pool } from '../src/db.js';
import { shortCode } from '../src/util.js';

const bbox = process.argv[2];
const query = `[out:json][timeout:600];
nwr["amenity"="public_bookcase"]${bbox ? `(${bbox})` : ''};
out center tags;`;

console.log('querying Overpass…');
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'POFOV seed (https://pofov.com)' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
const { elements } = await res.json();
console.log(`${elements.length} bookcases`);

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
  if (++n % 2000 === 0) console.log(n);
}
console.log(`upserted ${n}`);
await pool.end();
