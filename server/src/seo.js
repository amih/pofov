// Pages for search engines. Every app URL gets index.html with its own <title>, meta,
// canonical/hreflang, JSON-LD and readable HTML inside <main>; the app replaces that HTML
// when it starts. Rendered from the live database on each request (60 s cache), so new
// libraries and book reports show up right away.
//   /             home: what Seferehov is + towns in Israel + countries
//   /places       countries
//   /c/:cc        towns in one country
//   /p/:id-:slug  one town: its libraries and the books on them
//   /l/:code      one library
// Also /robots.txt and /sitemap.xml (+ /sitemaps/*.xml).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { one, many } from './db.js';
import { escapeHtml as esc } from './util.js';
import { PRESENT_BOOKS_SQL, TAKEN_BOOKS_SQL } from './locations.js';
import { translate } from '../../web/src/i18n.js';

const LANGS = ['he', 'en'];
const SITEMAP_CHUNK = 40000;
const CACHE_MS = 60_000;

// ---- index.html from the web build, re-read after a deploy
let shell = { mtime: 0, html: '' };
function indexHtml() {
  const file = join(config.webDist, 'index.html');
  const { mtimeMs } = statSync(file);
  if (mtimeMs !== shell.mtime) shell = { mtime: mtimeMs, html: readFileSync(file, 'utf8') };
  return shell.html;
}

const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

const countryName = (cc, lng) => {
  try { return new Intl.DisplayNames([lng], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
};
const placeName = (p, lng) => (lng === 'he' && p.name_he) || p.name;
const placePath = (p) => `/p/${p.id}-${p.slug}`;
const withLang = (path, lng) => (lng === 'he' ? path : `${path}?lang=en`);
const fmtDate = (d, lng) => new Date(d).toLocaleDateString(lng === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// Latest report per (library, book); a book is "on the shelf" if that report is seen/added.
const PRESENT_CTE = `present AS (
  SELECT * FROM (
    SELECT DISTINCT ON (s.location_id, s.book_id) s.location_id, s.book_id, s.kind, s.created_at
      FROM sightings s
     WHERE s.status = 'approved' AND s.location_id = ANY($1)
     ORDER BY s.location_id, s.book_id, s.created_at DESC) x
   WHERE kind IN ('seen', 'added'))`;

function libList(libs, T, lng) {
  return `<ul>${libs.map((l) => `<li><a href="${withLang(`/l/${l.code}`, lng)}">${esc(l.name || T('free_library'))}</a>${
    l.books ? ` — ${T('seo.n_books', { n: l.books })}` : ''}</li>`).join('')}</ul>`;
}
function bookList(books) {
  return `<ul>${books.map((b) => `<li>${b.code ? `<a href="/l/${b.code}">` : ''}<strong>${esc(b.title)}</strong>${b.code ? '</a>' : ''}${
    b.authors?.length ? ` — ${esc(b.authors.join(', '))}` : ''}${b.year ? ` (${b.year})` : ''}</li>`).join('')}</ul>`;
}
function placeLinks(places, T, lng) {
  return `<ul class="place-links">${places.map((p) => `<li><a href="${withLang(placePath(p), lng)}">${esc(placeName(p, lng))}</a> (${T('seo.n_libs', { n: p.n })})</li>`).join('')}</ul>`;
}
const breadcrumbs = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: config.baseUrl + path })),
});

// ---- page renderers: each returns { title, description, html, jsonld } or null (404)

async function homePage(lng, T) {
  const il = await many(
    `SELECT p.id, p.slug, p.name, p.name_he, count(*)::int AS n
       FROM locations l JOIN places p ON p.id = l.place_id
      WHERE l.status = 'approved' AND p.country = 'IL'
      GROUP BY p.id ORDER BY n DESC, p.population DESC`);
  const countries = await countryCounts();
  return {
    title: T('seo.home_title'),
    description: T('seo.home_desc'),
    html: `<h1>${T('seo.home_h1')}</h1><p>${T('seo.home_lead')}</p>
      <p>${T('shelves.note_html')}</p>
      <h2>${T('seo.israel')}</h2>${placeLinks(il, T, lng)}
      <h2>${T('seo.world')}</h2>${countryLinks(countries.slice(0, 30), T, lng)}
      <p><a href="${withLang('/places', lng)}">${T('seo.all_countries')}</a></p>`,
    jsonld: [{
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: T('app.name'),
      alternateName: ['ספרחוב', 'Seferehov', 'ספר רחוב'],
      url: config.baseUrl + '/',
      inLanguage: lng,
      description: T('seo.home_desc'),
      publisher: { '@type': 'Person', name: 'Ami Heines', email: 'ami@seferehov.com' },
    }],
  };
}

function countryCounts() {
  return cached('countries', () => many(
    `SELECT p.country AS cc, count(*)::int AS n, count(DISTINCT p.id)::int AS places
       FROM locations l JOIN places p ON p.id = l.place_id
      WHERE l.status = 'approved' GROUP BY p.country ORDER BY n DESC`));
}
function countryLinks(rows, T, lng) {
  return `<ul class="place-links">${rows.map((c) => `<li><a href="${withLang(`/c/${c.cc.toLowerCase()}`, lng)}">${esc(countryName(c.cc, lng))}</a> (${T('seo.n_libs', { n: c.n })})</li>`).join('')}</ul>`;
}

async function placesPage(lng, T) {
  const rows = await countryCounts();
  const n = rows.reduce((a, c) => a + c.n, 0);
  return {
    title: T('seo.places_title'),
    description: T('seo.places_lead', { n, countries: rows.length }),
    html: `<h1>${T('seo.places_h1')}</h1><p>${T('seo.places_lead', { n, countries: rows.length })}</p>${countryLinks(rows, T, lng)}`,
    jsonld: [breadcrumbs([[T('app.name'), '/'], [T('seo.places_h1'), '/places']])],
  };
}

async function countryPage(lng, T, cc) {
  cc = cc.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  const rows = await many(
    `SELECT p.id, p.slug, p.name, p.name_he, count(*)::int AS n
       FROM locations l JOIN places p ON p.id = l.place_id
      WHERE l.status = 'approved' AND p.country = $1
      GROUP BY p.id ORDER BY n DESC, p.population DESC LIMIT 2000`, [cc]);
  if (!rows.length) return null;
  const country = countryName(cc, lng);
  const inCountry = T('seo.in', country);
  const n = rows.reduce((a, p) => a + p.n, 0);
  return {
    title: T('seo.country_title', { inCountry }),
    description: T('seo.country_lead', { n, places: rows.length, inCountry }),
    html: `<h1>${T('seo.country_h1', { inCountry })}</h1><p>${T('seo.country_lead', { n, places: rows.length, inCountry })}</p>${placeLinks(rows, T, lng)}`,
    jsonld: [breadcrumbs([[T('app.name'), '/'], [T('seo.places_h1'), '/places'], [country, `/c/${cc.toLowerCase()}`]])],
  };
}

async function placePage(lng, T, id) {
  const p = await one('SELECT *, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon FROM places WHERE id = $1', [id]);
  if (!p) return null;
  const libs = await many(
    `SELECT l.id, l.code, l.name, l.created_at,
            (SELECT max(s.created_at) FROM sightings s WHERE s.location_id = l.id AND s.status = 'approved') AS last_report
       FROM locations l WHERE l.place_id = $1 AND l.status = 'approved'
      ORDER BY l.name NULLS LAST, l.id LIMIT 500`, [id]);
  if (!libs.length) return null;
  const ids = libs.map((l) => l.id);
  const books = await many(
    `WITH ${PRESENT_CTE}
     SELECT b.title, b.authors, b.year, l.code, pr.location_id
       FROM present pr JOIN books b ON b.id = pr.book_id JOIN locations l ON l.id = pr.location_id
      ORDER BY pr.created_at DESC LIMIT 300`, [ids]);
  const perLib = new Map();
  for (const b of books) perLib.set(b.location_id, (perLib.get(b.location_id) ?? 0) + 1);
  for (const l of libs) l.books = perLib.get(l.id) ?? 0;
  libs.sort((a, b) => b.books - a.books);
  const nearby = await many(
    `SELECT p.id, p.slug, p.name, p.name_he, count(*)::int AS n
       FROM places p JOIN locations l ON l.place_id = p.id AND l.status = 'approved'
      WHERE p.id <> $1 AND ST_DWithin(p.geom, ST_MakePoint($2, $3)::geography, 40000)
      GROUP BY p.id ORDER BY min(p.geom::geometry <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)) LIMIT 12`, [id, p.lon, p.lat]);
  const name = placeName(p, lng);
  const inPlace = T('seo.in', name);
  const country = countryName(p.country, lng);
  const updated = [...libs.map((l) => l.last_report ?? l.created_at)].sort().pop();
  return {
    title: T('seo.place_title', { inPlace }),
    description: T('seo.place_desc', { n: libs.length, inPlace }),
    lastmod: updated,
    html: `<h1>${T('seo.place_h1', { inPlace })}</h1>
      <p>${T('seo.place_lead', { n: libs.length, books: books.length, inPlace })}</p>
      <p class="muted small">${T('seo.updated', { date: fmtDate(updated, lng) })} · <a href="${withLang(`/c/${p.country.toLowerCase()}`, lng)}">${esc(country)}</a> ·
        <a href="/?at=${p.lat.toFixed(4)},${p.lon.toFixed(4)},14">${T('seo.open_map')}</a></p>
      <h2>${T('seo.libraries')}</h2>${libList(libs, T, lng)}
      ${books.length ? `<h2>${T('seo.books_now', { inPlace })}</h2>${bookList(books)}` : ''}
      ${nearby.length ? `<h2>${T('seo.nearby')}</h2>${placeLinks(nearby, T, lng)}` : ''}
      <hr><p class="small">${T('shelves.note_html')}</p>`,
    jsonld: [
      breadcrumbs([[T('app.name'), '/'], [country, `/c/${p.country.toLowerCase()}`], [name, placePath(p)]]),
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: T('seo.place_h1', { inPlace }),
        itemListElement: libs.slice(0, 100).map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.baseUrl}/l/${l.code}`, name: l.name || T('free_library') })),
      },
    ],
  };
}

async function libraryPage(lng, T, code) {
  const l = await one(
    `SELECT l.*, ST_Y(l.geom::geometry) AS lat, ST_X(l.geom::geometry) AS lon,
            p.id AS pid, p.slug AS pslug, p.name AS pname, p.name_he AS pname_he, p.country
       FROM locations l LEFT JOIN places p ON p.id = l.place_id
      WHERE l.code = $1 AND l.status = 'approved'`, [code.toUpperCase()]);
  if (!l) return null;
  const books = await many(PRESENT_BOOKS_SQL, [l.id]);
  const taken = await many(TAKEN_BOOKS_SQL, [l.id]);
  const nearby = await many(
    `SELECT l2.code, l2.name, 0 AS books FROM locations l2
      WHERE l2.status = 'approved' AND l2.id <> $1 AND ST_DWithin(l2.geom, $2::geography, 5000)
      ORDER BY l2.geom::geometry <-> $2::geometry LIMIT 8`, [l.id, l.geom]);
  const place = l.pid ? { id: l.pid, slug: l.pslug, name: l.pname, name_he: l.pname_he } : null;
  const pName = place ? placeName(place, lng) : null;
  const inPlace = pName ? T('seo.in', pName) : '';
  const country = l.country ? countryName(l.country, lng) : '';
  // Unnamed (most OpenStreetMap shelves): "Street library in <town>", plus the code so titles differ.
  const name = l.name || (inPlace ? T('seo.unnamed', { inPlace }) : T('free_library'));
  const updated = books[0]?.last_seen ?? l.last_checked_at ?? l.created_at;
  return {
    title: l.name ? T('seo.lib_title', { name, inPlace }) : `${name} · ${l.code} | ${T('app.name')}`,
    description: T('seo.lib_desc', { inPlace, books: books.length }),
    lastmod: updated,
    html: `<h1>${esc(name)}</h1>
      <p>${T('seo.lib_lead', { inPlace, country: esc(country) })}</p>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      <p class="muted small">${T('seo.updated', { date: fmtDate(updated, lng) })}${place ? ` · <a href="${withLang(placePath(place), lng)}">${esc(T('seo.place_h1', { inPlace }))}</a>` : ''}
        · <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${l.lat},${l.lon}">${T('loc.directions')}</a></p>
      <h2>${T('loc.shelf')} (${books.length})</h2>
      ${books.length ? bookList(books) : `<p>${T('loc.no_books')}</p>`}
      ${taken.length ? `<h2>${T('loc.taken_title')} (${taken.length})</h2>${bookList(taken)}` : ''}
      ${nearby.length ? `<h2>${T('seo.nearby_libs')}</h2>${libList(nearby, T, lng)}` : ''}
      <hr><p class="small">${T('shelves.note_html')}</p>`,
    jsonld: [
      ...(place ? [breadcrumbs([[T('app.name'), '/'], [country, `/c/${l.country.toLowerCase()}`], [pName, placePath(place)], [name, `/l/${l.code}`]])] : []),
      {
        '@context': 'https://schema.org',
        '@type': 'Place',
        name,
        description: T('seo.lib_lead', { inPlace, country }),
        url: `${config.baseUrl}/l/${l.code}`,
        geo: { '@type': 'GeoCoordinates', latitude: l.lat, longitude: l.lon },
        ...(place ? { containedInPlace: { '@type': 'City', name: pName, url: config.baseUrl + placePath(place) } } : {}),
        isAccessibleForFree: true,
        publicAccess: true,
      },
    ],
  };
}

function aboutPage(lng, T) {
  return {
    title: `${T('about.title')} | ${T('app.name')}`,
    description: T('seo.home_desc'),
    html: `<h1>${T('about.title')}</h1><p>${T('about.lead_html')}</p>
      <h2>${T('shelves.title')}</h2><p>${T('shelves.note_html')}</p>
      <h2>${T('how.title')}</h2><p>${T('how.body_html')}</p>
      <h2>${T('who.title')}</h2><p>${T('who.body')}</p>
      <p>${T('contact.body')} <a href="mailto:ami@seferehov.com">ami@seferehov.com</a></p>
      <p><a href="${withLang('/places', lng)}">${T('seo.places_h1')}</a></p>
      <p class="small">${T('who.footnote')}</p>`,
    jsonld: [breadcrumbs([[T('app.name'), '/'], [T('about.title'), '/about']])],
  };
}

async function renderPath(path, lng) {
  const T = (key, vars) => translate(lng, key, vars);
  let m;
  if (path === '/') return homePage(lng, T);
  if (path === '/about') return aboutPage(lng, T);
  if (path === '/places') return placesPage(lng, T);
  if ((m = path.match(/^\/c\/([a-z]{2})$/i))) return countryPage(lng, T, m[1]);
  if ((m = path.match(/^\/p\/(\d+)(?:-[a-z0-9-]*)?$/))) return placePage(lng, T, Number(m[1]));
  if ((m = path.match(/^\/l\/([A-Za-z0-9]{4,10})$/))) return libraryPage(lng, T, m[1]);
  return undefined; // not a page we render: plain app shell
}

function headTags(path, lng, page) {
  const url = (l) => config.baseUrl + withLang(path, l);
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  return [
    `<link rel="canonical" href="${esc(url(lng))}">`,
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(url(l))}">`),
    `<link rel="alternate" hreflang="x-default" href="${esc(url('he'))}">`,
    `<meta property="og:url" content="${esc(url(lng))}">`,
    ...(page.jsonld ?? []).map((o) => `<script type="application/ld+json">${json(o)}</script>`),
  ].join('\n  ');
}

function inject(html, path, lng, page) {
  const replaceMeta = (h, attr, name, value) =>
    h.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(">)`), `$1${esc(value)}$2`);
  let out = html
    .replace(/<html lang="he" dir="rtl">/, `<html lang="${lng}" dir="${lng === 'he' ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`);
  out = replaceMeta(out, 'name', 'description', page.description);
  out = replaceMeta(out, 'property', 'og:title', page.title);
  out = replaceMeta(out, 'property', 'og:description', page.description);
  out = out.replace('</head>', `  ${headTags(path, lng, page)}\n</head>`);
  return out.replace('<main id="view"></main>', `<main id="view"><section class="page seo">${page.html}</section></main>`);
}

// ---- sitemaps
async function sitemapIndex() {
  const { n } = await one(`SELECT count(*)::int AS n FROM locations WHERE status = 'approved'`);
  const parts = ['pages', ...Array.from({ length: Math.ceil(n / SITEMAP_CHUNK) }, (_, i) => `libraries-${i + 1}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${parts.map((p) => `  <sitemap><loc>${config.baseUrl}/sitemaps/${p}.xml</loc></sitemap>`).join('\n')}
</sitemapindex>`;
}

const urlEntry = (path, lastmod) => `  <url><loc>${config.baseUrl}${path}</loc>${
  LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(config.baseUrl + withLang(path, l))}"/>`).join('')}${
  lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
const urlset = (entries) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;

// Last change of a library = its newest approved report, check or creation.
const LIB_LASTMOD = `GREATEST(l.created_at, l.last_checked_at,
  (SELECT max(s.created_at) FROM sightings s WHERE s.location_id = l.id AND s.status = 'approved'))`;

async function sitemapPages() {
  const places = await many(
    `SELECT p.id, p.slug, max(${LIB_LASTMOD}) AS lastmod
       FROM locations l JOIN places p ON p.id = l.place_id
      WHERE l.status = 'approved' GROUP BY p.id ORDER BY p.id`);
  const countries = await countryCounts();
  return urlset([
    urlEntry('/'), urlEntry('/about'), urlEntry('/places'),
    ...countries.map((c) => urlEntry(`/c/${c.cc.toLowerCase()}`)),
    ...places.map((p) => urlEntry(placePath(p), p.lastmod)),
  ]);
}

async function sitemapLibraries(part) {
  const rows = await many(
    `SELECT l.code, ${LIB_LASTMOD} AS lastmod FROM locations l
      WHERE l.status = 'approved' ORDER BY l.id LIMIT $1 OFFSET $2`, [SITEMAP_CHUNK, (part - 1) * SITEMAP_CHUNK]);
  return rows.length ? urlset(rows.map((r) => urlEntry(`/l/${r.code}`, r.lastmod))) : null;
}

export async function renderShell(req) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const lng = url.searchParams.get('lang') === 'en' ? 'en' : 'he';
  const page = await cached(`${lng}${path}`, () => renderPath(path, lng));
  if (page === null) return { status: 404, html: indexHtml() };
  return { status: 200, html: page ? inject(indexHtml(), path, lng, page) : indexHtml() };
}

export default async function seoRoutes(app) {
  app.get('/robots.txt', async (req, reply) => reply.type('text/plain').send(
    `User-agent: *\nDisallow: /api/\nDisallow: /me\nDisallow: /login\nDisallow: /review\nDisallow: /scan/\nAllow: /api/locations/*/sign\n\nSitemap: ${config.baseUrl}/sitemap.xml\n`));

  app.get('/sitemap.xml', async (req, reply) =>
    reply.type('application/xml').header('Cache-Control', 'public, max-age=3600').send(await cached('sm', sitemapIndex)));
  app.get('/sitemaps/:name', async (req, reply) => {
    const m = req.params.name.match(/^(pages|libraries-(\d+))\.xml$/);
    const xml = m && await cached(`sm:${m[1]}`, () => (m[2] ? sitemapLibraries(Number(m[2])) : sitemapPages()));
    if (!xml) return reply.code(404).send('Not found');
    return reply.type('application/xml').header('Cache-Control', 'public, max-age=3600').send(xml);
  });

  // The app's HTML fragment for a place/country page, so the app shows what search engines see.
  app.get('/api/pages', async (req, reply) => {
    const path = String(req.query.path ?? '');
    const lng = req.query.lang === 'en' ? 'en' : 'he';
    if (!/^\/(places|c\/[a-z]{2}|p\/\d+(-[a-z0-9-]*)?)$/i.test(path)) return reply.code(404).send({ error: 'not_found' });
    const page = await cached(`${lng}${path}`, () => renderPath(path, lng));
    if (!page) return reply.code(404).send({ error: 'not_found' });
    return { title: page.title, html: page.html };
  });
}
