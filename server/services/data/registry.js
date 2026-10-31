'use strict';
/**
 * services/data/registry.js
 * ---------------------------------------------------------------------------
 * The single entry point for all market data. Every consumer asks the registry,
 * never a provider directly.
 *
 * Provider priority (automatic, health-aware):
 *   1. DHAN     - only when the operator has configured an account AND the
 *                 token is valid AND the circuit is closed. Sub-second real
 *                 ticks, 5-level depth, OI, full option chain.
 *   2. YAHOO    - free, no key, no account. Works for every deployment. Real
 *                 quotes + OHLCV candles for all NSE/BSE/index symbols.
 *   3. STORE    - our SQLite candle cache, so history always renders.
 *
 * Rules enforced here:
 *   - Never fabricate a price. Unknown -> freshness UNAVAILABLE.
 *   - Always label `source` so the UI can be honest about freshness.
 *   - Circuit breaker: a rate-limited provider is skipped until cooldown ends.
 */

const yahoo = require('./providers/yahooProvider');
const { getIndexIds } = require('./instrumentMaster');

// ── Provider state ────────────────────────────────────────────────────────────
const providers = {
  DHAN:  { available: false, priority: 1, reason: 'not configured' },
  YAHOO: { available: true,  priority: 2, reason: 'free provider' },
};

function refreshAvailability() {
  let dhanOk = false;
  let reason = 'not configured';
  try {
    const auth = require('./dhanAuth');
    const token = auth.getToken();
    const client = require('./dhanClient');
    const circuit = client.circuitSnapshot();
    const ws = require('./binaryFeed').status();

    if (!auth.hasAppCredentials() && !process.env.DHAN_ACCESS_TOKEN) reason = 'not configured (optional - Yahoo is the default free source)';
    else if (!token) reason = 'no access token - consent login required';
    else if (circuit.state === 'OPEN') reason = `rate-limited (cooling down ${circuit.cooldownMinutesLeft}m)`;
    else if (wsBlockedState(ws)) reason = `live stream blocked (${ws.lastError || 'rate limited'}) - Yahoo is carrying the feed`;
    // Only prefer Dhan when the socket is actually up, otherwise every quote
    // would first pay the reconnect cost before falling back.
    else if (!ws.connected) reason = 'token valid, live stream not connected (standby)';
    else { dhanOk = true; reason = 'live'; }
  } catch (e) { reason = 'unavailable: ' + e.message; }
  providers.DHAN.available = dhanOk;
  providers.DHAN.reason = reason;
  return providers;
}

/** True when the Dhan WebSocket has exhausted its reconnect budget. */
function wsBlockedState(ws) {
  if (!ws) return false;
  return Boolean(ws.blocked) || (ws.attempts >= parseInt(process.env.DHAN_WS_MAX_ATTEMPTS || '5', 10) && ws.connected === false && ws.attempts > 0);
}

function order() {
  refreshAvailability();
  return Object.entries(providers)
    .filter(([, v]) => v.available)
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([k]) => k);
}

// ── Quotes ────────────────────────────────────────────────────────────────────
/**
 * Real quotes with automatic provider selection. Each returned entry carries
 * `source` (DHAN | DHAN-CACHED | YAHOO | UNAVAILABLE) and `freshness`.
 *
 * Cache-first: the continuous sync daemon keeps the whole universe warm, so most
 * calls are answered from memory with zero upstream cost. Only a miss goes
 * upstream, and `background: true` marks a backfill so it uses the small request
 * lane and can never starve a user-facing call.
 */
async function getQuotes(symbols, background = false) {
  const list = (Array.isArray(symbols) ? symbols : [symbols]).filter(Boolean);
  if (!list.length) return [];

  const sync = require('./continuousSync');
  const maxAge = Number(process.env.QUOTE_CACHE_MAX_AGE_MS || 30000);

  // 1) serve everything warm from the sync cache
  const out = [];
  const needsFetch = [];
  for (const s of list) {
    const key = String(s).toUpperCase();
    const hit = sync.cached(s) || sync.cached(key.replace(/\.(NS|BO)$/, ''));
    if (hit && hit.price != null && Date.now() - hit.receivedAt < maxAge) out.push(hit);
    else needsFetch.push(s);
  }
  if (!needsFetch.length) return orderPreserving(out, list);

  // 2) fetch the rest from the best provider
  const active = order();
  if (!active.length) {
    needsFetch.forEach((s) => out.push(unavailable(s)));
    return orderPreserving(out, list);
  }

  const missing = new Set(needsFetch.map((s) => String(s).toUpperCase()));
  for (const name of active) {
    if (!missing.size) break;
    try {
      if (name === 'DHAN') {
        const feed = require('./dhanMarketFeed');
        const rows = await feed.getQuotesBatch(Array.from(missing));
        rows.forEach((r) => {
          if (r && r.price != null && r.price > 0) { out.push(r); missing.delete(String(r.symbol).toUpperCase()); }
        });
      } else if (name === 'YAHOO') {
        const rows = await yahoo.getQuotes(Array.from(missing), background);
        rows.forEach((r) => {
          if (r && r.price != null && r.price > 0) { out.push(r); missing.delete(String(r.symbol).toUpperCase()); }
        });
      }
    } catch (e) {
      console.warn(`[registry] provider ${name} failed: ${e.message}`);
    }
  }

  // Anything still missing is honestly reported, never faked
  list.forEach((s) => {
    const key = String(s).toUpperCase();
    if (!out.find((o) => String(o.symbol).toUpperCase() === key)) out.push(unavailable(s));
  });

  return orderPreserving(out, list);
}

/** Restore the caller's symbol ordering. */
function orderPreserving(rows, list) {
  const rank = new Map(list.map((s, i) => [String(s).toUpperCase(), i]));
  return rows.sort((a, b) => (rank.get(String(a.symbol).toUpperCase()) ?? 99) - (rank.get(String(b.symbol).toUpperCase()) ?? 99));
}

/**
 * Same as getQuotes but never blocks longer than `timeoutMs`. When the deadline
 * passes, whatever is cached is returned (marked CACHED) and the rest as
 * UNAVAILABLE. This is the guarantee the HTTP layer relies on: a slow upstream
 * must degrade the UI, never hang it.
 */
async function getQuotesWithDeadline(symbols, timeoutMs = 6000, background = false) {
  const list = (Array.isArray(symbols) ? symbols : [symbols]).filter(Boolean);
  let timer;
  try {
    return await Promise.race([
      getQuotes(list, background),
      new Promise((resolve) => { timer = setTimeout(() => resolve('TIMEOUT'), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(symbol) {
  return {
    symbol: String(symbol).toUpperCase(),
    tradingSymbol: String(symbol).toUpperCase(),
    name: String(symbol).toUpperCase(),
    price: null,
    prevClose: null,
    change: null,
    changePercent: null,
    source: 'UNAVAILABLE',
    freshness: 'UNAVAILABLE',
    error: 'No provider returned data for this symbol',
  };
}

// ── Candles ───────────────────────────────────────────────────────────────────
/** Candle lookup with store-first, backfill-from-provider, honest source label. */
async function getCandles(symbol, timeframe, range) {
  const store = require('./candleStore');
  const lookbackSec = rangeToSeconds(range, timeframe);
  const fromTs = Math.floor(Date.now() / 1000) - lookbackSec;

  // 1) local store (instant, zero upstream)
  let bars = await store.getBars(symbol, timeframe, fromTs);
  if (bars.length >= 60) {
    return { data: bars, source: 'CANDLE_STORE', meta: {} };
  }

  // 2) backfill from the best available provider
  const dhanFirst = order().includes('DHAN');
  const attempts = dhanFirst
    ? [['DHAN', () => require('../marketDataProvider').fetchHistory(symbol, range, timeframe)],
       ['YAHOO', () => yahoo.getCandles(symbol, range, tfForYahoo(timeframe))]]
    : [['YAHOO', () => yahoo.getCandles(symbol, range, tfForYahoo(timeframe))]];

  for (const [name, fn] of attempts) {
    try {
      const res = await fn();
      const data = res?.data || [];
      if (data.length) {
        await store.saveBars(symbol, timeframe, data);
        return { data: await store.getBars(symbol, timeframe, fromTs), source: name, meta: res.meta || {} };
      }
    } catch (e) {
      console.warn(`[registry] candles from ${name} failed: ${e.message}`);
    }
  }
  return { data: bars, source: bars.length ? 'CANDLE_STORE' : 'EMPTY', meta: {} };
}

function tfForYahoo(tf) {
  const map = { '1m': '1m', '3m': '2m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '4h': '60m', '1D': '1d', '1W': '1wk' };
  return map[tf] || '1d';
}

function rangeToSeconds(range, timeframe) {
  const base = {
    '1d': 86400, '5d': 5 * 86400, '1mo': 30 * 86400, '3mo': 90 * 86400,
    '6mo': 180 * 86400, '1y': 365 * 86400, '2y': 730 * 86400,
    '5y': 1825 * 86400, max: 3650 * 86400,
  };
  const secs = base[range] || 30 * 86400;
  // intraday data needs more lookback to produce enough bars
  if (['1m', '3m', '5m', '15m', '30m', '1h', '4h'].includes(timeframe)) return Math.max(secs, 12 * 86400);
  return secs;
}

// ── Misc passthroughs ─────────────────────────────────────────────────────────
const search = (q) => yahoo.search(q);
const screener = (kind, count) => yahoo.screener(kind, count);
const indices = () => Object.entries(getIndexIds()).map(([symbol, v]) => ({
  symbol, name: v.display, securityId: v.securityId,
}));

function health() {
  refreshAvailability();
  const client = (() => { try { return require('./dhanClient').stats(); } catch { return null; } })();
  const circuit = (() => { try { return require('./dhanClient').circuitSnapshot(); } catch { return null; } })();
  const ws = (() => { try { return require('./binaryFeed').status(); } catch { return null; } })();
  const feed = (() => { try { return require('./dhanMarketFeed').getProviderHealth().DHAN; } catch { return null; } })();
  return {
    providers,
    order: order(),
    active: order()[0] || null,
    yahoo: yahoo.health(),
    dhan: { stats: client, circuit, ws, feed },
    accountRequired: !providers.DHAN.available,
  };
}

module.exports = {
  getQuotes, getQuotesWithDeadline, getCandles, search, screener, indices, health,
  toYahoo: yahoo.toYahoo, order, providers,
};
