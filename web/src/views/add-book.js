import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { esc, getPosition, shrinkImage, toast, noStringsNote } from '../ui.js';
import { t, lang } from '../i18n.js';
import { placeBook } from '../mybooks.js';

// Three ways in: shelf photos, a short video, or barcodes one by one. Photos and
// videos upload in the background so the next one can be taken right away; every
// book found waits in the approval queue (/queue).
export default async function addBookView(root, [code], query) {
  const me = await getMe();
  if (!me) return navigate(`/login?next=/l/${code}/add`, { replace: true });
  let mode = query?.get('kind') === 'added' ? 'added' : 'seen';

  root.innerHTML = `
  <section class="page">
    <p><a href="/l/${code}">${t('back.library')}</a></p>
    <h1>${t('addbook.title')}</h1>
    <div class="seg" id="mode"><button data-k="seen">${t('addbook.mode_seen')}</button><button data-k="added">${t('addbook.mode_added')}</button></div>
    <div class="big-actions">
      <label class="big-btn primary"><span>📷</span><b>${t('add3.photo')}</b><small>${t('add3.photo_note')}</small>
        <input type="file" accept="image/*" capture="environment" multiple hidden id="shelf"></label>
      <label class="big-btn"><span>🎥</span><b>${t('add3.video')}</b><small>${t('add3.video_note')}</small>
        <input type="file" accept="video/*" capture="environment" hidden id="video"></label>
      <a class="big-btn" id="barcode" href="/l/${code}/barcode"><span>▥</span><b>${t('add3.barcode')}</b><small>${t('add3.barcode_note')}</small></a>
    </div>
    <div class="from-mine" id="from-mine" hidden></div>
    <ul class="uploads" id="uploads"></ul>
    <p id="queue-link"></p>
    <p class="muted small">${t('addbook.shelf_lead')}</p>
    ${noStringsNote()}
    <details class="nobarcode"><summary>${t('addbook.nobarcode')}</summary>
      <form id="noisbn" class="form">
        <label>${t('field.title')} <input name="title" required maxlength="300"></label>
        <label>${t('field.author')} <input name="author" maxlength="200"></label>
        <label class="photo-pick small"><input type="file" name="photo" accept="image/*" capture="environment" hidden><span>${t('addbook.cover_photo')}</span></label>
        <button class="btn primary">${t('addbook.add_this')}</button>
      </form>
    </details>
  </section>`;

  let pos = null;
  getPosition().then((p) => { pos = p; }).catch(() => {});
  const showMode = () => {
    root.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x.dataset.k === mode));
    root.querySelector('#barcode').href = `/l/${code}/barcode${mode === 'added' ? '?kind=added' : ''}`;
  };
  showMode();
  root.querySelector('#mode').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { mode = b.dataset.k; showMode(); }
  };

  const queueLink = root.querySelector('#queue-link');
  async function showQueue() {
    try {
      const c = await api('/api/queue/count');
      queueLink.innerHTML = c.open + c.later || c.processing ? `<a class="btn" href="/queue">📥 ${t('queue.link', c)}</a>` : '';
    } catch { /* offline */ }
  }
  showQueue();

  // Books the reader scanned at home: one tap reports one of them left here.
  const fromMine = root.querySelector('#from-mine');
  async function showMine() {
    const d = await api('/api/my-books').catch(() => null);
    fromMine.hidden = !d?.home.length;
    if (!d?.home.length) return;
    fromMine.innerHTML = `<p><b>${t('mybooks.from_mine')}</b></p><p class="row">${d.home.map((r) =>
      `<button class="btn small" data-mine="${r.id}">📍 ${esc(r.title)}</button>`).join('')}</p>`;
    fromMine.onclick = async (e) => {
      const b = e.target.closest('[data-mine]');
      const item = b && d.home.find((r) => r.id === Number(b.dataset.mine));
      if (item && await placeBook(item, code)) showMine();
    };
  }
  showMine();

  // One line per upload, so the next photo can be taken while this one is still sending.
  const list = root.querySelector('#uploads');
  async function upload(files, label) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="spinner"></span> ${esc(label)} — ${t('addbook.uploading')}`;
    list.prepend(li);
    const url = `/api/locations/${code}/scans`;
    const fields = { kind: mode, lang: lang(), lat: pos?.lat ?? '', lon: pos?.lon ?? '' };
    const offline = async () => { await enqueue(url, fields, files, 'shelf'); li.textContent = `💾 ${label} — ${t('addbook.queued_offline')}`; };
    if (!navigator.onLine) return offline();
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    Object.entries(files).forEach(([k, b]) => fd.append(k, b, b.name || `${k}.jpg`));
    try {
      await api(url, { method: 'POST', form: fd });
      li.textContent = `✓ ${label} — ${t('add3.sent')}`;
      showQueue();
    } catch (e) {
      if (e instanceof TypeError) return offline();
      li.textContent = `⚠️ ${label} — ${e.status === 413 ? t('addbook.too_large') : e.message}`;
    }
  }
  let photos = 0, videos = 0;
  root.querySelector('#shelf').onchange = async (e) => {
    const picked = [...e.target.files].slice(0, 8);
    e.target.value = '';
    if (!picked.length) return;
    const files = {};
    for (const [i, f] of picked.entries()) files[`photo${i}`] = await shrinkImage(f, 2400);
    photos += picked.length;
    upload(files, picked.length === 1 ? t('add3.photo_n', { n: photos }) : t('add3.photos_n', { n: picked.length }));
  };
  root.querySelector('#video').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) return toast(t('addbook.too_large'));
    upload({ video: f }, t('add3.video_n', { n: ++videos }));
  };

  const noisbn = root.querySelector('#noisbn');
  noisbn.onsubmit = async (e) => {
    e.preventDefault();
    const file = noisbn.photo.files[0];
    const photo = file ? await shrinkImage(file) : null;
    const fields = { title: noisbn.title.value, author: noisbn.author.value, kind: mode, lat: pos?.lat ?? '', lon: pos?.lon ?? '' };
    const url = `/api/locations/${code}/sightings`;
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    if (photo) fd.append('photo', photo, 'photo.jpg');
    try {
      const r = await api(url, { method: 'POST', form: fd });
      toast(r.sighting?.status === 'approved' ? t('loc.thanks_updated') : t('loc.thanks_review'));
    } catch (err) {
      if (!(err instanceof TypeError)) return toast(err.message);
      await enqueue(url, fields, { photo }, 'book');
      toast(t('status.offline'));
    }
    noisbn.reset();
  };
}
