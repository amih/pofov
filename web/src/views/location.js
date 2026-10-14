import { api, getMe } from '../api.js';
import { esc, getPosition, timeAgo, toast } from '../ui.js';

const KIND_TEXT = { seen: 'saw', taken: 'took', gone: 'found missing' };

export default async function locationView(root, [code]) {
  root.innerHTML = '<section class="page"><p class="muted">Loading…</p></section>';
  let data;
  try { data = await api(`/api/locations/${code}`); } catch (e) {
    root.innerHTML = `<section class="page"><h1>Library not found</h1><p>${e.status === 404 ? 'This code is not on the map (yet).' : 'You seem to be offline.'}</p><p><a href="/">Back to the map</a></p></section>`;
    return;
  }
  const { location: l, books, activity, my_pending } = data;
  const me = await getMe();
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lon}`;

  root.innerHTML = `
  <section class="page">
    ${l.photo ? `<img class="hero" src="${l.photo.url}" alt="Photo of the library">` : ''}
    <h1>${esc(l.name || 'Free library')}</h1>
    ${l.status === 'pending' ? '<p class="note">Waiting for review — only you can see it for now.</p>' : ''}
    ${l.restricted ? '<p class="note">Inside a building or private area — you may need a resident to let you in.</p>' : ''}
    ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ''}
    <p class="muted">${l.last_checked_at ? `Last checked ${timeAgo(l.last_checked_at)}` : 'Not checked yet'}
      · code <strong>${l.code}</strong>${l.source === 'osm' ? ` · from <a href="${l.osm}" target="_blank" rel="noopener">OpenStreetMap</a>` : ''}</p>
    <div class="actions">
      <a class="btn primary" href="/l/${l.code}/add">📷 Add books</a>
      <button class="btn" id="check">✓ It's still here</button>
      <a class="btn" href="${nav}" target="_blank" rel="noopener">🧭 Directions</a>
    </div>
    ${my_pending ? `<p class="note">${my_pending} of your reports are waiting for review.</p>` : ''}

    <h2>On the shelf <span class="count">${books.length}</span></h2>
    ${books.length ? '' : '<p class="muted">No books recorded yet. Be the first — scan the barcodes on the back covers.</p>'}
    <ul class="books">
      ${books.map((b) => `
        <li data-id="${b.id}">
          ${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="" loading="lazy">` : '<div class="nocover">📖</div>'}
          <div class="meta">
            <strong>${esc(b.title)}</strong>
            <span>${esc(b.authors.join(', '))}${b.year ? ` · ${b.year}` : ''}</span>
            <span class="muted">seen ${timeAgo(b.last_seen)}</span>
            <span class="row"><button class="link" data-kind="taken">I took it</button><button class="link" data-kind="gone">Not there</button></span>
          </div>
        </li>`).join('')}
    </ul>

    ${activity.length ? `<h2>Recent activity</h2><ul class="activity">${activity.map((a) =>
      `<li>${esc(a.who)} ${KIND_TEXT[a.kind]} <em>${esc(a.title)}</em> · ${timeAgo(a.created_at)}</li>`).join('')}</ul>` : ''}

    <p class="muted small">
      <a href="/api/locations/${l.code}/sign" target="_blank">🖨️ Print an A5 sign with a QR code for this library</a>
    </p>
  </section>`;

  const needLogin = () => { if (!me) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return true; } };

  root.querySelector('#check').onclick = async (e) => {
    if (needLogin()) return;
    e.target.disabled = true;
    try {
      const p = await getPosition();
      await api(`/api/locations/${code}/check`, { method: 'POST', json: p });
      toast('Thanks! Marked as checked.');
    } catch (err) {
      toast(err.body?.error === 'too_far' ? 'You need to be at the library to confirm it.' : err.message);
      e.target.disabled = false;
    }
  };

  root.querySelector('.books').onclick = async (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn || needLogin()) return;
    const li = btn.closest('li');
    const form = new FormData();
    form.append('book_id', li.dataset.id);
    form.append('kind', btn.dataset.kind);
    try { const p = await getPosition({ timeout: 8000 }); form.append('lat', p.lat); form.append('lon', p.lon); } catch {}
    try {
      const r = await api(`/api/locations/${code}/sightings`, { method: 'POST', form });
      toast(r.sighting.status === 'approved' ? 'Thanks — updated.' : 'Thanks — a reviewer will confirm it.');
      if (r.sighting.status === 'approved') li.remove();
    } catch (err) { toast(err.message); }
  };
}
