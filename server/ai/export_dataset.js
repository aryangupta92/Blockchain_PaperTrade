'use strict';
/**
 * server/ai/export_dataset.js
 * Export labelled training dataset from Prisma for the Python trainer.
 * Usage: node server/ai/export_dataset.js [--out server/ai/dataset.json]
 *
 * Rows: one per SELL trade joined to prior BUY avg + journal rating/emotion,
 * plus market snapshot placeholders filled by train_recommendation.py via Yahoo.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const out = process.argv.find((a) => a.startsWith('--out'))?.split('=')[1]
    || path.join(__dirname, 'dataset.json');
  const trades = await prisma.trade.findMany({ include: { instrument: true }, orderBy: { executedAt: 'asc' }, take: 5000 });
  const journals = await prisma.tradeJournal.findMany({ take: 2000 });

  const byUserSym = new Map(); // avg buy tracker
  const rows = [];
  for (const t of trades) {
    const key = `${t.userId}::${t.instrument?.tradingSymbol}`;
    const st = byUserSym.get(key) || { qty: 0, cost: 0 };
    if (t.side === 'BUY') {
      st.cost += t.price * t.quantity; st.qty += t.quantity;
      byUserSym.set(key, st);
    } else if (t.side === 'SELL' && st.qty > 0) {
      const avg = st.cost / st.qty;
      const pnl = (t.price - avg) * Math.min(t.quantity, st.qty);
      rows.push({
        userId: t.userId,
        symbol: t.instrument?.tradingSymbol,
        sector: t.instrument?.sector,
        qty: t.quantity,
        buyAvg: +avg.toFixed(2),
        sellPrice: t.price,
        pnl: +pnl.toFixed(2),
        win: pnl > 0 ? 1 : 0,
        retPct: +(((t.price - avg) / avg) * 100).toFixed(3),
        executedAt: t.executedAt,
      });
      st.qty = Math.max(0, st.qty - t.quantity);
      if (st.qty === 0) st.cost = 0;
      byUserSym.set(key, st);
    }
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    trades: rows.length,
    journals: journals.map((j) => ({
      userId: j.userId, setup: j.setup, rating: j.rating,
      emotionOnEntry: j.emotionOnEntry, emotionOnExit: j.emotionOnExit,
      marketCondition: j.marketCondition,
      riskRewardPlanned: j.riskRewardPlanned, riskRewardActual: j.riskRewardActual,
    })),
    rows,
    note: 'pnl computed FIFO-average from paper trades. Feed to train_recommendation.py.',
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 1));
  console.log(`Exported ${rows.length} labelled rows + ${journals.length} journals -> ${out}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
