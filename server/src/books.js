import { one } from './db.js';
import { normalizeIsbn } from './util.js';

const UA = 'POFOV/0.1 (https://pofov.com)';

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
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
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

// Finds a book by ISBN: local table first, then Open Library, then Google Books.
// Returns { book } or { book: null, isbn } when nothing was found.
export async function lookupIsbn(raw) {
  const isbn = normalizeIsbn(raw);
  if (!isbn) return { error: 'invalid_isbn' };
  const existing = await one('SELECT * FROM books WHERE isbn13 = $1', [isbn]);
  if (existing) return { book: existing };

  let meta = null;
  for (const src of [fromOpenLibrary, fromGoogleBooks]) {
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
