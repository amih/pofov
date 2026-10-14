import { randomBytes, createHash } from 'node:crypto';

// No 0/O/1/I/L — codes get typed from printed signs.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function shortCode(len = 6) {
  const bytes = randomBytes(len);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest();

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Accepts ISBN-10 or ISBN-13 with any separators; returns ISBN-13 or null.
export function normalizeIsbn(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, '');
  if (s.length === 13 && /^\d{13}$/.test(s)) return isbn13Valid(s) ? s : null;
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    if (sum % 11 !== 0) return null;
    const core = '978' + s.slice(0, 9);
    return core + isbn13Check(core);
  }
  return null;
}

function isbn13Check(core12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

const isbn13Valid = (s) => (s.startsWith('978') || s.startsWith('979')) && isbn13Check(s.slice(0, 12)) === s[12];

export function parseLatLon(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: la, lon: lo };
}
