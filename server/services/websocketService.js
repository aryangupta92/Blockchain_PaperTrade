'use strict';
/**
 * websocketService.js — Real-time WebSocket Gateway v2
 * ─────────────────────────────────────────────────────────────────────────────
 * v2 Changes:
 *  - JWT verification on auth:join (security fix — no more spoofable userId)
 *  - Uses MarketDataProvider instead of raw Yahoo fetcher (provider abstraction)
 *  - Every broadcast includes freshness metadata (LIVE/DELAYED/STALE)
 *  - Alert checking on every tick — triggers alert:fired event
 *  - Heartbeat: pings client every 30s to detect silent disconnects
 *  - Connection logging with structured output
 */

const { Server }   = require('socket.io');
const jwt          = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { getQuotesBatch } = require('./marketDataProvider');
const orderService = require('./orderService');
const prisma       = new PrismaClient();

const POLLING_RATE_MS  = 500;    // Tick streaming frequency (sub-second)
const HEARTBEAT_MS     = 30000;  // Client ping interval
const JWT_SECRET       = process.env.JWT_SECRET || 'blocktrade-secret-key';

let io;
let pollingInterval  = null;
let heartbeatInterval = null;

// Track authenticated socket → userId mapping
const socketUserMap = new Map(); // socketId → userId

// ── Initialize ────────────────────────────────────────────────────────────────
function initialize(server) {
  io = new Server(server, {
    cors: {
      origin:      process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:  60000,
    pingInterval: 25000,
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
        .filter(r => r.startsWith('quote:'))
        .forEach(r => socket.leave(r));

      // Join new rooms — store canonical symbol
      const valid = symbols.slice(0, 50); // cap at 50 per client
      valid.forEach(symbol => socket.join(`quote:${symbol}`));

      console.log(`📈 [WS] Socket ${socket.id} subscribed to ${valid.length} symbols`);
    });

    socket.on('unsubscribe:quotes', (symbols) => {
      if (!Array.isArray(symbols)) return;
      symbols.forEach(symbol => socket.leave(`quote:${symbol}`));
    });

    socket.on('disconnect', (reason) => {
      socketUserMap.delete(socket.id);
      console.log(`🔌 [WS] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  startPollingLoop();
  startHeartbeat();
}

// ── Market Data Polling Loop ──────────────────────────────────────────────────
function startPollingLoop() {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    if (!io) return;

    // Collect all active quote subscription rooms
    const adapter    = io.sockets.adapter;
    const roomKeys   = Array.from(adapter.rooms.keys());
    const quoteRooms = roomKeys.filter(r => r.startsWith('quote:'));
    if (quoteRooms.length === 0) return;

    const symbols = quoteRooms.map(r => r.replace('quote:', ''));

    try {
      const quotes = await getQuotesBatch(symbols);

      quotes.forEach(quote => {
        if (!quote || !quote.tradingSymbol) return;
        // Broadcast tick to room — freshness metadata is included in quote object
        io.to(`quote:${quote.tradingSymbol}`).emit('quotes:update', quote);

        // Generate and broadcast synthetic Level 2 Market Depth
        const depth = generateLevel2Depth(quote.price, quote.volume);
        io.to(`quote:${quote.tradingSymbol}`).emit('depth:update', { symbol: quote.tradingSymbol, depth });
      });

      // Check alerts on every batch
      checkAlerts(quotes).catch(err => console.error('[WS] Alert check error:', err.message));

    } catch (err) {
      console.error('[WS] Polling error:', err.message);
    }
  }, POLLING_RATE_MS);
}

// ── Synthetic Level 2 Generator ─────────────────────────────────────────────
function generateLevel2Depth(ltp, volume) {
  const bids = [];
  const asks = [];
  let baseVol = volume > 0 ? Math.max(10, Math.floor(volume / 1000)) : 100;
  
  for (let i = 1; i <= 5; i++) {
    const spread = (ltp * 0.0005) * i; // 0.05% spread increments
    bids.push({ price: Number((ltp - spread).toFixed(2)), quantity: Math.floor(baseVol * Math.random() * i * 2) });
    asks.push({ price: Number((ltp + spread).toFixed(2)), quantity: Math.floor(baseVol * Math.random() * i * 2) });
  }
  return { bids, asks };
}

// ── Alert Checker ─────────────────────────────────────────────────────────────
async function checkAlerts(quotes) {
  if (!quotes.length) return;

  const symbols = quotes.map(q => q.tradingSymbol);

  // Load active alerts for the instruments in this batch
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
      // Mark as triggered
      await prisma.alert.update({
        where: { id: alert.id },
        data:  { status: 'TRIGGERED', triggeredAt: new Date(), currentValue: price }
      });

      // Notify the user's private room
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

module.exports = { initialize };
