import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { api } from '../api.js';
import { esc, getPosition, toast } from '../ui.js';

const VIEW_KEY = 'pofov:mapView';
const DEFAULT_VIEW = { lat: 32.08, lon: 34.78, zoom: 13 }; // Tel Aviv

const pin = (books, pending) => L.divIcon({
  className: '',
  html: `<div class="pin${pending ? ' pending' : ''}"><span>${books || '📚'}</span></div>`,
  iconSize: [34, 42],
  iconAnchor: [17, 40],
  popupAnchor: [0, -36],
});

function savedView() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || null; } catch { return null; }
}

export default function mapView(root) {
  root.innerHTML = `
    <div id="map"></div>
    <button class="fab-locate" title="Show my location">◎</button>
    <a class="fab-add" href="/add">＋ Add a library</a>`;
  const start = savedView() ?? DEFAULT_VIEW;
  const map = L.map('map', { zoomControl: false }).setView([start.lat, start.lon], start.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  map.addLayer(cluster);
  const shown = new Map();
  let me = null;

  async function load() {
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(',');
    try {
      const { locations } = await api(`/api/locations?bbox=${bbox}`);
      for (const l of locations) {
        if (shown.has(l.code)) continue;
        const m = L.marker([l.lat, l.lon], { icon: pin(l.books, l.status === 'pending') });
        m.bindPopup(`<strong>${esc(l.name || 'Free library')}</strong><br>
          ${l.books ? `${l.books} book${l.books > 1 ? 's' : ''} recorded` : 'No books recorded yet'}
          ${l.status === 'pending' ? '<br><em>Waiting for review</em>' : ''}
          <br><a href="/l/${l.code}">Open →</a>`);
        cluster.addLayer(m);
        shown.set(l.code, m);
      }
    } catch { /* offline: keep what is shown */ }
  }

  let t;
  map.on('moveend', () => {
    const c = map.getCenter();
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })); } catch {}
    clearTimeout(t);
    t = setTimeout(load, 250);
  });
  load();

  async function locate(fly = true) {
    try {
      const p = await getPosition();
      if (me) me.setLatLng([p.lat, p.lon]);
      else me = L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2a7de1', fillOpacity: 1 }).addTo(map);
      if (fly) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 15));
    } catch (e) { if (fly) toast(e.message); }
  }
  root.querySelector('.fab-locate').onclick = () => locate(true);
  if (!savedView()) locate(true);

  return () => map.remove();
}
