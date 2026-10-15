import { one, many } from './db.js';
import { normalizeIsbn } from './util.js';
import { normTitle } from './vision.js';
import { config } from './config.js';

const UA = 'Seferehov/0.1 (https://pofov.com)';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return res.json();
}

async function fromOpenLibrary(isbn) {
  const data = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const b = data?.[`ISBN:${isbn}`];
  if (!b?.title) return null;
  const year = Number(String(b.publish_date ?? '').match(/\d{4}/)?.[0]) || null;
  return {
    title: b.subtitle ? `${b.title}: ${b.subtitle}` : b.title,
    authors: (b.authors ?? []).map((a) => a.name),
    publisher: b.publishers?.[0]?.name ?? null,
    year,
    language: null,
    cover_url: b.cover?.medium ?? null,
    source: 'openlibrary',
    source_ids: { openlibrary: b.key },
  };
}

async function fromGoogleBooks(isbn) {
  const data = await getJson(gbUrl(`q=isbn:${isbn}`));
  const item = data?.items?.[0];
  const v = item?.volumeInfo;
  if (!v?.title) return null;
  return {
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    authors: v.authors ?? [],
    publisher: v.publisher ?? null,
    year: Number(String(v.publishedDate ?? '').slice(0, 4)) || null,
    language: v.language ?? null,
    cover_url: v.imageLinks?.thumbnail?.replace(/^http:/, 'https:') ?? null,
    source: 'googlebooks',
    source_ids: { googlebooks: item.id },
  };
}

// National Library of Israel (legal deposit for every book published in Israel).
// Needs a free key from https://api2.nli.org.il (NLI_API_KEY); skipped without one.
const DC = 'http://purl.org/dc/elements/1.1/';
const dc = (item, k) => (item[DC + k] ?? []).map((v) => v['@value']).filter(Boolean);

// The API answers 502 to bursts: space calls out and retry a couple of times.
let nliChain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function nliFetch(url) {
  const job = nliChain.then(async () => {
    for (const wait of [0, 2000, 6000]) {
      if (wait) await sleep(wait);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (res?.ok) return res.json();
      if (res && res.status < 500 && res.status !== 429) return null;
    }
    return null;
  });
  nliChain = job.then(() => sleep(1500), () => sleep(1500));
  return job;
}

// "עוז, עמוס, 1939-2018 מחבר$$Q…" → "עמוס עוז"
function nliAuthor(a) {
  const name = a.replace(/\$\$.*$/, '').replace(/[,.]?\s*\d{4}-(\d{4})?\.?/, '')
    .replace(/\s+(מחבר|מחברת|author|editor|עורך|עורכת)\.?\s*$/i, '').replace(/[.,\s]+$/, '').trim();
  const [last, first, ...rest] = name.split(/,\s*/);
  return first && !rest.length ? `${first} ${last}` : name;
}

async function nliSearch(query) {
  if (!config.nliApiKey) return [];
  const url = `https://api.nli.org.il/openlibrary/search?api_key=${encodeURIComponent(config.nliApiKey)}`
    + `&query=${encodeURIComponent(query)}&material_type=books&output_format=json&limit=10`;
  const data = await nliFetch(url);
  // material_type is not enforced: drop photos, recordings, videos, theses.
  return (Array.isArray(data) ? data : []).filter((item) => dc(item, 'type').includes('book')).map((item) => {
    const isbn = dc(item, 'identifier').map((x) => normalizeIsbn(x.replace(/\(.*\)/, ''))).find(Boolean) ?? null;
    // "Title : subtitle / Author ; translator." → title "Title : subtitle", bare "Title"
    const title = dc(item, 'title')[0]?.split(' / ')[0].replace(/[\s.:/]+$/, '');
    return {
      title,
      bare: title?.split(' : ')[0],
      authors: dc(item, 'creator').map(nliAuthor).filter(Boolean),
      publisher: dc(item, 'publisher')[0] ?? null,
      year: Number(String(dc(item, 'date')[0] ?? dc(item, 'non_standard_date')[0] ?? '').match(/\d{4}/)?.[0]) || null,
      language: dc(item, 'language')[0] ?? null,
      cover_url: dc(item, 'thumbnail')[0] ?? null,
      isbn,
      source: 'nli',
      source_ids: { nli: dc(item, 'recordid')[0] ?? item['@id'] },
    };
  }).filter((b) => b.title);
}

async function fromNli(isbn) {
  const hit = (await nliSearch(`any,contains,${isbn}`)).find((b) => !b.isbn || b.isbn === isbn);
  if (!hit) return null;
  const { isbn: _, ...meta } = hit;
  return meta;
}

// Without a key Google Books shares a small anonymous daily quota with the world.
const gbUrl = (qs) => `https://www.googleapis.com/books/v1/volumes?${qs}${config.googleBooksKey ? `&key=${encodeURIComponent(config.googleBooksKey)}` : ''}`;

// Local copy of the Open Library catalogue (see deploy/ol-refresh.sh).
const fromLocal = (r) => r && ({
  title: r.title, authors: r.authors, publisher: r.publisher, year: r.year, language: r.lang,
  cover_url: r.cover_id ? `https://covers.openlibrary.org/b/id/${r.cover_id}-M.jpg` : null,
  source: 'openlibrary', source_ids: { openlibrary: r.ol_key },
});
async function fromLocalIsbn(isbn) {
  return fromLocal(await one('SELECT * FROM ol_books WHERE isbn13 = $1 LIMIT 1', [isbn]).catch(() => null));
}
async function localTitleCandidates(title) {
  const q = normTitle(title);
  if (q.length < 3) return [];
  // word_similarity: how well the read title matches a run of words in the record
  // (records also carry subtitles and alternative titles).
  return many(
    `SELECT *, word_similarity($1, tnorm) AS ws FROM ol_books
      WHERE $1 <% tnorm ORDER BY ws DESC, isbn13 IS NULL, year DESC NULLS LAST LIMIT 15`,
    [q],
  ).catch(() => []);
}

const isHebrew = (s) => /[\u0590-\u05FF]/.test(s ?? '');

// Finds a book by ISBN: local table first, then Open Library, Google Books, and the
// National Library of Israel (Israeli ISBNs start 978-965).
// Returns { book } or { book: null, isbn } when nothing was found.
export async function lookupIsbn(raw) {
  const isbn = normalizeIsbn(raw);
  if (!isbn) return { error: 'invalid_isbn' };
  const existing = await one('SELECT * FROM books WHERE isbn13 = $1', [isbn]);
  if (existing) return { book: existing };

  let meta = null;
  const sources = isbn.startsWith('978965')
    ? [fromLocalIsbn, fromNli, fromGoogleBooks, fromOpenLibrary]
    : [fromLocalIsbn, fromOpenLibrary, fromGoogleBooks, fromNli];
  for (const src of sources) {
    try { meta = await src(isbn); } catch { meta = null; }
    if (meta) break;
  }
  if (!meta) return { book: null, isbn };
  return { book: await upsertBook({ ...meta, isbn13: isbn }) };
}

export async function upsertBook(b) {
  return one(
    `INSERT INTO books(isbn13, title, authors, publisher, year, language, cover_url, source, source_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (isbn13) DO UPDATE SET isbn13 = EXCLUDED.isbn13
     RETURNING *`,
    [b.isbn13 ?? null, b.title, b.authors ?? [], b.publisher ?? null, b.year ?? null,
     b.language ?? null, b.cover_url ?? null, b.source, b.source_ids ?? {}],
  );
}

// For books without an ISBN: reuse a row with the same title and first author.
export async function findOrCreateBook(b) {
  if (b.isbn13) return upsertBook(b);
  const existing = await one(
    `SELECT * FROM books WHERE lower(title) = lower($1)
        AND (cardinality(authors) = 0 OR $2::text IS NULL OR lower(authors[1]) = lower($2))
      ORDER BY isbn13 IS NULL, id LIMIT 1`,
    [b.title, b.authors?.[0] ?? null],
  );
  return existing ?? upsertBook(b);
}

const words = (s) => new Set(normTitle(s).split(' ').filter((w) => w.length > 1));
// Dice coefficient on words: 1 = same words, 0 = nothing in common.
// Share of the read title's words found in b (b may hold several titles).
function containment(a, b) {
  const A = words(a), B = new Set(String(b).split(' '));
  if (!A.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / A.size;
}

function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return (2 * n) / (A.size + B.size);
}

// Finds a catalogue record for a title (and author) read off a spine or cover.
// Returns { book } on a confident match, otherwise { book: null }.
export async function lookupTitle(title, author) {
  const r = await searchTitle(title, author);
  // A misread author name hides good matches; try the title alone.
  return r.book || !author ? r : searchTitle(title, null);
}

async function searchTitle(title, author) {
  const candidates = [];
  for (const r of await localTitleCandidates(title)) {
    candidates.push({ ...fromLocal(r), bare: r.title, isbn: r.isbn13, alt: r.tnorm });
  }
  const local = pickBest(candidates, title, author);
  if (local) return { book: await saveCandidate(local, title) };
  // Hebrew titles: the National Library has nearly every Israeli book.
  if (isHebrew(title)) {
    try {
      candidates.push(...await nliSearch(`title,contains,${title}`));
    } catch { /* fall through to Google Books */ }
  }
  const q = [`intitle:${title}`, author && `inauthor:${author}`].filter(Boolean).join(' ');
  try {
    const gb = await getJson(gbUrl(`maxResults=5&q=${encodeURIComponent(q)}`));
    for (const item of gb?.items ?? []) {
      const v = item.volumeInfo;
      const isbn = v.industryIdentifiers?.find((i) => i.type === 'ISBN_13')?.identifier;
      candidates.push({ title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title, bare: v.title, authors: v.authors ?? [], isbn,
        publisher: v.publisher ?? null, year: Number(String(v.publishedDate ?? '').slice(0, 4)) || null, language: v.language ?? null,
        cover_url: v.imageLinks?.thumbnail?.replace(/^http:/, 'https:') ?? null, source: 'googlebooks', source_ids: { googlebooks: item.id } });
    }
  } catch { /* try Open Library */ }
  if (!pickBest(candidates, title, author)) {
    try {
      const ol = await getJson(`https://openlibrary.org/search.json?limit=5&fields=key,title,author_name,isbn,first_publish_year,cover_i&title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`);
      for (const d of ol?.docs ?? []) {
        candidates.push({ title: d.title, bare: d.title, authors: d.author_name ?? [], isbn: d.isbn?.find((i) => i.length === 13),
          publisher: null, year: d.first_publish_year ?? null, language: null,
          cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null, source: 'openlibrary', source_ids: { openlibrary: d.key } });
      }
    } catch { /* no match */ }
  }
  const best = pickBest(candidates, title, author);
  return { book: best ? await saveCandidate(best, title) : null };
}

// Dice on letter pairs: tolerates spelling variants, so only counts when very close.
function charSimilarity(a, b) {
  const pairs = (s) => { const t = normTitle(s).replace(/ /g, ''), m = new Map(); for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1); return m; };
  const A = pairs(a), B = pairs(b);
  let n = 0, na = 0, nb = 0;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) { na += v; n += Math.min(v, B.get(k) ?? 0); }
  return na && nb ? (2 * n) / (na + nb) : 0;
}

function pickBest(candidates, title, author) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const chars = Math.max(charSimilarity(title, c.title), charSimilarity(title, c.bare));
    let score = Math.max(similarity(title, c.title), similarity(title, c.bare), c.alt ? containment(title, c.alt) : 0,
      chars >= 0.9 ? chars * 0.8 : 0);
    // Prefer records in the script we read (the Hebrew edition over translations).
    if (isHebrew(title) !== isHebrew(c.title)) score *= 0.9;
    if (author && c.authors.length) score = score * 0.75 + 0.25 * Math.max(...c.authors.map((a) => similarity(author, a)));
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best && bestScore >= 0.7 ? best : null;
}

async function saveCandidate(c, readTitle) {
  // Library of Congress style records give Hebrew books romanized titles; when the
  // Hebrew we read matches the record's alternative titles, show the Hebrew.
  if (readTitle && isHebrew(readTitle) && !isHebrew(c.title) && c.alt && containment(readTitle, c.alt) >= 0.8) {
    c = { ...c, title: readTitle };
  }
  const isbn13 = normalizeIsbn(c.isbn);
  if (isbn13) {
    const existing = await one('SELECT * FROM books WHERE isbn13 = $1', [isbn13]);
    if (existing) return existing;
  }
  const { bare, isbn, alt, ...meta } = c;
  return findOrCreateBook({ ...meta, isbn13 });
}
