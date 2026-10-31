/**
 * chart/indicators.js
 * ---------------------------------------------------------------------------
 * Streaming-capable indicator math on plain arrays.
 * All functions are pure and return [{time, value}] so they can be rendered by
 * the same line primitive as price-derived overlays.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function sma(values, period) {
  const out = [];
  const n = values.length;
  if (n < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push({ time: i, value: sum / period });
  }
  return out;
}

export function ema(values, period) {
  const out = [];
  const n = values.length;
  if (n < period || period <= 0) return out;
  const k = 2 / (period + 1);
  // seed = SMA of the first `period` values (not period-1)
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out.push({ time: period - 1, value: prev });
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push({ time: i, value: prev });
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = [];
  const n = values.length;
  if (n <= period || period <= 0) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  out.push({ time: period, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  for (let i = period + 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
    out.push({ time: i, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  }
  return out;
}

/** MACD line, signal, histogram. Returns index-aligned arrays. */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const n = values.length;
  const empty = { line: [], signal: [], hist: [] };
  if (n < slow + signal) return empty;
  const f = ema(values, fast);
  const s = ema(values, slow);
  const lineMap = new Map(f.map((p) => [p.time, p.value]));
  const slowMap = new Map(s.map((p) => [p.time, p.value]));

  const line = [];
  f.forEach((p) => {
    if (slowMap.has(p.time)) line.push({ time: p.time, value: p.value - slowMap.get(p.time) });
  });
  void lineMap;

  // signal = EMA of the MACD line values, keyed by their own positions
  const lineVals = line.map((p) => p.value);
  const sigRaw = ema(lineVals, signal);
  const signal_ = sigRaw.map((p) => ({ time: line[p.time].time, value: p.value }));
  const sigMap = new Map(signal_.map((p) => [p.time, p.value]));

  const hist = line
    .filter((p) => sigMap.has(p.time))
    .map((p) => ({ time: p.time, value: p.value - sigMap.get(p.time) }));

  return { line, signal: signal_, hist };
}

export function bollinger(values, period = 20, mult = 2) {
  const n = values.length;
  const out = [];
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = values[j] - mean; v += d * d; }
    const sd = Math.sqrt(v / period);
    out.push({ time: i, mean, upper: mean + mult * sd, lower: mean - mult * sd });
  }
  return out;
}

export function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = [];
  if (n < period + 1) return out;
  const tr = [];
  for (let i = 1; i < n; i++) {
    const pc = closes[i - 1];
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc)));
  }
  let prev = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out.push({ time: period, value: prev });
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out.push({ time: i + 1, value: prev });
  }
  return out;
}

/**
 * SuperTrend - canonical implementation with sticky final bands.
 * The direction only flips when price decisively crosses the previous final
 * band, which is what makes it usable as a trend filter.
 */
export function supertrend(highs, lows, closes, period = 10, mult = 3) {
  const n = closes.length;
  const out = [];
  if (n < period + 2) return out;
  const a = atr(highs, lows, closes, period);
  const aMap = new Map(a.map((p) => [p.time, p.value]));

  // Direction is decided against the PREVIOUS final bands, then the bands are
  // ratcheted. Checking against the just-updated bands deadlocks dir at 1.
  let finalUpper = null;
  let finalLower = null;
  let dir = 1;

  for (let i = 0; i < n; i++) {
    if (!aMap.has(i)) continue;
    const av = aMap.get(i);
    const hl2 = (highs[i] + lows[i]) / 2;
    const basicUpper = hl2 + mult * av;
    const basicLower = hl2 - mult * av;
    const c = closes[i];

    if (finalUpper == null || finalLower == null) {
      dir = c >= hl2 ? 1 : -1;
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      const prevUpper = finalUpper;
      const prevLower = finalLower;
      const upDir = c > prevUpper;
      const downDir = c < prevLower;
      if (upDir) dir = 1;
      else if (downDir) dir = -1;
      finalUpper = upDir ? basicUpper : Math.min(basicUpper, prevUpper);
      finalLower = downDir ? basicLower : Math.max(basicLower, prevLower);
    }

    out.push({ time: i, value: dir === 1 ? finalLower : finalUpper, direction: dir });
  }
  return out;
}

/** Volume Profile: POC, VAH, VAL over the visible range (row size = 1 tick bucket). */
export function volumeProfile(store, from, count, rowPx = 8) {
  const lo = Math.max(0, from);
  const hi = Math.min(store.len, from + count);
  if (hi <= lo) return null;
  let mn = Infinity, mx = -Infinity;
  for (let i = lo; i < hi; i++) {
    if (store.high[i] > mx) mx = store.high[i];
    if (store.low[i] < mn) mn = store.low[i];
  }
  const span = mx - mn;
  if (!isFinite(span) || span <= 0) return null;
  const rows = Math.max(8, Math.min(120, Math.floor(160 / rowPx)));
  const step = span / rows;

  const buckets = new Float64Array(rows);
  for (let i = lo; i < hi; i++) {
    // distribute volume across the bar's range
    const barLo = (store.low[i] - mn) / step;
    const barHi = (store.high[i] - mn) / step;
    const b0 = clamp(Math.floor(barLo), 0, rows - 1);
    const b1 = clamp(Math.floor(barHi), 0, rows - 1);
    const v = store.volume[i] || 0;
    if (b1 === b0) { buckets[b0] += v; continue; }
    const per = v / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) buckets[b] += per;
  }

  let pocIndex = 0, pocVol = -Infinity, total = 0;
  for (let i = 0; i < rows; i++) { if (buckets[i] > pocVol) { pocVol = buckets[i]; pocIndex = i; } total += buckets[i]; }

  // value area = 70% of volume around POC
  const target = total * 0.7;
  let acc = pocVol;
  let loIdx = pocIndex, hiIdx = pocIndex;
  while (acc < target && (loIdx > 0 || hiIdx < rows - 1)) {
    const below = loIdx > 0 ? buckets[loIdx - 1] : -1;
    const above = hiIdx < rows - 1 ? buckets[hiIdx + 1] : -1;
    if (above >= below) { hiIdx++; acc += buckets[hiIdx]; }
    else { loIdx--; acc += buckets[loIdx]; }
  }

  return {
    rows, step, min: mn, max: mx,
    poc: mn + (pocIndex + 0.5) * step,
    vah: mn + (hiIdx + 1) * step,
    val: mn + loIdx * step,
    pocVolume: pocVol,
    totalVolume: total,
  };
}

/** VWAP (session agnostic; caller resets per day when needed). */
export function vwap(store, from, count) {
  const lo = Math.max(0, from);
  const hi = Math.min(store.len, from + count);
  const out = [];
  let pv = 0, vv = 0;
  for (let i = lo; i < hi; i++) {
    const tp = (store.high[i] + store.low[i] + store.close[i]) / 3;
    const v = store.volume[i] || 0;
    pv += tp * v; vv += v;
    out.push({ time: i, value: vv > 0 ? pv / vv : store.close[i] });
  }
  return out;
}

/** Daily reset VWAP (resets when the IST calendar day changes). */
export function sessionVwap(store, from, count, dayKeyOf) {
  const lo = Math.max(0, from);
  const hi = Math.min(store.len, from + count);
  const out = [];
  let pv = 0, vv = 0, curDay = null;
  for (let i = lo; i < hi; i++) {
    const dk = dayKeyOf(store.time[i]);
    if (curDay === null || dk !== curDay) { curDay = dk; pv = 0; vv = 0; }
    const tp = (store.high[i] + store.low[i] + store.close[i]) / 3;
    const v = store.volume[i] || 0;
    pv += tp * v; vv += v;
    out.push({ time: i, value: vv > 0 ? pv / vv : store.close[i] });
  }
  return out;
}

/** Stochastic oscillator: %K (fast) and %D (SMA of %K). */
export function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const n = closes.length;
  const k = [];
  if (n < kPeriod || kPeriod <= 0 || dPeriod <= 0) return { k, d: [] };
  for (let i = kPeriod - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const range = hh - ll;
    k.push({ time: i, value: range === 0 ? 50 : (100 * (closes[i] - ll)) / range });
  }
  const d = sma(k.map((p) => p.value), dPeriod).map((p, idx) => ({
    time: k[idx + dPeriod - 1].time,
    value: p.value,
  }));
  return { k, d };
}

/** Parabolic SAR (Wilder). direction 1 = below price (bullish), -1 = above (bearish). */
export function parabolicSAR(highs, lows, closes, step = 0.02, maxStep = 0.2) {
  const n = closes.length;
  const out = [];
  if (n < 2) return out;
  let trend = closes[1] >= closes[0] ? 1 : -1;
  let sar = trend === 1 ? lows[0] : highs[0];
  let ep = trend === 1 ? highs[0] : lows[0];
  let af = step;
  out.push({ time: 0, value: sar, direction: trend });
  for (let i = 1; i < n; i++) {
    sar += af * (ep - sar);
    if (trend === 1) {
      sar = Math.min(sar, lows[i - 1]);
      if (sar > lows[i]) {
        sar = ep;
        trend = -1;
        ep = lows[i];
        af = step;
      } else if (highs[i] > ep) {
        ep = highs[i];
        af = Math.min(af + step, maxStep);
      }
    } else {
      sar = Math.max(sar, highs[i - 1]);
      if (sar < highs[i]) {
        sar = ep;
        trend = 1;
        ep = highs[i];
        af = step;
      } else if (lows[i] < ep) {
        ep = lows[i];
        af = Math.min(af + step, maxStep);
      }
    }
    out.push({ time: i, value: sar, direction: trend });
  }
  return out;
}

function midpointLine(highs, lows, period) {
  const n = highs.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    out[i] = (hh + ll) / 2;
  }
  return out;
}

/** Ichimoku Cloud: Tenkan, Kijun, Senkou A/B (forward 26) and Chikun (back 26). */
export function ichimokuCloud(highs, lows, closes) {
  const n = closes.length;
  const tenkan = midpointLine(highs, lows, 9);
  const kijun = midpointLine(highs, lows, 26);
  const senkouB = midpointLine(highs, lows, 52);
  const out = { tenkan: [], kijun: [], senkouA: [], senkouB: [], chikun: [] };
  for (let i = 0; i < n; i++) {
    if (tenkan[i] != null) out.tenkan.push({ time: i, value: tenkan[i] });
    if (kijun[i] != null) out.kijun.push({ time: i, value: kijun[i] });
    if (i >= 26) {
      const a = tenkan[i - 26];
      const b = kijun[i - 26];
      if (a != null && b != null) out.senkouA.push({ time: i, value: (a + b) / 2 });
      if (senkouB[i - 26] != null) out.senkouB.push({ time: i, value: senkouB[i - 26] });
    }
    if (i + 26 < n) out.chikun.push({ time: i, value: closes[i + 26] });
  }
  return out;
}

/** Heikin-Ashi candles derived from a store's open/high/low/close arrays. */
export function heikinAshi(store) {
  const n = store.len;
  const out = { open: [], high: [], low: [], close: [] };
  if (n === 0) return out;
  let prevOpen = store.open[0];
  let prevClose = (store.open[0] + store.high[0] + store.low[0] + store.close[0]) / 4;
  for (let i = 0; i < n; i++) {
    const o = store.open[i], h = store.high[i], l = store.low[i], c = store.close[i];
    const haClose = (o + h + l + c) / 4;
    const haOpen = i === 0 ? o : (prevOpen + prevClose) / 2;
    const candle = {
      time: i,
      open: haOpen,
      high: Math.max(h, haOpen, haClose),
      low: Math.min(l, haOpen, haClose),
      close: haClose,
    };
    out.open.push(candle);
    out.high.push(candle);
    out.low.push(candle);
    out.close.push(candle);
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

/** Renko bricks of fixed brickSize built from close prices. */
export function renko(bars, brickSize) {
  const out = [];
  if (bars.length === 0 || !(brickSize > 0)) return out;
  let lastClose = bars[0].close;
  for (let i = 0; i < bars.length; i++) {
    const price = bars[i].close;
    while (price - lastClose >= brickSize) {
      const open = lastClose;
      const close = open + brickSize;
      out.push({ time: bars[i].time, open, close, high: close, low: open, direction: 'up' });
      lastClose = close;
    }
    while (lastClose - price >= brickSize) {
      const open = lastClose;
      const close = open - brickSize;
      out.push({ time: bars[i].time, open, close, high: open, low: close, direction: 'down' });
      lastClose = close;
    }
  }
  return out;
}

/** On-Balance Volume: cumulative volume signed by close direction. */
export function obv(closes, volumes) {
  const n = closes.length;
  const out = [];
  if (n === 0) return out;
  let value = 0;
  out.push({ time: 0, value });
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) value += volumes[i];
    else if (closes[i] < closes[i - 1]) value -= volumes[i];
    out.push({ time: i, value });
  }
  return out;
}

/** Money Flow Index (0-100) from typical price and volume. */
export function moneyFlowIndex(highs, lows, closes, volumes, period = 14) {
  const n = closes.length;
  const out = [];
  if (n < period + 1) return out;
  const pos = new Array(n).fill(0);
  const neg = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const ptp = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
    const mf = tp * (volumes[i] || 0);
    if (tp > ptp) pos[i] = mf;
    else if (tp < ptp) neg[i] = mf;
  }
  let posSum = 0, negSum = 0;
  for (let i = 1; i <= period; i++) { posSum += pos[i]; negSum += neg[i]; }
  out.push({ time: period, value: negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum) });
  for (let i = period + 1; i < n; i++) {
    posSum += pos[i] - pos[i - period];
    negSum += neg[i] - neg[i - period];
    out.push({ time: i, value: negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum) });
  }
  return out;
}

/** Williams %R: -100 * (HH - C) / (HH - LL). */
export function williamsR(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = [];
  if (n < period || period <= 0) return out;
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const range = hh - ll;
    out.push({ time: i, value: range === 0 ? -50 : (-100 * (hh - closes[i])) / range });
  }
  return out;
}

/** Commodity Channel Index from typical price and its mean deviation. */
export function cci(highs, lows, closes, period = 20) {
  const n = closes.length;
  const out = [];
  if (n < period || period <= 0) return out;
  const tp = new Array(n);
  for (let i = 0; i < n; i++) tp[i] = (highs[i] + lows[i] + closes[i]) / 3;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j];
    const mean = sum / period;
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - mean);
    const md = dev / period;
    out.push({ time: i, value: md === 0 ? 0 : (tp[i] - mean) / (0.015 * md) });
  }
  return out;
}

/** Average Directional Index with +DI and -DI (Wilder smoothing). */
export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  const empty = { adx: [], plusDI: [], minusDI: [] };
  if (n < period + 1) return empty;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < n; i++) {
    const h = highs[i], l = lows[i], ph = highs[i - 1], pl = lows[i - 1], pc = closes[i - 1];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, dn = pl - l;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const m = tr.length;
  let trS = 0, pS = 0, mS = 0;
  for (let i = 0; i < period; i++) { trS += tr[i]; pS += plusDM[i]; mS += minusDM[i]; }
  const plusDI = [], minusDI = [], dx = [];
  const record = (bar) => {
    const p = trS === 0 ? 0 : (100 * pS) / trS;
    const d = trS === 0 ? 0 : (100 * mS) / trS;
    plusDI.push({ time: bar, value: p });
    minusDI.push({ time: bar, value: d });
    dx.push(p + d === 0 ? 0 : (100 * Math.abs(p - d)) / (p + d));
  };
  record(period);
  for (let i = period; i < m; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + plusDM[i];
    mS = mS - mS / period + minusDM[i];
    record(i + 1);
  }
  const adxOut = [];
  if (dx.length < period) return { adx: adxOut, plusDI, minusDI };
  let adxS = 0;
  for (let i = 0; i < period; i++) adxS += dx[i];
  adxOut.push({ time: 2 * period - 1, value: adxS / period });
  for (let i = period; i < dx.length; i++) {
    adxS = adxS - adxS / period + dx[i];
    adxOut.push({ time: period + i, value: adxS / period });
  }
  return { adx: adxOut, plusDI, minusDI };
}

export { clamp };
