'use strict';
/**
 * ai/forecaster.js — next-bar direction model with honest evaluation.
 *
 * Training protocol (purged walk-forward with an embargo gap):
 *   - split the series into K chronological folds
 *   - train on folds [0..k), test on fold k, with an EMBARGO of several bars
 *     on each side of the boundary so no information leaks across it
 *   - report mean accuracy, and accuracy net of a 10bps cost model
 * A model is only promoted to "live" when its out-of-sample accuracy beats 50%
 * AND the cost-adjusted edge is positive. Otherwise the API says "insufficient
 * edge" instead of showing a coin flip with confidence.
 */

const fs = require('fs');
const path = require('path');
const { extractFeatures, FEATURE_NAMES } = require('./features');
const logistic = require('./logistic');

const MODEL_DIR = process.env.AI_MODEL_DIR || path.join(__dirname, 'models');
const EMBARGO_BARS = 5;      // no train/test sample may be within 5 bars of a boundary
const COST_BPS = 10;         // round-trip cost assumption for the edge test
const MIN_ROWS = 300;        // refuse to train below this

function modelPath(symbol, timeframe) {
  const safe = String(symbol).replace(/[^A-Za-z0-9^_-]/g, '_') + '__' + timeframe;
  return path.join(MODEL_DIR, `forecast_${safe}.json`);
}

/** Purged walk-forward: returns per-fold { acc, n } plus the pooled accuracy. */
function walkForward(X, y, folds = 5) {
  const n = X.length;
  const foldSize = Math.floor(n / folds);
  const results = [];
  for (let k = 1; k < folds; k++) {
    const trainEnd = k * foldSize - EMBARGO_BARS;
    const testStart = k * foldSize + EMBARGO_BARS;
    const testEnd = Math.min(n, (k + 1) * foldSize);
    if (trainEnd <= 50 || testEnd <= testStart) continue;

    const model = logistic.fit(X.slice(0, trainEnd), y.slice(0, trainEnd), FEATURE_NAMES, { epochs: 250 });
    let correct = 0, edge = 0, count = 0;
    for (let i = testStart; i < testEnd; i++) {
      const p = logistic.predictProba(model, X[i]);
      const pred = p >= 0.5 ? 1 : 0;
      if (pred === y[i]) correct++;
      // cost-adjusted edge: correct direction earns the move minus costs
      edge += (pred === y[i] ? 1 : -1) - (COST_BPS / 10000) * 2;
      count++;
    }
    if (count) results.push({ fold: k, acc: correct / count, edgePerTrade: edge / count, n: count });
  }
  const pooled = results.length
    ? results.reduce((s, r) => s + r.acc * r.n, 0) / results.reduce((s, r) => s + r.n, 0)
    : null;
  const pooledEdge = results.length
    ? results.reduce((s, r) => s + r.edgePerTrade * r.n, 0) / results.reduce((s, r) => s + r.n, 0)
    : null;
  return { folds: results, pooledAcc: pooled, pooledEdge, n };
}

/** Train on bars, evaluate honestly, persist only if there is a real edge. */
function train(symbol, timeframe, bars) {
  const { X, y, times } = extractFeatures(bars);
  if (X.length < MIN_ROWS) {
    return { ok: false, reason: `insufficient data (${X.length} rows, need ${MIN_ROWS})`, rows: X.length };
  }

  const wf = walkForward(X, y, 5);
  const live = wf.pooledAcc != null && wf.pooledAcc > 0.5 && (wf.pooledEdge || 0) > 0;

  const model = logistic.fit(X, y, FEATURE_NAMES, { epochs: 400 });
  const record = {
    symbol, timeframe,
    model, importance: logistic.importance(model),
    evaluation: wf,
    live,
    costBps: COST_BPS,
    embargoBars: EMBARGO_BARS,
    rows: X.length,
    trainedAt: new Date().toISOString(),
  };

  fs.mkdirSync(MODEL_DIR, { recursive: true });
  fs.writeFileSync(modelPath(symbol, timeframe), JSON.stringify(record));
  return { ok: true, live, pooledAcc: wf.pooledAcc, pooledEdge: wf.pooledEdge, rows: X.length, importance: record.importance.slice(0, 5) };
}

function load(symbol, timeframe) {
  try {
    const p = modelPath(symbol, timeframe);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Score the latest bar. Returns null when there is no live model. */
function predict(symbol, timeframe, bars) {
  const record = load(symbol, timeframe);
  if (!record || !record.live) return null;
  const { X } = extractFeatures(bars);
  if (!X.length) return null;
  const p = logistic.predictProba(record.model, X[X.length - 1]);
  const confidence = Math.abs(p - 0.5) * 2; // 0 = coin flip, 1 = certain
  return {
    direction: p >= 0.5 ? 'UP' : 'DOWN',
    probability: +p.toFixed(4),
    confidence: +confidence.toFixed(3),
    pooledAcc: record.evaluation.pooledAcc,
    topFeatures: record.importance.slice(0, 3).map((f) => f.name),
    trainedAt: record.trainedAt,
    rows: record.rows,
  };
}

/** Human-readable status for the UI badge. */
function status(symbol, timeframe, bars) {
  const record = load(symbol, timeframe);
  if (!record) return { state: 'untrained', message: 'No forecast model trained for this symbol yet.' };
  if (!record.live) {
    return {
      state: 'no-edge',
      message: `Model evaluated at ${(record.evaluation.pooledAcc * 100).toFixed(1)}% accuracy — no tradable edge after costs. Showing nothing is the honest answer.`,
      pooledAcc: record.evaluation.pooledAcc,
    };
  }
  const pred = predict(symbol, timeframe, bars);
  if (!pred) return { state: 'stale', message: 'Not enough recent bars to score.' };
  return { state: 'live', ...pred };
}

module.exports = { train, load, predict, status, walkForward, modelPath, FEATURE_NAMES, MIN_ROWS };
