'use strict';
/**
 * ai/features.js — leakage-safe feature extraction for the direction forecaster.
 *
 * Every feature at bar t uses ONLY data available at or before t. No future
 * bars, no unlagged values, no target leakage. The label is the sign of the
 * next-bar return, computed separately so it can never leak into features.
 *
 * Features (all z-scored at train time):
 *   ret1, ret5, ret20          log returns over 1/5/20 bars
 *   vol20                      20-bar realized volatility (annualized-ish)
 *   rsi14                      0-100, centered to [-1,1]
 *   macdHist                   MACD histogram, ATR-normalized
 *   bbPos                      close position within Bollinger bands [0,1]
 *   bbWidth                    band width / middle (squeeze detector)
 *   atrPct                     ATR as % of close
 *   volZ                       volume z-score vs 20-bar mean
 *   vwapDist                   (close - session VWAP) / ATR
 *   rangePct                   (high-low) / close
 *   gapPct                     (open - prevClose) / prevClose
 *   trend20                    close vs 20-SMA, in ATR units
 *   dayFrac                    fraction of NSE session elapsed (time-of-day effect)
 */

function logReturns(closes) {
  const out = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) out[i] = Math.log(closes[i] / closes[i - 1]);
  return out;
}

function smaArr(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function emaArr(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsiArr(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / period, al = l / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function atrArr(highs, lows, closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  const tr = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let prev = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period] = prev;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i + 1] = prev;
  }
  return out;
}

/** IST calendar day key for the session-VWAP reset. */
function dayKey(t) {
  const d = new Date((t * 1000) + 5.5 * 3600 * 1000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Fraction of the NSE session elapsed (0 at 09:15, 1 at 15:30). */
function dayFrac(t) {
  const d = new Date((t * 1000) + 5.5 * 3600 * 1000);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return Math.max(0, Math.min(1, (mins - 555) / 375));
}

/**
 * Extract features AND labels from a candle array.
 * Returns { X: number[][], y: number[], times: number[] } where y[i] is the
 * sign of the return from bar i to bar i+1 (the only future value used, and
 * only as the label).
 */
function extractFeatures(bars) {
  if (!bars || bars.length < 60) return { X: [], y: [], times: [] };

  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const opens = bars.map((b) => b.open);
  const vols = bars.map((b) => b.volume || 0);
  const times = bars.map((b) => b.time);

  const rets = logReturns(closes);
  const vol20 = new Array(n).fill(null);
  for (let i = 20; i < n; i++) {
    let m = 0;
    for (let j = i - 19; j <= i; j++) m += rets[j];
    m /= 20;
    let v = 0;
    for (let j = i - 19; j <= i; j++) { const d = rets[j] - m; v += d * d; }
    vol20[i] = Math.sqrt(v / 19);
  }

  const rsi = rsiArr(closes, 14);
  const ema12 = emaArr(closes, 12), ema26 = emaArr(closes, 26);
  const macdLine = closes.map((_, i) => (ema12[i] != null && ema26[i] != null) ? ema12[i] - ema26[i] : null);
  const macdVals = macdLine.filter((v) => v != null);
  const sigRaw = emaArr(macdVals, 9);
  // align signal back to bar indices
  const sig = new Array(n).fill(null);
  {
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (macdLine[i] == null) continue;
      if (k < sigRaw.length && sigRaw[k] != null) sig[i] = sigRaw[k];
      k++;
    }
  }

  const bbMid = smaArr(closes, 20);
  const bbSd = new Array(n).fill(null);
  for (let i = 19; i < n; i++) {
    let v = 0;
    for (let j = i - 19; j <= i; j++) { const d = closes[j] - bbMid[i]; v += d * d; }
    bbSd[i] = Math.sqrt(v / 20);
  }

  const atr = atrArr(highs, lows, closes, 14);
  const sma20 = smaArr(closes, 20);
  const volMean20 = smaArr(vols, 20);
  const volSd20 = new Array(n).fill(null);
  for (let i = 19; i < n; i++) {
    let v = 0;
    for (let j = i - 19; j <= i; j++) { const d = vols[j] - volMean20[i]; v += d * d; }
    volSd20[i] = Math.sqrt(v / 20);
  }

  // session VWAP (resets each IST day)
  const vwap = new Array(n).fill(null);
  {
    let pv = 0, vv = 0, cur = null;
    for (let i = 0; i < n; i++) {
      const dk = dayKey(times[i]);
      if (cur === null || dk !== cur) { cur = dk; pv = 0; vv = 0; }
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      const v = vols[i] || 0;
      pv += tp * v; vv += v;
      vwap[i] = vv > 0 ? pv / vv : closes[i];
    }
  }

  const X = [], y = [], outTimes = [];
  for (let i = 20; i < n - 1; i++) {
    // every input must be known at bar i
    if (rsi[i] == null || macdLine[i] == null || sig[i] == null || bbMid[i] == null ||
        bbSd[i] == null || atr[i] == null || sma20[i] == null || volMean20[i] == null ||
        volSd20[i] == null || vol20[i] == null) continue;

    const a = atr[i] || 1e-9;
    const r5 = closes[i] > 0 && closes[i - 5] > 0 ? Math.log(closes[i] / closes[i - 5]) : 0;
    const r20 = closes[i] > 0 && closes[i - 20] > 0 ? Math.log(closes[i] / closes[i - 20]) : 0;
    const bbW = bbMid[i] > 0 ? (4 * bbSd[i]) / bbMid[i] : 0;

    X.push([
      rets[i],                                            // ret1
      r5,                                                 // ret5
      r20,                                                // ret20
      vol20[i] * 100,                                     // vol20 (scaled)
      (rsi[i] - 50) / 50,                                 // rsi centered
      (macdLine[i] - sig[i]) / a,                         // macd hist in ATR units
      bbSd[i] > 0 ? (closes[i] - (bbMid[i] - 2 * bbSd[i])) / (4 * bbSd[i]) : 0.5, // bb position
      bbW,                                                // bb width
      (atr[i] / closes[i]) * 100,                         // atr %
      volSd20[i] > 0 ? (vols[i] - volMean20[i]) / volSd20[i] : 0, // volume z
      (closes[i] - vwap[i]) / a,                          // vwap distance
      ((highs[i] - lows[i]) / closes[i]) * 100,           // range %
      closes[i - 1] > 0 ? ((opens[i] - closes[i - 1]) / closes[i - 1]) * 100 : 0, // gap %
      (closes[i] - sma20[i]) / a,                         // trend in ATR units
      dayFrac(times[i]),                                  // time of day
    ]);

    // label: sign of the NEXT bar's return. Computed here, used only as y.
    const next = closes[i + 1] > 0 && closes[i] > 0 ? Math.log(closes[i + 1] / closes[i]) : 0;
    y.push(next > 0 ? 1 : 0);
    outTimes.push(times[i]);
  }

  return { X, y, times: outTimes };
}

const FEATURE_NAMES = [
  'ret1', 'ret5', 'ret20', 'vol20', 'rsi', 'macdHist', 'bbPos', 'bbWidth',
  'atrPct', 'volZ', 'vwapDist', 'rangePct', 'gapPct', 'trend20', 'dayFrac',
];

module.exports = { extractFeatures, FEATURE_NAMES, dayKey, dayFrac };
