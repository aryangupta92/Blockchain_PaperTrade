'use strict';
/**
 * marketDataService.js — compatibility façade in front of the real-data layer.
 * ---------------------------------------------------------------------------
 * Every consumer (routes/market.js, options.js, extensions.js, ...) imports the
 * same names it always did, but the data now comes from the DhanHQ feed via
 * marketDataProvider:
 *
 *   live quotes    -> DhanHQ WebSocket ticks (real, sub-second)
 *   OHLCV history  -> local candle store, backfilled from DhanHQ
 *   option chain   -> DhanHQ /optionchain
 *   fallbacks      -> local store, then Yahoo v8 (clearly labelled)
 *
 * Nothing here fabricates prices: an unknown symbol comes back as
 * fresness 'UNAVAILABLE' so the UI can badge it as NO DATA.
 */

const provider = require('./marketDataProvider');
const candleStore = require('./data/candleStore');

// ── Names preserved for existing callers ──────────────────────────────────────
const toYahoo = provider.toYahoo;
const sanitizeInterval = provider.sanitizeInterval;
const NIFTY50 = provider.NIFTY50;
const INDICES = provider.INDICES;
const SECTORS = provider.SECTORS;
const TTL = provider.TTL;

// Candles are cached in SQLite now; the in-memory cache is a no-op kept so
// route code that calls cacheGet/cacheSet around a fetch still works.
const cacheGet = () => null;
const cacheSet = () => {};

const fetchQuoteSingle = (symbol) => provider.getQuote(symbol);
const fetchQuotesBatch = (symbols) => provider.getQuotesBatch(symbols);
const fetchHistory = (symbol, range, interval) => provider.fetchHistory(symbol, range, interval);
const fetchInrRate = () => provider.fetchInrRate();

// market.js calls this with a symbol list and returns [{ symbol, ... }]
const getQuotesLive = (symbols) => provider.getQuotesLive(symbols);

// ── Extra exports the new data layer exposes ─────────────────────────────────
const startFeed = () => provider.startFeed();
const getProviderHealth = () => provider.getProviderHealth();

module.exports = {
  toYahoo,
  sanitizeInterval,
  NIFTY50,
  INDICES,
  SECTORS,
  TTL,
  cacheGet,
  cacheSet,
  fetchQuoteSingle,
  fetchQuotesBatch,
  fetchHistory,
  fetchInrRate,
  getQuotesLive,

  // real-data layer additions
  startFeed,
  getProviderHealth,
  resolvePairSmart: provider.resolvePairSmart,
  loadMaster: provider.loadMaster,
  candleStore,
};
