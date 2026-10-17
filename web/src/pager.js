import { navigate } from './nav.js';
import { api } from './api.js';
import { t } from './i18n.js';

// A list of books remembers its order when one is opened; the book's page then shows
// "‹ 3 / 12 ›" and a sideways swipe goes to the next or previous book of that list.
const KEY = 'seferehov:pager';

export function rememberList(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-book]');
    if (!a) return;
    const urls = [...new Set([...root.querySelectorAll('a[data-book]')].map((x) => x.getAttribute('href')))];
    try { sessionStorage.setItem(KEY, JSON.stringify(urls)); } catch { /* no paging */ }
  }, { capture: true });
}

function list() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) ?? []; } catch { return []; }
}

export function pagerHtml() {
  const urls = list(), i = urls.indexOf(location.pathname);
  if (i < 0 || urls.length < 2) return '';
  return `<nav class="pager"><button class="link" data-page="-1" ${i ? '' : 'disabled'}>${t('pager.prev')}</button>
    <span class="muted small">${t('pager.of', { i: i + 1, n: urls.length })}</span>
    <button class="link" data-page="1" ${i < urls.length - 1 ? '' : 'disabled'}>${t('pager.next')}</button></nav>`;
}

// A book's data, by its page: fetched ahead for the books next to the one shown, so a
// swipe opens them at once (the first look-up of a book's details can take seconds).
const ahead = new Map(); // page path -> { at, data: Promise }
const apiFor = (path) => {
  let m = path.match(/^\/l\/([A-Za-z0-9]+)\/b\/(\d+)$/);
  if (m) return `/api/locations/${m[1]}/books/${m[2]}`;
  m = path.match(/^\/books\/(\d+)$/);
  return m ? `/api/my-books/${m[1]}` : null;
};
export function loadBook(path, { fresh = false } = {}) {
  const hit = ahead.get(path);
  ahead.delete(path);
  if (!fresh && hit && Date.now() - hit.at < 120_000) {
    // Still being looked up when fetched ahead: ask again, it is likely done by now.
    return hit.data.then((d) => (d.book?.details_pending ? api(apiFor(path)) : d), () => api(apiFor(path)));
  }
  return api(apiFor(path));
}
function fetchAhead(path) {
  if (!apiFor(path) || ahead.has(path)) return;
  const data = api(apiFor(path));
  ahead.set(path, { at: Date.now(), data });
  data.then((d) => { // pictures too
    const url = d.photos?.find((p) => p.kind === 'cover')?.url || d.book?.front_url || d.book?.cover_url;
    if (url) new Image().src = url;
  }, () => ahead.delete(path));
}
export function prefetchNeighbours() {
  const urls = list(), i = urls.indexOf(location.pathname);
  if (i < 0) return;
  [urls[i + 1], urls[i - 1]].filter(Boolean).forEach(fetchAhead);
}

// Buttons, arrow keys, and a sideways swipe outside the picture gallery. One set of
// handlers per screen: attaching again (the page re-renders) drops the earlier set.
export function attachPager(root) {
  root._unpage?.();
  const go = (d) => {
    const urls = list(), i = urls.indexOf(location.pathname);
    const to = urls[i + d];
    if (i >= 0 && to) navigate(to, { replace: true });
  };
  const onClick = (e) => { const b = e.target.closest('[data-page]'); if (b) go(Number(b.dataset.page)); };
  const ltr = () => document.documentElement.dir !== 'rtl';
  const onKey = (e) => {
    if (document.querySelector('.viewer') || /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') go(ltr() ? 1 : -1);
    if (e.key === 'ArrowLeft') go(ltr() ? -1 : 1);
  };
  let x0 = null, y0 = null;
  const start = (e) => {
    x0 = e.touches.length === 1 && !e.target.closest('.gallery, .viewer') ? e.touches[0].clientX : null;
    y0 = e.touches[0].clientY;
  };
  const end = (e) => {
    if (x0 == null || window.visualViewport?.scale > 1.05) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    // Swiping toward the reading direction's start brings the next book, like turning a page.
    go((dx < 0) === ltr() ? 1 : -1);
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchend', end, { passive: true });
  root._unpage = () => {
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('click', onClick);
    root.removeEventListener('touchstart', start);
    root.removeEventListener('touchend', end);
    root._unpage = null;
  };
  prefetchNeighbours();
  return root._unpage;
}
