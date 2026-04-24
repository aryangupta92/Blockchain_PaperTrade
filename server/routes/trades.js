const express = require('express');
const router = express.Router();
const blockchain = require('../blockchain');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');

const DB_PATH = path.join(__dirname, '../data/users.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [] }; }
}
function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const isOptionSymbol = (s) => /\b(CE|PE)\b/.test(String(s || ''));

function updateHoldingsSigned(prevHoldings, symbol, side, qty, px) {
  const next = { ...(prevHoldings || {}) };
  const cur = next[symbol] || { quantity: 0, avgPrice: 0 };

  const quantity = Number(qty);
  const price = Number(px);
  if (!quantity || !price) return next;

  if (side === 'buy') {
    const newQty = Number(cur.quantity) + quantity;
    if (cur.quantity < 0) {
      if (newQty < 0) { next[symbol] = { ...cur, quantity: newQty }; return next; }
      if (newQty === 0) { delete next[symbol]; return next; }
      next[symbol] = { quantity: newQty, avgPrice: price };
      return next;
    }
    const newAvg = newQty > 0 ? ((cur.quantity * cur.avgPrice) + (quantity * price)) / newQty : price;
    next[symbol] = { quantity: newQty, avgPrice: newAvg };
    return next;
  }

  // sell
  const newQty = Number(cur.quantity) - quantity;
  if (cur.quantity > 0) {
    if (newQty > 0) { next[symbol] = { ...cur, quantity: newQty }; return next; }
    if (newQty === 0) { delete next[symbol]; return next; }
    next[symbol] = { quantity: newQty, avgPrice: price };
    return next;
  }

  if (cur.quantity <= 0) {
    if (newQty === 0) { delete next[symbol]; return next; }
    const curAbs = Math.abs(cur.quantity);
    const newAbs = Math.abs(newQty);
    const newAvg = ((curAbs * cur.avgPrice) + (quantity * price)) / newAbs;
    next[symbol] = { quantity: newQty, avgPrice: newAvg };
    return next;
  }

  return next;
}

// In-memory trade store (persists during server lifecycle)
let trades = [];

// ─── GET /api/trades ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    trades,
    count: trades.length,
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /api/trades ─────────────────────────────────────────────────────────
// Body: { type, symbol, quantity, price, orderType }
router.post('/', authMiddleware, (req, res) => {
  try {
    const { type, symbol, quantity, price, orderType = 'market' } = req.body;

    if (!type || !symbol || !quantity || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['buy', 'sell'].includes(type)) {
      return res.status(400).json({ error: 'type must be buy or sell' });
    }

    const qty = Number(quantity);
    const px = Number(price);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });
    if (!Number.isFinite(px) || px <= 0) return res.status(400).json({ error: 'Invalid price' });

    // ── Load user state from DB ─────────────────────────────────────────────
    const db = readDB();
    const idx = db.users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    const user = db.users[idx];
    if (!user.subscription || user.subscription.status !== 'active') {
      return res.status(403).json({ error: 'No active subscription' });
    }

    // ── Risk checks (paper-broker rules) ────────────────────────────────────
    const tradeValue = Number((qty * px).toFixed(2));
    const heldQty = Number(user.holdings?.[symbol]?.quantity || 0);

    if (type === 'buy') {
      if (user.balance < tradeValue) return res.status(400).json({ error: 'Insufficient balance' });
    } else {
      // allow option shorting, block stock shorting
      if (!isOptionSymbol(symbol) && heldQty < qty) {
        return res.status(400).json({ error: `Insufficient shares. Holding: ${heldQty}` });
      }
    }

    const tradeData = {
      type,
      symbol,
      quantity: qty,
      price: px,
      orderType,
      totalValue: tradeValue,
      tradeId: `TRADE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      executedAt: new Date().toISOString(),
      userId: req.user.id,
    };

    // Add to blockchain — returns the new Block
    const block = blockchain.addBlock(tradeData);

    // Store in array
    const trade = {
      ...tradeData,
      blockIndex: block.index,
      blockHash: block.hash,
      previousHash: block.previousHash,
      nonce: block.nonce,
      minedAt: block.timestamp,
    };
    trades.unshift(trade); // newest first

    // ── Persist user portfolio state (fixes cash balance drift) ─────────────
    user.balance = type === 'buy' ? Number((user.balance - tradeValue).toFixed(2)) : Number((user.balance + tradeValue).toFixed(2));
    user.holdings = updateHoldingsSigned(user.holdings, symbol, type, qty, px);
    user.trades = Array.isArray(user.trades) ? [trade, ...user.trades] : [trade];
    if (user.subscription?.maxTrades > 0) user.subscription.tradesUsed = (user.subscription.tradesUsed || 0) + 1;
    db.users[idx] = user;
    writeDB(db);

    res.status(201).json({
      success: true,
      trade,
      block: {
        index: block.index,
        hash: block.hash,
        previousHash: block.previousHash,
        nonce: block.nonce,
        timestamp: block.timestamp,
      },
    });
  } catch (err) {
    console.error('Trade execution error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/trades/blockchain ──────────────────────────────────────────────
router.get('/blockchain', (req, res) => {
  const chain = blockchain.chain.map((block) => ({
    index: block.index,
    timestamp: block.timestamp,
    tradeData: block.tradeData,
    previousHash: block.previousHash,
    hash: block.hash,
    nonce: block.nonce,
  }));

  const stats = blockchain.getStats();
  const validity = blockchain.isValid();

  res.json({ chain, stats, validity, timestamp: new Date().toISOString() });
});

// ─── GET /api/trades/verify ───────────────────────────────────────────────────
router.get('/verify', (req, res) => {
  const result = blockchain.isValid();
  const stats = blockchain.getStats();
  res.json({ ...result, stats, timestamp: new Date().toISOString() });
});

module.exports = router;
