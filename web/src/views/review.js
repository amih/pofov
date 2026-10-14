import { api, getMe } from '../api.js';
import { navigate } from '../nav.js';
import { esc, timeAgo, toast } from '../ui.js';

const KIND = { seen: 'on the shelf', taken: 'taken', gone: 'missing' };

export default async function reviewView(root) {
  const me = await getMe();
  if (!me || me.trust_level < 2) return navigate('/me', { replace: true });
  const { locations, sightings } = await api('/api/review');
  const who = (r) => esc(r.by_name);
  root.innerHTML = `
  <section class="page">
    <h1>Review queue</h1>
    <h2>New libraries <span class="count">${locations.length}</span></h2>
    <ul class="review">${locations.map((l) => `
      <li data-type="location" data-id="${l.id}">
        ${l.thumb ? `<img src="${l.thumb}" alt="">` : ''}
        <div><strong>${esc(l.name || '(no name)')}</strong> ${l.restricted ? '🔒' : ''}<br>
          <span>${esc(l.description || '')}</span><br>
          <span class="muted">${who(l)} · ${timeAgo(l.created_at)} ·
          <a href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=19/${l.lat}/${l.lon}" target="_blank" rel="noopener">map</a></span></div>
        <div class="col"><button class="btn primary" data-d="approved">Approve</button><button class="btn" data-d="rejected">Reject</button></div>
      </li>`).join('') || '<p class="muted">Nothing waiting.</p>'}</ul>
    <h2>Book reports <span class="count">${sightings.length}</span></h2>
    <ul class="review">${sightings.map((s) => `
      <li data-type="sighting" data-id="${s.id}">
        ${s.thumb || s.cover_url ? `<img src="${esc(s.thumb || s.cover_url)}" alt="">` : ''}
        <div><strong>${esc(s.title)}</strong> — ${KIND[s.kind]}<br>
          <span class="muted">at <a href="/l/${s.code}">${esc(s.location_name || s.code)}</a> · ${who(s)} · ${timeAgo(s.created_at)}
          ${s.distance_m == null ? ' · no GPS' : ` · ${s.distance_m} m away`}</span></div>
        <div class="col"><button class="btn primary" data-d="approved">Approve</button><button class="btn" data-d="rejected">Reject</button></div>
      </li>`).join('') || '<p class="muted">Nothing waiting.</p>'}</ul>
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
