'use strict';
/**
 * websocketService.js — Real-time WebSocket Gateway v3 (Dhan/Zerodha parity)
 * ─────────────────────────────────────────────────────────────────────────────
 * v3 Changes:
 *  - Parallel quote fetching (no batching delays) — 200+ symbols in <200ms
 *  - Live cache bypass for WS ticks — always fresh data
 *  - Proper quote key canonicalization (RELIANCE.NS, ^NSEI, etc.)
 *  - Real-time depth from provider (not synthetic)
 *  - Sub-second tick streaming with proper backpressure handling
 *  - Connection stats logging
 */

const { Server }   = require('socket.io');
const jwt          = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { getQuotesLive } = require('./marketDataProvider');
const continuousSync = require('./data/continuousSync');
const orderService = require('./orderService');
const prisma       = new PrismaClient();

// The continuous sync daemon pushes every fresh batch here so subscribed
// clients get updates without polling.
let ioRef = null;
continuousSync.onTick((quotes) => {
  if (!ioRef || !quotes || !quotes.length) return;
  quotes.forEach((quote) => {
    if (!quote || !quote.tradingSymbol) return;
    ioRef.to(`quote:${quote.tradingSymbol}`).emit('quotes:update', quote);
    ioRef.to(`quote:${(quote.symbol || '').toUpperCase()}`).emit('quotes:update', quote);
  });
});

const POLLING_RATE_MS  = 200;    // 200ms = ~5 ticks/sec (Dhan-like)
const HEARTBEAT_MS     = 30000;
const JWT_SECRET       = process.env.JWT_SECRET || 'blocktrade-secret-key';

let io;
let pollingInterval  = null;
let heartbeatInterval = null;
let lastPollTime = 0;
let pollCount = 0;

// Track authenticated socket → userId mapping
const socketUserMap = new Map(); // socketId → userId

// ── Initialize ────────────────────────────────────────────────────────────────
function initialize(server) {
  ioRef = io = new Server(server, {
    cors: {
      origin:      process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:  60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  });

  // Inject io into OMS so it can push order fill events
  orderService.setIo(io);

  io.on('connection', (socket) => {
    console.log(`🔌 [WS] Client connected: ${socket.id} (${socket.handshake.address})`);

    // ── SECURE Auth: verify JWT before joining user room ──────────────────
    socket.on('auth:join', (token) => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId  = decoded.id || decoded.userId;
        if (!userId) return socket.emit('auth:error', 'Invalid token payload');

        socket.join(`user:${userId}`);
        socketUserMap.set(socket.id, userId);
        socket.emit('auth:ok', { userId });
        console.log(`🔐 [WS] Socket ${socket.id} authenticated as user ${userId.slice(0, 8)}…`);
      } catch (err) {
        console.warn(`⚠️  [WS] Auth failed for socket ${socket.id}: ${err.message}`);
        socket.emit('auth:error', 'Authentication failed');
      }
    });

    // ── Symbol subscriptions ──────────────────────────────────────────────
    socket.on('subscribe:quotes', (symbols) => {
      if (!Array.isArray(symbols)) return;

      // Leave previous quote rooms
      Array.from(socket.rooms)
        .filter((r) => r.startsWith('quote:'))
        .forEach((r) => socket.leave(r));

      const valid = symbols.slice(0, 200).map(canonicalSymbol); // cap at 200 per client
      valid.forEach((symbol) => socket.join(`quote:${symbol}`));

      console.log(`[WS] Socket ${socket.id} subscribed to ${valid.length} symbols`);

      // Instant snapshot from the sync cache (never upstream, never blocking).
      // Anything missing is fetched in the background lane and arrives via the
      // relay loop within a second or two.
      valid.forEach((sym) => {
        const q = continuousSync.cached(sym) || continuousSync.cached(sym.replace(/\.(NS|BO)$/, ''));
        if (q && q.price != null) socket.emit('quotes:update', q);
      });

      // warm the background lane for anything the cache does not have yet
      const missing = valid.filter((sym) => {
        const q = continuousSync.cached(sym) || continuousSync.cached(sym.replace(/\.(NS|BO)$/, ''));
        return !(q && q.price != null);
      });
      if (missing.length) {
        getQuotesLive(missing, true).catch(() => {});
      }
    });

    socket.on('unsubscribe:quotes', (symbols) => {
      if (!Array.isArray(symbols)) return;
      symbols.map(canonicalSymbol).forEach(symbol => socket.leave(`quote:${symbol}`));
    });

    socket.on('subscribe:depth', (symbols) => {
      if (!Array.isArray(symbols)) return;
      const valid = symbols.slice(0, 50).map(canonicalSymbol);
      valid.forEach(symbol => socket.join(`depth:${symbol}`));
    });

    socket.on('disconnect', (reason) => {
      socketUserMap.delete(socket.id);
      console.log(`🔌 [WS] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  startPollingLoop();
  startHeartbeat();
  
  // Log stats every 30 seconds
  setInterval(() => {
    if (io) {
      const rooms = io.sockets.adapter.rooms;
      const quoteRooms = Array.from(rooms.keys()).filter(r => r.startsWith('quote:'));
      const depthRooms = Array.from(rooms.keys()).filter(r => r.startsWith('depth:'));
      console.log(`📊 [WS Stats] ${io.engine.clientsCount} clients | ${quoteRooms.length} quote rooms | ${depthRooms.length} depth rooms | ${pollCount} polls/30s`);
      pollCount = 0;
    }
  }, 30000);
}

// ── Canonical symbol for rooms (matches provider output) ──────────────────────
function canonicalSymbol(sym) {
  if (!sym) return sym;
  const s = String(sym).trim();
  if (s.startsWith('^')) return s; // indices: ^NSEI, ^BSESN, ^NSEBANK
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s.toUpperCase();
  // Default to NSE for bare symbols
  return `${s.toUpperCase()}.NS`;
}

// ── Market Data Relay Loop ──────────────────────────────────────────────────
// The continuous sync daemon owns upstream fetching and pushes fresh quotes via
// onTick. This loop only RELAYS what is already in memory - it must never call
// the provider itself: firing 15 symbols every 300ms used to pile up hundreds
// of concurrent upstream calls and hang /market/quotes and /market/indices.
const lastEmittedState = new Map();

function startPollingLoop() {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(() => {
    if (!io) return;
    const start = Date.now();

    const adapter = io.sockets.adapter;
    const roomKeys = Array.from(adapter.rooms.keys());
    const quoteRooms = roomKeys.filter((r) => r.startsWith('quote:'));
    const depthRooms = roomKeys.filter((r) => r.startsWith('depth:'));
    if (quoteRooms.length === 0 && depthRooms.length === 0) return;

    const quoteSymbols = quoteRooms.map((r) => r.replace('quote:', ''));
    const depthSymbols = depthRooms.map((r) => r.replace('depth:', ''));
    const allSymbols = [...new Set([...quoteSymbols, ...depthSymbols])];

    // cache read only - zero upstream requests
    const quotes = [];
    for (const sym of allSymbols) {
      const q = continuousSync.cached(sym) || continuousSync.cached(sym.replace(/\.(NS|BO)$/, ''));
      if (q && q.price != null) quotes.push(q);
    }

    quotes.forEach((quote) => {
      if (!quote || !quote.tradingSymbol) return;
      const sym = quote.tradingSymbol;
      const stateKey = `${sym}:${quote.price}:${quote.volume}:${quote.bidPrice}`;
      if (lastEmittedState.get(sym) === stateKey) return; // no change since last tick
      lastEmittedState.set(sym, stateKey);

      io.to(`quote:${sym}`).emit('quotes:update', quote);
      io.to(`quote:${(quote.symbol || '').toUpperCase()}`).emit('quotes:update', quote);

      if (depthRooms.includes(`depth:${sym}`) && quote.bidPrice && quote.askPrice) {
        io.to(`depth:${sym}`).emit('depth:update', {
          symbol: sym,
          depth: {
            bids: quote.bidDepth || [],
            asks: quote.askDepth || [],
            spread: quote.askPrice - quote.bidPrice,
          },
        });
      }
    });

    if (quotes.length) checkAlerts(quotes).catch((err) => console.error('[WS] Alert check error:', err.message));

    pollCount++;
    const elapsed = Date.now() - start;
    if (elapsed > 400) console.warn(`[WS] Slow relay: ${elapsed}ms for ${quotes.length} symbols`);
    lastPollTime = Date.now();
  }, POLLING_RATE_MS);
}

// ── Alert Checker ─────────────────────────────────────────────────────────────
async function checkAlerts(quotes) {
  if (!quotes.length) return;

  const symbols = quotes.map(q => q.tradingSymbol);

  const instruments = await prisma.instrument.findMany({
    where: { tradingSymbol: { in: symbols } },
    select: { id: true, tradingSymbol: true }
  });
  const instrumentMap = new Map(instruments.map(i => [i.tradingSymbol, i.id]));

  const alerts = await prisma.alert.findMany({
    where: {
      status:       'ACTIVE',
      instrumentId: { in: Array.from(instrumentMap.values()) }
    }
  });

  if (!alerts.length) return;

  const quoteMap = new Map(quotes.map(q => [q.tradingSymbol, q]));

  for (const alert of alerts) {
    const instrumentId = alert.instrumentId;
    const instrument   = instruments.find(i => i.id === instrumentId);
    if (!instrument) continue;
    const quote = quoteMap.get(instrument.tradingSymbol);
    if (!quote || !quote.price) continue;

    let triggered = false;
    const price = quote.price;

    if (alert.type === 'PRICE_ABOVE' && price >= alert.triggerValue) triggered = true;
    if (alert.type === 'PRICE_BELOW' && price <= alert.triggerValue) triggered = true;
    if (alert.type === 'PCT_CHANGE'  && Math.abs(quote.changePercent || 0) >= alert.triggerValue) triggered = true;

    if (triggered) {
      await prisma.alert.update({
        where: { id: alert.id },
        data:  { status: 'TRIGGERED', triggeredAt: new Date(), currentValue: price }
      });

      io.to(`user:${alert.userId}`).emit('alert:fired', {
        alertId:   alert.id,
        type:      alert.type,
        message:   alert.message || `Alert triggered`,
        price,
        symbol:    instrument.tradingSymbol,
        timestamp: new Date().toISOString(),
      });

      console.log(`🔔 [Alert] ${alert.type} triggered for user ${alert.userId.slice(0, 8)} on ${instrument.tradingSymbol} @ ₹${price}`);
    }
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (io) io.emit('server:ping', { ts: Date.now() });
  }, HEARTBEAT_MS);
}

module.exports = { initialize, getIo: () => io };
