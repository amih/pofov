import sharp from 'sharp';
import { readBarcodes } from 'zxing-wasm/reader';
import { config } from './config.js';

// One line per book is far more reliable with small local models than JSON.
const PROMPT = `Read the book spines and covers in this photo. Write one line per distinct book, in the format:
TITLE | AUTHOR
Use the exact printed text in its original language and script (do not translate). Leave AUTHOR empty if not visible. If an ISBN number is printed, add it as: | ISBN
Skip spines you cannot read. Do not repeat a book. After the last book write END.`;

const MAX_LINES = 60;

// Long side ~1280 px keeps spine text legible without blowing the context window.
async function prepare(buffer, angle) {
  return sharp(buffer).rotate().rotate(angle)
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

// Spine text runs vertically, so each photo is read upright and turned both ways.
const ANGLES = [0, 90, 270];

// Reads books from one photo with the vision model. Returns [{title, author, isbn}].
export async function readBooks(buffer) {
  const all = [];
  for (const angle of ANGLES) all.push(...await readOnce(await prepare(buffer, angle)));
  return mergeBooks(all);
}

// Streams the answer and stops early when the model starts looping (small vision
// models tend to repeat one line until the token limit).
async function readOnce(jpeg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  const res = await fetch(`${config.vision.url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.vision.model,
      prompt: PROMPT,
      images: [jpeg.toString('base64')],
      stream: true,
      think: false,
      keep_alive: '3m',
      options: { num_ctx: 8192, num_predict: 1200, temperature: 0, repeat_penalty: 1.15 },
    }),
    signal: ctrl.signal,
  });
  if (!res.ok) { clearTimeout(timer); throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 200)}`); }

  let text = '';
  let buf = '';
  const counts = new Map();
  const decoder = new TextDecoder();
  try {
    outer: for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        text += msg.response ?? '';
        if (msg.done) break outer;
        if (/\bEND\s*$/.test(text)) break outer;
        const lines = text.split('\n');
        const last = lines.at(-2); // last complete line
        if (last != null && msg.response?.includes('\n')) {
          const key = normTitle(last.split('|')[0]);
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          if (n >= 3 || lines.length > MAX_LINES) break outer;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // closes the stream; Ollama stops generating
  }
  return parseBooks(text);
}

// "TITLE | AUTHOR | ISBN" lines; tolerates bullets, numbering and code fences.
export function parseBooks(text) {
  const out = [];
  for (let line of String(text ?? '').split('\n')) {
    line = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/`/g, '').trim();
    if (!line || /^END\b/i.test(line)) continue;
    const [rawTitle, rawAuthor, rawIsbn] = line.split('|').map((x) => x?.trim());
    const title = clean(rawTitle);
    if (!title || title.length < 2 || /^title$/i.test(title)) continue;
    const isbnDigits = String(rawIsbn ?? '').replace(/[^0-9X]/gi, '');
    out.push({ title, author: clean(rawAuthor) || null, isbn: isbnDigits.length >= 10 ? isbnDigits : null });
  }
  return mergeBooks(out);
}

// Drops repeats; "SELF AND IDENTITY" and "Handbook of Self and Identity" count as one.
export function mergeBooks(books) {
  const out = [];
  for (const b of books) {
    const k = normTitle(b.title);
    if (!k) continue;
    const dup = out.find((o) => {
      const ok = normTitle(o.title);
      return ok === k || (Math.min(ok.length, k.length) >= 6 && (ok.includes(k) || k.includes(ok)));
    });
    if (!dup) { out.push({ ...b }); continue; }
    if (b.title.length > dup.title.length) dup.title = b.title;
    dup.author ||= b.author;
    dup.isbn ||= b.isbn;
  }
  return out.slice(0, MAX_LINES);
}

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '');

// For matching: lower case, no punctuation, no Hebrew vowel points.
export const normTitle = (s) => String(s ?? '').toLowerCase()
  .normalize('NFKD').replace(/[֑-ׇ̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ISBN barcodes (EAN-13 starting 978/979) anywhere in the photo.
export async function readIsbnBarcodes(buffer) {
  try {
    const img = await sharp(buffer).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
    const found = await readBarcodes(img, { formats: ['EAN13'], tryHarder: true, maxNumberOfSymbols: 20 });
    return [...new Set(found.filter((b) => b.isValid && /^97[89]\d{10}$/.test(b.text)).map((b) => b.text))];
  } catch {
    return [];
  }
}
