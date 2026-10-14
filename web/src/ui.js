import { t, lang } from './i18n.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(text, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, ms);
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return t('time.just_now');
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  const units = [[60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let v = s / 60;
  for (const [n, name] of units) {
    if (v < n) return rtf.format(-Math.round(v), name);
    v /= n;
  }
}

export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('geo.none')));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(t(e.code === 1 ? 'geo.denied' : 'geo.fail'))),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

// Phone photos are 3–12 MB; send at most 2000px JPEG.
export async function shrinkImage(file, maxSide = 2000) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
}

// Round picture, or the first letter of the screen name on a colour picked from it.
const AVATAR_COLORS = ['#3d7cb5', '#3f8f6b', '#c0443a', '#c9962a', '#9a5b2e', '#7b5ea7'];
export function avatarHtml({ avatar, screen_name, name }, size = 32) {
  const label = screen_name ?? name ?? '?';
  if (avatar) return `<img class="avatar" src="${esc(avatar)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`;
  const color = AVATAR_COLORS[[...label].reduce((a, c) => a + c.codePointAt(0), 0) % AVATAR_COLORS.length];
  return `<span class="avatar letter" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${color}">${esc([...label][0]?.toUpperCase() ?? '?')}</span>`;
}
