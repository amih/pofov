import { dialog, esc } from './ui.js';
import { t } from './i18n.js';

// Chrome/Android shows its own install prompt rarely (and never again once dismissed),
// so keep its event and offer installing from our banner and menu. iPhone has no
// such event: we show the Share → Add to Home Screen steps instead.
const DISMISS_KEY = 'seferehov:install-dismissed';
const DISMISS_DAYS = 30;
let deferred = null;

export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const canOfferInstall = () => !isInstalled() && (Boolean(deferred) || isIos());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  showBanner();
});
window.addEventListener('appinstalled', () => { deferred = null; document.getElementById('install-banner')?.remove(); });

export async function install() {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    document.getElementById('install-banner')?.remove();
    return;
  }
  await dialog({ title: t('install.how_title'), html: `<p>${t('about.install_html')}</p>`, ok: 'OK' });
}

function dismissedRecently() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 86400_000; } catch { return false; }
}

export function showBanner() {
  if (!canOfferInstall() || dismissedRecently() || document.getElementById('install-banner')) return;
  const el = document.createElement('div');
  el.id = 'install-banner';
  el.className = 'install-banner';
  el.innerHTML = `<img src="/icons/icon-v2-192.png" alt="" width="36" height="36"><span>${esc(t('install.banner'))}</span>
    <button class="btn primary" data-i="yes">${esc(t('install.yes'))}</button><button class="x" data-i="no" aria-label="${esc(t('install.later'))}">✕</button>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    if (b.dataset.i === 'yes') install();
    else { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {} el.remove(); }
  };
  document.body.append(el);
}

// iPhone: no event ever fires, so offer the steps on the second visit.
if (isIos() && !isInstalled()) {
  try {
    const n = Number(localStorage.getItem('seferehov:visits') || 0) + 1;
    localStorage.setItem('seferehov:visits', String(n));
    if (n >= 2) setTimeout(showBanner, 4000);
  } catch {}
}
