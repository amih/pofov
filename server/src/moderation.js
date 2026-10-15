import { config, POINTS } from './config.js';
import { q } from './db.js';

// Content from trusted users is published straight away unless something
// looks off (e.g. the reporter was far from the library).
export function initialStatus(user, { far = false } = {}) {
  return user.trust_level >= 1 && !far ? 'approved' : 'pending';
}

// New libraries and changes to libraries: reviewed unless an admin made them.
export function locationStatus(user) {
  if (user.trust_level >= 3) return 'approved';
  return config.reviewAllLocations ? 'pending' : initialStatus(user);
}

export async function award(db, { userId, points, reason, refType, refId, by = null }) {
  if (!userId) return;
  await db.query(
    `INSERT INTO karma_events(user_id, points, reason, ref_type, ref_id, awarded_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, points, reason, refType, refId, by],
  );
}

export const pointsForSighting = (kind) => (kind === 'seen' || kind === 'added' ? POINTS.sighting : POINTS.gone);

// After N approved contributions a new user becomes trusted.
export async function maybePromote(db, userId) {
  if (!userId) return;
  await db.query(
    `UPDATE users SET trust_level = 1
      WHERE id = $1 AND trust_level = 0
        AND (SELECT count(*) FROM locations WHERE created_by = $1 AND status = 'approved')
          + (SELECT count(*) FROM sightings WHERE user_id = $1 AND status = 'approved') >= $2`,
    [userId, config.trustThreshold],
  );
}

export async function audit(userId, action, refType, refId, detail = null) {
  await q('INSERT INTO audit_log(user_id, action, ref_type, ref_id, detail) VALUES ($1,$2,$3,$4,$5)',
    [userId, action, refType, refId, detail]);
}

