'use strict';
/**
 * services/indicators.js — ADDITIVE, pure functions. No DB, no side effects.
 * Used by /api/ext/indicators and optionally by frontend (mirrored in client/src/utils/indicators.js).
 * All functions take array of candles {time,open,high,low,close,volume} and return [{time,value},...] or extra fields.
 */

function closes(data) { return data.map(c => Number(c.close)); }

function sma(data, period = 20) {
  const out = [];
  if (data.length < period) return out;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += Number(data[i].close);
    if (i >= period) sum -= Number(data[i - period].close);
    if (i >= period - 1) out.push({ time: data[i].time, value: sum / period });
  }
  return out;
}

function ema(data, period = 20) {
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

function rsi(data, period = 14) {
  const out = [];
  if (data.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = Number(data[i].close) - Number(data[i - 1].close);
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  const rsVal = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  out.push({ time: data[period].time, value: rsVal });
  for (let i = period + 1; i < data.length; i++) {
    const d = Number(data[i].close) - Number(data[i - 1].close);
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    const v = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    out.push({ time: data[i].time, value: v });
  }
  return out;
}

function macd(data, fast = 12, slow = 26, signal = 9) {
  const ef = ema(data, fast), es = ema(data, slow);
  if (!ef.length || !es.length) return { macdLine: [], signalLine: [], histogram: [] };
  const slowMap = new Map(es.map(p => [p.time, p.value]));
  const line = ef.filter(p => slowMap.has(p.time)).map(p => ({ time: p.time, value: p.value - slowMap.get(p.time) }));
  // signal EMA of macd line
  const k = 2 / (signal + 1);
  const sig = [];
  if (line.length >= signal) {
    let prev = line.slice(0, signal).reduce((s, p) => s + p.value, 0) / signal;
    sig.push({ time: line[signal - 1].time, value: prev });
    for (let i = signal; i < line.length; i++) {
      prev = line[i].value * k + prev * (1 - k);
      sig.push({ time: line[i].time, value: prev });
    }
  }
  const sigMap = new Map(sig.map(p => [p.time, p.value]));
  const hist = line.filter(p => sigMap.has(p.time)).map(p => ({ time: p.time, value: p.value - sigMap.get(p.time) }));
  return { macdLine: line, signalLine: sig, histogram: hist };
}

function bollinger(data, period = 20, mult = 2) {
  const out = [];
  if (data.length < period) return out;
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(c => Number(c.close));
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    out.push({ time: data[i].time, middle: mean, upper: mean + mult * sd, lower: mean - mult * sd });
  }
  return out;
}

function vwap(data) {
  // session-agnostic cumulative VWAP (resets caller-side per day if needed)
  let cumPV = 0, cumV = 0;
  return data.map(c => {
    const tp = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
    const v = Number(c.volume) || 0;
    cumPV += tp * v; cumV += v;
    return { time: c.time, value: cumV > 0 ? cumPV / cumV : Number(c.close) };
  });
}

function atr(data, period = 14) {
  const out = [];
  if (data.length < period + 1) return out;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const h = Number(data[i].high), l = Number(data[i].low), pc = Number(data[i - 1].close);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let prev = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out.push({ time: data[period].time, value: prev });
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out.push({ time: data[i + 1].time, value: prev });
  }
  return out;
}

function supertrend(data, period = 10, mult = 3) {
  const a = atr(data, period);
  const aMap = new Map(a.map(p => [p.time, p.value]));
  const out = [];
  let prevUpper = null, prevLower = null, prevDir = 1;
  for (let i = 0; i < data.length; i++) {
    const t = data[i].time;
    if (!aMap.has(t)) continue;
    const av = aMap.get(t);
    const hl2 = (Number(data[i].high) + Number(data[i].low)) / 2;
    const up = hl2 + mult * av, lo = hl2 - mult * av;
    const close = Number(data[i].close);
    let dir = prevDir;
    if (close > (prevUpper ?? up)) dir = 1;
    else if (close < (prevLower ?? lo)) dir = -1;
    const val = dir === 1 ? lo : up;
    out.push({ time: t, value: val, direction: dir });
    prevUpper = up; prevLower = lo; prevDir = dir;
  }
  return out;
}

module.exports = { sma, ema, rsi, macd, bollinger, vwap, atr, supertrend };
