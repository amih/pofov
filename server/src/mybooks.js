// The reader's own books: scanned at home, away from any library. When one is later
// left in a library, it is reported there as an 'added' sighting.
import { one, many, q } from './db.js';
import { requireUser } from './auth.js';
import { lookupIsbn, upsertBook, findOrCreateBook } from './books.js';
import { savePhoto, photoUrls } from './photos.js';
import { readForm } from './multipart.js';
import { locationByCode, visibleTo, distanceTo, splitAuthors, recordSighting } from './locations.js';
import { parseLatLon } from './util.js';

const LIST_SQL = `
  SELECT m.id, m.created_at, m.placed_at, b.id AS book_id, b.isbn13, b.title, b.authors, b.year,
         COALESCE(b.front_url, b.cover_url) AS cover_url, p.path, p.thumb_path,
         l.code, l.name AS location_name, s.status AS sighting_status
    FROM my_books m JOIN books b ON b.id = m.book_id
    LEFT JOIN photos p ON p.id = m.photo_id
    LEFT JOIN locations l ON l.id = m.location_id
    LEFT JOIN sightings s ON s.id = m.sighting_id`;
const publicRow = ({ path, thumb_path, ...r }) => ({ ...r, photo: path ? photoUrls({ path, thumb_path }) : null });

export default async function myBookRoutes(app) {
  app.get('/api/my-books', { preHandler: requireUser() }, async (req) => {
    const rows = (await many(`${LIST_SQL} WHERE m.user_id = $1 ORDER BY m.placed_at DESC NULLS FIRST, m.created_at DESC LIMIT 500`, [req.user.id])).map(publicRow);
    return { home: rows.filter((r) => !r.placed_at), placed: rows.filter((r) => r.placed_at) };
  });

  // By ISBN (a title is needed only when no catalogue knows it), or by title and author.
  app.post('/api/my-books', {
    preHandler: requireUser(),
    config: { rateLimit: { max: 300, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const { fields, files } = await readForm(req); // multipart when sent from the offline queue
    let book = null;
    if (fields.isbn) {
      const r = await lookupIsbn(fields.isbn, 'my_books');
      if (r.error) return reply.code(400).send(r);
      book = r.book;
      if (!book && fields.title) book = await upsertBook({ isbn13: r.isbn, title: String(fields.title).slice(0, 300), authors: splitAuthors(fields.author), source: 'user' });
      if (!book) return reply.code(422).send({ error: 'book_not_found', isbn: r.isbn });
    } else if (String(fields.title ?? '').trim()) {
      book = await findOrCreateBook({ title: String(fields.title).trim().slice(0, 300), authors: splitAuthors(fields.author), source: 'user' });
    }
    if (!book) return reply.code(422).send({ error: 'title_required' });
    const had = await one('SELECT id FROM my_books WHERE user_id = $1 AND book_id = $2 AND placed_at IS NULL', [req.user.id, book.id]);
    if (had && !fields.again) return { item: had, book, already: true };
    const photo = files.photo && await savePhoto(files.photo, { userId: req.user.id, kind: 'cover' });
    const item = await one('INSERT INTO my_books(user_id, book_id, photo_id) VALUES ($1, $2, $3) RETURNING id', [req.user.id, book.id, photo?.id ?? null]);
    return { item, book };
  });

  // "I left it in this library."
  app.post('/api/my-books/:id/place', {
    preHandler: requireUser(),
    config: { rateLimit: { max: 300, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const m = await one('SELECT * FROM my_books WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.user.id]);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.placed_at) return reply.code(409).send({ error: 'already_placed' });
    const loc = await locationByCode(String(req.body?.code ?? ''));
    if (!visibleTo(loc, req.user) || loc.status === 'removed') return reply.code(404).send({ error: 'not_found' });
    const book = await one('SELECT * FROM books WHERE id = $1', [m.book_id]);
    const distance = await distanceTo(loc.id, parseLatLon(req.body?.lat, req.body?.lon));
    const sighting = await recordSighting({ user: req.user, loc, book, kind: 'added', distance, photoId: m.photo_id });
    await q('UPDATE my_books SET placed_at = now(), location_id = $2, sighting_id = $3 WHERE id = $1', [m.id, loc.id, sighting.id]);
    return { sighting, code: loc.code };
  });

  app.delete('/api/my-books/:id', { preHandler: requireUser() }, async (req) => {
    await q('DELETE FROM my_books WHERE id = $1 AND user_id = $2 AND placed_at IS NULL', [Number(req.params.id), req.user.id]);
    return { ok: true };
  });

  // Libraries to choose from: the nearest ones, then those the reader used lately.
  app.get('/api/my-books/libraries', { preHandler: requireUser() }, async (req) => {
    const pos = parseLatLon(req.query.lat, req.query.lon);
    const near = pos ? await many(
      `SELECT l.code, l.name, ST_Distance(l.geom, ST_MakePoint($1, $2)::geography)::int AS distance_m
         FROM locations l WHERE l.status = 'approved' OR (l.status = 'pending' AND l.created_by = $3)
        ORDER BY l.geom <-> ST_MakePoint($1, $2)::geography LIMIT 8`,
      [pos.lon, pos.lat, req.user.id],
    ) : [];
    const recent = await many(
      `SELECT l.code, l.name, max(s.created_at) AS at FROM sightings s JOIN locations l ON l.id = s.location_id
        WHERE s.user_id = $1 AND l.status IN ('approved', 'pending') GROUP BY l.id ORDER BY at DESC LIMIT 8`,
      [req.user.id],
    );
    return { near, recent: recent.filter((r) => !near.some((n) => n.code === r.code)) };
  });
}
