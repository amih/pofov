// Imports every amenity=public_bookcase from OpenStreetMap (ODbL, © OpenStreetMap
// contributors). Safe to re-run: existing OSM rows are updated in place.
//   node scripts/seed-osm.js                # whole world
//   node scripts/seed-osm.js 29,34,34,36    # one bbox: south,west,north,east
import { pool } from '../src/db.js';
import { shortCode } from '../src/util.js';

// QLever (University of Freiburg) answers the whole planet in seconds; public Overpass
// servers often time out on large areas.
const QLEVER = 'https://qlever.dev/api/osm-planet';
const TAGS = ['name', 'name:en', 'description', 'operator', 'opening_hours', 'access', 'indoor'];

async function fetchBookcases() {
  const vars = TAGS.map((t, i) => `?t${i}`).join(' ');
  const optionals = TAGS.map((t, i) => `OPTIONAL { ?o <https://www.openstreetmap.org/wiki/Key:${t}> ?t${i} }`).join('\n');
  const query = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?o ?c ${vars} WHERE {
  ?o <https://www.openstreetmap.org/wiki/Key:amenity> "public_bookcase" .
  ?o geo:hasGeometry/geo:asWKT ?g . BIND (geof:centroid(?g) AS ?c)
  ${optionals}
}`;
  const res = await fetch(QLEVER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': 'POFOV seed (https://pofov.com)' },
    body: 'query=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`QLever ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const byId = new Map(); // OPTIONAL tags with several values repeat a row
  for (const r of (await res.json()).results.bindings) {
    const [, type, id] = r.o.value.match(/\/(node|way|relation)\/(\d+)$/) ?? [];
    const pt = r.c?.value.match(/POINT\(([-\d.eE]+) ([-\d.eE]+)\)/);
    if (!type || !pt || byId.has(r.o.value)) continue;
    const tags = {};
    TAGS.forEach((t, i) => { if (r[`t${i}`]) tags[t] = r[`t${i}`].value; });
    byId.set(r.o.value, { type, id: Number(id), lon: Number(pt[1]), lat: Number(pt[2]), tags });
  }
  return [...byId.values()];
}

async function upsert(elements) {
  let n = 0;
  for (const el of elements) {
    const { lat, lon } = el;
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

const bbox = process.argv[2]?.split(',').map(Number); // south,west,north,east
let elements = await fetchBookcases();
if (bbox) elements = elements.filter((e) => e.lat >= bbox[0] && e.lon >= bbox[1] && e.lat <= bbox[2] && e.lon <= bbox[3]);
console.log(`fetched ${elements.length}`);
console.log(`upserted ${await upsert(elements)}`);
await pool.end();
