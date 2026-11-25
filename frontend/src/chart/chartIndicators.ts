export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface LinePt {
  time: number;
  value: number;
}

export function calcHeikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: b.time,
      open: Number(haOpen.toFixed(2)),
      high: Number(Math.max(b.high, haOpen, haClose).toFixed(2)),
      low: Number(Math.min(b.low, haOpen, haClose).toFixed(2)),
      close: Number(haClose.toFixed(2)),
      volume: b.volume,
      oi: b.oi,
    });
  }
  return out;
}

export function calcSMA(bars: Bar[], period = 20): LinePt[] {
  if (bars.length < period) return [];
  const out: LinePt[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time, value: Number((sum / period).toFixed(2)) });
  }
  return out;
}

export function calcEMA(bars: Bar[], period = 50): LinePt[] {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
  const out: LinePt[] = [{ time: bars[period - 1].time, value: Number(ema.toFixed(2)) }];
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: Number(ema.toFixed(2)) });
  }
  return out;
}

export function calcVWAP(bars: Bar[]): LinePt[] {
  const out: LinePt[] = [];
  let cumPV = 0;
  let cumVol = 0;
  let lastDay = '';
  for (const b of bars) {
    const day = new Date(b.time * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (day !== lastDay) { cumPV = 0; cumVol = 0; lastDay = day; }
    const v = Math.max(1, b.volume || 0);
    cumPV += ((b.high + b.low + b.close) / 3) * v;
    cumVol += v;
    out.push({ time: b.time, value: Number((cumPV / cumVol).toFixed(2)) });
  }
  return out;
}

export function calcBollinger(bars: Bar[], period = 20, mult = 2) {
  const upper: LinePt[] = [];
  const middle: LinePt[] = [];
  const lower: LinePt[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, b) => s + b.close, 0) / period;
    const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push({ time: bars[i].time, value: Number((mean + mult * sd).toFixed(2)) });
    middle.push({ time: bars[i].time, value: Number(mean.toFixed(2)) });
    lower.push({ time: bars[i].time, value: Number((mean - mult * sd).toFixed(2)) });
  }
  return { upper, middle, lower };
}

export function calcSupertrend(bars: Bar[], period = 10, mult = 3): Array<{ time: number; value: number; color: string }> {
  if (bars.length < period + 1) return [];
  const trs: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  let atr = trs.slice(0, period).reduce((s, x) => s + x, 0) / period;
  let prevU = 0;
  let prevL = 0;
  let dir: 'UP' | 'DOWN' = 'UP';
  const out: Array<{ time: number; value: number; color: string }> = [];

  for (let i = period; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const bu = hl2 + mult * atr;
    const bl = hl2 - mult * atr;
    const fu = i === period || bu < prevU || bars[i - 1].close > prevU ? bu : prevU;
    const fl = i === period || bl > prevL || bars[i - 1].close < prevL ? bl : prevL;
    if (dir === 'UP' && bars[i].close < fl) dir = 'DOWN';
    else if (dir === 'DOWN' && bars[i].close > fu) dir = 'UP';
    out.push({
      time: bars[i].time,
      value: Number((dir === 'UP' ? fl : fu).toFixed(2)),
      color: dir === 'UP' ? '#10b981' : '#ef4444',
    });
    prevU = fu;
    prevL = fl;
  }
  return out;
}

export function calcRSI(bars: Bar[], period = 14): LinePt[] {
  if (bars.length <= period) return [];
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period;
  al /= period;
  const toRsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  const out: LinePt[] = [{ time: bars[period].time, value: Number(toRsi(ag, al).toFixed(2)) }];
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out.push({ time: bars[i].time, value: Number(toRsi(ag, al).toFixed(2)) });
  }
  return out;
}

export function calcMACD(bars: Bar[], fast = 12, slow = 26, sigP = 9) {
  if (bars.length < slow + sigP) return { macd: [] as LinePt[], signal: [] as LinePt[], hist: [] as Array<{ time: number; value: number; color: string }> };
  const f = calcEMA(bars, fast);
  const s = calcEMA(bars, slow);
  const fm = new Map(f.map((p) => [p.time, p.value]));
  const ml: LinePt[] = [];
  for (const pt of s) {
    const fv = fm.get(pt.time);
    if (fv !== undefined) ml.push({ time: pt.time, value: fv - pt.value });
  }
  if (ml.length < sigP) return { macd: [], signal: [], hist: [] };
  const k = 2 / (sigP + 1);
  let sig = ml.slice(0, sigP).reduce((a, b) => a + b.value, 0) / sigP;
  const macd: LinePt[] = [];
  const signal: LinePt[] = [];
  const hist: Array<{ time: number; value: number; color: string }> = [];
  for (let i = sigP - 1; i < ml.length; i++) {
    if (i > sigP - 1) sig = ml[i].value * k + sig * (1 - k);
    const h = ml[i].value - sig;
    macd.push({ time: ml[i].time, value: Number(ml[i].value.toFixed(2)) });
    signal.push({ time: ml[i].time, value: Number(sig.toFixed(2)) });
    hist.push({ time: ml[i].time, value: Number(h.toFixed(2)), color: h >= 0 ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)' });
  }
  return { macd, signal, hist };
}

export function calcWMA(bars: Bar[], period = 20): LinePt[] {
  if (bars.length < period) return [];
  const denom = (period * (period + 1)) / 2;
  const out: LinePt[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += bars[i - period + 1 + k].close * (k + 1);
    out.push({ time: bars[i].time, value: Number((sum / denom).toFixed(2)) });
  }
  return out;
}

export function calcATR(bars: Bar[], period = 14): LinePt[] {
  if (bars.length <= period) return [];
  const trs: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out: LinePt[] = [{ time: bars[period - 1].time, value: Number(atr.toFixed(2)) }];
  for (let i = period; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out.push({ time: bars[i].time, value: Number(atr.toFixed(2)) });
  }
  return out;
}

export function calcStochRSI(bars: Bar[], rsiPeriod = 14, stochPeriod = 14): LinePt[] {
  const rsi = calcRSI(bars, rsiPeriod);
  if (rsi.length < stochPeriod) return [];
  const out: LinePt[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    let minV = Infinity;
    let maxV = -Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsi[j].value < minV) minV = rsi[j].value;
      if (rsi[j].value > maxV) maxV = rsi[j].value;
    }
    const v = maxV === minV ? 50 : ((rsi[i].value - minV) / (maxV - minV)) * 100;
    out.push({ time: rsi[i].time, value: Number(v.toFixed(2)) });
  }
  return out;
}

export function calcCCI(bars: Bar[], period = 20): LinePt[] {
  if (bars.length < period) return [];
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const out: LinePt[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j];
    const sma = sum / period;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - sma);
    md /= period;
    out.push({ time: bars[i].time, value: Number((md === 0 ? 0 : (tp[i] - sma) / (0.015 * md)).toFixed(2)) });
  }
  return out;
}

export function calcADX(bars: Bar[], period = 14): LinePt[] {
  if (bars.length < period * 2 + 1) return [];
  const trs: number[] = [];
  const pDM: number[] = [];
  const mDM: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  let smTR = 0, smP = 0, smM = 0;
  for (let i = 0; i < period; i++) { smTR += trs[i]; smP += pDM[i]; smM += mDM[i]; }
  const dx: Array<{ time: number; v: number }> = [];
  for (let i = period; i < trs.length; i++) {
    smTR = smTR - smTR / period + trs[i];
    smP = smP - smP / period + pDM[i];
    smM = smM - smM / period + mDM[i];
    const pdi = smTR > 0 ? (smP / smTR) * 100 : 0;
    const mdi = smTR > 0 ? (smM / smTR) * 100 : 0;
    dx.push({ time: bars[i + 1].time, v: pdi + mdi > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0 });
  }
  if (dx.length < period) return [];
  let adx = dx.slice(0, period).reduce((s, x) => s + x.v, 0) / period;
  const out: LinePt[] = [{ time: dx[period - 1].time, value: Number(adx.toFixed(2)) }];
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i].v) / period;
    out.push({ time: dx[i].time, value: Number(adx.toFixed(2)) });
  }
  return out;
}

export function calcOBV(bars: Bar[]): LinePt[] {
  if (!bars.length) return [];
  let obv = 0;
  const out: LinePt[] = [{ time: bars[0].time, value: 0 }];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) obv += bars[i].volume || 0;
    else if (bars[i].close < bars[i - 1].close) obv -= bars[i].volume || 0;
    out.push({ time: bars[i].time, value: obv });
  }
  return out;
}

export function calcDonchian(bars: Bar[], period = 20) {
  const upper: LinePt[] = [], middle: LinePt[] = [], lower: LinePt[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    upper.push({ time: bars[i].time, value: Number(hi.toFixed(2)) });
    middle.push({ time: bars[i].time, value: Number(((hi + lo) / 2).toFixed(2)) });
    lower.push({ time: bars[i].time, value: Number(lo.toFixed(2)) });
  }
  return { upper, middle, lower };
}

export function calcKeltner(bars: Bar[], emaPeriod = 20, atrPeriod = 10, mult = 2) {
  const ema = calcEMA(bars, emaPeriod);
  const atr = calcATR(bars, atrPeriod);
  const atrMap = new Map(atr.map((p) => [p.time, p.value]));
  const upper: LinePt[] = [], middle: LinePt[] = [], lower: LinePt[] = [];
  for (const e of ema) {
    const a = atrMap.get(e.time);
    if (a === undefined) continue;
    upper.push({ time: e.time, value: Number((e.value + mult * a).toFixed(2)) });
    middle.push(e);
    lower.push({ time: e.time, value: Number((e.value - mult * a).toFixed(2)) });
  }
  return { upper, middle, lower };
}

export function calcPivots(bars: Bar[]) {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const pivot = (prev.high + prev.low + prev.close) / 3;
  const bc = (prev.high + prev.low) / 2;
  const tc = pivot - bc + pivot;
  return {
    pivot: Number(pivot.toFixed(2)),
    tc: Number(Math.max(tc, bc).toFixed(2)),
    bc: Number(Math.min(tc, bc).toFixed(2)),
    r1: Number((2 * pivot - prev.low).toFixed(2)),
    s1: Number((2 * pivot - prev.high).toFixed(2)),
    r2: Number((pivot + (prev.high - prev.low)).toFixed(2)),
    s2: Number((pivot - (prev.high - prev.low)).toFixed(2)),
  };
}
