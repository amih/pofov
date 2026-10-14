# POFOV — Pass On, Find Other Volumes

A shared map of free street libraries (book boxes, little free libraries, shelves in lobbies and parks) and the books on their shelves right now. Installable as an app on any phone (PWA).

- **Add a library**: GPS position, a photo, and a hint for finding it.
- **Add books**: scan the barcode on the back cover; details come from Open Library / Google Books. Books without a barcode can be typed in.
- **Books come and go**: the app stores *sightings* (seen / taken / not there), so every shelf shows what was last seen and when.
- **Points and trust**: every approved report earns points. New users' reports go to a review queue; after a few approved ones they publish directly. Reports from far away from the library always go to review.
- **Works offline**: photos and scans made without signal upload later.
- **Printable sign** per library (A5, QR code linking to `/l/<code>`).
- Seeded with every `amenity=public_bookcase` from OpenStreetMap.

## Stack

| | |
|---|---|
| Web | Vite, vanilla JS, Leaflet + OSM tiles, Workbox service worker, ZXing WASM barcode reader |
| API | Node 22, Fastify 5, sharp (photos are re-encoded, which removes EXIF/GPS metadata) |
| DB | PostgreSQL 16 + PostGIS (Docker) |

## Run locally

```bash
cp .env.example .env          # set ADMIN_EMAILS to your email
npm install
npm run db:up && npm run migrate
npm run seed:osm -- 29.4,34.2,33.4,35.9   # bbox south,west,north,east; omit for the whole world
npm run dev:server            # API on :3870 (sign-in links are printed to this log without SMTP)
npm run dev:web               # app on :5173
```

## How updates reach installed apps

No version numbers to bump. Each build:

1. emits content-hashed asset names and a precache list (vite-plugin-pwa, `injectManifest`);
2. writes `version.json` (`<date>.<time>-<git sha>`), which the API echoes as `X-App-Version`.

The app checks for a new service worker on start, when it comes back to the foreground, hourly, and whenever the API reports a different version. The new worker installs in the background and is switched in at a safe moment: on the next screen change, or when the app is in the background, and never while uploads are queued. After the reload a toast shows the new version. For breaking API changes, set `MIN_CLIENT_BUILD` on the server: older clients get HTTP 426 and update immediately.

Server cache rules (see `deploy/nginx.conf`): `/assets/*` immutable for a year; `index.html`, `sw.js`, `version.json`, `manifest.webmanifest` always revalidated.

## Data and licences

Code: AGPL-3.0-or-later. Library locations include OpenStreetMap data © OpenStreetMap contributors, ODbL.
