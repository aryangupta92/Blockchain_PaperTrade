'use strict';
/**
 * services/data/dhanAuth.js
 *  
 * DhanHQ API-Key/Secret → 24h access token manager.
 *
 * Dhan no longer issues long-lived tokens. Access tokens expire after 24h, so
 * this module implements the documented OAuth consent flow:
 *
 * STEP 1 POST https://auth.dhan.co/app/generate-consent?client_id=...
 * headers: app_id, app_secret → { consentAppId }
 * STEP 2 USER OPENS (in browser) https://auth.dhan.co/login/consentApp-login?consentAppId=...
 * logs in with Dhan credentials + 2FA, gets redirected to
 * <redirect_url>/?tokenId=<TOKEN_ID>
 * STEP 3 POST https://auth.dhan.co/app/consumeApp-consent?tokenId=...
 * headers: app_id, app_secret → { accessToken, expiryTime, ... }
 *
 * Tokens are cached to disk (server/data/dhan_token.json) so the app keeps
 * working across restarts until the 24h window closes.
 *
 * A pre-generated token may also be supplied via DHAN_ACCESS_TOKEN in .env,
 * which is the fastest path — it simply needs to be replaced every 24h.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const AUTH_BASE = 'https://auth.dhan.co';
const TOKEN_FILE = process.env.DHAN_TOKEN_FILE
  || path.join(__dirname, '..', '..', 'data', 'dhan_token.json');
const LOGIN_BASE = 'https://auth.dhan.co/login/consentApp-login';

// Config  
function creds() {
  return {
    clientId: (process.env.DHAN_CLIENT_ID || '').trim(),
    appId: (process.env.DHAN_APP_ID || '').trim(),
    appSecret:(process.env.DHAN_APP_SECRET || '').trim(),
  };
}

/** True when key+secret are present (the automated consent path). */
function hasAppCredentials() {
  const c = creds();
  return Boolean(c.clientId && c.appId && c.appSecret);
}

// Disk token store  
function readToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (e) { console.warn('[DhanAuth] token file unreadable:', e.message); }
  return null;
}

function writeToken(data) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('[DhanAuth] could not persist token:', e.message); }
}

function minutesUntil(expiryTime) {
  const t = new Date(expiryTime).getTime();
  if (!isFinite(t)) return -1;
  return Math.round((t - Date.now()) / 60000);
}

/**
 * A token is usable when it has not expired. Tokens whose `exp` could not be
 * decoded are assumed to run for the documented 24h window from when they were
 * saved, and are re-validated against Dhan on first real use anyway.
 */
function isTokenFresh(stored, envToken) {
  const token = stored?.accessToken || envToken;
  if (!token) return false;

  if (stored?.expiryTime) return minutesUntil(stored.expiryTime) > 2;

  // No expiry info: fall back to age of the saved record (24h window).
  if (stored?.approxExpiry && stored?.createdAt) {
    const ageH = (Date.now() - new Date(stored.createdAt).getTime()) / 3600000;
    return ageH < 23;
  }
  // Saved by the consent flow with an expiryTime, or a plain env token.
  if (!stored?.expiryTime) return Boolean(token);
  return false;
}

// Public API  

/**
 * STEP 1 — create a consent session the user logs in through.
 * Returns { consentAppId, loginUrl, status }
 */
async function startConsent() {
  const { clientId, appId, appSecret } = creds();
  if (!clientId) throw new DhanAuthError('DHAN_CLIENT_ID is not set in server/.env', 'CONFIG');
  if (!appId || !appSecret) throw new DhanAuthError('DHAN_APP_ID / DHAN_APP_SECRET are not set in server/.env', 'CONFIG');

  const r = await axios.post(
    `${AUTH_BASE}/app/generate-consent?client_id=${clientId}`,
    {},
    { headers: { app_id: appId, app_secret: appSecret, Accept: 'application/json' }, timeout: 20000 }
  );

  const consentAppId = r.data?.consentAppId;
  if (!consentAppId) {
    const err = new Error(`Consent rejected: ${JSON.stringify(r.data)}`);
    err.code = 'CONSENT_FAILED';
    throw err;
  }
  return {
    consentAppId,
    loginUrl: `${LOGIN_BASE}?consentAppId=${consentAppId}`,
    status: r.data?.consentAppStatus || r.data?.status || 'GENERATED',
    expiresInMinutes: 10, // browser login sessions are short-lived
  };
}

/**
 * STEP 3 — exchange the browser tokenId for a 24h access token.
 *
 * Two kinds of value get pasted in here and we handle both:
 *   - a short `tokenId` from the redirect URL  -> consent flow
 *   - a JWT access token (starts with "eyJ") generated from web.dhan.co
 * The second is a legitimate, documented route and is the easiest one, so it is
 * detected and saved directly instead of failing with an opaque 401.
 */
async function finishConsent(tokenId) {
  const { appId, appSecret } = creds();
  if (!tokenId) throw new DhanAuthError('tokenId is required — copy it from the redirect URL', 'VALIDATION');

  const value = String(tokenId).trim();

  // JWT-shaped? Then it is already an access token - use it directly.
  if (looksLikeJwt(value)) {
    return setDirectToken(value, 'JWT pasted directly');
  }

  if (!appId || !appSecret) throw new DhanAuthError('DHAN_APP_ID / DHAN_APP_SECRET are not set in server/.env', 'CONFIG');

  let r;
  try {
    r = await axios.post(
      `${AUTH_BASE}/app/consumeApp-consent?tokenId=${encodeURIComponent(value)}`,
      {},
      { headers: { app_id: appId, app_secret: appSecret, Accept: 'application/json' }, timeout: 20000 }
    );
  } catch (e) {
    // Surface Dhan's real message instead of a bare "Request failed with status code 401"
    const status = e.response?.status;
    const body = e.response?.data;
    const detail = body && typeof body === 'object'
      ? (body.errorMessage || body.message || body.error || JSON.stringify(body))
      : (typeof body === 'string' && body ? body : e.message);
    throw new DhanAuthError(`Dhan rejected the tokenId (HTTP ${status || 'network error'}): ${detail}`, status === 401 ? 'INVALID_TOKEN' : 'CONSENT_FAILED');
  }

  const d = r.data || {};
  const accessToken = d.accessToken || d.access_token;
  if (!accessToken) {
    throw new DhanAuthError(`Consent response had no access token: ${JSON.stringify(d)}`, 'CONSENT_FAILED');
  }

  const stored = {
    accessToken,
    dhanClientId: d.dhanClientId,
    dhanClientName: d.dhanClientName,
    dhanClientUcc: d.dhanClientUcc,
    expiryTime: d.expiryTime,
    givenPowerOfAttorney: d.givenPowerOfAttorney,
    createdAt: new Date().toISOString(),
  };
  writeToken(stored);
  return publicStatus(stored);
}

/** True when a value is a JWT (header.payload.signature). */
function looksLikeJwt(v) {
  const s = String(v || '').trim();
  if (!s.startsWith('eyJ')) return false;
  return s.split('.').length === 3;
}

/** Decode the `exp` claim from a JWT payload so we know when it dies. */
function jwtExpiry(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (typeof json.exp === 'number') return new Date(json.exp * 1000).toISOString();
  } catch {}
  return null;
}

/**
 * Accept a pre-generated access token (from web.dhan.co or the consent flow).
 * Expiry is read from the JWT when present; otherwise we assume the documented
 * 24h window and still let it through.
 */
function setDirectToken(accessToken, note) {
  const token = String(accessToken || '').trim();
  if (!token || token.length < 20) throw new DhanAuthError('That does not look like an access token', 'VALIDATION');
  const expiryTime = looksLikeJwt(token) ? jwtExpiry(token) : null;
  const stored = {
    accessToken: token,
    expiryTime,
    approxExpiry: !expiryTime,
    source: 'direct',
    note,
    createdAt: new Date().toISOString(),
  };
  writeToken(stored);
  return publicStatus(stored);
}

/**
 * Resolve the token to use: fresh file token > .env token > null.
 * Does not throw — callers should check `.token`.
 */
function getToken() {
  const stored = readToken();
  const envToken = (process.env.DHAN_ACCESS_TOKEN || '').trim();

  if (stored?.accessToken && isTokenFresh(stored)) {
    return { token: stored.accessToken, source: 'consent', expiresAt: stored.expiryTime, stored };
  }
  if (envToken) {
    return { token: envToken, source: 'env', expiresAt: null, stored: null };
  }
  return null;
}

/**
 * Authoritative access token or a descriptive error telling the caller exactly
 * what to do (used by every data service so failures are actionable).
 */
function requireToken() {
  const t = getToken();
  if (t) return t;
  const err = new DhanAuthError(
    'Dhan access token missing or expired. Complete the consent login in Settings → Dhan feed.',
    'AUTH_REQUIRED'
  );
  throw err;
}

function publicStatus(stored) {
  const t = getToken();
  const minutes = t?.expiresAt ? minutesUntil(t.expiresAt) : null;
  return {
    configured: hasAppCredentials(),
    hasAppCredentials: hasAppCredentials(),
    clientIdSet: Boolean(creds().clientId),
    authenticated: Boolean(t),
    tokenSource: t?.source || null,
    expiresAt: t?.expiresAt || null,
    minutesRemaining: minutes,
    clientName: stored?.dhanClientName || t?.stored?.dhanClientName || null,
    needsLogin: !t && hasAppCredentials(),
    instructions: !t
      ? (hasAppCredentials()
          ? 'Call POST /api/dhan/auth/start, open loginUrl in a browser, then POST /api/dhan/auth/finish with the tokenId from the redirect.'
          : 'Set DHAN_APP_ID and DHAN_APP_SECRET in server/.env (or paste a fresh 24h token as DHAN_ACCESS_TOKEN).')
      : null,
  };
}

function getStatus() {
  return publicStatus(readToken());
}

/**
 * Verify a candidate token against Dhan before we save it, so the UI can say
 * "connected" only when it truly is. Uses the cheapest authenticated endpoint.
 *
 * Returns { ok:true } only when Dhan actually accepted the token. Network-level
 * failures return { ok:false, unverified:true } so callers refuse to persist a
 * token we could not check (better than storing garbage).
 */
async function verifyToken(token) {
  try {
    const r = await axios.get('https://api.dhan.co/v2/fundlimit', {
      headers: { 'access-token': token, 'client-id': creds().clientId, Accept: 'application/json' },
      timeout: 15000,
    });
    return { ok: true, status: r.status, marketStatus: r.data?.data || r.data };
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;

    if (status === 401 || status === 403) {
      return { ok: false, reason: 'Dhan rejected this token - it is expired or invalid. Generate a new one and try again.' };
    }
    // Timeouts / DNS / 5xx: we cannot tell, so do not claim success.
    const detail = data?.errorMessage || e.message;
    return { ok: false, unverified: true, reason: `Could not verify the token with Dhan (${status || 'network error'}: ${detail}). Nothing was saved - please retry.` };
  }
}

class DhanAuthError extends Error {
  constructor(message, code) { super(message); this.name = 'DhanAuthError'; this.code = code; this.status = 401; }
}

module.exports = {
  startConsent, finishConsent, setDirectToken, verifyToken,
  getToken, requireToken, getStatus,
  hasAppCredentials, readToken, DhanAuthError,
};
