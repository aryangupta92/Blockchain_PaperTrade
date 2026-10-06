'use strict';
/**
 * services/gttEngine.js — ADDITIVE GTT/SL trigger daemon.
 * Does NOT change placeOrder flow. It only polls TRIGGER_PENDING orders and fills them
 * when live price touches triggerPrice, using existing fillOrder path via placeOrder-like fill.
 * Safe: runs on interval, guarded, single-flight.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { cacheGet } = require('./marketDataService');

let running = false;
let timer = null;

function shouldTrigger(order, ltp) {
  if (!ltp || !order.triggerPrice) return false;
  const tp = Number(order.triggerPrice);
  const side = String(order.side).toUpperCase();
  // BUY triggers when price rises to/above trigger; SELL when falls to/below
  if (side === 'BUY') return ltp >= tp;
  return ltp <= tp;
}

async function checkOnce(ioRef = null) {
  if (running) return { skipped: true };
  running = true;
  const out = { checked: 0, triggered: 0, errors: [] };
  try {
    const pendings = await prisma.order.findMany({
      where: { status: 'TRIGGER_PENDING' },
      include: { instrument: true },
      take: 100,
    });
    out.checked = pendings.length;
    const { PrismaClient: PC } = require('@prisma/client');
    for (const o of pendings) {
      try {
        const sym = o.instrument?.tradingSymbol;
        const q = sym ? cacheGet(`quote:${sym}`) : null;
        const ltp = q?.price ? Number(q.price) : null;
        if (!shouldTrigger(o, ltp)) continue;
        // Fill via orderService.fill path: reuse placeOrder fillOrder by updating to OPEN then filling
        // To avoid duplicating fill logic, we call internal fill through orderService module lazily
        const orderService = require('./orderService');
        // Mark OPEN first
        await prisma.order.update({ where: { id: o.id }, data: { status: 'OPEN' } });
        // Load user/holding for fill
        const [user, holding, instrument] = await Promise.all([
          prisma.user.findUnique({ where: { id: o.userId } }),
          prisma.holding.findUnique({ where: { userId_instrumentId: { userId: o.userId, instrumentId: o.instrumentId } } }),
          prisma.instrument.findUnique({ where: { id: o.instrumentId } }),
        ]);
        const { calculate: calcCosts } = require('./transactionCostEngine');
        const { getInstrumentType, normalizeProductType } = require('./riskEngine');
        const costs = calcCosts({
          price: ltp, quantity: o.quantity, side: o.side.toLowerCase(),
          productType: normalizeProductType(o.productType),
          instrumentType: getInstrumentType(sym),
          exchange: instrument?.exchange || 'NSE', lotSize: instrument?.lotSize || 1,
        });
        // We need fillOrder — it is not exported, so perform a minimal fill here reusing same tables
        // Simpler: update order to FILLED + create trade + update balance/holding in a tx (mirror logic, paper only)
        const blockchain = require('../blockchain');
        const block = blockchain.addBlock({
          type: o.side.toLowerCase(), symbol: sym, quantity: o.quantity, price: ltp,
          totalValue: o.quantity * ltp, userId: o.userId, executedAt: new Date().toISOString(),
        });
        await prisma.$transaction(async (tx) => {
          await tx.order.update({ where: { id: o.id }, data: { status: 'FILLED', filledQuantity: o.quantity, price: ltp } });
          await tx.orderEvent.create({ data: { orderId: o.id, status: 'FILLED', message: `GTT triggered @ ₹${ltp}` } });
          await tx.trade.create({
            data: {
              userId: o.userId, orderId: o.id, instrumentId: o.instrumentId,
              side: o.side, quantity: o.quantity, price: ltp, totalValue: o.quantity * ltp,
              brokerage: costs.brokerage, stt: costs.stt, exchangeFee: costs.exchangeFee,
              gst: costs.gst, stampDuty: costs.stampDuty, totalCost: costs.totalCost,
              netAmount: o.side === 'BUY' ? o.quantity * ltp + costs.totalCost : o.quantity * ltp - costs.totalCost,
              blockIndex: block.index, blockHash: block.hash, previousHash: block.previousHash, nonce: block.nonce,
            },
          });
          const heldQty = holding ? Number(holding.quantity) : 0;
          const isBuy = o.side === 'BUY';
          const newQty = isBuy ? heldQty + o.quantity : heldQty - o.quantity;
          const delta = isBuy ? -(o.quantity * ltp + costs.totalCost) : (o.quantity * ltp - costs.totalCost);
          await tx.user.update({ where: { id: o.userId }, data: { balance: Number((Number(user.balance) + delta).toFixed(2)) } });
          if (newQty === 0 && holding) await tx.holding.delete({ where: { id: holding.id } });
          else if (newQty !== 0) {
            let avg = holding?.avgPrice || ltp;
            if (isBuy && heldQty >= 0) avg = (heldQty * avg + o.quantity * ltp) / newQty;
            await tx.holding.upsert({
              where: { userId_instrumentId: { userId: o.userId, instrumentId: o.instrumentId } },
              update: { quantity: newQty, avgPrice: Number(avg.toFixed(4)) },
              create: { userId: o.userId, instrumentId: o.instrumentId, quantity: newQty, avgPrice: Number(avg.toFixed(4)) },
            });
          }
        });
        out.triggered++;
        if (ioRef) ioRef.to(`user:${o.userId}`).emit('order:filled', { orderId: o.id, symbol: sym, side: o.side.toLowerCase(), quantity: o.quantity, price: ltp, blockIndex: block.index, gtt: true });
      } catch (e) {
        out.errors.push(e.message);
      }
    }
  } finally {
    running = false;
  }
  return out;
}

function start(intervalMs = 15000, ioRef = null) {
  if (timer) return timer;
  timer = setInterval(() => checkOnce(ioRef).catch(() => {}), intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { checkOnce, start, shouldTrigger };
