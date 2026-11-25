import { D, roundPaise, ZERO } from './decimalMoney';
import { resolveRegulatoryConfig } from './sebiRegulatoryConfig';

export interface StrategyLegInput {
  symbol: string;
  underlying: string;
  optionType: 'CE' | 'PE' | 'FUT';
  side: 'BUY' | 'SELL';
  strike: number; // 0 for FUT
  expiry: string; // YYYY-MM-DD
  quantity: number; // total qty (lots * lotSize)
  premium: number; // LTP / entry price
  iv?: number | null; // Implied Volatility in % (e.g. 14.5)
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
  targetPnl?: number; // T+0 / target-date simulated BSM P&L
}

export type OiBuildupType =
  | 'LONG_BUILDUP'
  | 'SHORT_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_UNWINDING'
  | 'NEUTRAL';

/** 4-quadrant Derivatives OI Buildup classifier. */
export function classifyOiBuildup(priceChange: number, oiChange: number): OiBuildupType {
  if (!Number.isFinite(priceChange) || !Number.isFinite(oiChange) || oiChange === 0 || priceChange === 0) {
    return 'NEUTRAL';
  }
  if (priceChange > 0 && oiChange > 0) return 'LONG_BUILDUP';
  if (priceChange < 0 && oiChange > 0) return 'SHORT_BUILDUP';
  if (priceChange > 0 && oiChange < 0) return 'SHORT_COVERING';
  return 'LONG_UNWINDING';
}

/** Standard Normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard Normal CDF (Abramowitz & Stegun 7.1.26, max error < 7.5e-8). */
export function normCdf(x: number): number {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

/** Black-Scholes-Merton European option price. */
export function bsmOptionPrice(params: {
  spot: number;
  strike: number;
  timeYears: number; // T > 0
  riskFreeRate?: number; // default 0.065 (India 6.5%)
  volatility: number; // decimal sigma, e.g. 0.15 for 15% IV
  optionType: 'CE' | 'PE';
}): number {
  const { spot, strike, optionType } = params;
  const r = params.riskFreeRate ?? 0.065;
  const T = Math.max(0, params.timeYears);
  const sigma = Math.max(0.005, params.volatility);

  if (T <= 1e-6) {
    return optionType === 'CE' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discK = strike * Math.exp(-r * T);

  if (optionType === 'CE') {
    return Math.max(0, spot * normCdf(d1) - discK * normCdf(d2));
  }
  return Math.max(0, discK * normCdf(-d2) - spot * normCdf(-d1));
}

/** Black-Scholes-Merton analytical Greeks (per 1 unit). */
export function bsmGreeks(params: {
  spot: number;
  strike: number;
  timeYears: number;
  riskFreeRate?: number;
  volatility: number;
  optionType: 'CE' | 'PE';
}) {
  const { spot, strike, optionType } = params;
  const r = params.riskFreeRate ?? 0.065;
  const T = Math.max(1 / 3650, params.timeYears);
  const sigma = Math.max(0.005, params.volatility);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdfD1 = normPdf(d1);

  const delta = optionType === 'CE' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdfD1 / (spot * sigma * sqrtT);
  const vega = (spot * pdfD1 * sqrtT) / 100; // per 1% IV change
  const thetaAnnual =
    optionType === 'CE'
      ? -(spot * pdfD1 * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * normCdf(d2)
      : -(spot * pdfD1 * sigma) / (2 * sqrtT) + r * strike * Math.exp(-r * T) * normCdf(-d2);
  const theta = thetaAnnual / 365; // per calendar day

  return {
    delta: Number(delta.toFixed(4)),
    gamma: Number(gamma.toFixed(6)),
    theta: Number(theta.toFixed(2)),
    vega: Number(vega.toFixed(2)),
  };
}

export interface StrategyAnalysisResult {
  spotPrice: number;
  simulatedSpot: number;
  daysToExpiry: number;
  targetDaysRemaining: number;
  avgIvPct: number;
  ivShiftPct: number;
  netPremiumFlow: string; // Positive = Net Credit, Negative = Net Debit
  maxProfit: string; // "UNLIMITED" or exact INR string
  maxLoss: string;   // "UNLIMITED" or exact INR string
  riskRewardRatio: string | null;
  probabilityOfProfitPct: number;
  expectedMove1SD: { low: number; high: number; points: number };
  expectedMove2SD: { low: number; high: number; points: number };
  breakevens: number[];
  netGreeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  marginEstimate: {
    unhedgedMargin: string;
    hedgedMargin: string;
    hedgeBenefit: string;
    extraExpiryElmApplied: boolean;
    calendarSpreadBenefitStripped: boolean;
    warnings: string[];
  };
  payoffCurve: PayoffPoint[];
}

function legExpiryPnl(leg: StrategyLegInput, expirySpot: number): number {
  const dir = leg.side === 'BUY' ? 1 : -1;
  if (leg.optionType === 'FUT') {
    return (expirySpot - leg.premium) * leg.quantity * dir;
  }
  const intrinsic =
    leg.optionType === 'CE'
      ? Math.max(0, expirySpot - leg.strike)
      : Math.max(0, leg.strike - expirySpot);
  return (intrinsic - leg.premium) * leg.quantity * dir;
}

function legTargetDatePnl(
  leg: StrategyLegInput,
  simSpot: number,
  remainingYears: number,
  ivShiftPct: number,
  fallbackIvPct: number
): number {
  const dir = leg.side === 'BUY' ? 1 : -1;
  if (leg.optionType === 'FUT') {
    return (simSpot - leg.premium) * leg.quantity * dir;
  }
  const baseIv = leg.iv && leg.iv > 0 ? leg.iv : fallbackIvPct;
  const sigma = Math.max(0.02, (baseIv + ivShiftPct) / 100);
  const theo = bsmOptionPrice({
    spot: simSpot,
    strike: leg.strike,
    timeYears: remainingYears,
    volatility: sigma,
    optionType: leg.optionType,
  });
  return (theo - leg.premium) * leg.quantity * dir;
}

/**
 * Compute Probability of Profit (POP%) under lognormal terminal distribution
 * across all positive-P&L intervals on the expiry payoff curve.
 */
function computeProbabilityOfProfit(
  curve: PayoffPoint[],
  spotPrice: number,
  sigma: number,
  timeYears: number,
  riskFreeRate = 0.065
): number {
  if (curve.length < 2 || spotPrice <= 0) return 50;
  const T = Math.max(1 / 365, timeYears);
  const volSqrtT = Math.max(0.01, sigma * Math.sqrt(T));
  const drift = (riskFreeRate - 0.5 * sigma * sigma) * T;
  const zOf = (s: number) =>
    s <= 0 ? -Infinity : (Math.log(s / spotPrice) - drift) / volSqrtT;

  let prob = 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (a.pnl > 0 && b.pnl > 0) {
      prob += normCdf(zOf(b.spot)) - normCdf(zOf(a.spot));
    } else if (a.pnl <= 0 && b.pnl > 0) {
      const ratio = Math.abs(a.pnl) / (Math.abs(a.pnl) + b.pnl);
      const cross = a.spot + (b.spot - a.spot) * ratio;
      prob += normCdf(zOf(b.spot)) - normCdf(zOf(cross));
    } else if (a.pnl > 0 && b.pnl <= 0) {
      const ratio = a.pnl / (a.pnl + Math.abs(b.pnl));
      const cross = a.spot + (b.spot - a.spot) * ratio;
      prob += normCdf(zOf(cross)) - normCdf(zOf(a.spot));
    }
  }
  // Include left & right tail probabilities beyond grid bounds if profitable
  if (curve[0].pnl > 0) prob += normCdf(zOf(curve[0].spot));
  if (curve[curve.length - 1].pnl > 0) prob += 1 - normCdf(zOf(curve[curve.length - 1].spot));

  return Number(Math.max(0, Math.min(100, prob * 100)).toFixed(1));
}

/**
 * Pure expiry + T+0 BSM What-If payoff & SEBI-compliant hedge-margin analyzer.
 * Enforces SEBI/HO/MRD/TPD/P/CIR/2024/132:
 *  - 100% upfront option premium on BUY legs (Feb 1, 2025)
 *  - Calendar-spread margin benefit stripped on near-month expiry day (Feb 1, 2025)
 *  - +2% extra ELM on short index options on expiry day
 */
export function analyzeOptionStrategy(params: {
  spotPrice: number;
  legs: StrategyLegInput[];
  asOfDate?: string; // YYYY-MM-DD (IST)
  targetDaysOffset?: number; // 0 = T+0 (today), up to DTE
  ivShiftPct?: number; // e.g. -5 to +10% IV shock
  spotShiftPct?: number; // e.g. -5 to +5% spot slider
}): StrategyAnalysisResult {
  const { spotPrice, legs } = params;
  const asOf = params.asOfDate || new Date().toISOString().slice(0, 10);
  const cfg = resolveRegulatoryConfig(asOf);
  const ivShiftPct = params.ivShiftPct ?? 0;
  const spotShiftPct = params.spotShiftPct ?? 0;
  const simulatedSpot = Number((spotPrice * (1 + spotShiftPct / 100)).toFixed(2));

  // Determine nearest expiry DTE & average IV
  const uniqueExpiries = [...new Set(legs.map((l) => l.expiry).filter(Boolean))].sort();
  const nearExpiryMs = uniqueExpiries[0] ? new Date(`${uniqueExpiries[0]}T10:00:00Z`).getTime() : NaN;
  const asOfMs = new Date(`${asOf}T06:00:00Z`).getTime();
  const rawDte = Number.isFinite(nearExpiryMs) ? Math.max(0.5, (nearExpiryMs - asOfMs) / 86_400_000) : 7;
  const daysToExpiry = Number(rawDte.toFixed(1));
  const daysElapsed = Math.max(0, Math.min(daysToExpiry, params.targetDaysOffset ?? 0));
  const targetDaysRemaining = Number(Math.max(0, daysToExpiry - daysElapsed).toFixed(1));
  const remainingYears = targetDaysRemaining / 365;

  const legIvs = legs.map((l) => l.iv).filter((v): v is number => typeof v === 'number' && v > 0);
  const avgIvPct = legIvs.length ? Number((legIvs.reduce((a, b) => a + b, 0) / legIvs.length).toFixed(2)) : 15;
  const sigma = Math.max(0.05, (avgIvPct + ivShiftPct) / 100);

  // 1. Net premium flow & Net Greeks (falling back to BSM Greeks when not provided)
  let netFlow = ZERO;
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;

  for (const leg of legs) {
    const sign = leg.side === 'BUY' ? 1 : -1;
    const premTotal = D(leg.premium).mul(leg.quantity);
    netFlow = leg.side === 'SELL' ? netFlow.plus(premTotal) : netFlow.minus(premTotal);

    let g = {
      delta: leg.delta ?? null,
      gamma: leg.gamma ?? null,
      theta: leg.theta ?? null,
      vega: leg.vega ?? null,
    };
    if (leg.optionType !== 'FUT' && g.delta == null && leg.strike > 0) {
      const calc = bsmGreeks({
        spot: simulatedSpot,
        strike: leg.strike,
        timeYears: Math.max(1 / 365, remainingYears),
        volatility: Math.max(0.05, ((leg.iv || avgIvPct) + ivShiftPct) / 100),
        optionType: leg.optionType,
      });
      g = calc;
    }

    delta += (g.delta ?? (leg.optionType === 'FUT' ? 1 : 0)) * leg.quantity * sign;
    gamma += (g.gamma ?? 0) * leg.quantity * sign;
    theta += (g.theta ?? 0) * leg.quantity * sign;
    vega += (g.vega ?? 0) * leg.quantity * sign;
  }

  // 2. Payoff curve from spot - 15% to spot + 15% (61 grid points + exact strike points)
  const lowSpot = Math.max(1, Math.floor(spotPrice * 0.85));
  const highSpot = Math.ceil(spotPrice * 1.15);
  const step = Math.max(1, (highSpot - lowSpot) / 60);
  const gridSet = new Set<number>();
  for (let i = 0; i <= 60; i++) gridSet.add(Number((lowSpot + i * step).toFixed(2)));
  for (const leg of legs) {
    if (leg.strike > 0) gridSet.add(leg.strike);
  }
  gridSet.add(spotPrice);
  gridSet.add(simulatedSpot);

  const spots = [...gridSet].sort((a, b) => a - b);
  const payoffCurve: PayoffPoint[] = spots.map((s) => ({
    spot: s,
    pnl: Number(legs.reduce((sum, leg) => sum + legExpiryPnl(leg, s), 0).toFixed(2)),
    targetPnl: Number(
      legs.reduce((sum, leg) => sum + legTargetDatePnl(leg, s, remainingYears, ivShiftPct, avgIvPct), 0).toFixed(2)
    ),
  }));

  // Breakeven detection (sign crossings along sorted payoff curve)
  const breakevens: number[] = [];
  for (let i = 1; i < payoffCurve.length; i++) {
    const a = payoffCurve[i - 1];
    const b = payoffCurve[i];
    if (a.pnl === 0) {
      breakevens.push(a.spot);
    } else if ((a.pnl < 0 && b.pnl > 0) || (a.pnl > 0 && b.pnl < 0)) {
      const ratio = Math.abs(a.pnl) / (Math.abs(a.pnl) + Math.abs(b.pnl));
      breakevens.push(Number((a.spot + (b.spot - a.spot) * ratio).toFixed(2)));
    }
  }

  // Tail slope check for Unlimited profit / loss
  const upperSlope =
    legs.reduce((s, l) => s + (l.optionType === 'PE' ? 0 : l.quantity * (l.side === 'BUY' ? 1 : -1)), 0);
  const lowerSlope =
    legs.reduce((s, l) => s + (l.optionType === 'CE' ? 0 : l.quantity * (l.side === 'BUY' ? -1 : 1)), 0);

  const pnls = payoffCurve.map((p) => p.pnl);
  const minPnl = pnls.length ? Math.min(...pnls) : 0;
  const maxPnl = pnls.length ? Math.max(...pnls) : 0;

  const maxProfit = upperSlope > 0 ? 'UNLIMITED' : roundPaise(maxPnl).toFixed(2);
  const maxLoss = upperSlope < 0 || lowerSlope < 0 ? 'UNLIMITED' : roundPaise(Math.min(0, minPnl)).toFixed(2);
  const riskRewardRatio =
    maxProfit !== 'UNLIMITED' && maxLoss !== 'UNLIMITED' && Math.abs(minPnl) > 0
      ? `1 : ${(maxPnl / Math.abs(minPnl)).toFixed(2)}`
      : null;

  // Expected Move ±1 SD & ±2 SD + Probability of Profit
  const move1SD = Number((spotPrice * sigma * Math.sqrt(Math.max(1 / 365, daysToExpiry / 365))).toFixed(2));
  const expectedMove1SD = {
    low: Number((spotPrice - move1SD).toFixed(2)),
    high: Number((spotPrice + move1SD).toFixed(2)),
    points: move1SD,
  };
  const expectedMove2SD = {
    low: Number((spotPrice - 2 * move1SD).toFixed(2)),
    high: Number((spotPrice + 2 * move1SD).toFixed(2)),
    points: Number((2 * move1SD).toFixed(2)),
  };
  const probabilityOfProfitPct = computeProbabilityOfProfit(
    payoffCurve,
    simulatedSpot,
    sigma,
    daysToExpiry / 365
  );

  // 3. SEBI Hedge Margin & Calendar Spread / Expiry-Day ELM Analysis
  const warnings: string[] = [];
  let unhedgedMargin = ZERO;
  let buyPremiumUpfront = ZERO;
  let shortSpanMargin = ZERO;
  let extraExpiryElmApplied = false;

  const isCalendarSpread = uniqueExpiries.length > 1;
  const nearExpiryIsToday = uniqueExpiries.length > 0 && uniqueExpiries[0] === asOf;
  const calendarSpreadBenefitStripped =
    isCalendarSpread && nearExpiryIsToday && !cfg.fnoRules.value.calendarSpreadBenefitOnExpiryDay;

  if (calendarSpreadBenefitStripped) {
    warnings.push(
      'SEBI Expiry-Day Calendar Spread Rule (Circular SEBI/HO/MRD/TPD/P/CIR/2024/132): Calendar spread margin benefit is removed on the expiry day of the near-month contract.'
    );
  }

  let buyCallQty = 0;
  let buyPutQty = 0;
  let sellCallQty = 0;
  let sellPutQty = 0;

  for (const leg of legs) {
    const legNotional = D(leg.strike > 0 ? leg.strike : spotPrice).mul(leg.quantity);
    if (leg.optionType === 'FUT') {
      const m = roundPaise(legNotional.mul('0.15'));
      unhedgedMargin = unhedgedMargin.plus(m);
      shortSpanMargin = shortSpanMargin.plus(m);
    } else if (leg.side === 'BUY') {
      const prem = roundPaise(D(leg.premium).mul(leg.quantity));
      buyPremiumUpfront = buyPremiumUpfront.plus(prem);
      unhedgedMargin = unhedgedMargin.plus(prem);
      if (leg.optionType === 'CE') buyCallQty += leg.quantity;
      if (leg.optionType === 'PE') buyPutQty += leg.quantity;
    } else {
      const isExpiry = leg.expiry === asOf;
      const baseRate = D('0.16');
      const extraElm = isExpiry ? D(cfg.fnoRules.value.expiryDayShortOptionExtraElmPct).div(100) : ZERO;
      if (isExpiry) extraExpiryElmApplied = true;
      const m = roundPaise(legNotional.mul(baseRate.plus(extraElm)));
      unhedgedMargin = unhedgedMargin.plus(m);
      shortSpanMargin = shortSpanMargin.plus(m);
      if (leg.optionType === 'CE') sellCallQty += leg.quantity;
      if (leg.optionType === 'PE') sellPutQty += leg.quantity;
    }
  }

  if (extraExpiryElmApplied) {
    warnings.push(
      `SEBI Expiry-Day Rule: Additional +${cfg.fnoRules.value.expiryDayShortOptionExtraElmPct}% ELM applied to short options expiring today.`
    );
  }

  let hedgeBenefit = ZERO;
  if (!calendarSpreadBenefitStripped && shortSpanMargin.gt(0)) {
    const hedgedCallRatio = sellCallQty > 0 ? Math.min(1, buyCallQty / sellCallQty) : 0;
    const hedgedPutRatio = sellPutQty > 0 ? Math.min(1, buyPutQty / sellPutQty) : 0;
    const avgHedgeRatio =
      sellCallQty + sellPutQty > 0
        ? (hedgedCallRatio * sellCallQty + hedgedPutRatio * sellPutQty) / (sellCallQty + sellPutQty)
        : 0;
    if (avgHedgeRatio > 0) {
      hedgeBenefit = roundPaise(shortSpanMargin.mul(D(avgHedgeRatio)).mul('0.60'));
    }
  }

  const hedgedMargin = roundPaise(unhedgedMargin.minus(hedgeBenefit));

  return {
    spotPrice,
    simulatedSpot,
    daysToExpiry,
    targetDaysRemaining,
    avgIvPct,
    ivShiftPct,
    netPremiumFlow: roundPaise(netFlow).toFixed(2),
    maxProfit,
    maxLoss,
    riskRewardRatio,
    probabilityOfProfitPct,
    expectedMove1SD,
    expectedMove2SD,
    breakevens: [...new Set(breakevens)],
    netGreeks: {
      delta: Number(delta.toFixed(2)),
      gamma: Number(gamma.toFixed(4)),
      theta: Number(theta.toFixed(2)),
      vega: Number(vega.toFixed(2)),
    },
    marginEstimate: {
      unhedgedMargin: roundPaise(unhedgedMargin).toFixed(2),
      hedgedMargin: hedgedMargin.toFixed(2),
      hedgeBenefit: hedgeBenefit.toFixed(2),
      extraExpiryElmApplied,
      calendarSpreadBenefitStripped,
      warnings,
    },
    payoffCurve,
  };
}

// ── All 16 Pre-Built Option Strategy Templates (Bullish / Bearish / Neutral / Volatility) ──
export interface OptionStrategyTemplate {
  id: string;
  name: string;
  outlook: 'BULLISH' | 'BEARISH' | 'NON_DIRECTIONAL' | 'VOLATILITY';
  description: string;
  legs: Array<{
    optionType: 'CE' | 'PE';
    side: 'BUY' | 'SELL';
    strikeOffsetSteps: number; // 0 = ATM, +2 = 2 strikes above ATM, -2 = 2 below
    lots: number;
    expiryIndex?: number; // 0 = current, 1 = next expiry (Calendar)
  }>;
}

export const OPTION_STRATEGY_TEMPLATES: OptionStrategyTemplate[] = [
  { id: 'LONG_CALL', name: 'Long Call', outlook: 'BULLISH', description: 'Directional bullish buy with defined premium risk', legs: [{ optionType: 'CE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }] },
  { id: 'SHORT_PUT', name: 'Short Put', outlook: 'BULLISH', description: 'Collect premium when expecting support to hold', legs: [{ optionType: 'PE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }] },
  { id: 'BULL_CALL_SPREAD', name: 'Bull Call Spread', outlook: 'BULLISH', description: 'Buy ATM CE & sell OTM CE to lower cost', legs: [{ optionType: 'CE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'CE', side: 'SELL', strikeOffsetSteps: 2, lots: 1 }] },
  { id: 'BULL_PUT_SPREAD', name: 'Bull Put Spread', outlook: 'BULLISH', description: 'Credit spread selling ATM PE & buying OTM PE hedge', legs: [{ optionType: 'PE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'PE', side: 'BUY', strikeOffsetSteps: -2, lots: 1 }] },
  { id: 'CALL_RATIO_BACKSPREAD', name: 'Call Ratio Backspread', outlook: 'BULLISH', description: 'Sell 1 ATM CE & buy 2 OTM CEs for explosive upside', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'CE', side: 'BUY', strikeOffsetSteps: 2, lots: 2 }] },
  { id: 'CALL_RATIO_SPREAD', name: 'Call Ratio Spread', outlook: 'BULLISH', description: 'Buy 1 ATM CE & sell 2 OTM CEs for mild rally', legs: [{ optionType: 'CE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'CE', side: 'SELL', strikeOffsetSteps: 2, lots: 2 }] },
  { id: 'LONG_PUT', name: 'Long Put', outlook: 'BEARISH', description: 'Directional bearish buy with defined premium risk', legs: [{ optionType: 'PE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }] },
  { id: 'SHORT_CALL', name: 'Short Call', outlook: 'BEARISH', description: 'Collect premium expecting resistance to hold', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }] },
  { id: 'BEAR_PUT_SPREAD', name: 'Bear Put Spread', outlook: 'BEARISH', description: 'Buy ATM PE & sell lower OTM PE', legs: [{ optionType: 'PE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'PE', side: 'SELL', strikeOffsetSteps: -2, lots: 1 }] },
  { id: 'BEAR_CALL_SPREAD', name: 'Bear Call Spread', outlook: 'BEARISH', description: 'Credit spread selling ATM CE & buying higher OTM CE', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'CE', side: 'BUY', strikeOffsetSteps: 2, lots: 1 }] },
  { id: 'PUT_RATIO_SPREAD', name: 'Put Ratio Spread', outlook: 'BEARISH', description: 'Buy 1 ATM PE & sell 2 OTM PEs for gradual dip', legs: [{ optionType: 'PE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'PE', side: 'SELL', strikeOffsetSteps: -2, lots: 2 }] },
  { id: 'SHORT_STRADDLE', name: 'Short Straddle', outlook: 'NON_DIRECTIONAL', description: 'Sell ATM CE + ATM PE to harvest theta decay', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'PE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }] },
  { id: 'SHORT_STRANGLE', name: 'Short Strangle', outlook: 'NON_DIRECTIONAL', description: 'Sell OTM CE + OTM PE for wider range-bound profit', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 2, lots: 1 }, { optionType: 'PE', side: 'SELL', strikeOffsetSteps: -2, lots: 1 }] },
  { id: 'IRON_CONDOR', name: 'Iron Condor', outlook: 'NON_DIRECTIONAL', description: 'Defined-risk short strangle hedged with far wings', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 2, lots: 1 }, { optionType: 'CE', side: 'BUY', strikeOffsetSteps: 4, lots: 1 }, { optionType: 'PE', side: 'SELL', strikeOffsetSteps: -2, lots: 1 }, { optionType: 'PE', side: 'BUY', strikeOffsetSteps: -4, lots: 1 }] },
  { id: 'IRON_FLY', name: 'Iron Butterfly', outlook: 'NON_DIRECTIONAL', description: 'Short ATM straddle hedged with OTM wings', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'PE', side: 'SELL', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'CE', side: 'BUY', strikeOffsetSteps: 3, lots: 1 }, { optionType: 'PE', side: 'BUY', strikeOffsetSteps: -3, lots: 1 }] },
  { id: 'LONG_STRADDLE', name: 'Long Straddle', outlook: 'VOLATILITY', description: 'Buy ATM CE + ATM PE to capture big directional breakout', legs: [{ optionType: 'CE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }, { optionType: 'PE', side: 'BUY', strikeOffsetSteps: 0, lots: 1 }] },
  { id: 'CALENDAR_SPREAD', name: 'Calendar Spread', outlook: 'VOLATILITY', description: 'Sell near-expiry ATM CE & buy next-expiry ATM CE', legs: [{ optionType: 'CE', side: 'SELL', strikeOffsetSteps: 0, lots: 1, expiryIndex: 0 }, { optionType: 'CE', side: 'BUY', strikeOffsetSteps: 0, lots: 1, expiryIndex: 1 }] },
];

// ── Quant Mode: 9 Automated Rule-Based Option Strike Selectors ────────────────
export type QuantRuleType =
  | 'ATM_POINTS'
  | 'ATM_PERCENT'
  | 'CLOSEST_PREMIUM'
  | 'CLOSEST_DELTA'
  | 'HIGHEST_OI'
  | 'HIGHEST_OI_CHG'
  | 'HIGHEST_VOLUME'
  | 'STRADDLE_WIDTH'
  | 'HIGHEST_GAMMA';

export interface QuantLegRule {
  optionType: 'CE' | 'PE';
  side: 'BUY' | 'SELL';
  lots: number;
  rule: QuantRuleType;
  value?: number; // offset points, %, target premium, target delta, or straddle multiplier
}

export interface QuantChainStrike {
  strike: number;
  atm: boolean;
  call: { ltp: number; oi: number; oiChange: number; volume: number; delta: number | null; gamma: number | null; iv: number | null };
  put: { ltp: number; oi: number; oiChange: number; volume: number; delta: number | null; gamma: number | null; iv: number | null };
}

export function selectQuantModeStrike(
  rows: QuantChainStrike[],
  spotPrice: number,
  rule: QuantLegRule
): QuantChainStrike | null {
  if (rows.length === 0) return null;
  const pick = (r: QuantChainStrike) => (rule.optionType === 'CE' ? r.call : r.put);
  const nearestTo = (targetStrike: number) =>
    rows.reduce((best, cur) =>
      Math.abs(cur.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? cur : best
    );

  const atmRow = rows.find((r) => r.atm) || nearestTo(spotPrice);
  const atmStraddle = (atmRow.call.ltp || 0) + (atmRow.put.ltp || 0);
  const v = rule.value ?? 0;

  switch (rule.rule) {
    case 'ATM_POINTS':
      return nearestTo(atmRow.strike + v);
    case 'ATM_PERCENT':
      return nearestTo(spotPrice * (1 + v / 100));
    case 'STRADDLE_WIDTH': {
      const dir = rule.optionType === 'CE' ? 1 : -1;
      const mult = v === 0 ? 1 : v;
      return nearestTo(spotPrice + dir * mult * atmStraddle);
    }
    case 'CLOSEST_PREMIUM':
      return rows.reduce((best, cur) =>
        Math.abs(pick(cur).ltp - v) < Math.abs(pick(best).ltp - v) ? cur : best
      );
    case 'CLOSEST_DELTA': {
      const targetAbs = Math.abs(v || 0.25);
      return rows.reduce((best, cur) => {
        const dCur = Math.abs(Math.abs(pick(cur).delta ?? 0) - targetAbs);
        const dBest = Math.abs(Math.abs(pick(best).delta ?? 0) - targetAbs);
        return dCur < dBest ? cur : best;
      });
    }
    case 'HIGHEST_OI':
      return rows.reduce((best, cur) => (pick(cur).oi > pick(best).oi ? cur : best));
    case 'HIGHEST_OI_CHG':
      return rows.reduce((best, cur) => (pick(cur).oiChange > pick(best).oiChange ? cur : best));
    case 'HIGHEST_VOLUME':
      return rows.reduce((best, cur) => (pick(cur).volume > pick(best).volume ? cur : best));
    case 'HIGHEST_GAMMA':
      return rows.reduce((best, cur) => ((pick(cur).gamma ?? 0) > (pick(best).gamma ?? 0) ? cur : best));
    default:
      return atmRow;
  }
}
