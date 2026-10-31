'use strict';
/**
 * ai/logistic.js — L2-regularized logistic regression in pure JS.
 *
 * Trains on CPU in milliseconds for the data sizes here (thousands of rows,
 * 15 features). The trained weights serialize to JSON so Node serves inference
 * with zero Python/GPU dependency at runtime.
 *
 * Standardize (z-score) inside fit; the scaler ships with the model.
 */

function mean(xs) { return xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length); }
function std(xs, m) {
  if (xs.length < 2) return 1;
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v) || 1;
}

function sigmoid(z) {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}

/**
 * Fit. Options: lr (learning rate), epochs, lambda (L2), verbose.
 * Returns { weights, bias, means, stds, featureNames, trainAcc, loss }.
 */
function fit(X, y, featureNames = [], { lr = 0.5, epochs = 400, lambda = 0.01, verbose = false } = {}) {
  const n = X.length;
  if (!n) throw new Error('no training rows');
  const d = X[0].length;

  const means = new Array(d), stds = new Array(d);
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]);
    means[j] = mean(col);
    stds[j] = std(col, means[j]) || 1;
  }
  const Z = X.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));

  let w = new Array(d).fill(0);
  let b = Math.log((y.reduce((s, v) => s + v, 0) / n + 1e-6) / (1 - y.reduce((s, v) => s + v, 0) / n + 1e-6));
  if (!isFinite(b)) b = 0;

  let loss = Infinity;
  for (let e = 0; e < epochs; e++) {
    const grad = new Array(d).fill(0);
    let gradB = 0, total = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const p = sigmoid(z);
      const err = p - y[i];
      total += -(y[i] * Math.log(p + 1e-12) + (1 - y[i]) * Math.log(1 - p + 1e-12));
      for (let j = 0; j < d; j++) grad[j] += err * Z[i][j];
      gradB += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (grad[j] / n + lambda * w[j]);
    b -= lr * (gradB / n);
    loss = total / n;
    if (verbose && e % 100 === 0) console.log(`   epoch ${e} loss=${loss.toFixed(4)}`);
  }

  let correct = 0;
  for (let i = 0; i < n; i++) {
    let z = b;
    for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
    if ((sigmoid(z) >= 0.5 ? 1 : 0) === y[i]) correct++;
  }

  return {
    weights: w, bias: b, means, stds,
    featureNames: featureNames.length ? featureNames : Z[0].map((_, j) => `f${j}`),
    trainAcc: correct / n, loss, rows: n, dims: d,
    trainedAt: new Date().toISOString(),
  };
}

/** Probability of the positive class for one raw feature vector. */
function predictProba(model, x) {
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    z += model.weights[j] * ((x[j] - model.means[j]) / model.stds[j]);
  }
  return sigmoid(z);
}

/** Feature importance = |standardized weight|, normalized to sum to 1. */
function importance(model) {
  const abs = model.weights.map(Math.abs);
  const total = abs.reduce((s, v) => s + v, 0) || 1;
  return model.featureNames
    .map((name, j) => ({ name, importance: abs[j] / total, weight: model.weights[j] }))
    .sort((a, b) => b.importance - a.importance);
}

module.exports = { fit, predictProba, importance, sigmoid };
