import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { NormalizedQuote } from '@broker/shared';
import { buildApp } from '../app';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';
import { placeOrder } from '../services/trading-oms/orderManagementService';

const MCX_EVENING_IST = new Date('2026-06-08T14:30:00.000Z'); // Mon 20:00 IST (Equity CLOSED, MCX OPEN!)

describe('Phase 6 — ETFs Catalog, MCX Commodities Trading (CTT & Evening Hours) & Market Analytics', () => {
  let app: FastifyInstance;
  let userId = '';
  let token = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `comm_${Date.now()}@example.in`,
        fullName: 'Commodity Trader',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    userId = reg.json().user.id;
    token = reg.json().accessToken;

    await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 5000000 }, // ₹50,00,000 DEMO margin
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('serves categorized NSE/BSE ETFs (Gold, Silver, Index, Sectoral, Liquid) with zero provider branding', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/segments/etfs?quotes=false' });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);
    const body = res.json();
    expect(body.countsByCategory).toBeDefined();
    expect(Array.isArray(body.etfs)).toBe(true);
  });

  it('serves active MCX Commodity derivatives and executes MCX Futures SELL during evening hours (20:00 IST) with CTT & Blockchain seal', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/segments/commodities?group=BULLION&kind=FUTURES&quotes=false' });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);
    const body = res.json();
    expect(body.exchange).toBe('MCX');
    expect(body.regulatoryNote).toContain('MCX');

    // If live scrip master cache is present, execute a real MCX Gold/Silver Futures trade at 20:00 IST (Equity closed, MCX open!)
    const firstContract = body.contracts[0];
    if (firstContract) {
      const mockMcxQuote: NormalizedQuote = {
        instrumentId: firstContract.instrumentId,
        symbol: firstContract.symbol,
        exchange: 'MCX',
        segment: 'COMM',
        ltp: '120000.00',
        prevClose: '119500.00',
        open: '119800.00',
        high: '120500.00',
        low: '119200.00',
        change: '500.00',
        changePercent: '0.42',
        volume: 2500,
        vwap: '119900.00',
        openInterest: 15000,
        bidDepth: [],
        askDepth: [],
        freshness: 'LIVE',
        timestamp: MCX_EVENING_IST.toISOString(),
      };

      const tradeRes = await placeOrder({
        userId,
        accountMode: 'DEMO',
        symbol: firstContract.instrumentId,
        side: 'SELL',
        product: 'NRML',
        orderType: 'MARKET',
        quantity: firstContract.lotSize,
        quoteOverride: mockMcxQuote,
        nowOverride: MCX_EVENING_IST,
        allowAfterHoursDemo: false, // Proves MCX is genuinely OPEN at 20:00 IST!
      });

      expect(tradeRes.order.status).toBe('FILLED');
      expect(Number(tradeRes.charges?.sttOrCtt)).toBeGreaterThan(0); // MCX CTT levied on SELL
      expect(tradeRes.blockchainProof?.hash).toMatch(/^00[a-f0-9]{62}$/);
    }
  });

  it('serves live Market Overview analytics (Gainers, Losers, Most Active, Sector Heatmap) with zero provider leakage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/segments/analytics' });
    expect(res.statusCode).toBe(200);
    expect(containsProviderLeak(res.body)).toBe(false);
    const body = res.json();
    expect(Array.isArray(body.sectors)).toBe(true);
    expect(body.sectors.length).toBe(8);
  });
});
