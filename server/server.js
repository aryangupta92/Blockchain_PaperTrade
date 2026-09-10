'use strict';

require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const pinoHttp     = require('pino-http');
const pino         = require('pino');
const { rateLimit } = require('express-rate-limit');
const http         = require('http');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Security Headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Managed by frontend
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

// ── Body Parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Structured Request Logging (Observability) ────────────────────────────────
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, ignore: 'pid,hostname', translateTime: 'SYS:standard' }
  }
});
app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === '/api/system/health' } }));

// ── Global Rate Limiters ──────────────────────────────────────────────────────
// General API: 200 req/min per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Auth endpoints: 10 req/min per IP (brute force protection)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again in a minute.' },
});

// Order placement: 30 orders/min per IP
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Order rate limit exceeded. Max 30 orders per minute.' },
});

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/trades', orderLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
const marketRoutes       = require('./routes/market');
const tradesRoutes       = require('./routes/trades');
const authRoutes         = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');
const optionsRoutes      = require('./routes/options');
const watchlistRoutes    = require('./routes/watchlists');
const alertRoutes        = require('./routes/alerts');
const portfolioRoutes    = require('./routes/portfolio');
const systemRoutes       = require('./routes/system');
const journalRoutes      = require('./routes/journal');
const aiRoutes           = require('./routes/ai');
const screenerRoutes     = require('./routes/screener');
const traderControlRoutes = require('./routes/traderControl');

app.use('/api/market',       marketRoutes);
app.use('/api/trades',       tradesRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/options',      optionsRoutes);
app.use('/api/watchlists',   watchlistRoutes);
app.use('/api/alerts',       alertRoutes);
app.use('/api/portfolio',    portfolioRoutes);
app.use('/api/system',       systemRoutes);
app.use('/api/journal',      journalRoutes);
app.use('/api/ai',           aiRoutes);
app.use('/api/screener',     screenerRoutes);
app.use('/api/trader-control', traderControlRoutes);

// ── Legacy endpoints (backward compat) ────────────────────────────────────────
app.get('/api/health', (req, res) => res.redirect('/api/system/health'));
app.get('/api/sebi/rules', (req, res) => res.redirect('/api/system/sebi'));

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err.message, err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── HTTP Server + WebSockets ──────────────────────────────────────────────────
const server = http.createServer(app);
const websocketService = require('./services/websocketService');
websocketService.initialize(server);

server.listen(PORT, async () => {
  console.log(`\n🚀 BlockPaperTrade Platform v2.0`);
  console.log(`   API:       http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   DB:        SQLite (Prisma)`);

  // Restore blockchain from DB
  try {
    const blockchain       = require('./blockchain');
    const { PrismaClient } = require('@prisma/client');
    const prisma           = new PrismaClient();
    const allTrades        = await prisma.trade.findMany({ orderBy: { executedAt: 'asc' } });
    if (allTrades.length > 0) {
      blockchain.rebuild(allTrades);
      console.log(`   ⛓️  Blockchain: restored (${allTrades.length} trades)`);
    } else {
      console.log(`   ⛓️  Blockchain: genesis block mined`);
    }
  } catch (err) {
    console.error('   ⚠️  Blockchain restore failed:', err.message);
  }

  console.log(`\n   Rate limiting:  ✓ (200/min general, 10/min auth, 30/min orders)`);
  console.log(`   Security:       ✓ (Helmet, CORS, JWT)`);
  console.log(`   Market data:    Dhan (primary) → Yahoo (fallback)`);
  console.log(`\n   Ready.\n`);
});
