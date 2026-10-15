import { api } from '../api.js';
import { t, lang } from '../i18n.js';

// Place, country and "all countries" pages: the same HTML the server gives search engines.
export default async function pageView(root) {
  root.innerHTML = `<section class="page"><p class="muted">${t('loading')}</p></section>`;
  try {
    const page = await api(`/api/pages?path=${encodeURIComponent(location.pathname)}&lang=${lang()}`);
    root.innerHTML = `<section class="page seo">${page.html}</section>`;
    document.title = page.title;
  } catch (e) {
    root.innerHTML = `<section class="page"><h1>${t('notfound.title')}</h1><p>${t(e.status === 404 ? 'notfound.title' : 'offline')}</p><p><a href="/">${t('back.map')}</a></p></section>`;
  }
}
