import { AccountMode, analyzeOptionStrategy, computeXIRR, D, OrderSide, ProductType, roundPaise, StrategyLegInput, ZERO } from '@broker/shared';
import { getPrisma } from '../../infrastructure/database';
import { marketDataService } from '../market-data/marketDataService';
import { formatAccount, getAccountByMode } from '../accountService';
import { cancelOrder, placeOrder } from './orderManagementService';

export async function getPortfolioPositions(userId: string, mode: AccountMode) {
  const account = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  const rows = await prisma.position.findMany({
    where: { accountId: account.id, epoch: account.resetEpoch },
    include: { instrument: true },
    orderBy: { updatedAt: 'desc' },
  });

  const symbols = [...new Set(rows.map((r) => r.instrument.symbol))];
  const quotes = symbols.length ? await marketDataService.getQuotes(symbols).catch(() => []) : [];
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  let totalUnrealized = ZERO;
  let totalRealized = ZERO;

  const positions = rows.map((r) => {
    const q = quoteBySymbol.get(r.instrument.symbol.toUpperCase());
    const avgEntry = r.netQuantity >= 0 ? D(r.avgBuyPrice) : D(r.avgSellPrice);
    const ltp = q?.ltp ? D(q.ltp) : avgEntry;
    const unrealized =
      r.netQuantity === 0
        ? ZERO
        : r.netQuantity > 0
          ? roundPaise(ltp.minus(avgEntry).mul(r.netQuantity))
          : roundPaise(avgEntry.minus(ltp).mul(Math.abs(r.netQuantity)));

    const realized = D(r.realizedPnl);
    totalUnrealized = totalUnrealized.plus(unrealized);
    totalRealized = totalRealized.plus(realized);

    return {
      id: r.id,
      symbol: r.instrument.symbol,
      displayName: r.instrument.displayName,
      exchange: r.instrument.exchange,
      segment: r.instrument.segment,
      product: r.product as ProductType,
      netQuantity: r.netQuantity,
      avgBuyPrice: r.avgBuyPrice,
      avgSellPrice: r.avgSellPrice,
      ltp: ltp.toFixed(2),
      freshness: q?.freshness ?? 'CACHED',
      unrealizedPnl: unrealized.toFixed(2),
      realizedPnl: realized.toFixed(2),
      netPnl: roundPaise(unrealized.plus(realized)).toFixed(2),
      blockedMargin: r.blockedMargin,
    };
  });

  return {
    account: formatAccount(account),
    positions,
    summary: {
      openCount: positions.filter((p) => p.netQuantity !== 0).length,
      totalUnrealizedPnl: roundPaise(totalUnrealized).toFixed(2),
      totalRealizedPnl: roundPaise(totalRealized).toFixed(2),
      totalNetPnl: roundPaise(totalUnrealized.plus(totalRealized)).toFixed(2),
    },
  };
}

export async function getPortfolioHoldings(userId: string, mode: AccountMode) {
  const account = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  const rows = await prisma.holding.findMany({
    where: {
      accountId: account.id,
      epoch: account.resetEpoch,
      OR: [{ settledQty: { gt: 0 } }, { t1Qty: { gt: 0 } }],
    },
    include: { instrument: true },
    orderBy: { updatedAt: 'desc' },
  });

  const symbols = [...new Set(rows.map((r) => r.instrument.symbol))];
  const quotes = symbols.length ? await marketDataService.getQuotes(symbols).catch(() => []) : [];
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  let totalInvested = ZERO;
  let totalCurrent = ZERO;

  const holdings = rows.map((r) => {
    const totalQty = r.settledQty + r.t1Qty;
    const avgCost = D(r.avgCost);
    const q = quoteBySymbol.get(r.instrument.symbol.toUpperCase());
    const ltp = q?.ltp ? D(q.ltp) : avgCost;
    const invested = roundPaise(avgCost.mul(totalQty));
    const current = roundPaise(ltp.mul(totalQty));
    const pnl = roundPaise(current.minus(invested));
    const pnlPct = invested.gt(0) ? roundPaise(pnl.div(invested).mul(100)).toFixed(2) : '0.00';

    totalInvested = totalInvested.plus(invested);
    totalCurrent = totalCurrent.plus(current);

    return {
      id: r.id,
      symbol: r.instrument.symbol,
      displayName: r.instrument.displayName,
      exchange: r.instrument.exchange,
      segment: r.instrument.segment,
      settledQty: r.settledQty,
      t1Qty: r.t1Qty,
      pledgedQty: r.pledgedQty ?? 0,
      totalQty,
      avgCost: avgCost.toFixed(2),
      ltp: ltp.toFixed(2),
      freshness: q?.freshness ?? 'CACHED',
      investedValue: invested.toFixed(2),
      currentValue: current.toFixed(2),
      unrealizedPnl: pnl.toFixed(2),
      unrealizedPnlPct: pnlPct,
    };
  });

  const totalPnl = roundPaise(totalCurrent.minus(totalInvested));
  return {
    account: formatAccount(account),
    holdings,
    summary: {
      count: holdings.length,
      totalInvested: roundPaise(totalInvested).toFixed(2),
      totalCurrentValue: roundPaise(totalCurrent).toFixed(2),
      totalUnrealizedPnl: totalPnl.toFixed(2),
      totalUnrealizedPnlPct: totalInvested.gt(0) ? roundPaise(totalPnl.div(totalInvested).mul(100)).toFixed(2) : '0.00',
    },
  };
}

/** One-click Exit All: cancels open orders + market-squares-off all open positions in that account. */
export async function exitAllOpenPositions(userId: string, mode: AccountMode, allowAfterHoursDemo = true) {
  const account = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  // 1. Cancel all open/pending orders in this account
  const openOrders = await prisma.order.findMany({
    where: {
      accountId: account.id,
      epoch: account.resetEpoch,
      status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING', 'PARTIALLY_FILLED'] },
    },
  });
  for (const o of openOrders) {
    await cancelOrder(userId, o.id, 'Cancelled by Exit-All').catch(() => {});
  }

  // 2. Square off all non-zero open positions
  const openPositions = await prisma.position.findMany({
    where: {
      accountId: account.id,
      epoch: account.resetEpoch,
      netQuantity: { not: 0 },
    },
    include: { instrument: true },
  });

  const exited: Array<{ symbol: string; product: string; quantity: number; side: OrderSide }> = [];
  for (const p of openPositions) {
    const exitSide: OrderSide = p.netQuantity > 0 ? 'SELL' : 'BUY';
    const qty = Math.abs(p.netQuantity);
    try {
      await placeOrder({
        userId,
        accountMode: mode,
        symbol: p.instrument.symbol,
        side: exitSide,
        product: p.product as ProductType,
        orderType: 'MARKET',
        quantity: qty,
        allowAfterHoursDemo,
      });
      exited.push({ symbol: p.instrument.symbol, product: p.product, quantity: qty, side: exitSide });
    } catch {
      // continue exiting other positions
    }
  }

  return {
    cancelledOrders: openOrders.length,
    exitedPositions: exited,
  };
}

/** Update per-account Risk & Trader's Controls (Kill Switch, Segment Locks, Auto P&L Exit, Overtrading, Cooldown). */
export async function updateAccountRiskControls(params: {
  userId: string;
  mode: AccountMode;
  killSwitchOn?: boolean;
  lockedSegments?: string[];
  maxDailyLoss?: string | number | null;
  dailyProfitTarget?: string | number | null;
  enableAutoPnlExit?: boolean;
  pnlExitKillSwitch?: boolean;
  maxOrderValue?: string | number | null;
  maxOpenOrders?: number;
  maxTradesPerDay?: number | null;
  lossStreakLimit?: number | null;
  cooldownMinutes?: number;
  clearCooldown?: boolean;
}) {
  const account = await getAccountByMode(params.userId, params.mode);
  const prisma = getPrisma();

  let cancelledOrders = 0;
  if (params.killSwitchOn === true) {
    const openOrders = await prisma.order.findMany({
      where: {
        accountId: account.id,
        epoch: account.resetEpoch,
        status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING', 'PARTIALLY_FILLED'] },
      },
    });
    for (const o of openOrders) {
      await cancelOrder(params.userId, o.id, 'Cancelled by Kill Switch activation').catch(() => {});
      cancelledOrders++;
    }
  }

  const updated = await prisma.tradingAccount.update({
    where: { id: account.id },
    data: {
      ...(params.killSwitchOn !== undefined ? { killSwitchOn: params.killSwitchOn } : {}),
      ...(params.lockedSegments !== undefined
        ? { lockedSegmentsJson: JSON.stringify(params.lockedSegments.map((s) => s.toUpperCase())) }
        : {}),
      ...(params.maxDailyLoss !== undefined
        ? { maxDailyLoss: params.maxDailyLoss === null ? null : roundPaise(params.maxDailyLoss).toFixed(2) }
        : {}),
      ...(params.dailyProfitTarget !== undefined
        ? { dailyProfitTarget: params.dailyProfitTarget === null ? null : roundPaise(params.dailyProfitTarget).toFixed(2) }
        : {}),
      ...(params.enableAutoPnlExit !== undefined ? { enableAutoPnlExit: params.enableAutoPnlExit } : {}),
      ...(params.pnlExitKillSwitch !== undefined ? { pnlExitKillSwitch: params.pnlExitKillSwitch } : {}),
      ...(params.maxOrderValue !== undefined
        ? { maxOrderValue: params.maxOrderValue === null ? null : roundPaise(params.maxOrderValue).toFixed(2) }
        : {}),
      ...(params.maxOpenOrders !== undefined ? { maxOpenOrders: params.maxOpenOrders } : {}),
      ...(params.maxTradesPerDay !== undefined ? { maxTradesPerDay: params.maxTradesPerDay } : {}),
      ...(params.lossStreakLimit !== undefined ? { lossStreakLimit: params.lossStreakLimit } : {}),
      ...(params.cooldownMinutes !== undefined ? { cooldownMinutes: params.cooldownMinutes } : {}),
      ...(params.clearCooldown ? { cooldownUntil: null } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: 'RISK_CONTROLS_UPDATED',
      entity: 'TradingAccount',
      entityId: account.id,
      details: JSON.stringify({
        mode: params.mode,
        killSwitchOn: updated.killSwitchOn,
        lockedSegments: updated.lockedSegmentsJson,
        maxDailyLoss: updated.maxDailyLoss,
        dailyProfitTarget: updated.dailyProfitTarget,
        enableAutoPnlExit: updated.enableAutoPnlExit,
        maxOrderValue: updated.maxOrderValue,
        maxOpenOrders: updated.maxOpenOrders,
        maxTradesPerDay: updated.maxTradesPerDay,
        cancelledOrders,
      }),
    },
  });

  return {
    account: formatAccount(updated),
    cancelledOrders,
  };
}

/** Position Insights: Groups open F&O positions by underlying and computes combined Payoff Graph + Net Greeks. */
export async function getPositionInsights(userId: string, mode: AccountMode) {
  const account = await getAccountByMode(userId, mode);
  const prisma = getPrisma();
  const openPos = await prisma.position.findMany({
    where: { accountId: account.id, epoch: account.resetEpoch, netQuantity: { not: 0 } },
    include: { instrument: true },
  });

  const fnoByUnderlying = new Map<string, typeof openPos>();
  for (const p of openPos) {
    if (p.instrument.segment !== 'FNO') continue;
    const root = p.instrument.symbol.split('-')[0].toUpperCase();
    const arr = fnoByUnderlying.get(root) || [];
    arr.push(p);
    fnoByUnderlying.set(root, arr);
  }

  const groups = [];
  for (const [underlying, rows] of fnoByUnderlying.entries()) {
    const [spotQ] = await marketDataService.getQuotes([underlying]).catch(() => [null]);
    const fallbackStrike = Number(rows[0]?.instrument.strikePrice || 0);
    const spotPrice = spotQ?.ltp ? Number(spotQ.ltp) : fallbackStrike > 0 ? fallbackStrike : 24000;

    const legs: StrategyLegInput[] = rows.map((r) => ({
      symbol: r.instrument.symbol,
      underlying,
      optionType: (r.instrument.optionType as 'CE' | 'PE') || 'FUT',
      side: r.netQuantity > 0 ? 'BUY' : 'SELL',
      strike: Number(r.instrument.strikePrice || 0),
      expiry: r.instrument.expiryDate || new Date().toISOString().slice(0, 10),
      quantity: Math.abs(r.netQuantity),
      premium: Number(r.netQuantity > 0 ? r.avgBuyPrice : r.avgSellPrice),
    }));

    const analysis = analyzeOptionStrategy({ spotPrice, legs });
    groups.push({ underlying, spotPrice, legCount: legs.length, legs, analysis });
  }

  return { mode, groupCount: groups.length, groups };
}

/** Portfolio Analyzer: XIRR, Sector/Segment Allocation, Concentration Risk & Tax Loss Harvesting Scanner. */
export async function getPortfolioAnalyzer(userId: string, mode: AccountMode) {
  const holdingsData = await getPortfolioHoldings(userId, mode);
  const account = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  const trades = await prisma.trade.findMany({
    where: { accountId: account.id, epoch: account.resetEpoch },
    include: { instrument: true },
    orderBy: { executedAt: 'asc' },
  });

  // Cash flows for XIRR: BUY outflows (-), SELL inflows (+), terminal portfolio market value (+)
  const cashflows: Array<{ amount: number; date: Date }> = trades.map((t) => ({
    amount: t.side === 'BUY' ? -Number(t.turnover) : Number(t.turnover),
    date: t.executedAt,
  }));
  const currentVal = Number(holdingsData.summary.totalCurrentValue);
  if (currentVal > 0 && cashflows.length > 0) {
    cashflows.push({ amount: currentVal, date: new Date() });
  }
  const xirrPct = computeXIRR(cashflows);

  const bySegment = new Map<string, number>();
  const allocations = holdingsData.holdings.map((h) => {
    const val = Number(h.currentValue);
    bySegment.set(h.segment, (bySegment.get(h.segment) || 0) + val);
    return {
      symbol: h.symbol,
      segment: h.segment,
      currentValue: h.currentValue,
      weightPct: currentVal > 0 ? Number(((val / currentVal) * 100).toFixed(2)) : 0,
      unrealizedPnl: h.unrealizedPnl,
      unrealizedPnlPct: h.unrealizedPnlPct,
    };
  });

  const taxLossHarvesting = holdingsData.holdings
    .filter((h) => Number(h.unrealizedPnl) < 0)
    .map((h) => ({
      symbol: h.symbol,
      totalQty: h.totalQty,
      avgCost: h.avgCost,
      ltp: h.ltp,
      harvestableLoss: Math.abs(Number(h.unrealizedPnl)).toFixed(2),
      estimatedTaxSaved20Pct: (Math.abs(Number(h.unrealizedPnl)) * 0.2).toFixed(2),
    }));

  const sortedByWeight = [...allocations].sort((a, b) => b.weightPct - a.weightPct);
  const top3ConcentrationPct = Number(
    sortedByWeight.slice(0, 3).reduce((s, x) => s + x.weightPct, 0).toFixed(2)
  );

  return {
    mode,
    summary: holdingsData.summary,
    xirrPct,
    top3ConcentrationPct,
    segmentBreakdown: [...bySegment.entries()].map(([segment, value]) => ({
      segment,
      value: value.toFixed(2),
      weightPct: currentVal > 0 ? Number(((value / currentVal) * 100).toFixed(2)) : 0,
    })),
    allocations: sortedByWeight,
    taxLossHarvesting,
  };
}

/** Holdings Instant Margin Pledge (credits collateralMargin after haircut). */
export async function pledgeHoldingForMargin(params: {
  userId: string;
  mode: AccountMode;
  symbol: string;
  quantity: number;
}) {
  const account = await getAccountByMode(params.userId, params.mode);
  const prisma = getPrisma();
  const holding = await prisma.holding.findFirst({
    where: {
      accountId: account.id,
      epoch: account.resetEpoch,
      instrument: { symbol: params.symbol.toUpperCase() },
    },
    include: { instrument: true },
  });
  if (!holding) throw new Error(`Holding not found for ${params.symbol}`);
  const availableToPledge = holding.settledQty + holding.t1Qty - holding.pledgedQty;
  if (params.quantity <= 0 || params.quantity > availableToPledge) {
    throw new Error(`Only ${availableToPledge} unpledged shares available for ${params.symbol}.`);
  }

  const [q] = await marketDataService.getQuotes([holding.instrument.symbol]).catch(() => [null]);
  const refPx = q?.ltp ? D(q.ltp) : D(holding.avgCost);
  const haircutPct = holding.instrument.segment === 'ETF' ? D('10.00') : D('20.00');
  const collateralVal = roundPaise(refPx.mul(params.quantity).mul(D(100).minus(haircutPct)).div(100));

  const res = await prisma.$transaction(async (tx) => {
    await tx.holding.update({
      where: { id: holding.id },
      data: { pledgedQty: holding.pledgedQty + params.quantity },
    });
    const newCollat = roundPaise(D(account.collateralMargin).plus(collateralVal));
    const updatedAcc = await tx.tradingAccount.update({
      where: { id: account.id },
      data: { collateralMargin: newCollat.toFixed(2) },
    });
    const rec = await tx.pledgeRecord.create({
      data: {
        accountId: account.id,
        instrumentId: holding.instrumentId,
        pledgedQty: params.quantity,
        referencePrice: refPx.toFixed(2),
        haircutPct: haircutPct.toFixed(2),
        collateralValue: collateralVal.toFixed(2),
        status: 'PLEDGED',
      },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        epoch: account.resetEpoch,
        entryType: 'PLEDGE',
        debit: '0.00',
        credit: collateralVal.toFixed(2),
        runningBalance: updatedAcc.cashBalance,
        referenceId: rec.id,
        description: `Pledged ${params.quantity} ${holding.instrument.symbol} (${haircutPct.toFixed(0)}% haircut -> ₹${collateralVal.toFixed(2)} collateral)`,
      },
    });
    return { record: rec, account: formatAccount(updatedAcc) };
  });

  return res;
}

export async function unpledgeHoldingMargin(params: {
  userId: string;
  mode: AccountMode;
  pledgeId: string;
}) {
  const account = await getAccountByMode(params.userId, params.mode);
  const prisma = getPrisma();
  const rec = await prisma.pledgeRecord.findFirst({
    where: { id: params.pledgeId, accountId: account.id, status: 'PLEDGED' },
    include: { instrument: true },
  });
  if (!rec) throw new Error('Active pledge record not found');

  const res = await prisma.$transaction(async (tx) => {
    await tx.pledgeRecord.update({ where: { id: rec.id }, data: { status: 'UNPLEDGED' } });
    const holding = await tx.holding.findUnique({
      where: {
        accountId_epoch_instrumentId: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: rec.instrumentId,
        },
      },
    });
    if (holding) {
      await tx.holding.update({
        where: { id: holding.id },
        data: { pledgedQty: Math.max(0, holding.pledgedQty - rec.pledgedQty) },
      });
    }
    const nextCollat = roundPaise(D(account.collateralMargin).minus(D(rec.collateralValue)));
    const clampedCollat = nextCollat.lt(0) ? ZERO : nextCollat;
    const updatedAcc = await tx.tradingAccount.update({
      where: { id: account.id },
      data: { collateralMargin: clampedCollat.toFixed(2) },
    });
    return { unpledged: true, pledgeId: rec.id, account: formatAccount(updatedAcc) };
  });
  return res;
}

/** MTF (4x Leveraged Delivery) positions & Convert MTF -> CNC Delivery. */
export async function getMtfPositions(userId: string, mode: AccountMode) {
  const account = await getAccountByMode(userId, mode);
  const prisma = getPrisma();
  const rows = await prisma.mtfPosition.findMany({
    where: { accountId: account.id, epoch: account.resetEpoch, status: 'OPEN' },
    include: { instrument: true },
    orderBy: { createdAt: 'desc' },
  });
  const quotes = rows.length
    ? await marketDataService.getQuotes(rows.map((r) => r.instrument.symbol)).catch(() => [])
    : [];
  const qMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const positions = rows.map((r) => {
    const q = qMap.get(r.instrument.symbol.toUpperCase());
    const ltp = q?.ltp ? D(q.ltp) : D(r.avgPrice);
    const daysHeld = Math.max(1, Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000));
    const estInterest = roundPaise(
      D(r.fundedAmount).mul(D(r.interestRatePct).div(100)).mul(daysHeld).div(365)
    );
    const pnl = roundPaise(ltp.minus(D(r.avgPrice)).mul(r.quantity));
    return {
      id: r.id,
      symbol: r.instrument.symbol,
      displayName: r.instrument.displayName,
      quantity: r.quantity,
      avgPrice: r.avgPrice,
      ltp: ltp.toFixed(2),
      leverage: r.leverage,
      clientMargin: r.clientMargin,
      fundedAmount: r.fundedAmount,
      interestRatePct: r.interestRatePct,
      estimatedInterest: estInterest.toFixed(2),
      unrealizedPnl: pnl.toFixed(2),
      createdAt: r.createdAt.toISOString(),
    };
  });
  return { mode, count: positions.length, positions };
}

export async function convertMtfToCnc(params: { userId: string; mode: AccountMode; mtfId: string }) {
  const account = await getAccountByMode(params.userId, params.mode);
  const prisma = getPrisma();
  const mtf = await prisma.mtfPosition.findFirst({
    where: { id: params.mtfId, accountId: account.id, status: 'OPEN' },
    include: { instrument: true },
  });
  if (!mtf) throw new Error('Open MTF position not found');

  const payoffNeeded = roundPaise(D(mtf.fundedAmount).plus(D(mtf.accruedInterest)));
  const avail = roundPaise(D(account.cashBalance).minus(D(account.blockedMargin)));
  if (avail.lt(payoffNeeded)) {
    throw new Error(`Insufficient cash to convert MTF → CNC. Required: ₹${payoffNeeded.toFixed(2)}, Available: ₹${avail.toFixed(2)}.`);
  }

  return prisma.$transaction(async (tx) => {
    const newCash = roundPaise(D(account.cashBalance).minus(payoffNeeded));
    const updatedAcc = await tx.tradingAccount.update({
      where: { id: account.id },
      data: { cashBalance: newCash.toFixed(2) },
    });
    await tx.mtfPosition.update({ where: { id: mtf.id }, data: { status: 'CONVERTED' } });
    const existing = await tx.holding.findUnique({
      where: {
        accountId_epoch_instrumentId: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: mtf.instrumentId,
        },
      },
    });
    await tx.holding.upsert({
      where: {
        accountId_epoch_instrumentId: {
          accountId: account.id,
          epoch: account.resetEpoch,
          instrumentId: mtf.instrumentId,
        },
      },
      create: {
        accountId: account.id,
        epoch: account.resetEpoch,
        instrumentId: mtf.instrumentId,
        settledQty: 0,
        t1Qty: mtf.quantity,
        avgCost: mtf.avgPrice,
      },
      update: {
        t1Qty: (existing?.t1Qty ?? 0) + mtf.quantity,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        accountId: account.id,
        epoch: account.resetEpoch,
        entryType: 'TRADE',
        debit: payoffNeeded.toFixed(2),
        credit: '0.00',
        runningBalance: newCash.toFixed(2),
        referenceId: mtf.id,
        description: `Converted ${mtf.quantity} ${mtf.instrument.symbol} from MTF → CNC Delivery (paid funded balance ₹${payoffNeeded.toFixed(2)})`,
      },
    });
    return { converted: true, symbol: mtf.instrument.symbol, quantity: mtf.quantity, account: formatAccount(updatedAcc) };
  });
}
