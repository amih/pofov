import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { startScanner, scanImage } from '../scanner.js';
import { esc, shrinkImage, timeAgo, toast } from '../ui.js';
import { t } from '../i18n.js';
import { placeBook } from '../mybooks.js';

// The reader's own books, scanned at home. Later, "I left it in a library" reports it there.
export default async function myBooksView(root) {
  const me = await getMe();
  if (!me) return navigate('/login?next=/books', { replace: true });

  root.innerHTML = `
  <section class="page">
    <h1>${t('mybooks.title')}</h1>
    <p class="muted">${t('mybooks.lead')}</p>
    <div class="scanner live" hidden><video muted playsinline></video><div class="frame"></div></div>
    <p class="row">
      <button class="btn primary" id="cam">${t('mybooks.scan')}</button>
      <label class="btn">${t('addbook.photo')}<input type="file" accept="image/*" capture="environment" hidden id="still"></label>
    </p>
    <p class="decoded" id="decoded" dir="ltr" hidden></p>
    <div id="result"></div>
    <form id="manual" class="row form-inline">
      <input name="isbn" inputmode="numeric" placeholder="${t('addbook.isbn_ph')}" dir="ltr" autocomplete="off">
      <button class="btn">${t('add')}</button>
    </form>
    <details class="nobarcode"><summary>${t('addbook.nobarcode')}</summary>
      <form id="noisbn" class="form">
        <input type="hidden" name="isbn">
        <label>${t('field.title')} <input name="title" required maxlength="300" dir="auto"></label>
        <label>${t('field.author')} <input name="author" maxlength="200" dir="auto"></label>
        <label class="photo-pick small"><input type="file" name="photo" accept="image/*" capture="environment" hidden><span>${t('addbook.cover_photo')}</span></label>
        <button class="btn primary">${t('addbook.add_this')}</button>
      </form>
    </details>
    <div id="lists"><p class="muted">${t('loading')}</p></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const scanner = $('.scanner'), video = $('video'), decoded = $('#decoded'), result = $('#result'), noisbn = $('#noisbn');
  const say = (text, isbn = false) => { decoded.hidden = false; decoded.textContent = text; decoded.classList.toggle('isbn', isbn); };

  const cover = (r) => (r.photo?.thumb || r.cover_url
    ? `<img src="${esc(r.photo?.thumb || r.cover_url)}" alt="" loading="lazy">` : '<div class="nocover">📖</div>');
  async function showLists() {
    let d;
    try { d = await api('/api/my-books'); } catch { $('#lists').innerHTML = `<p class="note">${t('offline')}</p>`; return; }
    $('#lists').innerHTML = `
      <h2>${t('mybooks.home')} <span class="count">${d.home.length}</span></h2>
      ${d.home.length ? `<ul class="books">${d.home.map((r) => `
        <li data-id="${r.id}">${cover(r)}<div class="meta">
          <strong>${esc(r.title)}</strong><span class="muted">${esc((r.authors ?? []).join(', '))}</span>
          <span class="row"><button class="btn small primary" data-place="${r.id}">📍 ${t('mybooks.left_it')}</button>
          <button class="btn small" data-del="${r.id}" aria-label="${esc(t('mybooks.remove'))}">✕</button></span></div></li>`).join('')}</ul>`
        : `<p class="muted small">${t('mybooks.empty')}</p>`}
      ${d.placed.length ? `<h2>${t('mybooks.placed_title')} <span class="count">${d.placed.length}</span></h2>
      <ul class="books">${d.placed.map((r) => `
        <li>${cover(r)}<div class="meta">
          <a class="title-link" href="/l/${r.code}/b/${r.book_id}"><strong>${esc(r.title)}</strong></a>
          <span class="muted">${esc((r.authors ?? []).join(', '))}</span>
          <span class="small">📍 <a href="/l/${r.code}">${esc(r.location_name || t('free_library'))}</a> · ${timeAgo(r.placed_at)}${r.sighting_status === 'pending' ? ` · ${t('mybooks.pending')}` : ''}</span></div></li>`).join('')}</ul>` : ''}`;
    homeRows = d.home;
  }
  let homeRows = [];
  $('#lists').addEventListener('click', async (e) => {
    const p = e.target.closest('[data-place]'), del = e.target.closest('[data-del]');
    if (p) {
      const item = homeRows.find((r) => r.id === Number(p.dataset.place));
      if (item && await placeBook(item)) showLists();
    } else if (del) {
      await api(`/api/my-books/${del.dataset.del}`, { method: 'DELETE' }).catch((err) => toast(err.message));
      showLists();
    }
  });

  // Adds one book: by ISBN, or by title (with the ISBN when no catalogue knew it).
  async function add(fields, photo = null) {
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => v != null && fd.append(k, v));
      if (photo) fd.append('photo', photo, 'photo.jpg');
      const r = await api('/api/my-books', { method: 'POST', form: fd });
      result.innerHTML = `<div class="card book-card">
        ${r.book.cover_url ? `<img src="${esc(r.book.cover_url)}" alt="">` : '<div class="nocover">📖</div>'}
        <div><strong>${esc(r.book.title)}</strong><br><span class="muted">${esc((r.book.authors ?? []).join(', '))}</span><br>
        <span class="ok">✓ ${t(r.already ? 'mybooks.already' : 'mybooks.added')}</span></div></div>`;
      showLists();
      return true;
    } catch (e) {
      if (e instanceof TypeError) {
        await enqueue('/api/my-books', fields, photo ? { photo } : {}, 'book');
        result.innerHTML = `<p class="note">${t('bc.saved_offline')}</p>`;
        return true;
      }
      if (e.body?.error === 'book_not_found') {
        // No catalogue knows this ISBN: ask for the title, keep the ISBN.
        noisbn.isbn.value = e.body.isbn;
        root.querySelector('.nobarcode').open = true;
        result.innerHTML = `<p class="note">${t('addbook.unknown', { isbn: esc(e.body.isbn) })}</p>`;
        noisbn.title.focus();
      } else result.innerHTML = `<p class="note">${e.body?.error === 'invalid_isbn' ? t('addbook.invalid') : esc(e.message)}</p>`;
      return false;
    }
  }

  const seen = new Set();
  async function handleIsbn(isbn) {
    say(isbn, true);
    if (seen.has(isbn)) return;
    seen.add(isbn);
    result.innerHTML = `<p class="muted">${t('addbook.looking', { isbn: esc(isbn) })}</p>`;
    if (!await add({ isbn })) seen.delete(isbn);
  }

  let stop = null;
  $('#cam').onclick = async () => {
    if (stop) { stop(); stop = null; scanner.hidden = true; $('#cam').textContent = t('mybooks.scan'); return; }
    scanner.hidden = false;
    try {
      stop = await startScanner(video, handleIsbn);
      $('#cam').textContent = t('addbook.stop');
      say(t('bc.point'));
    } catch (err) {
      scanner.hidden = true;
      toast(t(err.name === 'NotAllowedError' ? 'cam.denied' : 'cam.fail'));
    }
  };
  $('#still').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    say(t('addbook.reading'));
    const isbn = await scanImage(file).catch(() => null);
    if (isbn) handleIsbn(isbn);
    else result.innerHTML = `<p class="note">${t('addbook.nofound')}</p>`;
  };
  $('#manual').onsubmit = (e) => {
    e.preventDefault();
    const v = e.target.isbn.value.replace(/[^0-9Xx-]/g, ''); // dashes: Danacode short form "31-4090"
    if (v) handleIsbn(v);
    e.target.reset();
  };
  noisbn.onsubmit = async (e) => {
    e.preventDefault();
    const file = noisbn.photo.files[0];
    const ok = await add({ isbn: noisbn.isbn.value || null, title: noisbn.title.value, author: noisbn.author.value }, file ? await shrinkImage(file) : null);
    if (ok) noisbn.reset();
  };

  showLists();
  return () => stop?.();
}
