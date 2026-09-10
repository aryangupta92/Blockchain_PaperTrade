'use strict';
/**
 * routes/system.js
 * Observability, health, provider status, SEBI info
 */
const express = require('express');
const router  = express.Router();
const blockchain = require('../blockchain');
const { getProviderHealth } = require('../services/marketDataProvider');

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const h = ist.getUTCHours(), m = ist.getUTCMinutes(), d = ist.getUTCDay();
  return d >= 1 && d <= 5 &&
    (h > 9 || (h === 9 && m >= 15)) &&
    (h < 15 || (h === 15 && m <= 30));
}

// GET /api/system/health
router.get('/health', (req, res) => {
  const now      = new Date();
  const ist      = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const open     = isMarketOpen();
  const providers = getProviderHealth();
  const chain    = blockchain.getStats();

  res.json({
    status:      'ok',
    serverTime:  now.toISOString(),
    istTime:     ist.toISOString(),
    market: {
      status:    open ? 'OPEN' : 'CLOSED',
      message:   open
        ? 'Market is OPEN (9:15 AM – 3:30 PM IST)'
        : ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5
          ? 'Market is CLOSED. Opens at 9:15 AM IST'
          : 'Market is CLOSED. Weekend.',
    },
    providers,
    blockchain: chain,
    version:    '2.0.0',
  });
});

// GET /api/system/sebi
router.get('/sebi', (req, res) => {
  res.json({
    regulator: 'SEBI',
    website:   'https://www.sebi.gov.in',
    disclaimer: 'Paper trading simulation. No real money involved.',
    rules: [
      'Market hours: 9:15 AM to 3:30 PM IST, Monday to Friday',
      'Pre-market: 9:00 AM – 9:15 AM | Post-market: 3:40 PM – 4:00 PM',
      'F&O expiry: last Thursday of each month',
      'Equity settlement: T+1 (simulated)',
      'Circuit breakers: ±5%, ±10%, ±20%',
    ],
  });
});

module.exports = router;
