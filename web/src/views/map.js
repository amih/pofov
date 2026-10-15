import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { api } from '../api.js';
import { esc, getPosition, toast } from '../ui.js';
import { t, isRtl } from '../i18n.js';

const VIEW_KEY = 'seferehov:mapView';
const ISRAEL = [[29.45, 34.25], [33.34, 35.9]]; // first-visit view

// Green = added in the app or has books reported; pale = imported from OpenStreetMap, nothing known yet.
const isLive = (l) => l.source !== 'osm' || l.books > 0;
const pin = (books, kind) => L.divIcon({
  className: '',
  html: `<div class="pin ${kind}"><span>${books || '📚'}</span></div>`,
  ...(kind === 'osm'
    ? { iconSize: [26, 32], iconAnchor: [13, 30], popupAnchor: [0, -28] }
    : { iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36] }),
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

export default function mapView(root, _, query) {
  root.innerHTML = `
    <div id="map"></div>
    <button class="fab-locate" title="${t('map.locate')}" aria-label="${t('map.locate')}">◎</button>
    <a class="fab-add" href="/add">${t('map.add')}</a>`;
  // /?at=lat,lon,zoom — links from the place pages
  const at = (query?.get('at') ?? '').split(',').map(Number);
  const start = at.length === 3 && at.every(Number.isFinite) ? { lat: at[0], lon: at[1], zoom: at[2] } : savedView();
  const map = L.map('map', { zoomControl: false, maxZoom: 19 });
  if (start) map.setView([start.lat, start.lon], start.zoom);
  else map.fitBounds(ISRAEL);
  let removed = false;
  import('../basemap.js').then((m) => m.basemap()).then((layer) => { if (!removed) layer.addTo(map); });
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const live = c.getAllChildMarkers().some((m) => m.options.live);
      const size = n < 10 ? 'small' : n < 100 ? 'medium' : 'large';
      return L.divIcon({ html: `<div><span>${n}</span></div>`, className: `marker-cluster marker-cluster-${size}${live ? ' live' : ''}`, iconSize: L.point(40, 40) });
    },
  });
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
          if (c.n === 1) { bubbles.addLayer(L.marker([c.lat, c.lon], { icon: pin(0, 'osm') }).on('click', () => map.setView([c.lat, c.lon], 15))); continue; }
          bubbles.addLayer(L.marker([c.lat, c.lon], { icon: bubble(c.n) }).on('click', () => map.setView([c.lat, c.lon], Math.min(zoom + 3, 16))));
        }
        return;
      }
      map.addLayer(cluster);
      for (const l of locations) {
        if (shown.has(l.code)) continue;
        const kind = l.status === 'pending' ? 'pending' : isLive(l) ? 'live' : 'osm';
        const m = L.marker([l.lat, l.lon], { icon: pin(l.books, kind), live: kind !== 'osm', zIndexOffset: kind === 'osm' ? 0 : 1000 });
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
      if (fly) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 16)); // street level, like Google Maps
    } catch (e) { if (fly) toast(e.message); }
  }
  root.querySelector('.fab-locate').onclick = () => locate(true);
  if (!start) locate(false);

  return () => { removed = true; map.remove(); };
}
