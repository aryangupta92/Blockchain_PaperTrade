'use strict';
/**
 * services/data/candleStore.js
 *  
 * Local OHLCV store (SQLite via Prisma) — the single source of truth for chart
 * data. Charts read from here first (instant + zero upstream cost); upstream
 * providers are only hit for backfill/gap-filling.
 *
 * Backfill sources, in order:
 * 1. DhanHQ historical (real exchange candles) ← primary
 * 2. Yahoo v8 chart endpoint ← fallback
 *
 * Table: Candle(tradingSymbol, timeframe, ts, o, h, l, c, v, oi) unique on (symbol,tf,ts)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TIMEFRAMES = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800,
};

function barToRow(symbol, tf, b, oi = null) {
  return {
    tradingSymbol: symbol, timeframe: tf, ts: b.time,
    o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume || 0,
    oi: oi != null ? oi : (b.oi != null ? b.oi : null),
  };
}

/**
 * Bulk upsert. SQLite's createMany has no skipDuplicates, so we use raw
 * INSERT OR IGNORE against the (tradingSymbol, timeframe, ts) unique index.
 *
 * Raw SQL bypasses Prisma's @default(uuid()), so `id` is generated here - and
 * that is also why INSERT OR IGNORE silently dropped rows before this fix.
 */
async function saveBars(symbol, tf, bars) {
  if (!bars || !bars.length) return 0;
  const { v4: uuid } = require('uuid');
  const rows = bars.map((b) => ({ id: uuid(), ...barToRow(symbol, tf, b) }));
  const CHUNK = 400; // 10 params/row stays far under SQLite's variable limit
  let inserted = 0;

  const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = [];
    slice.forEach((r) => params.push(r.id, r.tradingSymbol, r.timeframe, r.ts, r.o, r.h, r.l, r.c, r.v, r.oi));
    // SQL must match the number of rows in THIS chunk
    const sql = `INSERT OR IGNORE INTO Candle
      (id, tradingSymbol, timeframe, ts, o, h, l, c, v, oi, createdAt)
      VALUES ${new Array(slice.length).fill(group).join(', ')}`;
    try {
      const res = await prisma.$executeRawUnsafe(sql, ...params);
      inserted += Number(res) || 0;
    } catch (e) {
      if (/unique|constraint/i.test(e.message)) continue;
      throw e;
    }
  }
  return inserted;
}

/** Normalize a Dhan intraday/daily response into bars. Dhan returns newest-last. */
function normalizeDhanBars(d) {
  const n = d?.open?.length || 0;
  if (!n) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = Number(d.timestamp[i]);
    const bar = { time: t, open: +d.open[i], high: +d.high[i], low: +d.low[i], close: +d.close[i], volume: +(d.volume?.[i] ?? 0) };
    if (d.openInterest) bar.oi = +d.openInterest[i];
    out.push(bar);
  }
  return out;
}

/** Read candles in [fromTs, toTs]. */
async function getBars(symbol, tf, fromTs = 0, toTs = Math.floor(Date.now() / 1000) + 86400) {
  const rows = await prisma.candle.findMany({
    where: { tradingSymbol: symbol, timeframe: tf, ts: { gte: fromTs, lte: toTs } },
    orderBy: { ts: 'asc' },
  });
  return rows.map((r) => ({ time: r.ts, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, ...(r.oi != null ? { oi: r.oi } : {}) }));
}

/** Newest stored bar for a symbol/timeframe, used to compute gaps. */
async function getLatestTs(symbol, tf) {
  const row = await prisma.candle.findFirst({
    where: { tradingSymbol: symbol, timeframe: tf }, orderBy: { ts: 'desc' }, select: { ts: true },
  });
  return row?.ts ?? null;
}

async function getRange(symbol, tf) {
  const row = await prisma.candle.aggregate({
    where: { tradingSymbol: symbol, timeframe: tf },
    _min: { ts: true }, _max: { ts: true }, _count: true,
  });
  return { from: row._min.ts ?? null, to: row._max.ts ?? null, count: row._count ?? 0 };
}

/** Delete oldest bars beyond retention (default: keep 3 years). */
async function prune(symbol = null, tf = null, keepDays = 365 * 3) {
  const cutoff = Math.floor(Date.now() / 1000) - keepDays * 86400;
  const where = { ts: { lt: cutoff } };
  if (symbol) where.tradingSymbol = symbol;
  if (tf) where.timeframe = tf;
  const res = await prisma.candle.deleteMany({ where });
  return res?.count ?? 0;
}

/** Subscription list for live candle building (watchlist + indices). */
async function stats() {
  const [symbols, total, oldest] = await Promise.all([
    prisma.candle.groupBy({ by: ['tradingSymbol'], _count: true }),
    prisma.candle.count(),
    prisma.candle.findFirst({ orderBy: { ts: 'asc' }, select: { ts: true, tradingSymbol: true } }),
  ]);
  return { symbols: symbols.length, bars: total, oldestSymbol: oldest?.tradingSymbol ?? null, oldestTs: oldest?.ts ?? null };
}

module.exports = { TIMEFRAMES, saveBars, getBars, getLatestTs, getRange, normalizeDhanBars, prune, stats };
