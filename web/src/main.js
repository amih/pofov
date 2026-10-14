import './style.css';
import { initUpdates, maybeApply } from './update.js';
import { startQueue, onQueueChange, flush } from './queue.js';
import { toast, avatarHtml } from './ui.js';
import { getMe } from './api.js';
import { navigate } from './nav.js';
import { trackPageView } from './analytics.js';
import mapView from './views/map.js';
import locationView from './views/location.js';
import addLocationView from './views/add-location.js';
import addBookView from './views/add-book.js';
import loginView from './views/login.js';
import meView from './views/me.js';
import topView from './views/top.js';
import reviewView from './views/review.js';
import aboutView from './views/about.js';

const routes = [
  [/^\/$/, mapView],
  [/^\/l\/([A-Za-z0-9]{4,10})\/add$/, addBookView],
  [/^\/l\/([A-Za-z0-9]{4,10})$/, locationView],
  [/^\/add$/, addLocationView],
  [/^\/login$/, loginView],
  [/^\/me$/, meView],
  [/^\/top$/, topView],
  [/^\/review$/, reviewView],
  [/^\/about$/, aboutView],
];

const main = document.getElementById('view');
let cleanup = null;

async function render() {
  maybeApply(); // a waiting update is applied between screens
  cleanup?.();
  cleanup = null;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const [, view, params] = routes.map(([re, v]) => [re, v, path.match(re)]).find(([, , m]) => m) ?? [];
  document.querySelectorAll('nav.tabs a').forEach((a) => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === '/' ? path === '/' : path.startsWith(href));
  });
  document.body.classList.toggle('full', path === '/');
  const me = await getMe();
  if (me && !me.screen_name && !['/me', '/about'].includes(path)) {
    sessionStorage.setItem('pofov:next', location.pathname + location.search);
    history.replaceState(null, '', '/me?welcome=1');
    return render();
  }
  main.innerHTML = '';
  window.scrollTo(0, 0);
  if (!view) {
    main.innerHTML = '<section class="page"><h1>Not found</h1><p><a href="/">Back to the map</a></p></section>';
    return;
  }
  trackPageView();
  cleanup = (await view(main, params.slice(1), new URLSearchParams(location.search))) || null;
}


document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', render);
window.addEventListener('pofov:navigate', render);

const badge = document.getElementById('queue-badge');
onQueueChange((n) => {
  badge.hidden = !n;
  badge.textContent = `${n} waiting to upload`;
});

initUpdates();
startQueue();
window.addEventListener('online', async () => {
  const sent = await flush();
  if (sent.length) toast(`Uploaded ${sent.length} saved item${sent.length > 1 ? 's' : ''}`);
});
document.getElementById('app-version').textContent = __APP_VERSION__;
async function showMeTab(e) {
  const me = await getMe(Boolean(e));
  const tab = document.querySelector('nav.tabs a[href="/me"]');
  tab.innerHTML = me ? `${avatarHtml(me, 26)}${me.screen_name ? '' : 'Me'}` : '<span>👤</span>Sign in';
  if (me?.screen_name) tab.insertAdjacentText('beforeend', [...me.screen_name].slice(0, 12).join(''));
}
document.addEventListener('pofov:me', showMeTab);
showMeTab();
render();
