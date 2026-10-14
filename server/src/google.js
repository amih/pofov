// Google sign-in, redirect flow. Adapted from imagine/mp3converter lib/auth.js
// (in production since 2026-08-12). No auth library: the ID token is an RS256
// JWT and node:crypto verifies it against Google's published keys.
import crypto from 'node:crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

let jwksCache = { keys: new Map(), fetchedAt: 0 };

async function getKey(kid) {
  const stale = Date.now() - jwksCache.fetchedAt > 60 * 60 * 1000;
  if (stale || !jwksCache.keys.has(kid)) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const { keys } = await res.json();
    jwksCache = {
      fetchedAt: Date.now(),
      keys: new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })])),
    };
  }
  const key = jwksCache.keys.get(kid);
  if (!key) throw new Error('unknown signing key');
  return key;
}

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function verifyGoogleIdToken(idToken, clientId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [rawHeader, rawPayload, rawSig] = parts;
  const header = JSON.parse(b64url(rawHeader).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);
  const key = await getKey(header.kid);
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${rawHeader}.${rawPayload}`), key, b64url(rawSig))) {
    throw new Error('bad signature');
  }
  const claims = JSON.parse(b64url(rawPayload).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.has(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('token was not minted for this app');
  if (claims.exp <= now) throw new Error('token expired');
  if (claims.nbf && claims.nbf > now + 60) throw new Error('token not yet valid');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email not verified by Google');
  if (!claims.email || !claims.sub) throw new Error('token carries no identity');
  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: claims.name || null,
    picture: claims.picture || null,
  };
}

export function authUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${q}`;
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.id_token) throw new Error(body.error_description || body.error || `token exchange failed (${res.status})`);
  // The exchange succeeding is not proof of identity on its own — verify the token.
  return verifyGoogleIdToken(body.id_token, clientId);
}
