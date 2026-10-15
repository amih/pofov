import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { startScanner, scanImage } from '../scanner.js';
import { esc, getPosition, shrinkImage, toast, noStringsNote, dialog } from '../ui.js';
import { t, lang } from '../i18n.js';

export default async function addBookView(root, [code]) {
  const me = await getMe();
  if (!me) return navigate(`/login?next=/l/${code}/add`, { replace: true });

  root.innerHTML = `
  <section class="page">
    <p><a href="/l/${code}">${t('back.library')}</a></p>
    <h1>${t('addbook.title')}</h1>
    ${noStringsNote()}
    <h2>${t('addbook.mode')}</h2>
    <div class="seg" id="mode"><button data-k="seen" class="on">${t('addbook.mode_seen')}</button><button data-k="added">${t('addbook.mode_added')}</button></div>
    <p class="muted small">${t('addbook.mode_note')}</p>

    <h2>${t('addbook.shelf_title')}</h2>
    <p class="muted">${t('addbook.shelf_lead')}</p>
    <p class="row">
      <label class="btn primary">${t('addbook.shelf_photos')}<input type="file" accept="image/*" capture="environment" multiple hidden id="shelf"></label>
      <label class="btn">${t('addbook.shelf_video')}<input type="file" accept="video/*" capture="environment" hidden id="video"></label>
    </p>
    <p class="muted small">⏱️ ${t('addbook.limits')}</p>
    <p id="upload" class="muted"></p>

    <h2>${t('addbook.barcode_title')}</h2>
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
  let mode = 'seen';
  root.querySelectorAll('#mode button').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.k;
      root.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
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
        const r = await send({ isbn, title: f.title.value, author: f.author.value, kind: mode });
        addedRow(f.title.value, r.queued ? t('status.offline') : statusText(r));
        result.innerHTML = '';
      };
      return;
    }
    const r = await send({ isbn, kind: mode });
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
  // Shelf photos / video: uploaded, read on the server, confirmed on /scan/:id.
  const uploadText = root.querySelector('#upload');
  async function uploadScan(files) {
    const url = `/api/locations/${code}/scans`;
    const fields = { kind: mode, lang: lang(), lat: pos?.lat ?? '', lon: pos?.lon ?? '' };
    if (!navigator.onLine) {
      await enqueue(url, fields, files, 'shelf');
      toast(t('addbook.queued_offline'));
      return;
    }
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    Object.entries(files).forEach(([k, b]) => fd.append(k, b, b.name || `${k}.jpg`));
    uploadText.textContent = t('addbook.uploading');
    try {
      const { scan } = await api(url, { method: 'POST', form: fd });
      uploadText.textContent = '';
      // ~2.5 min per photo (spine by spine), ~4 min per video, plus the queue ahead.
      const mins = Math.max(2, Math.round(scan.images * 2.5 + (scan.video ? 4 : 0) + scan.ahead * 3));
      const watch = await dialog({
        title: t('scan.sent_title'),
        html: `<p>${t('scan.sent_body', { mins, ahead: scan.ahead })}</p>`,
        ok: t('scan.sent_watch'),
        cancel: t('scan.sent_back'),
      });
      navigate(watch ? `/scan/${scan.id}` : `/l/${code}`);
    } catch (e) {
      uploadText.textContent = '';
      if (e.status === 413) toast(t('addbook.too_large'));
      else if (e instanceof TypeError) { await enqueue(url, fields, files, 'shelf'); toast(t('addbook.queued_offline')); }
      else toast(e.message);
    }
  }
  root.querySelector('#shelf').onchange = async (e) => {
    const list = [...e.target.files].slice(0, 8);
    e.target.value = '';
    if (!list.length) return;
    uploadText.textContent = t('addbook.uploading');
    const files = {};
    for (const [i, f] of list.entries()) files[`photo${i}`] = await shrinkImage(f, 2400);
    uploadScan(files);
  };
  root.querySelector('#video').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) return toast(t('addbook.too_large'));
    uploadScan({ video: f });
  };

  const noisbn = root.querySelector('#noisbn');
  noisbn.onsubmit = async (e) => {
    e.preventDefault();
    const file = noisbn.photo.files[0];
    const photo = file ? await shrinkImage(file) : null;
    const r = await send({ title: noisbn.title.value, author: noisbn.author.value, kind: mode }, { photo });
    addedRow(noisbn.title.value, r.queued ? t('status.offline') : statusText(r));
    noisbn.reset();
  };

  return () => stop?.();
}
