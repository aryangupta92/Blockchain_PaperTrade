import { AccountMode, D, NormalizedQuote, ProductType, resolveRegulatoryConfig, roundPaise, ZERO } from '@broker/shared';
import { getPrisma } from '../../infrastructure/database';
import { liveFeed } from '../market-data/liveWebSocketFeed';
import { getMarketSession } from '../market-data/marketSessionClock';
import { placeOrder, runMisAutoSquareOff, settleOrderFill } from './orderManagementService';
import { exitAllOpenPositions } from './portfolioService';

/**
 * Evaluate whether a resting LIMIT / SL / SL_M / GTT order should trigger at `ltp`.
 */
export function shouldTriggerOrder(
  order: { side: string; orderType: string; price: string | null; triggerPrice: string | null },
  ltp: number
): boolean {
  if (!Number.isFinite(ltp) || ltp <= 0) return false;
  const px = D(ltp);

  if (order.orderType === 'LIMIT' && order.price) {
    const limit = D(order.price);
    return order.side === 'BUY' ? px.lte(limit) : px.gte(limit);
  }

  if ((order.orderType === 'SL' || order.orderType === 'SL_M' || order.orderType === 'GTT') && order.triggerPrice) {
    const trig = D(order.triggerPrice);
    // Stop-Loss SELL exits when price falls <= trigger; Stop-Loss BUY exits when price rises >= trigger
    return order.side === 'BUY' ? px.gte(trig) : px.lte(trig);
  }

  return false;
}

/**
 * Super Order Trailing Stop-Loss Ratchet:
 * Moves stopLoss favorably whenever LTP advances by at least `trailingJump`.
 */
export function computeRatchetedStopLoss(params: {
  side: 'BUY' | 'SELL'; // Original entry side ('BUY' for long position, 'SELL' for short position)
  currentStopLoss: string;
  trailingJump: string;
  ltp: string;
}): string | null {
  const sl = D(params.currentStopLoss);
  const jump = D(params.trailingJump);
  const px = D(params.ltp);
  if (jump.lte(0)) return null;

  if (params.side === 'BUY') {
    const candidate = roundPaise(px.minus(jump));
    if (candidate.gt(sl)) return candidate.toFixed(2);
  } else {
    const candidate = roundPaise(px.plus(jump));
    if (candidate.lt(sl)) return candidate.toFixed(2);
  }
  return null;
}

class OmsTickMonitor {
  private started = false;
  private misSquareOffRanDate: string | null = null;
  private processingOrders = new Set<string>();
  private processingForever = new Set<string>();
  private processingPnlExit = new Set<string>();

  public start(): void {
    if (this.started) return;
    this.started = true;

    liveFeed.onQuote((quote) => {
      this.onQuoteTick(quote).catch(() => {});
    });

    // Scheduled MIS auto square-off checker (effective-dated `misAutoSquareOffIST`, default 15:15 IST)
    const timer = setInterval(() => {
      const session = getMarketSession();
      if (!session.weekday || session.holidayName) return;
      const cfg = resolveRegulatoryConfig();
      const targetHm = cfg.fnoRules.value.misAutoSquareOffIST;
      const nowHm = session.istTime.slice(11, 16);
      if (nowHm >= targetHm && nowHm <= '15:25' && this.misSquareOffRanDate !== session.istDate) {
        this.misSquareOffRanDate = session.istDate;
        runMisAutoSquareOff().catch(() => {});
      }
    }, 30_000);
    timer.unref?.();
  }

  public async onQuoteTick(quote: NormalizedQuote): Promise<void> {
    if (!quote.ltp) return;
    const ltpNum = Number(quote.ltp);
    if (!Number.isFinite(ltpNum) || ltpNum <= 0) return;

    const prisma = getPrisma();
    const symUp = quote.symbol.toUpperCase();

    // 1. Evaluate resting Orders + Super Order Trailing Stop-Loss Ratchet
    const pending = await prisma.order.findMany({
      where: {
        status: { in: ['OPEN', 'TRIGGER_PENDING'] },
        isAmo: false,
        instrument: { symbol: symUp },
      },
      take: 50,
    });

    for (const order of pending) {
      if (this.processingOrders.has(order.id)) continue;

      // Ratchet Super Order trailing stop-loss BEFORE checking trigger
      if (
        order.legRole === 'STOP_LOSS' &&
        order.trailingJump &&
        D(order.trailingJump).gt(0) &&
        order.triggerPrice
      ) {
        const entrySide: 'BUY' | 'SELL' = order.side === 'SELL' ? 'BUY' : 'SELL';
        const ratcheted = computeRatchetedStopLoss({
          side: entrySide,
          currentStopLoss: order.triggerPrice,
          trailingJump: order.trailingJump,
          ltp: quote.ltp,
        });
        if (ratcheted) {
          await prisma.order
            .update({
              where: { id: order.id },
              data: {
                triggerPrice: ratcheted,
                stopLoss: ratcheted,
                peakPrice: quote.ltp,
                events: {
                  create: {
                    status: order.status,
                    message: `Trailing SL ratcheted to ₹${ratcheted} (LTP ₹${quote.ltp}, jump ₹${order.trailingJump}).`,
                  },
                },
              },
            })
            .catch(() => {});
          order.triggerPrice = ratcheted;
          order.stopLoss = ratcheted;
        }
      }

      if (!shouldTriggerOrder(order, ltpNum)) continue;

      this.processingOrders.add(order.id);
      try {
        const execPx = order.orderType === 'LIMIT' && order.price ? order.price : quote.ltp;
        await settleOrderFill({
          orderId: order.id,
          fillQuantity: order.quantity - order.filledQuantity,
          fillPrice: execPx,
          eventMessage: `${order.legRole || order.orderType} triggered by live tick @ ₹${quote.ltp}`,
        });
      } catch {
        // Skip transient settlement failures; retry next tick
      } finally {
        this.processingOrders.delete(order.id);
      }
    }

    // 2. Evaluate Active Forever Orders (GTT Single & OCO — 365-day persistent triggers)
    const activeForever = await prisma.foreverOrder.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        instrument: { symbol: symUp },
      },
      include: { account: true, instrument: true },
      take: 30,
    });

    for (const fo of activeForever) {
      if (this.processingForever.has(fo.id)) continue;
      let firedLimit: string | null = null;
      let firedLabel = 'Primary trigger';

      const trig1 = Number(fo.triggerPrice);
      const trig2 = fo.triggerPrice2 ? Number(fo.triggerPrice2) : null;

      if (fo.orderFlag === 'OCO' && trig2 != null && fo.limitPrice2) {
        if (ltpNum >= trig1) {
          firedLimit = fo.limitPrice;
          firedLabel = 'OCO Target trigger';
        } else if (ltpNum <= trig2) {
          firedLimit = fo.limitPrice2;
          firedLabel = 'OCO Stop-Loss trigger';
        }
      } else {
        const hit = fo.triggerDirection === 'LTE' ? ltpNum <= trig1 : ltpNum >= trig1;
        if (hit) firedLimit = fo.limitPrice;
      }

      if (!firedLimit) continue;
      this.processingForever.add(fo.id);
      try {
        const placed = await placeOrder({
          userId: fo.account.userId,
          accountMode: fo.account.mode as AccountMode,
          symbol: fo.instrument.symbol,
          side: fo.side as 'BUY' | 'SELL',
          product: fo.product as ProductType,
          orderType: 'LIMIT',
          quantity: fo.quantity,
          price: firedLimit,
          quoteOverride: quote,
          allowAfterHoursDemo: fo.account.mode === 'DEMO',
        });
        await prisma.foreverOrder.update({
          where: { id: fo.id },
          data: { status: 'TRIGGERED', triggeredOrderId: placed.order.id },
        });
      } catch {
        // Keep active if transient
      } finally {
        this.processingForever.delete(fo.id);
      }
      void firedLabel;
    }

    // 3. Evaluate Active Conditional Price Triggers
    const activeCond = await prisma.conditionalTrigger.findMany({
      where: { status: 'ACTIVE', symbol: symUp, expiresAt: { gt: new Date() } },
      include: { account: true },
      take: 20,
    });
    for (const ct of activeCond) {
      try {
        const cond = JSON.parse(ct.conditionJson) as { indicator: string; operator: string; value: number };
        if (cond.indicator !== 'LTP') continue;
        const met =
          (cond.operator === 'GT' && ltpNum > cond.value) ||
          (cond.operator === 'GTE' && ltpNum >= cond.value) ||
          (cond.operator === 'LT' && ltpNum < cond.value) ||
          (cond.operator === 'LTE' && ltpNum <= cond.value) ||
          (cond.operator === 'CROSSES_ABOVE' && ltpNum >= cond.value) ||
          (cond.operator === 'CROSSES_BELOW' && ltpNum <= cond.value);
        if (!met) continue;

        const orders = JSON.parse(ct.ordersJson) as Array<{
          symbol: string;
          side: 'BUY' | 'SELL';
          product: ProductType;
          orderType: 'MARKET' | 'LIMIT';
          quantity: number;
          price?: number;
        }>;
        for (const o of orders) {
          await placeOrder({
            userId: ct.account.userId,
            accountMode: ct.account.mode as AccountMode,
            symbol: o.symbol,
            side: o.side,
            product: o.product,
            orderType: o.orderType,
            quantity: o.quantity,
            price: o.price ?? null,
            quoteOverride: o.symbol.toUpperCase() === symUp ? quote : undefined,
            allowAfterHoursDemo: ct.account.mode === 'DEMO',
          }).catch(() => {});
        }
        await prisma.conditionalTrigger.update({
          where: { id: ct.id },
          data: {
            status: ct.frequency === 'RECURRING' ? 'ACTIVE' : 'TRIGGERED',
            triggeredAt: new Date(),
          },
        });
      } catch {
        // ignore malformed condition
      }
    }

    // 4. Evaluate Active Price Alerts
    const activeAlerts = await prisma.priceAlert.findMany({
      where: { status: 'ACTIVE', symbol: symUp },
      take: 30,
    });
    for (const alert of activeAlerts) {
      const target = Number(alert.targetValue);
      const chgPct = quote.changePercent ? Math.abs(Number(quote.changePercent)) : 0;
      const hit =
        (alert.condition === 'PRICE_ABOVE' && ltpNum >= target) ||
        (alert.condition === 'PRICE_BELOW' && ltpNum <= target) ||
        (alert.condition === 'PCT_MOVE' && chgPct >= target);
      if (hit) {
        await prisma.priceAlert
          .update({ where: { id: alert.id }, data: { status: 'TRIGGERED', triggeredAt: new Date() } })
          .catch(() => {});
      }
    }

    // 5. Evaluate Live Auto P&L Exit (Trader's Controls)
    await this.evaluateAutoPnlExit(symUp, ltpNum).catch(() => {});
  }

  /**
   * Auto P&L Exit Engine: monitors accounts with `enableAutoPnlExit = true` and
   * automatically squares off all open positions (+ optional Kill Switch lock)
   * when combined realized + unrealized MTM breaches profit target or max loss.
   */
  public async evaluateAutoPnlExit(triggerSymbol: string, ltpNum: number): Promise<void> {
    const prisma = getPrisma();
    const candidateAccounts = await prisma.tradingAccount.findMany({
      where: {
        enableAutoPnlExit: true,
        positions: {
          some: { netQuantity: { not: 0 }, instrument: { symbol: triggerSymbol } },
        },
      },
      include: {
        positions: { include: { instrument: true } },
      },
      take: 20,
    });

    for (const acc of candidateAccounts) {
      if (this.processingPnlExit.has(acc.id)) continue;
      const epochPositions = acc.positions.filter((p) => p.epoch === acc.resetEpoch);
      if (!epochPositions.some((p) => p.netQuantity !== 0)) continue;

      let totalPnl = ZERO;
      for (const p of epochPositions) {
        totalPnl = totalPnl.plus(D(p.realizedPnl));
        if (p.netQuantity !== 0) {
          const avg = p.netQuantity > 0 ? D(p.avgBuyPrice) : D(p.avgSellPrice);
          const curLtp =
            p.instrument.symbol.toUpperCase() === triggerSymbol ? D(ltpNum) : avg;
          const m2m =
            p.netQuantity > 0
              ? curLtp.minus(avg).mul(p.netQuantity)
              : avg.minus(curLtp).mul(Math.abs(p.netQuantity));
          totalPnl = totalPnl.plus(m2m);
        }
      }

      const hitProfit = acc.dailyProfitTarget && totalPnl.gte(D(acc.dailyProfitTarget));
      const hitLoss = acc.maxDailyLoss && totalPnl.lte(D(acc.maxDailyLoss).neg());
      if (!hitProfit && !hitLoss) continue;

      this.processingPnlExit.add(acc.id);
      try {
        await exitAllOpenPositions(acc.userId, acc.mode as AccountMode, true);
        if (acc.pnlExitKillSwitch) {
          await prisma.tradingAccount.update({
            where: { id: acc.id },
            data: { killSwitchOn: true },
          });
        }
        await prisma.auditLog.create({
          data: {
            userId: acc.userId,
            action: 'AUTO_PNL_EXIT_TRIGGERED',
            entity: 'TradingAccount',
            entityId: acc.id,
            details: JSON.stringify({
              mode: acc.mode,
              reason: hitProfit ? 'PROFIT_TARGET_HIT' : 'MAX_DAILY_LOSS_HIT',
              totalPnl: roundPaise(totalPnl).toFixed(2),
              killSwitchActivated: acc.pnlExitKillSwitch,
            }),
          },
        });
      } finally {
        this.processingPnlExit.delete(acc.id);
      }
    }
  }
}

export const omsTickMonitor = new OmsTickMonitor();
