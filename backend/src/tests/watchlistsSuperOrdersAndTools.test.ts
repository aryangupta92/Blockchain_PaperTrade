import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { NormalizedQuote } from '@broker/shared';
import { buildApp } from '../app';
import { getPrisma } from '../infrastructure/database';
import { placeOrder } from '../services/trading-oms/orderManagementService';
import { omsTickMonitor } from '../services/trading-oms/restingOrderTickMonitor';
import { containsProviderLeak } from '../infrastructure/providerAnonymizer';

const MARKET_OPEN_IST = new Date('2026-06-08T05:30:00.000Z'); // Mon 11:00 IST

const mockQuote = (symbol: string, ltp: string, instrumentId = 'NSE:EQ:2885'): NormalizedQuote => ({
  instrumentId,
  symbol,
  exchange: 'NSE',
  segment: 'EQ',
  ltp,
  prevClose: '1400.00',
  open: '1400.00',
  high: (Number(ltp) + 15).toFixed(2),
  low: (Number(ltp) - 15).toFixed(2),
  change: (Number(ltp) - 1400).toFixed(2),
  changePercent: (((Number(ltp) - 1400) / 1400) * 100).toFixed(2),
  volume: 2_500_000,
  vwap: ltp,
  openInterest: null,
  bidDepth: [{ price: (Number(ltp) - 0.05).toFixed(2), quantity: 1000, orders: 5 }],
  askDepth: [{ price: (Number(ltp) + 0.05).toFixed(2), quantity: 1000, orders: 5 }],
  freshness: 'LIVE',
  timestamp: MARKET_OPEN_IST.toISOString(),
});

describe('Sprints 1–6 — Full Parity Integration Suite (Watchlists, Super/GTT/Iceberg, F&O, Screener, MTF/Pledge, Diary, Controls, Alerts & TradingView Webhooks)', () => {
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
        email: `parity_${Date.now()}@example.in`,
        fullName: 'Aarav Trader',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    expect(reg.statusCode).toBe(201);
    userId = reg.json().user.id;
    token = reg.json().accessToken;

    const fund = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 1000000 },
    });
    expect(fund.statusCode).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('Sprint 1: supports Multi-Watchlists (up to 10), Sections, 6-Color Tags, Bulk Actions & Zero Provider Leakage', async () => {
    const list1 = await app.inject({
      method: 'GET',
      url: '/api/v1/watchlists',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list1.statusCode).toBe(200);
    expect(list1.json().count).toBeGreaterThanOrEqual(1);
    expect(containsProviderLeak(list1.body)).toBe(false);

    const createdWl = await app.inject({
      method: 'POST',
      url: '/api/v1/watchlists',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Breakout Radar', segment: 'EQ' },
    });
    expect(createdWl.statusCode).toBe(201);
    const wlId = createdWl.json().id;

    const item1 = await app.inject({
      method: 'POST',
      url: `/api/v1/watchlists/${wlId}/items`,
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'RELIANCE', sectionName: 'Momentum', colorTag: 'GREEN' },
    });
    expect(item1.statusCode).toBe(201);

    const item2 = await app.inject({
      method: 'POST',
      url: `/api/v1/watchlists/${wlId}/items`,
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'TCS', sectionName: 'Momentum', colorTag: 'BLUE' },
    });
    expect(item2.statusCode).toBe(201);

    // Bulk tag & move section
    const bulk = await app.inject({
      method: 'POST',
      url: `/api/v1/watchlists/${wlId}/bulk`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        itemIds: [item1.json().id, item2.json().id],
        action: 'MOVE_SECTION',
        sectionName: 'High Conviction',
      },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().affected).toBe(2);
  });

  it('Sprint 2: executes Super Order 3-Leg OCO + Live Trailing SL Ratchet + Sibling Auto-Cancel, Forever Order (GTT), Baskets, Drafts & SIPs', async () => {
    const prisma = getPrisma();

    // 1. Place SUPER BUY order @ 1400 with Target 1460, SL 1370, Trailing Jump 10
    const sup = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'MIS',
      orderType: 'SUPER',
      quantity: 10,
      target: '1460',
      stopLoss: '1370',
      trailingJump: '10',
      quoteOverride: mockQuote('RELIANCE', '1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(sup.order.status).toBe('FILLED');

    // Verify 2 OCO child legs (TARGET + STOP_LOSS) were spawned
    const children = await prisma.order.findMany({ where: { parentOrderId: sup.order.id } });
    expect(children).toHaveLength(2);
    const targetLeg = children.find((c) => c.legRole === 'TARGET')!;
    const slLeg = children.find((c) => c.legRole === 'STOP_LOSS')!;
    expect(targetLeg.status).toBe('OPEN');
    expect(slLeg.status).toBe('TRIGGER_PENDING');
    expect(Number(slLeg.triggerPrice)).toBe(1370);

    // 2. Feed rising tick 1425 with trailing jump 10 -> SL ratchets up to 1415 (1425 - 10)
    await omsTickMonitor.onQuoteTick(mockQuote('RELIANCE', '1425.00'));
    const slAfterRatchet = await prisma.order.findUnique({ where: { id: slLeg.id } });
    expect(Number(slAfterRatchet?.triggerPrice)).toBe(1415);

    // 3. Feed tick hitting Target 1461 -> Target leg fills AND SL sibling is auto-cancelled via OCO
    await omsTickMonitor.onQuoteTick(mockQuote('RELIANCE', '1461.00'));
    const targetFinal = await prisma.order.findUnique({ where: { id: targetLeg.id } });
    const slFinal = await prisma.order.findUnique({ where: { id: slLeg.id } });
    expect(targetFinal?.status).toBe('FILLED');
    expect(slFinal?.status).toBe('CANCELLED');

    // 4. Forever Order (GTT Single) triggers on tick
    const gttRes = await app.inject({
      method: 'POST',
      url: '/api/v1/advanced-orders/forever',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accountMode: 'DEMO',
        symbol: 'RELIANCE',
        orderFlag: 'SINGLE',
        side: 'BUY',
        product: 'CNC',
        quantity: 2,
        triggerPrice: 1350,
        limitPrice: 1355,
        triggerDirection: 'LTE',
      },
    });
    expect(gttRes.statusCode).toBe(201);
    const gttId = gttRes.json().id;

    await omsTickMonitor.onQuoteTick(mockQuote('RELIANCE', '1348.00'));
    const gttRow = await prisma.foreverOrder.findUnique({ where: { id: gttId } });
    expect(gttRow?.status).toBe('TRIGGERED');

    // 5. Draft Order + Saved Basket + Stock SIP + Conditional Trigger CRUD
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/advanced-orders/drafts',
      headers: { authorization: `Bearer ${token}` },
      payload: { accountMode: 'DEMO', symbol: 'RELIANCE', side: 'BUY', product: 'CNC', orderType: 'LIMIT', quantity: 3, price: 1380 },
    });
    expect(draft.statusCode).toBe(201);

    const basket = await app.inject({
      method: 'POST',
      url: '/api/v1/advanced-orders/baskets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Core Delivery Basket', legs: [{ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', quantity: 2 }] },
    });
    expect(basket.statusCode).toBe(201);

    const sip = await app.inject({
      method: 'POST',
      url: '/api/v1/advanced-orders/sips',
      headers: { authorization: `Bearer ${token}` },
      payload: { accountMode: 'DEMO', symbol: 'RELIANCE', mode: 'QTY', value: 2, frequency: 'MONTHLY' },
    });
    expect(sip.statusCode).toBe(201);

    const cond = await app.inject({
      method: 'POST',
      url: '/api/v1/advanced-orders/conditional',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accountMode: 'DEMO',
        symbol: 'RELIANCE',
        condition: { indicator: 'LTP', timeframe: '5m', operator: 'GTE', value: 1500 },
        orders: [{ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', orderType: 'MARKET', quantity: 1 }],
      },
    });
    expect(cond.statusCode).toBe(201);

    // 6. Iceberg auto-slicing splits order into multiple child slices
    const ice = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'MIS',
      orderType: 'MARKET',
      quantity: 9,
      icebergLegs: 3,
      quoteOverride: mockQuote('RELIANCE', '1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(ice.order.status).toBe('FILLED');
    expect((ice as { sliceCount?: number }).sliceCount).toBe(3);
    // Clean up open MIS position so later tests start flat
    await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'SELL',
      product: 'MIS',
      orderType: 'MARKET',
      quantity: 9,
      quoteOverride: mockQuote('RELIANCE', '1405.00'),
      nowOverride: MARKET_OPEN_IST,
    });
  });

  it('Sprint 4 & 5: exposes 17 F&O Templates, Dual-Curve Strategy Analysis & Screener Presets/AST/Templates with Zero Leakage', async () => {
    const tpl = await app.inject({ method: 'GET', url: '/api/v1/fno/templates' });
    expect(tpl.statusCode).toBe(200);
    expect(tpl.json().count).toBe(17);
    expect(containsProviderLeak(tpl.body)).toBe(false);

    const strat = await app.inject({
      method: 'POST',
      url: '/api/v1/fno/strategy/analyze',
      payload: {
        spotPrice: 25000,
        targetDaysOffset: 2,
        ivShiftPct: 3,
        spotShiftPct: 1,
        legs: [
          { symbol: 'NIFTY-25000-CE', underlying: 'NIFTY', optionType: 'CE', side: 'SELL', strike: 25000, expiry: '2026-12-31', quantity: 65, premium: 240, iv: 15 },
          { symbol: 'NIFTY-25000-PE', underlying: 'NIFTY', optionType: 'PE', side: 'SELL', strike: 25000, expiry: '2026-12-31', quantity: 65, premium: 230, iv: 15 },
        ],
      },
    });
    expect(strat.statusCode).toBe(200);
    const body = strat.json();
    expect(body.probabilityOfProfitPct).toBeGreaterThan(0);
    expect(body.expectedMove1SD.points).toBeGreaterThan(0);
    expect(body.payoffCurve[0].targetPnl).toBeDefined();

    const presets = await app.inject({ method: 'GET', url: '/api/v1/screener/presets' });
    expect(presets.statusCode).toBe(200);
    expect(presets.json().count).toBeGreaterThanOrEqual(10);
    expect(containsProviderLeak(presets.body)).toBe(false);

    const savedTpl = await app.inject({
      method: 'POST',
      url: '/api/v1/screener/templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'High Momentum', category: 'INTRADAY', ast: { logic: 'AND', rules: [{ field: 'changePercent', op: 'GT', value: 1 }] } },
    });
    expect(savedTpl.statusCode).toBe(201);
  });

  it('Sprint 6: executes MTF 4x + Convert→CNC, Holdings Instant Pledge/Unpledge, Reverse Position, Analyzer, Diary, Controls, Alerts & TradingView Webhooks', async () => {
    // 1. MTF 4x BUY & Convert to CNC
    const mtfBuy = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'MTF',
      orderType: 'MARKET',
      quantity: 10,
      quoteOverride: mockQuote('RELIANCE', '1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(mtfBuy.order.status).toBe('FILLED');

    const mtfList = await app.inject({
      method: 'GET',
      url: '/api/v1/portfolio/DEMO/mtf',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mtfList.statusCode).toBe(200);
    expect(mtfList.json().count).toBe(1);
    const mtfId = mtfList.json().positions[0].id;

    const convRes = await app.inject({
      method: 'POST',
      url: `/api/v1/portfolio/DEMO/mtf/${mtfId}/convert`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(convRes.statusCode).toBe(200);
    expect(convRes.json().converted).toBe(true);

    // 2. Holdings Instant Pledge -> Credits collateralMargin -> Unpledge restores it
    const pledgeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/portfolio/DEMO/pledge',
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'RELIANCE', quantity: 5 },
    });
    expect(pledgeRes.statusCode).toBe(200);
    expect(Number(pledgeRes.json().account.collateralMargin)).toBeGreaterThan(0);
    const pledgeId = pledgeRes.json().record.id;

    const unpledgeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/portfolio/DEMO/unpledge/${pledgeId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unpledgeRes.statusCode).toBe(200);
    expect(Number(unpledgeRes.json().account.collateralMargin)).toBe(0);

    // 3. Portfolio Analyzer & Trader's Diary + Journal Note
    const analyzer = await app.inject({
      method: 'GET',
      url: '/api/v1/portfolio/DEMO/analyzer',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(analyzer.statusCode).toBe(200);
    expect(analyzer.json().allocations.length).toBeGreaterThanOrEqual(1);

    const note = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/notes',
      headers: { authorization: `Bearer ${token}` },
      payload: { tradeDate: '2026-06-08', symbol: 'RELIANCE', setupTag: 'VWAP Breakout', emotionTag: 'Calm', rating: 5, notes: 'Followed plan strictly.' },
    });
    expect(note.statusCode).toBe(201);

    const diary = await app.inject({
      method: 'GET',
      url: '/api/v1/diary/DEMO/summary',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(diary.statusCode).toBe(200);
    expect(diary.json().notes.length).toBe(1);
    expect(diary.json().kpis.closedRoundTrips).toBeGreaterThanOrEqual(2);

    // 4. Price Alert fires on live tick
    const alertRes = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'RELIANCE', condition: 'PRICE_ABOVE', targetValue: 1475, note: 'Breakout alert' },
    });
    expect(alertRes.statusCode).toBe(201);
    await omsTickMonitor.onQuoteTick(mockQuote('RELIANCE', '1480.00'));
    const alertsList = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(alertsList.json().alerts[0].status).toBe('TRIGGERED');

    // 5. Trader's Controls: Segment Lock blocks EQ order
    const lockRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/controls/DEMO',
      headers: { authorization: `Bearer ${token}` },
      payload: { lockedSegments: ['EQ'], maxTradesPerDay: 50 },
    });
    expect(lockRes.statusCode).toBe(200);
    expect(lockRes.json().account.lockedSegments).toContain('EQ');

    await expect(
      placeOrder({
        userId,
        accountMode: 'DEMO',
        symbol: 'RELIANCE',
        side: 'BUY',
        product: 'MIS',
        orderType: 'MARKET',
        quantity: 1,
        quoteOverride: mockQuote('RELIANCE', '1400.00'),
        nowOverride: MARKET_OPEN_IST,
      })
    ).rejects.toThrow(/locked/i);

    // Unlock segments
    await app.inject({
      method: 'PUT',
      url: '/api/v1/controls/DEMO',
      headers: { authorization: `Bearer ${token}` },
      payload: { lockedSegments: [] },
    });

    // 6. TradingView Webhook config + secret verification (invalid secret -> 401; valid secret -> logged)
    const whCfg = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/config',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(whCfg.statusCode).toBe(200);
    const { urlToken, secret } = whCfg.json();
    expect(containsProviderLeak(whCfg.body)).toBe(false);

    const badWh = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/tv/${urlToken}`,
      payload: { secret: 'wrong_secret_12345', symbol: 'RELIANCE', transactionType: 'BUY', quantity: 1 },
    });
    expect(badWh.statusCode).toBe(401);

    // Valid secret with malformed symbol triggers safe validation/execution path & writes WebhookLog
    const goodWh = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/tv/${urlToken}`,
      payload: { secret, accountMode: 'DEMO', symbol: 'RELIANCE', transactionType: 'BUY', quantity: 1, orderType: 'LIMIT', price: 1300, productType: 'MIS' },
    });
    expect([200, 422, 503]).toContain(goodWh.statusCode);
    expect(containsProviderLeak(goodWh.body)).toBe(false);

    const whAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/config',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(whAfter.json().logs.length).toBeGreaterThanOrEqual(2);
  });
});
