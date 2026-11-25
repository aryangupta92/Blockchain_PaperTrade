import { D, ZERO, Decimal, pctToRate, roundNearestRupee, roundPaise } from './decimalMoney';
import { resolveRegulatoryConfig, EffectiveRegulatorySnapshot } from './sebiRegulatoryConfig';
import { ExchangeCode, InstrumentKind, MarketSegment, OrderSide, ProductType } from './marketTypes';

export interface ChargeCalculationInput {
  exchange: ExchangeCode;
  segment: MarketSegment;
  instrumentKind: InstrumentKind;
  product: ProductType;
  side: OrderSide;
  quantity: number;
  price: string | number;
  /** Only for ITM options exercised at expiry (Finance Act 2026: 0.15% on intrinsic value). */
  isOptionExercise?: boolean;
  /** Strike price needed when computing intrinsic value on exercised options. */
  strikePrice?: string | number;
  /** True when selling CNC equity/ETF from demat holdings (adds DP charge once per scrip/day). */
  applyDpCharge?: boolean;
  /** Execution date (ISO YYYY-MM-DD or Date) to look up effective-dated tax/fee rates. */
  asOfDate?: Date | string;
  /** Optional explicit regulatory config snapshot override. */
  config?: EffectiveRegulatorySnapshot;
}

export interface ChargeBreakdownResult {
  asOfDate: string;
  turnover: string;
  brokerage: string;
  sttOrCtt: string;
  exchangeTransactionCharge: string;
  sebiTurnoverFee: string;
  stampDuty: string;
  dpChargeExclGst: string;
  gst: string;
  totalCharges: string;
  netCashImpact: string;
  citations: {
    stt: string;
    exchangeCharges: string;
    stampDuty: string;
    brokerage: string;
  };
  educationalNote: string;
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

/**
 * Compute full statutory + brokerage charges for a single executed trade leg.
 * Applied identically in BOTH DEMO and REAL accounts (Rule 1.5).
 */
export function calculateTradeCharges(input: ChargeCalculationInput): ChargeBreakdownResult {
  const cfg = input.config ?? resolveRegulatoryConfig(input.asOfDate);
  const qty = D(input.quantity);
  const px = D(input.price);
  const turnover = roundPaise(qty.mul(px));

  const isEquityCash =
    (input.segment === 'EQ' || input.segment === 'ETF') &&
    (input.instrumentKind === 'EQUITY' || input.instrumentKind === 'ETF');
  const isDelivery = isEquityCash && (input.product === 'CNC' || input.product === 'MTF');
  const isIntradayEq = isEquityCash && input.product === 'MIS';
  const isEqFutures = input.segment === 'FNO' && input.instrumentKind === 'FUTURES';
  const isEqOptions = input.segment === 'FNO' && input.instrumentKind === 'OPTIONS';
  const isMcxFutures = input.segment === 'COMM' && input.instrumentKind === 'FUTURES';
  const isMcxOptions = input.segment === 'COMM' && input.instrumentKind === 'OPTIONS';

  // 1. Brokerage (effective-dated plan)
  const b = cfg.brokerage.value;
  let brokerage = ZERO;
  if (isDelivery) {
    const raw = turnover.mul(pctToRate(b.eqDeliveryPct));
    const maxCap = D(b.eqDeliveryMaxPerOrder);
    brokerage = maxCap.gt(0) ? minDecimal(raw, maxCap) : raw;
  } else if (isIntradayEq) {
    brokerage = minDecimal(turnover.mul(pctToRate(b.eqIntradayPct)), D(b.eqIntradayMaxPerOrder));
  } else if (isEqFutures) {
    brokerage = minDecimal(turnover.mul(pctToRate(b.fnoFuturesPct)), D(b.fnoFuturesMaxPerOrder));
  } else if (isEqOptions) {
    brokerage = D(b.fnoOptionsFlatPerOrder);
  } else if (isMcxFutures) {
    brokerage = minDecimal(turnover.mul(pctToRate(b.mcxFuturesPct)), D(b.mcxFuturesMaxPerOrder));
  } else if (isMcxOptions) {
    brokerage = D(b.mcxOptionsFlatPerOrder);
  }
  brokerage = roundPaise(brokerage);

  // 2. STT / CTT (Finance Act 2026 effective 2026-04-01; historical preserved via asOfDate)
  const sttCfg = cfg.stt.value;
  let sttRaw = ZERO;
  if (isDelivery) {
    const pct = input.side === 'BUY' ? sttCfg.eqDeliveryBuyPct : sttCfg.eqDeliverySellPct;
    sttRaw = turnover.mul(pctToRate(pct));
  } else if (isIntradayEq && input.side === 'SELL') {
    sttRaw = turnover.mul(pctToRate(sttCfg.eqIntradaySellPct));
  } else if (isEqFutures && input.side === 'SELL') {
    sttRaw = turnover.mul(pctToRate(sttCfg.fnoFuturesSellPct));
  } else if (isEqOptions) {
    if (input.isOptionExercise) {
      // Exercised option STT applies on intrinsic value (price is intrinsic or settlement - strike)
      const intrinsicPerUnit =
        input.strikePrice !== undefined ? D(input.price).minus(D(input.strikePrice)).abs() : px;
      const intrinsicTurnover = qty.mul(intrinsicPerUnit);
      sttRaw = intrinsicTurnover.mul(pctToRate(sttCfg.fnoOptionsExerciseIntrinsicPct));
    } else if (input.side === 'SELL') {
      sttRaw = turnover.mul(pctToRate(sttCfg.fnoOptionsSellPremiumPct));
    }
  } else if (isMcxFutures && input.side === 'SELL') {
    sttRaw = turnover.mul(pctToRate(sttCfg.mcxNonAgriFuturesSellPct));
  } else if (isMcxOptions && input.side === 'SELL') {
    sttRaw = turnover.mul(pctToRate(sttCfg.mcxNonAgriOptionsSellPremiumPct));
  }
  const sttOrCtt = sttCfg.roundToNearestRupee ? roundNearestRupee(sttRaw) : roundPaise(sttRaw);

  // 3. Exchange Transaction Charges (both buy & sell)
  const ex = cfg.exchangeCharges.value;
  let exchPct = '0';
  if (isEquityCash) {
    exchPct = input.exchange === 'BSE' ? ex.bseEqPct : ex.nseEqPct;
  } else if (isEqFutures) {
    exchPct = input.exchange === 'BSE' ? ex.bseFuturesPct : ex.nseFuturesPct;
  } else if (isEqOptions) {
    exchPct = input.exchange === 'BSE' ? ex.bseOptionsPremiumPct : ex.nseOptionsPremiumPct;
  } else if (isMcxFutures) {
    exchPct = ex.mcxFuturesPct;
  } else if (isMcxOptions) {
    exchPct = ex.mcxOptionsPremiumPct;
  }
  const exchangeTransactionCharge = roundPaise(turnover.mul(pctToRate(exchPct)));

  // 4. SEBI Turnover Fee (0.0001% = ₹10/crore on both sides)
  const sebiTurnoverFee = roundPaise(turnover.mul(pctToRate(cfg.sebiTurnoverFeePct.value)));

  // 5. Stamp Duty (Indian Stamp Act — buy side only)
  const sd = cfg.stampDuty.value;
  let stampRaw = ZERO;
  if (input.side === 'BUY') {
    if (isDelivery) stampRaw = turnover.mul(pctToRate(sd.eqDeliveryBuyPct));
    else if (isIntradayEq) stampRaw = turnover.mul(pctToRate(sd.eqIntradayBuyPct));
    else if (isEqFutures) stampRaw = turnover.mul(pctToRate(sd.fnoFuturesBuyPct));
    else if (isEqOptions) stampRaw = turnover.mul(pctToRate(sd.fnoOptionsBuyPremiumPct));
    else if (isMcxFutures) stampRaw = turnover.mul(pctToRate(sd.mcxFuturesBuyPct));
    else if (isMcxOptions) stampRaw = turnover.mul(pctToRate(sd.mcxOptionsBuyPremiumPct));
  }
  const stampDuty = roundPaise(stampRaw);

  // 6. DP Charges (Delivery sell from demat holdings, excl. GST)
  const dpChargeExclGst =
    isDelivery && input.side === 'SELL' && input.applyDpCharge
      ? roundPaise(cfg.dpSellChargePerScripExclGst.value)
      : ZERO;

  // 7. GST (18% on Brokerage + Exchange Transaction Charges + SEBI Turnover Fee + DP Charges)
  const gstTaxableBase = brokerage.plus(exchangeTransactionCharge).plus(sebiTurnoverFee).plus(dpChargeExclGst);
  const gst = roundPaise(gstTaxableBase.mul(pctToRate(cfg.gstPct.value)));

  // 8. Totals
  const totalCharges = roundPaise(
    brokerage
      .plus(sttOrCtt)
      .plus(exchangeTransactionCharge)
      .plus(sebiTurnoverFee)
      .plus(stampDuty)
      .plus(dpChargeExclGst)
      .plus(gst)
  );

  // Net cash impact: BUY reduces cash by turnover + charges; SELL credits turnover - charges
  const netCashImpact =
    input.side === 'BUY'
      ? roundPaise(turnover.plus(totalCharges).neg())
      : roundPaise(turnover.minus(totalCharges));

  return {
    asOfDate: cfg.asOfDate,
    turnover: turnover.toFixed(2),
    brokerage: brokerage.toFixed(2),
    sttOrCtt: sttOrCtt.toFixed(2),
    exchangeTransactionCharge: exchangeTransactionCharge.toFixed(2),
    sebiTurnoverFee: sebiTurnoverFee.toFixed(2),
    stampDuty: stampDuty.toFixed(2),
    dpChargeExclGst: dpChargeExclGst.toFixed(2),
    gst: gst.toFixed(2),
    totalCharges: totalCharges.toFixed(2),
    netCashImpact: netCashImpact.toFixed(2),
    citations: {
      stt: cfg.stt.citation,
      exchangeCharges: cfg.exchangeCharges.citation,
      stampDuty: cfg.stampDuty.citation,
      brokerage: cfg.brokerage.citation,
    },
    educationalNote:
      'Charges shown are calculated using identical SEBI/exchange statutory rates in both DEMO and REAL accounts.',
  };
}
