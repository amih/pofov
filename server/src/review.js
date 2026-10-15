import { POINTS } from './config.js';
import { many, tx } from './db.js';
import { requireUser } from './auth.js';
import { award, pointsForSighting, maybePromote, audit } from './moderation.js';
import { applyEdit } from './edits.js';

export default async function reviewRoutes(app) {
  const reviewer = { preHandler: requireUser(2) };

  app.get('/api/review', reviewer, async () => {
    const locations = await many(
      `SELECT l.id, l.code, l.name, l.description, l.restricted, l.created_at, l.privacy_flag,
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
    const edits = await many(
      `SELECT e.id, e.changes, e.note, e.created_at, e.privacy_flag, l.code, l.name, l.description, l.restricted,
              ST_Y(l.geom::geometry) AS lat, ST_X(l.geom::geometry) AS lon,
              op.thumb_path AS old_thumb, np.thumb_path AS new_thumb,
              COALESCE(u.screen_name, 'Reader #' || u.id) AS by_name
         FROM location_edits e JOIN locations l ON l.id = e.location_id
         LEFT JOIN photos op ON op.id = l.photo_id
         LEFT JOIN photos np ON np.id = (e.changes->>'photo_id')::uuid
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.status = 'pending' ORDER BY e.created_at LIMIT 100`,
    );
    for (const r of [...locations, ...sightings]) {
      r.thumb = r.thumb_path ? `/uploads/${r.thumb_path}` : null;
      delete r.thumb_path;
    }
    for (const r of edits) {
      r.old_thumb = r.old_thumb && `/uploads/${r.old_thumb}`;
      r.new_thumb = r.new_thumb && `/uploads/${r.new_thumb}`;
    }
    return { locations, edits, sightings };
  });

  app.post('/api/review/:type/:id', reviewer, async (req, reply) => {
    const { type } = req.params;
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    if (!['location', 'sighting', 'edit'].includes(type) || !['approved', 'rejected'].includes(decision)) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    if (type === 'edit') {
      const done = await tx(async (db) => {
        const row = (await db.query(
          `UPDATE location_edits SET status = $1, reviewed_by = $2, reviewed_at = now()
            WHERE id = $3 AND status = 'pending' RETURNING location_id, user_id, changes`,
          [decision, req.user.id, id],
        )).rows[0];
        if (!row) return false;
        if (decision === 'approved') {
          await applyEdit(db, row.location_id, row.changes);
          await award(db, { userId: row.user_id, points: POINTS.edit, reason: 'location_edit', refType: 'edit', refId: id, by: req.user.id });
        }
        await award(db, { userId: req.user.id, points: POINTS.review, reason: 'review', refType: 'edit', refId: id });
        return true;
      });
      if (!done) return reply.code(409).send({ error: 'already_reviewed' });
      await audit(req.user.id, `review_${decision}`, 'edit', id);
      return { ok: true };
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
