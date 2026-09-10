'use strict';
/**
 * routes/screener.js
 * Real-time screener based on cached market data.
 */
const express = require('express');
const router  = express.Router();
const { getQuotesBatch } = require('../services/marketDataProvider');

// Preset scanners
const PRESETS = {
  TOP_GAINERS: (quotes) => [...quotes].sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0)).slice(0, 10),
  TOP_LOSERS:  (quotes) => [...quotes].sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0)).slice(0, 10),
  VOLUME_BREAKOUT: (quotes) => [...quotes].filter(q => q.volume > 1000000).sort((a, b) => b.volume - a.volume).slice(0, 10)
};

// GET /api/screener?preset=TOP_GAINERS
router.get('/', async (req, res) => {
  try {
    const { preset = 'TOP_GAINERS', symbols } = req.query;
    
    let symbolList = [];
    if (symbols) {
      symbolList = symbols.split(',').map(s => s.trim());
    } else {
      // Default universe (Nifty 50 constituents approximation)
      symbolList = ['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS','SBIN.NS','WIPRO.NS','BAJFINANCE.NS','BHARTIARTL.NS','ITC.NS','HUL.NS','LT.NS','KOTAKBANK.NS','AXISBANK.NS'];
    }

    const quotes = await getQuotesBatch(symbolList);
    
    let results = quotes;
    if (PRESETS[preset]) {
      results = PRESETS[preset](quotes);
    }

    res.json({ results, preset, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
