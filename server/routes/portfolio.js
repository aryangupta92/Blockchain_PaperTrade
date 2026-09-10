'use strict';
/**
 * routes/portfolio.js
 * Server-authoritative portfolio analytics endpoint.
 * Calculates holdings, P&L, allocation from DB — not from client state.
 */
const express = require('express');
const router  = express.Router();
const authMiddleware  = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const { getQuote }    = require('../services/marketDataProvider');
const dhanApi         = require('../services/dhanApi');
const prisma = new PrismaClient();

// GET /api/portfolio/summary
// Returns holdings enriched with live LTP and computed P&L metrics
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [user, dbHoldings] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.holding.findMany({
        where:   { userId },
        include: { instrument: true }
      })
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // --- DHAN LIVE INTEGRATION ---
    let dhanFunds = { availabelBalance: user.balance }; 
    let dhanHoldings = [];
    try {
      dhanFunds = await dhanApi.getFundLimit();
      dhanHoldings = await dhanApi.getHoldings();
    } catch (e) {
      console.warn('[Portfolio] Failed to fetch live Dhan data, falling back to local simulation:', e.message);
    }

    const liveCash = dhanFunds.availabelBalance > 0 ? dhanFunds.availabelBalance : (dhanFunds.sodLimit || user.balance);

    // Merge logic: Right now, we just rely on local dbHoldings for mapping, 
    // but in a true sync we would map dhanHoldings -> enriched. 
    // For now, if dhanHoldings exist, we should theoretically use them. 
    // Since Dhan returns empty for this test token, we'll map local dbHoldings to keep the UI functional, 
    // but we use the liveCash from Dhan.

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Enrich with live prices
    const enriched = await Promise.all(
      dbHoldings.map(async (h) => {
        const quote = await getQuote(h.instrument.tradingSymbol);
        const ltp   = quote.price || h.avgPrice;
        const qty   = h.quantity;
        const cost  = Math.abs(qty) * h.avgPrice;
        const value = qty * ltp;
        const pl    = qty >= 0 ? (ltp - h.avgPrice) * qty : (h.avgPrice - ltp) * Math.abs(qty);
        const plPct = cost > 0 ? (pl / cost) * 100 : 0;
        const dayChg = quote.changePercent || 0;
        const dayPL  = qty * (quote.change || 0);

        return {
          instrumentId:   h.instrumentId,
          tradingSymbol:  h.instrument.tradingSymbol,
          name:           h.instrument.name,
          exchange:       h.instrument.exchange,
          type:           h.instrument.type,
          sector:         h.instrument.sector,
          quantity:       qty,
          avgPrice:       h.avgPrice,
          ltp,
          currentValue:   value,
          investedValue:  cost,
          unrealizedPL:   Math.round(pl * 100) / 100,
          unrealizedPLPct: Math.round(plPct * 100) / 100,
          dayPL:          Math.round(dayPL * 100) / 100,
          dayChangePct:   dayChg,
          realizedPL:     h.realizedPL || 0,
          freshness:      quote.freshness,
          confidence:     quote.confidence,
        };
      })
    );

    // Portfolio-level aggregates
    const totalInvested   = enriched.reduce((s, h) => s + h.investedValue, 0);
    const totalValue      = enriched.reduce((s, h) => s + h.currentValue, 0);
    const totalUnrealizedPL = enriched.reduce((s, h) => s + h.unrealizedPL, 0);
    const totalDayPL      = enriched.reduce((s, h) => s + h.dayPL, 0);
    const totalRealizedPL = enriched.reduce((s, h) => s + h.realizedPL, 0);
    const portfolioValue  = liveCash + Math.max(0, totalValue);

    // Sector allocation
    const sectorAlloc = {};
    enriched.forEach(h => {
      const sec = h.sector || 'Other';
      sectorAlloc[sec] = (sectorAlloc[sec] || 0) + Math.abs(h.currentValue);
    });

    res.json({
      holdings:          enriched,
      cash:              liveCash,
      portfolioValue,
      totalInvested,
      totalCurrentValue: totalValue,
      totalUnrealizedPL: Math.round(totalUnrealizedPL * 100) / 100,
      totalDayPL:        Math.round(totalDayPL * 100) / 100,
      totalRealizedPL:   Math.round(totalRealizedPL * 100) / 100,
      sectorAllocation:  sectorAlloc,
      positionCount:     enriched.filter(h => h.quantity !== 0).length,
      timestamp:         new Date().toISOString(),
    });
  } catch (err) {
    console.error('Portfolio error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portfolio/trades — paginated execution history
router.get('/trades', authMiddleware, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || '50'), 200);
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

module.exports = router;
