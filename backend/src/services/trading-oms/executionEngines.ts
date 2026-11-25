import {
  D,
  NormalizedQuote,
  OrderSide,
  OrderStatus,
  OrderType,
  roundPaise,
} from '@broker/shared';

export interface ExecutionRequest {
  orderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice: string | null;
  triggerPrice: string | null;
  validity: 'DAY' | 'IOC' | 'GTT';
  isAmo: boolean;
  quote: NormalizedQuote;
}

export interface ExecutionOutcome {
  status: OrderStatus;
  filledQuantity: number;
  fillPrice: string | null;
  message: string;
  externalOrderId?: string;
}

export interface ExecutionEngine {
  readonly mode: 'DEMO' | 'REAL';
  submit(req: ExecutionRequest): Promise<ExecutionOutcome>;
}

/**
 * Simulate realistic fill price walking the 5-level order-book depth (or LTP fallback).
 * Supports partial fills on IOC when visible book depth is thinner than order quantity.
 */
function simulateMarketFillFromBook(
  side: OrderSide,
  quantity: number,
  quote: NormalizedQuote,
  validity: 'DAY' | 'IOC' | 'GTT'
): { filledQty: number; vwapPrice: string | null; note: string } {
  const levels = side === 'BUY' ? quote.askDepth : quote.bidDepth;
  const validLevels = (levels || []).filter((l) => Number(l.price) > 0 && l.quantity > 0);

  if (validLevels.length > 0) {
    let remaining = quantity;
    let totalCost = D(0);
    let filled = 0;

    for (const lvl of validLevels) {
      const take = Math.min(remaining, lvl.quantity);
      totalCost = totalCost.plus(D(lvl.price).mul(take));
      filled += take;
      remaining -= take;
      if (remaining === 0) break;
    }

    if (remaining > 0 && validity === 'IOC') {
      const avg = filled > 0 ? roundPaise(totalCost.div(filled)).toFixed(2) : null;
      return {
        filledQty: filled,
        vwapPrice: avg,
        note: `IOC partial fill across visible depth (${filled}/${quantity} filled; remainder cancelled)`,
      };
    }

    // If DAY order exceeds top 5 levels, absorb remainder at last visible depth level (realistic slippage)
    if (remaining > 0) {
      const tailPx = D(validLevels[validLevels.length - 1].price);
      totalCost = totalCost.plus(tailPx.mul(remaining));
      filled += remaining;
    }

    return {
      filledQty: filled,
      vwapPrice: roundPaise(totalCost.div(filled)).toFixed(2),
      note: 'Filled at live order-book bid/ask depth',
    };
  }

  // Fallback when depth is empty (e.g., outside live tick stream / REST LTP snapshot)
  if (!quote.ltp || D(quote.ltp).lte(0)) {
    return { filledQty: 0, vwapPrice: null, note: 'No live market price available' };
  }

  return {
    filledQty: quantity,
    vwapPrice: roundPaise(quote.ltp).toFixed(2),
    note: 'Filled at live market LTP',
  };
}

/**
 * DemoExecutionEngine — NEVER routes to any external broker or exchange.
 * Simulates realistic order matching strictly against live market prices & depth.
 */
export class DemoExecutionEngine implements ExecutionEngine {
  public readonly mode = 'DEMO' as const;

  public async submit(req: ExecutionRequest): Promise<ExecutionOutcome> {
    if (req.isAmo) {
      return {
        status: 'OPEN',
        filledQuantity: 0,
        fillPrice: null,
        message: 'AMO accepted and queued for next market open session.',
      };
    }

    const ltp = req.quote.ltp ? D(req.quote.ltp) : null;
    const bestAsk = req.quote.askDepth?.[0]?.price && D(req.quote.askDepth[0].price).gt(0)
      ? D(req.quote.askDepth[0].price)
      : ltp;
    const bestBid = req.quote.bidDepth?.[0]?.price && D(req.quote.bidDepth[0].price).gt(0)
      ? D(req.quote.bidDepth[0].price)
      : ltp;

    // 1. MARKET / BO / CO / SUPER immediate entry
    if (req.orderType === 'MARKET' || ((req.orderType === 'BO' || req.orderType === 'CO' || req.orderType === 'SUPER') && !req.limitPrice)) {
      const sim = simulateMarketFillFromBook(req.side, req.quantity, req.quote, req.validity);
      if (sim.filledQty === 0 || !sim.vwapPrice) {
        return { status: 'REJECTED', filledQuantity: 0, fillPrice: null, message: sim.note };
      }
      return {
        status: sim.filledQty < req.quantity ? 'PARTIALLY_FILLED' : 'FILLED',
        filledQuantity: sim.filledQty,
        fillPrice: sim.vwapPrice,
        message: sim.note,
      };
    }

    // 2. LIMIT (or Limit-entry BO/CO/SUPER)
    if (req.orderType === 'LIMIT' || ((req.orderType === 'BO' || req.orderType === 'CO' || req.orderType === 'SUPER') && req.limitPrice)) {
      const limit = D(req.limitPrice!);
      const marketable =
        (req.side === 'BUY' && bestAsk != null && limit.gte(bestAsk)) ||
        (req.side === 'SELL' && bestBid != null && limit.lte(bestBid));

      if (marketable) {
        const execPx = req.side === 'BUY' ? bestAsk! : bestBid!;
        return {
          status: 'FILLED',
          filledQuantity: req.quantity,
          fillPrice: roundPaise(execPx).toFixed(2),
          message: `Limit order filled immediately at ₹${roundPaise(execPx).toFixed(2)} (better than/equal to limit ₹${limit.toFixed(2)}).`,
        };
      }

      if (req.validity === 'IOC') {
        return {
          status: 'CANCELLED',
          filledQuantity: 0,
          fillPrice: null,
          message: 'IOC limit order did not match immediately and was cancelled.',
        };
      }

      return {
        status: 'OPEN',
        filledQuantity: 0,
        fillPrice: null,
        message: `Limit order resting on DEMO book at ₹${limit.toFixed(2)}.`,
      };
    }

    // 3. Stop-Loss (SL / SL_M) & GTT (Forever)
    if (req.orderType === 'SL' || req.orderType === 'SL_M' || req.orderType === 'GTT') {
      const trigger = req.triggerPrice ? D(req.triggerPrice) : null;
      if (!trigger || trigger.lte(0)) {
        return { status: 'REJECTED', filledQuantity: 0, fillPrice: null, message: 'Trigger price is required.' };
      }
      return {
        status: 'TRIGGER_PENDING',
        filledQuantity: 0,
        fillPrice: null,
        message: `${req.orderType} order armed at trigger ₹${trigger.toFixed(2)}.`,
      };
    }

    return { status: 'OPEN', filledQuantity: 0, fillPrice: null, message: 'Order queued.' };
  }
}

/**
 * RealExecutionBroker (Pluggable Mock Adapter — Phase 3 foundation, full adapter in Phase 7).
 *
 * COMPLIANCE NOTE (Section 3 & COMPLIANCE.md):
 * Going live with REAL orders for public users requires being, or partnering with,
 * a SEBI-registered Stock Broker (NSE/BSE/MCX membership, NCL/ICCL/MCXCCL clearing,
 * CDSL/NSDL DP, KYC/AML, and RMS). Never bypass this requirement.
 */
export class MockRealExecutionBroker implements ExecutionEngine {
  public readonly mode = 'REAL' as const;

  public async submit(req: ExecutionRequest): Promise<ExecutionOutcome> {
    // Uses identical live-market price semantics inside the mock broker adapter,
    // tagging every order with a mock external broker reference until a licensed broker route is wired.
    const demoSim = new DemoExecutionEngine();
    const outcome = await demoSim.submit(req);
    return {
      ...outcome,
      externalOrderId: `MOCK-REAL-${req.orderId.slice(0, 8).toUpperCase()}`,
      message: `[Mock Broker Adapter] ${outcome.message}`,
    };
  }
}

export const demoExecutionEngine = new DemoExecutionEngine();
export const realExecutionBroker = new MockRealExecutionBroker();
