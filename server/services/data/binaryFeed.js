'use strict';
/**
 * services/data/binaryFeed.js
 *  
 * DhanHQ Live Market Feed WebSocket client + binary packet decoder.
 *
 * Streams real tick-by-tick data (Ticker / Quote / Full + 5-level depth).
 * All packets are little-endian per Dhan docs; see the struct tables in
 * dhan-api-docs.md.
 *
 * Usage:
 * const feed = await startFeed();
 * feed.subscribe(['^NSEI','RELIANCE','TCS'], 'quote' | 'full' | 'ticker');
 * feed.onQuote((quote) => { ... });
 */

const WebSocket = require('ws');
const { requireToken, DhanAuthError } = require('./dhanAuth');
const { resolvePairSmart, getIndexIds } = require('./instrumentMaster');

const WS_URL = 'wss://api-feed.dhan.co';
const FEED_REQUEST = { DISCONNECT: 12, SUB_TICKER: 15, SUB_QUOTE: 17, SUB_FULL: 21, SUB_DEPTH: 23 };
const FEED_RESPONSE = { INDEX: 1, TICKER: 2, QUOTE: 4, OI: 5, PREV_CLOSE: 6, MARKET_STATUS: 7, FULL: 8, DISCONNECT: 50 };

// Packet readers (little-endian)  
const rd = {
  u8: (b, o) => b[o],
  i16: (b, o) => b.readInt16LE(o),
  u32: (b, o) => b.readUInt32LE(o),
  i32: (b, o) => b.readInt32LE(o),
  f32: (b, o) => b.readFloatLE(o),
};

function decodeHeader(b) {
  return {
    responseCode: b[0],
    messageLength: b.readUInt16LE(1),
    exchangeSegment: b[3],
    securityId: String(b.readUInt32LE(4)),
  };
}

/** Decode into normalized quote objects. */
function decodePacket(buf, ctx) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const h = decodeHeader(buf);
  const key = `${ctx.segmentOf(h.exchangeSegment)}:${h.securityId}`;

  switch (h.responseCode) {
    case FEED_RESPONSE.TICKER:
      return { key, kind: 'ticker', price: rd.f32(buf, 8), ltt: rd.i32(buf, 12) };

    case FEED_RESPONSE.PREV_CLOSE:
      return { key, kind: 'prevClose', prevClose: rd.f32(buf, 8), prevOI: rd.i32(buf, 12) };

    case FEED_RESPONSE.OI:
      return { key, kind: 'oi', openInterest: rd.i32(buf, 8) };

    case FEED_RESPONSE.QUOTE:
      return {
        key, kind: 'quote',
        price: rd.f32(buf, 8),
        lastTradedQty: rd.i16(buf, 12),
        ltt: rd.i32(buf, 14),
        atp: rd.f32(buf, 18),
        volume: rd.i32(buf, 22),
        totalSellQty: rd.i32(buf, 26),
        totalBuyQty: rd.i32(buf, 30),
        open: rd.f32(buf, 34),
        close: rd.f32(buf, 38),
        high: rd.f32(buf, 42),
        low: rd.f32(buf, 46),
      };

    case FEED_RESPONSE.FULL: {
      const depth = [];
      for (let i = 0; i < 5; i++) {
        const o = 62 + i * 20;
        depth.push({
          bidQty: rd.i32(buf, o), askQty: rd.i32(buf, o + 4),
          bidOrders: rd.i16(buf, o + 8), askOrders: rd.i16(buf, o + 10),
          bidPrice: rd.f32(buf, o + 12), askPrice: rd.f32(buf, o + 16),
        });
      }
      return {
        key, kind: 'full',
        price: rd.f32(buf, 8),
        lastTradedQty: rd.i16(buf, 12),
        ltt: rd.i32(buf, 14),
        atp: rd.f32(buf, 18),
        volume: rd.i32(buf, 22),
        totalSellQty: rd.i32(buf, 26),
        totalBuyQty: rd.i32(buf, 30),
        openInterest: rd.i32(buf, 34),
        highOI: rd.i32(buf, 38),
        lowOI: rd.i32(buf, 42),
        open: rd.f32(buf, 46),
        close: rd.f32(buf, 50),
        high: rd.f32(buf, 54),
        low: rd.f32(buf, 58),
        depth,
      };
    }

    case FEED_RESPONSE.INDEX:
      return { key, kind: 'index', price: rd.f32(buf, 8) };

    case FEED_RESPONSE.MARKET_STATUS:
      return { key, kind: 'marketStatus', exchangeSegment: h.exchangeSegment };

    case FEED_RESPONSE.DISCONNECT:
      return { key, kind: 'disconnect', code: rd.i16(buf, 8) };

    default:
      return null;
  }
}

const SEGMENT_NAME = { 0: 'IDX_I', 1: 'NSE_EQ', 2: 'NSE_FNO', 4: 'BSE_EQ', 5: 'MCX_COMM', 8: 'BSE_FNO' };

// Feed state  
let ws = null;
let connecting = null;
let subscribed = new Map(); // key -> { symbol, exchangeSegment, securityId, mode }
let lastByKey = new Map(); // key -> latest normalized quote (with prevClose merged)
let quoteListeners = [];
let statusListeners = [];
let notifyCb = null;
let lastTickAt = null;

// ── Reconnect policy ──────────────────────────────────────────────────────────
// A 429 on the upgrade means "IP blocked". Retrying every 3s only extends the
// block, so back off aggressively and stop after a bounded number of attempts,
// leaving an explicit status for the UI to show.
let connectAttempts = 0;
let wsBlocked = false;
let lastError = null;
const MAX_CONNECT_ATTEMPTS = parseInt(process.env.DHAN_WS_MAX_ATTEMPTS || '5', 10);
const BASE_BACKOFF_MS = 5000;

function resetReconnect() {
  connectAttempts = 0;
  wsBlocked = false;
  lastError = null;
}

function computeBackoffMs() {
  const exp = Math.min(MAX_CONNECT_ATTEMPTS - 1, Math.max(0, connectAttempts - 1));
  const base = BASE_BACKOFF_MS * Math.pow(2, exp);
  return Math.min(60000, base) + Math.floor(Math.random() * 1500);
}

function httpStatusFromError(e) {
  const m = /Unexpected server response: (\d+)/.exec((e && e.message) || '');
  return m ? Number(m[1]) : null;
}

function onQuote(cb) { quoteListeners.push(cb); return () => { quoteListeners = quoteListeners.filter((l) => l !== cb); }; }
function onStatus(cb) { statusListeners.push(cb); return () => { statusListeners = statusListeners.filter((l) => l !== cb); }; }
function setNotifier(cb) { notifyCb = typeof cb === 'function' ? cb : null; }

/** Fire a UI notification only if a notifier was registered. */
function notify(note) {
  if (typeof notifyCb === 'function') {
    try { notifyCb(note); } catch (e) { /* never let a notifier break the socket */ }
  }
}

function emitStatus(patch) { statusListeners.forEach((l) => { try { l(patch); } catch {} }); }

function status() {
  return {
    connected: !!ws && ws.readyState === WebSocket.OPEN,
    connecting: !!connecting,
    subscribed: subscribed.size,
    lastAgeMs: lastTickAt ? Date.now() - lastTickAt : null,
    attempts: connectAttempts,
    blocked: wsBlocked,
    lastError,
  };
}

// Connection
async function connect(force = false) {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  if (connecting) return connecting;

  // After repeated failures stop hammering Dhan - an IP-level block is the
  // likely cause and more attempts only extend it. The status endpoint exposes
  // `blocked` so the UI can tell the user to wait.
  if (!force && wsBlocked && connectAttempts >= MAX_CONNECT_ATTEMPTS) {
    const e = new Error(
      `Dhan refused the WebSocket ${connectAttempts} times (${lastError || 'rate limited'}). ` +
      'Waiting before retrying to avoid extending an IP-level block.'
    );
    e.code = 'WS_BLOCKED';
    throw e;
  }

  connectAttempts++;
  connecting = (async () => {
    const t = requireToken();
    const url = `${WS_URL}?version=2&token=${encodeURIComponent(t.token)}&clientId=${encodeURIComponent(t.clientId || process.env.DHAN_CLIENT_ID)}&authType=2`;

    try {
      const sock = await new Promise((resolve, reject) => {
        const s = new WebSocket(url);
        s.on('message', (data) => handleMessage(data));
        s.on('open', () => resolve(s));
        s.on('error', (e) => {
          const code = httpStatusFromError(e);
          reject(new DhanAuthError(
            code === 429
              ? 'Dham WebSocket 429: too many requests from this IP - client id is temporarily blocked'
              : `Dhan feed connection failed: ${e.message}`,
            code === 429 ? 'CIRCUIT_OPEN' : 'AUTH_REQUIRED'
          ));
        });
      });
      ws = sock;

      sock.on('close', () => {
        emitStatus({ connected: false, reason: 'closed' });
        ws = null; connecting = null;
        notify({ title: 'Dhan feed disconnected', body: 'Live prices paused - retrying automatically', level: 'warn' });
        scheduleReconnect();
      });

      // heartbeat - Dhan pings every 10s and drops connections after 40s of silence
      setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.ping();
      }, 10000).unref?.();

      // successful connection resets the failure counter
      resetReconnect();
      emitStatus({ connected: true });
      console.log('[DhanFeed] WebSocket connected');
      return sock;
    } catch (e) {
      connecting = null;
      lastError = e.message;
      const code = httpStatusFromError(e);
      // Only a 429 blocks; auth problems should not count toward the block logic
      if (e.code === 'CIRCUIT_OPEN' || code === 429) {
        wsBlocked = true;
        console.warn(`[DhanFeed] WebSocket upgrade rate-limited (attempt ${connectAttempts}/${MAX_CONNECT_ATTEMPTS}). Blocked=${wsBlocked}`);
      }
      throw e;
    }
  })();

  return connecting;
}

/** Exponential backoff, then reconnect + resubscribe. */
function scheduleReconnect() {
  const delay = computeBackoffMs();
  console.log(`[DhanFeed] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${connectAttempts}/${MAX_CONNECT_ATTEMPTS})`);
  setTimeout(() => {
    connect().then(() => resubscribeAll()).catch(() => { /* status reflects the failure */ });
  }, delay);
}

function handleMessage(data) {
  try {
    const parsed = decodePacket(data, { segmentOf: (s) => SEGMENT_NAME[s] || '' });
    if (!parsed) return;
    if (parsed.kind === 'disconnect') {
      emitStatus({ connected: false, reason: `dhan-close-code-${parsed.code}` });
      return;
    }

    lastTickAt = Date.now();
    // merge with prevClose / OI packets we saw earlier for this instrument
    const prev = lastByKey.get(parsed.key) || {};
    const merged = { ...prev, ...parsed, receivedAt: lastTickAt };

    if (parsed.kind === 'prevClose') { merged.prevClose = parsed.prevClose; merged.prevOI = parsed.prevOI; }
    if (parsed.kind === 'oi') { merged.openInterest = parsed.openInterest; }

    const price = merged.price ?? prev.price;
    const prevClose = merged.prevClose ?? prev.prevClose;
    const enriched = {
      ...merged,
      price,
      prevClose,
      change: price != null && prevClose ? +(price - prevClose).toFixed(2) : null,
      changePercent: price != null && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null,
      dayHigh: merged.high ?? prev.high,
      dayLow: merged.low ?? prev.low,
      volume: merged.volume ?? prev.volume,
      depth: merged.depth ?? prev.depth ?? [],
    };
    lastByKey.set(parsed.key, enriched);

    quoteListeners.forEach((l) => { try { l(enriched); } catch (e) {} });
  } catch (e) { /* never crash on a bad packet */ }
}

// Subscription  
function sendSub(code, list) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !list.length) return;
  for (let i = 0; i < list.length; i += 100) {
    ws.send(JSON.stringify({
      RequestCode: code,
      InstrumentCount: list.length - i < 100 ? list.length - i : 100,
      InstrumentList: list.slice(i, i + 100).map((x) => ({ ExchangeSegment: x.exchangeSegment, SecurityId: x.securityId })),
    }));
  }
}

async function subscribe(symbols, mode = 'quote') {
  await connect();
  const resolved = [];
  for (const s of symbols) {
    const pair = await resolvePairSmart(s);
    if (!pair) continue;
    const key = `${pair.exchangeSegment}:${pair.securityId}`;
    subscribed.set(key, { ...pair, symbol: s, mode, key });
    resolved.push(pair);
  }
  const code = mode === 'full' ? FEED_REQUEST.SUB_FULL : mode === 'ticker' ? FEED_REQUEST.SUB_TICKER : FEED_REQUEST.SUB_QUOTE;
  sendSub(code, resolved);
  return resolved.length;
}

function unsubscribe(symbols) {
  const list = [];
  symbols.forEach((s) => {
    for (const [k, v] of subscribed) {
      if (v.symbol === s || k === s) { list.push({ exchangeSegment: v.exchangeSegment, securityId: v.securityId }); subscribed.delete(k); }
    }
  });
  sendSub(FEED_REQUEST.DISCONNECT === 12 ? 16 : 16, list); // 16/18/22 = unsub ticker/quote/full
  return list.length;
}

function resubscribeAll() {
  if (!subscribed.size) return;
  const byMode = { quote: [], full: [], ticker: [] };
  subscribed.forEach((v) => (byMode[v.mode] = byMode[v.mode] || []).push({ exchangeSegment: v.exchangeSegment, securityId: v.securityId }));
  sendSub(FEED_REQUEST.SUB_TICKER, byMode.ticker);
  sendSub(FEED_REQUEST.SUB_QUOTE, byMode.quote);
  sendSub(FEED_REQUEST.SUB_FULL, byMode.full);
}

function getLast(key) { return lastByKey.get(key); }
function getAll() { return Array.from(lastByKey.values()); }
function disconnect() { try { ws?.close(); } catch {} ws = null; }
function resetFeed() { resetReconnect(); subscribed.clear(); lastByKey.clear(); lastTickAt = null; }

module.exports = {
  connect, subscribe, unsubscribe, resubscribeAll, disconnect, resetFeed,
  onQuote, onStatus, setNotifier, getLast, getAll, status,
  decodePacket, FEED_REQUEST, FEED_RESPONSE,
};
