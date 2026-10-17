import { api, getMe } from '../api.js';
import { esc, getPosition, timeAgo, toast, avatarHtml, noStringsNote } from '../ui.js';
import { t, lang } from '../i18n.js';
import { rememberList } from '../pager.js';

export default async function locationView(root, [code]) {
  root.innerHTML = `<section class="page"><p class="muted">${t('loading')}</p></section>`;
  let data;
  try { data = await api(`/api/locations/${code}`); } catch (e) {
    root.innerHTML = `<section class="page"><h1>${t('loc.notfound')}</h1><p>${t(e.status === 404 ? 'loc.notfound_404' : 'offline')}</p><p><a href="/">${t('back.map')}</a></p></section>`;
    return;
  }
  const { location: l, books, taken = [], activity, my_pending, my_pending_edits, my_scans = [] } = data;
  const readyScan = my_scans.find((x) => x.status === 'done');
  const busyScan = my_scans.find((x) => x.status === 'queued' || x.status === 'processing');
  const me = await getMe();
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lon}`;

  root.innerHTML = `
  <section class="page">
    ${l.photo ? `<img class="hero" src="${l.photo.url}" alt="${t('loc.photo_alt')}">` : ''}
    <h1>${esc(l.name || t('free_library'))}</h1>
    ${l.status === 'pending' ? `<p class="note">${t('loc.pending')}</p>` : ''}
    ${l.status === 'removed' ? `<p class="note">${t('loc.removed')}</p>` : ''}
    ${l.restricted ? `<p class="note">${t('loc.restricted')}</p>` : ''}
    ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ''}
    <p class="muted">${l.last_checked_at ? t('loc.checked', { when: timeAgo(l.last_checked_at) }) : t('loc.not_checked')}
      · ${t('loc.code')} <strong dir="ltr">${l.code}</strong>${l.source === 'osm' ? ` · ${t('loc.from_osm_html', { url: l.osm })}` : ''}</p>
    ${l.place ? `<p><a href="/p/${l.place.id}-${l.place.slug}">${esc(t('seo.place_h1', { inPlace: t('seo.in', (lang() === 'he' && l.place.name_he) || l.place.name) }))}</a></p>` : ''}
    <div class="actions">
      <a class="btn primary" href="/l/${l.code}/add">${t('loc.add_books')}</a>
      <button class="btn" id="check">${t('loc.still_here')}</button>
      <a class="btn" href="${nav}" target="_blank" rel="noopener">${t('loc.directions')}</a>
    </div>
    <p class="row"><a class="btn" href="/l/${l.code}/edit">${t('loc.edit')}</a></p>
    ${my_pending ? `<p class="note">${t('loc.my_pending', { n: my_pending })}</p>` : ''}
    ${my_pending_edits ? `<p class="note">${t('loc.my_pending_edits', { n: my_pending_edits })}</p>` : ''}
    ${readyScan ? `<p><a class="btn primary" href="/queue">${t('loc.scan_ready')}</a></p>`
      : busyScan ? `<p class="note"><a href="/queue">${t('loc.scan_waiting')}</a></p>` : ''}
    ${noStringsNote()}

    <h2>${t('loc.shelf')} <span class="count">${books.length}</span></h2>
    ${books.length ? '' : `<p class="muted">${t('loc.no_books')}</p>`}
    <ul class="books">
      ${books.map((b) => `
        <li data-id="${b.id}">
          <a href="/l/${l.code}/b/${b.id}" class="cover-link" data-book>${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="" loading="lazy">` : '<div class="nocover">📖</div>'}</a>
          <div class="meta">
            <a href="/l/${l.code}/b/${b.id}" class="title-link" data-book><strong>${esc(b.title)}</strong></a>
            <span>${esc(b.authors.join(', '))}${b.year ? ` · ${b.year}` : ''}</span>
            <span class="muted">${t('loc.seen', { when: timeAgo(b.last_seen) })}</span>
            ${b.waiting?.others ? `<span class="waiting">👥 ${t('watch.waiting', { n: b.waiting.others, mine: b.waiting.mine })}</span>` : ''}
            <span class="row"><button class="link" data-kind="taken">${t('loc.took')}</button><button class="link" data-kind="gone">${t('loc.gone')}</button></span>
          </div>
        </li>`).join('')}
    </ul>

    ${taken.length ? `<h2>${t('loc.taken_title')} <span class="count">${taken.length}</span></h2>
    <ul class="books taken">${taken.map((b) => `
        <li>
          <a href="/l/${l.code}/b/${b.id}" class="cover-link" data-book>${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="" loading="lazy">` : '<div class="nocover">📖</div>'}</a>
          <div class="meta">
            <a href="/l/${l.code}/b/${b.id}" class="title-link" data-book><strong>${esc(b.title)}</strong></a>
            <span>${esc(b.authors.join(', '))}${b.year ? ` · ${b.year}` : ''}</span>
            <span class="muted">${t(b.kind === 'gone' ? 'loc.gone_when' : 'loc.taken_when', { when: timeAgo(b.taken_at) })}</span>
            ${b.waiting?.others ? `<span class="waiting">👥 ${t('watch.waiting', { n: b.waiting.others, mine: b.waiting.mine })}</span>` : ''}
          </div>
        </li>`).join('')}</ul>` : ''}

    ${activity.length ? `<h2>${t('loc.activity')}</h2><ul class="activity">${activity.map((a) =>
      `<li>${avatarHtml({ avatar: a.avatar, name: a.who }, 22)} ${t(`activity.${a.kind}_html`, { who: esc(a.who), title: esc(a.title) })} · ${timeAgo(a.created_at)}</li>`).join('')}</ul>` : ''}

    <p class="muted small"><a href="/api/locations/${l.code}/sign?lang=${lang()}" target="_blank">${t('loc.print')}</a></p>
  </section>`;

  const needLogin = () => { if (!me) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return true; } };

  root.querySelector('#check').onclick = async (e) => {
    if (needLogin()) return;
    e.target.disabled = true;
    try {
      const p = await getPosition();
      await api(`/api/locations/${code}/check`, { method: 'POST', json: p });
      toast(t('loc.thanks_checked'));
    } catch (err) {
      toast(err.body?.error === 'too_far' ? t('loc.too_far') : err.message);
      e.target.disabled = false;
    }
  };

  rememberList(root);

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
      toast(t(r.sighting.status === 'approved' ? 'loc.thanks_updated' : 'loc.thanks_review'));
      if (r.sighting.status === 'approved') li.remove();
    } catch (err) { toast(err.message); }
  };
}
