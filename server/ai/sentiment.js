'use strict';
/**
 * ai/sentiment.js — financial news sentiment without a model download.
 *
 * A domain lexicon (FinBERT-style polarity lists, hand-curated for Indian
 * market language) scores each headline; scores aggregate into a per-symbol
 * daily signal. This runs in microseconds on CPU with zero dependencies and
 * no GPU, and its output feeds the forecaster as an optional feature.
 *
 * The path to a fine-tuned FinBERT is documented in server/ai/README.md for
 * when a GPU training box is available — the API contract is identical.
 */

const POSITIVE = new Set([
  'surge', 'surged', 'surges', 'rally', 'rallies', 'rallied', 'gain', 'gains', 'gained',
  'record', 'highs', 'upgrade', 'upgraded', 'outperform', 'beat', 'beats', 'exceed',
  'profit', 'profits', 'growth', 'strong', 'robust', 'bullish', 'breakout', 'soar',
  'soared', 'jump', 'jumped', 'climb', 'climbed', 'rebound', 'recovery', 'optimistic',
  'buy', 'accumulate', 'dividend', 'bonus', 'split', 'expansion', 'deal', 'order',
  'win', 'approval', 'clearance', 'upgrade', 'target', 'raised', 'hike', 'cut',
  'easing', 'stimulus', 'surplus', 'upgrade',
]);

const NEGATIVE = new Set([
  'fall', 'falls', 'fell', 'drop', 'dropped', 'drops', 'plunge', 'plunged', 'crash',
  'crashed', 'loss', 'losses', 'downgrade', 'downgraded', 'underperform', 'miss',
  'missed', 'weak', 'slump', 'slumped', 'bearish', 'breakdown', 'tumble', 'tumbled',
  'decline', 'declined', 'sell', 'downgrade', 'cut', 'fraud', 'scam', 'penalty',
  'fine', 'probe', 'investigation', 'default', 'bankruptcy', 'layoff', 'closure',
  'warning', 'risk', 'volatile', 'uncertainty', 'concern', 'fear', 'panic',
  'recession', 'inflation', 'deficit', 'downgrade',
]);

const NEGATORS = new Set(['not', 'no', 'never', 'barely', 'hardly', 'fails', 'failed', 'denies', 'denied', 'rejects', 'rejected']);
const INTENSIFIERS = new Set(['very', 'sharply', 'steeply', 'massively', 'strongly', 'significantly', 'record']);

/** Score one headline in [-1, 1]. Handles negation and intensifiers. */
function scoreText(text) {
  if (!text) return { score: 0, label: 'neutral', hits: [] };
  const words = String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  let score = 0;
  const hits = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let pol = 0;
    if (POSITIVE.has(w)) pol = 1;
    else if (NEGATIVE.has(w)) pol = -1;
    if (!pol) continue;

    // look back up to 3 words for a negator
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(words[j])) { pol = -pol; break; }
    }
    // intensifier immediately before doubles the weight
    if (i > 0 && INTENSIFIERS.has(words[i - 1])) pol *= 2;
    score += pol;
    hits.push({ word: w, polarity: pol > 0 ? 'pos' : 'neg' });
  }
  // dampen by length so a long neutral article with one trigger word stays near 0
  const norm = score / Math.sqrt(1 + words.length / 8);
  const clamped = Math.max(-1, Math.min(1, norm / 3));
  return {
    score: +clamped.toFixed(3),
    label: clamped > 0.15 ? 'positive' : clamped < -0.15 ? 'negative' : 'neutral',
    hits,
  };
}

/**
 * Aggregate scored headlines into a per-symbol daily signal in [-1, 1].
 * Newer headlines weigh more (exponential decay, 3-day half-life).
 */
function aggregate(headlines, nowMs = Date.now()) {
  const bySymbol = {};
  for (const h of headlines || []) {
    const sym = (h.symbol || '').toUpperCase();
    if (!sym) continue;
    const { score } = scoreText(h.title || h.text || '');
    const ageDays = Math.max(0, (nowMs - new Date(h.publishedAt || h.date || nowMs).getTime()) / 86400000);
    const weight = Math.pow(0.5, ageDays / 3);
    (bySymbol[sym] = bySymbol[sym] || []).push({ score, weight, title: h.title });
  }
  const out = {};
  for (const [sym, rows] of Object.entries(bySymbol)) {
    const wsum = rows.reduce((s, r) => s + r.weight, 0) || 1;
    const score = rows.reduce((s, r) => s + r.score * r.weight, 0) / wsum;
    out[sym] = {
      score: +score.toFixed(3),
      label: score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral',
      headlines: rows.length,
    };
  }
  return out;
}

/** Which symbols does a headline mention? (ticker + common company names) */
function detectSymbols(text, universe = []) {
  if (!text) return [];
  const upper = ` ${String(text).toUpperCase()} `;
  const found = new Set();
  for (const s of universe) {
    const bare = String(s).toUpperCase().replace(/^\^|\.NS$|\.BO$/g, '');
    if (!bare || bare.length < 2) continue;
    if (upper.includes(` ${bare} `) || upper.includes(` ${bare}'`) || upper.includes(`(${bare})`)) found.add(s);
  }
  // index mentions
  if (/\bNIFTY\b/.test(upper)) found.add('^NSEI');
  if (/SENSEX/.test(upper)) found.add('^BSESN');
  if (/BANK\s*NIFTY|BANKNIFTY/.test(upper)) found.add('^NSEBANK');
  return [...found];
}

module.exports = { scoreText, aggregate, detectSymbols };
