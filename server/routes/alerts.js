'use strict';
/**
 * routes/alerts.js
 * Price alerts persisted in DB, triggered by the WebSocket market data loop.
 */
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/alerts
router.get('/', authMiddleware, async (req, res) => {
  try {
    const alerts = await prisma.alert.findMany({
      where:   { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { instrument: { select: { tradingSymbol: true, name: true } } }
    });
    res.json({ alerts, count: alerts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts
// Body: { symbol, type, triggerValue, message?, notifyVia? }
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { symbol, type, triggerValue, message, notifyVia = 'WEBSOCKET', expiresAt } = req.body;
    if (!symbol || !type || triggerValue === undefined) {
      return res.status(400).json({ error: 'symbol, type, and triggerValue are required' });
    }
    if (!['PRICE_ABOVE', 'PRICE_BELOW', 'PCT_CHANGE', 'PORTFOLIO_PL', 'VOLUME'].includes(type)) {
      return res.status(400).json({ error: 'Invalid alert type' });
    }

    let instrument = await prisma.instrument.findUnique({ where: { tradingSymbol: symbol } });
    if (!instrument) {
      instrument = await prisma.instrument.create({
        data: { symbol, tradingSymbol: symbol, exchange: 'NSE', name: symbol, type: 'EQUITY' }
      });
    }

    const alert = await prisma.alert.create({
      data: {
        userId:       req.user.id,
        instrumentId: instrument.id,
        type,
        condition:    JSON.stringify({ symbol, type, triggerValue }),
        triggerValue: Number(triggerValue),
        message:      message || `${symbol} ${type === 'PRICE_ABOVE' ? 'above' : 'below'} ₹${triggerValue}`,
        notifyVia,
        expiresAt:    expiresAt ? new Date(expiresAt) : null,
      },
      include: { instrument: { select: { tradingSymbol: true, name: true } } }
    });
    res.status(201).json({ alert });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) return res.status(404).json({ error: 'Not found' });
    if (alert.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await prisma.alert.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/pause
router.patch('/:id/pause', authMiddleware, async (req, res) => {
  try {
    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert || alert.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const updated = await prisma.alert.update({
      where: { id: req.params.id },
      data: { status: alert.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' }
    });
    res.json({ alert: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
