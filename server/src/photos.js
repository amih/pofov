import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { config } from './config.js';
import { one } from './db.js';
import { cropPhotoLater } from './covers.js';

const MAX_SIDE = 1600;
const THUMB_SIDE = 400;

// Re-encodes the image (which drops all EXIF metadata, including GPS) after
// reading the GPS position from it. Returns the photos row.
export async function savePhoto(buffer, { userId, kind }) {
  let gps = null;
  try {
    const g = await exifr.gps(buffer);
    if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) gps = g;
  } catch { /* no EXIF */ }

  const month = new Date().toISOString().slice(0, 7);
  const dir = join(config.uploadDir, month);
  await mkdir(dir, { recursive: true });

  const id = crypto.randomUUID();
  const rel = `${month}/${id}.webp`;
  const thumbRel = `${month}/${id}_t.webp`;
  const base = sharp(buffer, { failOn: 'error' }).rotate();
  const info = await base.clone()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(join(config.uploadDir, rel));
  await base.clone()
    .resize(THUMB_SIDE, THUMB_SIDE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toFile(join(config.uploadDir, thumbRel));

  const row = await one(
    `INSERT INTO photos(id, user_id, kind, path, thumb_path, width, height, exif_geom)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_MakePoint($9, $8)::geography END)
     RETURNING id, path, thumb_path`,
    [id, userId, kind, rel, thumbRel, info.width, info.height, gps?.latitude ?? null, gps?.longitude ?? null],
  );
  // A book's cover: cut out of the background and straightened, in the background.
  if (kind === 'cover' || kind === 'back') cropPhotoLater(row.id, buffer);
  return row;
}

export const photoUrls = (p) => p && { url: `/uploads/${p.path}`, thumb: `/uploads/${p.thumb_path}` };

const AVATAR_SIDE = 256;

// Square 256px WebP under uploads/avatars/. Returns the relative path.
export async function saveAvatar(buffer, userId) {
  const dir = join(config.uploadDir, 'avatars');
  await mkdir(dir, { recursive: true });
  const rel = `avatars/${userId}-${crypto.randomUUID().slice(0, 8)}.webp`;
  await sharp(buffer, { failOn: 'error' }).rotate()
    .resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(join(config.uploadDir, rel));
  return rel;
}

// Google profile pictures end in "=s96-c"; ask for a size that matches ours.
export async function fetchGoogleAvatar(url, userId) {
  const big = url.replace(/=s\d+(-c)?$/, `=s${AVATAR_SIDE}-c`);
  const res = await fetch(big, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`avatar fetch ${res.status}`);
  return saveAvatar(Buffer.from(await res.arrayBuffer()), userId);
}

export async function removeUpload(rel) {
  if (!rel) return;
  try { await unlink(join(config.uploadDir, rel)); } catch { /* already gone */ }
}

export const avatarUrl = (rel) => (rel ? `/uploads/${rel}` : null);
