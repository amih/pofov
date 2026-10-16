// Reads shelf photos/videos with the current vision pipeline, for testing changes.
//   node --env-file=../.env scripts/rescan.js <out-dir> <photo|video>...   → books + crops in out-dir
//   node --env-file=../.env scripts/rescan.js --requeue <scan-id> <photo|video>...
//     → a new scan for the same user and library, read by the running worker (shows in the app)
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { config } from '../src/config.js';
import { one, q } from '../src/db.js';
import { readBooks } from '../src/vision.js';
import { pickFrames } from '../src/frames.js';

const isVideo = (f) => /\.(mp4|mov|webm|m4v|3gp|video)$/i.test(f);
const [mode, target, ...files] = process.argv.slice(2);

if (mode === '--requeue') {
  const old = await one('SELECT * FROM scans WHERE id = $1', [target]);
  if (!old) throw new Error('no such scan');
  const id = crypto.randomUUID();
  const dir = join(resolve(process.env.SCAN_DIR || join(config.uploadDir, '..', 'scan-media')), id);
  await mkdir(dir, { recursive: true });
  const media = [];
  for (const f of files) {
    const name = `${media.length}.${isVideo(f) ? 'video' : 'img'}`;
    await copyFile(f, join(dir, name));
    media.push({ path: name, type: isVideo(f) ? 'video' : 'image' });
  }
  await q(`INSERT INTO scans(id, location_id, user_id, kind, media, distance_m, lang) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, old.location_id, old.user_id, old.kind, JSON.stringify(media), old.distance_m, old.lang]);
  console.log(`queued ${id}`);
  process.exit(0);
}

const out = mode;
await mkdir(out, { recursive: true });
const results = [];
for (const f of [target, ...files]) {
  const frames = isVideo(f) ? (await pickFrames(f)).map((x) => x.buffer) : [await readFile(f)];
  for (const [i, buf] of frames.entries()) {
    const t0 = Date.now();
    const books = await readBooks(buf);
    const tag = `${basename(f).replace(/\W+/g, '_')}-${i}`;
    for (const [n, b] of books.entries()) if (b.crop) await writeFile(join(out, `${tag}-${n}.jpg`), b.crop);
    results.push({ file: tag, seconds: (Date.now() - t0) / 1000, books: books.map(({ crop, ...b }) => b) });
    console.log(tag, `${books.length} books`, `${(Date.now() - t0) / 1000}s`);
  }
}
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(0);
