require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '2mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
const marketRoutes = require('./routes/market');
const tradesRoutes = require('./routes/trades');
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');
const optionsRoutes = require('./routes/options');

app.use('/api/market', marketRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/options', optionsRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const blockchain = require('./blockchain');
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekday = day >= 1 && day <= 5;
  const marketOpen = isWeekday && (hours > 9 || (hours === 9 && minutes >= 15)) && (hours < 15 || (hours === 15 && minutes <= 30));

  res.json({
    status: 'ok',
    serverTime: now.toISOString(),
    istTime: ist.toISOString(),
    marketStatus: marketOpen ? 'OPEN' : 'CLOSED',
    marketMessage: marketOpen
      ? 'Market is OPEN (9:15 AM – 3:30 PM IST)'
      : isWeekday
        ? 'Market is CLOSED. Opens at 9:15 AM IST'
        : 'Market is CLOSED. Weekend.',
    blockchain: blockchain.getStats(),
  });
});

// ── SEBI Info endpoint ────────────────────────────────────────────────────────
app.get('/api/sebi/rules', (req, res) => {
  res.json({
    regulator: 'SEBI',
    website: 'https://www.sebi.gov.in',
    disclaimer: 'This is a paper trading simulation platform. No real money is involved. All trades are simulated for educational purposes only.',
    rules: [
      'Market hours: 9:15 AM to 3:30 PM IST, Monday to Friday',
      'Pre-market session: 9:00 AM to 9:15 AM IST',
      'Post-market session: 3:40 PM to 4:00 PM IST',
      'F&O contracts expire on last Thursday of month',
      'Equity settlement: T+1 (simulated)',
      'Risk disclosure must be accepted before trading',
      'Position limits apply based on subscription tier',
      'Circuit breakers: ±5%, ±10%, ±20% price bands',
      'Maximum 90% of portfolio in single stock (simulated)',
    ],
    circuitBreakerLevels: [
      { level: '5%', action: 'Trading halt for 15 minutes' },
      { level: '10%', action: 'Trading halt for 45 minutes' },
      { level: '20%', action: 'Trading halt for rest of the day' },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`🚀 BlockPaperTrade API running on http://localhost:${PORT}`);
  console.log(`⛓️  Blockchain initialized — Genesis block mined`);
  console.log(`📊 Market data: Yahoo Finance (NSE/BSE)`);
  console.log(`🔐 Auth & Subscription: Active`);
  console.log(`📋 SEBI Compliance: Enabled`);
});
