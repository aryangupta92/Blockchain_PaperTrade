/**
 * marketDataProvider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider-agnostic Market Data Abstraction Layer.
 *
 * Architecture:
 *   MarketDataProvider (this file)
 *     ├── DhanProvider        (live NSE/BSE — primary)
 *     ├── YahooProvider       (fallback — development only)
 *     └── [future providers]
 *
 * Every quote returned MUST have freshness metadata:
 *   source, receivedAt, freshness (LIVE|DELAYED|STALE|UNAVAILABLE), confidence
 *
 * Never display stale data as live (Golden Rule #6).
 */

'use strict';

const axios   = require('axios');
const { cacheGet, cacheSet, TTL } = require('./marketDataService');

// ── Provider Health State ─────────────────────────────────────────────────────
const providerHealth = {
  DHAN:  { healthy: true, lastSuccess: null, failCount: 0, latencyMs: 0 },
  YAHOO: { healthy: true, lastSuccess: null, failCount: 0, latencyMs: 0 },
};

const STALE_THRESHOLD_MS = 15 * 1000;   // 15s = STALE
const CIRCUIT_OPEN_FAILS = 5;           // After 5 consecutive fails, mark unhealthy

// ── Canonical Quote Shape ─────────────────────────────────────────────────────
function makeQuote(overrides) {
  return {
    symbol:         '',
    tradingSymbol:  '',
    exchange:       'NSE',
    name:           '',
    price:          0,
    open:           null,
    high:           null,
    low:            null,
    prevClose:      null,
    change:         0,
    changePercent:  0,
    volume:         0,
    vwap:           null,
    bidPrice:       null,
    askPrice:       null,
    openInterest:   null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow:  null,
    marketCap:      null,
    currency:       'INR',
    // Data quality metadata
    source:         'UNAVAILABLE',
    receivedAt:     new Date().toISOString(),
    exchangeTs:     null,
    freshness:      'UNAVAILABLE',   // LIVE | DELAYED | STALE | UNAVAILABLE
    confidence:     0,
    providerLatency: null,
    ...overrides,
  };
}

// ── Provider: Dhan ────────────────────────────────────────────────────────────
const DHAN_BASE = 'https://api.dhan.co';

async function fetchFromDhan(tradingSymbol) {
  const clientId    = process.env.DHAN_CLIENT_ID;
  const accessToken = process.env.DHAN_ACCESS_TOKEN;

  if (!clientId || !accessToken) return null;

  // Clean symbol: RELIANCE.NS → RELIANCE, ^NSEI → skip (indices not supported)
  const baseSymbol = tradingSymbol.replace('.NS', '').replace('.BO', '');
  if (baseSymbol.startsWith('^')) return null; // Dhan doesn't serve index quotes via this endpoint

  const t0 = Date.now();
  try {
    const res = await axios.post(
      `${DHAN_BASE}/v2/marketfeed/ltp`,
      { NSE_EQ: [baseSymbol] },
      {
        headers: {
          'access-token': accessToken,
          'client-id':    clientId,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );

    const latency = Date.now() - t0;
    const data = res.data?.data?.NSE_EQ?.[baseSymbol];
    if (!data) return null;

    providerHealth.DHAN.healthy     = true;
    providerHealth.DHAN.lastSuccess = new Date();
    providerHealth.DHAN.failCount   = 0;
    providerHealth.DHAN.latencyMs   = latency;

    const price     = data.last_price || 0;
    const prevClose = data.close_price || price;

    return makeQuote({
      symbol:        tradingSymbol,
      tradingSymbol,
      exchange:      'NSE',
      price,
      open:          data.open_price   || null,
      high:          data.high_price   || null,
      low:           data.low_price    || null,
      prevClose,
      change:        price - prevClose,
      changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      volume:        data.volume       || 0,
      openInterest:  data.oi           || null,
      source:        'DHAN',
      receivedAt:    new Date().toISOString(),
      freshness:     'LIVE',
      confidence:    1.0,
      providerLatency: latency,
    });
  } catch (err) {
    // Log first failure reason for diagnostics (only once per circuit state change)
    if (providerHealth.DHAN.failCount === 0) {
      console.warn(`[MarketData] Dhan error for ${baseSymbol}: ${err.response?.status} ${err.response?.data?.message || err.message}`);
    }
    providerHealth.DHAN.failCount++;
    if (providerHealth.DHAN.failCount >= CIRCUIT_OPEN_FAILS) {
      if (providerHealth.DHAN.healthy) {
        providerHealth.DHAN.healthy = false;
        console.warn(`[MarketData] Dhan circuit open — falling back to Yahoo Finance`);
      }
    }
    return null;
  }
}

// ── Provider: Yahoo Finance (fallback) ────────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept':     'application/json,text/plain,*/*',
};

async function fetchFromYahoo(yahooSymbol) {
  const t0 = Date.now();
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    const res = await axios.get(url, { headers: YF_HEADERS, timeout: 8000 });
    const meta = res.data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const latency   = Date.now() - t0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;
    const price     = meta.regularMarketPrice || 0;

    providerHealth.YAHOO.healthy     = true;
    providerHealth.YAHOO.lastSuccess = new Date();
    providerHealth.YAHOO.failCount   = 0;
    providerHealth.YAHOO.latencyMs   = latency;

    return makeQuote({
      symbol:          yahooSymbol,
      tradingSymbol:   yahooSymbol,
      exchange:        meta.exchangeName || 'NSE',
      name:            meta.shortName || yahooSymbol,
      price,
      open:            meta.regularMarketOpen || null,
      high:            meta.regularMarketDayHigh || null,
      low:             meta.regularMarketDayLow || null,
      prevClose,
      change:          price - prevClose,
      changePercent:   prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      volume:          meta.regularMarketVolume || 0,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  || null,
      marketCap:       meta.marketCap || null,
      currency:        meta.currency || 'INR',
      source:          'YAHOO',
      receivedAt:      new Date().toISOString(),
      // Yahoo data is delayed ~15min for non-premium — mark appropriately
      freshness:       'DELAYED',
      confidence:      0.7,
      providerLatency: latency,
    });
  } catch (err) {
    providerHealth.YAHOO.failCount++;
    if (providerHealth.YAHOO.failCount >= CIRCUIT_OPEN_FAILS) {
      providerHealth.YAHOO.healthy = false;
      console.warn('[MarketData] Yahoo circuit open after 5 failures');
    }
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a live quote with automatic provider fallback and freshness tagging.
 * Priority: DHAN (if healthy) → YAHOO (fallback) → cached stale → UNAVAILABLE
 */
async function getQuote(tradingSymbol) {
  const cacheKey = `mdp:quote:${tradingSymbol}`;
  const cached   = cacheGet(cacheKey);

  // 1. Try Dhan (primary)
  if (providerHealth.DHAN.healthy) {
    const q = await fetchFromDhan(tradingSymbol);
    if (q) {
      cacheSet(cacheKey, q, TTL.quotes);
      return q;
    }
  }

  // 2. Try Yahoo (fallback)
  if (providerHealth.YAHOO.healthy) {
    const yahooSym = tradingSymbol.endsWith('.NS') || tradingSymbol.startsWith('^') ? tradingSymbol : tradingSymbol + '.NS';
    const q = await fetchFromYahoo(yahooSym);
    if (q) {
      cacheSet(cacheKey, q, TTL.quotes);
      return q;
    }
  }

  // 3. Return stale cache if available
  if (cached) {
    const ageMs = Date.now() - new Date(cached.receivedAt).getTime();
    return {
      ...cached,
      freshness:  ageMs > STALE_THRESHOLD_MS ? 'STALE' : cached.freshness,
      confidence: Math.max(0, cached.confidence - 0.3),
    };
  }

  // 4. Nothing available
  return makeQuote({ symbol: tradingSymbol, tradingSymbol, freshness: 'UNAVAILABLE', confidence: 0 });
}

/**
 * Get quotes for multiple symbols with batching.
 */
async function getQuotesBatch(symbols) {
  const results = await Promise.allSettled(symbols.map(s => getQuote(s)));
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

/**
 * Get provider health status (for observability endpoint).
 */
function getProviderHealth() {
  return {
    DHAN:  { ...providerHealth.DHAN, lastSuccess: providerHealth.DHAN.lastSuccess?.toISOString() || null },
    YAHOO: { ...providerHealth.YAHOO, lastSuccess: providerHealth.YAHOO.lastSuccess?.toISOString() || null },
  };
}

module.exports = { getQuote, getQuotesBatch, getProviderHealth, makeQuote };
