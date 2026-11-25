import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { NormalizedQuote } from '@broker/shared';
import { buildApp } from '../app';
import {
  convertPositionProduct,
  placeOrder,
  previewOrder,
  runMisAutoSquareOff,
} from '../services/trading-oms/orderManagementService';
import { computeRatchetedStopLoss, omsTickMonitor } from '../services/trading-oms/restingOrderTickMonitor';
import { updateAccountRiskControls } from '../services/trading-oms/portfolioService';

const MARKET_OPEN_IST = new Date('2026-06-08T05:30:00.000Z'); // Mon 11:00 IST
const MARKET_CLOSED_IST = new Date('2026-06-08T15:00:00.000Z'); // Mon 20:30 IST

const mockRelianceQuote = (ltp: string): NormalizedQuote => ({
  instrumentId: 'NSE:EQ:2885',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  segment: 'EQ',
  ltp,
  prevClose: '1400.00',
  open: '1395.00',
  high: '1420.00',
  low: '1380.00',
  change: '0.00',
  changePercent: '0.00',
  volume: 5000000,
  vwap: ltp,
  openInterest: null,
  bidDepth: [
    { price: (Number(ltp) - 0.1).toFixed(2), quantity: 500, orders: 4 },
    { price: (Number(ltp) - 0.25).toFixed(2), quantity: 1000, orders: 8 },
  ],
  askDepth: [
    { price: (Number(ltp) + 0.1).toFixed(2), quantity: 500, orders: 4 },
    { price: (Number(ltp) + 0.25).toFixed(2), quantity: 1000, orders: 8 },
  ],
  freshness: 'LIVE',
  timestamp: MARKET_OPEN_IST.toISOString(),
});

describe('Phase 3 — Unified OMS, SEBI Risk/Margin, CNC/MIS Trading, Auto Square-Off, Charges & Blockchain', () => {
  let app: FastifyInstance;
  let userId = '';
  let accessToken = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `oms_${Date.now()}@example.in`,
        fullName: 'Priya Mehta',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    expect(reg.statusCode).toBe(201);
    userId = reg.json().user.id;
    accessToken = reg.json().accessToken;

    // Fund DEMO account with ₹5,00,000 (REAL stays strictly at ₹0.00)
    const fund = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/demo/balance',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { amount: 500000 },
    });
    expect(fund.statusCode).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('enforces SEBI Delivery (CNC) no-short-selling, market hours + AMO, and REAL zero-balance rejection', async () => {
    // 1. CNC Short Sell must be rejected
    const cncShort = await previewOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'SELL',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 10,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(cncShort.risk.allowed).toBe(false);
    expect(cncShort.risk.violations.some((v) => v.code === 'CNC_SHORT_SELL_FORBIDDEN')).toBe(true);

    // 2. Non-AMO order outside market hours must be rejected with MARKET_CLOSED
    const closedCheck = await previewOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 5,
      isAmo: false,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_CLOSED_IST,
    });
    expect(closedCheck.risk.allowed).toBe(false);
    expect(closedCheck.risk.violations.some((v) => v.code === 'MARKET_CLOSED')).toBe(true);

    // 3. REAL account with ₹0.00 balance must reject order with INSUFFICIENT_MARGIN
    const realZero = await previewOrder({
      userId,
      accountMode: 'REAL',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 5,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(realZero.risk.allowed).toBe(false);
    expect(realZero.risk.violations.some((v) => v.code === 'INSUFFICIENT_MARGIN')).toBe(true);
  });

  it('executes CNC BUY (T+1 holding + charges + SHA-256 blockchain seal), enforces idempotency, then CNC SELL with DP charge', async () => {
    const idempKey = `cnc-buy-${Date.now()}`;
    const buy = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 10,
      idempotencyKey: idempKey,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });

    expect(buy.order.status).toBe('FILLED');
    expect(buy.trade?.price).toBe('1400.10'); // Filled at best ask (1400 + 0.10)
    expect(Number(buy.charges?.totalCharges)).toBeGreaterThan(0);
    expect(buy.blockchainProof?.hash).toMatch(/^00[a-f0-9]{62}$/);

    // Duplicate idempotencyKey returns original order without double charging
    const dup = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 10,
      idempotencyKey: idempKey,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(dup.idempotent).toBe(true);
    expect(dup.order.id).toBe(buy.order.id);

    // Verify Holdings show 10 T+1 qty
    const holdRes = await app.inject({
      method: 'GET',
      url: '/api/v1/portfolio/DEMO/holdings',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(holdRes.statusCode).toBe(200);
    const holding = holdRes.json().holdings.find((h: { symbol: string }) => h.symbol === 'RELIANCE');
    expect(holding.t1Qty).toBe(10);
    expect(holding.settledQty).toBe(0);

    // Sell 4 CNC shares (applies DP charge + STT)
    const sell = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'SELL',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 4,
      quoteOverride: mockRelianceQuote('1450.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(sell.order.status).toBe('FILLED');
    expect(sell.charges?.dpChargeExclGst).toBe('13.50');
    expect(sell.blockchainProof?.hash).toMatch(/^00[a-f0-9]{62}$/);
  });

  it('supports MIS intraday short selling with VaR+ELM margin, MIS auto square-off, and MIS → CNC conversion', async () => {
    // 1. Short sell 20 RELIANCE MIS intraday (uses 20% VaR+ELM, not full cash)
    const shortMis = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'SELL',
      product: 'MIS',
      orderType: 'MARKET',
      quantity: 20,
      quoteOverride: mockRelianceQuote('1420.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(shortMis.order.status).toBe('FILLED');

    // Run MIS Auto Square-Off at lower price ₹1400 -> closes short position with net profit
    const sq = await runMisAutoSquareOff({
      userId,
      accountMode: 'DEMO',
      quoteOverrides: { RELIANCE: mockRelianceQuote('1400.00') },
      nowOverride: MARKET_OPEN_IST,
    });
    expect(sq.count).toBe(1);

    // 2. Open long MIS position (5 shares) and convert MIS -> CNC Delivery
    await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'MIS',
      orderType: 'MARKET',
      quantity: 5,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    const conv = await convertPositionProduct({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      fromProduct: 'MIS',
      toProduct: 'CNC',
    });
    expect(conv.converted).toBe(true);
    expect(conv.quantity).toBe(5);
  });

  it('triggers resting LIMIT order on live tick, ratchets Super Order trailing SL, and enforces Kill Switch', async () => {
    // Place non-marketable BUY LIMIT below LTP (1350 vs LTP 1400) -> rests as OPEN
    const limitOrder = await placeOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'MIS',
      orderType: 'LIMIT',
      quantity: 5,
      price: '1350.00',
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(limitOrder.order.status).toBe('OPEN');

    // Simulate tick dropping to 1349.50 -> tickMonitor triggers fill!
    await omsTickMonitor.onQuoteTick(mockRelianceQuote('1349.50'));

    const ordersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/orders?mode=DEMO',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const filledLimit = ordersRes.json().orders.find((o: { id: string }) => o.id === limitOrder.order.id);
    expect(filledLimit.status).toBe('FILLED');

    // Super Order trailing SL ratchet check
    expect(
      computeRatchetedStopLoss({ side: 'BUY', currentStopLoss: '1380.00', trailingJump: '10.00', ltp: '1405.00' })
    ).toBe('1395.00');

    // Activate Kill Switch -> blocks new orders immediately
    await updateAccountRiskControls({ userId, mode: 'DEMO', killSwitchOn: true });
    const blockedPreview = await previewOrder({
      userId,
      accountMode: 'DEMO',
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'MIS',
      orderType: 'MARKET',
      quantity: 2,
      quoteOverride: mockRelianceQuote('1400.00'),
      nowOverride: MARKET_OPEN_IST,
    });
    expect(blockedPreview.risk.allowed).toBe(false);
    expect(blockedPreview.risk.violations.some((v) => v.code === 'KILL_SWITCH_ACTIVE')).toBe(true);

    // Verify Blockchain integrity across ALL sealed trades & resets
    const verifyRes = await app.inject({ method: 'GET', url: '/api/v1/blockchain/verify' });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(true);
  });
});
