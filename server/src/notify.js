import { config } from './config.js';
import { one, many, q } from './db.js';
import { sendMail } from './mail.js';

// Emails the admins (ADMIN_EMAILS) when new things wait for review, at most once
// per NOTIFY_ADMIN_MINUTES. Each email lists only what arrived since the last one.
export function startAdminNotifier(log) {
  const minutes = config.notifyAdminMinutes;
  if (!minutes || !config.adminEmails.length) return;
  const run = () => notifyAdmins(log).catch((err) => log.error({ err }, 'admin notify failed'));
  setTimeout(run, 30_000).unref();
  setInterval(run, minutes * 60_000).unref();
}

async function notifyAdmins(log) {
  const state = await one(`SELECT value FROM app_state WHERE key = 'admin_notified_at'`);
  const since = state?.value ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const now = new Date().toISOString();

  const by = `COALESCE(u.screen_name, 'Reader #' || u.id)`;
  const locations = await many(
    `SELECT l.code, l.name, l.description, l.privacy_flag, ${by} AS who FROM locations l LEFT JOIN users u ON u.id = l.created_by
      WHERE l.status = 'pending' AND l.created_at > $1 ORDER BY l.created_at`, [since]);
  const edits = await many(
    `SELECT l.code, l.name, e.changes, e.privacy_flag, ${by} AS who FROM location_edits e JOIN locations l ON l.id = e.location_id
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.status = 'pending' AND e.created_at > $1 ORDER BY e.created_at`, [since]);
  const sightings = await one(
    `SELECT count(*)::int AS n FROM sightings WHERE status = 'pending' AND created_at > $1`, [since]);
  const users = await many(
    `SELECT COALESCE(screen_name, 'Reader #' || id) AS who FROM users WHERE created_at > $1 ORDER BY created_at`, [since]);

  const total = locations.length + edits.length + sightings.n + users.length;
  if (!total) return mark(now);

  const link = (code) => `${config.baseUrl}/l/${code}`;
  const lines = [];
  if (locations.length) {
    lines.push(`New libraries (${locations.length}):`);
    for (const l of locations) lines.push(`  • ${l.privacy_flag ? '⚠️ PRIVATE INFO? ' : ''}${l.name || '(no name)'} — by ${l.who}\n    ${l.description ? l.description.slice(0, 120) + '\n    ' : ''}${link(l.code)}`);
    lines.push('');
  }
  if (edits.length) {
    lines.push(`Library changes (${edits.length}):`);
    for (const e of edits) {
      const what = Object.keys(e.changes).filter((k) => k !== 'moved_m').map((k) => (k === 'photo_id' ? 'photo' : k === 'lat' ? `moved ${e.changes.moved_m} m` : k)).filter((k) => k !== 'lon');
      lines.push(`  • ${e.privacy_flag ? '⚠️ PRIVATE INFO? ' : ''}${e.name || e.code}: ${what.join(', ')} — by ${e.who}\n    ${link(e.code)}`);
    }
    lines.push('');
  }
  if (sightings.n) lines.push(`Book reports waiting: ${sightings.n}`, '');
  if (users.length) lines.push(`New users (${users.length}): ${users.map((u) => u.who).join(', ')}`, '');
  lines.push(`Review queue: ${config.baseUrl}/review`);

  const subject = `Seferehov: ${[
    locations.length && `${locations.length} new ${locations.length === 1 ? 'library' : 'libraries'}`,
    edits.length && `${edits.length} library ${edits.length === 1 ? 'change' : 'changes'}`,
    sightings.n && `${sightings.n} book ${sightings.n === 1 ? 'report' : 'reports'}`,
    users.length && `${users.length} new ${users.length === 1 ? 'user' : 'users'}`,
  ].filter(Boolean).join(', ')}`;
  for (const to of config.adminEmails) await sendMail({ to, subject, text: lines.join('\n') }, log);
  await mark(now);
}

const mark = (now) => q(`INSERT INTO app_state(key, value) VALUES ('admin_notified_at', to_jsonb($1::text))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [now]);
