import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { containsProviderLeak, sanitizeUserMessage } from '../infrastructure/providerAnonymizer';

describe('Phase 0 API — Health, Regulatory Config, Charges, Blockchain & Provider Anonymity', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/v1/health returns neutral health with valid blockchain genesis and zero provider leaks', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);

    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.marketData.fallbackSourcesRemoved).toBe(true);
    expect(body.blockchain.valid).toBe(true);
    expect(body.blockchain.totalBlocks).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/config/regulatory returns Finance Act 2026 STT rates effective 2026-04-01', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/config/regulatory?asOf=2026-05-01',
    });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);

    const cfg = res.json();
    expect(cfg.stt.value.fnoFuturesSellPct).toBe('0.05');
    expect(cfg.stt.value.fnoOptionsSellPremiumPct).toBe('0.15');
    expect(cfg.fnoRules.value.upfrontOptionPremiumPct).toBe('100');
  });

  it('POST /api/v1/charges/estimate computes exact Finance Act 2026 Equity Delivery charges', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/charges/estimate',
      payload: {
        exchange: 'NSE',
        segment: 'EQ',
        instrumentKind: 'EQUITY',
        product: 'CNC',
        side: 'BUY',
        quantity: 100,
        price: '1000',
        asOfDate: '2026-04-15',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCharges).toBe('118.62');
    expect(body.sttOrCtt).toBe('100.00');
  });

  it('GET /api/v1/blockchain/verify validates database hash chain & Merkle root', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/blockchain/verify' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.merkleRoot).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Rule 1.2 anonymizer strips any accidental upstream provider names or error codes', () => {
    const leaked = 'DhanHQ api.dhan.co error DH-904 or Yahoo Finance fallback failed';
    const cleaned = sanitizeUserMessage(leaked);
    expect(containsProviderLeak(cleaned)).toBe(false);
  });
});
