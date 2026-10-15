import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { config } from './config.js';
import { one, many, q, tx } from './db.js';
import { requireUser } from './auth.js';
import { lookupIsbn, lookupTitle, findOrCreateBook } from './books.js';
import { readBooks, readIsbnBarcodes, normTitle } from './vision.js';
import { pickFrames } from './frames.js';
import { locationByCode, visibleTo, distanceTo, splitAuthors } from './locations.js';
import { initialStatus, award, pointsForSighting } from './moderation.js';
import { parseLatLon } from './util.js';

// Raw uploads (may carry GPS in EXIF) live outside the public uploads folder and
// are deleted once read. Only re-encoded thumbnails go to uploads/.
const MEDIA_DIR = resolve(process.env.SCAN_DIR || join(config.uploadDir, '..', 'scan-media'));
const MAX_PHOTOS = 8;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export default async function scanRoutes(app) {
  // Shelf photos (up to 8) or one short video. Processed in the background.
  app.post('/api/locations/:code/scans', {
    preHandler: requireUser(),
    bodyLimit: MAX_VIDEO_BYTES + 1024 * 1024,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!visibleTo(loc, req.user) || loc.status === 'removed') return reply.code(404).send({ error: 'not_found' });
    if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart_required' });

    const id = crypto.randomUUID();
    const dir = join(MEDIA_DIR, id);
    await mkdir(dir, { recursive: true });
    const media = [];
    const fields = {};
    try {
      for await (const part of req.parts({ limits: { files: MAX_PHOTOS + 1, fileSize: MAX_VIDEO_BYTES } })) {
        if (part.type !== 'file') { fields[part.fieldname] = part.value; continue; }
        const ext = (part.filename ?? '').split('.').pop().toLowerCase();
        const isVideo = part.mimetype?.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext);
        const isImage = part.mimetype?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext);
        if (!isVideo && !isImage) { part.file.resume(); continue; }
        if (isVideo && media.some((m) => m.type === 'video')) { part.file.resume(); continue; }
        const name = `${media.length}.${isVideo ? 'video' : 'img'}`;
        await pipeline(part.file, createWriteStream(join(dir, name)));
        if (part.file.truncated || (!isVideo && part.file.bytesRead > MAX_PHOTO_BYTES)) throw Object.assign(new Error('too_large'), { statusCode: 413 });
        media.push({ path: name, type: isVideo ? 'video' : 'image' });
      }
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      const status = err.statusCode === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 400;
      return reply.code(status).send({ error: status === 413 ? 'too_large' : 'bad_upload' });
    }
    if (!media.length) {
      await rm(dir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'no_media' });
    }
    const distance = await distanceTo(loc.id, parseLatLon(fields.lat, fields.lon));
    const kind = fields.kind === 'added' ? 'added' : 'seen';
    await q(
      `INSERT INTO scans(id, location_id, user_id, kind, media, distance_m) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, loc.id, req.user.id, kind, JSON.stringify(media), distance],
    );
    wake();
    return { scan: { id, status: 'queued' } };
  });

  app.get('/api/scans/:id', { preHandler: requireUser() }, async (req, reply) => {
    const scan = await ownScan(req);
    if (!scan) return reply.code(404).send({ error: 'not_found' });
    const items = await many(
      `SELECT i.id, i.title, i.author, i.isbn13, i.via, i.matched, i.frame_path,
              b.id AS book_id, b.title AS book_title, b.authors AS book_authors, b.cover_url, b.year
         FROM scan_items i LEFT JOIN books b ON b.id = i.book_id
        WHERE i.scan_id = $1 ORDER BY i.id`,
      [scan.id],
    );
    for (const i of items) { i.frame = i.frame_path && `/uploads/${i.frame_path}`; delete i.frame_path; }
    const ahead = scan.status === 'queued'
      ? (await one(`SELECT count(*)::int AS n FROM scans WHERE status IN ('queued','processing') AND created_at < $1`, [scan.created_at])).n
      : 0;
    return {
      scan: { id: scan.id, code: scan.code, kind: scan.kind, status: scan.status, progress: scan.progress, error: scan.error, ahead, created_at: scan.created_at },
      items,
    };
  });

  // The user ticks the books that really are there; they become sightings.
  app.post('/api/scans/:id/confirm', { preHandler: requireUser() }, async (req, reply) => {
    const scan = await ownScan(req);
    if (!scan) return reply.code(404).send({ error: 'not_found' });
    if (scan.status !== 'done') return reply.code(409).send({ error: 'not_ready' });
    const picks = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
    const kind = req.body?.kind === 'added' ? 'added' : scan.kind;
    const rows = await many('SELECT * FROM scan_items WHERE scan_id = $1', [scan.id]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const loc = await one('SELECT id, status FROM locations WHERE id = $1', [scan.location_id]);
    const far = scan.distance_m == null || scan.distance_m > config.maxReportDistanceM;
    const status = loc.status === 'approved' ? initialStatus(req.user, { far }) : 'pending';

    let n = 0;
    for (const p of picks) {
      const item = byId.get(Number(p.id));
      if (!item) continue;
      const title = String(p.title ?? item.title).trim().slice(0, 300);
      const author = String(p.author ?? item.author ?? '').trim().slice(0, 200);
      const edited = title !== item.title || author !== (item.author ?? '');
      const book = item.book_id && !edited
        ? await one('SELECT * FROM books WHERE id = $1', [item.book_id])
        : title && await findOrCreateBook({ title, authors: splitAuthors(author), source: 'llm' });
      if (!book) continue;
      await tx(async (db) => {
        const s = (await db.query(
          `INSERT INTO sightings(book_id, location_id, user_id, kind, status, distance_m)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [book.id, scan.location_id, req.user.id, kind, status, scan.distance_m],
        )).rows[0];
        if (status === 'approved') {
          await award(db, { userId: req.user.id, points: pointsForSighting(kind), reason: `sighting_${kind}`, refType: 'sighting', refId: s.id });
        }
      });
      n++;
    }
    if (n && status === 'approved') await q('UPDATE locations SET last_checked_at = now() WHERE id = $1', [scan.location_id]);
    await q(`UPDATE scans SET status = 'confirmed' WHERE id = $1`, [scan.id]);
    return { added: n, status };
  });
}

async function ownScan(req) {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return null;
  const scan = await one(
    `SELECT s.*, l.code FROM scans s JOIN locations l ON l.id = s.location_id WHERE s.id = $1`,
    [req.params.id],
  );
  if (!scan || (scan.user_id !== req.user.id && req.user.trust_level < 2)) return null;
  return scan;
}

// ---------------------------------------------------------------------------
// Worker: one scan at a time (the GPU is the bottleneck).

let busy = false;
let log = console;

export function startScanWorker(logger) {
  log = logger;
  q(`UPDATE scans SET status = 'queued' WHERE status = 'processing'`).then(wake).catch((err) => log.error({ err }, 'scan reset'));
  setInterval(wake, 60_000).unref();
}

function wake() {
  if (busy) return;
  busy = true;
  drain().catch((err) => log.error({ err }, 'scan worker')).finally(() => { busy = false; });
}

async function drain() {
  for (;;) {
    const scan = await one(
      `UPDATE scans SET status = 'processing', started_at = now()
        WHERE id = (SELECT id FROM scans WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
    );
    if (!scan) return;
    try {
      await processScan(scan);
      await q(`UPDATE scans SET status = 'done', finished_at = now() WHERE id = $1`, [scan.id]);
    } catch (err) {
      log.error({ err, scan: scan.id }, 'scan failed');
      await q(`UPDATE scans SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [scan.id, String(err.message).slice(0, 300)]);
    } finally {
      await rm(join(MEDIA_DIR, scan.id), { recursive: true, force: true });
    }
  }
}

const setProgress = (id, progress) => q('UPDATE scans SET progress = $2 WHERE id = $1', [id, progress]);

async function saveFrameThumb(buffer, scanId, i) {
  const month = new Date().toISOString().slice(0, 7);
  const rel = `${month}/scan-${scanId.slice(0, 8)}-${i}.webp`;
  await mkdir(join(config.uploadDir, month), { recursive: true });
  await sharp(buffer).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 })
    .toFile(join(config.uploadDir, rel)); // re-encoding drops EXIF/GPS
  return rel;
}

async function processScan(scan) {
  const dir = join(MEDIA_DIR, scan.id);
  await setProgress(scan.id, { step: 'frames' });
  const images = [];
  for (const m of scan.media) {
    const file = join(dir, m.path);
    if (m.type === 'video') {
      for (const f of await pickFrames(file)) images.push({ buffer: f.buffer, fromVideo: true });
    } else {
      images.push({ buffer: await readFile(file), fromVideo: false });
    }
  }
  if (!images.length) throw new Error('no usable frames');

  // Dedupe across photos/frames. Titles are fuzzy-merged ("SELF AND IDENTITY" ≈
  // "Handbook of Self and Identity"); `frames` counts how many frames showed it.
  const found = [];
  const add = (key, item, i) => {
    const near = (a, b) => a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)));
    const hit = found.find((f) => near(f.key, key));
    if (hit) {
      hit.frames.add(i);
      if ((item.title?.length ?? 0) > (hit.title?.length ?? 0)) hit.title = item.title;
      hit.author ||= item.author;
      hit.isbn ||= item.isbn;
      return;
    }
    found.push({ ...item, key, frames: new Set([i]) });
  };
  for (const [i, { buffer: buf, fromVideo }] of images.entries()) {
    await setProgress(scan.id, { step: 'reading', done: i, total: images.length });
    const frame = await saveFrameThumb(buf, scan.id, i);
    for (const isbn of await readIsbnBarcodes(buf)) add(`isbn:${isbn}`, { isbn, via: 'barcode', frame, fromVideo }, i);
    let books = [];
    try { books = await readBooks(buf); } catch (err) { log.warn({ err, scan: scan.id }, 'vision failed on frame'); }
    for (const b of books) add(normTitle(b.title), { ...b, via: 'vision', frame, fromVideo }, i);
  }

  await setProgress(scan.id, { step: 'matching', done: 0, total: found.length });
  let done = 0;
  const seenBooks = new Set();
  const rows = [];
  for (const item of found) {
    let book = null;
    const isbn = item.isbn;
    if (isbn) book = (await lookupIsbn(isbn).catch(() => ({}))).book ?? null;
    if (!book && item.title) book = (await lookupTitle(item.title, item.author).catch(() => ({}))).book ?? null;
    await setProgress(scan.id, { step: 'matching', done: ++done, total: found.length });
    if (book && seenBooks.has(book.id)) continue; // the barcode and the spine of the same book
    if (book) seenBooks.add(book.id);
    // In a video every spine shows up in several frames; a title read only once
    // and found in no catalogue is most likely a misreading.
    if (!book && item.via === 'vision' && item.fromVideo && item.frames.size < 2) continue;
    const title = item.title || book?.title || (isbn && `ISBN ${isbn}`);
    if (title) rows.push({ item, book, title, isbn });
  }
  rows.sort((a, b) => Number(!!b.book) - Number(!!a.book)); // catalogue matches first
  for (const { item, book, title, isbn } of rows) {
    await q(
      `INSERT INTO scan_items(scan_id, title, author, isbn13, book_id, via, matched, frame_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [scan.id, title, item.author ?? book?.authors?.[0] ?? null, book?.isbn13 ?? isbn ?? null, book?.id ?? null, item.via, !!book, item.frame],
    );
  }
}
