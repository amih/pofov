import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { api } from '../api.js';
import { esc, getPosition, toast } from '../ui.js';
import { t, isRtl } from '../i18n.js';

const VIEW_KEY = 'pofov:mapView';
const ISRAEL = [[29.45, 34.25], [33.34, 35.9]]; // first-visit view

const pin = (books, pending) => L.divIcon({
  className: '',
  html: `<div class="pin${pending ? ' pending' : ''}"><span>${books || '📚'}</span></div>`,
  iconSize: [34, 42],
  iconAnchor: [17, 40],
  popupAnchor: [0, -36],
});

const bubble = (n) => {
  const size = Math.round(Math.min(28 + 8 * Math.log10(n), 56));
  return L.divIcon({
    className: '',
    html: `<div class="bubble" style="width:${size}px;height:${size}px">${n >= 10000 ? `${Math.round(n / 1000)}k` : n}</div>`,
    iconSize: [size, size],
  });
};

function savedView() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || null; } catch { return null; }
}

export default function mapView(root) {
  root.innerHTML = `
    <div id="map"></div>
    <button class="fab-locate" title="${t('map.locate')}" aria-label="${t('map.locate')}">◎</button>
    <a class="fab-add" href="/add">${t('map.add')}</a>`;
  const start = savedView();
  const map = L.map('map', { zoomControl: false, maxZoom: 19 });
  if (start) map.setView([start.lat, start.lon], start.zoom);
  else map.fitBounds(ISRAEL);
  let removed = false;
  import('../basemap.js').then((m) => m.basemap()).then((layer) => { if (!removed) layer.addTo(map); });
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  map.addLayer(cluster);
  const bubbles = L.layerGroup().addTo(map);
  const shown = new Map();
  let me = null;

  async function load() {
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(',');
    const zoom = map.getZoom();
    try {
      const { locations, clusters } = await api(`/api/locations?bbox=${bbox}&zoom=${zoom}&px=${map.getSize().x}`);
      if (zoom !== map.getZoom()) return; // a newer load is coming
      bubbles.clearLayers();
      if (clusters) {
        map.removeLayer(cluster);
        for (const c of clusters) {
          if (c.n === 1) { bubbles.addLayer(L.marker([c.lat, c.lon], { icon: pin(0) }).on('click', () => map.setView([c.lat, c.lon], 15))); continue; }
          bubbles.addLayer(L.marker([c.lat, c.lon], { icon: bubble(c.n) }).on('click', () => map.setView([c.lat, c.lon], Math.min(zoom + 3, 16))));
        }
        return;
      }
      map.addLayer(cluster);
      for (const l of locations) {
        if (shown.has(l.code)) continue;
        const m = L.marker([l.lat, l.lon], { icon: pin(l.books, l.status === 'pending') });
        m.bindPopup(`<div dir="${isRtl() ? 'rtl' : 'ltr'}"><strong>${esc(l.name || t('free_library'))}</strong><br>
          ${l.books ? t('map.books', { n: l.books }) : t('map.no_books')}
          ${l.status === 'pending' ? `<br><em>${t('map.pending')}</em>` : ''}
          <br><a href="/l/${l.code}">${t('map.open')}</a></div>`);
        cluster.addLayer(m);
        shown.set(l.code, m);
      }
    } catch { /* offline: keep what is shown */ }
  }

  let timer;
  map.on('moveend', () => {
    const c = map.getCenter();
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })); } catch {}
    clearTimeout(timer);
    timer = setTimeout(load, 250);
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
  if (!start) locate(false);

  return () => { removed = true; map.remove(); };
}
