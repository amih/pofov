import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { startScanner, scanImage } from '../scanner.js';
import { esc, getPosition, shrinkImage, toast } from '../ui.js';

export default async function addBookView(root, [code]) {
  const me = await getMe();
  if (!me) return navigate(`/login?next=/l/${code}/add`, { replace: true });

  root.innerHTML = `
  <section class="page">
    <p><a href="/l/${code}">← Back to the library</a></p>
    <h1>Add books</h1>
    <p class="muted">Point the camera at the barcode on the back cover. Keep going — scan one book after another.</p>
    <div class="scanner"><video muted></video><div class="frame"></div></div>
    <p class="row">
      <button class="btn" id="cam">▶ Start camera</button>
      <label class="btn">🖼️ Photo of barcode<input type="file" accept="image/*" capture="environment" hidden id="still"></label>
    </p>
    <form id="manual" class="row form-inline">
      <input name="isbn" inputmode="numeric" placeholder="or type the ISBN" autocomplete="off">
      <button class="btn">Look up</button>
    </form>
    <div id="result"></div>
    <h2>Added this visit <span class="count" id="n">0</span></h2>
    <ul class="added" id="added"></ul>
    <details class="nobarcode"><summary>Book has no barcode?</summary>
      <form id="noisbn" class="form">
        <label>Title <input name="title" required maxlength="300"></label>
        <label>Author <input name="author" maxlength="200"></label>
        <label class="photo-pick small"><input type="file" name="photo" accept="image/*" capture="environment" hidden><span>📷 Photo of the cover (optional)</span></label>
        <button class="btn primary">Add this book</button>
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
    result.innerHTML = `<p class="muted">Looking up ${esc(isbn)}…</p>`;
    let book = null;
    if (navigator.onLine) {
      try { book = (await api(`/api/books/lookup?isbn=${encodeURIComponent(isbn)}`)).book; } catch (e) {
        if (e.body?.error === 'invalid_isbn') { result.innerHTML = '<p class="note">That is not a valid ISBN.</p>'; return; }
      }
    }
    if (!book && navigator.onLine) {
      result.innerHTML = `
        <div class="card">
          <p>We couldn't find ISBN ${esc(isbn)} in the open book catalogues. Please type the title:</p>
          <form class="form" id="unknown">
            <label>Title <input name="title" required maxlength="300"></label>
            <label>Author <input name="author" maxlength="200"></label>
            <button class="btn primary">Add</button>
          </form>
        </div>`;
      result.querySelector('#unknown').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const r = await send({ isbn, title: f.title.value, author: f.author.value, kind: 'seen' });
        addedRow(f.title.value, r.queued ? 'saved offline' : statusText(r));
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
        <br><button class="link" id="took">Actually, I'm taking this one</button></div>
      </div>`;
    addedRow(title, r.queued ? 'saved offline' : statusText(r));
    result.querySelector('#took').onclick = async () => {
      await send({ isbn, kind: 'taken' });
      toast('Enjoy the book! Marked as taken.');
      result.innerHTML = '';
    };
  }

  const statusText = (r) => (r.sighting?.status === 'approved' ? '✓' : 'waiting for review');

  root.querySelector('#cam').onclick = async (e) => {
    if (stop) { stop(); stop = null; e.target.textContent = '▶ Start camera'; return; }
    try {
      stop = await startScanner(video, handleIsbn);
      e.target.textContent = '■ Stop camera';
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Could not start the camera — use “Photo of barcode”.');
    }
  };
  root.querySelector('#still').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    result.innerHTML = '<p class="muted">Reading barcode…</p>';
    const isbn = await scanImage(file).catch(() => null);
    e.target.value = '';
    if (isbn) handleIsbn(isbn);
    else result.innerHTML = '<p class="note">No book barcode found in that photo. Try closer, with good light, or type the ISBN.</p>';
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
    addedRow(noisbn.title.value, r.queued ? 'saved offline' : statusText(r));
    noisbn.reset();
  };

  return () => stop?.();
}
