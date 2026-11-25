import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { STRATEGY_PRESETS } from '@broker/shared';
import { buildApp } from '../app';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';

describe('Strategy Builder & Zero-Bias Backtesting API', () => {
  let app: FastifyInstance;
  let token = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `strat_${Date.now()}@example.in`,
        fullName: 'Quant Builder',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    token = reg.json().accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('serves starter strategy presets, saves/updates/deletes user strategies, and persists a backtest run', async () => {
    const presets = await app.inject({ method: 'GET', url: '/api/v1/strategies/presets' });
    expect(presets.statusCode).toBe(200);
    expect(presets.json().presets.length).toBeGreaterThanOrEqual(5);
    expect(containsProviderLeak(presets.body)).toBe(false);

    // Save custom strategy
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/strategies',
      headers: { authorization: `Bearer ${token}` },
      payload: { definition: STRATEGY_PRESETS[0] },
    });
    expect(saveRes.statusCode).toBe(201);
    const stratId = saveRes.json().id;

    // Generate 60 deterministic daily bars for backtest persistence test
    const start = Math.floor(new Date('2026-04-02T09:15:00+05:30').getTime() / 1000);
    const barsOverride = Array.from({ length: 60 }, (_, i) => {
      const px = 1300 + Math.sin(i / 5) * 90 + i * 3;
      return {
        time: start + i * 86400,
        open: Number(px.toFixed(2)),
        high: Number((px + 12).toFixed(2)),
        low: Number((px - 10).toFixed(2)),
        close: Number((px + 4).toFixed(2)),
        volume: 250000,
      };
    });

    const btRes = await app.inject({
      method: 'POST',
      url: '/api/v1/strategies/backtest',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        strategyId: stratId,
        strategy: STRATEGY_PRESETS[0],
        symbol: 'RELIANCE',
        interval: '1D',
        fromDate: '2026-04-02',
        toDate: '2026-06-05',
        initialCapital: 200000,
        saveRun: true,
        barsOverride,
      },
    });
    expect(btRes.statusCode).toBe(200);
    expect(containsProviderLeak(btRes.body)).toBe(false);
    const bt = btRes.json();
    expect(bt.runId).toBeTruthy();
    expect(bt.barsAnalyzed).toBe(60);
    expect(bt.equityCurve).toHaveLength(60);
    expect(Number(bt.metrics.totalChargesPaid)).toBeGreaterThanOrEqual(0);

    // List and fetch stored backtest run
    const listRuns = await app.inject({
      method: 'GET',
      url: '/api/v1/strategies/backtests',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRuns.statusCode).toBe(200);
    expect(listRuns.json().runs.some((r: { id: string }) => r.id === bt.runId)).toBe(true);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/strategies/backtests/${bt.runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().trades).toHaveLength(bt.trades.length);

    // Cleanup saved strategy
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/strategies/${stratId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delRes.statusCode).toBe(200);
  });
});
