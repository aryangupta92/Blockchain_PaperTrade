const crypto = require('crypto');

// ─── Block ───────────────────────────────────────────────────────────────────
class Block {
  constructor(index, tradeData, previousHash = '0'.repeat(64)) {
    this.index = index;
    this.timestamp = new Date().toISOString();
    this.tradeData = tradeData;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    const raw =
      this.index +
      this.previousHash +
      this.timestamp +
      JSON.stringify(this.tradeData) +
      this.nonce;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // Simple proof-of-work: hash must start with `difficulty` zeros
  mine(difficulty = 2) {
    const target = '0'.repeat(difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }
}

// ─── Blockchain ───────────────────────────────────────────────────────────────
class Blockchain {
  constructor() {
    this.difficulty = 2;
    this.chain = [this._createGenesisBlock()];
  }

  _createGenesisBlock() {
    const genesis = new Block(
      0,
      {
        type: 'GENESIS',
        symbol: 'INIT',
        quantity: 0,
        price: 0,
        message: 'BlockPaperTrade Genesis Block',
      },
      '0'.repeat(64)
    );
    genesis.mine(this.difficulty);
    return genesis;
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(tradeData) {
    const prev = this.getLatestBlock();
    const block = new Block(this.chain.length, tradeData, prev.hash);
    block.mine(this.difficulty);
    this.chain.push(block);
    return block;
  }

  isValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      // Re-calculate hash and compare
      const recalculated = crypto
        .createHash('sha256')
        .update(
          current.index +
            current.previousHash +
            current.timestamp +
            JSON.stringify(current.tradeData) +
            current.nonce
        )
        .digest('hex');

      if (current.hash !== recalculated) {
        return { valid: false, invalidAt: i, reason: 'Hash mismatch' };
      }

      // Check chain linkage
      if (current.previousHash !== previous.hash) {
        return { valid: false, invalidAt: i, reason: 'Chain broken' };
      }
    }
    return { valid: true, invalidAt: null, reason: 'Chain intact' };
  }

  getStats() {
    const trades = this.chain.slice(1); // exclude genesis
    const buys = trades.filter((b) => b.tradeData.type === 'buy');
    const sells = trades.filter((b) => b.tradeData.type === 'sell');
    return {
      totalBlocks: this.chain.length,
      totalTrades: trades.length,
      totalBuys: buys.length,
      totalSells: sells.length,
      genesisHash: this.chain[0].hash,
      latestHash: this.getLatestBlock().hash,
    };
  }
}

// Singleton instance
const blockchainInstance = new Blockchain();

module.exports = blockchainInstance;
