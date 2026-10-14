import { config } from './config.js';
import { one, q } from './db.js';
import { randomToken, sha256 } from './util.js';
import { sendMail } from './mail.js';

const SESSION_COOKIE = 'pofov_session';
const SESSION_DAYS = 180;
const LOGIN_TOKEN_MINUTES = 20;

export async function currentUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  return one(
    `SELECT u.id, u.email, u.display_name, u.trust_level
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
}

export function requireUser(minTrust = 0) {
  return async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'login_required' });
    if (req.user.trust_level < minTrust) return reply.code(403).send({ error: 'forbidden' });
  };
}

export default async function authRoutes(app) {
  app.post('/api/auth/request', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return reply.code(400).send({ error: 'invalid_email' });
    }
    const token = randomToken();
    await q(
      `INSERT INTO login_tokens(token_hash, email, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [sha256(token), email, LOGIN_TOKEN_MINUTES],
    );
    const link = `${config.baseUrl}/api/auth/verify?t=${token}`;
    await sendMail({
      to: email,
      subject: 'Your POFOV sign-in link',
      text: `Tap to sign in to POFOV:\n\n${link}\n\nThe link works once and expires in ${LOGIN_TOKEN_MINUTES} minutes.\nIf you did not ask for it, ignore this email.`,
    }, req.log);
    return { ok: true };
  });

  app.get('/api/auth/verify', async (req, reply) => {
    const token = String(req.query.t ?? '');
    const row = token && await one(
      `UPDATE login_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING email`,
      [sha256(token)],
    );
    if (!row) return reply.redirect('/login?error=expired');

    const trust = config.adminEmails.includes(row.email) ? 3 : 0;
    const user = await one(
      `INSERT INTO users(email, trust_level) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET trust_level = GREATEST(users.trust_level, EXCLUDED.trust_level)
       RETURNING id`,
      [row.email, trust],
    );
    const session = randomToken();
    await q(
      `INSERT INTO sessions(token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3))`,
      [sha256(session), user.id, SESSION_DAYS],
    );
    reply.setCookie(SESSION_COOKIE, session, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.baseUrl.startsWith('https://'),
      maxAge: SESSION_DAYS * 86400,
    });
    return reply.redirect('/me?welcome=1');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    if (!req.user) return { user: null };
    const stats = await one(
      `SELECT COALESCE((SELECT sum(points) FROM karma_events WHERE user_id = $1), 0)::int AS karma,
              (SELECT count(*) FROM locations WHERE created_by = $1 AND status = 'approved')::int AS locations,
              (SELECT count(*) FROM sightings WHERE user_id = $1 AND status = 'approved')::int AS sightings`,
      [req.user.id],
    );
    return { user: { ...req.user, ...stats } };
  });

  app.post('/api/me', { preHandler: requireUser() }, async (req) => {
    const name = String(req.body?.display_name ?? '').trim().slice(0, 40) || null;
    await q('UPDATE users SET display_name = $1 WHERE id = $2', [name, req.user.id]);
    return { ok: true };
  });
}
