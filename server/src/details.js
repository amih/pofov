// What a book looks like and what its back cover says, for the book page: a large
// front cover, the back cover when one is online, and the blurb. Looked up the first
// time someone opens the book, cached on the books row, looked up again after a month.
import { one } from './db.js';

const UA = 'Seferehov/0.1 (https://seferehov.com)';
const REFRESH_DAYS = 30;
const inFlight = new Map();

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}

// Catalogue thumbnails we already have, at their largest size.
function largerCover(url) {
  if (!url) return null;
  if (url.includes('covers.openlibrary.org')) return url.replace(/-[SM]\.jpg/, '-L.jpg');
  if (url.includes('books.google')) return url.replace(/&zoom=\d/, '').replace(/&edge=curl/, '') + '&fife=w800';
  return url;
}

// Open Library descriptions often end with a "--back cover" style source note.
const text = (d) => {
  const v = typeof d === 'string' ? d : d?.value ?? null;
  return v ? v.replace(/\s*\r?\n\s*-{2,}\s*[^\n]{0,60}$/, '').trim() : null;
};

// Open Library: edition by ISBN (or the work we matched), cover id → -L.jpg, description
// from the edition or its work.
async function fromOpenLibrary(book) {
  const workKey = book.source_ids?.openlibrary?.startsWith('/works/') ? book.source_ids.openlibrary : null;
  const ed = book.isbn13 ? await getJson(`https://openlibrary.org/isbn/${book.isbn13}.json`) : null;
  const wk = ed?.works?.[0]?.key ?? workKey;
  const work = wk ? await getJson(`https://openlibrary.org${wk}.json`) : null;
  if (!ed && !work) return null;
  const cover = ed?.covers?.find((c) => c > 0) ?? work?.covers?.find((c) => c > 0);
  return {
    front_url: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : null,
    back_url: null,
    description: text(ed?.description) ?? text(work?.description),
    source: 'openlibrary',
  };
}

// Tried in order; the first answer for each field wins.
const SOURCES = [fromOpenLibrary];

async function lookUp(book) {
  const found = { front_url: null, back_url: null, description: null, sources: [] };
  for (const src of SOURCES) {
    let r = null;
    try { r = await src(book); } catch { /* next source */ }
    if (!r) continue;
    let used = false;
    for (const k of ['front_url', 'back_url', 'description']) if (!found[k] && r[k]) { found[k] = r[k]; used = true; }
    if (used) found.sources.push(r.source);
    if (found.front_url && found.back_url && found.description) break;
  }
  return one(
    `UPDATE books SET front_url = $2, back_url = $3, description = $4, details_source = $5, details_at = now()
      WHERE id = $1 RETURNING *`,
    [book.id, found.front_url ?? largerCover(book.cover_url), found.back_url, found.description?.slice(0, 4000) ?? null, found.sources.join(',') || null],
  );
}

export async function bookDetails(book) {
  if (book.details_at && Date.now() - new Date(book.details_at) < REFRESH_DAYS * 86400_000) return book;
  if (!inFlight.has(book.id)) inFlight.set(book.id, lookUp(book).finally(() => inFlight.delete(book.id)));
  return inFlight.get(book.id);
}
