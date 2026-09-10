'use strict';
/**
 * routes/journal.js
 * Trade Journal CRUD operations.
 */
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/journal
router.get('/', authMiddleware, async (req, res) => {
  try {
    const entries = await prisma.tradeJournal.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        trade: {
          include: { instrument: { select: { tradingSymbol: true, name: true } } }
        }
      }
    });
    res.json({ entries, count: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const entry = await prisma.tradeJournal.findUnique({
      where: { id: req.params.id },
      include: {
        trade: {
          include: { instrument: { select: { tradingSymbol: true, name: true } } }
        }
      }
    });
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (entry.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json({ entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journal
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tradeId, title, setup, thesis, entry, exit, mistakes, learnings, rating, emotionOnEntry, emotionOnExit, marketCondition, tags, riskRewardPlanned, riskRewardActual } = req.body;
    
    // Validate trade ownership if tradeId provided
    if (tradeId) {
      const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
      if (!trade || trade.userId !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden trade access' });
      }
    }

    const journalEntry = await prisma.tradeJournal.create({
      data: {
        userId: req.user.id,
        tradeId: tradeId || null,
        title, setup, thesis, entry, exit, mistakes, learnings, rating, 
        emotionOnEntry, emotionOnExit, marketCondition, 
        tags: tags ? JSON.stringify(tags) : null,
        riskRewardPlanned, riskRewardActual
      }
    });
    res.status(201).json({ journalEntry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/journal/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, setup, thesis, entry, exit, mistakes, learnings, rating, emotionOnEntry, emotionOnExit, marketCondition, tags, riskRewardPlanned, riskRewardActual } = req.body;

    const existing = await prisma.tradeJournal.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const journalEntry = await prisma.tradeJournal.update({
      where: { id: req.params.id },
      data: {
        title, setup, thesis, entry, exit, mistakes, learnings, rating, 
        emotionOnEntry, emotionOnExit, marketCondition, 
        tags: tags ? JSON.stringify(tags) : null,
        riskRewardPlanned, riskRewardActual
      }
    });
    res.json({ journalEntry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/journal/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.tradeJournal.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await prisma.tradeJournal.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
