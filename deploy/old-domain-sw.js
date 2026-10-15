// Served as /sw.js on the app's previous address (see deploy/nginx.conf).
// Replaces the old service worker in installed copies and open tabs: clears its
// caches, sends every window to the same page on the new address, and removes itself.
const NEW_ORIGIN = 'https://seferehov.com';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.clients.claim();
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      const url = new URL(client.url);
      await client.navigate(NEW_ORIGIN + url.pathname + url.search).catch(() => {});
    }
    await self.registration.unregister();
  })());
});
