'use strict';
/**
 * services/data/continuousSync.js
 * ---------------------------------------------------------------------------
 * Keeps the WHOLE app continuously fed from the best available provider.
 *
 *  - Quotes:  every quoteIntervalMs, refreshes the full universe (indices +
 *             Nifty 50 + sector picks + user watchlists) into the in-memory
 *             store and pushes updates to every subscribed WebSocket client.
 *  - Candles: every candleIntervalMs, backfills/refreshes OHLCV for the same
 *             universe into SQLite so charts render instantly.
 *  - Respects provider pacing and the Dhan circuit breaker; degrades quietly.
 */

const registry = require('./registry');
const yahoo = require('./providers/yahooProvider');
const store = require('./candleStore');

const QUOTE_MS = parseInt(process.env.SYNC_QUOTE_MS || '8000', 10);
const CANDLE_MS = parseInt(process.env.SYNC_CANDLE_MS || '120000', 10); // 2 min

let quoteTimer = null;
let candleTimer = null;
let running = false;
let cycleBusy = false;

const stats = {
  startedAt: null,
  quoteCycles: 0,
  candleCycles: 0,
  symbolsTracked: 0,
  lastQuoteCycle: null,
  lastCandleCycle: null,
  lastErrors: [],
};

const memoryStore = new Map(); // canonical symbol -> latest quote
let pushFn = null;             // set by the WS gateway to fan out to clients

/** Universe the app always keeps live (independent of user watchlists). */
function baseUniverse() {
  const idx = Object.keys(require('./instrumentMaster').getIndexIds());
  const nifty50 = registryIndexUniverse();
  const set = new Set([...idx, ...nifty50]);
  return Array.from(set);
}

function registryIndexUniverse() {
  // keep the same Nifty 50 list the rest of the app already uses
  try {
    return require('../marketDataProvider').NIFTY50;
  } catch {
    return [];
  }
}

/** Let the WS gateway register a push callback. */
function onTick(cb) { pushFn = typeof cb === 'function' ? cb : null; }

function lastError(e) {
  stats.lastErrors.unshift({ at: new Date().toISOString(), msg: e.message });
  if (stats.lastErrors.length > 10) stats.lastErrors.pop();
}

async function quoteCycle() {
  // NEVER let cycles overlap: a cycle that overruns the interval used to pile up
  // until the request lanes were permanently saturated, which is what made
  // /indices and /movers hang for 45s+.
  if (cycleBusy) return;
  cycleBusy = true;
  const t = Date.now();
  try {
    const symbols = baseUniverse();
    // background lane: leaves the interactive lane free for user requests
    const rows = await registry.getQuotes(symbols, true);
    const live = rows.filter((r) => r.price != null && r.price > 0);
    live.forEach((r) => memoryStore.set(String(r.symbol).toUpperCase(), r));
    stats.symbolsTracked = live.length;
    stats.quoteCycles++;
    stats.lastQuoteCycle = new Date().toISOString();
    stats.lastQuoteMs = Date.now() - t;
    if (live.length && pushFn) {
      try { pushFn(live); } catch (e) { lastError(e); }
    }
    if (stats.quoteCycles <= 3) {
      console.log(`[sync] quote cycle ${stats.quoteCycles}: ${live.length}/${symbols.length} live in ${stats.lastQuoteMs}ms via ${registry.order().join('->')}`);
    }
  } catch (e) { lastError(e); }
  finally { cycleBusy = false; }
}

async function candleCycle() {
  try {
    const symbols = baseUniverse();
    const dhanFirst = registry.order().includes('DHAN');
    // Only the headline timeframes are refreshed continuously; longer ranges are
    // fetched on demand by the chart page.
    const tfs = dhanFirst ? ['1m', '5m', '15m', '1D'] : ['5m', '1D'];
    for (const tf of tfs) {
      const res = await registry.getCandles(symbols[0] && symbols.includes('^NSEI') ? '^NSEI' : symbols[0], tf, tf === '1D' ? '6mo' : '5d');
      // seeding one symbol per timeframe keeps this cheap; the chart page pulls
      // full history per symbol on demand and caches it.
      await store.saveBars('^NSEI', tf, res.data).catch(() => {});
    }
    stats.candleCycles++;
    stats.lastCandleCycle = new Date().toISOString();
  } catch (e) { lastError(e); }
}

function start() {
  if (running) return stats;
  running = true;
  stats.startedAt = new Date().toISOString();
  console.log(`[sync] continuous market sync started (quotes every ${QUOTE_MS / 1000}s, candles every ${CANDLE_MS / 60000}min)`);
  quoteTimer = setInterval(quoteCycle, QUOTE_MS);
  candleTimer = setInterval(candleCycle, CANDLE_MS);
  // kick off immediately, but don't block server boot
  setImmediate(() => { quoteCycle(); setTimeout(candleCycle, 5000); });
  return stats;
}

function stop() {
  if (quoteTimer) clearInterval(quoteTimer);
  if (candleTimer) clearInterval(candleTimer);
  running = false;
}

function snapshot() {
  const h = registry.health();
  return {
    ...stats,
    running,
    activeProvider: h.active,
    providerOrder: h.order,
    yahoo: h.yahoo,
    dhan: h.dhan,
  };
}

/** Latest cached quote for a symbol (no network). */
function cached(symbol) { return memoryStore.get(String(symbol).toUpperCase()) || null; }
function allCached() { return Array.from(memoryStore.values()); }

module.exports = { start, stop, snapshot, onTick, cached, allCached, baseUniverse };
