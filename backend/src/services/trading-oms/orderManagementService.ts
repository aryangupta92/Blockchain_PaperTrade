import crypto from 'crypto';
import {
  AccountMode,
  calculateTradeCharges,
  D,
  Decimal,
  ExchangeCode,
  InstrumentKind,
  MarketSegment,
  NormalizedQuote,
  OrderSide,
  OrderType,
  OrderValidity,
  ProductType,
  resolveRegulatoryConfig,
  roundPaise,
  ZERO,
} from '@broker/shared';
import { getPrisma } from '../../infrastructure/database';
import { blockchainService } from '../blockchainAuditService';
import { marketDataService } from '../market-data/marketDataService';
import { ensureDbInstrument } from './instrumentDbSync';
import { evaluatePreTradeRiskAndMargin, RiskEvaluationResult } from './riskAndMarginEngine';
import { demoExecutionEngine, realExecutionBroker } from './executionEngines';

export class OmsError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly violations?: Array<{ code: string; message: string }>;
  constructor(
    message: string,
    statusCode = 400,
    code = 'OMS_ERROR',
    violations?: Array<{ code: string; message: string }>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.violations = violations;
  }
}

export interface PlaceOrderInput {
  userId: string;
  accountMode: AccountMode;
  symbol: string;
  side: OrderSide;
  product: ProductType;
  orderType: OrderType;
  quantity: number;
  price?: string | number | null;
  triggerPrice?: string | number | null;
  stopLoss?: string | number | null;
  target?: string | number | null;
  trailingJump?: string | number | null;
  validity?: OrderValidity;
  isAmo?: boolean;
  icebergLegs?: number;
  parentOrderId?: string | null;
  ocoGroupId?: string | null;
  sliceGroupId?: string | null;
  legRole?: 'ENTRY' | 'TARGET' | 'STOP_LOSS' | 'SLICE' | null;
  idempotencyKey?: string;
  ipAddress?: string;
  /** Optional overrides strictly for deterministic testing / explicit DEMO learning sessions. */
  quoteOverride?: NormalizedQuote;
  nowOverride?: Date;
  allowAfterHoursDemo?: boolean;
}

async function resolveLiveQuote(symbol: string, override?: NormalizedQuote): Promise<NormalizedQuote> {
  if (override) return override;
  const quotes = await marketDataService.getQuotes([symbol]);
  const q = quotes[0];
  if (!q || !q.ltp) {
    throw new OmsError(
      `Live market price is currently unavailable for ${symbol}. Orders cannot be validated without real market data.`,
      503,
      'NO_LIVE_PRICE'
    );
  }
  return q;
}

async function loadRiskContext(userId: string, accountMode: AccountMode, instrumentId: string) {
  const prisma = getPrisma();
  const account = await prisma.tradingAccount.findUnique({
    where: { userId_mode: { userId, mode: accountMode } },
  });
  if (!account) {
    throw new OmsError(`${accountMode} account not found.`, 404, 'ACCOUNT_NOT_FOUND');
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [openOrdersCount, todayTradeCount, holding, positions] = await Promise.all([
    prisma.order.count({
      where: {
        accountId: account.id,
        epoch: account.resetEpoch,
        status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING', 'PARTIALLY_FILLED'] },
      },
    }),
    prisma.trade.count({
      where: {
        accountId: account.id,
        epoch: account.resetEpoch,
        executedAt: { gte: startOfDay },
      },
    }),
    prisma.holding.findUnique({
      where: {
        accountId_epoch_instrumentId: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId,
        },
      },
    }),
    prisma.position.findMany({
      where: { accountId: account.id, epoch: account.resetEpoch },
    }),
  ]);

  const dayRealizedPnl = positions
    .reduce((sum, p) => sum.plus(D(p.realizedPnl)), ZERO)
    .toFixed(2);

  let lockedSegments: string[] = [];
  try {
    const parsed = JSON.parse(account.lockedSegmentsJson || '[]');
    if (Array.isArray(parsed)) lockedSegments = parsed;
  } catch {
    lockedSegments = [];
  }

  return {
    account,
    lockedSegments,
    openOrdersCount,
    todayTradeCount,
    holding: {
      settledQty: holding?.settledQty ?? 0,
      t1Qty: holding?.t1Qty ?? 0,
    },
    positions,
    dayRealizedPnl,
  };
}

/** Pre-trade Margin + Statutory Charges + SEBI Compliance preview (no order placed). */
export async function previewOrder(input: PlaceOrderInput): Promise<{
  symbol: string;
  exchange: string;
  segment: string;
  ltp: string | null;
  lotSize: number;
  tickSize: string;
  mtfLeverage: string | null;
  upperCircuit: string | null;
  lowerCircuit: string | null;
  asmGsmFlag: string | null;
  risk: RiskEvaluationResult;
  exchangeMargin: Record<string, unknown> | null;
}> {
  const { dbInstrument } = await ensureDbInstrument(input.symbol);
  const quote = await resolveLiveQuote(dbInstrument.symbol, input.quoteOverride);
  const ctx = await loadRiskContext(input.userId, input.accountMode, dbInstrument.id);

  const matchingPos = ctx.positions.find(
    (p) => p.instrumentId === dbInstrument.id && p.product === input.product
  );
  const execPrice =
    input.price != null && Number(input.price) > 0
      ? roundPaise(input.price).toFixed(2)
      : quote.ltp || '0.00';

  const risk = evaluatePreTradeRiskAndMargin({
    account: {
      id: ctx.account.id,
      mode: input.accountMode,
      cashBalance: ctx.account.cashBalance,
      blockedMargin: ctx.account.blockedMargin,
      collateralMargin: ctx.account.collateralMargin,
      killSwitchOn: ctx.account.killSwitchOn,
      lockedSegments: ctx.lockedSegments,
      maxDailyLoss: ctx.account.maxDailyLoss,
      maxOrderValue: ctx.account.maxOrderValue,
      maxOpenOrders: ctx.account.maxOpenOrders,
      maxTradesPerDay: ctx.account.maxTradesPerDay,
      cooldownUntil: ctx.account.cooldownUntil,
    },
    instrument: {
      id: dbInstrument.id,
      symbol: dbInstrument.symbol,
      exchange: dbInstrument.exchange as ExchangeCode,
      segment: dbInstrument.segment as MarketSegment,
      instrumentKind: dbInstrument.instrumentKind as InstrumentKind,
      lotSize: dbInstrument.lotSize,
      tickSize: dbInstrument.tickSize,
      freezeQty: dbInstrument.freezeQty,
      expiryDate: dbInstrument.expiryDate,
      inFnoBan: dbInstrument.inFnoBan,
      varElmMarginPct: dbInstrument.varElmMarginPct,
      mtfLeverage: dbInstrument.mtfLeverage,
    },
    side: input.side,
    product: input.product,
    orderType: input.orderType,
    quantity: input.quantity,
    executionPrice: execPrice,
    triggerPrice: input.triggerPrice != null ? roundPaise(input.triggerPrice).toFixed(2) : null,
    stopLoss: input.stopLoss != null ? roundPaise(input.stopLoss).toFixed(2) : null,
    target: input.target != null ? roundPaise(input.target).toFixed(2) : null,
    trailingJump: input.trailingJump != null ? roundPaise(input.trailingJump).toFixed(2) : null,
    isAmo: Boolean(input.isAmo),
    prevClose: quote.prevClose,
    openOrdersCount: ctx.openOrdersCount,
    todayTradeCount: ctx.todayTradeCount,
    dayRealizedPnl: ctx.dayRealizedPnl,
    existingHoldingQty: ctx.holding,
    existingPositionNetQty: matchingPos?.netQuantity ?? 0,
    now: input.nowOverride,
    allowAfterHoursDemo: input.allowAfterHoursDemo,
  });

  // Optional real exchange SPAN margin enrichment (skipped in tests / offline)
  let exchangeMargin: Record<string, unknown> | null = null;
  if (process.env.NODE_ENV !== 'test' && Number(execPrice) > 0 && input.quantity > 0) {
    try {
      exchangeMargin = (await marketDataService.calculateExchangeMargin([
        {
          symbol: dbInstrument.symbol,
          side: input.side,
          quantity: input.quantity,
          product: input.product,
          price: Number(execPrice),
        },
      ])) as Record<string, unknown>;
    } catch {
      exchangeMargin = null;
    }
  }

  return {
    symbol: dbInstrument.symbol,
    exchange: dbInstrument.exchange,
    segment: dbInstrument.segment,
    ltp: quote.ltp,
    lotSize: dbInstrument.lotSize,
    tickSize: dbInstrument.tickSize,
    mtfLeverage: dbInstrument.mtfLeverage,
    upperCircuit: dbInstrument.upperCircuit,
    lowerCircuit: dbInstrument.lowerCircuit,
    asmGsmFlag: dbInstrument.asmGsmFlag,
    risk,
    exchangeMargin,
  };
}

/**
 * Atomically settle a filled order:
 * - Calculates Finance Act 2026 itemized charges (applied identically in DEMO and REAL)
 * - Updates TradingAccount cashBalance & blockedMargin
 * - Updates Holding (CNC with T+1 tracking) and Position (MIS/NRML with realized P&L)
 * - Writes Double-Entry LedgerEntry rows
 * - Cryptographically seals the trade onto the SHA-256 Proof-of-Work Blockchain
 */
export async function settleOrderFill(params: {
  orderId: string;
  fillQuantity: number;
  fillPrice: string;
  eventMessage: string;
  now?: Date;
}) {
  const prisma = getPrisma();
  const now = params.now ?? new Date();
  const cfg = resolveRegulatoryConfig(now);

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { account: true, instrument: true },
  });
  if (!order) throw new OmsError('Order not found for settlement.', 404, 'ORDER_NOT_FOUND');

  const inst = order.instrument;
  const account = order.account;
  const isDelivery = (inst.segment === 'EQ' || inst.segment === 'ETF') && order.product === 'CNC';
  const isMtf = (inst.segment === 'EQ' || inst.segment === 'ETF') && order.product === 'MTF';
  const isDeliverySell = isDelivery && order.side === 'SELL';

  const charges = calculateTradeCharges({
    exchange: inst.exchange as ExchangeCode,
    segment: inst.segment as MarketSegment,
    instrumentKind: inst.instrumentKind as InstrumentKind,
    product: order.product as ProductType,
    side: order.side as OrderSide,
    quantity: params.fillQuantity,
    price: params.fillPrice,
    applyDpCharge: isDeliverySell,
    asOfDate: now,
    config: cfg,
  });

  const turnover = D(charges.turnover);
  const totalCharges = D(charges.totalCharges);
  const fillPx = D(params.fillPrice);

  const settled = await prisma.$transaction(async (tx) => {
    const freshAcc = await tx.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    let cash = D(freshAcc.cashBalance);
    let blocked = D(freshAcc.blockedMargin);
    let realizedPnlDelta = ZERO;

    // 1. Update Holdings (CNC Equity / ETF) OR Positions (MIS / NRML)
    if (isDelivery) {
      const existingHolding = await tx.holding.findUnique({
        where: {
          accountId_epoch_instrumentId: {
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: inst.id,
          },
        },
      });

      if (order.side === 'BUY') {
        const prevTotal = (existingHolding?.settledQty ?? 0) + (existingHolding?.t1Qty ?? 0);
        const prevCost = existingHolding ? D(existingHolding.avgCost) : ZERO;
        const newTotal = prevTotal + params.fillQuantity;
        const newAvg =
          newTotal > 0
            ? roundPaise(prevCost.mul(prevTotal).plus(turnover).div(newTotal))
            : fillPx;

        await tx.holding.upsert({
          where: {
            accountId_epoch_instrumentId: {
              accountId: account.id,
              epoch: account.resetEpoch,
              instrumentId: inst.id,
            },
          },
          create: {
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: inst.id,
            settledQty: 0,
            t1Qty: params.fillQuantity, // SEBI T+1 settlement cycle
            avgCost: newAvg.toFixed(2),
          },
          update: {
            t1Qty: (existingHolding?.t1Qty ?? 0) + params.fillQuantity,
            avgCost: newAvg.toFixed(2),
          },
        });

        // BUY CNC debits full turnover + charges
        cash = roundPaise(cash.minus(turnover).minus(totalCharges));
      } else {
        // SELL CNC: debit settledQty first, then t1Qty; credit turnover - charges
        const curSettled = existingHolding?.settledQty ?? 0;
        const curT1 = existingHolding?.t1Qty ?? 0;
        const avgCost = existingHolding ? D(existingHolding.avgCost) : fillPx;
        const fromSettled = Math.min(curSettled, params.fillQuantity);
        const fromT1 = Math.max(0, params.fillQuantity - fromSettled);

        realizedPnlDelta = roundPaise(fillPx.minus(avgCost).mul(params.fillQuantity).minus(totalCharges));

        await tx.holding.update({
          where: { id: existingHolding!.id },
          data: {
            settledQty: Math.max(0, curSettled - fromSettled),
            t1Qty: Math.max(0, curT1 - fromT1),
          },
        });

        cash = roundPaise(cash.plus(turnover).minus(totalCharges));
      }
    } else if (isMtf) {
      // MTF (Margin Trading Facility — up to 4x delivery leverage)
      const lev = Decimal.max(D('1.00'), D(inst.mtfLeverage || '4.00'));
      if (order.side === 'BUY') {
        const clientMargin = roundPaise(turnover.div(lev));
        const funded = roundPaise(turnover.minus(clientMargin));
        const existingMtf = await tx.mtfPosition.findFirst({
          where: { accountId: account.id, epoch: account.resetEpoch, instrumentId: inst.id, status: 'OPEN' },
        });
        if (existingMtf) {
          const newQty = existingMtf.quantity + params.fillQuantity;
          const newAvg = roundPaise(
            D(existingMtf.avgPrice).mul(existingMtf.quantity).plus(turnover).div(newQty)
          );
          await tx.mtfPosition.update({
            where: { id: existingMtf.id },
            data: {
              quantity: newQty,
              avgPrice: newAvg.toFixed(2),
              clientMargin: roundPaise(D(existingMtf.clientMargin).plus(clientMargin)).toFixed(2),
              fundedAmount: roundPaise(D(existingMtf.fundedAmount).plus(funded)).toFixed(2),
            },
          });
        } else {
          await tx.mtfPosition.create({
            data: {
              accountId: account.id,
              epoch: account.resetEpoch,
              instrumentId: inst.id,
              quantity: params.fillQuantity,
              avgPrice: roundPaise(fillPx).toFixed(2),
              leverage: lev.toFixed(2),
              clientMargin: clientMargin.toFixed(2),
              fundedAmount: funded.toFixed(2),
            },
          });
        }
        cash = roundPaise(cash.minus(clientMargin).minus(totalCharges));
      } else {
        const existingMtf = await tx.mtfPosition.findFirst({
          where: { accountId: account.id, epoch: account.resetEpoch, instrumentId: inst.id, status: 'OPEN' },
        });
        const entryAvg = existingMtf ? D(existingMtf.avgPrice) : fillPx;
        const closeQty = existingMtf ? Math.min(existingMtf.quantity, params.fillQuantity) : params.fillQuantity;
        realizedPnlDelta = roundPaise(fillPx.minus(entryAvg).mul(closeQty));
        const releasedMargin = existingMtf && existingMtf.quantity > 0
          ? roundPaise(D(existingMtf.clientMargin).mul(closeQty).div(existingMtf.quantity))
          : ZERO;
        if (existingMtf) {
          const remQty = existingMtf.quantity - closeQty;
          await tx.mtfPosition.update({
            where: { id: existingMtf.id },
            data: {
              quantity: remQty,
              clientMargin: roundPaise(Decimal.max(ZERO, D(existingMtf.clientMargin).minus(releasedMargin))).toFixed(2),
              fundedAmount: remQty === 0 ? '0.00' : roundPaise(D(existingMtf.fundedAmount).mul(remQty).div(existingMtf.quantity)).toFixed(2),
              status: remQty === 0 ? 'CLOSED' : 'OPEN',
            },
          });
        }
        cash = roundPaise(cash.plus(releasedMargin).plus(realizedPnlDelta).minus(totalCharges));
      }
    } else {
      // MIS / NRML Position accounting (supports long and intraday/F&O short positions)
      const existingPos = await tx.position.findUnique({
        where: {
          accountId_epoch_instrumentId_product: {
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: inst.id,
            product: order.product,
          },
        },
      });

      const oldNet = existingPos?.netQuantity ?? 0;
      const oldAvgBuy = existingPos ? D(existingPos.avgBuyPrice) : ZERO;
      const oldAvgSell = existingPos ? D(existingPos.avgSellPrice) : ZERO;
      const oldRealized = existingPos ? D(existingPos.realizedPnl) : ZERO;
      const oldPosBlocked = existingPos ? D(existingPos.blockedMargin) : ZERO;

      const signedQty = order.side === 'BUY' ? params.fillQuantity : -params.fillQuantity;
      const newNet = oldNet + signedQty;

      // Calculate realized PnL when closing / reducing existing opposite position
      let closedQty = 0;
      if (oldNet > 0 && signedQty < 0) {
        closedQty = Math.min(oldNet, params.fillQuantity);
        realizedPnlDelta = roundPaise(fillPx.minus(oldAvgBuy).mul(closedQty));
      } else if (oldNet < 0 && signedQty > 0) {
        closedQty = Math.min(Math.abs(oldNet), params.fillQuantity);
        realizedPnlDelta = roundPaise(oldAvgSell.minus(fillPx).mul(closedQty));
      }

      // Update average entry price on the open side
      let newAvgBuy = oldAvgBuy;
      let newAvgSell = oldAvgSell;
      if (order.side === 'BUY') {
        const openingLong = Math.max(0, params.fillQuantity - closedQty);
        const prevLong = Math.max(0, oldNet);
        if (prevLong + openingLong > 0) {
          newAvgBuy = roundPaise(
            oldAvgBuy.mul(prevLong).plus(fillPx.mul(openingLong)).div(prevLong + openingLong)
          );
        }
      } else {
        const openingShort = Math.max(0, params.fillQuantity - closedQty);
        const prevShort = Math.max(0, -oldNet);
        if (prevShort + openingShort > 0) {
          newAvgSell = roundPaise(
            oldAvgSell.mul(prevShort).plus(fillPx.mul(openingShort)).div(prevShort + openingShort)
          );
        }
      }

      // Compute updated blocked margin for remaining open quantity
      const marginRate =
        inst.instrumentKind === 'OPTIONS' && newNet > 0
          ? D(1)
          : D(inst.varElmMarginPct).div(100);
      const entryRef = newNet > 0 ? newAvgBuy : newAvgSell;
      const newPosBlocked =
        newNet === 0 ? ZERO : roundPaise(entryRef.mul(Math.abs(newNet)).mul(marginRate));

      const marginDiff = newPosBlocked.minus(oldPosBlocked);
      blocked = roundPaise(Decimal.max(ZERO, blocked.plus(marginDiff)));
      // Cash updates by realized P&L minus exact statutory charges
      cash = roundPaise(cash.plus(realizedPnlDelta).minus(totalCharges));

      await tx.position.upsert({
        where: {
          accountId_epoch_instrumentId_product: {
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: inst.id,
            product: order.product,
          },
        },
        create: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: inst.id,
          product: order.product,
          netQuantity: newNet,
          avgBuyPrice: newAvgBuy.toFixed(2),
          avgSellPrice: newAvgSell.toFixed(2),
          realizedPnl: roundPaise(oldRealized.plus(realizedPnlDelta).minus(totalCharges)).toFixed(2),
          blockedMargin: newPosBlocked.toFixed(2),
        },
        update: {
          netQuantity: newNet,
          avgBuyPrice: newAvgBuy.toFixed(2),
          avgSellPrice: newAvgSell.toFixed(2),
          realizedPnl: roundPaise(oldRealized.plus(realizedPnlDelta).minus(totalCharges)).toFixed(2),
          blockedMargin: newPosBlocked.toFixed(2),
        },
      });
    }

    // 2. Persist updated account balances
    const updatedAccount = await tx.tradingAccount.update({
      where: { id: account.id },
      data: {
        cashBalance: cash.toFixed(2),
        blockedMargin: blocked.toFixed(2),
      },
    });

    // 3. Create Trade + itemized ChargeBreakdown
    const trade = await tx.trade.create({
      data: {
        accountId: account.id,
        epoch: account.resetEpoch,
        orderId: order.id,
        instrumentId: inst.id,
        side: order.side,
        product: order.product,
        quantity: params.fillQuantity,
        price: roundPaise(fillPx).toFixed(2),
        turnover: charges.turnover,
        executedAt: now,
        chargeBreakdown: {
          create: {
            asOfDate: charges.asOfDate,
            brokerage: charges.brokerage,
            sttOrCtt: charges.sttOrCtt,
            exchangeTransactionCharge: charges.exchangeTransactionCharge,
            sebiTurnoverFee: charges.sebiTurnoverFee,
            stampDuty: charges.stampDuty,
            dpChargeExclGst: charges.dpChargeExclGst,
            gst: charges.gst,
            totalCharges: charges.totalCharges,
          },
        },
      },
      include: { chargeBreakdown: true, instrument: true },
    });

    // 4. Write Double-Entry Ledger Entries (Trade Settlement + Statutory Charges)
    const cashBeforeCharges = roundPaise(cash.plus(totalCharges));
    if (isDelivery) {
      await tx.ledgerEntry.create({
        data: {
          accountId: account.id,
          epoch: account.resetEpoch,
          entryType: 'TRADE',
          debit: order.side === 'BUY' ? charges.turnover : '0.00',
          credit: order.side === 'SELL' ? charges.turnover : '0.00',
          runningBalance: cashBeforeCharges.toFixed(2),
          referenceId: trade.id,
          description: `${order.side} ${params.fillQuantity} ${inst.symbol} (${order.product}) @ ₹${roundPaise(fillPx).toFixed(2)}`,
        },
      });
    } else if (!realizedPnlDelta.isZero()) {
      await tx.ledgerEntry.create({
        data: {
          accountId: account.id,
          epoch: account.resetEpoch,
          entryType: 'MTM',
          debit: realizedPnlDelta.isNegative() ? realizedPnlDelta.abs().toFixed(2) : '0.00',
          credit: realizedPnlDelta.isPositive() ? realizedPnlDelta.toFixed(2) : '0.00',
          runningBalance: cashBeforeCharges.toFixed(2),
          referenceId: trade.id,
          description: `Realized P&L on ${order.side} ${params.fillQuantity} ${inst.symbol} (${order.product})`,
        },
      });
    }

    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        epoch: account.resetEpoch,
        entryType: 'CHARGES',
        debit: charges.totalCharges,
        credit: '0.00',
        runningBalance: cash.toFixed(2),
        referenceId: trade.id,
        description: `Statutory charges & brokerage for ${inst.symbol} (STT ₹${charges.sttOrCtt}, Brok ₹${charges.brokerage}, GST ₹${charges.gst})`,
      },
    });

    // 5. Update Order status & append OrderEvent
    const newFilled = order.filledQuantity + params.fillQuantity;
    const finalStatus = newFilled >= order.quantity ? 'FILLED' : 'PARTIALLY_FILLED';
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        filledQuantity: newFilled,
        status: finalStatus,
        price: roundPaise(fillPx).toFixed(2),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        status: finalStatus,
        message: params.eventMessage,
      },
    });

    // 5b. OCO Auto-Cancel: If this filled order belongs to an OCO pair, cancel the open sibling leg atomically!
    if (order.ocoGroupId && finalStatus === 'FILLED') {
      await tx.order.updateMany({
        where: {
          ocoGroupId: order.ocoGroupId,
          id: { not: order.id },
          status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING'] },
        },
        data: {
          status: 'CANCELLED',
          rejectionReason: 'Cancelled automatically by OCO sibling leg execution',
        },
      });
    }

    // 5c. Super Order / Bracket / Cover Entry Fill -> Auto-spawn linked OCO Target & Stop-Loss child legs!
    if (
      finalStatus === 'FILLED' &&
      ['SUPER', 'BO', 'CO'].includes(order.orderType) &&
      order.legRole !== 'TARGET' &&
      order.legRole !== 'STOP_LOSS' &&
      (order.stopLoss || order.target)
    ) {
      const ocoGroupId = `OCO-${order.id.slice(0, 12)}`;
      const exitSide = order.side === 'BUY' ? 'SELL' : 'BUY';

      if (order.target && D(order.target).gt(0)) {
        await tx.order.create({
          data: {
            idempotencyKey: `${order.id}-TARGET`,
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: inst.id,
            side: exitSide,
            product: order.product,
            orderType: 'LIMIT',
            validity: 'DAY',
            quantity: params.fillQuantity,
            price: roundPaise(order.target).toFixed(2),
            parentOrderId: order.id,
            ocoGroupId,
            legRole: 'TARGET',
            status: 'OPEN',
            events: {
              create: {
                status: 'OPEN',
                message: `Super/BO Target leg armed @ ₹${roundPaise(order.target).toFixed(2)} (OCO group ${ocoGroupId}).`,
              },
            },
          },
        });
      }

      if (order.stopLoss && D(order.stopLoss).gt(0)) {
        await tx.order.create({
          data: {
            idempotencyKey: `${order.id}-SL`,
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: inst.id,
            side: exitSide,
            product: order.product,
            orderType: 'SL_M',
            validity: 'DAY',
            quantity: params.fillQuantity,
            triggerPrice: roundPaise(order.stopLoss).toFixed(2),
            stopLoss: roundPaise(order.stopLoss).toFixed(2),
            trailingJump: order.trailingJump ?? null,
            peakPrice: roundPaise(fillPx).toFixed(2),
            parentOrderId: order.id,
            ocoGroupId,
            legRole: 'STOP_LOSS',
            status: 'TRIGGER_PENDING',
            events: {
              create: {
                status: 'TRIGGER_PENDING',
                message: `Super/BO Stop-Loss leg armed @ ₹${roundPaise(order.stopLoss).toFixed(2)}${order.trailingJump ? ` (Trailing Jump ₹${order.trailingJump})` : ''}.`,
              },
            },
          },
        });
      }
    }

    return { updatedAccount, updatedOrder, trade };
  });

  // 6. Cryptographically seal executed trade on the SHA-256 Proof-of-Work Blockchain
  const block = await blockchainService.appendAndPersist({
    recordId: settled.trade.id,
    kind: 'TRADE_EXECUTION',
    accountMode: account.mode as AccountMode,
    accountId: account.id,
    userId: account.userId,
    symbol: inst.symbol,
    side: order.side,
    quantity: params.fillQuantity,
    price: roundPaise(fillPx).toFixed(2),
    totalCharges: charges.totalCharges,
    metadata: {
      exchange: inst.exchange,
      segment: inst.segment,
      product: order.product,
      orderType: order.orderType,
      orderId: order.id,
    },
  });

  await prisma.trade.update({
    where: { id: settled.trade.id },
    data: { blockchainHash: block.hash },
  });

  return {
    order: settled.updatedOrder,
    trade: { ...settled.trade, blockchainHash: block.hash },
    account: settled.updatedAccount,
    charges,
    blockchainProof: {
      blockIndex: block.index,
      hash: block.hash,
      previousHash: block.previousHash,
      nonce: block.nonce,
    },
  };
}

export interface PlaceOrderResult {
  idempotent: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trade: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  charges?: any;
  blockchainProof?: {
    blockIndex: number;
    hash: string;
    previousHash: string;
    nonce: number;
  } | null;
  warnings?: string[];
  sliced?: boolean;
  sliceGroupId?: string;
  sliceCount?: number;
  slices?: Array<{ orderId: string; quantity: number; status: string }>;
}

/** Unified OMS Order Placement Entry Point (shared across DEMO and REAL accounts). */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const prisma = getPrisma();
  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();

  // Idempotency guard: return existing order if already processed
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey },
    include: { instrument: true, trades: { include: { chargeBreakdown: true } }, events: true },
  });
  if (existing) {
    return {
      idempotent: true,
      order: existing,
      trade: existing.trades[0] || null,
    };
  }

  const { dbInstrument } = await ensureDbInstrument(input.symbol);
  const quote = await resolveLiveQuote(dbInstrument.symbol, input.quoteOverride);
  const ctx = await loadRiskContext(input.userId, input.accountMode, dbInstrument.id);

  const matchingPos = ctx.positions.find(
    (p) => p.instrumentId === dbInstrument.id && p.product === input.product
  );
  const execPrice =
    input.price != null && Number(input.price) > 0
      ? roundPaise(input.price).toFixed(2)
      : quote.ltp || '0.00';

  const risk = evaluatePreTradeRiskAndMargin({
    account: {
      id: ctx.account.id,
      mode: input.accountMode,
      cashBalance: ctx.account.cashBalance,
      blockedMargin: ctx.account.blockedMargin,
      collateralMargin: ctx.account.collateralMargin,
      killSwitchOn: ctx.account.killSwitchOn,
      lockedSegments: ctx.lockedSegments,
      maxDailyLoss: ctx.account.maxDailyLoss,
      maxOrderValue: ctx.account.maxOrderValue,
      maxOpenOrders: ctx.account.maxOpenOrders,
      maxTradesPerDay: ctx.account.maxTradesPerDay,
      cooldownUntil: ctx.account.cooldownUntil,
    },
    instrument: {
      id: dbInstrument.id,
      symbol: dbInstrument.symbol,
      exchange: dbInstrument.exchange as ExchangeCode,
      segment: dbInstrument.segment as MarketSegment,
      instrumentKind: dbInstrument.instrumentKind as InstrumentKind,
      lotSize: dbInstrument.lotSize,
      tickSize: dbInstrument.tickSize,
      freezeQty: dbInstrument.freezeQty,
      expiryDate: dbInstrument.expiryDate,
      inFnoBan: dbInstrument.inFnoBan,
      varElmMarginPct: dbInstrument.varElmMarginPct,
      mtfLeverage: dbInstrument.mtfLeverage,
    },
    side: input.side,
    product: input.product,
    orderType: input.orderType,
    quantity: input.quantity,
    executionPrice: execPrice,
    triggerPrice: input.triggerPrice != null ? roundPaise(input.triggerPrice).toFixed(2) : null,
    stopLoss: input.stopLoss != null ? roundPaise(input.stopLoss).toFixed(2) : null,
    target: input.target != null ? roundPaise(input.target).toFixed(2) : null,
    trailingJump: input.trailingJump != null ? roundPaise(input.trailingJump).toFixed(2) : null,
    isAmo: Boolean(input.isAmo),
    prevClose: quote.prevClose,
    openOrdersCount: ctx.openOrdersCount,
    todayTradeCount: ctx.todayTradeCount,
    dayRealizedPnl: ctx.dayRealizedPnl,
    existingHoldingQty: ctx.holding,
    existingPositionNetQty: matchingPos?.netQuantity ?? 0,
    now: input.nowOverride,
    allowAfterHoursDemo: input.allowAfterHoursDemo,
  });

  if (!risk.allowed) {
    throw new OmsError(
      risk.violations[0]?.message || 'Order rejected by risk engine.',
      422,
      risk.violations[0]?.code || 'RISK_REJECTED',
      risk.violations
    );
  }

  // Iceberg / Freeze-Quantity Auto-Slicing: if caller requested N slices OR qty exceeds exchange freezeQty
  if (
    !input.sliceGroupId &&
    ((input.icebergLegs && input.icebergLegs > 1) || (risk.requiresSlicing && risk.sliceQuantities.length > 1))
  ) {
    let slices = risk.sliceQuantities;
    if (input.icebergLegs && input.icebergLegs > 1 && slices.length === 1) {
      const legs = Math.min(20, Math.max(2, input.icebergLegs));
      const lot = Math.max(1, dbInstrument.lotSize);
      const totalLots = Math.floor(input.quantity / lot);
      if (totalLots >= legs) {
        const baseLots = Math.floor(totalLots / legs);
        let remLots = totalLots % legs;
        slices = [];
        for (let i = 0; i < legs; i++) {
          const take = baseLots + (remLots > 0 ? 1 : 0);
          if (remLots > 0) remLots--;
          slices.push(take * lot);
        }
      }
    }
    if (slices.length > 1) {
      const sliceGroupId = `SLICE-${crypto.randomUUID().slice(0, 10)}`;
      const childResults: PlaceOrderResult[] = [];
      for (let i = 0; i < slices.length; i++) {
        childResults.push(
          await placeOrder({
            ...input,
            quantity: slices[i],
            icebergLegs: 1,
            sliceGroupId,
            legRole: 'SLICE',
            idempotencyKey: `${idempotencyKey}-S${i + 1}`,
          })
        );
      }
      const first = childResults[0];
      return {
        ...first,
        sliced: true,
        sliceGroupId,
        sliceCount: childResults.length,
        slices: childResults.map((c) => ({ orderId: c.order.id, quantity: c.order.quantity, status: c.order.status })),
      };
    }
  }

  // Persist initial PENDING order
  const order = await prisma.order.create({
    data: {
      idempotencyKey,
      accountId: ctx.account.id,
      epoch: ctx.account.resetEpoch,
      instrumentId: dbInstrument.id,
      side: input.side,
      product: input.product,
      orderType: input.orderType,
      validity: input.validity || (input.orderType === 'GTT' ? 'GTT' : 'DAY'),
      isAmo: Boolean(input.isAmo),
      quantity: input.quantity,
      price: input.price != null && Number(input.price) > 0 ? roundPaise(input.price).toFixed(2) : null,
      triggerPrice: input.triggerPrice != null ? roundPaise(input.triggerPrice).toFixed(2) : null,
      stopLoss: input.stopLoss != null ? roundPaise(input.stopLoss).toFixed(2) : null,
      target: input.target != null ? roundPaise(input.target).toFixed(2) : null,
      trailingJump: input.trailingJump != null ? roundPaise(input.trailingJump).toFixed(2) : null,
      parentOrderId: input.parentOrderId ?? null,
      ocoGroupId: input.ocoGroupId ?? null,
      sliceGroupId: input.sliceGroupId ?? null,
      legRole: input.legRole ?? (['SUPER', 'BO', 'CO'].includes(input.orderType) ? 'ENTRY' : null),
      status: 'PENDING',
      events: {
        create: {
          status: 'PENDING',
          message: `Order validated via SEBI risk/margin engine (Required margin ₹${risk.requiredMargin}).`,
        },
      },
    },
  });

  // Route strictly to the matching execution backend (DEMO vs REAL)
  const engine = input.accountMode === 'DEMO' ? demoExecutionEngine : realExecutionBroker;
  const outcome = await engine.submit({
    orderId: order.id,
    symbol: dbInstrument.symbol,
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    limitPrice: order.price,
    triggerPrice: order.triggerPrice,
    validity: order.validity as OrderValidity,
    isAmo: order.isAmo,
    quote,
  });

  if (outcome.externalOrderId) {
    await prisma.order.update({
      where: { id: order.id },
      data: { externalOrderId: outcome.externalOrderId },
    });
  }

  // If filled immediately, execute atomic settlement + charges + blockchain seal
  if ((outcome.status === 'FILLED' || outcome.status === 'PARTIALLY_FILLED') && outcome.filledQuantity > 0 && outcome.fillPrice) {
    const settled = await settleOrderFill({
      orderId: order.id,
      fillQuantity: outcome.filledQuantity,
      fillPrice: outcome.fillPrice,
      eventMessage: outcome.message,
      now: input.nowOverride,
    });

    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: 'ORDER_FILLED',
        entity: 'Order',
        entityId: order.id,
        details: JSON.stringify({
          mode: input.accountMode,
          symbol: dbInstrument.symbol,
          side: input.side,
          qty: outcome.filledQuantity,
          price: outcome.fillPrice,
          charges: settled.charges.totalCharges,
        }),
        ipAddress: input.ipAddress,
      },
    });

    return {
      idempotent: false,
      order: settled.order,
      trade: settled.trade,
      charges: settled.charges,
      blockchainProof: settled.blockchainProof,
      warnings: risk.warnings,
    };
  }

  // Resting order (OPEN / TRIGGER_PENDING) or REJECTED / CANCELLED
  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: outcome.status,
      rejectionReason: outcome.status === 'REJECTED' ? outcome.message : null,
      events: {
        create: {
          status: outcome.status,
          message: outcome.message,
        },
      },
    },
    include: { instrument: true, events: true },
  });

  return {
    idempotent: false,
    order: updatedOrder,
    trade: null,
    charges: risk.estimatedCharges,
    blockchainProof: null,
    warnings: risk.warnings,
  };
}

export async function modifyOrder(params: {
  userId: string;
  orderId: string;
  quantity?: number;
  price?: string | number;
  triggerPrice?: string | number;
  stopLoss?: string | number;
  target?: string | number;
  trailingJump?: string | number;
}) {
  const prisma = getPrisma();
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { account: true, instrument: true },
  });
  if (!order || order.account.userId !== params.userId) {
    throw new OmsError('Order not found.', 404, 'ORDER_NOT_FOUND');
  }
  if (!['PENDING', 'OPEN', 'TRIGGER_PENDING'].includes(order.status)) {
    throw new OmsError(`Cannot modify order in status ${order.status}.`, 400, 'ORDER_NOT_MODIFIABLE');
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      ...(params.quantity != null ? { quantity: params.quantity } : {}),
      ...(params.price != null ? { price: roundPaise(params.price).toFixed(2) } : {}),
      ...(params.triggerPrice != null ? { triggerPrice: roundPaise(params.triggerPrice).toFixed(2) } : {}),
      ...(params.stopLoss != null ? { stopLoss: roundPaise(params.stopLoss).toFixed(2) } : {}),
      ...(params.target != null ? { target: roundPaise(params.target).toFixed(2) } : {}),
      ...(params.trailingJump != null ? { trailingJump: roundPaise(params.trailingJump).toFixed(2) } : {}),
      events: {
        create: {
          status: order.status,
          message: `Order modified (qty=${params.quantity ?? order.quantity}, price=${params.price ?? order.price ?? 'MKT'}, trigger=${params.triggerPrice ?? order.triggerPrice ?? '—'}).`,
        },
      },
    },
    include: { instrument: true, events: true },
  });

  return updated;
}

export async function cancelOrder(userId: string, orderId: string, reason = 'Cancelled by trader') {
  const prisma = getPrisma();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { account: true },
  });
  if (!order || order.account.userId !== userId) {
    throw new OmsError('Order not found.', 404, 'ORDER_NOT_FOUND');
  }
  if (!['PENDING', 'OPEN', 'TRIGGER_PENDING', 'PARTIALLY_FILLED'].includes(order.status)) {
    throw new OmsError(`Cannot cancel order in status ${order.status}.`, 400, 'ORDER_NOT_CANCELLABLE');
  }

  return prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'CANCELLED',
      rejectionReason: reason,
      events: {
        create: {
          status: 'CANCELLED',
          message: reason,
        },
      },
    },
    include: { instrument: true, events: true },
  });
}

/**
 * MIS Auto Square-Off (SEBI/Broker RMS standard: 15:15 IST).
 * Closes all open MIS positions using current market prices.
 */
export async function runMisAutoSquareOff(params?: {
  userId?: string;
  accountMode?: AccountMode;
  quoteOverrides?: Record<string, NormalizedQuote>;
  nowOverride?: Date;
}) {
  const prisma = getPrisma();
  const openMisPositions = await prisma.position.findMany({
    where: {
      product: 'MIS',
      netQuantity: { not: 0 },
      ...(params?.userId || params?.accountMode
        ? {
            account: {
              ...(params.userId ? { userId: params.userId } : {}),
              ...(params.accountMode ? { mode: params.accountMode } : {}),
            },
          }
        : {}),
    },
    include: { account: true, instrument: true },
  });

  const squaredOff: Array<{ positionId: string; symbol: string; quantity: number; mode: string }> = [];

  for (const pos of openMisPositions) {
    if (pos.epoch !== pos.account.resetEpoch) continue;
    const exitSide: OrderSide = pos.netQuantity > 0 ? 'SELL' : 'BUY';
    const exitQty = Math.abs(pos.netQuantity);
    try {
      await placeOrder({
        userId: pos.account.userId,
        accountMode: pos.account.mode as AccountMode,
        symbol: pos.instrument.symbol,
        side: exitSide,
        product: 'MIS',
        orderType: 'MARKET',
        quantity: exitQty,
        quoteOverride: params?.quoteOverrides?.[pos.instrument.symbol],
        nowOverride: params?.nowOverride,
        allowAfterHoursDemo: true,
      });
      squaredOff.push({
        positionId: pos.id,
        symbol: pos.instrument.symbol,
        quantity: exitQty,
        mode: pos.account.mode,
      });
    } catch {
      // Log and continue squaring off remaining MIS positions
    }
  }

  return { count: squaredOff.length, squaredOff };
}

/**
 * Convert an open Equity/ETF MIS position to CNC Delivery (if sufficient full cash is available),
 * mirroring broker position conversion.
 */
export async function convertPositionProduct(params: {
  userId: string;
  accountMode: AccountMode;
  symbol: string;
  fromProduct: ProductType;
  toProduct: ProductType;
}) {
  const prisma = getPrisma();
  const account = await prisma.tradingAccount.findUnique({
    where: { userId_mode: { userId: params.userId, mode: params.accountMode } },
  });
  if (!account) throw new OmsError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');

  const { dbInstrument } = await ensureDbInstrument(params.symbol);

  // F&O / Commodity bidirectional conversion: MIS <-> NRML
  if (dbInstrument.segment === 'FNO' || dbInstrument.segment === 'COMM') {
    if (!((params.fromProduct === 'MIS' && params.toProduct === 'NRML') || (params.fromProduct === 'NRML' && params.toProduct === 'MIS'))) {
      throw new OmsError('Derivatives support MIS ↔ NRML conversion only.', 400, 'CONVERSION_UNSUPPORTED');
    }
    const pos = await prisma.position.findUnique({
      where: {
        accountId_epoch_instrumentId_product: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: dbInstrument.id,
          product: params.fromProduct,
        },
      },
    });
    if (!pos || pos.netQuantity === 0) {
      throw new OmsError(`No open ${params.fromProduct} position found for ${dbInstrument.symbol}.`, 400, 'NO_OPEN_POSITION');
    }
    await prisma.$transaction(async (tx) => {
      await tx.position.update({ where: { id: pos.id }, data: { netQuantity: 0, blockedMargin: '0.00' } });
      const targetPos = await tx.position.findUnique({
        where: {
          accountId_epoch_instrumentId_product: {
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: dbInstrument.id,
            product: params.toProduct,
          },
        },
      });
      if (targetPos) {
        await tx.position.update({
          where: { id: targetPos.id },
          data: {
            netQuantity: targetPos.netQuantity + pos.netQuantity,
            blockedMargin: roundPaise(D(targetPos.blockedMargin).plus(D(pos.blockedMargin))).toFixed(2),
          },
        });
      } else {
        await tx.position.create({
          data: {
            accountId: account.id,
            epoch: account.resetEpoch,
            instrumentId: dbInstrument.id,
            product: params.toProduct,
            netQuantity: pos.netQuantity,
            avgBuyPrice: pos.avgBuyPrice,
            avgSellPrice: pos.avgSellPrice,
            realizedPnl: '0.00',
            blockedMargin: pos.blockedMargin,
          },
        });
      }
    });
    return { converted: true, symbol: dbInstrument.symbol, quantity: Math.abs(pos.netQuantity), toProduct: params.toProduct };
  }

  if (dbInstrument.segment !== 'EQ' && dbInstrument.segment !== 'ETF') {
    throw new OmsError('Only Equity, ETF, and Derivative positions support conversion.', 400, 'CONVERSION_UNSUPPORTED');
  }
  if (!(params.fromProduct === 'MIS' && params.toProduct === 'CNC')) {
    throw new OmsError('For Equity/ETF, long MIS → CNC delivery conversion is supported.', 400, 'CONVERSION_UNSUPPORTED');
  }

  const pos = await prisma.position.findUnique({
    where: {
      accountId_epoch_instrumentId_product: {
        accountId: account.id,
        epoch: account.resetEpoch,
        instrumentId: dbInstrument.id,
        product: 'MIS',
      },
    },
  });
  if (!pos || pos.netQuantity <= 0) {
    throw new OmsError('Only positive (long) open MIS positions can be converted to CNC Delivery.', 400, 'NO_LONG_MIS_POSITION');
  }

  const fullValue = roundPaise(D(pos.avgBuyPrice).mul(pos.netQuantity));
  const currentBlocked = D(pos.blockedMargin);
  const additionalCashNeeded = roundPaise(fullValue.minus(currentBlocked));
  const available = roundPaise(D(account.cashBalance).minus(D(account.blockedMargin)));

  if (available.lt(additionalCashNeeded)) {
    throw new OmsError(
      `Insufficient available funds to convert MIS → CNC. Additional cash needed: ₹${additionalCashNeeded.toFixed(2)}, Available: ₹${available.toFixed(2)}.`,
      422,
      'INSUFFICIENT_FUNDS_FOR_CONVERSION'
    );
  }

  await prisma.$transaction(async (tx) => {
    // Debit full CNC cash, release MIS blocked margin
    const newCash = roundPaise(D(account.cashBalance).minus(fullValue));
    const newBlocked = roundPaise(Decimal.max(ZERO, D(account.blockedMargin).minus(currentBlocked)));

    await tx.tradingAccount.update({
      where: { id: account.id },
      data: { cashBalance: newCash.toFixed(2), blockedMargin: newBlocked.toFixed(2) },
    });

    await tx.position.update({
      where: { id: pos.id },
      data: { netQuantity: 0, blockedMargin: '0.00' },
    });

    const existingHolding = await tx.holding.findUnique({
      where: {
        accountId_epoch_instrumentId: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: dbInstrument.id,
        },
      },
    });
    const prevQty = (existingHolding?.settledQty ?? 0) + (existingHolding?.t1Qty ?? 0);
    const prevAvg = existingHolding ? D(existingHolding.avgCost) : ZERO;
    const totalQty = prevQty + pos.netQuantity;
    const weightedAvg = roundPaise(
      prevAvg.mul(prevQty).plus(fullValue).div(totalQty)
    );

    await tx.holding.upsert({
      where: {
        accountId_epoch_instrumentId: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: dbInstrument.id,
        },
      },
      create: {
        accountId: account.id,
        epoch: account.resetEpoch,
        instrumentId: dbInstrument.id,
        settledQty: 0,
        t1Qty: pos.netQuantity,
        avgCost: weightedAvg.toFixed(2),
      },
      update: {
        t1Qty: (existingHolding?.t1Qty ?? 0) + pos.netQuantity,
        avgCost: weightedAvg.toFixed(2),
      },
    });

    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        epoch: account.resetEpoch,
        entryType: 'TRADE',
        debit: fullValue.toFixed(2),
        credit: '0.00',
        runningBalance: newCash.toFixed(2),
        description: `Converted ${pos.netQuantity} ${dbInstrument.symbol} from MIS → CNC Delivery @ ₹${pos.avgBuyPrice}`,
      },
    });
  });

  return { converted: true, symbol: dbInstrument.symbol, quantity: pos.netQuantity, toProduct: 'CNC' };
}

/** One-click Reverse Position: executes 2x opposite market order to flip Long <-> Short cleanly. */
export async function reversePosition(params: {
  userId: string;
  accountMode: AccountMode;
  symbol: string;
  product: ProductType;
  allowAfterHoursDemo?: boolean;
}) {
  const prisma = getPrisma();
  const account = await prisma.tradingAccount.findUnique({
    where: { userId_mode: { userId: params.userId, mode: params.accountMode } },
  });
  if (!account) throw new OmsError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');

  const { dbInstrument } = await ensureDbInstrument(params.symbol);
  const pos = await prisma.position.findUnique({
    where: {
      accountId_epoch_instrumentId_product: {
        accountId: account.id,
        epoch: account.resetEpoch,
        instrumentId: dbInstrument.id,
        product: params.product,
      },
    },
  });
  if (!pos || pos.netQuantity === 0) {
    throw new OmsError('No open position to reverse.', 400, 'NO_OPEN_POSITION');
  }
  const reverseSide: OrderSide = pos.netQuantity > 0 ? 'SELL' : 'BUY';
  const doubleQty = Math.abs(pos.netQuantity) * 2;
  return placeOrder({
    userId: params.userId,
    accountMode: params.accountMode,
    symbol: dbInstrument.symbol,
    side: reverseSide,
    product: params.product,
    orderType: 'MARKET',
    quantity: doubleQty,
    allowAfterHoursDemo: params.allowAfterHoursDemo ?? true,
  });
}
