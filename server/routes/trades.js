const express = require('express');
const router = express.Router();
const blockchain = require('../blockchain');

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
router.post('/', (req, res) => {
  try {
    const { type, symbol, quantity, price, orderType = 'market' } = req.body;

    if (!type || !symbol || !quantity || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['buy', 'sell'].includes(type)) {
      return res.status(400).json({ error: 'type must be buy or sell' });
    }

    const tradeData = {
      type,
      symbol,
      quantity: Number(quantity),
      price: Number(price),
      orderType,
      totalValue: Number((quantity * price).toFixed(2)),
      tradeId: `TRADE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      executedAt: new Date().toISOString(),
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
