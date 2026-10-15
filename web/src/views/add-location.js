import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { getPosition, shrinkImage, toast, privacyDialog } from '../ui.js';
import { t } from '../i18n.js';

export default async function addLocationView(root) {
  const me = await getMe();
  if (!me) return navigate('/login?next=/add', { replace: true });

  root.innerHTML = `
  <section class="page">
    <h1>${t('addloc.title')}</h1>
    <p class="muted">${t('addloc.lead')}</p>
    <form id="f" class="form">
      <label class="photo-pick">
        <input type="file" name="photo" accept="image/*" capture="environment" hidden>
        <span id="photo-preview">${t('addloc.photo')}</span>
      </label>
      <div id="mini-map" class="mini-map"></div>
      <p id="gps" class="muted small">${t('addloc.gps_wait')}</p>
      <label>${t('addloc.name')} <span class="muted">${t('optional')}</span>
        <input name="name" maxlength="120" placeholder="${t('addloc.name_ph')}"></label>
      <label>${t('addloc.hint')}
        <textarea name="description" maxlength="1000" rows="3" placeholder="${t('addloc.hint_ph')}"></textarea></label>
      <p class="field-note">${t('privacy.hint')}</p>
      <label class="check"><input type="checkbox" name="restricted"> ${t('addloc.restricted')}</label>
      <button class="btn primary big" type="submit">${t('addloc.submit')}</button>
    </form>
  </section>`;

  const form = root.querySelector('#f');
  const gpsText = root.querySelector('#gps');
  let pos = null;
  let photo = null;

  const map = L.map(root.querySelector('#mini-map'), { zoomControl: false, attributionControl: false }).setView([32.08, 34.78], 16);
  let removed = false;
  import('../basemap.js').then((m) => m.basemap()).then((layer) => { if (!removed) layer.addTo(map); });
  const marker = L.marker([32.08, 34.78], { draggable: true });
  marker.on('dragend', () => {
    const p = marker.getLatLng();
    pos = { ...pos, lat: p.lat, lon: p.lng };
    gpsText.textContent = t('addloc.moved');
  });

  getPosition().then((p) => {
    pos = p;
    marker.setLatLng([p.lat, p.lon]).addTo(map);
    map.setView([p.lat, p.lon], 18);
    gpsText.textContent = t('addloc.found', { acc: Math.round(p.accuracy) });
  }).catch((e) => { gpsText.textContent = t('addloc.tap', { msg: e.message }); });
  map.on('click', (e) => {
    pos = { lat: e.latlng.lat, lon: e.latlng.lng, accuracy: null };
    marker.setLatLng(e.latlng).addTo(map);
    gpsText.textContent = t('addloc.placed');
  });

  form.photo.onchange = async () => {
    const file = form.photo.files[0];
    if (!file) return;
    photo = await shrinkImage(file);
    root.querySelector('#photo-preview').innerHTML = `<img src="${URL.createObjectURL(photo)}" alt="">`;
  };

  async function submit(force = false, confirmPrivate = false) {
    if (!pos) return toast(t('addloc.need_pos'));
    const fields = {
      lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy ?? '',
      name: form.name.value, description: form.description.value,
      restricted: form.restricted.checked ? '1' : '0', force: force ? '1' : '0', confirm_private: confirmPrivate ? '1' : '0',
    };
    if (!navigator.onLine) {
      await enqueue('/api/locations', fields, { photo }, 'library');
      toast(t('addloc.offline_saved'));
      return navigate('/');
    }
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    if (photo) fd.append('photo', photo, 'photo.jpg');
    try {
      const { location: l } = await api('/api/locations', { method: 'POST', form: fd });
      toast(t(l.status === 'approved' ? 'addloc.added_live' : 'addloc.added_review'));
      navigate(`/l/${l.code}`, { replace: true });
    } catch (e) {
      if (e.body?.error === 'private_info') {
        if (await privacyDialog(e.body.snippets)) submit(force, true);
        else form.description.focus();
      } else if (e.body?.error === 'nearby_exists') {
        const d = e.body.location;
        if (confirm(t('addloc.dup', { name: d.name || d.code }))) navigate(`/l/${d.code}`);
        else submit(true, confirmPrivate);
      } else if (e.status === undefined || e instanceof TypeError) {
        await enqueue('/api/locations', fields, { photo }, 'library');
        toast(t('addloc.conn'));
      } else toast(e.message);
    }
  }
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  return () => { removed = true; map.remove(); };
}
