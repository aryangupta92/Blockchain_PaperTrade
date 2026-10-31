'use strict';
/**
 * marketDataProvider.js - Quote facade over the REAL DhanHQ data feed.
 * ------------------------------------------------------------------
 * v5 rewrite: no seeded prices, no random-walk ticks, no fabricated symbols.
 *
 *   LIVE        -> real Dhan WebSocket tick (<15s old)
 *   CACHED      -> last real Dhan tick (market closed / feed reconnecting)
 *   UNAVAILABLE -> never received data for this symbol (UI shows NO DATA badge)
 *
 * Dhan is the single source of live quotes; historical candles come from the
 * local candle store (backfilled from Dhan) with Yahoo as a text fallback.
 */

const axios = require('axios');
const marketFeed = require('./data/dhanMarketFeed');
const candleStore = require('./data/candleStore');
const registry = require('./data/registry');
const { resolvePairSmart, getIndexIds, loadMaster } = require('./data/instrumentMaster');
const { blackScholes, calculateGreeks } = require('./optionsEngine');
const { getSpec } = require('./foMaster');
const { parseFOSymbol } = require('./marginService');
const continuousSync = require('./data/continuousSync');

const RISK_FREE_RATE = 0.065;

// =============================================================================
//  Symbol universes (identical to the previous app)
// =============================================================================

const NIFTY50 = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'SBIN', 'BAJFINANCE', 'BHARTIARTL', 'WIPRO',
  'AXISBANK', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'MARUTI',
  'SUNPHARMA', 'TITAN', 'NTPC', 'TECHM', 'HCLTECH',
  'ONGC', 'COALINDIA', 'JSWSTEEL', 'POWERGRID', 'ULTRACEMCO',
  'NESTLEIND', 'ADANIPORTS', 'BAJAJFINSV', 'DRREDDY', 'DIVISLAB',
  'CIPLA', 'EICHERMOT', 'BRITANNIA', 'HEROMOTOCO', 'TATACONSUM',
  'SBILIFE', 'HDFCLIFE', 'APOLLOHOSP', 'GRASIM', 'ADANIENT',
  'TATAMOTORS', 'BPCL', 'SHREECEM', 'HINDALCO', 'TATAPOWER',
  'ITC', 'M&M', 'INDUSINDBK', 'UPL', 'LTIM',
];

const INDICES = Object.entries(getIndexIds()).map(([symbol, v]) => ({
  symbol,
  name: v.display.replace(/^NIFTY /, 'Nifty '),
  shortName: v.display,
}));

const SECTORS = {
  'IT':       ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM'],
  'Banking':  ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK'],
  'FMCG':     ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM'],
  'Auto':     ['MARUTI', 'TATAMOTORS', 'EICHERMOT', 'HEROMOTOCO', 'M&M'],
  'Pharma':   ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'APOLLOHOSP'],
  'Energy':   ['RELIANCE', 'ONGC', 'BPCL', 'TATAPOWER', 'ADANIENT'],
  'Infra':    ['LT', 'NTPC', 'POWERGRID', 'ADANIPORTS', 'JSWSTEEL'],
  'Finance':  ['BAJFINANCE', 'BAJAJFINSV', 'SBILIFE', 'HDFCLIFE'],
};

// =============================================================================
//  Live quotes - Dhan feed only
// =============================================================================

function makeQuote(overrides = {}) {
  const price = overrides.price ?? null;
  const prevClose = overrides.prevClose ?? price;
  const change = overrides.change !== undefined ? overrides.change
    : (price != null && prevClose ? +(price - prevClose).toFixed(2) : null);
  const changePercent = overrides.changePercent !== undefined ? overrides.changePercent
    : (change != null && prevClose ? +((change / prevClose) * 100).toFixed(2) : null);
  return {
    symbol: overrides.symbol || '',
    tradingSymbol: overrides.tradingSymbol || overrides.symbol || '',
    exchange: overrides.exchange || 'NSE',
    name: overrides.name || overrides.symbol || '',
    price,
    prevClose: prevClose ?? null,
    change,
    changePercent,
    open: overrides.open ?? null,
    high: overrides.high ?? null,
    low: overrides.low ?? null,
    volume: overrides.volume ?? null,
    vwap: overrides.vwap ?? null,
    bidPrice: overrides.bidPrice ?? null,
    askPrice: overrides.askPrice ?? null,
    bidDepth: overrides.bidDepth || [],
    askDepth: overrides.askDepth || [],
    openInterest: overrides.openInterest ?? null,
    openInterestDay: overrides.openInterestDay ?? null,
    fiftyTwoWeekHigh: overrides.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: overrides.fiftyTwoWeekLow ?? null,
    marketCap: overrides.marketCap ?? null,
    currency: 'INR',
    source: overrides.source || 'DHAN',
    freshness: overrides.freshness || 'LIVE',
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function startFeed() {
  const s = continuousSync.start();
  if (registry.order().includes('DHAN')) {
    try { await marketFeed.start(); } catch (e) { console.warn('[feed] Dhan WS not up:', e.message); }
  }
  return s;
}

async function getQuote(tradingSymbol) {
  const q = await registry.getQuotes([tradingSymbol]);
  return makeQuote(q[0]);
}

/** Cache-first batch quote. `background: true` uses the small request lane. */
async function getQuotesBatch(symbols, background = false) {
  const list = (symbols || []).filter(Boolean);
  if (!list.length) return [];

  const CACHE_MAX_AGE = Number(process.env.QUOTE_CACHE_MAX_AGE_MS || 30000); // 30s
  const DEADLINE_MS = Number(process.env.QUOTE_DEADLINE_MS || 6000);
  const out = [];
  const needsFetch = [];

  for (const s of list) {
    const hit = continuousSync.cached(s);
    if (hit && Date.now() - hit.receivedAt < CACHE_MAX_AGE) out.push(makeQuote(hit));
    else needsFetch.push(s);
  }

  if (needsFetch.length) {
    const rows = await registry.getQuotesWithDeadline(needsFetch, DEADLINE_MS, background);
    if (rows === 'TIMEOUT') {
      // upstream congested: serve the cache and badge the rest, never hang
      needsFetch.forEach((s) => {
        const stale = continuousSync.cached(s);
        if (stale) out.push(makeQuote({ ...stale, freshness: 'CACHED', source: 'CACHED' }));
        else out.push(makeQuote({ symbol: s, tradingSymbol: s, price: null, freshness: 'UNAVAILABLE', source: 'UNAVAILABLE' }));
      });
    } else {
      ;(rows || []).forEach((r) => out.push(makeQuote(r)));
    }
  }

  const rank = new Map(list.map((s, i) => [String(s).toUpperCase(), i]));
  return out.sort((a, b) => (rank.get(String(a.symbol).toUpperCase()) ?? 99) - (rank.get(String(b.symbol).toUpperCase()) ?? 99));
}

const getQuotesLive = getQuotesBatch;

function getProviderHealth() {
  const dh = marketFeed.getProviderHealth().DHAN;
  return {
    DHAN: dh,
    providers: ['DHAN'],
    mocks: 'removed', // live data only, no synthetic fallback
  };
}

// =============================================================================
//  F&O pricing - real Dhan contract first, Black-Scholes only as an explicit,
//  clearly-labelled estimate for strikes Dhan's master does not list.
// =============================================================================

function timeToMaturity(expiryCode) {
  if (!expiryCode || typeof expiryCode !== 'string') return 0.02;
  try {
    const day = parseInt(expiryCode.slice(0, 2), 10);
    const monStr = expiryCode.slice(2, 5).toUpperCase();
    const year = 2000 + parseInt(expiryCode.slice(5, 7), 10);
    const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const month = months[monStr];
    if (month === undefined) return 0.02;
    const expiry = new Date(Date.UTC(year, month, day, 10, 0, 0));
    const ms = expiry.getTime() - Date.now();
    return ms <= 0 ? 0.001 : ms / (1000 * 60 * 60 * 24 * 365);
  } catch {
    return 0.02;
  }
}

async function computeFOQuote(tradingSymbol) {
  // 1) Genuine Dhan contract when the instrument master knows it
  try {
    const pair = await resolvePairSmart(tradingSymbol);
    if (pair && pair.securityId) {
      const body = { [pair.exchangeSegment]: [String(pair.securityId)] };
      const res = await dhanClient.getFullQuotes(body);
      const row = res && res.data && res.data[pair.exchangeSegment] && res.data[pair.exchangeSegment][0];
      if (row && row.last_price) {
        const ohlc = row.ohlc || {};
        const depth = (row.depth || []).map((lv) => ({
          price: +lv.price, quantity: lv.quantity, orders: lv.orders_count || 0,
        }));
        return makeQuote({
          symbol: tradingSymbol, tradingSymbol,
          exchange: (pair.record && pair.record.exchange) || 'NSE',
          price: row.last_price,
          prevClose: ohlc.close, open: ohlc.open, high: ohlc.high, low: ohlc.low,
          volume: row.volume,
          vwap: row.atp,
          openInterest: row.oi != null ? row.oi : null,
          bidDepth: depth, askDepth: depth,
          source: 'DHAN', freshness: 'LIVE', estimated: false,
        });
      }
    }
  } catch (e) {
    // fall through to the explicitly-labelled estimate below
  }

  // 2) Black-Scholes estimate (labelled - never silently presented as a trade)
  const parsed = parseFOSymbol(tradingSymbol);
  if (!parsed) {
    return makeQuote({ symbol: tradingSymbol, tradingSymbol, price: null, freshness: 'UNAVAILABLE', source: 'UNAVAILABLE' });
  }

  const spec = getSpec(parsed.underlying) || { lot: 1, exchange: 'NSE' };
  const T = Math.max(0.001, timeToMaturity(parsed.expiry));

  let underlyingPrice = null;
  try {
    const spotPair = await resolvePairSmart(parsed.underlying);
    const q = await getQuote((spotPair && spotPair.tradingSymbol) || parsed.underlying);
    underlyingPrice = q && q.price != null ? q.price : null;
  } catch (e) {
    underlyingPrice = null;
  }
  if (underlyingPrice == null) {
    return makeQuote({ symbol: tradingSymbol, tradingSymbol, price: null, freshness: 'UNAVAILABLE', source: 'UNAVAILABLE' });
  }

  const moneyness = underlyingPrice / (parsed.strike || underlyingPrice);
  const iv = Math.min(0.75, Math.max(0.08, 0.14 + Math.abs(Math.log(moneyness)) * 0.45 + Math.sqrt(T) * 0.15));

  const premium = parsed.optionType === 'FUT'
    ? underlyingPrice * Math.exp(RISK_FREE_RATE * T)
    : blackScholes(underlyingPrice, parsed.strike, T, RISK_FREE_RATE, iv, parsed.optionType);

  const greeks = parsed.optionType === 'FUT'
    ? { delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 }
    : calculateGreeks(underlyingPrice, parsed.strike, T, RISK_FREE_RATE, iv, parsed.optionType);

  return makeQuote({
    symbol: tradingSymbol, tradingSymbol,
    exchange: spec.exchange || 'NSE',
    price: +Math.max(0.05, premium).toFixed(2),
    openInterest: null, open: null, high: null, low: null, prevClose: null, volume: null,
    currency: 'INR',
    source: 'BLACK-SCHOLES-ESTIMATE',
    freshness: 'ESTIMATE',
    estimated: true,
    iv: +(iv * 100).toFixed(2),
    greeks,
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionType: parsed.optionType,
    lotSize: spec.lot || 1,
    name: `${parsed.underlying} ${parsed.expiry} ${parsed.strike || ''} ${parsed.optionType}`,
  });
}

// =============================================================================
//  Candles - local store (Dhan backfill) with Yahoo text fallback
// =============================================================================

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Accept: 'application/json',
};

/** Aggregate smaller bars into larger buckets (e.g. 1m -> 5m). */
function coarsen(bars, bucketSec) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const bucketed = Math.floor(b.time / bucketSec) * bucketSec;
    if (!cur || cur.time !== bucketed) {
      if (cur) out.push(cur);
      cur = { time: bucketed, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, oi: b.oi != null ? b.oi : null };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
      if (b.oi != null) cur.oi = b.oi;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function backfillFromDhan(symbol, tf, needFromTs) {
  const pair = await resolvePairSmart(symbol);
  if (!pair) return 0;

  const isIndex = pair.exchangeSegment === 'IDX_I';
  const segment = isIndex ? 'IDX_I' : pair.exchangeSegment;
  const instrument = (pair.record && pair.record.instrument) || (isIndex ? 'INDEX' : 'EQUITY');
  const isIntraday = !(tf === '1D' || tf === '1W');

  try {
    let bars = [];
    if (isIntraday) {
      const intervalMap = { '1m': 1, '3m': 5, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 60 };
      const interval = intervalMap[tf] || 1;
      const res = await dhanClient.getIntradayHistory({
        securityId: pair.securityId, exchangeSegment: segment, instrument, interval,
        fromDate: new Date(needFromTs * 1000), toDate: new Date(), oi: true,
      });
      bars = candleStore.normalizeDhanBars(res);
      if (bars.length && intervalMap[tf] !== interval) bars = coarsen(bars, candleStore.TIMEFRAMES[tf]);
    } else {
      const res = await dhanClient.getDailyHistory({
        securityId: pair.securityId, exchangeSegment: segment, instrument,
        fromDate: new Date(needFromTs * 1000), toDate: new Date(), oi: false,
      });
      bars = candleStore.normalizeDhanBars(res);
    }
    return bars.length ? candleStore.saveBars(symbol, tf, bars) : 0;
  } catch (e) {
    if (e.code === 'AUTH_REQUIRED' || e.code === 'DAILY_LIMIT') throw e;
    return 0;
  }
}

async function fetchHistory(yahooSymbol, range = '5d', interval = null) {
  const tf = normalizeTimeframe(interval);
  const res = await registry.getCandles(yahooSymbol, tf, range);
  return {
    data: res.data,
    symbol: yahooSymbol,
    range,
    interval: tf,
    meta: { currency: 'INR', exchangeName: 'NSE', regularMarketPrice: res.data.length ? res.data[res.data.length - 1].close : null },
    source: res.source,
    timestamp: new Date().toISOString(),
  };
}

function normalizeTimeframe(i) {
  if (!i) return '1D';
  const map = {
    '1m': '1m', '2m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '60m': '1h', '90m': '1h', '1h': '1h', '1d': '1D', '1wk': '1W', '1mo': '1W',
  };
  return map[i] || '1D';
}

function rangeToSeconds(range) {
  const map = {
    '1d': 86400, '5d': 5 * 86400, '1mo': 30 * 86400, '3mo': 90 * 86400,
    '6mo': 180 * 86400, '1y': 365 * 86400, '2y': 730 * 86400,
    '5y': 1825 * 86400, max: 7300 * 86400,
  };
  return map[range] || 30 * 86400;
}

async function fetchYahoo(symbol, range, interval) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toYahoo(symbol))}?interval=${interval || '1d'}&range=${range}`;
    const r = await axios.get(url, { headers: YF_HEADERS, timeout: 20000 });
    const result = r.data && r.data.chart && r.data.chart.result && r.data.chart.result[0];
    if (!result) throw new Error('no chart result');
    const stamps = result.timestamp || [];
    const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    const data = stamps.map((t, i) => ({
      time: t,
      open: +((q.open && q.open[i]) || 0).toFixed(2),
      high: +((q.high && q.high[i]) || 0).toFixed(2),
      low: +((q.low && q.low[i]) || 0).toFixed(2),
      close: +((q.close && q.close[i]) || 0).toFixed(2),
      volume: (q.volume && q.volume[i]) || 0,
    })).filter((d) => d.open > 0 && d.close > 0 && d.time > 0);
    return { data, meta: result.meta || {}, source: 'yahoo' };
  } catch (e) {
    return { data: [], meta: {}, source: 'none', error: e.message };
  }
}

function toYahoo(symbol) {
  if (!symbol) return '';
  const s = String(symbol);
  if (s.startsWith('^')) return s;
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s;
  return s + '.NS';
}

const TTL = { quotes: 15000, candles: 300000, movers: 120000, indices: 15000, sectors: 300000, news: 600000, inr: 3600000 };
const cacheGet = () => null;
const cacheSet = () => {};

async function fetchInrRate() {
  try {
    const r = await axios.get('https://api.frankfurter.app/latest?from=USD&to=INR', { timeout: 5000 });
    const rate = r.data && r.data.rates && r.data.rates.INR;
    return { usdToInr: rate || 83.5, source: 'frankfurter', timestamp: new Date().toISOString() };
  } catch (e) {
    return { usdToInr: 83.5, source: 'fallback', timestamp: new Date().toISOString() };
  }
}

module.exports = {
  toYahoo,
  sanitizeInterval: (i) => i,
  NIFTY50, INDICES, SECTORS, TTL,
  cacheGet, cacheSet,
  fetchQuoteSingle: getQuote,
  fetchQuotesBatch: getQuotesBatch,
  fetchHistory,
  fetchInrRate,
  getQuotesLive,
  getQuotesBatch,
  getQuote,
  getProviderHealth,
  makeQuote,
  computeFOQuote,
  startFeed,
  loadMaster,
  resolvePairSmart,
};
