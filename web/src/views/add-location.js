import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, getMe } from '../api.js';
import { enqueue } from '../queue.js';
import { navigate } from '../nav.js';
import { getPosition, shrinkImage, toast } from '../ui.js';

export default async function addLocationView(root) {
  const me = await getMe();
  if (!me) return navigate('/login?next=/add', { replace: true });

  root.innerHTML = `
  <section class="page">
    <h1>Add a free library</h1>
    <p class="muted">Stand next to it, take a photo, and add a short hint so others can find it.</p>
    <form id="f" class="form">
      <label class="photo-pick">
        <input type="file" name="photo" accept="image/*" capture="environment" hidden>
        <span id="photo-preview">📷 Take a photo of the library</span>
      </label>
      <div id="mini-map" class="mini-map"></div>
      <p id="gps" class="muted small">Getting your location…</p>
      <label>Name <span class="muted">(optional)</span>
        <input name="name" maxlength="120" placeholder="e.g. Book box by the bus stop"></label>
      <label>How to find it
        <textarea name="description" maxlength="1000" rows="3" placeholder="e.g. Inside the park gate, next to the water fountain"></textarea></label>
      <label class="check"><input type="checkbox" name="restricted"> It is inside a building or private area</label>
      <button class="btn primary big" type="submit">Add to the map</button>
    </form>
  </section>`;

  const form = root.querySelector('#f');
  const gpsText = root.querySelector('#gps');
  let pos = null;
  let photo = null;

  const map = L.map(root.querySelector('#mini-map'), { zoomControl: false, attributionControl: false }).setView([32.08, 34.78], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  const marker = L.marker([32.08, 34.78], { draggable: true });
  marker.on('dragend', () => {
    const p = marker.getLatLng();
    pos = { ...pos, lat: p.lat, lon: p.lng };
    gpsText.textContent = 'Pin moved by hand.';
  });

  getPosition().then((p) => {
    pos = p;
    marker.setLatLng([p.lat, p.lon]).addTo(map);
    map.setView([p.lat, p.lon], 18);
    gpsText.textContent = `Location found (±${Math.round(p.accuracy)} m). Drag the pin if it is off.`;
  }).catch((e) => { gpsText.textContent = `${e.message} Tap the map to place the pin.`; });
  map.on('click', (e) => {
    pos = { lat: e.latlng.lat, lon: e.latlng.lng, accuracy: null };
    marker.setLatLng(e.latlng).addTo(map);
    gpsText.textContent = 'Pin placed by hand.';
  });

  form.photo.onchange = async () => {
    const file = form.photo.files[0];
    if (!file) return;
    photo = await shrinkImage(file);
    root.querySelector('#photo-preview').innerHTML = `<img src="${URL.createObjectURL(photo)}" alt="">`;
  };

  async function submit(force = false) {
    if (!pos) return toast('Please set the location first.');
    const fields = {
      lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy ?? '',
      name: form.name.value, description: form.description.value,
      restricted: form.restricted.checked ? '1' : '0', force: force ? '1' : '0',
    };
    if (!navigator.onLine) {
      await enqueue('/api/locations', fields, { photo }, 'library');
      toast('No signal — saved. It will upload when you are back online.');
      return navigate('/');
    }
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    if (photo) fd.append('photo', photo, 'photo.jpg');
    try {
      const { location: l } = await api('/api/locations', { method: 'POST', form: fd });
      toast(l.status === 'approved' ? 'Added! Now add some books.' : 'Added! A reviewer will check it soon.');
      navigate(`/l/${l.code}`, { replace: true });
    } catch (e) {
      if (e.body?.error === 'nearby_exists') {
        const d = e.body.location;
        if (confirm(`There is already a library right here: “${d.name || d.code}”.\n\nOK = open it\nCancel = mine is a different one`)) navigate(`/l/${d.code}`);
        else submit(true);
      } else if (e.status === undefined || e instanceof TypeError) {
        await enqueue('/api/locations', fields, { photo }, 'library');
        toast('Connection problem — saved for later upload.');
      } else toast(e.message);
    }
  }
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  return () => map.remove();
}
