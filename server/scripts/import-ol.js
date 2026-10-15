// Turns Open Library dumps into COPY rows for ol_books (tab-separated, stdout).
//   node scripts/import-ol.js <authors.txt.gz> <editions.txt.gz> | psql -c "\copy ol_books_new FROM STDIN"
// Keeps every edition with an ISBN, plus editions without one in languages common
// in Israeli street libraries (older Hebrew books often have no ISBN).
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { normalizeIsbn } from '../src/util.js';
import { normTitle } from '../src/vision.js';

const [authorsFile, editionsFile] = process.argv.slice(2);
const NO_ISBN_LANGS = new Set(['heb', 'yid', 'ara', 'rus', 'lad']);

const lines = (file) => createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
// Dump lines: type, key, revision, last_modified, JSON — tab separated (JSON escapes its own tabs).
const json = (line) => { try { return JSON.parse(line.split('\t')[4]); } catch { return null; } };
// COPY text format: backslash-escape \, tab, newline, CR. \N = NULL.
const cell = (v) => (v == null || v === '' ? '\\N' : String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
const arr = (a) => `{${a.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const authors = new Map();
let n = 0;
for await (const line of lines(authorsFile)) {
  const tab = line.indexOf('\t');
  if (line.slice(0, tab) !== '/type/author') continue;
  const a = json(line);
  if (a?.key && a.name) authors.set(a.key, a.name.slice(0, 120));
  if (++n % 2_000_000 === 0) log('authors', n);
}
log('authors loaded', authors.size);

let kept = 0, rows = 0;
n = 0;
const out = [];
const flush = () => { if (out.length) { process.stdout.write(out.join('')); out.length = 0; } };
for await (const line of lines(editionsFile)) {
  if (++n % 2_000_000 === 0) { log('editions', n, 'kept', kept, 'rows', rows); }
  if (!line.startsWith('/type/edition')) continue;
  const e = json(line);
  if (!e?.title || !e.key) continue;
  const isbns = [...new Set([...(e.isbn_13 ?? []), ...(e.isbn_10 ?? [])].map(normalizeIsbn).filter(Boolean))];
  const lang = e.languages?.[0]?.key?.split('/').pop() ?? null;
  if (!isbns.length && !NO_ISBN_LANGS.has(lang)) continue;
  kept++;
  const title = (e.subtitle ? `${e.title}: ${e.subtitle}` : e.title).slice(0, 400);
  const names = (e.authors ?? []).map((a) => authors.get(a.key)).filter(Boolean).slice(0, 6);
  if (!names.length && e.by_statement) names.push(e.by_statement.replace(/^by\s+/i, '').slice(0, 120));
  const year = Number(String(e.publish_date ?? '').match(/\d{4}/)?.[0]) || null;
  const tnorm = normTitle([title, ...(e.other_titles ?? []), ...(e.work_titles ?? [])].join(' ')).slice(0, 600);
  if (!tnorm) continue;
  const base = [cell(title), cell(arr(names)), cell(e.publishers?.[0]?.slice(0, 200)), cell(year), cell(lang),
    cell(Number.isInteger(e.covers?.[0]) && e.covers[0] > 0 ? e.covers[0] : null), cell(e.key), cell(tnorm)].join('\t');
  for (const isbn of isbns.length ? isbns : [null]) { out.push(`${cell(isbn)}\t${base}\n`); rows++; }
  if (out.length > 5000) flush();
}
flush();
log('done: editions', n, 'kept', kept, 'rows', rows);
