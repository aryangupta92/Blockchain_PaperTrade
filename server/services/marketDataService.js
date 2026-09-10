'use strict';
/**
 * marketDataService.js
 * --------------------
 * Central service for all market data fetching.
 *
 * Strategy:
 *   1. Check in-memory TTL cache first
 *   2. Try yahoo-finance2 (handles cookies/crumbs automatically)
 *   3. Fall back to raw Yahoo Finance v8 axios call if yf2 fails
 *
 * Cache TTLs (configurable via env):
 *   CACHE_TTL_QUOTES   = 60  seconds  (live quotes)
 *   CACHE_TTL_CANDLES  = 300 seconds  (OHLCV history)
 *   CACHE_TTL_MOVERS   = 120 seconds  (top gainers/losers)
 *   CACHE_TTL_INDICES  = 30  seconds  (index values — more sensitive)
 *   CACHE_TTL_SECTORS  = 300 seconds  (sector performance)
 *   CACHE_TTL_NEWS     = 600 seconds  (news — 10 min)
 *   CACHE_TTL_INR      = 3600 seconds (exchange rate — 1 hour)
 */

const axios = require('axios');

let yf = null;
// yahoo-finance2 v2.14.0 is ESM-only — attempt to load the internal CJS build
// If that fails we use raw axios fallback (which also works fine)
try {
  // Try the internal dist path that some versions expose for CJS
  yf = require('yahoo-finance2/dist/cjs/src/index-commonjs.js');
  if (yf && yf.default) yf = yf.default;
  if (yf && typeof yf.setGlobalConfig === 'function') {
    yf.setGlobalConfig({ validation: { logErrors: false, logOptionsErrors: false } });
  }
  // Quick sanity check
  if (!yf || typeof yf.quote !== 'function') throw new Error('quote() not found');
  console.log('✅ yahoo-finance2 (CJS path) loaded successfully');
} catch (e) {
  yf = null;
  console.log('ℹ️  yahoo-finance2 not available via CJS — using raw axios fallback (works fine)');
}

// ─── TTL Cache ────────────────────────────────────────────────────────────────
const cache = new Map(); // key → { data, expiresAt }

const TTL = {
  quotes:  parseInt(process.env.CACHE_TTL_QUOTES  || '60',   10) * 1000,
  candles: parseInt(process.env.CACHE_TTL_CANDLES || '300',  10) * 1000,
  movers:  parseInt(process.env.CACHE_TTL_MOVERS  || '120',  10) * 1000,
  indices: parseInt(process.env.CACHE_TTL_INDICES || '30',   10) * 1000,
  sectors: parseInt(process.env.CACHE_TTL_SECTORS || '300',  10) * 1000,
  news:    parseInt(process.env.CACHE_TTL_NEWS    || '600',  10) * 1000,
  inr:     parseInt(process.env.CACHE_TTL_INR     || '3600', 10) * 1000,
};

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ─── Yahoo Finance Raw Headers (fallback) ─────────────────────────────────────
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Symbol Helpers ───────────────────────────────────────────────────────────
function toYahoo(symbol) {
  if (!symbol) return '';
  if (symbol.startsWith('^')) return symbol;
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return symbol;
  return symbol + '.NS';
}

// ─── Full Nifty 50 Stock List ─────────────────────────────────────────────────
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

// ─── Indian Market Indices ─────────────────────────────────────────────────────
const INDICES = [
  { symbol: '^NSEI',    name: 'Nifty 50',      shortName: 'NIFTY' },
  { symbol: '^BSESN',   name: 'BSE Sensex',    shortName: 'SENSEX' },
  { symbol: '^NSEBANK', name: 'Bank Nifty',    shortName: 'BANKNIFTY' },
  { symbol: '^CNXIT',   name: 'Nifty IT',      shortName: 'NIFTYIT' },
  { symbol: '^CNXAUTO', name: 'Nifty Auto',    shortName: 'NIFTYAUTO' },
  { symbol: '^CNXPHARMA', name: 'Nifty Pharma', shortName: 'NIFTYPHARMA' },
  { symbol: '^NSMIDCP150', name: 'Nifty Midcap 150', shortName: 'MIDCAP150' },
];

// ─── Sector Definitions ────────────────────────────────────────────────────────
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

// ─── Core: Fetch Single Quote ─────────────────────────────────────────────────
async function fetchQuoteSingle(yahooSymbol) {
  // Try yahoo-finance2 first
  if (yf) {
    try {
      const q = await yf.quote(yahooSymbol);
      if (q && q.regularMarketPrice) {
        const prevClose = q.regularMarketPreviousClose || q.chartPreviousClose || q.regularMarketPrice;
        return {
          yahooSymbol,
          shortName: q.shortName || q.longName || yahooSymbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange || (q.regularMarketPrice - prevClose),
          changePercent: q.regularMarketChangePercent || 0,
          volume: q.regularMarketVolume || 0,
          previousClose: prevClose,
          marketCap: q.marketCap || null,
          fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || null,
          fiftyTwoWeekLow: q.fiftyTwoWeekLow || null,
          currency: q.currency || 'INR',
          exchange: q.exchange || 'NSE',
          source: 'yf2',
        };
      }
    } catch (yfErr) {
      // fall through to raw axios
    }
  }

  // Fallback: raw axios Yahoo Finance v8 (chart endpoint)
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
    const res = await axios.get(url, { headers: YF_HEADERS, timeout: 8000 });
    const meta = res.data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;
    return {
      yahooSymbol,
      shortName:         meta.shortName || yahooSymbol,
      price:             meta.regularMarketPrice || 0,
      change:            (meta.regularMarketPrice - prevClose) || 0,
      changePercent:     prevClose ? ((meta.regularMarketPrice - prevClose) / prevClose) * 100 : 0,
      volume:            meta.regularMarketVolume || 0,
      previousClose:     prevClose || 0,
      // 52-week data from meta (Yahoo populates this in chart endpoint)
      fiftyTwoWeekHigh:  meta.fiftyTwoWeekHigh || meta.regularMarketDayHigh || null,
      fiftyTwoWeekLow:   meta.fiftyTwoWeekLow  || meta.regularMarketDayLow  || null,
      marketCap:         meta.marketCap || null,
      currency:          meta.currency || 'INR',
      exchange:          meta.exchangeName || 'NSE',
      source:            'axios-fallback',
    };
  } catch (e) {
    return null;
  }
}

// ─── Core: Fetch OHLCV History ────────────────────────────────────────────────
const RANGE_INTERVAL_MAP = {
  '1d': '1m', '5d': '15m', '1mo': '1h',
  '3mo': '1d', '6mo': '1d', '1y': '1wk',
  '2y': '1wk', '5y': '1mo', 'max': '1mo',
};

const VALID_INTERVALS = ['1m','2m','5m','15m','30m','60m','90m','1h','1d','5d','1wk','1mo','3mo'];

function sanitizeInterval(i) {
  return VALID_INTERVALS.includes(i) ? i : '1d';
}

async function fetchHistory(yahooSymbol, range = '5d', interval = null) {
  const safeInterval = sanitizeInterval(interval || RANGE_INTERVAL_MAP[range] || '1d');

  // Try yahoo-finance2 first
  if (yf) {
    try {
      const period1 = rangeToDate(range);
      const result = await yf.chart(yahooSymbol, {
        period1,
        interval: safeInterval,
      });
      const quotes = result?.quotes || [];
      const meta   = result?.meta  || {};
      const data = quotes
        .filter(q => q.open && q.close && q.open > 0)
        .map(q => ({
          time:   Math.floor(new Date(q.date).getTime() / 1000),
          open:   +q.open.toFixed(2),
          high:   +q.high.toFixed(2),
          low:    +q.low.toFixed(2),
          close:  +q.close.toFixed(2),
          volume: q.volume || 0,
        }));
      return { data, meta, interval: safeInterval, source: 'yf2' };
    } catch (e) {
      // fall through
    }
  }

  // Fallback: raw axios
  try {
    const url = range === 'max'
      ? `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${safeInterval}&range=max`
      : `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${safeInterval}&range=${range}`;

    const response = await axios.get(url, { headers: YF_HEADERS, timeout: 20000 });
    const result = response.data?.chart?.result?.[0];
    if (!result) throw new Error('No chart data returned');
    const timestamps = result.timestamp || [];
    const ohlcv = result.indicators?.quote?.[0] || {};
    const meta  = result.meta || {};
    const data = timestamps
      .map((t, i) => ({
        time:   t,
        open:   parseFloat(((ohlcv.open   || [])[i] || 0).toFixed(2)),
        high:   parseFloat(((ohlcv.high   || [])[i] || 0).toFixed(2)),
        low:    parseFloat(((ohlcv.low    || [])[i] || 0).toFixed(2)),
        close:  parseFloat(((ohlcv.close  || [])[i] || 0).toFixed(2)),
        volume: (ohlcv.volume || [])[i] || 0,
      }))
      .filter(d => d.open > 0 && d.close > 0 && d.time > 0);
    return { data, meta, interval: safeInterval, source: 'axios-fallback' };
  } catch (e) {
    throw new Error('History fetch failed: ' + e.message);
  }
}

function rangeToDate(range) {
  const map = {
    '1d': 1, '5d': 5, '1mo': 30, '3mo': 90,
    '6mo': 180, '1y': 365, '2y': 730, '5y': 1825, 'max': 7300,
  };
  const days = map[range] || 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ─── Parallel Quote Fetcher with Batching ────────────────────────────────────
async function fetchQuotesBatch(symbols, batchSize = 10, delay = 200) {
  const results = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(s => fetchQuoteSingle(s)));
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled' && r.value) results.push({ inputSymbol: batch[j], ...r.value });
    });
    if (i + batchSize < symbols.length) await new Promise(r => setTimeout(r, delay));
  }
  return results;
}

// ─── INR Exchange Rate ─────────────────────────────────────────────────────────
async function fetchInrRate() {
  const cacheKey = 'inr_rate';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Frankfurter API — free, no auth, no rate limits
    const res = await axios.get('https://api.frankfurter.app/latest?from=USD&to=INR', { timeout: 5000 });
    const rate = res.data?.rates?.INR;
    if (!rate) throw new Error('No INR rate in response');
    const data = { usdToInr: rate, baseCurrency: 'USD', targetCurrency: 'INR', source: 'frankfurter', timestamp: new Date().toISOString() };
    cacheSet(cacheKey, data, TTL.inr);
    return data;
  } catch (e) {
    // fallback — use a reasonable default
    console.warn('INR rate fetch failed, using fallback:', e.message);
    return { usdToInr: 83.5, baseCurrency: 'USD', targetCurrency: 'INR', source: 'fallback', timestamp: new Date().toISOString() };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
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
};
