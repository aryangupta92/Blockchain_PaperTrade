import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { NormalizedQuote } from '@broker/shared';
import { buildApp } from '../app';
import { realBrokerAdapter } from '../services/realBrokerAdapter';

const MARKET_OPEN = new Date('2026-06-08T05:30:00.000Z');

const mockQuote = (ltp: string): NormalizedQuote => ({
  instrumentId: 'NSE:EQ:2885',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  segment: 'EQ',
  ltp,
  prevClose: '1400.00',
  open: ltp,
  high: ltp,
  low: ltp,
  change: '0.00',
  changePercent: '0.00',
  volume: 1000000,
  vwap: ltp,
  openInterest: null,
  bidDepth: [],
  askDepth: [],
  freshness: 'LIVE',
  timestamp: MARKET_OPEN.toISOString(),
});

describe('Phase 7 — REAL Payment Gateway Funding, T+1 Settlement Withdrawals, Real Broker Adapter, Contract Notes & FIFO Tax P&L', () => {
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
        email: `real_${Date.now()}@example.in`,
        fullName: 'Vikram Desai',
        password: 'StrongPassword123',
        acceptSebiRiskDisclosure: true,
      },
    });
    userId = reg.json().user.id;
    token = reg.json().accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('deposits REAL funds via Mock UPI gateway (sealing Blockchain block), enforces T+1 withdrawal guard, and keeps DEMO isolated at ₹0.00', async () => {
    const dep = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/real/deposit',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 100000, rail: 'UPI', upiId: 'vikram@upi' },
    });
    expect(dep.statusCode).toBe(200);
    expect(dep.json().account.cashBalance).toBe('100000.00');
    expect(dep.json().receipt.utr).toContain('MOCKUPI');
    expect(dep.json().blockchainProof.hash).toMatch(/^00[a-f0-9]{62}$/);

    // Verify DEMO account remained strictly isolated at ₹0.00
    const accs = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: { authorization: `Bearer ${token}` },
    });
    const demo = accs.json().accounts.find((a: { mode: string }) => a.mode === 'DEMO');
    expect(demo.cashBalance).toBe('0.00');

    // Withdraw ₹25,000 from settled REAL funds
    const wd = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/real/withdraw',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 25000, bankAccountMasked: 'XXXX-8821', ifsc: 'HDFC0001234' },
    });
    expect(wd.statusCode).toBe(200);
    expect(wd.json().account.cashBalance).toBe('75000.00');
    expect(wd.json().blockchainProof.hash).toMatch(/^00[a-f0-9]{62}$/);

    // Reject withdrawal exceeding settled balance
    const overWd = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/real/withdraw',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 90000, bankAccountMasked: 'XXXX-8821', ifsc: 'HDFC0001234' },
    });
    expect(overWd.statusCode).toBe(422);
    expect(overWd.json().code).toBe('WITHDRAWAL_EXCEEDS_SETTLED_BALANCE');
  });

  it('routes REAL orders via RealBrokerAdapter, generates Daily Contract Notes, FIFO Tax P&L, and CSV exports', async () => {
    const compliance = realBrokerAdapter.getComplianceStatus();
    expect(compliance.adapterMode).toBe('MOCK_REAL_ADAPTER');
    expect(compliance.goingLiveReady).toBe(false);
    expect(compliance.mandatoryPrerequisites.length).toBeGreaterThanOrEqual(5);

    // Execute CNC BUY 10 @ ₹1400 then CNC SELL 10 @ ₹1500 in REAL account (Gross STCG = ₹1,000)
    await realBrokerAdapter.placeOrder({
      userId,
      symbol: 'RELIANCE',
      side: 'BUY',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 10,
      quoteOverride: mockQuote('1400.00'),
      nowOverride: MARKET_OPEN,
    });
    await realBrokerAdapter.placeOrder({
      userId,
      symbol: 'RELIANCE',
      side: 'SELL',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: 10,
      quoteOverride: mockQuote('1500.00'),
      nowOverride: MARKET_OPEN,
    });

    // Daily Contract Note check
    const cnRes = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/REAL/contract-notes',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cnRes.statusCode).toBe(200);
    const cn = cnRes.json().contractNotes[0];
    expect(cn.contractNoteNumber).toContain('CN-REAL-');
    expect(cn.tradeCount).toBe(2);
    expect(cn.totals.grossBuyValue).toBe('14000.00');
    expect(cn.totals.grossSellValue).toBe('15000.00');
    expect(Number(cn.totals.totalCharges)).toBeGreaterThan(30);

    // FIFO Tax P&L check
    const taxRes = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/REAL/tax-pnl',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(taxRes.statusCode).toBe(200);
    const tax = taxRes.json();
    expect(tax.taxBuckets.equityDeliverySTCG).toBe('1000.00');
    expect(Number(tax.summary.netRealizedPnl)).toBeLessThan(1000); // Charges deducted!

    // CSV Export check
    const csvRes = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/REAL/export?type=trades',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.body).toContain('BlockchainHash');
    expect(csvRes.body).toContain('RELIANCE');
  });
});
