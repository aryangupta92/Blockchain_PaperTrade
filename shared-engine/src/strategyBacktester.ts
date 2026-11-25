import { calculateTradeCharges } from './indianTaxAndCharges';
import {
  computeBollingerBands,
  computeEMA,
  computeMACD,
  computeRSI,
  computeSMA,
  computeSupertrend,
  computeVWAP,
} from './technicalIndicators';
import { D, roundPaise, ZERO } from './decimalMoney';
import {
  CandleBar,
  ExchangeCode,
  InstrumentKind,
  MarketSegment,
  OrderSide,
  ProductType,
} from './marketTypes';

export type OperandType =
  | 'PRICE_OPEN'
  | 'PRICE_HIGH'
  | 'PRICE_LOW'
  | 'PRICE_CLOSE'
  | 'VOLUME'
  | 'SMA'
  | 'EMA'
  | 'VWAP'
  | 'RSI'
  | 'MACD_LINE'
  | 'MACD_SIGNAL'
  | 'MACD_HIST'
  | 'BB_UPPER'
  | 'BB_MIDDLE'
  | 'BB_LOWER'
  | 'SUPERTREND'
  | 'CONSTANT';

export type ComparisonOperator =
  | '>'
  | '<'
  | '>='
  | '<='
  | 'CROSSES_ABOVE'
  | 'CROSSES_BELOW';

export interface OperandSpec {
  type: OperandType;
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  stdMult?: number;
  multiplier?: number;
  value?: number; // Used when type === 'CONSTANT'
}

export interface RuleCondition {
  id?: string;
  left: OperandSpec;
  operator: ComparisonOperator;
  right: OperandSpec;
}

export type SizingMode = 'FIXED_QTY' | 'FIXED_CAPITAL' | 'RISK_PER_TRADE_PCT';

export interface StrategyRiskConfig {
  stopLossPct: number | null;
  targetPct: number | null;
  trailingStopPct: number | null;
  maxHoldingBars: number | null;
  sizingMode: SizingMode;
  fixedQty: number;
  fixedCapital: number;
  riskPerTradePct: number;
  slippageBps: number; // e.g., 5 bps = 0.05%
  maxTradesPerDay: number | null;
  misSquareOffIST: string; // e.g. "15:15"
}

export interface StrategyDefinition {
  name: string;
  description?: string;
  exchange: ExchangeCode;
  segment: MarketSegment;
  instrumentKind: InstrumentKind;
  product: ProductType;
  direction: 'LONG' | 'SHORT' | 'BOTH';
  entryCombinator: 'AND' | 'OR';
  entryConditions: RuleCondition[];
  exitCombinator: 'AND' | 'OR';
  exitConditions: RuleCondition[];
  shortEntryCombinator?: 'AND' | 'OR';
  shortEntryConditions?: RuleCondition[];
  risk: StrategyRiskConfig;
}

export interface BacktestInput {
  strategy: StrategyDefinition;
  symbol: string;
  interval: string;
  bars: CandleBar[];
  initialCapital: number;
  lotSize?: number;
  varElmMarginPct?: number; // e.g. 20 for Group-1 MIS, 15 for Futures
}

export interface BacktestTradeRecord {
  tradeNo: number;
  direction: 'LONG' | 'SHORT';
  entryTime: number;
  entryDate: string;
  entryPrice: string;
  exitTime: number;
  exitDate: string;
  exitPrice: string;
  quantity: number;
  barsHeld: number;
  exitReason:
    | 'STOP_LOSS'
    | 'STOP_LOSS_GAP'
    | 'TRAILING_STOP'
    | 'TARGET'
    | 'TARGET_GAP'
    | 'EXIT_RULE'
    | 'MIS_AUTO_SQUAREOFF'
    | 'MAX_HOLDING_BARS'
    | 'END_OF_BACKTEST';
  grossPnl: string;
  entryCharges: string;
  exitCharges: string;
  totalCharges: string;
  slippageCost: string;
  netPnl: string;
  returnPct: string;
}

export interface EquityPoint {
  time: number;
  date: string;
  equity: number;
  grossEquity: number;
  buyAndHoldEquity: number;
  drawdownPct: number;
}

export interface BacktestSummaryMetrics {
  initialCapital: string;
  finalEquity: string;
  netProfit: string;
  netReturnPct: number;
  grossProfitTotal: string;
  totalChargesPaid: string;
  totalSlippageCost: string;
  feeDragPctOfGross: number;
  buyAndHoldReturnPct: number;
  cagrPct: number;
  maxDrawdownINR: string;
  maxDrawdownPct: number;
  maxDrawdownDurationBars: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancyINR: string;
  avgWinINR: string;
  avgLossINR: string;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  exposurePct: number;
  skippedSignals: number;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  barsAnalyzed: number;
  fromDate: string;
  toDate: string;
  warnings: string[];
  metrics: BacktestSummaryMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTradeRecord[];
}

export interface LiveSignalResult {
  signal: 'ENTER_LONG' | 'ENTER_SHORT' | 'EXIT' | 'HOLD';
  evaluatedBarTime: number | null;
  evaluatedBarClose: number | null;
  details: string[];
}

// ── Built-in Verified Starter Templates ───────────────────────────────────────
export const STRATEGY_PRESETS: Array<StrategyDefinition & { id: string; difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'PRO' }> = [
  {
    id: 'preset-ema-crossover',
    difficulty: 'BEGINNER',
    name: 'EMA 9/21 Trend Crossover',
    description: 'Classic trend-following crossover: buys when fast EMA(9) crosses above slow EMA(21) with RSI confirmation.',
    exchange: 'NSE',
    segment: 'EQ',
    instrumentKind: 'EQUITY',
    product: 'CNC',
    direction: 'LONG',
    entryCombinator: 'AND',
    entryConditions: [
      { left: { type: 'EMA', period: 9 }, operator: 'CROSSES_ABOVE', right: { type: 'EMA', period: 21 } },
      { left: { type: 'RSI', period: 14 }, operator: '>', right: { type: 'CONSTANT', value: 48 } },
    ],
    exitCombinator: 'OR',
    exitConditions: [
      { left: { type: 'EMA', period: 9 }, operator: 'CROSSES_BELOW', right: { type: 'EMA', period: 21 } },
    ],
    risk: {
      stopLossPct: 3,
      targetPct: 7,
      trailingStopPct: 2.5,
      maxHoldingBars: null,
      sizingMode: 'FIXED_CAPITAL',
      fixedQty: 10,
      fixedCapital: 100000,
      riskPerTradePct: 1,
      slippageBps: 5,
      maxTradesPerDay: 2,
      misSquareOffIST: '15:15',
    },
  },
  {
    id: 'preset-vwap-rsi-intraday',
    difficulty: 'INTERMEDIATE',
    name: 'VWAP + RSI Intraday Momentum (MIS)',
    description: 'Intraday momentum: enters when price crosses above session VWAP with bullish RSI; auto squares off at 15:15 IST.',
    exchange: 'NSE',
    segment: 'EQ',
    instrumentKind: 'EQUITY',
    product: 'MIS',
    direction: 'LONG',
    entryCombinator: 'AND',
    entryConditions: [
      { left: { type: 'PRICE_CLOSE' }, operator: 'CROSSES_ABOVE', right: { type: 'VWAP' } },
      { left: { type: 'RSI', period: 14 }, operator: '>', right: { type: 'CONSTANT', value: 55 } },
    ],
    exitCombinator: 'OR',
    exitConditions: [
      { left: { type: 'PRICE_CLOSE' }, operator: 'CROSSES_BELOW', right: { type: 'VWAP' } },
    ],
    risk: {
      stopLossPct: 0.8,
      targetPct: 1.8,
      trailingStopPct: 0.6,
      maxHoldingBars: null,
      sizingMode: 'RISK_PER_TRADE_PCT',
      fixedQty: 10,
      fixedCapital: 100000,
      riskPerTradePct: 1,
      slippageBps: 5,
      maxTradesPerDay: 3,
      misSquareOffIST: '15:15',
    },
  },
  {
    id: 'preset-supertrend-ride',
    difficulty: 'BEGINNER',
    name: 'Supertrend (10,3) Trend Rider',
    description: 'Captures strong directional swings when price closes above Supertrend(10, 3) and exits on trend flip.',
    exchange: 'NSE',
    segment: 'EQ',
    instrumentKind: 'EQUITY',
    product: 'CNC',
    direction: 'LONG',
    entryCombinator: 'AND',
    entryConditions: [
      { left: { type: 'PRICE_CLOSE' }, operator: 'CROSSES_ABOVE', right: { type: 'SUPERTREND', period: 10, multiplier: 3 } },
    ],
    exitCombinator: 'OR',
    exitConditions: [
      { left: { type: 'PRICE_CLOSE' }, operator: 'CROSSES_BELOW', right: { type: 'SUPERTREND', period: 10, multiplier: 3 } },
    ],
    risk: {
      stopLossPct: 4,
      targetPct: null,
      trailingStopPct: 3,
      maxHoldingBars: null,
      sizingMode: 'FIXED_CAPITAL',
      fixedQty: 10,
      fixedCapital: 100000,
      riskPerTradePct: 1,
      slippageBps: 5,
      maxTradesPerDay: 2,
      misSquareOffIST: '15:15',
    },
  },
  {
    id: 'preset-rsi-mean-reversion',
    difficulty: 'BEGINNER',
    name: 'RSI Oversold Mean Reversion',
    description: 'Buys quality stocks in an uptrend (Close > SMA 50) when RSI(14) rebounds back above 35.',
    exchange: 'NSE',
    segment: 'EQ',
    instrumentKind: 'EQUITY',
    product: 'CNC',
    direction: 'LONG',
    entryCombinator: 'AND',
    entryConditions: [
      { left: { type: 'RSI', period: 14 }, operator: 'CROSSES_ABOVE', right: { type: 'CONSTANT', value: 35 } },
      { left: { type: 'PRICE_CLOSE' }, operator: '>', right: { type: 'SMA', period: 50 } },
    ],
    exitCombinator: 'OR',
    exitConditions: [
      { left: { type: 'RSI', period: 14 }, operator: '>', right: { type: 'CONSTANT', value: 68 } },
    ],
    risk: {
      stopLossPct: 3.5,
      targetPct: 6,
      trailingStopPct: null,
      maxHoldingBars: 25,
      sizingMode: 'FIXED_CAPITAL',
      fixedQty: 10,
      fixedCapital: 100000,
      riskPerTradePct: 1,
      slippageBps: 5,
      maxTradesPerDay: 1,
      misSquareOffIST: '15:15',
    },
  },
  {
    id: 'preset-bollinger-bounce',
    difficulty: 'INTERMEDIATE',
    name: 'Bollinger Lower-Band Bounce',
    description: 'Enters when price reclaims the Lower Bollinger Band (20, 2) and targets the Upper Band.',
    exchange: 'NSE',
    segment: 'ETF',
    instrumentKind: 'ETF',
    product: 'CNC',
    direction: 'LONG',
    entryCombinator: 'AND',
    entryConditions: [
      { left: { type: 'PRICE_CLOSE' }, operator: 'CROSSES_ABOVE', right: { type: 'BB_LOWER', period: 20, stdMult: 2 } },
    ],
    exitCombinator: 'OR',
    exitConditions: [
      { left: { type: 'PRICE_CLOSE' }, operator: '>=', right: { type: 'BB_UPPER', period: 20, stdMult: 2 } },
    ],
    risk: {
      stopLossPct: 2.5,
      targetPct: 5,
      trailingStopPct: null,
      maxHoldingBars: 30,
      sizingMode: 'FIXED_CAPITAL',
      fixedQty: 50,
      fixedCapital: 100000,
      riskPerTradePct: 1,
      slippageBps: 5,
      maxTradesPerDay: 1,
      misSquareOffIST: '15:15',
    },
  },
];

// ── Causal Indicator Series Resolver ──────────────────────────────────────────

function operandKey(op: OperandSpec): string {
  return JSON.stringify({
    t: op.type,
    p: op.period ?? null,
    f: op.fast ?? null,
    s: op.slow ?? null,
    sg: op.signal ?? null,
    sm: op.stdMult ?? null,
    m: op.multiplier ?? null,
    v: op.value ?? null,
  });
}

function buildOperandSeries(bars: CandleBar[], op: OperandSpec): Array<number | null> {
  const n = bars.length;
  const arr = new Array<number | null>(n).fill(null);
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < n; i++) timeToIdx.set(bars[i].time, i);

  switch (op.type) {
    case 'CONSTANT':
      return arr.fill(op.value ?? 0);
    case 'PRICE_OPEN':
      return bars.map((b) => b.open);
    case 'PRICE_HIGH':
      return bars.map((b) => b.high);
    case 'PRICE_LOW':
      return bars.map((b) => b.low);
    case 'PRICE_CLOSE':
      return bars.map((b) => b.close);
    case 'VOLUME':
      return bars.map((b) => b.volume);
    case 'SMA':
      for (const p of computeSMA(bars, op.period ?? 20)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) arr[idx] = p.value;
      }
      return arr;
    case 'EMA':
      for (const p of computeEMA(bars, op.period ?? 20)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) arr[idx] = p.value;
      }
      return arr;
    case 'VWAP':
      for (const p of computeVWAP(bars)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) arr[idx] = p.value;
      }
      return arr;
    case 'RSI':
      for (const p of computeRSI(bars, op.period ?? 14)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) arr[idx] = p.value;
      }
      return arr;
    case 'MACD_LINE':
    case 'MACD_SIGNAL':
    case 'MACD_HIST':
      for (const p of computeMACD(bars, op.fast ?? 12, op.slow ?? 26, op.signal ?? 9)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) {
          arr[idx] = op.type === 'MACD_LINE' ? p.macd : op.type === 'MACD_SIGNAL' ? p.signal : p.histogram;
        }
      }
      return arr;
    case 'BB_UPPER':
    case 'BB_MIDDLE':
    case 'BB_LOWER':
      for (const p of computeBollingerBands(bars, op.period ?? 20, op.stdMult ?? 2)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) {
          arr[idx] = op.type === 'BB_UPPER' ? p.upper : op.type === 'BB_MIDDLE' ? p.middle : p.lower;
        }
      }
      return arr;
    case 'SUPERTREND':
      for (const p of computeSupertrend(bars, op.period ?? 10, op.multiplier ?? 3)) {
        const idx = timeToIdx.get(p.time);
        if (idx !== undefined) arr[idx] = p.value;
      }
      return arr;
    default:
      return arr;
  }
}

function evaluateCondition(
  cond: RuleCondition,
  idx: number,
  cache: Map<string, Array<number | null>>
): boolean {
  const ls = cache.get(operandKey(cond.left));
  const rs = cache.get(operandKey(cond.right));
  if (!ls || !rs) return false;
  const l = ls[idx];
  const r = rs[idx];
  if (l == null || r == null) return false;

  switch (cond.operator) {
    case '>': return l > r;
    case '<': return l < r;
    case '>=': return l >= r;
    case '<=': return l <= r;
    case 'CROSSES_ABOVE': {
      if (idx < 1) return false;
      const lp = ls[idx - 1];
      const rp = rs[idx - 1];
      return lp != null && rp != null && lp <= rp && l > r;
    }
    case 'CROSSES_BELOW': {
      if (idx < 1) return false;
      const lp = ls[idx - 1];
      const rp = rs[idx - 1];
      return lp != null && rp != null && lp >= rp && l < r;
    }
    default:
      return false;
  }
}

function evaluateGroup(
  conditions: RuleCondition[],
  combinator: 'AND' | 'OR',
  idx: number,
  cache: Map<string, Array<number | null>>
): boolean {
  if (conditions.length === 0) return false;
  if (combinator === 'OR') {
    return conditions.some((c) => evaluateCondition(c, idx, cache));
  }
  return conditions.every((c) => evaluateCondition(c, idx, cache));
}

function toIstIso(unixSec: number): { date: string; hhmm: string } {
  const d = new Date(unixSec * 1000 + 5.5 * 3600 * 1000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16) };
}

function applySlippage(price: number, side: OrderSide, slippageBps: number): number {
  const slip = Math.max(0, slippageBps) / 10_000;
  const adj = side === 'BUY' ? price * (1 + slip) : price * (1 - slip);
  return Number(Math.max(0.05, adj).toFixed(2));
}

function computePositionQty(params: {
  equity: number;
  entryPrice: number;
  lotSize: number;
  risk: StrategyRiskConfig;
  marginRate: number;
}): number {
  const { equity, entryPrice, lotSize, risk, marginRate } = params;
  if (entryPrice <= 0 || equity <= 0) return 0;

  let rawQty = risk.fixedQty;
  if (risk.sizingMode === 'FIXED_CAPITAL') {
    rawQty = Math.floor(risk.fixedCapital / entryPrice);
  } else if (risk.sizingMode === 'RISK_PER_TRADE_PCT') {
    const slPct = risk.stopLossPct && risk.stopLossPct > 0 ? risk.stopLossPct / 100 : 0.02;
    const riskINR = equity * (Math.max(0.1, risk.riskPerTradePct) / 100);
    const riskPerUnit = entryPrice * slPct;
    rawQty = riskPerUnit > 0 ? Math.floor(riskINR / riskPerUnit) : 0;
  }

  // Cap by available margin (leave 1.5% buffer for statutory charges)
  const maxAffordable = Math.floor((equity * 0.985) / (entryPrice * marginRate));
  const capped = Math.min(rawQty, maxAffordable);
  const lots = Math.floor(capped / Math.max(1, lotSize));
  return lots * Math.max(1, lotSize);
}

/**
 * Evaluate latest live signal for a strategy on recent historical candles (used for Live Signal Scanner).
 */
export function evaluateLatestSignal(strategy: StrategyDefinition, bars: CandleBar[]): LiveSignalResult {
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  if (sorted.length < 2) {
    return { signal: 'HOLD', evaluatedBarTime: null, evaluatedBarClose: null, details: ['Insufficient bars'] };
  }

  const cache = new Map<string, Array<number | null>>();
  const allConds = [
    ...strategy.entryConditions,
    ...strategy.exitConditions,
    ...(strategy.shortEntryConditions || []),
  ];
  for (const c of allConds) {
    for (const op of [c.left, c.right]) {
      const k = operandKey(op);
      if (!cache.has(k)) cache.set(k, buildOperandSeries(sorted, op));
    }
  }

  const lastIdx = sorted.length - 1;
  const allowShort = strategy.product !== 'CNC' && (strategy.direction === 'SHORT' || strategy.direction === 'BOTH');
  const allowLong = strategy.direction === 'LONG' || strategy.direction === 'BOTH';

  const longEntry = allowLong && evaluateGroup(strategy.entryConditions, strategy.entryCombinator, lastIdx, cache);
  const shortEntry =
    allowShort &&
    (strategy.shortEntryConditions?.length
      ? evaluateGroup(strategy.shortEntryConditions, strategy.shortEntryCombinator || 'AND', lastIdx, cache)
      : false);
  const exitSig = evaluateGroup(strategy.exitConditions, strategy.exitCombinator, lastIdx, cache);

  let signal: LiveSignalResult['signal'] = 'HOLD';
  const details: string[] = [];
  if (longEntry) {
    signal = 'ENTER_LONG';
    details.push('Long entry rules satisfied on latest completed candle.');
  } else if (shortEntry) {
    signal = 'ENTER_SHORT';
    details.push('Short entry rules satisfied on latest completed candle.');
  } else if (exitSig) {
    signal = 'EXIT';
    details.push('Exit condition triggered on latest completed candle.');
  } else {
    details.push('No entry/exit trigger on latest candle.');
  }

  return {
    signal,
    evaluatedBarTime: sorted[lastIdx].time,
    evaluatedBarClose: sorted[lastIdx].close,
    details,
  };
}

/**
 * Institutional-Grade Zero-Look-Ahead Strategy Backtester for Indian Markets.
 * - Evaluates signals strictly at bar[i] close -> executes on bar[i+1] open (+ slippage bps).
 * - Conservative intra-bar tie-breaking (Gap check -> SL before Target -> Trailing SL ratchet for next bar).
 * - Applies exact effective-dated Indian statutory charges (Finance Act 2026 & historical) on every leg.
 * - Enforces SEBI CNC no-short-selling, lot sizes, VaR+ELM margin, and MIS 15:15 IST square-off.
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  const { strategy, symbol, interval } = input;
  const bars = [...input.bars].sort((a, b) => a.time - b.time);
  const warnings: string[] = [];
  const lotSize = Math.max(1, input.lotSize ?? 1);
  const isIntradayInterval = !['1D', '1W', '1M'].includes(interval);

  if (bars.length < 3) {
    throw new Error('At least 3 historical candles are required to run a valid zero-look-ahead backtest.');
  }

  // SEBI Rule enforcement inside backtest: CNC cannot short sell
  const effectiveDirection =
    strategy.product === 'CNC' && strategy.direction !== 'LONG' ? 'LONG' : strategy.direction;
  if (strategy.product === 'CNC' && strategy.direction !== 'LONG') {
    warnings.push('SEBI CNC Rule: Short selling is disabled for Delivery (CNC) backtests; running LONG only.');
  }

  const marginRate =
    strategy.product === 'CNC'
      ? 1
      : strategy.segment === 'FNO' || strategy.segment === 'COMM'
        ? (input.varElmMarginPct ?? 15) / 100
        : (input.varElmMarginPct ?? 20) / 100;

  // Precompute all indicator series once
  const cache = new Map<string, Array<number | null>>();
  const allConds = [
    ...strategy.entryConditions,
    ...strategy.exitConditions,
    ...(strategy.shortEntryConditions || []),
  ];
  for (const c of allConds) {
    for (const op of [c.left, c.right]) {
      const k = operandKey(op);
      if (!cache.has(k)) cache.set(k, buildOperandSeries(bars, op));
    }
  }

  let cash = D(input.initialCapital);
  let grossEquity = D(input.initialCapital);
  let totalChargesPaid = ZERO;
  let totalSlippageCost = ZERO;
  let totalGrossPnl = ZERO;
  let skippedSignals = 0;
  let barsInMarket = 0;

  interface OpenPos {
    direction: 'LONG' | 'SHORT';
    entryTime: number;
    entryDate: string;
    entryPrice: number;
    rawEntryOpen: number;
    quantity: number;
    entryBarIdx: number;
    entryCharges: string;
    entrySlippage: number;
    stopLoss: number | null;
    target: number | null;
    trailingStop: number | null;
  }

  let openPos: OpenPos | null = null;
  let pendingEntry: 'LONG' | 'SHORT' | null = null;
  let pendingExitReason: BacktestTradeRecord['exitReason'] | null = null;

  const trades: BacktestTradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  const tradesCountByDay = new Map<string, number>();

  const firstClose = bars[0].close;
  let peakEquity = input.initialCapital;
  let maxDrawdownINR = ZERO;
  let maxDrawdownPct = 0;
  let curDdBars = 0;
  let maxDdBars = 0;

  const closePosition = (
    bar: CandleBar,
    rawExitPrice: number,
    reason: BacktestTradeRecord['exitReason'],
    barIdx: number
  ) => {
    if (!openPos) return;
    const exitSide: OrderSide = openPos.direction === 'LONG' ? 'SELL' : 'BUY';
    const exitFillPrice = applySlippage(rawExitPrice, exitSide, strategy.risk.slippageBps);
    const exitSlippage = Math.abs(exitFillPrice - rawExitPrice) * openPos.quantity;
    const { date: exitDate } = toIstIso(bar.time);

    const exitCb = calculateTradeCharges({
      exchange: strategy.exchange,
      segment: strategy.segment,
      instrumentKind: strategy.instrumentKind,
      product: strategy.product,
      side: exitSide,
      quantity: openPos.quantity,
      price: exitFillPrice,
      applyDpCharge: strategy.product === 'CNC' && exitSide === 'SELL',
      asOfDate: exitDate,
    });

    const gross =
      openPos.direction === 'LONG'
        ? roundPaise(D(exitFillPrice).minus(D(openPos.entryPrice)).mul(openPos.quantity))
        : roundPaise(D(openPos.entryPrice).minus(D(exitFillPrice)).mul(openPos.quantity));

    const tradeCharges = roundPaise(D(openPos.entryCharges).plus(D(exitCb.totalCharges)));
    const net = roundPaise(gross.minus(tradeCharges));
    const totalSlip = roundPaise(D(openPos.entrySlippage).plus(D(exitSlippage)));

    cash = roundPaise(cash.plus(gross).minus(D(exitCb.totalCharges)));
    grossEquity = roundPaise(grossEquity.plus(gross));
    totalChargesPaid = roundPaise(totalChargesPaid.plus(tradeCharges));
    totalSlippageCost = roundPaise(totalSlippageCost.plus(totalSlip));
    totalGrossPnl = roundPaise(totalGrossPnl.plus(gross));

    const notional = D(openPos.entryPrice).mul(openPos.quantity);
    const retPct = notional.gt(0) ? roundPaise(net.div(notional).mul(100)).toFixed(2) : '0.00';

    trades.push({
      tradeNo: trades.length + 1,
      direction: openPos.direction,
      entryTime: openPos.entryTime,
      entryDate: openPos.entryDate,
      entryPrice: openPos.entryPrice.toFixed(2),
      exitTime: bar.time,
      exitDate,
      exitPrice: exitFillPrice.toFixed(2),
      quantity: openPos.quantity,
      barsHeld: Math.max(1, barIdx - openPos.entryBarIdx),
      exitReason: reason,
      grossPnl: gross.toFixed(2),
      entryCharges: openPos.entryCharges,
      exitCharges: exitCb.totalCharges,
      totalCharges: tradeCharges.toFixed(2),
      slippageCost: totalSlip.toFixed(2),
      netPnl: net.toFixed(2),
      returnPct: retPct,
    });

    openPos = null;
    pendingExitReason = null;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const { date: istDate, hhmm } = toIstIso(bar.time);

    // 1. Execute pending next-bar-open EXIT first (from prior bar signal)
    if (openPos && pendingExitReason) {
      closePosition(bar, bar.open, pendingExitReason, i);
    }

    // 2. Execute pending next-bar-open ENTRY (strict zero look-ahead!)
    if (!openPos && pendingEntry) {
      const dayCount = tradesCountByDay.get(istDate) ?? 0;
      const limitHit = strategy.risk.maxTradesPerDay != null && dayCount >= strategy.risk.maxTradesPerDay;
      const pastMisCutoff = strategy.product === 'MIS' && isIntradayInterval && hhmm >= strategy.risk.misSquareOffIST;

      if (!limitHit && !pastMisCutoff) {
        const entrySide: OrderSide = pendingEntry === 'LONG' ? 'BUY' : 'SELL';
        const fillPrice = applySlippage(bar.open, entrySide, strategy.risk.slippageBps);
        const qty = computePositionQty({
          equity: cash.toNumber(),
          entryPrice: fillPrice,
          lotSize,
          risk: strategy.risk,
          marginRate,
        });

        if (qty > 0) {
          const entryCb = calculateTradeCharges({
            exchange: strategy.exchange,
            segment: strategy.segment,
            instrumentKind: strategy.instrumentKind,
            product: strategy.product,
            side: entrySide,
            quantity: qty,
            price: fillPrice,
            asOfDate: istDate,
          });
          // Debit entry charges immediately
          cash = roundPaise(cash.minus(D(entryCb.totalCharges)));
          const slPct = strategy.risk.stopLossPct ? strategy.risk.stopLossPct / 100 : null;
          const tgtPct = strategy.risk.targetPct ? strategy.risk.targetPct / 100 : null;
          const trlPct = strategy.risk.trailingStopPct ? strategy.risk.trailingStopPct / 100 : null;

          openPos = {
            direction: pendingEntry,
            entryTime: bar.time,
            entryDate: istDate,
            entryPrice: fillPrice,
            rawEntryOpen: bar.open,
            quantity: qty,
            entryBarIdx: i,
            entryCharges: entryCb.totalCharges,
            entrySlippage: Math.abs(fillPrice - bar.open) * qty,
            stopLoss: slPct
              ? Number((pendingEntry === 'LONG' ? fillPrice * (1 - slPct) : fillPrice * (1 + slPct)).toFixed(2))
              : null,
            target: tgtPct
              ? Number((pendingEntry === 'LONG' ? fillPrice * (1 + tgtPct) : fillPrice * (1 - tgtPct)).toFixed(2))
              : null,
            trailingStop: trlPct
              ? Number((pendingEntry === 'LONG' ? fillPrice * (1 - trlPct) : fillPrice * (1 + trlPct)).toFixed(2))
              : null,
          };
          tradesCountByDay.set(istDate, dayCount + 1);
        } else {
          skippedSignals++;
        }
      } else {
        skippedSignals++;
      }
      pendingEntry = null;
    }

    // 3. Intra-bar risk exits on open position (Conservative order: Gap -> SL/Trail -> Target -> MIS 15:15)
    if (openPos) {
      barsInMarket++;
      const activeStop =
        openPos.stopLoss != null && openPos.trailingStop != null
          ? openPos.direction === 'LONG'
            ? Math.max(openPos.stopLoss, openPos.trailingStop)
            : Math.min(openPos.stopLoss, openPos.trailingStop)
          : openPos.stopLoss ?? openPos.trailingStop;
      const isTrailingTighter =
        openPos.trailingStop != null && (openPos.stopLoss == null || activeStop === openPos.trailingStop);

      let exitedIntraBar = false;

      if (openPos.direction === 'LONG') {
        if (activeStop != null && bar.open <= activeStop) {
          closePosition(bar, bar.open, 'STOP_LOSS_GAP', i);
          exitedIntraBar = true;
        } else if (openPos.target != null && bar.open >= openPos.target) {
          closePosition(bar, bar.open, 'TARGET_GAP', i);
          exitedIntraBar = true;
        } else if (activeStop != null && bar.low <= activeStop) {
          // Conservative tie-break: SL wins if both SL and Target fall inside bar [low, high]
          closePosition(bar, activeStop, isTrailingTighter ? 'TRAILING_STOP' : 'STOP_LOSS', i);
          exitedIntraBar = true;
        } else if (openPos.target != null && bar.high >= openPos.target) {
          closePosition(bar, openPos.target, 'TARGET', i);
          exitedIntraBar = true;
        }
      } else {
        // SHORT
        if (activeStop != null && bar.open >= activeStop) {
          closePosition(bar, bar.open, 'STOP_LOSS_GAP', i);
          exitedIntraBar = true;
        } else if (openPos.target != null && bar.open <= openPos.target) {
          closePosition(bar, bar.open, 'TARGET_GAP', i);
          exitedIntraBar = true;
        } else if (activeStop != null && bar.high >= activeStop) {
          closePosition(bar, activeStop, isTrailingTighter ? 'TRAILING_STOP' : 'STOP_LOSS', i);
          exitedIntraBar = true;
        } else if (openPos.target != null && bar.low <= openPos.target) {
          closePosition(bar, openPos.target, 'TARGET', i);
          exitedIntraBar = true;
        }
      }

      // MIS Intraday Auto Square-Off (15:15 IST or last bar of session day)
      if (!exitedIntraBar && openPos && strategy.product === 'MIS' && isIntradayInterval) {
        const nextBarDay = i + 1 < bars.length ? toIstIso(bars[i + 1].time).date : null;
        if (hhmm >= strategy.risk.misSquareOffIST || (nextBarDay && nextBarDay !== istDate)) {
          closePosition(bar, bar.close, 'MIS_AUTO_SQUAREOFF', i);
          exitedIntraBar = true;
        }
      }

      // Ratchet Trailing Stop for the NEXT bar using confirmed bar extreme (zero intra-bar peek)
      if (!exitedIntraBar && openPos && strategy.risk.trailingStopPct && strategy.risk.trailingStopPct > 0) {
        const trl = strategy.risk.trailingStopPct / 100;
        if (openPos.direction === 'LONG') {
          const candidate = Number((bar.high * (1 - trl)).toFixed(2));
          if (openPos.trailingStop == null || candidate > openPos.trailingStop) {
            openPos.trailingStop = candidate;
          }
        } else {
          const candidate = Number((bar.low * (1 + trl)).toFixed(2));
          if (openPos.trailingStop == null || candidate < openPos.trailingStop) {
            openPos.trailingStop = candidate;
          }
        }
      }
    }

    // 4. Evaluate close-of-bar rules to schedule NEXT-bar-open actions
    if (i < bars.length - 1) {
      if (openPos) {
        const held = i - openPos.entryBarIdx + 1;
        if (strategy.risk.maxHoldingBars != null && held >= strategy.risk.maxHoldingBars) {
          pendingExitReason = 'MAX_HOLDING_BARS';
        } else if (evaluateGroup(strategy.exitConditions, strategy.exitCombinator, i, cache)) {
          pendingExitReason = 'EXIT_RULE';
        }
      } else {
        const allowLong = effectiveDirection === 'LONG' || effectiveDirection === 'BOTH';
        const allowShort = effectiveDirection === 'SHORT' || effectiveDirection === 'BOTH';
        if (allowLong && evaluateGroup(strategy.entryConditions, strategy.entryCombinator, i, cache)) {
          pendingEntry = 'LONG';
        } else if (
          allowShort &&
          strategy.shortEntryConditions?.length &&
          evaluateGroup(strategy.shortEntryConditions, strategy.shortEntryCombinator || 'AND', i, cache)
        ) {
          pendingEntry = 'SHORT';
        }
      }
    } else if (openPos) {
      // Close remaining position at final bar close for accurate final equity
      closePosition(bar, bar.close, 'END_OF_BACKTEST', i);
    }

    // 5. Mark-to-market equity curve + drawdown tracking
    const unrealized = openPos
      ? openPos.direction === 'LONG'
        ? (bar.close - openPos.entryPrice) * openPos.quantity
        : (openPos.entryPrice - bar.close) * openPos.quantity
      : 0;
    const mtmEquity = Number(cash.plus(unrealized).toFixed(2));
    const mtmGross = Number(grossEquity.plus(unrealized).toFixed(2));
    const bhEquity = Number((input.initialCapital * (bar.close / firstClose)).toFixed(2));

    if (mtmEquity >= peakEquity) {
      peakEquity = mtmEquity;
      curDdBars = 0;
    } else {
      curDdBars++;
      if (curDdBars > maxDdBars) maxDdBars = curDdBars;
      const ddInr = D(peakEquity).minus(D(mtmEquity));
      const ddPct = peakEquity > 0 ? (ddInr.toNumber() / peakEquity) * 100 : 0;
      if (ddInr.gt(maxDrawdownINR)) maxDrawdownINR = ddInr;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    const curDdPct = peakEquity > 0 ? Number((((peakEquity - mtmEquity) / peakEquity) * 100).toFixed(2)) : 0;
    equityCurve.push({
      time: bar.time,
      date: istDate,
      equity: mtmEquity,
      grossEquity: mtmGross,
      buyAndHoldEquity: bhEquity,
      drawdownPct: curDdPct,
    });
  }

  // ── Aggregate Institutional Performance Ratios ──────────────────────────────
  const finalEq = equityCurve[equityCurve.length - 1]?.equity ?? input.initialCapital;
  const netProfit = roundPaise(D(finalEq).minus(D(input.initialCapital)));
  const netReturnPct = Number(((netProfit.toNumber() / input.initialCapital) * 100).toFixed(2));
  const buyAndHoldReturnPct = Number((((bars[bars.length - 1].close - firstClose) / firstClose) * 100).toFixed(2));

  const spanYears = Math.max(1 / 365, (bars[bars.length - 1].time - bars[0].time) / (365 * 86400));
  const cagrPct =
    finalEq > 0
      ? Number(((Math.pow(finalEq / input.initialCapital, 1 / spanYears) - 1) * 100).toFixed(2))
      : -100;

  // Daily/bar returns for Sharpe & Sortino (India risk-free rate = 6.5% p.a.)
  const barReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) barReturns.push((equityCurve[i].equity - prev) / prev);
  }
  const barsPerYear = isIntradayInterval ? 252 * 25 : 252;
  const rfPerBar = 0.065 / barsPerYear;
  const meanRet = barReturns.length ? barReturns.reduce((s, r) => s + r, 0) / barReturns.length : 0;
  const variance = barReturns.length
    ? barReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / barReturns.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const downsideVar = barReturns.length
    ? barReturns.reduce((s, r) => s + (r < rfPerBar ? (r - rfPerBar) ** 2 : 0), 0) / barReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVar);

  const sharpeRatio = stdDev > 0 ? Number((((meanRet - rfPerBar) / stdDev) * Math.sqrt(barsPerYear)).toFixed(2)) : 0;
  const sortinoRatio =
    downsideDev > 0 ? Number((((meanRet - rfPerBar) / downsideDev) * Math.sqrt(barsPerYear)).toFixed(2)) : 0;
  const calmarRatio = maxDrawdownPct > 0 ? Number((cagrPct / maxDrawdownPct).toFixed(2)) : 0;

  const wins = trades.filter((t) => Number(t.netPnl) > 0);
  const losses = trades.filter((t) => Number(t.netPnl) <= 0);
  const grossWinsSum = wins.reduce((s, t) => s.plus(D(t.netPnl)), ZERO);
  const grossLossSum = losses.reduce((s, t) => s.plus(D(t.netPnl).abs()), ZERO);
  const profitFactor = grossLossSum.gt(0)
    ? Number(grossWinsSum.div(grossLossSum).toFixed(2))
    : grossWinsSum.gt(0)
      ? 99.99
      : 0;

  const avgWin = wins.length ? roundPaise(grossWinsSum.div(wins.length)) : ZERO;
  const avgLoss = losses.length ? roundPaise(grossLossSum.div(losses.length).neg()) : ZERO;
  const expectancy = trades.length ? roundPaise(netProfit.div(trades.length)) : ZERO;

  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let curW = 0;
  let curL = 0;
  for (const t of trades) {
    if (Number(t.netPnl) > 0) {
      curW++;
      curL = 0;
      if (curW > maxConsecWins) maxConsecWins = curW;
    } else {
      curL++;
      curW = 0;
      if (curL > maxConsecLosses) maxConsecLosses = curL;
    }
  }

  const feeDragPctOfGross = totalGrossPnl.gt(0)
    ? Number((totalChargesPaid.div(totalGrossPnl).mul(100)).toFixed(2))
    : 0;

  return {
    symbol,
    interval,
    barsAnalyzed: bars.length,
    fromDate: toIstIso(bars[0].time).date,
    toDate: toIstIso(bars[bars.length - 1].time).date,
    warnings,
    metrics: {
      initialCapital: roundPaise(input.initialCapital).toFixed(2),
      finalEquity: roundPaise(finalEq).toFixed(2),
      netProfit: netProfit.toFixed(2),
      netReturnPct,
      grossProfitTotal: totalGrossPnl.toFixed(2),
      totalChargesPaid: totalChargesPaid.toFixed(2),
      totalSlippageCost: totalSlippageCost.toFixed(2),
      feeDragPctOfGross,
      buyAndHoldReturnPct,
      cagrPct,
      maxDrawdownINR: roundPaise(maxDrawdownINR).toFixed(2),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      maxDrawdownDurationBars: maxDdBars,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRatePct: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
      profitFactor,
      expectancyINR: expectancy.toFixed(2),
      avgWinINR: avgWin.toFixed(2),
      avgLossINR: avgLoss.toFixed(2),
      maxConsecutiveWins: maxConsecWins,
      maxConsecutiveLosses: maxConsecLosses,
      exposurePct: Number(((barsInMarket / bars.length) * 100).toFixed(2)),
      skippedSignals,
    },
    equityCurve,
    trades,
  };
}
