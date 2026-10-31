'use strict';
/**
 * services/data/dhanMarketFeed.js
 *  
 * Live quote engine backed by the DhanHQ WebSocket stream.
 *
 * - One WS connection, up to 5000 instruments.
 * - Security-id keyed store merged across ticker/quote/full packets.
 * - `source` is always honest: DHAN (real tick), CACHED (last real tick) or
 * UNAVAILABLE (never seen) — the UI shows this as a badge.
 */

const binaryFeed = require('./binaryFeed');
const { resolvePairSmart, getIndexIds } = require('./instrumentMaster');
const dhanClient = require('./dhanClient');
const { getToken } = require('./dhanAuth');

const MAX_TICK_AGE = 15000; // 15s → quote is "cached"
const MAX_TICK_AGE_CLOSED = 12 * 60 * 60 * 1000;

const memoryStore = new Map(); // canonical symbol → normalized quote
const keyToSymbol = new Map(); // `SEGMENT:securityId` → canonical symbol
const lastTickAt = new Map(); // canonical symbol → ms
const staleness = new Map(); // canonical symbol → 'LIVE' | 'CACHED' | 'UNAVAILABLE'

let running = false;
let injStart = null;

function canonical(sym) {
  const s = String(sym || '').trim();
  if (!s) return s;
  const up = s.toUpperCase();
  if (up.startsWith('^')) return up; // indices
  if (up.endsWith('.NS') || up.endsWith('.BO')) return up; // exchange suffix
  return up.endsWith('.NS') ? up : up;
}

/** Normalize a binary packet into our canonical quote shape. */
function normalize(changed) {
  const symbol = keyToSymbol.get(changed.key);
  if (!symbol) return;
  const price = Number(changed.price);
  if (!isFinite(price) || price <= 0) return;

  const prev = memoryStore.get(symbol) || {};
  const next = {
    symbol,
    tradingSymbol: symbol,
    exchange: symbol.split(':')[0] === 'IDX_I' ? 'IDX' : (keyToSymbol.get(changed.key)?.includes('.BO') ? 'BSE' : 'NSE'),
    name: prev.name || symbol.replace('.NS', ''),
    price: +price.toFixed(2),
    prevClose: changed.prevClose ?? prev.prevClose ?? null,
    change: null, changePercent: null,
    open: changed.open ?? prev.open ?? null,
    high: changed.high ?? prev.high ?? null,
    low: changed.low ?? prev.low ?? null,
    volume: changed.volume ?? prev.volume ?? null,
    vwap: changed.atp ?? prev.vwap ?? null,
    bidPrice: changed.depth?.[0]?.bidPrice ?? prev.bidPrice ?? null,
    askPrice: changed.depth?.[0]?.askPrice ?? prev.askPrice ?? null,
    bidDepth: changed.depth?.map((d) => ({ price: d.bidPrice, quantity: d.bidQty, orders: d.bidOrders })) ?? prev.bidDepth ?? [],
    askDepth: changed.depth?.map((d) => ({ price: d.askPrice, quantity: d.askQty, orders: d.askOrders })) ?? prev.askDepth ?? [],
    openInterest: changed.openInterest ?? prev.openInterest ?? null,
    openInterestDay: changed.highOI ?? null,
    currency: 'INR',
    source: 'DHAN',
    freshness: 'LIVE',
    receivedAt: Date.now(),
  };

  if (next.prevClose != null) {
    next.change = +(next.price - next.prevClose).toFixed(2);
    next.changePercent = next.prevClose ? +(((next.price - next.prevClose) / next.prevClose) * 100).toFixed(2) : null;
  }
  memoryStore.set(symbol, next);
  lastTickAt.set(symbol, Date.now());
  staleness.set(symbol, 'LIVE');
}

function onPacket(changed) {
  if (!changed || changed.kind === 'prevClose' || changed.kind === 'oi') {
    // prevClose/OI-only packet: enrich the stored quote if present
    if (changed?.key) {
      const symbol = keyToSymbol.get(changed.key);
      if (symbol) {
        const prev = memoryStore.get(symbol);
        if (prev) {
          if (changed.kind === 'prevClose') { prev.prevClose = changed.prevClose; prev.prevOI = changed.prevOI; }
          if (changed.kind === 'oi') prev.openInterest = changed.openInterest;
          if (prev.price && prev.prevClose) {
            prev.change = +(prev.price - prev.prevClose).toFixed(2);
            prev.changePercent = +(((prev.price - prev.prevClose) / prev.prevClose) * 100).toFixed(2);
          }
          memoryStore.set(symbol, prev);
        }
      }
    }
    return;
  }
  normalize(changed);
}

function ageOk(symbol, windowMs) {
  const t = lastTickAt.get(symbol);
  return t != null && Date.now() - t <= windowMs;
}

function freshnessOf(symbol) {
  if (!memoryStore.has(symbol)) return 'UNAVAILABLE';
  if (ageOk(symbol, MAX_TICK_AGE)) return 'LIVE';
  if (ageOk(symbol, MAX_TICK_AGE_CLOSED)) return 'CACHED';
  return 'UNAVAILABLE';
}

/** Start the WS feed (idempotent). Returns connected state summary. */
async function start() {
  if (running) return binaryFeed.status();
  running = true;
  binaryFeed.onQuote(onPacket);
  try {
    await binaryFeed.connect();
    injStart = Date.now();
  } catch (e) {
    running = false;
    return { connected: false, reason: e.message, code: e.code };
  }
  return binaryFeed.status();
}

/** Subscribe to a list of symbols, resolving each to a Dhan security id. */
async function subscribe(symbols, mode = 'quote') {
  const resolved = [];
  for (const s of symbols) {
    const canon = canonical(s);
    const pair = await resolvePairSmart(s);
    if (!pair) continue;
    const key = `${pair.exchangeSegment}:${pair.securityId}`;
    keyToSymbol.set(key, canon);
    // pre-seed entry so freshness reads work before the first tick
    if (!memoryStore.has(canon) || staleness.get(canon) !== 'LIVE') staleness.set(canon, freshnessOf(canon));
    resolved.push({ symbol: canon, key, pair });
  }
  const count = await binaryFeed.subscribe(symbols.map((s) => canonical(s)), mode);
  return { resolved: resolved.length, subscribed: count };
}

/** Get a single live quote, subscribing on demand. Never fabricates a price. */
async function getQuote(symbol) {
  const canon = canonical(symbol);
  const cached = memoryStore.get(canon);
  if (cached && ageOk(canon, MAX_TICK_AGE)) {
    return { ...cached, freshness: 'LIVE', source: 'DHAN' };
  }

  // not live → try subscribing and waiting briefly for a first tick
  try {
    await binaryFeed.subscribe([canon], 'quote');
  } catch (e) {
    // auth issue etc — fall through to cached / rest
  }
  await new Promise((r) => setTimeout(r, 400));
  const fresh = memoryStore.get(canon);
  if (fresh && ageOk(canon, MAX_TICK_AGE)) return { ...fresh, freshness: 'LIVE', source: 'DHAN' };
  if (cached) return { ...cached, freshness: 'CACHED', source: 'DHAN-CACHED', ageMs: Date.now() - lastTickAt.get(canon) };

  // Last resort: one REST full-quote call (real data, no fabrication)
  try {
    const pair = await resolvePairSmart(symbol);
    if (pair) {
      const body = { [pair.exchangeSegment]: [String(pair.securityId)] };
      const res = await dhanClient.getFullQuotes(body);
      const payload = res?.data?.[pair.exchangeSegment]?.[0]?.last_price;
      if (payload) {
        const ohlc = res.data[pair.exchangeSegment][0].ohlc || {};
        const out = {
          symbol: canon, tradingSymbol: canon, name: canon.replace('.NS', ''),
          price: payload, prevClose: ohlc.close, open: ohlc.open, high: ohlc.high, low: ohlc.low,
          volume: res.data[pair.exchangeSegment][0].volume, source: 'DHAN-REST', freshness: 'LIVE',
        };
        if (out.prevClose) {
          out.change = +(out.price - out.prevClose).toFixed(2);
          out.changePercent = +(((out.price - out.prevClose) / out.prevClose) * 100).toFixed(2);
        }
        return out;
      }
    }
  } catch (e) { /* auth or limit */ }

  return {
    symbol: canon, tradingSymbol: canon, name: canon.replace('.NS', ''),
    price: null, source: 'UNAVAILABLE', freshness: 'UNAVAILABLE', error: 'No real data available',
  };
}

async function getQuotesBatch(symbols) {
  const out = [];
  const needSub = [];
  for (const s of symbols || []) {
    const canon = canonical(s);
    const cached = memoryStore.get(canon);
    if (cached && ageOk(canon, MAX_TICK_AGE)) out.push({ ...cached, freshness: 'LIVE' });
    else needSub.push(s);
  }
  if (needSub.length) {
    try { await binaryFeed.subscribe(needSub.map(canonical), 'quote'); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    for (const s of needSub) {
      const canon = canonical(s);
      const cached = memoryStore.get(canon);
      if (cached) out.push(ageOk(canon, MAX_TICK_AGE) ? { ...cached, freshness: 'LIVE' } : { ...cached, freshness: 'CACHED' });
    }
  }
  return out;
}

const getQuotesLive = getQuotesBatch;

/** Indices with their Dhan security ids (used by watchlist, header strip). */
function indexQuoteList() { return Object.entries(getIndexIds()).map(([sym, v]) => ({ symbol: sym, ...v })); }

function getProviderHealth() {
  const st = binaryFeed.status();
  const token = getToken();
  const dhanClient = require('./dhanClient');
  return {
    DHAN: {
      healthy: st.connected && !!token,
      connected: st.connected,
      hasToken: !!token,
      tokenMinutesLeft: token && token.expiresAt ? Math.max(0, Math.round((new Date(token.expiresAt).getTime() - Date.now()) / 60000)) : null,
      subscribed: st.subscribed,
      lastAgeMs: st.lastAgeMs,
      lastSymbols: Array.from(memoryStore.keys()).slice(0, 5),
      tracked: memoryStore.size,
      rateLimits: dhanClient.stats(),
      circuit: dhanClient.circuitSnapshot(),
      wsBlocked: st.blocked,
      wsAttempts: st.attempts,
      wsError: st.lastError,
    },
  };
}

module.exports = {
  start, subscribe, getQuote, getQuotesBatch, getQuotesLive,
  getProviderHealth, indexQuoteList, canonical, freshnessOf,
};