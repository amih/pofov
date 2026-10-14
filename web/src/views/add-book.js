import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { startScanner, scanImage } from '../scanner.js';
import { esc, getPosition, shrinkImage, toast } from '../ui.js';
import { t } from '../i18n.js';

export default async function addBookView(root, [code]) {
  const me = await getMe();
  if (!me) return navigate(`/login?next=/l/${code}/add`, { replace: true });

  root.innerHTML = `
  <section class="page">
    <p><a href="/l/${code}">${t('back.library')}</a></p>
    <h1>${t('addbook.title')}</h1>
    <p class="muted">${t('addbook.lead')}</p>
    <div class="scanner"><video muted></video><div class="frame"></div></div>
    <p class="row">
      <button class="btn" id="cam">${t('addbook.start')}</button>
      <label class="btn">${t('addbook.photo')}<input type="file" accept="image/*" capture="environment" hidden id="still"></label>
    </p>
    <form id="manual" class="row form-inline">
      <input name="isbn" inputmode="numeric" placeholder="${t('addbook.isbn_ph')}" dir="ltr" autocomplete="off">
      <button class="btn">${t('addbook.lookup')}</button>
    </form>
    <div id="result"></div>
    <h2>${t('addbook.added')} <span class="count" id="n">0</span></h2>
    <ul class="added" id="added"></ul>
    <details class="nobarcode"><summary>${t('addbook.nobarcode')}</summary>
      <form id="noisbn" class="form">
        <label>${t('field.title')} <input name="title" required maxlength="300"></label>
        <label>${t('field.author')} <input name="author" maxlength="200"></label>
        <label class="photo-pick small"><input type="file" name="photo" accept="image/*" capture="environment" hidden><span>${t('addbook.cover_photo')}</span></label>
        <button class="btn primary">${t('addbook.add_this')}</button>
      </form>
    </details>
  </section>`;

  const video = root.querySelector('video');
  const result = root.querySelector('#result');
  const added = root.querySelector('#added');
  let stop = null;
  let pos = null;
  let count = 0;
  getPosition().then((p) => { pos = p; }).catch(() => {});

  async function send(fields, files = {}) {
    const all = { ...fields, lat: pos?.lat ?? '', lon: pos?.lon ?? '' };
    const url = `/api/locations/${code}/sightings`;
    if (!navigator.onLine) {
      await enqueue(url, all, files, 'book');
      return { queued: true };
    }
    const fd = new FormData();
    Object.entries(all).forEach(([k, v]) => fd.append(k, v));
    Object.entries(files).forEach(([k, b]) => b && fd.append(k, b, `${k}.jpg`));
    try {
      return await api(url, { method: 'POST', form: fd });
    } catch (e) {
      if (e instanceof TypeError) { await enqueue(url, all, files, 'book'); return { queued: true }; }
      throw e;
    }
  }

  function addedRow(title, status) {
    count++;
    root.querySelector('#n').textContent = count;
    added.insertAdjacentHTML('afterbegin', `<li>${esc(title)} <span class="muted">${status}</span></li>`);
  }

  async function handleIsbn(isbn) {
    result.innerHTML = `<p class="muted">${t('addbook.looking', { isbn: esc(isbn) })}</p>`;
    let book = null;
    if (navigator.onLine) {
      try { book = (await api(`/api/books/lookup?isbn=${encodeURIComponent(isbn)}`)).book; } catch (e) {
        if (e.body?.error === 'invalid_isbn') { result.innerHTML = `<p class="note">${t('addbook.invalid')}</p>`; return; }
      }
    }
    if (!book && navigator.onLine) {
      result.innerHTML = `
        <div class="card">
          <p>${t('addbook.unknown', { isbn: esc(isbn) })}</p>
          <form class="form" id="unknown">
            <label>${t('field.title')} <input name="title" required maxlength="300"></label>
            <label>${t('field.author')} <input name="author" maxlength="200"></label>
            <button class="btn primary">${t('add')}</button>
          </form>
        </div>`;
      result.querySelector('#unknown').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const r = await send({ isbn, title: f.title.value, author: f.author.value, kind: 'seen' });
        addedRow(f.title.value, r.queued ? t('status.offline') : statusText(r));
        result.innerHTML = '';
      };
      return;
    }
    const r = await send({ isbn, kind: 'seen' });
    const title = book?.title ?? `ISBN ${isbn}`;
    result.innerHTML = `
      <div class="card book-card">
        ${book?.cover_url ? `<img src="${esc(book.cover_url)}" alt="">` : ''}
        <div><strong>${esc(title)}</strong><br><span class="muted">${esc(book?.authors?.join(', ') ?? '')}</span>
        <br><button class="link" id="took">${t('addbook.taking')}</button></div>
      </div>`;
    addedRow(title, r.queued ? t('status.offline') : statusText(r));
    result.querySelector('#took').onclick = async () => {
      await send({ isbn, kind: 'taken' });
      toast(t('addbook.enjoy'));
      result.innerHTML = '';
    };
  }

  const statusText = (r) => (r.sighting?.status === 'approved' ? '✓' : t('status.review'));

  root.querySelector('#cam').onclick = async (e) => {
    if (stop) { stop(); stop = null; e.target.textContent = t('addbook.start'); return; }
    try {
      stop = await startScanner(video, handleIsbn);
      e.target.textContent = t('addbook.stop');
    } catch (err) {
      toast(t(err.name === 'NotAllowedError' ? 'cam.denied' : 'cam.fail'));
    }
  };
  root.querySelector('#still').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    result.innerHTML = `<p class="muted">${t('addbook.reading')}</p>`;
    const isbn = await scanImage(file).catch(() => null);
    e.target.value = '';
    if (isbn) handleIsbn(isbn);
    else result.innerHTML = `<p class="note">${t('addbook.nofound')}</p>`;
  };
  root.querySelector('#manual').onsubmit = (e) => {
    e.preventDefault();
    const v = e.target.isbn.value.replace(/[^0-9Xx]/g, '');
    if (v) handleIsbn(v);
    e.target.reset();
  };
  const noisbn = root.querySelector('#noisbn');
  noisbn.onsubmit = async (e) => {
    e.preventDefault();
    const file = noisbn.photo.files[0];
    const photo = file ? await shrinkImage(file) : null;
    const r = await send({ title: noisbn.title.value, author: noisbn.author.value, kind: 'seen' }, { photo });
    addedRow(noisbn.title.value, r.queued ? t('status.offline') : statusText(r));
    noisbn.reset();
  };

  return () => stop?.();
}
