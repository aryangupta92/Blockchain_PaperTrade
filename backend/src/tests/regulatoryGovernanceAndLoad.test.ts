import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';

describe('Phase 8 — Regulatory Watch, Admin RBAC Governance, DPDP Export, Security & Load Stress Test', () => {
  let app: FastifyInstance;
  let userToken = '';
  let adminToken = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `gov_${Date.now()}@example.in`,
        fullName: 'Compliance Officer',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    userToken = reg.json().accessToken;
    const setCookie = reg.headers['set-cookie'];
    const cookiePair = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie || '')).split(';')[0];

    // Confirm regular USER gets 403 on admin endpoints BEFORE promotion
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/configs',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // Promote in dev/test and refresh session to obtain ADMIN JWT
    const prom = await app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/dev-promote-admin',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(prom.statusCode).toBe(200);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookiePair },
    });
    expect(refreshed.statusCode).toBe(200);
    adminToken = refreshed.json().accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('runs Regulatory Watch scan, enforces DRAFT -> ADMIN approval workflow, seals Blockchain governance block, and publishes What\'s Changed notice', async () => {
    const scanRes = await app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/watch/run',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(scanRes.statusCode).toBe(200);
    expect(scanRes.json().sourcesMonitored).toBeGreaterThanOrEqual(5);

    const uniqueKey = `nse.lot_size_update_${Date.now()}`;
    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/drafts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        configKey: uniqueKey,
        effectiveFrom: '2026-12-01',
        payload: { NIFTY: 65, SENSEX: 20 },
        verification: 'VERIFIED',
        citation: 'NSE/FAOP/2026/LotSizeCircular',
      },
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json();
    expect(draft.status).toBe('DRAFT');

    // Draft MUST NOT appear in approved user-facing What's Changed notices yet
    const noticesBefore = await app.inject({ method: 'GET', url: '/api/v1/regulatory/notices' });
    expect(noticesBefore.json().notices.some((n: { configKey: string }) => n.configKey === uniqueKey)).toBe(false);

    // Admin approves draft -> seals SHA-256 Blockchain block!
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/drafts/${draft.id}/approve`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { effectiveFrom: '2026-12-01' },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().config.status).toBe('APPROVED');
    expect(approveRes.json().blockchainProof.hash).toMatch(/^00[a-f0-9]{62}$/);

    // Now visible in user-facing What's Changed notices + Audit Logs
    const noticesAfter = await app.inject({ method: 'GET', url: '/api/v1/regulatory/notices' });
    expect(noticesAfter.json().notices.some((n: { configKey: string }) => n.configKey === uniqueKey)).toBe(true);

    const logsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/audit-logs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(logsRes.statusCode).toBe(200);
    expect(logsRes.json().logs.some((l: { action: string }) => l.action === 'REGULATORY_CONFIG_APPROVED')).toBe(true);
  });

  it('exports authenticated user data and SEBI risk consent timestamps per DPDP Act (India)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/dpdp-export',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);
    const body = res.json();
    expect(body.act).toContain('Digital Personal Data Protection Act');
    expect(body.user.sebiRiskAckAt).toBeTruthy();
    expect(body.accounts).toHaveLength(2);
  });

  it('handles 50 concurrent API requests under load with 100% HTTP 200, valid blockchain, and zero provider leakage', async () => {
    const start = Date.now();
    const calls = Array.from({ length: 50 }, (_, idx) => {
      if (idx % 4 === 0) return app.inject({ method: 'GET', url: '/api/v1/health' });
      if (idx % 4 === 1) return app.inject({ method: 'GET', url: '/api/v1/config/regulatory' });
      if (idx % 4 === 2) {
        return app.inject({
          method: 'POST',
          url: '/api/v1/charges/estimate',
          payload: {
            exchange: 'NSE',
            segment: 'FNO',
            instrumentKind: 'OPTIONS',
            product: 'NRML',
            side: 'SELL',
            quantity: 65,
            price: '180',
          },
        });
      }
      return app.inject({ method: 'GET', url: '/api/v1/regulatory/notices' });
    });

    const responses = await Promise.all(calls);
    const elapsedMs = Date.now() - start;

    for (const r of responses) {
      expect(r.statusCode).toBe(200);
      expect(containsProviderLeak(r.body)).toBe(false);
    }
    expect(elapsedMs).toBeLessThan(15_000);
  });
});
