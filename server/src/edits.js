import { one, many, tx } from './db.js';
import { requireUser } from './auth.js';
import { savePhoto } from './photos.js';
import { readForm } from './multipart.js';
import { locationByCode, visibleTo } from './locations.js';
import { locationStatus, audit } from './moderation.js';
import { parseLatLon } from './util.js';
import { checkPrivate } from './privacy.js';

const MAX_MOVE_M = 2000; // a "move" farther than this is probably a different library

// Writes approved changes onto the library row.
export async function applyEdit(db, locationId, c) {
  const sets = [];
  const vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length + 1}`); };
  if ('name' in c) set('name', c.name);
  if ('description' in c) set('description', c.description);
  if ('restricted' in c) set('restricted', c.restricted);
  if ('photo_id' in c) set('photo_id', c.photo_id);
  if (c.removed) set('status', 'removed');
  if (c.lat != null && c.lon != null) {
    vals.push(c.lon, c.lat);
    sets.push(`geom = ST_MakePoint($${vals.length}, $${vals.length + 1})::geography`);
  }
  if (!sets.length) return;
  await db.query(`UPDATE locations SET ${sets.join(', ')}, last_checked_at = now() WHERE id = $1`, [locationId, ...vals]);
}

export default async function editRoutes(app) {
  // Suggest a change to a library: name, hint, indoor flag, photo, position, or "it's gone".
  app.post('/api/locations/:code/edits', {
    preHandler: requireUser(),
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!visibleTo(loc, req.user) || loc.status === 'removed') return reply.code(404).send({ error: 'not_found' });
    const { fields, files } = await readForm(req);

    const changes = {};
    const text = (v, max) => String(v ?? '').trim().slice(0, max) || null;
    if ('name' in fields && text(fields.name, 120) !== loc.name) changes.name = text(fields.name, 120);
    if ('description' in fields && text(fields.description, 1000) !== loc.description) changes.description = text(fields.description, 1000);
    if ('restricted' in fields && (fields.restricted === '1') !== loc.restricted) changes.restricted = fields.restricted === '1';
    if (fields.removed === '1') changes.removed = true;
    const pos = parseLatLon(fields.lat, fields.lon);
    if (pos) {
      const d = (await one('SELECT ST_Distance(geom, ST_MakePoint($2, $3)::geography)::int AS d FROM locations WHERE id = $1',
        [loc.id, pos.lon, pos.lat])).d;
      if (d > MAX_MOVE_M) return reply.code(422).send({ error: 'too_far', distance: d });
      if (d >= 5) Object.assign(changes, { lat: pos.lat, lon: pos.lon, moved_m: d });
    }
    if (files.photo) changes.photo_id = (await savePhoto(files.photo, { userId: req.user.id, kind: 'location' })).id;
    if (!Object.keys(changes).length) return reply.code(400).send({ error: 'no_changes' });

    const note = text(fields.note, 500);
    const privacy = await checkPrivate(changes.name, changes.description, note);
    if (privacy.flagged && fields.confirm_private !== '1') {
      return reply.code(422).send({ error: 'private_info', snippets: privacy.snippets });
    }
    const status = privacy.flagged ? 'pending' : locationStatus(req.user);
    const edit = await tx(async (db) => {
      const row = (await db.query(
        `INSERT INTO location_edits(location_id, user_id, changes, note, status, reviewed_by, reviewed_at, privacy_flag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status`,
        [loc.id, req.user.id, changes, note, status, status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null,
         privacy.flagged ? { reason: privacy.reason, snippets: privacy.snippets } : null],
      )).rows[0];
      if (status === 'approved') await applyEdit(db, loc.id, changes);
      return row;
    });
    await audit(req.user.id, 'location_edit', 'location', loc.id, { edit: edit.id, status });
    return { edit };
  });

  // The library as it is now, for the edit form.
  app.get('/api/locations/:code/edits', { preHandler: requireUser() }, async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!visibleTo(loc, req.user)) return reply.code(404).send({ error: 'not_found' });
    const mine = await many(
      `SELECT id, changes, status, created_at FROM location_edits
        WHERE location_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 10`,
      [loc.id, req.user.id],
    );
    return { mine };
  });
}
