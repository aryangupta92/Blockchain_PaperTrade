const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const blockchain = require('../blockchain');

const DB_PATH = path.join(__dirname, '../data/users.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [] }; }
}
function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── Subscription Plans (SEBI-compliant paper trading tiers) ──────────────────
const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 99,
    priceLabel: '₹99/month',
    virtualMoney: 50000,
    maxTrades: 50,
    features: ['₹50,000 Virtual Capital', '50 Paper Trades', 'Equity & F&O Access', 'Basic Charts', 'Blockchain Trade Records'],
    color: '#6366f1',
    badge: 'BEGINNER',
    description: 'Perfect for beginners learning the markets',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 299,
    priceLabel: '₹299/month',
    virtualMoney: 200000,
    maxTrades: 200,
    features: ['₹2,00,000 Virtual Capital', '200 Paper Trades', 'All Markets Access', 'Advanced Charts & Indicators', 'Option Chain', 'Portfolio Analytics', 'Blockchain NFT Receipts'],
    color: '#10b981',
    badge: 'POPULAR',
    description: 'For active traders who want more capital and trades',
  },
  expert: {
    id: 'expert',
    name: 'Expert',
    price: 999,
    priceLabel: '₹999/month',
    virtualMoney: 1000000,
    maxTrades: -1, // unlimited
    features: ['₹10,00,000 Virtual Capital', 'Unlimited Trades', 'All Markets + IPO Access', 'TradingView Advanced Charts', 'Full Option Chain with Greeks', 'F&O Strategy Builder', 'Blockchain Smart Contract Settlement', 'Priority Support'],
    color: '#f59e0b',
    badge: 'EXPERT',
    description: 'For serious traders simulating professional-level trading',
  },
};

// ── GET /api/subscription/plans ───────────────────────────────────────────────
router.get('/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

// ── POST /api/subscription/purchase ──────────────────────────────────────────
router.post('/purchase', authMiddleware, (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const db = readDB();
    const idx = db.users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    const subscription = {
      planId,
      planName: plan.name,
      purchasedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      virtualBalance: plan.virtualMoney,
      initialBalance: plan.virtualMoney,
      tradesUsed: 0,
      maxTrades: plan.maxTrades,
      status: 'active',
      transactionId: 'TXN-' + Date.now(),
    };

    db.users[idx].subscription = subscription;
    db.users[idx].balance = plan.virtualMoney;
    db.users[idx].holdings = {};
    db.users[idx].trades = [];
    writeDB(db);

    // Record subscription on blockchain
    blockchain.addBlock({
      type: 'SUBSCRIPTION',
      userId: req.user.id,
      planId,
      amount: plan.price,
      virtualMoney: plan.virtualMoney,
      transactionId: subscription.transactionId,
    });

    res.json({ success: true, subscription });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/subscription/status ─────────────────────────────────────────────
router.get('/status', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const sub = user.subscription;
  if (!sub) return res.json({ active: false, reason: 'no_subscription' });

  const now = new Date();
  if (new Date(sub.expiresAt) < now) {
    return res.json({ active: false, reason: 'expired', subscription: sub });
  }
  if (sub.maxTrades > 0 && sub.tradesUsed >= sub.maxTrades) {
    return res.json({ active: false, reason: 'trades_exhausted', subscription: sub });
  }
  if (user.balance <= 0) {
    return res.json({ active: false, reason: 'balance_zero', subscription: sub });
  }

  const plan = PLANS[sub.planId];
  res.json({
    active: true,
    subscription: sub,
    plan,
    balance: user.balance,
    holdings: user.holdings || {},
    trades: user.trades || [],
    tradesRemaining: sub.maxTrades < 0 ? -1 : sub.maxTrades - sub.tradesUsed,
  });
});

// ── POST /api/subscription/deduct-trade ──────────────────────────────────────
router.post('/deduct-trade', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });

  const sub = db.users[idx].subscription;
  if (!sub) return res.status(403).json({ error: 'No active subscription' });
  if (sub.maxTrades > 0) {
    db.users[idx].subscription.tradesUsed++;
  }
  writeDB(db);
  res.json({ success: true, tradesUsed: db.users[idx].subscription.tradesUsed });
});

module.exports = router;
