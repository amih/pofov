import { api } from '../api.js';
import { esc, timeAgo } from '../ui.js';
import { t } from '../i18n.js';
import { watchDialog } from '../watch.js';

// One book at one library: large pictures (photos taken at the shelf, the front and
// back covers found online), the back-cover text, and whether it is still there.
export default async function bookView(root, [code, id]) {
  root.innerHTML = `<section class="page"><p class="muted">${t('loading')}</p></section>`;
  let data;
  try { data = await api(`/api/locations/${code}/books/${id}`); } catch (e) {
    root.innerHTML = `<section class="page"><h1>${t(e.status === 404 ? 'notfound.title' : 'offline')}</h1><p><a href="/l/${code}">${t('back.library')}</a></p></section>`;
    return;
  }
  const { book: b, photos, here, waiting, location: l } = data;
  // Covers and the back-cover text are still being looked up: show this, then look again.
  let again = null;
  if (b.details_pending) again = setTimeout(() => { if (location.pathname === `/l/${code}/b/${id}`) bookView(root, [code, id]); }, 6000);

  // A cover photo taken at the shelf first; then the covers found online (so a
  // blurry spine is never all there is); then the spine cut-outs and whole-shelf photos.
  const pics = [
    ...photos.filter((p) => p.kind === 'cover').map((p) => ({ url: p.url, label: t('book.pic_cover_here', { when: timeAgo(p.at) }) })),
    ...(b.front_url || b.cover_url ? [{ url: b.front_url || b.cover_url, label: t('book.pic_front') }] : []),
    ...(b.back_url ? [{ url: b.back_url, label: t('book.pic_back') }] : []),
    ...photos.filter((p) => p.kind === 'spine').map((p) => ({ url: p.url, label: t('book.pic_spine', { when: timeAgo(p.at) }), wide: true })),
    ...photos.filter((p) => p.kind === 'shelf').map((p) => ({ url: p.url, label: t('book.pic_shelf', { when: timeAgo(p.at) }), wide: true })),
  ];

  root.innerHTML = `
  <section class="page book-page">
    <p><a href="/l/${code}">${t('back.to', { name: esc(l.name || t('free_library')) })}</a></p>
    ${pics.length ? `<div class="gallery">${pics.map((p, i) => `
      <figure class="${p.wide ? 'wide' : ''}"><button class="pic" data-i="${i}" aria-label="${esc(p.label)}"><img src="${esc(p.url)}" alt="" loading="${i ? 'lazy' : 'eager'}"></button><figcaption>${esc(p.label)}</figcaption></figure>`).join('')}</div>
      ${pics.length > 1 ? `<p class="muted small center">${t('book.swipe', { n: pics.length })}</p>` : ''}` : '<div class="nocover big">📖</div>'}
    <h1>${esc(b.title)}</h1>
    <p>${esc((b.authors ?? []).join(', '))}${b.year ? ` · ${b.year}` : ''}${b.publisher ? ` · ${esc(b.publisher)}` : ''}</p>
    ${here ? `<p class="${here.present ? 'ok' : 'muted'}">${here.present ? t('book.here', { when: timeAgo(here.at) }) : t(here.kind === 'gone' ? 'loc.gone_when' : 'loc.taken_when', { when: timeAgo(here.at) })}</p>` : ''}
    ${b.description ? `<h2>${t('book.blurb')}</h2><p class="desc blurb" dir="auto">${esc(b.description)}</p>`
      : b.details_pending ? `<p class="progress-line small"><span class="spinner"></span> ${t('book.looking')}</p>` : `<p class="muted small">${t('book.no_blurb')}</p>`}
    ${waiting?.others ? `<p class="waiting">👥 ${t('watch.waiting', { n: waiting.others, mine: waiting.mine })}</p>` : ''}
    <p class="row"><button class="btn" id="watch">${t(waiting?.mine ? 'watch.on' : 'watch.button')}</button></p>
    ${b.isbn13 ? `<p class="muted small" dir="ltr">ISBN ${esc(b.isbn13)}</p>` : ''}
    ${b.details_source ? `<p class="muted small">${t('book.source', { src: esc(b.details_source) })}</p>` : ''}
  </section>`;

  root.querySelector('#watch').onclick = () => watchDialog({ book: { ...b, waiting }, code });
  root.querySelector('.gallery')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (btn) viewer(pics, Number(btn.dataset.i));
  });
  return () => clearTimeout(again);
}

// Full-screen picture, pinch to zoom, arrows/swipe between pictures.
function viewer(pics, start) {
  let i = start;
  const el = document.createElement('div');
  el.className = 'viewer';
  el.innerHTML = `<button class="x" aria-label="${esc(t('menu.close'))}">✕</button>
    <div class="viewer-img"><img alt=""></div><p class="viewer-cap"></p>
    ${pics.length > 1 ? '<button class="prev" aria-label="‹">‹</button><button class="next" aria-label="›">›</button>' : ''}`;
  const img = el.querySelector('img');
  const show = () => { img.src = pics[i].url; el.querySelector('.viewer-cap').textContent = `${pics[i].label} (${i + 1}/${pics.length})`; };
  const step = (d) => { i = (i + d + pics.length) % pics.length; show(); };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  el.addEventListener('click', (e) => {
    if (e.target.closest('.x')) close();
    else if (e.target.closest('.prev')) step(-1);
    else if (e.target.closest('.next')) step(1);
  });
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null || window.visualViewport?.scale > 1.05) return; // zoomed in: the finger pans
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  });
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  show();
}
