import { CandleBar } from './marketTypes';

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface MacdPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface SupertrendPoint {
  time: number;
  value: number;
  direction: 'UP' | 'DOWN';
}

/** Transform OHLC bars into Heikin Ashi candles. */
export function computeHeikinAshi(bars: CandleBar[]): CandleBar[] {
  const out: CandleBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    out.push({
      time: b.time,
      open: Number(haOpen.toFixed(2)),
      high: Number(haHigh.toFixed(2)),
      low: Number(haLow.toFixed(2)),
      close: Number(haClose.toFixed(2)),
      volume: b.volume,
      ...(b.oi !== undefined ? { oi: b.oi } : {}),
    });
  }
  return out;
}

/** Simple Moving Average (SMA). */
export function computeSMA(bars: CandleBar[], period = 20): IndicatorPoint[] {
  if (period <= 0 || bars.length < period) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) {
      out.push({ time: bars[i].time, value: Number((sum / period).toFixed(2)) });
    }
  }
  return out;
}

/** Exponential Moving Average (EMA). */
export function computeEMA(bars: CandleBar[], period = 20): IndicatorPoint[] {
  if (period <= 0 || bars.length < period) return [];
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += bars[i].close;
  let ema = seed / period;
  const out: IndicatorPoint[] = [{ time: bars[period - 1].time, value: Number(ema.toFixed(2)) }];

  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: Number(ema.toFixed(2)) });
  }
  return out;
}

/** Volume Weighted Average Price (VWAP) — resets daily on IST trading date boundary. */
export function computeVWAP(bars: CandleBar[]): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  let cumPV = 0;
  let cumVol = 0;
  let lastDay = '';

  for (const b of bars) {
    const istDay = new Date(b.time * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (istDay !== lastDay) {
      cumPV = 0;
      cumVol = 0;
      lastDay = istDay;
    }
    const typical = (b.high + b.low + b.close) / 3;
    const vol = Math.max(1, b.volume || 0);
    cumPV += typical * vol;
    cumVol += vol;
    out.push({ time: b.time, value: Number((cumPV / cumVol).toFixed(2)) });
  }
  return out;
}

/** Bollinger Bands (default 20 period, 2 std dev). */
export function computeBollingerBands(bars: CandleBar[], period = 20, stdMult = 2): BollingerPoint[] {
  if (period <= 1 || bars.length < period) return [];
  const out: BollingerPoint[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    const mean = sum / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = bars[j].close - mean;
      varSum += diff * diff;
    }
    const std = Math.sqrt(varSum / period);
    out.push({
      time: bars[i].time,
      upper: Number((mean + stdMult * std).toFixed(2)),
      middle: Number(mean.toFixed(2)),
      lower: Number((mean - stdMult * std).toFixed(2)),
    });
  }
  return out;
}

/** Relative Strength Index (Wilder's RSI, default 14). */
export function computeRSI(bars: CandleBar[], period = 14): IndicatorPoint[] {
  if (period <= 0 || bars.length <= period) return [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    if (delta >= 0) avgGain += delta;
    else avgLoss += -delta;
  }
  avgGain /= period;
  avgLoss /= period;

  const toRsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  const out: IndicatorPoint[] = [
    { time: bars[period].time, value: Number(toRsi(avgGain, avgLoss).toFixed(2)) },
  ];

  for (let i = period + 1; i < bars.length; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({ time: bars[i].time, value: Number(toRsi(avgGain, avgLoss).toFixed(2)) });
  }
  return out;
}

/** MACD (default 12, 26, 9). */
export function computeMACD(bars: CandleBar[], fast = 12, slow = 26, signalPeriod = 9): MacdPoint[] {
  if (bars.length < slow + signalPeriod) return [];
  const fastEma = computeEMA(bars, fast);
  const slowEma = computeEMA(bars, slow);
  const fastByTime = new Map(fastEma.map((p) => [p.time, p.value]));

  const macdLine: IndicatorPoint[] = [];
  for (const s of slowEma) {
    const f = fastByTime.get(s.time);
    if (f !== undefined) {
      macdLine.push({ time: s.time, value: f - s.value });
    }
  }
  if (macdLine.length < signalPeriod) return [];

  const k = 2 / (signalPeriod + 1);
  let sig = 0;
  for (let i = 0; i < signalPeriod; i++) sig += macdLine[i].value;
  sig /= signalPeriod;

  const out: MacdPoint[] = [
    {
      time: macdLine[signalPeriod - 1].time,
      macd: Number(macdLine[signalPeriod - 1].value.toFixed(2)),
      signal: Number(sig.toFixed(2)),
      histogram: Number((macdLine[signalPeriod - 1].value - sig).toFixed(2)),
    },
  ];

  for (let i = signalPeriod; i < macdLine.length; i++) {
    sig = macdLine[i].value * k + sig * (1 - k);
    out.push({
      time: macdLine[i].time,
      macd: Number(macdLine[i].value.toFixed(2)),
      signal: Number(sig.toFixed(2)),
      histogram: Number((macdLine[i].value - sig).toFixed(2)),
    });
  }
  return out;
}

/** Supertrend (ATR-based, default period 10, multiplier 3). */
export function computeSupertrend(bars: CandleBar[], period = 10, multiplier = 3): SupertrendPoint[] {
  if (bars.length < period + 1) return [];
  const trs: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose)));
  }

  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;

  const out: SupertrendPoint[] = [];
  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let prevTrend: 'UP' | 'DOWN' = 'UP';

  for (let i = period; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    const finalUpper =
      i === period || basicUpper < prevFinalUpper || bars[i - 1].close > prevFinalUpper
        ? basicUpper
        : prevFinalUpper;
    const finalLower =
      i === period || basicLower > prevFinalLower || bars[i - 1].close < prevFinalLower
        ? basicLower
        : prevFinalLower;

    let direction: 'UP' | 'DOWN' = prevTrend;
    if (prevTrend === 'UP' && bars[i].close < finalLower) direction = 'DOWN';
    else if (prevTrend === 'DOWN' && bars[i].close > finalUpper) direction = 'UP';

    out.push({
      time: bars[i].time,
      value: Number((direction === 'UP' ? finalLower : finalUpper).toFixed(2)),
      direction,
    });

    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevTrend = direction;
  }

  return out;
}

/** Weighted Moving Average (WMA). */
export function computeWMA(bars: CandleBar[], period = 20): IndicatorPoint[] {
  if (period <= 0 || bars.length < period) return [];
  const denom = (period * (period + 1)) / 2;
  const out: IndicatorPoint[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) {
      sum += bars[i - period + 1 + k].close * (k + 1);
    }
    out.push({ time: bars[i].time, value: Number((sum / denom).toFixed(2)) });
  }
  return out;
}

/** Average True Range (Wilder's ATR, default 14). */
export function computeATR(bars: CandleBar[], period = 14): IndicatorPoint[] {
  if (period <= 0 || bars.length <= period) return [];
  const trs: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prevC = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prevC), Math.abs(b.low - prevC)));
  }
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;
  const out: IndicatorPoint[] = [{ time: bars[period - 1].time, value: Number(atr.toFixed(2)) }];
  for (let i = period; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out.push({ time: bars[i].time, value: Number(atr.toFixed(2)) });
  }
  return out;
}

/** Stochastic RSI (default 14, 14). */
export function computeStochRSI(bars: CandleBar[], rsiPeriod = 14, stochPeriod = 14): IndicatorPoint[] {
  const rsi = computeRSI(bars, rsiPeriod);
  if (rsi.length < stochPeriod) return [];
  const out: IndicatorPoint[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    let minV = Infinity;
    let maxV = -Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsi[j].value < minV) minV = rsi[j].value;
      if (rsi[j].value > maxV) maxV = rsi[j].value;
    }
    const val = maxV === minV ? 50 : ((rsi[i].value - minV) / (maxV - minV)) * 100;
    out.push({ time: rsi[i].time, value: Number(val.toFixed(2)) });
  }
  return out;
}

/** Commodity Channel Index (CCI, default 20). */
export function computeCCI(bars: CandleBar[], period = 20): IndicatorPoint[] {
  if (period <= 1 || bars.length < period) return [];
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const out: IndicatorPoint[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j];
    const sma = sum / period;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - sma);
    md /= period;
    const cci = md === 0 ? 0 : (tp[i] - sma) / (0.015 * md);
    out.push({ time: bars[i].time, value: Number(cci.toFixed(2)) });
  }
  return out;
}

/** Average Directional Index (ADX, default 14). */
export function computeADX(bars: CandleBar[], period = 14): IndicatorPoint[] {
  if (bars.length < period * 2 + 1) return [];
  const trs: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      )
    );
  }
  let smTR = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 0; i < period; i++) {
    smTR += trs[i];
    smPlus += plusDM[i];
    smMinus += minusDM[i];
  }
  const dxList: Array<{ time: number; dx: number }> = [];
  for (let i = period; i < trs.length; i++) {
    smTR = smTR - smTR / period + trs[i];
    smPlus = smPlus - smPlus / period + plusDM[i];
    smMinus = smMinus - smMinus / period + minusDM[i];
    const pdi = smTR > 0 ? (smPlus / smTR) * 100 : 0;
    const mdi = smTR > 0 ? (smMinus / smTR) * 100 : 0;
    const dx = pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
    dxList.push({ time: bars[i + 1].time, dx });
  }
  if (dxList.length < period) return [];
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dxList[i].dx;
  adx /= period;
  const out: IndicatorPoint[] = [{ time: dxList[period - 1].time, value: Number(adx.toFixed(2)) }];
  for (let i = period; i < dxList.length; i++) {
    adx = (adx * (period - 1) + dxList[i].dx) / period;
    out.push({ time: dxList[i].time, value: Number(adx.toFixed(2)) });
  }
  return out;
}

/** On-Balance Volume (OBV). */
export function computeOBV(bars: CandleBar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  let obv = 0;
  const out: IndicatorPoint[] = [{ time: bars[0].time, value: 0 }];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) obv += bars[i].volume || 0;
    else if (bars[i].close < bars[i - 1].close) obv -= bars[i].volume || 0;
    out.push({ time: bars[i].time, value: obv });
  }
  return out;
}

/** Donchian Channels (default 20). */
export function computeDonchian(bars: CandleBar[], period = 20): BollingerPoint[] {
  if (period <= 1 || bars.length < period) return [];
  const out: BollingerPoint[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    out.push({
      time: bars[i].time,
      upper: Number(hi.toFixed(2)),
      middle: Number(((hi + lo) / 2).toFixed(2)),
      lower: Number(lo.toFixed(2)),
    });
  }
  return out;
}

/** Keltner Channels (EMA 20 ± 2 * ATR 10). */
export function computeKeltner(bars: CandleBar[], emaPeriod = 20, atrPeriod = 10, mult = 2): BollingerPoint[] {
  const ema = computeEMA(bars, emaPeriod);
  const atr = computeATR(bars, atrPeriod);
  const atrMap = new Map(atr.map((p) => [p.time, p.value]));
  const out: BollingerPoint[] = [];
  for (const e of ema) {
    const a = atrMap.get(e.time);
    if (a === undefined) continue;
    out.push({
      time: e.time,
      upper: Number((e.value + mult * a).toFixed(2)),
      middle: e.value,
      lower: Number((e.value - mult * a).toFixed(2)),
    });
  }
  return out;
}

/** Standard Pivot Points + Central Pivot Range (CPR) from previous completed bar. */
export function computePivotPoints(prevBar: { high: number; low: number; close: number }) {
  const pivot = (prevBar.high + prevBar.low + prevBar.close) / 3;
  const bc = (prevBar.high + prevBar.low) / 2;
  const tc = pivot - bc + pivot;
  const r1 = 2 * pivot - prevBar.low;
  const s1 = 2 * pivot - prevBar.high;
  const r2 = pivot + (prevBar.high - prevBar.low);
  const s2 = pivot - (prevBar.high - prevBar.low);
  const r3 = prevBar.high + 2 * (pivot - prevBar.low);
  const s3 = prevBar.low - 2 * (prevBar.high - pivot);
  const round2 = (v: number) => Number(v.toFixed(2));
  return {
    pivot: round2(pivot),
    tc: round2(Math.max(tc, bc)),
    bc: round2(Math.min(tc, bc)),
    r1: round2(r1),
    r2: round2(r2),
    r3: round2(r3),
    s1: round2(s1),
    s2: round2(s2),
    s3: round2(s3),
  };
}

/** Extended Internal Rate of Return (XIRR %) via Newton-Raphson over dated cash flows. */
export function computeXIRR(cashflows: Array<{ amount: number; date: Date | string }>): number | null {
  if (cashflows.length < 2) return null;
  const parsed = cashflows
    .map((c) => ({ amount: c.amount, time: new Date(c.date).getTime() }))
    .filter((c) => Number.isFinite(c.amount) && Number.isFinite(c.time))
    .sort((a, b) => a.time - b.time);
  if (parsed.length < 2) return null;
  const hasPos = parsed.some((c) => c.amount > 0);
  const hasNeg = parsed.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = parsed[0].time;
  const years = parsed.map((c) => (c.time - t0) / (365 * 86_400_000));
  if (years[years.length - 1] < 1 / 365) return null;

  let rate = 0.12; // 12% initial guess
  for (let iter = 0; iter < 80; iter++) {
    let f = 0;
    let df = 0;
    for (let i = 0; i < parsed.length; i++) {
      const t = years[i];
      const base = Math.max(0.0001, 1 + rate);
      const disc = Math.pow(base, t);
      f += parsed[i].amount / disc;
      df -= (t * parsed[i].amount) / (disc * base);
    }
    if (Math.abs(f) < 1e-6) return Number((rate * 100).toFixed(2));
    if (Math.abs(df) < 1e-10) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.99 || next > 100) break;
    if (Math.abs(next - rate) < 1e-7) return Number((next * 100).toFixed(2));
    rate = next;
  }
  return Number.isFinite(rate) ? Number((rate * 100).toFixed(2)) : null;
}
