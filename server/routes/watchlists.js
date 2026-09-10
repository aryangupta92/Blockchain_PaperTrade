'use strict';
/**
 * routes/watchlists.js
 * DB-backed watchlists — multiple lists per user, persistent.
 */
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/watchlists — get all watchlists for current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: req.user.id },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { instrument: { select: { tradingSymbol: true, name: true, type: true, exchange: true } } }
        }
      }
    });
    res.json({ watchlists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/watchlists — create a new watchlist
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const wl = await prisma.watchlist.create({
      data: { userId: req.user.id, name }
    });
    res.status(201).json({ watchlist: wl });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Watchlist name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/watchlists/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const wl = await prisma.watchlist.findUnique({ where: { id: req.params.id } });
    if (!wl) return res.status(404).json({ error: 'Not found' });
    if (wl.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await prisma.watchlist.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/watchlists/:id/items — add a symbol to a watchlist
router.post('/:id/items', authMiddleware, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const wl = await prisma.watchlist.findUnique({ where: { id: req.params.id } });
    if (!wl || wl.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    // Auto-create instrument if not exists
    let instrument = await prisma.instrument.findUnique({ where: { tradingSymbol: symbol } });
    if (!instrument) {
      instrument = await prisma.instrument.create({
        data: { symbol, tradingSymbol: symbol, exchange: 'NSE', name: symbol, type: 'EQUITY' }
      });
    }

    const item = await prisma.watchlistItem.upsert({
      where: { watchlistId_instrumentId: { watchlistId: req.params.id, instrumentId: instrument.id } },
      update: {},
      create: { watchlistId: req.params.id, instrumentId: instrument.id },
    });
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/watchlists/:id/items/:symbol
router.delete('/:id/items/:symbol', authMiddleware, async (req, res) => {
  try {
    const wl = await prisma.watchlist.findUnique({ where: { id: req.params.id } });
    if (!wl || wl.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const instrument = await prisma.instrument.findUnique({ where: { tradingSymbol: req.params.symbol } });
    if (!instrument) return res.status(404).json({ error: 'Symbol not found' });

    await prisma.watchlistItem.deleteMany({
      where: { watchlistId: req.params.id, instrumentId: instrument.id }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
