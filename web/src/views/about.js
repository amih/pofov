import { checkForUpdate, hardReset, isUpdateWaiting, maybeApply } from '../update.js';
import { toast } from '../ui.js';
import { t, lang, setLang } from '../i18n.js';

export default function aboutView(root) {
  root.innerHTML = `
  <section class="page">
    <h1>${t('about.title')}</h1>
    <p>${t('about.lead_html')}</p>
    <ul>
      <li>${t('about.li1')}</li>
      <li>${t('about.li2')}</li>
      <li>${t('about.li3')}</li>
    </ul>
    <h2>${t('lang.label')}</h2>
    <div class="seg" id="langs"><button data-l="he" lang="he">עברית</button><button data-l="en" lang="en">English</button></div>
    <h2>${t('about.install')}</h2>
    <p>${t('about.install_html')}</p>
    <h2>${t('about.version')}</h2>
    <p>${t('about.running_html', { v: __APP_VERSION__ })}</p>
    <p class="row"><button class="btn" id="upd">${t('about.check')}</button><button class="btn" id="reset">${t('about.repair')}</button></p>
    <h2>${t('about.data')}</h2>
    <p class="small">${t('about.data_html')}</p>
  </section>`;
  root.querySelectorAll('#langs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.l === lang());
    b.onclick = () => setLang(b.dataset.l);
  });
  root.querySelector('#upd').onclick = async () => {
    checkForUpdate();
    toast(t('about.checking'));
    setTimeout(() => {
      if (isUpdateWaiting()) { toast(t('about.installing')); maybeApply(); }
      else toast(t('about.latest'));
    }, 3000);
  };
  root.querySelector('#reset').onclick = () => {
    if (confirm(t('about.reset_confirm'))) hardReset();
  };
}
