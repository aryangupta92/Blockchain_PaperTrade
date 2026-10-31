'use strict';
/**
 * routes/dhanAuth.js — Dhan consent-login + feed health.
 *
 * POST /api/dhan/auth/start → { loginUrl, consentAppId } (open in browser)
 * POST /api/dhan/auth/finish { tokenId } → token status (after browser login)
 * GET /api/dhan/auth/status → is the feed usable right now?
 * POST /api/dhan/auth/logout → clears stored token
 * GET /api/dhan/feed-health → connection + rate limits + freshness
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const dhanAuth = require('../services/data/dhanAuth');
const feed = require('../services/data/dhanMarketFeed');
const { loadMaster } = require('../services/data/instrumentMaster');

router.post('/auth/start', authMiddleware, async (req, res) => {
  try {
    const out = await dhanAuth.startConsent();
    res.json({
      ...out,
      redirectHint: 'Log in with your Dhan credentials and 2FA; the browser will be redirected to your app URL with ?tokenId=XXXX — copy that tokenId back here.',
      completeWith: 'POST /api/dhan/auth/finish { "tokenId": "XXXX" }',
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

router.post('/auth/finish', authMiddleware, async (req, res) => {
  try {
    const status = await dhanAuth.finishConsent(req.body?.tokenId || req.query?.tokenId);
    // bring the live feed up immediately
    try { await feed.start(); } catch (e) {
      console.warn('[Dhan] feed start after auth:', e.message);
    }
    res.json({ ok: true, ...status });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/**
 * POST /api/dhan/auth/token  { accessToken }
 * Direct route: paste a token generated at web.dhan.co -> Profile ->
 * Access DhanHQ APIs. Easiest path, no browser consent dance.
 */
router.post('/auth/token', authMiddleware, async (req, res) => {
  try {
    const token = (req.body?.accessToken || req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'accessToken is required', code: 'VALIDATION' });
    // Cheap local sanity check before spending a network round-trip
    if (token.length < 20) {
      return res.status(400).json({ error: 'That is too short to be a Dhan access token. Copy the whole token from web.dhan.co.', code: 'VALIDATION' });
    }

    // Verify it actually works with Dhan before we claim success
    const probe = await dhanAuth.verifyToken(token);
    if (!probe.ok) {
      return res.status(probe.unverified ? 503 : 401).json({
        error: probe.reason,
        code: probe.unverified ? 'VERIFY_FAILED' : 'INVALID_TOKEN',
      });
    }

    const status = dhanAuth.setDirectToken(token, 'pasted via UI');
    try { await feed.start(); } catch (e) {
      console.warn('[Dhan] feed start after token set:', e.message);
    }
    res.json({ ok: true, ...status, verified: true, warning: probe.warning || null });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

router.get('/auth/status', authMiddleware, (req, res) => {
  res.json(dhanAuth.getStatus());
});

router.post('/auth/logout', authMiddleware, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const p = process.env.DHAN_TOKEN_FILE || path.join(__dirname, '..', 'data', 'dhan_token.json');
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/feed-health', authMiddleware, async (req, res) => {
  const health = feed.getProviderHealth();
  const circuit = require('../services/data/dhanClient').circuitSnapshot();
  let instruments = { loaded: false, count: 0 };
  try { const m = await loadMaster(); instruments = { loaded: m.raw.length > 0, count: m.raw.length }; } catch {}
  const reg = require('../services/data/registry').health();
  const sync = require('../services/data/continuousSync').snapshot();

  res.json({
    ...health,
    instruments,
    circuit,
    registry: {
      order: reg.order,
      active: reg.active,
      providers: reg.providers,
      yahoo: reg.yahoo,
    },
    sync,
    accountRequired: reg.order[0] !== 'DHAN',
    explanation: buildExplanation(health.DHAN, circuit, reg, sync),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Turn raw feed state into one sentence the UI can show verbatim. This is the
 * difference between "Not connected" (useless) and an actionable explanation.
 */
function buildExplanation(dh, circuit, reg, sync) {
  if (reg.order[0] === 'DHAN' && dh.connected) {
    return `Live DhanHQ tick-by-tick stream active (${dh.subscribed || sync.symbolsTracked} instruments).`;
  }
  if (reg.order[0] === 'YAHOO') {
    const last = sync.lastQuoteCycle ? new Date(sync.lastQuoteCycle).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'starting';
    const n = sync.symbolsTracked || 0;
    return `Free Yahoo Finance feed active - real prices for ${n} instruments, refreshing continuously (last sync ${last}). No Dhan account needed. Add one in Settings for sub-second depth.`;
  }
  if (circuit.state === 'OPEN') {
    return `Dhan is rate-limiting this IP (too many requests). Cooling down for ${circuit.cooldownMinutesLeft} min, then it resumes.`;
  }
  if (!reg.order.length) return 'No data provider available right now. Retrying automatically.';
  return `Provider: ${reg.order.join(' -> ')}. Continuous sync running.`;
}

module.exports = router;
