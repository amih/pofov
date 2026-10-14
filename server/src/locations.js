import { config, POINTS } from './config.js';
import { one, many, tx } from './db.js';
import { requireUser } from './auth.js';
import { savePhoto, photoUrls, avatarUrl } from './photos.js';
import { lookupIsbn, upsertBook } from './books.js';
import { readForm } from './multipart.js';
import { initialStatus, award, pointsForSighting, maybePromote } from './moderation.js';
import { parseLatLon, shortCode } from './util.js';

const DUPLICATE_RADIUS_M = 25;
const MAP_LIMIT = 5000;
const CLUSTER_BELOW_ZOOM = 10;
const CELL_PX = 64; // one bubble per ~64 screen pixels

// Latest approved sighting per book; a book is on the shelf when that is 'seen'.
const PRESENT_BOOKS_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (s.book_id) s.book_id, s.kind, s.created_at
      FROM sightings s
     WHERE s.location_id = $1 AND s.status = 'approved'
     ORDER BY s.book_id, s.created_at DESC
  )
  SELECT b.id, b.isbn13, b.title, b.authors, b.year, b.cover_url, l.created_at AS last_seen
    FROM latest l JOIN books b ON b.id = l.book_id
   WHERE l.kind = 'seen'
   ORDER BY l.created_at DESC`;

async function locationByCode(code) {
  return one(
    `SELECT l.*, ST_Y(l.geom::geometry) AS lat, ST_X(l.geom::geometry) AS lon
       FROM locations l WHERE l.code = $1`,
    [String(code).toUpperCase()],
  );
}

const visibleTo = (loc, user) =>
  loc && (loc.status === 'approved' || (user && (user.id === loc.created_by || user.trust_level >= 2)));

async function distanceTo(locId, pos) {
  if (!pos) return null;
  const r = await one(
    'SELECT ST_Distance(geom, ST_MakePoint($2, $3)::geography)::int AS d FROM locations WHERE id = $1',
    [locId, pos.lon, pos.lat],
  );
  return r?.d ?? null;
}

export default async function locationRoutes(app) {
  app.get('/api/locations', async (req, reply) => {
    const bbox = String(req.query.bbox ?? '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
      return reply.code(400).send({ error: 'bbox=minLon,minLat,maxLon,maxLat required' });
    }
    const clamp = (n, lim) => Math.min(Math.max(n, -lim), lim);
    const [w, s, e, n] = [clamp(bbox[0], 180), clamp(bbox[1], 90), clamp(bbox[2], 180), clamp(bbox[3], 90)];
    const where = `l.geom::geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          AND (l.status = 'approved' OR l.created_by = $5)`;
    const params = [w, s, e, n, req.user?.id ?? null];

    // Zoomed out: one bubble per grid cell instead of thousands of pins.
    if (Number(req.query.zoom) < CLUSTER_BELOW_ZOOM) {
      const clusters = await many(
        `SELECT count(*)::int AS n, avg(ST_Y(l.geom::geometry)) AS lat, avg(ST_X(l.geom::geometry)) AS lon
           FROM locations l WHERE ${where}
          GROUP BY ST_SnapToGrid(l.geom::geometry, $6)`,
        [...params, Math.max(e - w, 0.01) / (Math.min(Math.max(Number(req.query.px) || 400, 200), 4000) / CELL_PX)],
      );
      return { clusters };
    }
    const rows = await many(
      `SELECT l.code, l.name, l.source, l.status, l.restricted,
              ST_Y(l.geom::geometry) AS lat, ST_X(l.geom::geometry) AS lon,
              (SELECT count(DISTINCT s.book_id) FROM sightings s
                WHERE s.location_id = l.id AND s.status = 'approved')::int AS books
         FROM locations l WHERE ${where}
        LIMIT ${MAP_LIMIT}`,
      params,
    );
    return { locations: rows, truncated: rows.length === MAP_LIMIT };
  });

  app.get('/api/locations/:code', async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!visibleTo(loc, req.user)) return reply.code(404).send({ error: 'not_found' });
    const photo = loc.photo_id && await one('SELECT path, thumb_path FROM photos WHERE id = $1', [loc.photo_id]);
    const books = await many(PRESENT_BOOKS_SQL, [loc.id]);
    const activity = await many(
      `SELECT s.kind, s.created_at, b.title, COALESCE(u.screen_name, 'Reader #' || u.id) AS who, u.avatar_path
         FROM sightings s JOIN books b ON b.id = s.book_id LEFT JOIN users u ON u.id = s.user_id
        WHERE s.location_id = $1 AND s.status = 'approved'
        ORDER BY s.created_at DESC LIMIT 15`,
      [loc.id],
    );
    for (const a of activity) { a.avatar = avatarUrl(a.avatar_path); delete a.avatar_path; }
    const pending = req.user ? (await one(
      `SELECT count(*)::int AS n FROM sightings WHERE location_id = $1 AND user_id = $2 AND status = 'pending'`,
      [loc.id, req.user.id],
    )).n : 0;
    return {
      location: {
        code: loc.code, name: loc.name, description: loc.description, lat: loc.lat, lon: loc.lon,
        source: loc.source, status: loc.status, restricted: loc.restricted,
        osm: loc.osm_id ? `https://www.openstreetmap.org/${loc.osm_type}/${loc.osm_id}` : null,
        last_checked_at: loc.last_checked_at, created_at: loc.created_at,
        photo: photoUrls(photo),
      },
      books, activity, my_pending: pending,
    };
  });

  app.post('/api/locations', {
    preHandler: requireUser(),
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const { fields, files } = await readForm(req);
    const pos = parseLatLon(fields.lat, fields.lon);
    if (!pos) return reply.code(400).send({ error: 'location_required' });

    if (fields.force !== '1') {
      const dup = await one(
        `SELECT code, name FROM locations
          WHERE status <> 'rejected' AND ST_DWithin(geom, ST_MakePoint($1, $2)::geography, $3)
          ORDER BY geom <-> ST_MakePoint($1, $2)::geography LIMIT 1`,
        [pos.lon, pos.lat, DUPLICATE_RADIUS_M],
      );
      if (dup) return reply.code(409).send({ error: 'nearby_exists', location: dup });
    }

    const photo = files.photo && await savePhoto(files.photo, { userId: req.user.id, kind: 'location' });
    const status = initialStatus(req.user);
    const name = String(fields.name ?? '').trim().slice(0, 120) || null;
    const description = String(fields.description ?? '').trim().slice(0, 1000) || null;
    const restricted = fields.restricted === '1' || fields.restricted === true;

    const loc = await tx(async (db) => {
      let row;
      for (let attempt = 0; !row; attempt++) {
        try {
          row = (await db.query(
            `INSERT INTO locations(code, name, description, geom, status, restricted, photo_id, created_by, last_checked_at)
             VALUES ($1, $2, $3, ST_MakePoint($4, $5)::geography, $6, $7, $8, $9, now())
             RETURNING id, code, status`,
            [shortCode(), name, description, pos.lon, pos.lat, status, restricted, photo?.id ?? null, req.user.id],
          )).rows[0];
        } catch (err) {
          if (err.code !== '23505' || attempt > 5) throw err; // code collision → retry
        }
      }
      if (status === 'approved') {
        await award(db, { userId: req.user.id, points: POINTS.location, reason: 'new_location', refType: 'location', refId: row.id });
      }
      return row;
    });
    return { location: { code: loc.code, status: loc.status } };
  });

  // "I was here and it's still there" — keeps the map fresh.
  app.post('/api/locations/:code/check', { preHandler: requireUser() }, async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!visibleTo(loc, req.user)) return reply.code(404).send({ error: 'not_found' });
    const distance = await distanceTo(loc.id, parseLatLon(req.body?.lat, req.body?.lon));
    if (distance == null || distance > config.maxReportDistanceM) {
      return reply.code(422).send({ error: 'too_far', distance });
    }
    await tx(async (db) => {
      await db.query('UPDATE locations SET last_checked_at = now() WHERE id = $1', [loc.id]);
      const already = (await db.query(
        `SELECT 1 FROM karma_events WHERE user_id = $1 AND reason = 'check' AND ref_id = $2
            AND created_at > now() - interval '1 day'`,
        [req.user.id, loc.id],
      )).rowCount;
      if (!already) await award(db, { userId: req.user.id, points: POINTS.check, reason: 'check', refType: 'location', refId: loc.id });
    });
    return { ok: true };
  });

  app.get('/api/books/lookup', async (req, reply) => {
    const result = await lookupIsbn(req.query.isbn);
    if (result.error) return reply.code(400).send(result);
    return result;
  });

  // Report a book at a location: seen (on the shelf), taken (I took it), gone (not there any more).
  app.post('/api/locations/:code/sightings', {
    preHandler: requireUser(),
    config: { rateLimit: { max: 200, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!visibleTo(loc, req.user)) return reply.code(404).send({ error: 'not_found' });
    const { fields, files } = await readForm(req);
    const kind = ['seen', 'taken', 'gone'].includes(fields.kind) ? fields.kind : 'seen';

    let book = null;
    if (fields.book_id) {
      book = await one('SELECT * FROM books WHERE id = $1', [Number(fields.book_id)]);
    } else if (fields.isbn) {
      const r = await lookupIsbn(fields.isbn);
      if (r.error) return reply.code(400).send(r);
      book = r.book;
      if (!book && fields.title) {
        book = await upsertBook({ isbn13: r.isbn, title: String(fields.title).slice(0, 300), authors: splitAuthors(fields.author), source: 'user' });
      }
    } else if (fields.title) {
      book = await upsertBook({ title: String(fields.title).slice(0, 300), authors: splitAuthors(fields.author), source: 'user' });
    }
    if (!book) return reply.code(422).send({ error: 'book_not_found' });

    const distance = await distanceTo(loc.id, parseLatLon(fields.lat, fields.lon));
    const far = distance == null || distance > config.maxReportDistanceM;
    const photo = files.photo && await savePhoto(files.photo, { userId: req.user.id, kind: 'cover' });
    const status = loc.status === 'approved' ? initialStatus(req.user, { far }) : 'pending';

    const s = await tx(async (db) => {
      const row = (await db.query(
        `INSERT INTO sightings(book_id, location_id, user_id, kind, status, photo_id, distance_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, status`,
        [book.id, loc.id, req.user.id, kind, status, photo?.id ?? null, distance],
      )).rows[0];
      if (status === 'approved') {
        await award(db, { userId: req.user.id, points: pointsForSighting(kind), reason: `sighting_${kind}`, refType: 'sighting', refId: row.id });
        await db.query('UPDATE locations SET last_checked_at = now() WHERE id = $1', [loc.id]);
      }
      return row;
    });
    return { sighting: s, book };
  });

  app.get('/api/leaderboard', async (req) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 3650);
    const rows = await many(
      `SELECT COALESCE(u.screen_name, 'Reader #' || u.id) AS name, u.avatar_path, sum(k.points)::int AS points
         FROM karma_events k JOIN users u ON u.id = k.user_id
        WHERE k.created_at > now() - make_interval(days => $1)
        GROUP BY u.id ORDER BY points DESC LIMIT 20`,
      [days],
    );
    for (const r of rows) { r.avatar = avatarUrl(r.avatar_path); delete r.avatar_path; }
    return { days, leaders: rows };
  });

  app.get('/api/stats', async () => one(
    `SELECT (SELECT count(*) FROM locations WHERE status = 'approved')::int AS locations,
            (SELECT count(*) FROM books)::int AS books,
            (SELECT count(*) FROM sightings WHERE status = 'approved')::int AS sightings`,
  ));
}

const splitAuthors = (s) => String(s ?? '').split(/[,;&]/).map((a) => a.trim()).filter(Boolean).slice(0, 10);

export { locationByCode, PRESENT_BOOKS_SQL };
