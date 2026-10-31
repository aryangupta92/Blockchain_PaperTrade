'use strict';
/**
 * scripts/train_models.js — train all Phase-3 models from the candle store.
 * Usage: node scripts/train_models.js [SYMBOL] [TIMEFRAME]
 * Defaults: NIFTY ^NSEI 5m + RELIANCE 5m.
 *
 * Trains the direction forecaster with walk-forward evaluation and only
 * promotes models that show a real post-cost edge. Prints an honest report.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const forecaster = require('../ai/forecaster');
const biasCoach = require('../ai/biasCoach');

const TARGETS = process.argv[2]
  ? [[process.argv[2], process.argv[3] || '5m']]
  : [['TCS', '5m'], ['HDFCBANK', '5m'], ['INFY', '5m'], ['SBIN', '5m'], ['RELIANCE', '5m'], ['^NSEI', '1D']];

(async () => {
  console.log('\n=== Training direction forecasters ===\n');
  let live = 0, trained = 0;

  for (const [symbol, tf] of TARGETS) {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 400 * 86400; // ~13 months of context
    const rows = await prisma.candle.findMany({
      where: { tradingSymbol: symbol, timeframe: tf, ts: { gte: from, lte: to } },
      orderBy: { ts: 'asc' },
    });
    const bars = rows.map((r) => ({ time: r.ts, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
    console.log(`${symbol} ${tf}: ${bars.length} bars in store`);

    if (bars.length < 400) {
      console.log(`   SKIP — not enough history (need 400+, have ${bars.length}). Backfill first.`);
      continue;
    }
    const res = forecaster.train(symbol, tf, bars);
    trained++;
    if (!res.ok) {
      console.log(`   SKIP — ${res.reason}`);
      continue;
    }
    if (res.live) {
      live++;
      console.log(`   LIVE — walk-forward ${(res.pooledAcc * 100).toFixed(1)}% accuracy, edge ${res.pooledEdge > 0 ? '+' : ''}${(res.pooledEdge * 100).toFixed(2)}%/trade`);
      console.log(`   top features: ${res.importance.map((f) => `${f.name}(${(f.importance * 100).toFixed(0)}%)`).join(', ')}`);
    } else {
      console.log(`   NO EDGE — walk-forward ${(res.pooledAcc * 100).toFixed(1)}% accuracy. Model saved but NOT serving predictions.`);
    }
  }

  console.log('\n=== Journal bias text model ===\n');
  const journals = await prisma.tradeJournal.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  console.log(`${journals.length} journal entries found`);
  if (journals.length >= 5) {
    const model = biasCoach.trainTextModel(journals);
    const fs = require('fs');
    const path = require('path');
    const dir = process.env.AI_MODEL_DIR || path.join(__dirname, '..', 'ai', 'models');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bias_text.json'), JSON.stringify(model));
    console.log(`   trained on ${journals.length} entries, ${Object.keys(model.heads || {}).length} bias heads`);
  } else {
    console.log('   SKIP — need at least 5 entries (rule layer works from entry #1).');
  }

  console.log(`\nDone: ${trained} forecasters trained, ${live} live.\n`);
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
