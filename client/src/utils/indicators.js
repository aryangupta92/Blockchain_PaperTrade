/**
 * utils/indicators.js — ADDITIVE frontend mirror of server/services/indicators.js
 * Pure functions for chart overlays. Import opt-in; no existing page modified.
 */

export function ema(data, period = 20) {
  const out = [];
  if (data.length < period) return out;
  const k = 2 / (period + 1);
  let prev = data.slice(0, period).reduce((s, c) => s + Number(c.close), 0) / period;
  out.push({ time: data[period - 1].time, value: prev });
  for (let i = period; i < data.length; i++) {
    const c = Number(data[i].close);
    prev = c * k + prev * (1 - k);
    out.push({ time: data[i].time, value: prev });
  }
  return out;
}

export function rsi(data, period = 14) {
  const out = [];
  if (data.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = Number(data[i].close) - Number(data[i - 1].close);
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  out.push({ time: data[period].time, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  for (let i = period + 1; i < data.length; i++) {
    const d = Number(data[i].close) - Number(data[i - 1].close);
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out.push({ time: data[i].time, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  }
  return out;
}

export function bollinger(data, period = 20, mult = 2) {
  const out = [];
  if (data.length < period) return out;
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map((c) => Number(c.close));
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    out.push({ time: data[i].time, middle: mean, upper: mean + mult * sd, lower: mean - mult * sd });
  }
  return out;
}

export function vwap(data) {
  let cumPV = 0, cumV = 0;
  return data.map((c) => {
    const tp = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
    const v = Number(c.volume) || 0;
    cumPV += tp * v; cumV += v;
    return { time: c.time, value: cumV > 0 ? cumPV / cumV : Number(c.close) };
  });
}

// Drawings helper: trendline / horizontal / fib / text — serializable, server-compatible
export const DRAW_TYPES = ['TRENDLINE', 'HORIZONTAL', 'FIB', 'TEXT'];
export function blankDrawing(type, symbol) {
  return { id: `d_${Date.now()}`, type, symbol, points: [], text: '', createdAt: new Date().toISOString() };
}
