import { api, getMe } from '../api.js';
import { navigate } from '../nav.js';
import { esc, toast } from '../ui.js';
import { t } from '../i18n.js';

// Results of a shelf photo / video: the user ticks the books that really are there.
export default async function scanView(root, [id]) {
  const me = await getMe();
  if (!me) return navigate(`/login?next=/scan/${id}`, { replace: true });
  let timer = null;
  let stopped = false;

  async function load() {
    let data;
    try { data = await api(`/api/scans/${id}`); } catch (e) {
      root.innerHTML = `<section class="page"><p>${t(e.status === 404 ? 'notfound.title' : 'offline')}</p></section>`;
      return;
    }
    const { scan, items } = data;
    if (['queued', 'processing'].includes(scan.status)) {
      const p = scan.progress ?? {};
      const msg = scan.status === 'queued' ? t('scan.queued', { n: scan.ahead })
        : p.step === 'reading' ? t('scan.reading', p)
        : p.step === 'matching' ? t('scan.matching', p)
        : t('scan.frames');
      root.innerHTML = `
      <section class="page">
        <p><a href="/l/${scan.code}">${t('back.library')}</a></p>
        <h1>${t('scan.title')}</h1>
        <p class="progress-line"><span class="spinner"></span> ${msg}</p>
        <p class="muted small">${t('scan.wait_note')}</p>
      </section>`;
      if (!stopped) timer = setTimeout(load, 3000);
      return;
    }
    if (scan.status === 'failed' || scan.status === 'confirmed' || !items.length) {
      const msg = scan.status === 'confirmed' ? t('scan.confirmed') : scan.status === 'failed' ? t('scan.failed') : t('scan.none');
      root.innerHTML = `
      <section class="page">
        <h1>${t('scan.title')}</h1>
        <p class="note">${msg}</p>
        <p><a class="btn" href="/l/${scan.code}">${t('back.library')}</a> <a class="btn" href="/l/${scan.code}/add">${t('loc.add_books')}</a></p>
      </section>`;
      return;
    }
    renderResults(scan, items);
  }

  function renderResults(scan, items) {
    root.innerHTML = `
    <section class="page">
      <p><a href="/l/${scan.code}">${t('back.library')}</a></p>
      <h1>${t('scan.title')}</h1>
      <p class="muted">${t('scan.lead')}</p>
      <div class="seg" id="kind">
        <button data-k="seen" class="${scan.kind === 'seen' ? 'on' : ''}">${t('scan.as_seen')}</button>
        <button data-k="added" class="${scan.kind === 'added' ? 'on' : ''}">${t('scan.as_added')}</button>
      </div>
      <ul class="scan-items">
        ${items.map((i) => `
        <li data-id="${i.id}" class="${i.matched ? 'matched' : 'unmatched'}">
          <input type="checkbox" ${i.matched ? 'checked' : ''} aria-label="✓">
          ${i.cover_url ? `<img src="${esc(i.cover_url)}" alt="" loading="lazy">` : i.frame ? `<img src="${esc(i.frame)}" alt="${t('scan.photo_of')}" loading="lazy" class="frame">` : '<div class="nocover">📖</div>'}
          <div class="fields">
            <input name="title" dir="auto" value="${esc(i.matched ? i.book_title : i.title)}" maxlength="300">
            <input name="author" dir="auto" value="${esc(i.matched ? (i.book_authors ?? []).join(', ') : (i.author ?? ''))}" maxlength="200" placeholder="${t('field.author')}">
            <span class="muted small">${i.matched ? `✓ ${t('scan.matched')}${i.year ? ` · ${i.year}` : ''}` : t('scan.unmatched')}${i.via === 'barcode' ? ` · ${t('scan.barcode')}` : ''}</span>
          </div>
        </li>`).join('')}
      </ul>
      <button class="btn primary big" id="confirm"></button>
    </section>`;

    let kind = scan.kind;
    const btn = root.querySelector('#confirm');
    const boxes = () => [...root.querySelectorAll('.scan-items li')];
    const refresh = () => {
      const n = boxes().filter((li) => li.querySelector('input[type=checkbox]').checked).length;
      btn.textContent = t('scan.confirm', { n });
      btn.disabled = !n;
    };
    refresh();
    root.querySelector('.scan-items').addEventListener('change', refresh);
    // Editing a title means the user vouches for it: tick it.
    root.querySelector('.scan-items').addEventListener('input', (e) => {
      if (e.target.name) { e.target.closest('li').querySelector('input[type=checkbox]').checked = true; refresh(); }
    });
    root.querySelectorAll('#kind button').forEach((b) => {
      b.onclick = () => {
        kind = b.dataset.k;
        root.querySelectorAll('#kind button').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    btn.onclick = async () => {
      const picked = boxes().filter((li) => li.querySelector('input[type=checkbox]').checked).map((li) => {
        const item = items.find((i) => String(i.id) === li.dataset.id);
        const title = li.querySelector('[name=title]').value.trim();
        const author = li.querySelector('[name=author]').value.trim();
        const shownTitle = item.matched ? item.book_title : item.title;
        const shownAuthor = item.matched ? (item.book_authors ?? []).join(', ') : (item.author ?? '');
        // Unchanged matched rows keep their catalogue record.
        return title === shownTitle && author === shownAuthor ? { id: item.id } : { id: item.id, title, author };
      });
      btn.disabled = true;
      try {
        const r = await api(`/api/scans/${id}/confirm`, { method: 'POST', json: { items: picked, kind } });
        toast(`${t('scan.done', { n: r.added })}${r.status === 'pending' ? ` ${t('loc.thanks_review')}` : ''}`);
        navigate(`/l/${scan.code}`, { replace: true });
      } catch (e) { toast(e.message); btn.disabled = false; }
    };
  }

  await load();
  return () => { stopped = true; clearTimeout(timer); };
}
