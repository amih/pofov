import { api, getMe } from '../api.js';
import { navigate } from '../nav.js';
import { esc, timeAgo, toast } from '../ui.js';
import { t } from '../i18n.js';

export default async function reviewView(root) {
  const me = await getMe();
  if (!me || me.trust_level < 2) return navigate('/me', { replace: true });
  const { locations, sightings } = await api('/api/review');
  const who = (r) => esc(r.by_name);
  root.innerHTML = `
  <section class="page">
    <h1>${t('review.title')}</h1>
    <h2>${t('review.libs')} <span class="count">${locations.length}</span></h2>
    <ul class="review">${locations.map((l) => `
      <li data-type="location" data-id="${l.id}">
        ${l.thumb ? `<img src="${l.thumb}" alt="">` : ''}
        <div><strong>${esc(l.name || t('review.noname'))}</strong> ${l.restricted ? '🔒' : ''}<br>
          <span>${esc(l.description || '')}</span><br>
          <span class="muted">${who(l)} · ${timeAgo(l.created_at)} ·
          <a href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=19/${l.lat}/${l.lon}" target="_blank" rel="noopener">${t('review.map')}</a></span></div>
        <div class="col"><button class="btn primary" data-d="approved">${t('review.approve')}</button><button class="btn" data-d="rejected">${t('review.reject')}</button></div>
      </li>`).join('') || `<p class="muted">${t('review.nothing')}</p>`}</ul>
    <h2>${t('review.reports')} <span class="count">${sightings.length}</span></h2>
    <ul class="review">${sightings.map((s) => `
      <li data-type="sighting" data-id="${s.id}">
        ${s.thumb || s.cover_url ? `<img src="${esc(s.thumb || s.cover_url)}" alt="">` : ''}
        <div><strong>${esc(s.title)}</strong> — ${t(`review.kind.${s.kind}`)}<br>
          <span class="muted">${t('review.at')} <a href="/l/${s.code}">${esc(s.location_name || s.code)}</a> · ${who(s)} · ${timeAgo(s.created_at)}
          ${s.distance_m == null ? ` · ${t('review.no_gps')}` : ` · ${t('review.away', { m: s.distance_m })}`}</span></div>
        <div class="col"><button class="btn primary" data-d="approved">${t('review.approve')}</button><button class="btn" data-d="rejected">${t('review.reject')}</button></div>
      </li>`).join('') || `<p class="muted">${t('review.nothing')}</p>`}</ul>
  </section>`;
  root.onclick = async (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    const li = b.closest('li');
    try {
      await api(`/api/review/${li.dataset.type}/${li.dataset.id}`, { method: 'POST', json: { decision: b.dataset.d } });
      li.remove();
    } catch (err) { toast(err.message); }
  };
  return () => { root.onclick = null; };
}
