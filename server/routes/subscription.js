const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const blockchain = require('../blockchain');
const { PrismaClient } = require('@prisma/client');
const dhanApi = require('../services/dhanApi');
const prisma = new PrismaClient();

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
router.post('/purchase', authMiddleware, async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    // Delete existing trades and holdings for a fresh start
    await prisma.trade.deleteMany({ where: { userId: user.id } });
    await prisma.holding.deleteMany({ where: { userId: user.id } });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        planId: planId,
        balance: plan.virtualMoney
      }
    });

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
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: req.user.id },
      include: {
        trades: { orderBy: { executedAt: 'desc' } },
        holdings: { include: { instrument: true } }
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.planId === 'FREE' || user.balance <= 0) {
      return res.json({ active: false, reason: user.balance <= 0 ? 'balance_zero' : 'no_subscription' });
    }

    const plan = PLANS[user.planId];
    
    // --- LIVE DHAN INTEGRATION ---
    let dhanFunds = { availabelBalance: user.balance };
    try {
      dhanFunds = await dhanApi.getFundLimit();
    } catch (e) {
      console.warn('[Subscription] Dhan limit fetch failed:', e.message);
    }
    const liveBalance = dhanFunds.availabelBalance > 0 ? dhanFunds.availabelBalance : (dhanFunds.sodLimit || user.balance);
    
    // Transform holdings back to object format expected by frontend
    const holdingsMap = {};
    user.holdings.forEach(h => {
      holdingsMap[h.instrument?.tradingSymbol || h.instrumentId] = {
        quantity: h.quantity,
        avgPrice: h.avgPrice
      };
    });

    // Mock subscription object for UI compatibility
    const sub = {
      planId: user.planId,
      planName: plan.name,
      initialBalance: plan.virtualMoney,
      virtualBalance: liveBalance,
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      maxTrades: plan.maxTrades,
      tradesUsed: user.trades.length
    };

    res.json({
      active: true,
      subscription: sub,
      plan,
      balance: liveBalance,
      holdings: holdingsMap,
      trades: user.trades,
      tradesRemaining: sub.maxTrades < 0 ? -1 : sub.maxTrades - sub.tradesUsed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/subscription/deduct-trade ──────────────────────────────────────
router.post('/deduct-trade', authMiddleware, (req, res) => {
  // Ignored in new DB logic; trades are counted via DB records
  res.json({ success: true, tradesUsed: 0 });
});

module.exports = router;
