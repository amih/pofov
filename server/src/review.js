import { POINTS } from './config.js';
import { many, tx } from './db.js';
import { requireUser } from './auth.js';
import { award, pointsForSighting, maybePromote, audit } from './moderation.js';

export default async function reviewRoutes(app) {
  const reviewer = { preHandler: requireUser(2) };

  app.get('/api/review', reviewer, async () => {
    const locations = await many(
      `SELECT l.id, l.code, l.name, l.description, l.restricted, l.created_at,
              ST_Y(l.geom::geometry) AS lat, ST_X(l.geom::geometry) AS lon,
              p.thumb_path, COALESCE(u.screen_name, 'Reader #' || u.id) AS by_name
         FROM locations l LEFT JOIN photos p ON p.id = l.photo_id LEFT JOIN users u ON u.id = l.created_by
        WHERE l.status = 'pending' ORDER BY l.created_at LIMIT 100`,
    );
    const sightings = await many(
      `SELECT s.id, s.kind, s.distance_m, s.created_at, b.title, b.authors, b.isbn13, b.cover_url,
              l.code, l.name AS location_name, l.status AS location_status,
              p.thumb_path, COALESCE(u.screen_name, 'Reader #' || u.id) AS by_name
         FROM sightings s JOIN books b ON b.id = s.book_id JOIN locations l ON l.id = s.location_id
         LEFT JOIN photos p ON p.id = s.photo_id LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status = 'pending' AND l.status = 'approved' ORDER BY s.created_at LIMIT 200`,
    );
    for (const r of [...locations, ...sightings]) {
      r.thumb = r.thumb_path ? `/uploads/${r.thumb_path}` : null;
      delete r.thumb_path;
    }
    return { locations, sightings };
  });

  app.post('/api/review/:type/:id', reviewer, async (req, reply) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    if (!['location', 'sighting'].includes(type) || !['approved', 'rejected'].includes(decision)) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    const table = type === 'location' ? 'locations' : 'sightings';
    const owner = type === 'location' ? 'created_by' : 'user_id';
    const done = await tx(async (db) => {
      const row = (await db.query(
        `UPDATE ${table} SET status = $1 WHERE id = $2 AND status = 'pending' RETURNING ${owner} AS owner, ${type === 'sighting' ? 'kind' : "'location' AS kind"}`,
        [decision, id],
      )).rows[0];
      if (!row) return false;
      if (decision === 'approved') {
        const points = type === 'location' ? POINTS.location : pointsForSighting(row.kind);
        await award(db, { userId: row.owner, points, reason: type === 'location' ? 'new_location' : `sighting_${row.kind}`, refType: type, refId: id, by: req.user.id });
        await maybePromote(db, row.owner);
      }
      await award(db, { userId: req.user.id, points: POINTS.review, reason: 'review', refType: type, refId: id });
      return true;
    });
    if (!done) return reply.code(409).send({ error: 'already_reviewed' });
    await audit(req.user.id, `review_${decision}`, type, id);
    return { ok: true };
  });
}
