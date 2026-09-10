'use strict';
/**
 * routes/traderControl.js
 * Exposes advanced Risk Management and Trader Control features (Kill Switch, PnL Exits)
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const dhanApi = require('../services/dhanApi');

// ── GET /api/trader-control/killswitch ───────────────────────────────────────
router.get('/killswitch', authMiddleware, async (req, res) => {
  try {
    const status = await dhanApi.getKillSwitchStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/trader-control/killswitch ──────────────────────────────────────
router.post('/killswitch', authMiddleware, async (req, res) => {
  try {
    const { action } = req.body; // 'ACTIVATE' or 'DEACTIVATE'
    if (!['ACTIVATE', 'DEACTIVATE'].includes(action)) {
      return res.status(400).json({ error: "Action must be 'ACTIVATE' or 'DEACTIVATE'" });
    }
    const result = await dhanApi.setKillSwitch(action);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/trader-control/pnl-exit ─────────────────────────────────────────
router.get('/pnl-exit', authMiddleware, async (req, res) => {
  try {
    const status = await dhanApi.getPnlExit();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/trader-control/pnl-exit ────────────────────────────────────────
router.post('/pnl-exit', authMiddleware, async (req, res) => {
  try {
    const { profitValue, lossValue, enableKillSwitch } = req.body;
    if (profitValue === undefined || lossValue === undefined) {
      return res.status(400).json({ error: 'profitValue and lossValue are required' });
    }
    const result = await dhanApi.setPnlExit(profitValue, lossValue, !!enableKillSwitch);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
