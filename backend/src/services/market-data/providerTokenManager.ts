import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getEnv, getRuntimeDataDir } from '../../infrastructure/envConfig';
import { generateTotpCode } from '../../infrastructure/encryptionAndJwt';
import { sanitizeUserMessage } from '../../infrastructure/providerAnonymizer';

// Internal server-only upstream auth origin (NEVER exposed to UI or client APIs)
const UPSTREAM_AUTH_BASE = 'https://auth.dhan.co';
const TOKEN_CACHE_PATH = path.join(getRuntimeDataDir(), 'provider_token.json');

interface StoredSessionToken {
  accessToken: string;
  expiresAt: string | null;
  source: 'consent' | 'totp' | 'direct' | 'env';
  updatedAt: string;
}

export class MarketDataAuthError extends Error {
  public readonly statusCode = 503;
  public readonly code: string;
  constructor(message: string, code = 'MARKET_DATA_AUTH_REQUIRED') {
    super(sanitizeUserMessage(message));
    this.code = code;
  }
}

function decodeJwtClaims(token: string): { expMs: number | null; iatMs: number } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { expMs: null, iatMs: 0 };
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { exp?: number; iat?: number };
    return {
      expMs: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
      iatMs: typeof payload.iat === 'number' ? payload.iat * 1000 : 0,
    };
  } catch {
    return { expMs: null, iatMs: 0 };
  }
}

function decodeJwtExpiry(token: string): string | null {
  const { expMs } = decodeJwtClaims(token);
  return expMs != null ? new Date(expMs).toISOString() : null;
}

function isFresh(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms - Date.now() > 2 * 60 * 1000; // >2 minutes remaining
}

function readDiskToken(): StoredSessionToken | null {
  try {
    if (!fs.existsSync(TOKEN_CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8')) as StoredSessionToken;
  } catch {
    return null;
  }
}

function writeDiskToken(record: StoredSessionToken): void {
  try {
    fs.mkdirSync(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(record, null, 2));
  } catch {
    // Ignore read-only filesystem errors in stateless serverless runtimes
  }
}

export function getActiveSessionToken(): {
  token: string;
  clientId: string;
  expiresAt: string | null;
  source: string;
} | null {
  const env = getEnv();
  const clientId = env.MARKET_DATA_CLIENT_ID.trim();
  if (!clientId) return null;

  const disk = readDiskToken();
  const envToken = env.MARKET_DATA_ACCESS_TOKEN.trim();
  const diskFresh = Boolean(disk?.accessToken && isFresh(disk.expiresAt));
  const envClaims = envToken ? decodeJwtClaims(envToken) : null;
  const envExp = envClaims?.expMs != null ? new Date(envClaims.expMs).toISOString() : null;
  const envFresh = Boolean(envToken && isFresh(envExp));

  // If .env token is fresh and either no fresh disk token exists OR .env JWT was issued more recently, sync & prefer .env
  if (envFresh) {
    const diskIat = disk?.accessToken ? decodeJwtClaims(disk.accessToken).iatMs : 0;
    const diskUpdated = disk?.updatedAt ? new Date(disk.updatedAt).getTime() : 0;
    const envNewer = !diskFresh || (envClaims?.iatMs || 0) >= Math.max(diskIat, diskUpdated);
    if (envNewer && disk?.accessToken !== envToken) {
      try {
        writeDiskToken({
          accessToken: envToken,
          expiresAt: envExp,
          source: 'env',
          updatedAt: new Date().toISOString(),
        });
      } catch { /* ignore */ }
      return { token: envToken, clientId, expiresAt: envExp, source: 'env' };
    }
  }

  if (diskFresh && disk) {
    return {
      token: disk.accessToken,
      clientId,
      expiresAt: disk.expiresAt,
      source: disk.source,
    };
  }

  if (envFresh) {
    return {
      token: envToken,
      clientId,
      expiresAt: envExp,
      source: 'env',
    };
  }

  return null;
}

export function requireSessionToken() {
  const session = getActiveSessionToken();
  if (!session) {
    throw new MarketDataAuthError(
      'Market data session token is missing or expired. Please refresh the market data session in Admin Settings.',
      'MARKET_DATA_AUTH_REQUIRED'
    );
  }
  return session;
}

export function setDirectSessionToken(token: string): {
  authenticated: boolean;
  expiresAt: string | null;
} {
  const clean = token.trim();
  if (clean.length < 20) {
    throw new MarketDataAuthError('Provided market data session token is invalid.', 'INVALID_TOKEN');
  }
  const expiresAt = decodeJwtExpiry(clean);
  if (!isFresh(expiresAt)) {
    throw new MarketDataAuthError('Provided market data session token is already expired.', 'EXPIRED_TOKEN');
  }
  writeDiskToken({
    accessToken: clean,
    expiresAt,
    source: 'direct',
    updatedAt: new Date().toISOString(),
  });
  return { authenticated: true, expiresAt };
}

/** Step 1 of OAuth consent login (returns neutral loginUrl for admin browser 2FA). */
export async function startConsentSession(): Promise<{ consentId: string; loginUrl: string }> {
  const env = getEnv();
  if (!env.MARKET_DATA_CLIENT_ID || !env.MARKET_DATA_API_KEY || !env.MARKET_DATA_API_SECRET) {
    throw new MarketDataAuthError('Market data API credentials are not configured on the server.', 'CONFIG_MISSING');
  }
  const r = await axios.post(
    `${UPSTREAM_AUTH_BASE}/app/generate-consent?client_id=${encodeURIComponent(env.MARKET_DATA_CLIENT_ID)}`,
    {},
    {
      headers: {
        app_id: env.MARKET_DATA_API_KEY,
        app_secret: env.MARKET_DATA_API_SECRET,
        Accept: 'application/json',
      },
      timeout: 15_000,
    }
  );
  const consentId = r.data?.consentAppId as string | undefined;
  if (!consentId) {
    throw new MarketDataAuthError('Unable to initiate market data authorization session.', 'CONSENT_FAILED');
  }
  return {
    consentId,
    loginUrl: `${UPSTREAM_AUTH_BASE}/login/consentApp-login?consentAppId=${encodeURIComponent(consentId)}`,
  };
}

/** Step 3 of OAuth consent login: exchange redirect tokenId for a 24h JWT session token. */
export async function finishConsentSession(tokenId: string): Promise<{ authenticated: boolean; expiresAt: string | null }> {
  const clean = tokenId.trim();
  if (clean.startsWith('eyJ') && clean.split('.').length === 3) {
    return setDirectSessionToken(clean);
  }
  const env = getEnv();
  const r = await axios.post(
    `${UPSTREAM_AUTH_BASE}/app/consumeApp-consent?tokenId=${encodeURIComponent(clean)}`,
    {},
    {
      headers: {
        app_id: env.MARKET_DATA_API_KEY,
        app_secret: env.MARKET_DATA_API_SECRET,
        Accept: 'application/json',
      },
      timeout: 15_000,
    }
  );
  const accessToken = (r.data?.accessToken || r.data?.access_token) as string | undefined;
  if (!accessToken) {
    throw new MarketDataAuthError('Failed to finalize market data session token.', 'CONSENT_FAILED');
  }
  const expiresAt = (r.data?.expiryTime as string | undefined) || decodeJwtExpiry(accessToken);
  writeDiskToken({
    accessToken,
    expiresAt,
    source: 'consent',
    updatedAt: new Date().toISOString(),
  });
  return { authenticated: true, expiresAt };
}

/** Optional headless daily TOTP refresh when MARKET_DATA_PIN & MARKET_DATA_TOTP_SECRET are configured. */
export async function refreshViaTotp(): Promise<{ authenticated: boolean; expiresAt: string | null }> {
  const env = getEnv();
  if (!env.MARKET_DATA_CLIENT_ID || !env.MARKET_DATA_PIN || !env.MARKET_DATA_TOTP_SECRET) {
    throw new MarketDataAuthError('Automated TOTP credentials are not configured.', 'TOTP_CONFIG_MISSING');
  }
  const totp = generateTotpCode(env.MARKET_DATA_TOTP_SECRET);
  const r = await axios.post(
    `${UPSTREAM_AUTH_BASE}/app/generateAccessToken`,
    null,
    {
      params: {
        dhanClientId: env.MARKET_DATA_CLIENT_ID,
        pin: env.MARKET_DATA_PIN,
        totp,
      },
      timeout: 15_000,
    }
  );
  const accessToken = (r.data?.accessToken || r.data?.access_token) as string | undefined;
  if (!accessToken) {
    throw new MarketDataAuthError('Automated session refresh did not return a token.', 'TOTP_REFRESH_FAILED');
  }
  const expiresAt = (r.data?.expiryTime as string | undefined) || decodeJwtExpiry(accessToken);
  writeDiskToken({
    accessToken,
    expiresAt,
    source: 'totp',
    updatedAt: new Date().toISOString(),
  });
  return { authenticated: true, expiresAt };
}

export function getTokenStatus() {
  const env = getEnv();
  const active = getActiveSessionToken();
  const minutesRemaining =
    active?.expiresAt != null
      ? Math.max(0, Math.round((new Date(active.expiresAt).getTime() - Date.now()) / 60_000))
      : null;

  return {
    credentialsConfigured: Boolean(
      env.MARKET_DATA_CLIENT_ID && env.MARKET_DATA_API_KEY && env.MARKET_DATA_API_SECRET
    ),
    totpAutoRefreshConfigured: Boolean(env.MARKET_DATA_PIN && env.MARKET_DATA_TOTP_SECRET),
    authenticated: Boolean(active),
    expiresAt: active?.expiresAt ?? null,
    minutesRemaining,
  };
}
