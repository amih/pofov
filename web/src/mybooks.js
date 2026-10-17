import { api } from './api.js';
import { esc, dialog, getPosition, toast, confirmDialog } from './ui.js';
import { t } from './i18n.js';

// "I left this book in a library": pick the library (nearest first, then the ones the
// reader used lately, or a code from the sign) and report it there.
export async function placeBook(item, code = null) {
  let pos = null;
  if (!code) {
    pos = await getPosition({ timeout: 8000 }).catch(() => null);
    let libs = { near: [], recent: [] };
    try { libs = await api(`/api/my-books/libraries${pos ? `?lat=${pos.lat}&lon=${pos.lon}` : ''}`); } catch (e) { toast(e.message); return null; }
    const opt = (l, i, extra) => `<label class="lib-opt"><input type="radio" name="lib" value="${esc(l.code)}" ${i === 0 ? 'checked' : ''}><span class="name">${esc(l.name || t('free_library'))}</span><span class="muted small">${extra}</span></label>`;
    const list = [...libs.near.map((l) => [l, l.distance_m < 1000 ? `${l.distance_m} m` : `${(l.distance_m / 1000).toFixed(1)} km`]),
      ...libs.recent.map((l) => [l, t('mybooks.used_lately')])];
    code = await dialog({
      title: t('mybooks.where'),
      html: `<p><b>${esc(item.title)}</b></p>
        ${list.length ? `<div class="lib-list">${list.map(([l, extra], i) => opt(l, i, extra)).join('')}</div>` : `<p class="muted small">${t(pos ? 'mybooks.none_near' : 'mybooks.no_gps')}</p>`}
        <label class="small">${t('mybooks.code')} <input name="code" dir="ltr" maxlength="10" autocomplete="off" placeholder="ABC123"></label>`,
      ok: t('mybooks.report'),
      cancel: t('cancel'),
      read: (el) => el.querySelector('[name=code]').value.trim() || el.querySelector('[name=lib]:checked')?.value || null,
    });
    if (!code) return null;
  }
  else if (!await confirmDialog(t('mybooks.place_confirm', { title: esc(item.title) }), t('mybooks.report'))) return null;
  if (!pos) pos = await getPosition({ timeout: 5000 }).catch(() => null);
  try {
    const r = await api(`/api/my-books/${item.id}/place`, { method: 'POST', json: { code, lat: pos?.lat, lon: pos?.lon } });
    toast(r.sighting.status === 'approved' ? t('mybooks.placed') : t('loc.thanks_review'));
    return r;
  } catch (e) {
    toast(e.status === 404 ? t('mybooks.no_such_library') : e.message);
    return null;
  }
}
