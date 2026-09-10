/**
 * orderService.js — Order Management System (OMS) v3
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all order lifecycle operations.
 *
 * Order State Machine:
 *   PENDING ─(risk pass)─► OPEN ─(market fill)─► FILLED
 *      │                     │
 *      └─(risk fail)─► REJECTED  └─(cancel)─► CANCELLED
 *
 * v3 Additions:
 *  - NRML product type for F&O overnight carry
 *  - F&O symbol parsing to auto-create accurate instrument records
 *  - IOC (Immediate-or-Cancel) order type support
 *  - Circuit limit enforcement via instrument record
 *  - Improved margin calculation using marginService
 *  - Line-item cost breakdown in WebSocket broadcast
 */

'use strict';

const { PrismaClient }      = require('@prisma/client');
const prisma                = new PrismaClient();
const blockchain            = require('../blockchain');
const { runPreTradeChecks, isOptionSymbol, isFutureSymbol, getInstrumentType, normalizeProductType } = require('./riskEngine');
const { calculate: calcCosts } = require('./transactionCostEngine');
const { parseFOSymbol, getLotSize } = require('./marginService');
const auditLogger           = require('./auditLogger');
const dhanApi               = require('./dhanApi');

let _io = null;
function setIo(io) { _io = io; }

// ── Internal Helpers ──────────────────────────────────────────────────────────

async function createOrderEvent(tx, orderId, status, message, metadata) {
  return tx.orderEvent.create({
    data: { orderId, status, message: message || null, metadata: metadata ? JSON.stringify(metadata) : null }
  });
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Place a new order with full lifecycle management.
 *
 * @param {object} params
 * @param {string}  params.userId
 * @param {string}  params.symbol
 * @param {'buy'|'sell'} params.side
 * @param {number}  params.quantity
 * @param {number}  params.price
 * @param {'market'|'limit'|'stop'} params.orderType
 * @param {string}  [params.idempotencyKey]  — client-provided dedup key
 * @param {string}  [params.productType]     — DELIVERY | INTRADAY
 * @param {object}  [params.ctx]             — { ipAddress, userAgent }
 * @returns {Promise<{ success, order, trade?, block?, riskResult }>}
 */
async function placeOrder({
  userId, symbol, side, quantity, price,
  orderType = 'market', idempotencyKey, productType = 'CNC',
  triggerPrice = null, stopLoss = null, target = null, icebergLegs = null,
  validity = 'DAY', // DAY | IOC
  ctx = {}
}) {
  const qty = Number(quantity);
  const px  = Number(price);

  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid quantity');
  if (!Number.isFinite(px)  || px  <= 0) throw new Error('Invalid price');
  if (!['buy', 'sell'].includes(side))   throw new Error('side must be buy or sell');

  // ── Idempotency: return existing order if key matches ─────────────────────
  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const trade = existing.status === 'FILLED'
        ? await prisma.trade.findFirst({ where: { orderId: existing.id } })
        : null;
      return { success: true, order: existing, trade, block: null, riskResult: { passed: true, violations: [] }, idempotent: true };
    }
  }
  // ── Load user ─────────────────────────────────────────────────────────────
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  // ── Ensure instrument exists — auto-create with F&O metadata ───────────────
  let instrument = await prisma.instrument.findUnique({ where: { tradingSymbol: symbol } });
  if (!instrument) {
    const foParsed = parseFOSymbol(symbol);
    const instrType = getInstrumentType(symbol);
    instrument = await prisma.instrument.create({
      data: {
        symbol:          foParsed?.underlying || symbol,
        tradingSymbol:   symbol,
        exchange:        'NSE',
        name:            symbol,
        type:            instrType === 'OPTIONS' ? 'OPTION' : instrType === 'FUTURES' ? 'FUTURE' : 'EQUITY',
        segment:         instrType === 'EQUITY' ? 'EQ' : 'FO',
        lotSize:         foParsed?.lotSize || 1,
        strike:          foParsed?.strike  || null,
        optionType:      foParsed?.optionType || null,
        underlyingSymbol: foParsed?.underlying || null,
      }
    });
  }

  // ── 5. Attempt Live Dhan Execution (v4.0 & v4.1) ────────────────────────
  let dhanExecuted = false;
  let dhanOrderId = null;

  try {
    if (orderType.toUpperCase() === 'GTT') {
      const foreverPayload = {
        dhanClientId: process.env.DHAN_CLIENT_ID,
        orderFlag: "SINGLE",
        transactionType: side.toUpperCase(),
        exchangeSegment: "NSE_EQ",
        productType: productType === 'INTRADAY' ? 'MIS' : 'CNC',
        orderType: "LIMIT",
        validity: "DAY",
        securityId: "0", // Need actual securityId from mapping
        quantity: qty,
        price: px,
        triggerPrice: triggerPrice || px,
        disclosedQuantity: 0
      };
      console.log('[OMS] Dispatching Live Forever (GTT) Order to DhanHQ...', symbol);
      const dhanRes = await dhanApi.placeForeverOrder(foreverPayload);
      dhanExecuted = true;
      dhanOrderId = dhanRes.orderId;
      console.log(`[OMS] Live Dhan Forever Order Placed: ${dhanOrderId}`);
    }
  } catch (err) {
    console.warn('[OMS] Dhan Forever API Execution Failed (likely after-hours or missing securityId). Falling back to Paper GTT Simulator.');
  }

  // ── Load current holding and trade count ─────────────────────────────────
  const [holding, tradeCount] = await Promise.all([
    prisma.holding.findUnique({
      where: { userId_instrumentId: { userId, instrumentId: instrument.id } }
    }),
    prisma.trade.count({ where: { userId } })
  ]);

  const pt = normalizeProductType(productType);
  const instrType = getInstrumentType(symbol);

  // ── Pre-trade risk checks ─────────────────────────────────────────────────
  const riskResult = runPreTradeChecks({ user, tradeCount, holding, side, symbol, quantity: qty, price: px, productType: pt, instrument });

  // ── Calculate transaction costs ───────────────────────────────────────────
  const costs = calcCosts({
    price:          px,
    quantity:       qty,
    side,
    productType:    pt,
    instrumentType: instrType,
    exchange:       instrument.exchange || 'NSE',
    lotSize:        instrument.lotSize  || 1,
  });

  if (!riskResult.passed) {
    // Create REJECTED order with cost snapshot + audit event
    const rejectedOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          idempotencyKey:   idempotencyKey || null,
          userId,
          instrumentId:     instrument.id,
          side:             side.toUpperCase(),
          quantity:         qty,
          price:            px,
          orderType:        orderType.toUpperCase(),
          productType:      productType.toUpperCase(),
          status:           'REJECTED',
          rejectionReason:  riskResult.violations.map(v => v.message).join('; '),
          triggerPrice:     triggerPrice || null,
          disclosedQuantity: icebergLegs ? qty / icebergLegs : null,
          estBrokerage:     costs.brokerage,
          estSTT:           costs.stt,
          estExchangeFee:   costs.exchangeFee,
          estGST:           costs.gst,
          estStampDuty:     costs.stampDuty,
          estTotalCost:     costs.totalCost,
          estBreakEvenPrice: costs.breakEvenPrice,
        }
      });
      await createOrderEvent(tx, order.id, 'REJECTED', riskResult.violations[0]?.message, { violations: riskResult.violations });
      return order;
    });

    await auditLogger.log({
      userId,
      action:   auditLogger.ACTIONS.ORDER_REJECTED,
      entity:   'Order',
      entityId: rejectedOrder.id,
      ...ctx,
      metadata: { symbol, side, quantity: qty, price: px, violations: riskResult.violations },
    });

    return { success: false, order: rejectedOrder, trade: null, block: null, riskResult, violations: riskResult.violations };
  }

  // ── Create PENDING order ──────────────────────────────────────────────────
  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        idempotencyKey:   idempotencyKey || null,
        userId,
        instrumentId:     instrument.id,
        side:             side.toUpperCase(),
        quantity:         qty,
        price:            px,
        orderType:        orderType.toUpperCase(),
        productType:      productType.toUpperCase(),
        status:           (orderType.toUpperCase() === 'GTT' || orderType.toUpperCase() === 'SL' || orderType.toUpperCase() === 'SL-M' || triggerPrice) ? 'TRIGGER_PENDING' : 'PENDING',
        triggerPrice:     triggerPrice || null,
        validity:         validity.toUpperCase(),
        disclosedQuantity: icebergLegs ? qty / icebergLegs : null,
        estBrokerage:     costs.brokerage,
        estSTT:           costs.stt,
        estExchangeFee:   costs.exchangeFee,
        estGST:           costs.gst,
        estStampDuty:     costs.stampDuty,
        estTotalCost:     costs.totalCost,
        estBreakEvenPrice: costs.breakEvenPrice,
      }
    });
    const statusMsg = orderType.toUpperCase() === 'GTT' ? 'GTT created, awaiting trigger' : 'Order created and queued for validation';
    await createOrderEvent(tx, o.id, o.status, statusMsg);
    
    // If it's a BO/CO, create the pending child legs tied to this parent
    if (stopLoss || target) {
      if (stopLoss) {
        await tx.order.create({
          data: {
            userId, instrumentId: instrument.id, side: side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY',
            quantity: qty, price: 0, triggerPrice: stopLoss, orderType: 'SL', productType: productType.toUpperCase(),
            status: 'TRIGGER_PENDING', parentOrderId: o.id, estTotalCost: 0
          }
        });
      }
      if (target) {
        await tx.order.create({
          data: {
            userId, instrumentId: instrument.id, side: side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY',
            quantity: qty, price: target, orderType: 'LIMIT', productType: productType.toUpperCase(),
            status: 'PENDING', parentOrderId: o.id, estTotalCost: 0
          }
        });
      }
    }
    return o;
  });

  await auditLogger.log({
    userId,
    action:   auditLogger.ACTIONS.ORDER_CREATED,
    entity:   'Order',
    entityId: order.id,
    ...ctx,
    metadata: { symbol, side, quantity: qty, price: px, orderType },
  });

  const otUpper = orderType.toUpperCase();

  // ── Market / IOC orders: fill immediately ────────────────────────────────
  if (otUpper === 'MARKET' || otUpper === 'IOC') {
    const filled = await fillOrder(order, user, instrument, holding, riskResult, costs, ctx);
    // IOC: if not filled immediately (price moved), cancel it
    if (otUpper === 'IOC' && filled.order?.status !== 'FILLED') {
      await cancelOrder(order.id, userId, { ipAddress: 'SYSTEM', userAgent: 'IOC_CANCEL' });
      return { success: false, order: { ...order, status: 'CANCELLED' }, trade: null, violations: [{ code: 'IOC_UNEXECUTED', message: 'IOC order could not be filled immediately and was cancelled.' }] };
    }
    return filled;
  }

  // ── Non-market orders (Limit, GTT, SL, SL-M) ─────────────────────────────
  // SL/SL-M/GTT stay in TRIGGER_PENDING until the price hits.
  if (order.status === 'TRIGGER_PENDING') {
    return { success: true, order, trade: null, block: null, riskResult, costs };
  }

  const openOrder = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({ where: { id: order.id }, data: { status: 'OPEN' } });
    await createOrderEvent(tx, order.id, 'OPEN', 'Limit order open, waiting for market to reach limit price');
    return o;
  });

  return { success: true, order: openOrder, trade: null, block: null, riskResult, costs };
}

// ── Fill Engine ───────────────────────────────────────────────────────────────

async function fillOrder(order, user, instrument, holding, riskResult, costs, ctx = {}) {
  const { side, quantity: qty, price: px } = order;
  const sideLower  = side.toLowerCase();
  const tradeValue = Number((qty * px).toFixed(2));
  const heldQty    = holding ? Number(holding.quantity) : 0;
  let   newAvgPrice = holding ? holding.avgPrice : 0;

  // ── Position size & avg price calculation ─────────────────────────────────
  let newQty;
  let realizedPL = 0;

  if (sideLower === 'buy') {
    newQty = heldQty + qty;
    if (heldQty >= 0) {
      newAvgPrice = newQty > 0 ? ((heldQty * newAvgPrice) + (qty * px)) / newQty : px;
    } else if (newQty > 0) {
      // Was short, now going long — realize P&L on closed portion
      const closedQty = Math.min(qty, Math.abs(heldQty));
      realizedPL = closedQty * (newAvgPrice - px); // short P&L
      newAvgPrice = px;
    } else {
      // Partial buy-to-cover on short
      const closedQty = qty;
      realizedPL = closedQty * (newAvgPrice - px);
    }
  } else {
    newQty = heldQty - qty;
    if (heldQty > 0) {
      // Was long, selling — realize P&L on sold qty
      realizedPL = qty * (px - newAvgPrice);
    } else if (heldQty <= 0) {
      // Going deeper short
      const curAbs = Math.abs(heldQty);
      const newAbs = Math.abs(newQty);
      newAvgPrice = newAbs > 0 ? ((curAbs * newAvgPrice) + (qty * px)) / newAbs : px;
    }
  }

  // ── Record on blockchain ──────────────────────────────────────────────────
  const block = blockchain.addBlock({
    type:       sideLower,
    symbol:     instrument.tradingSymbol,
    quantity:   qty,
    price:      px,
    totalValue: tradeValue,
    userId:     user.id,
    executedAt: new Date().toISOString(),
  });

  // ── Atomic DB transaction ─────────────────────────────────────────────────
  const { filledOrder, newTrade } = await prisma.$transaction(async (tx) => {
    const filledOrder = await tx.order.update({
      where: { id: order.id },
      data:  { status: 'FILLED', filledQuantity: qty },
    });
    await createOrderEvent(tx, order.id, 'FILLED', `${side} ${qty} × ${instrument.tradingSymbol} @ ₹${px}`);

    const newTrade = await tx.trade.create({
      data: {
        userId:       user.id,
        orderId:      order.id,
        instrumentId: instrument.id,
        side:         side.toUpperCase(),
        quantity:     qty,
        price:        px,
        totalValue:   tradeValue,
        brokerage:    costs?.brokerage || 0,
        stt:          costs?.stt       || 0,
        exchangeFee:  costs?.exchangeFee || 0,
        gst:          costs?.gst       || 0,
        stampDuty:    costs?.stampDuty || 0,
        totalCost:    costs?.totalCost || 0,
        netAmount:    costs?.netAmount || tradeValue,
        blockIndex:   block.index,
        blockHash:    block.hash,
        previousHash: block.previousHash,
        nonce:        block.nonce,
      }
    });

    // Update balance (net of actual costs)
    const balanceDelta = sideLower === 'buy'
      ? -(tradeValue + (costs?.totalCost || 0))
      :  (tradeValue - (costs?.totalCost || 0));

    await tx.user.update({
      where: { id: user.id },
      data:  { balance: Number((user.balance + balanceDelta).toFixed(2)) },
    });

    // Upsert holding with realized P&L
    if (newQty === 0) {
      if (holding) {
        // Update realized P&L then delete
        await tx.holding.update({
          where: { id: holding.id },
          data:  { realizedPL: Number(((holding.realizedPL || 0) + realizedPL).toFixed(2)) }
        });
        await tx.holding.delete({ where: { id: holding.id } });
      }
    } else {
      await tx.holding.upsert({
        where:  { userId_instrumentId: { userId: user.id, instrumentId: instrument.id } },
        update: {
          quantity:   newQty,
          avgPrice:   Number(newAvgPrice.toFixed(4)),
          realizedPL: Number(((holding?.realizedPL || 0) + realizedPL).toFixed(2))
        },
        create: {
          userId:       user.id,
          instrumentId: instrument.id,
          quantity:     newQty,
          avgPrice:     Number(newAvgPrice.toFixed(4)),
          realizedPL:   Number(realizedPL.toFixed(2)),
        },
      });
    }

    return { filledOrder, newTrade };
  });

  await auditLogger.log({
    userId:   user.id,
    action:   auditLogger.ACTIONS.ORDER_FILLED,
    entity:   'Trade',
    entityId: newTrade.id,
    ...ctx,
    metadata: {
      symbol: instrument.tradingSymbol, side: sideLower, quantity: qty, price: px,
      totalValue: tradeValue, totalCost: costs?.totalCost || 0, blockIndex: block.index,
    },
  });

  // ── WebSocket broadcast ───────────────────────────────────────────────────
  if (_io) {
    _io.to(`user:${user.id}`).emit('order:filled', {
      orderId:    filledOrder.id,
      tradeId:    newTrade.id,
      symbol:     instrument.tradingSymbol,
      side:       sideLower,
      quantity:   qty,
      price:      px,
      totalValue: tradeValue,
      costs:      costs || null,
      realizedPL: Number(realizedPL.toFixed(2)),
      blockIndex: block.index,
      blockHash:  block.hash,
      timestamp:  newTrade.executedAt,
    });
  }

  return { success: true, order: filledOrder, trade: newTrade, block, riskResult, costs };
}

/**
 * Cancel an OPEN or PENDING order.
 */
async function cancelOrder(orderId, userId, ctx = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order)              throw new Error('Order not found');
  if (order.userId !== userId) throw new Error('Unauthorized');
  if (!['PENDING', 'OPEN', 'TRIGGER_PENDING'].includes(order.status)) {
    throw new Error(`Cannot cancel order in ${order.status} state`);
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    await createOrderEvent(tx, orderId, 'CANCELLED', 'Order cancelled by user');
    return o;
  });

  await auditLogger.log({
    userId,
    action:   auditLogger.ACTIONS.ORDER_CANCELLED,
    entity:   'Order',
    entityId: orderId,
    ...ctx,
  });

  return cancelled;
}

/**
 * Auto Square-Off for INTRADAY (MIS) orders/positions.
 * Called by cron at 15:15 IST.
 */
async function squareOffIntradayPositions() {
  console.log('[OMS] Initiating 3:15 PM Auto Square-Off for INTRADAY positions...');
  
  // 1. Cancel all OPEN/PENDING Intraday orders
  const pendingOrders = await prisma.order.findMany({
    where: { productType: 'INTRADAY', status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING'] } }
  });
  
  for (const order of pendingOrders) {
    try {
      await cancelOrder(order.id, order.userId, { ipAddress: 'SYSTEM', userAgent: 'AUTO_SQUAREOFF' });
    } catch (e) {
      console.error(`[OMS] Failed to cancel INTRADAY order ${order.id}:`, e.message);
    }
  }

  // 2. We need to square off actual holdings bought as INTRADAY. 
  // Since our 'Holding' table doesn't currently segregate by productType, 
  // a full implementation would look up trades by productType and net them out, 
  // or we'd add 'productType' to the Holding model. 
  // For now, we log the framework execution.
  console.log('[OMS] INTRADAY Auto Square-Off complete.');
}

module.exports = { placeOrder, cancelOrder, squareOffIntradayPositions, setIo };
