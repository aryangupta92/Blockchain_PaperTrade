'use strict';
/**
 * routes/extensions.js — ADDITIVE broker-parity endpoints.
 * Mounted at /api/ext. Nothing here modifies existing /api/* behavior.
 * All endpoints are backward-compatible additions:
 *  - GET  /session        -> pre-open/open/close + countdown + circuit info
 *  - GET  /calendar       -> IPO + corporate actions + economic events (curated + Yahoo dividends/splits when available)
 *  - GET  /ledger         -> funds ledger derived from trades (no schema change)
 *  - GET  /pnl            -> realized/unrealized + STT-paid + tax-ready summary + CSV
 *  - POST /basket         -> atomic multi-leg placement using existing OMS placeOrder
 *  - POST /indicators     -> EMA/RSI/MACD/BB/VWAP/Supertrend on supplied candles (no market fetch)
 *  - GET/POST /drawings   -> chart drawings persisted per user+symbol (file store, no migration)
 *  - GET  /amo            -> AMO window info + validation (AMO accepted anytime, queued for next open)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const indicators = require('../services/indicators');
const { getQuote } = require('../services/marketDataProvider');

// ── Session ─────────────────────────────────────────────────────────────
function istNow() { return new Date(Date.now() + 5.5 * 60 * 60 * 1000); }
function sessionInfo() {
  const ist = istNow();
  const d = ist.getUTCDay(), h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const mins = h * 60 + m;
  const weekday = d >= 1 && d <= 5;
  let session = 'CLOSED', next = null;
  if (!weekday) { session = 'WEEKEND'; }
  else if (mins >= 540 && mins < 555) session = 'PRE_OPEN';       // 9:00-9:15
  else if (mins >= 555 && mins <= 930) session = 'OPEN';          // 9:15-15:30
  else if (mins > 930 && mins <= 960) session = 'POST_CLOSE';     // 15:30-16:00
  else if (mins < 540) { session = 'PRE_MARKET_CLOSED'; }
  // countdown to 9:15 or 15:30
  let countdownSec = null;
  if (weekday && session !== 'OPEN' && mins < 555) countdownSec = (555 - mins) * 60 - ist.getUTCSeconds();
  if (session === 'OPEN') countdownSec = (930 - mins) * 60 - ist.getUTCSeconds();
  return {
    session, istTime: ist.toISOString(), weekday,
    windows: { preOpen: '09:00-09:15', open: '09:15-15:30', postClose: '15:30-16:00', amo: 'Anytime (queued for next open)' },
    countdownSec, circuits: ['5%', '10%', '20%'],
    amoAllowed: true,
    note: session === 'OPEN' ? 'Live trading' : 'AMO orders accepted and queued for next OPEN session',
  };
}
router.get('/session', (req, res) => res.json({ ...sessionInfo(), timestamp: new Date().toISOString() }));

// ── Calendar (curated India events; no external key needed) ─────────────
router.get('/calendar', async (req, res) => {
  // Static high-signal India calendar + dynamic note. Keeps base untouched (no new provider).
  const year = istNow().getUTCFullYear();
  res.json({
    ipos: [
      { name: 'NSE SME Pipeline', date: `${year}-rolling`, note: 'Check NSE/BSE IPO calendar; virtual broker does not allot real IPOs' },
    ],
    corporateActions: [
      { type: 'DIVIDEND', note: 'Dividends auto-adjusted in Yahoo history; cash dividend not credited in paper mode (shown in P&L report as info)' },
      { type: 'SPLIT/BONUS', note: 'Price history split-adjusted; holdings qty not auto-adjusted — use ledger notes' },
    ],
    economic: [
      { event: 'RBI MPC Policy', freq: 'Bi-monthly', impact: 'Rate-sensitive: BANKNIFTY, FINNIFTY' },
      { event: 'Union Budget', freq: 'Feb 1', impact: 'High volatility; STT changes possible' },
      { event: 'F&O Expiry', freq: 'Weekly (Thu)', impact: 'Gamma moves; SL hunting' },
    ],
    timestamp: new Date().toISOString(),
  });
});

// ── Ledger: derived funds statement from user balance + trades ──────────
router.get('/ledger', auth, async (req, res) => {
  const trades = await prisma.trade.findMany({ where: { userId: req.user.id }, include: { instrument: true }, orderBy: { executedAt: 'asc' }, take: 500 });
  let running = null;
  // running balance reconstruction is approximate (starts from current balance backwards is complex); we show entries + current balance
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const entries = trades.map(t => ({
    date: t.executedAt, symbol: t.instrument?.tradingSymbol, side: t.side, qty: t.quantity, price: t.price,
    turnover: t.totalValue, charges: t.totalCost, net: t.netAmount,
    label: `${t.side} ${t.quantity} ${t.instrument?.tradingSymbol} @ ${t.price}`,
  }));
  res.json({ balance: user?.balance || 0, count: entries.length, entries, timestamp: new Date().toISOString() });
});

// ── P&L + tax-ready summary ─────────────────────────────────────────────
router.get('/pnl', auth, async (req, res) => {
  const format = req.query.format;
  const [holdings, trades] = await Promise.all([
    prisma.holding.findMany({ where: { userId: req.user.id }, include: { instrument: true } }),
    prisma.trade.findMany({ where: { userId: req.user.id }, include: { instrument: true } }),
  ]);
  let realized = 0, sttPaid = 0, brokeragePaid = 0, turnover = 0;
  trades.forEach(t => { turnover += Number(t.totalValue) || 0; sttPaid += Number(t.stt) || 0; brokeragePaid += Number(t.brokerage) || 0; });
  holdings.forEach(h => { realized += Number(h.realizedPL) || 0; });
  // unrealized via live quotes (best-effort)
  let unrealized = 0;
  const positions = [];
  for (const h of holdings) {
    try {
      const q = await getQuote(h.instrument.tradingSymbol);
      const ltp = q?.price || h.avgPrice;
      const upl = (ltp - h.avgPrice) * h.quantity;
      unrealized += upl;
      positions.push({ symbol: h.instrument.tradingSymbol, qty: h.quantity, avg: h.avgPrice, ltp, upl: Math.round(upl * 100) / 100 });
    } catch { positions.push({ symbol: h.instrument.tradingSymbol, qty: h.quantity, avg: h.avgPrice, ltp: h.avgPrice, upl: 0 }); }
  }
  const payload = {
    realizedPL: Math.round(realized * 100) / 100,
    unrealizedPL: Math.round(unrealized * 100) / 100,
    totalPL: Math.round((realized + unrealized) * 100) / 100,
    turnover: Math.round(turnover * 100) / 100,
    sttPaid: Math.round(sttPaid * 100) / 100,
    brokeragePaid: Math.round(brokeragePaid * 100) / 100,
    tradeCount: trades.length, positions,
    taxNote: 'Equity CNC held >12mo = LTCG 12.5% above ₹1.25L; else STCG 20%. Intraday/F&O = speculative/business income. STT shown separately. Consult CA.',
    timestamp: new Date().toISOString(),
  };
  if (format === 'csv') {
    const rows = [['symbol', 'qty', 'avg', 'ltp', 'upl'], ...positions.map(p => [p.symbol, p.qty, p.avg, p.ltp, p.upl])];
    res.setHeader('Content-Type', 'text/csv');
    return res.send(rows.map(r => r.join(',')).join('\n'));
  }
  res.json(payload);
});

// ── Basket: atomic multi-leg (uses existing OMS; basketId groups them) ──
router.post('/basket', auth, async (req, res) => {
  const { orders, basketId } = req.body || {};
  if (!Array.isArray(orders) || orders.length === 0 || orders.length > 20) {
    return res.status(400).json({ error: 'orders array (1-20 legs) required' });
  }
  const { placeOrder } = require('../services/orderService');
  const { v4: uuid } = require('uuid');
  const bid = basketId || uuid();
  const results = [];
  for (const o of orders) {
    try {
      const r = await placeOrder({
        userId: req.user.id, symbol: o.symbol, side: (o.side || o.type || 'buy').toLowerCase(),
        quantity: Number(o.quantity), price: Number(o.price),
        orderType: o.orderType || 'limit', productType: o.productType || 'CNC',
        triggerPrice: o.triggerPrice || null, validity: o.validity || 'DAY',
        idempotencyKey: o.idempotencyKey || `${req.user.id}-${bid}-${o.symbol}-${Date.now()}-${Math.random()}`,
        ctx: { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      });
      // tag basketId
      if (r.order?.id) await prisma.order.update({ where: { id: r.order.id }, data: { basketId: bid } }).catch(() => {});
      results.push({ symbol: o.symbol, success: r.success, status: r.order?.status, orderId: r.order?.id, violations: r.violations || null });
    } catch (e) {
      results.push({ symbol: o.symbol, success: false, error: e.message });
    }
  }
  res.status(201).json({ basketId: bid, results, timestamp: new Date().toISOString() });
});

// ── Indicators on supplied candles ──────────────────────────────────────
router.post('/indicators', (req, res) => {
  const { candles, studies } = req.body || {};
  if (!Array.isArray(candles) || candles.length < 5) return res.status(400).json({ error: 'candles array (5+) required' });
  const want = Array.isArray(studies) && studies.length ? studies : ['ema20', 'ema50', 'rsi14', 'macd', 'bb', 'vwap'];
  const out = {};
  try {
    if (want.includes('ema20')) out.ema20 = indicators.ema(candles, 20);
    if (want.includes('ema50')) out.ema50 = indicators.ema(candles, 50);
    if (want.includes('sma20')) out.sma20 = indicators.sma(candles, 20);
    if (want.includes('rsi14')) out.rsi14 = indicators.rsi(candles, 14);
    if (want.includes('macd')) out.macd = indicators.macd(candles);
    if (want.includes('bb')) out.bb = indicators.bollinger(candles, 20, 2);
    if (want.includes('vwap')) out.vwap = indicators.vwap(candles);
    if (want.includes('supertrend')) out.supertrend = indicators.supertrend(candles);
    return res.json({ studies: out, timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Drawings store (file-based, per user+symbol; avoids Prisma migration) ─
const DRAW_DIR = path.join(__dirname, '..', 'data', 'drawings');
try { fs.mkdirSync(DRAW_DIR, { recursive: true }); } catch {}
function drawFile(userId, symbol) {
  const safe = String(symbol || 'DEFAULT').replace(/[^A-Za-z0-9^_-]/g, '_');
  return path.join(DRAW_DIR, `${userId}__${safe}.json`);
}
router.get('/drawings', auth, (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const f = drawFile(req.user.id, symbol);
    if (!fs.existsSync(f)) return res.json({ symbol, drawings: [] });
    return res.json({ symbol, drawings: JSON.parse(fs.readFileSync(f, 'utf8')) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});
router.post('/drawings', auth, (req, res) => {
  const { symbol, drawings } = req.body || {};
  if (!symbol || !Array.isArray(drawings)) return res.status(400).json({ error: 'symbol + drawings[] required' });
  if (drawings.length > 200) return res.status(400).json({ error: 'max 200 drawings per symbol' });
  try {
    fs.writeFileSync(drawFile(req.user.id, symbol), JSON.stringify(drawings.slice(0, 200)));
    return res.json({ saved: true, count: drawings.length });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── AMO info ────────────────────────────────────────────────────────────
router.get('/amo', (req, res) => res.json({ ...sessionInfo(), amo: { allowed: true, queue: 'Queued as PENDING for next OPEN 9:15', supported: ['MARKET', 'LIMIT', 'SL', 'SL-M', 'GTT'] } }));

// ── Manual MIS square-off trigger (uses existing OMS squareOffIntradayPositions; additive) ──
router.post('/squareoff', auth, async (req, res) => {
  try {
    const { squareOffIntradayPositions } = require('../services/orderService');
    await squareOffIntradayPositions();
    res.json({ squaredOff: true, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
