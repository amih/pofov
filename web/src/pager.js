import { navigate } from './nav.js';
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

// Buttons, arrow keys, and a sideways swipe outside the picture gallery.
export function attachPager(root) {
  const go = (d) => {
    const urls = list(), i = urls.indexOf(location.pathname);
    const to = urls[i + d];
    if (i >= 0 && to) navigate(to, { replace: true });
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) go(Number(b.dataset.page)); });
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
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchend', end, { passive: true });
  return () => document.removeEventListener('keydown', onKey);
}
