import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { generateTotpCode } from '../infrastructure/encryptionAndJwt';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';

describe('Phase 1 — Auth, 2FA, Dual Zero-Start Accounts, DEMO Reset/Archive, Isolation & Blockchain', () => {
  let app: FastifyInstance;
  const email = `trader_${Date.now()}@example.in`;
  const password = 'StrongPassword123';
  let accessToken = '';
  let refreshCookie = '';
  let totpSecret = '';
  let lastBlockHash = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects registration unless SEBI risk disclosure is acknowledged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        fullName: 'Aarav Sharma',
        password,
        acceptSebiRiskDisclosure: false,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('RISK_DISCLOSURE_REQUIRED');
  });

  it('registers user and provisions BOTH DEMO and REAL accounts starting at ₹0.00', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        fullName: 'Aarav Sharma',
        password,
        acceptSebiRiskDisclosure: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(containsProviderLeak(res.body)).toBe(false);

    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    accessToken = body.accessToken;

    const setCookie = res.headers['set-cookie'];
    refreshCookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie || '');
    expect(refreshCookie).toContain('tb_refresh=');
    expect(refreshCookie).toContain('HttpOnly');

    expect(body.accounts).toHaveLength(2);
    const demo = body.accounts.find((a: { mode: string }) => a.mode === 'DEMO');
    const real = body.accounts.find((a: { mode: string }) => a.mode === 'REAL');
    expect(demo.cashBalance).toBe('0.00');
    expect(real.cashBalance).toBe('0.00');
    expect(demo.resetEpoch).toBe(1);
  });

  it('validates DEMO balance strictly between ₹1,000 and ₹1,00,00,000', async () => {
    const tooLow = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { amount: 500 },
    });
    expect(tooLow.statusCode).toBe(400);

    const tooHigh = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { amount: 10000001 },
    });
    expect(tooHigh.statusCode).toBe(400);

    // Explicitly forbidden on REAL account
    const realReset = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/real/balance',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { amount: 50000 },
    });
    expect(realReset.statusCode).toBe(403);
  });

  it('sets initial DEMO balance to ₹2,00,000, seals Blockchain proof, and keeps REAL isolated at ₹0.00', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { amount: 200000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.account.cashBalance).toBe('200000.00');
    expect(body.account.resetEpoch).toBe(1);
    expect(body.ledgerEntry.entryType).toBe('DEMO_SET');
    expect(body.blockchainProof.hash).toMatch(/^00[a-f0-9]{62}$/);
    lastBlockHash = body.blockchainProof.hash;

    // Verify REAL account remained strictly isolated at ₹0.00 with 0 ledger entries
    const realLedger = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/REAL/ledger',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(realLedger.statusCode).toBe(200);
    expect(realLedger.json().account.cashBalance).toBe('0.00');
    expect(realLedger.json().entries).toHaveLength(0);
  });

  it('resets DEMO balance to ₹10,00,000, archives Epoch #1, and verifies Blockchain block proof', async () => {
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { amount: 1000000 },
    });
    expect(resetRes.statusCode).toBe(200);
    const body = resetRes.json();
    expect(body.account.cashBalance).toBe('1000000.00');
    expect(body.account.resetEpoch).toBe(2);
    expect(body.archivedEpoch.epoch).toBe(1);
    expect(body.archivedEpoch.endingCashBalance).toBe('200000.00');

    const archivesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/demo/archives',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(archivesRes.statusCode).toBe(200);
    expect(archivesRes.json().archives).toHaveLength(1);

    // Verify individual block proof + full chain integrity
    const proofRes = await app.inject({
      method: 'GET',
      url: `/api/v1/blockchain/blocks/${lastBlockHash}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(proofRes.statusCode).toBe(200);
    expect(proofRes.json().verified).toBe(true);

    const verifyRes = await app.inject({ method: 'GET', url: '/api/v1/blockchain/verify' });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(true);
  });

  it('supports refresh session cookie and full RFC 6238 TOTP 2FA setup & login enforcement', async () => {
    const cookiePair = refreshCookie.split(';')[0];
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookiePair },
    });
    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.json().accessToken).toBeTruthy();

    // Setup 2FA
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/setup',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(setupRes.statusCode).toBe(200);
    totpSecret = setupRes.json().secret;
    expect(totpSecret).toBeTruthy();

    // Enable 2FA with valid live 6-digit TOTP code
    const code = generateTotpCode(totpSecret);
    const enableRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp/enable',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code },
    });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json().totpEnabled).toBe(true);

    // Login without TOTP must now be rejected
    const noTotpLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(noTotpLogin.statusCode).toBe(401);
    expect(noTotpLogin.json().code).toBe('TOTP_REQUIRED');

    // Login with valid TOTP succeeds
    const okLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password, totpCode: generateTotpCode(totpSecret) },
    });
    expect(okLogin.statusCode).toBe(200);
    expect(okLogin.json().accessToken).toBeTruthy();
  });
});
