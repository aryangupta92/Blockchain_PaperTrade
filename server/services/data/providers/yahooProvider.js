'use strict';
/**
 * services/data/providers/yahooProvider.js
 * ---------------------------------------------------------------------------
 * FREE, NO-KEY, NO-ACCOUNT Indian market data. Works for every user of the
 * platform even when nobody owns a Dhan account - which is the whole point.
 *
 * Verified endpoints (see scripts/test_yahoo_capabilities.js):
 *   GET /v8/finance/chart/{symbol}?interval&range     -> quote meta + OHLCV
 *   GET /v1/finance/search?q=                         -> symbol search
 *   GET /v1/finance/screener/predefined/saved         -> gainers/losers/most-active
 *
 * Symbols: NSE "RELIANCE.NS" | BSE "RELIANCE.BO" | index "^NSEI"
 */

const axios = require('axios');

const BASE = 'https://query1.finance.yahoo.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Canonical Yahoo symbol. */
function toYahoo(symbol) {
  if (!symbol) return '';
  const s = String(symbol).trim();
  if (s.startsWith('^')) return s.toUpperCase();
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s.toUpperCase();
  if (/^(NIFTY|BANKNIFTY|SENSEX|CNX[A-Z]+|NSEMDCP\d+|INDIAVIX|BANKEX|CRSLDX)/i.test(s)) return '^' + s.toUpperCase();
  return s.toUpperCase() + '.NS';
}

// ── Symbol resolution ─────────────────────────────────────────────────────────
// Yahoo returns 404 for symbols that were renamed or demerged (TATAMOTORS,
// LTIM, ...). Hardcoding aliases never keeps up, so unknown symbols are
// resolved through Yahoo's own search endpoint and the result is cached.
const resolvedCache = new Map();  // bare symbol -> working yahoo symbol
const SYMBOL_ALIASES = {
  // Curated aliases for renames/demergers verified against Yahoo on 2026-10-10.
  // The search-based resolver below covers everything else automatically.
  '^CNXFINANCE': '^CNXFIN',              // Nifty Financial Services
  '^NSMIDCP150': 'NIFTY_MID_SELECT.NS',  // Nifty Midcap Select
  'TATAMOTORS.NS': 'TMPV.NS',            // Tata Motors demerger (Oct 2025)
  'TATAMTRDVR.NS': 'TMPV.NS',
  'MOTHERSUMI.NS': 'MOTHERSON.NS',
  'MINDTREE.NS': 'LTIM.NS',
};

async function resolveYahooSymbol(symbol, force = false) {
  const direct = toYahoo(symbol);
  if (SYMBOL_ALIASES[direct.toUpperCase()]) return SYMBOL_ALIASES[direct.toUpperCase()];

  const bare = String(symbol).toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!force && resolvedCache.has(bare)) return resolvedCache.get(bare);
  if (!force && resolvedCache.has('!' + bare)) return direct;

  try {
    const hits = await search(bare);
    const pick = hits.find((h) => h.symbol === direct)
      || hits.find((h) => h.symbol.startsWith(bare))
      || hits[0];
    if (pick && pick.symbol && pick.symbol !== direct) {
      resolvedCache.set(bare, pick.symbol);
      resolvedCache.delete('!' + bare);
      console.log(`[yahoo] symbol remap: ${direct} -> ${pick.symbol}`);
      return pick.symbol;
    }
  } catch {}
  if (force) { resolvedCache.delete('!' + bare); return direct; }
  resolvedCache.set('!' + bare, true); // negative cache
  return direct;
}

// Yahoo 429s on sustained bursts, so requests go through per-lane accounting:
// interactive requests and background backfills each have their own budget, so
// a 63-symbol sync cycle can never occupy the slots a user-facing call needs
// (that overlap is what used to make /indices and /movers hang for 45s+).
const MIN_GAP_MS = parseInt(process.env.YAHOO_MIN_GAP_MS || '60', 10);
const INTERACTIVE_CONC = parseInt(process.env.YAHOO_CONCURRENCY || '6', 10);
const BACKGROUND_CONC = parseInt(process.env.YAHOO_BACKGROUND_CONCURRENCY || '2', 10);

const lanes = {
  interactive: { inFlight: 0, waiters: [] },
  background: { inFlight: 0, waiters: [] },
};
let lastStartAt = 0;
const stats = { calls: 0, errors: 0, rateLimited: 0, lastError: null, lastLatencyMs: null, avgMs: null };

/** Acquire a slot in the given lane. `background: true` uses the small lane. */
async function acquireSlot(background = false) {
  const lane = lanes[background ? 'background' : 'interactive'];
  const limit = background ? BACKGROUND_CONC : INTERACTIVE_CONC;
  return new Promise((resolve) => {
    const tryGo = () => {
      if (lane.inFlight >= limit) { lane.waiters.push(tryGo); return; }
      // a shared start gap keeps burst pressure on Yahoo low
      const gap = Date.now() - lastStartAt;
      if (gap < MIN_GAP_MS) { setTimeout(tryGo, MIN_GAP_MS - gap); return; }
      lane.inFlight++; lastStartAt = Date.now();
      resolve();
    };
    tryGo();
  });
}
function releaseSlot(background = false) {
  const lane = lanes[background ? 'background' : 'interactive'];
  lane.inFlight--;
  const next = lane.waiters.shift();
  if (next) next();
}

async function fetchJson(url, background = false) {
  await acquireSlot(background);
  const t = Date.now();
  try {
    stats.calls++;
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 15000,
    });
    stats.lastLatencyMs = Date.now() - t;
    stats.avgMs = stats.avgMs ? (stats.avgMs * 0.9 + stats.lastLatencyMs * 0.1) : stats.lastLatencyMs;
    return r.data;
  } catch (e) {
    stats.errors++;
    stats.lastError = e.response?.status ? `HTTP ${e.response.status}` : e.message;
    if (e.response?.status === 429) stats.rateLimited++;
    throw e;
  } finally {
    releaseSlot(background);
  }
}

// ── Quote ─────────────────────────────────────────────────────────────────────
/**
 * Single real quote, normalised. `source` is always 'YAHOO' and freshness
 * reflects the market session (LIVE during NSE hours, CLOSED otherwise).
 */
async function getQuote(symbol, range = '1d', interval = '5m', background = false) {
  const direct = toYahoo(symbol);
  let y = await resolveYahooSymbol(symbol);
  let d = await chartRequest(y, range, interval, background);

  // 404 -> resolve through search and retry once
  if (!d) {
    const alt = await resolveYahooSymbol(symbol, true);
    if (alt && alt !== y) {
      y = alt;
      d = await chartRequest(y, range, interval, background);
    }
  }

  const res = d?.chart?.result?.[0];
  const m = res?.meta;
  if (!m) return null;

  const price = m.regularMarketPrice ?? m.chartPreviousClose ?? null;
  const prevClose = m.chartPreviousClose ?? m.previousClose ?? null;
  return {
    symbol: String(symbol).toUpperCase(),
    tradingSymbol: y,
    name: m.shortName || m.longName || symbol,
    exchange: m.exchangeName || (y.endsWith('.BO') ? 'BSE' : 'NSE'),
    price,
    prevClose,
    change: price != null && prevClose ? +(price - prevClose).toFixed(2) : null,
    changePercent: price != null && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null,
    open: m.regularMarketOpen ?? null,
    high: m.regularMarketDayHigh ?? null,
    low: m.regularMarketDayLow ?? null,
    volume: m.regularMarketVolume ?? null,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    currency: m.currency || 'INR',
    source: 'YAHOO',
    freshness: isMarketOpen() ? 'LIVE' : 'CLOSED',
    receivedAt: Date.now(),
  };
}

/** One chart call; returns null (instead of throwing) when Yahoo says 404. */
async function chartRequest(yahooSymbol, range, interval, background = false) {
  try {
    return await fetchJson(`${BASE}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`, background);
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

/**
 * Batch quote. Yahoo has no multi-symbol v8 call, so this fans out through the
 * request lanes. `background: true` uses the small lane so a backfill can never
 * starve a user-facing call.
 */
async function getQuotes(symbols, background = false) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const unique = Array.from(new Set(list.map((s) => String(s).toUpperCase())));
  const out = [];
  const settled = await Promise.allSettled(unique.map((s) => getQuote(s, '1d', '5m', background)));
  unique.forEach((s, idx) => {
    const r = settled[idx];
    if (r.status === 'fulfilled' && r.value) out.push(r.value);
    else {
      out.push({ symbol: s, tradingSymbol: toYahoo(s), price: null, source: 'UNAVAILABLE', freshness: 'UNAVAILABLE' });
    }
  });
  return out;
}

// ── Candles ───────────────────────────────────────────────────────────────────
/** OHLCV bars. `interval`/`range` follow Yahoo's vocabulary. */
async function getCandles(symbol, range = '5d', interval = '5m') {
  let y = await resolveYahooSymbol(symbol);
  let d = await chartRequest(y, range, interval);
  if (!d) {
    const alt = await resolveYahooSymbol(symbol, true);
    if (alt && alt !== y) { y = alt; d = await chartRequest(y, range, interval); }
  }
  const res = d?.chart?.result?.[0];
  if (!res?.timestamp?.length) return { data: [], meta: res?.meta || {} };

  const q = res.indicators?.quote?.[0] || {};
  const data = res.timestamp.map((t, i) => ({
    time: t,
    open: +((q.open?.[i] ?? 0).toFixed(2)),
    high: +((q.high?.[i] ?? 0).toFixed(2)),
    low: +((q.low?.[i] ?? 0).toFixed(2)),
    close: +((q.close?.[i] ?? 0).toFixed(2)),
    volume: q.volume?.[i] || 0,
  })).filter((b) => b.open > 0 && b.close > 0);
  return { data, meta: res.meta, source: 'YAHOO' };
}

// ── Search ────────────────────────────────────────────────────────────────────
async function search(query) {
  const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
  const d = await fetchJson(url);
  return (d.quotes || [])
    .filter((i) => ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(i.quoteType))
    .map((i) => ({
      symbol: i.symbol,
      shortname: i.shortname || i.longname || i.symbol,
      exchange: i.exchDisp || i.exchange,
      type: i.quoteType,
      exchangeDisplay: i.exchange,
      score: i.score,
    }))
    .filter((r) => r.symbol.endsWith('.NS') || r.symbol.endsWith('.BO') || r.symbol.startsWith('^'))
    .slice(0, 8);
}

// ── Screener ──────────────────────────────────────────────────────────────────
// Yahoo's predefined screens (day_gainers etc.) are US-market, so for an Indian
// platform the truthful approach is to rank the actual NSE universe we already
// fetch. That gives real quotes AND Indian symbols.
async function screener(kind = 'gainers', count = 15) {
  const universe = require('../../marketDataProvider').NIFTY50;
  const rows = await getQuotes(universe);
  const valid = rows.filter((r) => r.price != null && r.price > 0 && r.changePercent != null);

  const sorted =
    kind === 'losers'
      ? [...valid].sort((a, b) => a.changePercent - b.changePercent)
      : kind === 'active'
        ? [...valid].sort((a, b) => (b.volume || 0) - (a.volume || 0))
        : [...valid].sort((a, b) => b.changePercent - a.changePercent);

  return sorted.slice(0, count).map((r) => ({
    symbol: r.symbol,
    tradingSymbol: r.tradingSymbol,
    shortName: r.name || r.symbol,
    price: r.price,
    change: r.change,
    changePercent: r.changePercent,
    volume: r.volume || 0,
    marketCap: null,
    source: 'YAHOO',
  }));
}

// ── Health ────────────────────────────────────────────────────────────────────
function isMarketOpen() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 555 && mins <= 930; // 09:15 - 15:30 IST
}

function health() {
  return {
    provider: 'YAHOO',
    healthy: stats.errors < Math.max(3, stats.calls * 0.5),
    calls: stats.calls,
    errors: stats.errors,
    rateLimited: stats.rateLimited,
    lastLatencyMs: stats.lastLatencyMs,
    lastError: stats.lastError,
    gapMs: MIN_GAP_MS,
  };
}

module.exports = {
  toYahoo, getQuote, getQuotes, getCandles, search, screener, health, isMarketOpen,
};
