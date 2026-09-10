'use strict';
/**
 * routes/trades.js
 * OMS entry point — all order placement/query/cancellation routes.
 */
const express  = require('express');
const router   = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const { placeOrder, cancelOrder } = require('../services/orderService');
const { getRequiredMargin, parseFOSymbol } = require('../services/marginService');
const { calculate: calcCosts, quickEstimate } = require('../services/transactionCostEngine');
const { getInstrumentType, normalizeProductType } = require('../services/riskEngine');
const prisma = new PrismaClient();

// ── POST /api/trades — Place an order ────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { type, symbol, quantity, price, orderType = 'market', productType = 'CNC', triggerPrice, idempotencyKey, validity = 'DAY' } = req.body;
    if (!symbol)   return res.status(400).json({ error: 'symbol is required' });
    if (!type)     return res.status(400).json({ error: 'type (buy|sell) is required' });
    if (!quantity) return res.status(400).json({ error: 'quantity is required' });
    if (!price)    return res.status(400).json({ error: 'price is required' });

    const result = await placeOrder({
      userId:         req.user.id,
      symbol,
      side:           type,
      quantity:       Number(quantity),
      price:          Number(price),
      orderType,
      productType,
      triggerPrice:   triggerPrice ? Number(triggerPrice) : null,
      validity,
      idempotencyKey: idempotencyKey || null,
      ctx: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    if (!result.success && result.violations?.length > 0) {
      return res.status(422).json({
        success:    false,
        status:     'REJECTED',
        violations: result.violations,
        order:      result.order,
        costs:      result.costs || null,
      });
    }

    return res.status(201).json({
      success:   true,
      status:    result.order?.status || 'SUBMITTED',
      order:     result.order,
      trade:     result.trade,
      block:     result.block,
      costs:     result.costs || null,
      idempotent: result.idempotent || false,
    });
  } catch (err) {
    console.error('[OMS] Order error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/trades/margin — Real-time margin preview (no order placed) ──────
// Called by the UI on every form change to show margin required BEFORE submit
router.get('/margin', authMiddleware, async (req, res) => {
  try {
    const { symbol, quantity, price, side = 'buy', productType = 'CNC' } = req.query;
    if (!symbol || !quantity || !price) {
      return res.status(400).json({ error: 'symbol, quantity, price required' });
    }

    const px  = parseFloat(price);
    const qty = parseFloat(quantity);
    const pt  = normalizeProductType(productType);
    const instrType = getInstrumentType(symbol);
    const foParsed  = parseFOSymbol(symbol);

    const margin = getRequiredMargin({
      instrumentType: instrType,
      productType:    pt,
      side,
      price:          px,
      quantity:       qty,
      lotSize:        foParsed?.lotSize || 1,
      underlying:     foParsed?.underlying,
    });

    const costs = quickEstimate(px, qty, side, pt, instrType);

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { balance: true } });

    res.json({
      margin,
      costs,
      available: user?.balance || 0,
      sufficient: (user?.balance || 0) >= margin.required,
      instrumentType: instrType,
      productType: pt,
      lotSize: foParsed?.lotSize || 1,
      lots: foParsed ? Math.floor(qty / (foParsed.lotSize || 1)) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/trades — execution history ──────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 200);
    const offset = parseInt(req.query.offset || '0');
    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where:   { userId: req.user.id },
        orderBy: { executedAt: 'desc' },
        take:    limit,
        skip:    offset,
        include: { instrument: { select: { tradingSymbol: true, name: true, exchange: true } } }
      }),
      prisma.trade.count({ where: { userId: req.user.id } })
    ]);
    res.json({ trades, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/trades/orders — order book ──────────────────────────────────────
router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    const where = { userId: req.user.id };
    if (status) where.status = status.toUpperCase();

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    100,
      include: {
        instrument: { select: { tradingSymbol: true, name: true, exchange: true } },
        events:     { orderBy: { timestamp: 'asc' } },
      }
    });
    res.json({ orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/trades/orders/:id — cancel an order ─────────────────────────
router.delete('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const cancelled = await cancelOrder(req.params.id, req.user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ success: true, order: cancelled });
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message === 'Unauthorized' ? 403
      : err.message.includes('Cannot cancel') ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /api/trades/blockchain ────────────────────────────────────────────────
router.get('/blockchain', authMiddleware, async (req, res) => {
  const blockchain = require('../blockchain');
  res.json(blockchain.getChain());
});

// ── GET /api/trades/verify ────────────────────────────────────────────────────
router.get('/verify', authMiddleware, async (req, res) => {
  const blockchain = require('../blockchain');
  const valid = blockchain.isChainValid();
  res.json({ valid, blocks: blockchain.getChain().length });
});

module.exports = router;
