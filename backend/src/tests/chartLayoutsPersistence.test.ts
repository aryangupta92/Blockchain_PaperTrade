import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

describe('Phase 4 — Chart Layouts, Drawings & Templates Persistence', () => {
  let app: FastifyInstance;
  let token = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `chart_${Date.now()}@example.in`,
        fullName: 'Chart Trader',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    token = reg.json().accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('saves, lists, updates, and deletes per-user chart layouts with drawings and indicators', async () => {
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/charts/layouts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'NIFTY Scalping Setup',
        layout: {
          symbol: 'NIFTY',
          secondarySymbol: 'RELIANCE',
          splitView: true,
          interval: '5m',
          chartType: 'heikin_ashi',
          scaleMode: 'normal',
          indicators: ['EMA20', 'VWAP', 'SUPERTREND', 'RSI'],
          drawings: [
            { id: 'd1', type: 'hline', price: 25800 },
            { id: 'd2', type: 'fib', p1: { time: 1775000000, price: 25500 }, p2: { time: 1775050000, price: 25900 } },
          ],
        },
      },
    });
    expect(saveRes.statusCode).toBe(201);
    const saved = saveRes.json();
    expect(saved.name).toBe('NIFTY Scalping Setup');
    expect(saved.layout.drawings).toHaveLength(2);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/charts/layouts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().layouts).toHaveLength(1);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/charts/layouts/${saved.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().deleted).toBe(true);
  });
});
