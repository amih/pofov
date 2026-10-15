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
// Photos: one whole-image read plus each spine cut out and read on its own (far
// better for Hebrew, which needs the pixels). Video frames: whole image at three
// angles (cheaper; the many overlapping frames make up for it).
export async function readBooks(buffer, { spines = true } = {}) {
  const all = [];
  if (!spines) {
    for (const angle of ANGLES) all.push(...await readOnce(await prepare(buffer, angle)));
    return mergeBooks(all);
  }
  // Spine-by-spine reads come first: they are the more accurate ones.
  try { all.push(...await readSpines(buffer)); } catch { /* keep the whole-image read */ }
  all.push(...await readOnce(await prepare(buffer, 0)));
  return mergeBooks(all);
}

async function generate(jpeg, prompt, numPredict) {
  const res = await fetch(`${config.vision.url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.vision.model, prompt, images: [jpeg.toString('base64')], stream: false, think: false,
      keep_alive: '3m', options: { num_ctx: 8192, num_predict: numPredict, temperature: 0, repeat_penalty: 1.1 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`vision ${res.status}`);
  return (await res.json()).response ?? '';
}

const MAX_SPINES = 30;
const SPINE_PROMPT = 'This is one book spine or cover. Read its title and author exactly as printed, in the original language and script. Answer one line: TITLE | AUTHOR. If unreadable answer NONE.';
const iou = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
};
// Vowel points mostly show up when the model guesses at Hebrew it cannot read.
const niqqud = (s) => (s.match(/[\u05B0-\u05BC\u05C1\u05C2]/g) ?? []).length;

async function readSpines(buffer) {
  const base = sharp(buffer).rotate();
  const { width: W, height: H } = await base.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  const small = await base.clone().resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  const out = await generate(small, 'Locate every individual book spine or book cover in this image. Output JSON list: [{"bbox_2d":[x1,y1,x2,y2]}]', 1500);
  // Qwen3-VL answers in 0–1000 coordinates relative to the image.
  let boxes = [...out.matchAll(/"bbox_2d"\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g)]
    .map((m) => m.slice(1, 5).map(Number))
    .map(([x1, y1, x2, y2]) => [x1 * W / 1000, y1 * H / 1000, x2 * W / 1000, y2 * H / 1000])
    .filter(([x1, y1, x2, y2]) => x2 - x1 > 10 && y2 - y1 > 10);
  boxes = boxes.filter((b, i) => !boxes.slice(0, i).some((o) => iou(o, b) > 0.6)).slice(0, MAX_SPINES);

  const books = [];
  for (const [x1, y1, x2, y2] of boxes) {
    const pad = 8;
    const left = Math.max(0, Math.floor(x1 - pad));
    const top = Math.max(0, Math.floor(y1 - pad));
    const crop = base.clone().extract({ left, top, width: Math.min(W - left, Math.ceil(x2 - x1 + 2 * pad)), height: Math.min(H - top, Math.ceil(y2 - y1 + 2 * pad)) })
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true });
    const vertical = y2 - y1 > (x2 - x1) * 1.3;
    // Spine text runs top-to-bottom on most books; try that first, then the other way.
    let best = null;
    for (const angle of vertical ? [270, 90] : [0]) {
      const jpeg = await crop.clone().rotate(angle).jpeg({ quality: 90 }).toBuffer();
      const line = (await generate(jpeg, SPINE_PROMPT, 80)).trim().split('\n')[0];
      const [b] = /^NONE\b/i.test(line) ? [] : parseBooks(line);
      if (b && (!best || (best.quality === 'low' && b.quality !== 'low'))) best = { ...b, crop: jpeg };
      if (best && best.quality !== 'low') break;
    }
    if (best) books.push(best);
  }
  return books;
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
    out.push({ title, author: clean(rawAuthor) || null, isbn: isbnDigits.length >= 10 ? isbnDigits : null, quality: readQuality(line) });
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
    if (dup.quality === 'low' && b.quality !== 'low') Object.assign(dup, { title: b.title, author: b.author || dup.author, quality: b.quality });
    else if (b.title.length > dup.title.length && b.quality !== 'low') dup.title = b.title;
    dup.author ||= b.author;
    dup.isbn ||= b.isbn;
    dup.crop ||= b.crop;
  }
  return out.slice(0, MAX_LINES);
}

// Printed Hebrew titles almost never carry vowel points; the model adds them when it
// guesses. Strip them (better catalogue matches) and remember the read was shaky.
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0591-\u05C7]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) : '');

// low = probably garbled: guessed vowel points, stray symbols, or too short.
export function readQuality(raw) {
  const s = String(raw ?? '');
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  const odd = (s.match(/[^\p{L}\p{N}\s.,:;'"’\-–&!?()]/gu) ?? []).length;
  if (niqqud(s) >= 3 || letters < 3 || odd > 2) return 'low';
  return 'medium';
}

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
