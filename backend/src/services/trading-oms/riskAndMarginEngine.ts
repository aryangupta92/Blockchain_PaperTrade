import {
  calculateTradeCharges,
  ChargeBreakdownResult,
  D,
  Decimal,
  ExchangeCode,
  InstrumentKind,
  MarketSegment,
  OrderSide,
  OrderType,
  pctToRate,
  ProductType,
  resolveRegulatoryConfig,
  roundPaise,
  ZERO,
} from '@broker/shared';
import { getMarketSession } from '../market-data/marketSessionClock';

export interface RiskInstrumentMeta {
  id: string;
  symbol: string;
  exchange: ExchangeCode;
  segment: MarketSegment;
  instrumentKind: InstrumentKind;
  lotSize: number;
  tickSize: string;
  freezeQty: number | null;
  expiryDate: string | null;
  inFnoBan: boolean;
  varElmMarginPct: string;
  mtfLeverage?: string;
}

export interface RiskCheckInput {
  account: {
    id: string;
    mode: 'DEMO' | 'REAL';
    cashBalance: string;
    blockedMargin: string;
    collateralMargin?: string;
    killSwitchOn: boolean;
    lockedSegments?: string[];
    maxDailyLoss: string | null;
    maxOrderValue: string | null;
    maxOpenOrders: number;
    maxTradesPerDay?: number | null;
    cooldownUntil?: Date | null;
  };
  instrument: RiskInstrumentMeta;
  side: OrderSide;
  product: ProductType;
  orderType: OrderType;
  quantity: number;
  executionPrice: string; // Limit price or current LTP for market
  triggerPrice?: string | null;
  stopLoss?: string | null;
  target?: string | null;
  trailingJump?: string | null;
  isAmo: boolean;
  prevClose?: string | null;
  openOrdersCount: number;
  todayTradeCount?: number;
  dayRealizedPnl: string;
  existingHoldingQty: { settledQty: number; t1Qty: number };
  existingPositionNetQty: number;
  /** Optional date override for deterministic tests. */
  now?: Date;
  /** Allow Demo learning trades outside live exchange hours when explicitly opted in by caller/test. */
  allowAfterHoursDemo?: boolean;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  violations: Array<{ code: string; message: string }>;
  warnings: string[];
  requiredMargin: string;
  estimatedCharges: ChargeBreakdownResult;
  totalCashNeeded: string;
  availableMargin: string;
  effectiveLeverage: string;
  varElmPctUsed: string;
  isClosingOrder: boolean;
  requiresSlicing: boolean;
  sliceQuantities: number[];
}

function isMultipleOfTick(priceStr: string, tickStr: string): boolean {
  const px = D(priceStr);
  const tick = D(tickStr);
  if (tick.lte(0)) return true;
  const remainder = px.mod(tick);
  return remainder.isZero() || remainder.minus(tick).abs().lt('0.0001');
}

export function evaluatePreTradeRiskAndMargin(input: RiskCheckInput): RiskEvaluationResult {
  const violations: Array<{ code: string; message: string }> = [];
  const warnings: string[] = [];
  const now = input.now ?? new Date();
  const cfg = resolveRegulatoryConfig(now);
  const inst = input.instrument;

  // 1. Account Kill Switch, Segment Lock & Behavioral Cooldown
  if (input.account.killSwitchOn) {
    violations.push({
      code: 'KILL_SWITCH_ACTIVE',
      message: 'Kill Switch is active on this account. Disable it in Trader Controls before placing orders.',
    });
  }
  if (input.account.lockedSegments && input.account.lockedSegments.includes(inst.segment)) {
    violations.push({
      code: 'SEGMENT_LOCKED',
      message: `${inst.segment} trading is locked in your Trader Controls. Unlock the segment to place new orders.`,
    });
  }
  if (input.account.cooldownUntil && input.account.cooldownUntil.getTime() > now.getTime()) {
    const mins = Math.ceil((input.account.cooldownUntil.getTime() - now.getTime()) / 60_000);
    violations.push({
      code: 'LOSS_STREAK_COOLDOWN_ACTIVE',
      message: `Behavioral trading cooldown is active (${mins} min remaining) to prevent revenge trading.`,
    });
  }

  // 2. Index spot cannot be directly traded
  if (inst.instrumentKind === 'INDEX') {
    violations.push({
      code: 'NON_TRADABLE_INDEX',
      message: `${inst.symbol} is a spot index and cannot be traded directly. Select an Index Future or Option contract.`,
    });
  }

  // 3. Market hours & AMO validation (SEBI / Exchange trading sessions)
  const session = getMarketSession(now);
  const segSession = inst.segment === 'COMM' ? session.commoditiesMcx : session.equityAndFno;
  if (!segSession.isTradable && !input.isAmo) {
    if (input.account.mode === 'DEMO' && input.allowAfterHoursDemo) {
      warnings.push(
        `Exchange session is currently ${segSession.phase} (${segSession.hoursIST}). Order simulated in DEMO learning mode using latest market price.`
      );
    } else {
      violations.push({
        code: 'MARKET_CLOSED',
        message: `Market is currently ${segSession.phase} (trading hours ${segSession.hoursIST}). Enable AMO (After-Market Order) to queue for next market open.`,
      });
    }
  }

  // 4. Quantity, lot size & freeze-quantity slicing
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    violations.push({ code: 'INVALID_QTY', message: 'Quantity must be a positive integer.' });
  } else if (inst.lotSize > 1 && input.quantity % inst.lotSize !== 0) {
    violations.push({
      code: 'INVALID_LOT_MULTIPLE',
      message: `Quantity (${input.quantity}) must be a multiple of lot size ${inst.lotSize} for ${inst.symbol}.`,
    });
  }

  const sliceQuantities: number[] = [];
  let requiresSlicing = false;
  if (inst.freezeQty && input.quantity > inst.freezeQty) {
    requiresSlicing = true;
    let remaining = input.quantity;
    while (remaining > 0) {
      const chunk = Math.min(remaining, inst.freezeQty);
      sliceQuantities.push(chunk);
      remaining -= chunk;
    }
    warnings.push(
      `Quantity exceeds exchange freeze limit (${inst.freezeQty}). Order will be auto-sliced into ${sliceQuantities.length} slices.`
    );
  } else if (input.quantity > 0) {
    sliceQuantities.push(input.quantity);
  }

  // 5. Tick size & Price Band / Circuit Limit validation
  const px = D(input.executionPrice);
  if (px.lte(0)) {
    violations.push({ code: 'INVALID_PRICE', message: 'Execution price must be greater than zero.' });
  } else {
    if (['LIMIT', 'SL', 'BO', 'CO', 'SUPER', 'GTT'].includes(input.orderType) && !isMultipleOfTick(input.executionPrice, inst.tickSize)) {
      violations.push({
        code: 'INVALID_TICK_SIZE',
        message: `Price ₹${px.toFixed(2)} must be a multiple of tick size ₹${inst.tickSize}.`,
      });
    }
    if (input.prevClose && D(input.prevClose).gt(0) && input.orderType !== 'MARKET') {
      const ref = D(input.prevClose);
      const bandPct = D('0.20'); // Standard 20% circuit band validation
      const lower = roundPaise(ref.mul(D(1).minus(bandPct)));
      const upper = roundPaise(ref.mul(D(1).plus(bandPct)));
      if (px.lt(lower) || px.gt(upper)) {
        violations.push({
          code: 'PRICE_BAND_BREACH',
          message: `Order price ₹${px.toFixed(2)} is outside the exchange circuit price band (₹${lower.toFixed(2)} – ₹${upper.toFixed(2)}).`,
        });
      }
    }
  }

  // 6. Bracket / Cover / Super Order price relationship validation
  if (['BO', 'CO', 'SUPER'].includes(input.orderType)) {
    if (!input.stopLoss || D(input.stopLoss).lte(0)) {
      violations.push({ code: 'STOP_LOSS_REQUIRED', message: `${input.orderType} order requires a valid stopLoss price.` });
    } else {
      const sl = D(input.stopLoss);
      if (input.side === 'BUY' && sl.gte(px)) {
        violations.push({ code: 'INVALID_STOP_LOSS', message: 'For BUY orders, stop-loss must be strictly below entry price.' });
      }
      if (input.side === 'SELL' && sl.lte(px)) {
        violations.push({ code: 'INVALID_STOP_LOSS', message: 'For SELL orders, stop-loss must be strictly above entry price.' });
      }
    }
    if (input.orderType === 'BO' || input.orderType === 'SUPER') {
      if (!input.target || D(input.target).lte(0)) {
        violations.push({ code: 'TARGET_REQUIRED', message: `${input.orderType} order requires a valid target price.` });
      } else {
        const tgt = D(input.target);
        if (input.side === 'BUY' && tgt.lte(px)) {
          violations.push({ code: 'INVALID_TARGET', message: 'For BUY orders, target must be strictly above entry price.' });
        }
        if (input.side === 'SELL' && tgt.gte(px)) {
          violations.push({ code: 'INVALID_TARGET', message: 'For SELL orders, target must be strictly below entry price.' });
        }
      }
    }
    if (input.orderType === 'SUPER' && input.trailingJump && D(input.trailingJump).lte(0)) {
      violations.push({ code: 'INVALID_TRAILING_JUMP', message: 'Trailing stop-loss jump must be a positive number.' });
    }
  }

  // 7. Product & Segment compatibility (SEBI rules)
  if ((inst.segment === 'EQ' || inst.segment === 'ETF') && input.product === 'NRML') {
    violations.push({
      code: 'INVALID_PRODUCT',
      message: 'Cash Equity and ETFs support CNC (Delivery), MTF (Margin Trading), or MIS (Intraday), not NRML.',
    });
  }
  if ((inst.segment === 'FNO' || inst.segment === 'COMM') && (input.product === 'CNC' || input.product === 'MTF')) {
    violations.push({
      code: 'INVALID_PRODUCT',
      message: 'Derivatives (F&O / Commodities) support NRML (Carry-forward) or MIS (Intraday), not CNC or MTF.',
    });
  }

  // 8. Equity Delivery (CNC) No Short Selling Rule + T+1 BTST notice
  const totalHeld = input.existingHoldingQty.settledQty + input.existingHoldingQty.t1Qty;
  const isDeliverySell = (inst.segment === 'EQ' || inst.segment === 'ETF') && input.product === 'CNC' && input.side === 'SELL';
  if (isDeliverySell) {
    if (totalHeld < input.quantity) {
      violations.push({
        code: 'CNC_SHORT_SELL_FORBIDDEN',
        message: `Delivery (CNC) short selling is not permitted by SEBI. You hold ${totalHeld} shares of ${inst.symbol} (requested sell: ${input.quantity}). Use MIS for intraday short selling.`,
      });
    } else if (input.existingHoldingQty.settledQty < input.quantity && input.existingHoldingQty.t1Qty > 0) {
      warnings.push(
        `BTST / T+1 Notice: Selling unsettled T+1 shares (${input.existingHoldingQty.t1Qty} qty). Under SEBI T+1 rules, short-delivery auction risk applies in live markets.`
      );
    }
  }

  // 9. Determine if this order reduces/closes an existing position (reduces margin requirement)
  const isClosingPosition =
    (input.side === 'SELL' && input.existingPositionNetQty > 0 && input.quantity <= input.existingPositionNetQty) ||
    (input.side === 'BUY' && input.existingPositionNetQty < 0 && input.quantity <= Math.abs(input.existingPositionNetQty));
  const isClosingOrder = isDeliverySell || isClosingPosition;

  // 10. F&O Ban Period Enforcement (SEBI MWPL > 95% rule)
  if (inst.inFnoBan && !isClosingOrder) {
    violations.push({
      code: 'FNO_BAN_PERIOD',
      message: `${inst.symbol} is currently in the exchange F&O Ban Period. Only position-reducing (closing) orders are permitted.`,
    });
  }

  // 11. Account-level Risk Limits (Max Open Orders, Max Order Value, Max Daily Loss)
  const orderValue = roundPaise(px.mul(input.quantity));
  if (input.openOrdersCount >= input.account.maxOpenOrders) {
    violations.push({
      code: 'MAX_OPEN_ORDERS_REACHED',
      message: `Maximum open orders limit (${input.account.maxOpenOrders}) reached.`,
    });
  }
  if (input.account.maxOrderValue && orderValue.gt(D(input.account.maxOrderValue))) {
    violations.push({
      code: 'MAX_ORDER_VALUE_EXCEEDED',
      message: `Order value ₹${orderValue.toFixed(2)} exceeds your configured max order value ₹${D(input.account.maxOrderValue).toFixed(2)}.`,
    });
  }
  if (input.account.maxDailyLoss && !isClosingOrder) {
    const realized = D(input.dayRealizedPnl);
    if (realized.lt(0) && realized.abs().gte(D(input.account.maxDailyLoss))) {
      violations.push({
        code: 'MAX_DAILY_LOSS_BREACHED',
        message: `Daily realized loss limit (₹${D(input.account.maxDailyLoss).toFixed(2)}) reached. Only closing orders are allowed.`,
      });
    }
  }
  if (
    input.account.maxTradesPerDay &&
    !isClosingOrder &&
    (input.todayTradeCount ?? 0) >= input.account.maxTradesPerDay
  ) {
    violations.push({
      code: 'MAX_TRADES_PER_DAY_REACHED',
      message: `Overtrading guard triggered: You reached your daily limit of ${input.account.maxTradesPerDay} trades. Only closing orders are permitted.`,
    });
  }

  // 12. Charges Calculation (identical in DEMO and REAL — Rule 1.5)
  const estimatedCharges = calculateTradeCharges({
    exchange: inst.exchange,
    segment: inst.segment,
    instrumentKind: inst.instrumentKind,
    product: input.product,
    side: input.side,
    quantity: Math.max(1, input.quantity),
    price: px.gt(0) ? px.toFixed(2) : '0',
    applyDpCharge: isDeliverySell,
    asOfDate: now,
    config: cfg,
  });

  // 13. Upfront Margin Calculation (SEBI Peak Margin & F&O Framework)
  let requiredMargin: Decimal = ZERO;
  let varElmPctUsed = inst.varElmMarginPct;
  let effectiveLeverage = '1.00';

  if (!isClosingOrder && px.gt(0) && input.quantity > 0) {
    if ((inst.segment === 'EQ' || inst.segment === 'ETF') && input.product === 'CNC') {
      // Equity Delivery: 100% upfront cash
      requiredMargin = orderValue;
      varElmPctUsed = '100.00';
      effectiveLeverage = '1.00';
    } else if ((inst.segment === 'EQ' || inst.segment === 'ETF') && input.product === 'MTF') {
      // Margin Trading Facility (MTF): up to 4x leverage based on detailed scrip master MTF_LEVERAGE
      const lev = Decimal.max(D('1.00'), D(inst.mtfLeverage || '4.00'));
      requiredMargin = roundPaise(orderValue.div(lev));
      varElmPctUsed = roundPaise(D(100).div(lev)).toFixed(2);
      effectiveLeverage = lev.toFixed(2);
    } else if ((inst.segment === 'EQ' || inst.segment === 'ETF') && input.product === 'MIS') {
      // Equity Intraday: VaR + ELM per instrument (typically 20%–25% -> 4x–5x, never hardcoded flat 5x)
      const pct = D(inst.varElmMarginPct);
      requiredMargin = roundPaise(orderValue.mul(pctToRate(pct)));
      effectiveLeverage = D(100).div(pct).toFixed(2);
    } else if (inst.instrumentKind === 'OPTIONS' && input.side === 'BUY') {
      // SEBI Circular SEBI/HO/MRD/TPD/P/CIR/2024/132 (effective Feb 1, 2025): 100% upfront option premium
      requiredMargin = orderValue;
      varElmPctUsed = cfg.fnoRules.value.upfrontOptionPremiumPct;
      effectiveLeverage = '1.00';
    } else if (inst.instrumentKind === 'OPTIONS' && input.side === 'SELL') {
      // Short option: SPAN + Exposure + extra 2% ELM on expiry day (SEBI circular)
      const isExpiryDay = inst.expiryDate === session.istDate;
      const basePct = D('18.00');
      const extraElm = isExpiryDay ? D(cfg.fnoRules.value.expiryDayShortOptionExtraElmPct) : ZERO;
      const totalPct = basePct.plus(extraElm);
      // Approximate notional using strike or 10x premium when strike unavailable
      const notional = orderValue.mul(10);
      requiredMargin = roundPaise(notional.mul(pctToRate(totalPct)));
      varElmPctUsed = totalPct.toFixed(2);
      if (isExpiryDay) {
        warnings.push(
          `SEBI Expiry-Day Rule: Additional +${extraElm.toFixed(0)}% Extreme Loss Margin (ELM) applied to short options on expiry day.`
        );
      }
    } else {
      // Futures (F&O / MCX): SPAN + Exposure %
      const pct = D(inst.varElmMarginPct);
      requiredMargin = roundPaise(orderValue.mul(pctToRate(pct)));
      effectiveLeverage = D(100).div(pct).toFixed(2);
    }
  }

  // 14. Available Funds Check (SEBI 50:50 Cash-to-Collateral rule for F&O/MIS; pure cash for CNC/Option Buy)
  const cashBal = D(input.account.cashBalance);
  const collat = D(input.account.collateralMargin || '0.00');
  const allowsCollateral =
    input.product === 'MIS' ||
    (input.product === 'NRML' && !(inst.instrumentKind === 'OPTIONS' && input.side === 'BUY'));
  const usableCollateral = allowsCollateral && cashBal.gt(0) ? Decimal.min(collat, cashBal) : ZERO;
  const available = roundPaise(cashBal.plus(usableCollateral).minus(D(input.account.blockedMargin)));
  const totalCashNeeded = isClosingOrder
    ? D(estimatedCharges.totalCharges)
    : roundPaise(requiredMargin.plus(D(estimatedCharges.totalCharges)));

  if (!isClosingOrder && available.lt(totalCashNeeded)) {
    violations.push({
      code: 'INSUFFICIENT_MARGIN',
      message: `Insufficient available margin in ${input.account.mode} account. Required: ₹${totalCashNeeded.toFixed(2)} (Margin ₹${requiredMargin.toFixed(2)} + Charges ₹${estimatedCharges.totalCharges}), Available: ₹${available.toFixed(2)}.`,
    });
  }

  return {
    allowed: violations.length === 0,
    violations,
    warnings,
    requiredMargin: requiredMargin.toFixed(2),
    estimatedCharges,
    totalCashNeeded: totalCashNeeded.toFixed(2),
    availableMargin: available.toFixed(2),
    effectiveLeverage,
    varElmPctUsed,
    isClosingOrder,
    requiresSlicing,
    sliceQuantities,
  };
}
