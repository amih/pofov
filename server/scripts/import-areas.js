// Loads town boundaries (OpenStreetMap admin_level 8) of a country from QLever into
// place_areas, links each to its GeoNames town, and re-assigns that country's
// libraries to their towns. Safe to re-run.
//   node --env-file=../.env scripts/import-areas.js [COUNTRY_CODE=IL] [OSM_RELATION=1473946]
import { pool, tx } from '../src/db.js';

const QLEVER = 'https://qlever.dev/api/osm-planet';
const [country = 'IL', relation = '1473946'] = process.argv.slice(2);

const query = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX osmrel: <https://www.openstreetmap.org/relation/>
PREFIX ogc: <http://www.opengis.net/rdf#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?r ?name ?he ?en ?wkt WHERE {
  osmrel:${relation} ogc:sfContains ?r .
  ?r osmkey:boundary "administrative" ; osmkey:admin_level ?lvl ; osmkey:name ?name ; geo:hasGeometry/geo:asWKT ?wkt .
  FILTER(str(?lvl) = "8")
  OPTIONAL { ?r osmkey:name:he ?he } OPTIONAL { ?r osmkey:name:en ?en }
}`;
const res = await fetch(QLEVER, {
  method: 'POST',
  headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Seferehov (https://seferehov.com)' },
  body: new URLSearchParams({ query }),
  signal: AbortSignal.timeout(300_000),
});
if (!res.ok) throw new Error(`QLever ${res.status}`);
const rows = (await res.json()).results.bindings;
console.log(`${rows.length} boundaries`);

const isRegional = (r) => /מועצה אזורית|regional council|مجلس إقليمي/i.test(`${r.name?.value} ${r.he?.value} ${r.en?.value}`);
await tx(async (db) => {
  await db.query('DELETE FROM place_areas WHERE country = $1', [country]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO place_areas(id, name, name_he, name_en, country, regional, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText($7, 4326)), 3)))
       ON CONFLICT (id) DO NOTHING`,
      [Number(r.r.value.split('/').pop()), r.name.value, r.he?.value ?? null, r.en?.value ?? null, country, isRegional(r), r.wkt.value],
    );
  }
  // The town a boundary belongs to: same name inside it, else the biggest town inside it.
  await db.query(
    `UPDATE place_areas a SET place_id = x.place_id FROM (
       SELECT DISTINCT ON (a.id) a.id, p.id AS place_id
         FROM place_areas a JOIN places p ON ST_Covers(a.geom, p.geom::geometry)
        WHERE a.country = $1
        ORDER BY a.id, (p.name_he = a.name_he OR p.name = a.name_en) DESC NULLS LAST, p.population DESC) x
      WHERE a.id = x.id`, [country]);
  const { rowCount } = await db.query(
    `UPDATE locations l SET place_id = a.place_id FROM place_areas a
      WHERE a.country = $1 AND NOT a.regional AND a.place_id IS NOT NULL AND ST_Covers(a.geom, l.geom::geometry)
        AND l.place_id IS DISTINCT FROM a.place_id`, [country]);
  console.log(`${rowCount} libraries moved to the town whose boundary holds them`);
});
const unlinked = await pool.query(`SELECT count(*)::int AS n FROM place_areas WHERE country = $1 AND place_id IS NULL AND NOT regional`, [country]);
console.log(`${unlinked.rows[0].n} town boundaries with no GeoNames town inside`);
await pool.end();
