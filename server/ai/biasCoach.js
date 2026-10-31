'use strict';
/**
 * ai/biasCoach.js — detect behavioral biases in journal entries and explain them.
 *
 * Two layers:
 *   1. Deterministic rules over emotion fields, ratings and R:R drift (works
 *      from day one, fully explainable, zero training data needed).
 *   2. A TF-IDF + logistic text classifier trained on the user's own entries
 *      (labels come from the rule layer, so it learns the user's vocabulary).
 *      Stored per-user as JSON; improves as the journal grows.
 *
 * Biases: FOMO, REVENGE, LOSS_AVERSION, WINNER_CUTTING, OVERLEVERAGE,
 *         NO_PLAN, DISCIPLINED (a strength, not a bias).
 */

const RULES = [
  {
    id: 'FOMO',
    name: 'FOMO entries',
    test: (j) => /fomo/i.test(`${j.emotionOnEntry} ${j.setup} ${j.mistakes}`),
    fix: 'Write the entry trigger BEFORE the candle closes. No written trigger = no trade.',
  },
  {
    id: 'REVENGE',
    name: 'Revenge trading',
    test: (j) => /revenge/i.test(`${j.emotionOnEntry} ${j.emotionOnExit} ${j.mistakes} ${j.thesis}`),
    fix: 'After two consecutive losses, halve size or stop for the day. Encode this as a hard rule.',
  },
  {
    id: 'LOSS_AVERSION',
    name: 'Holding losers too long',
    test: (j) => /hop|hope|average|avg|hold/i.test(j.mistakes || '') && (j.rating || 3) <= 2,
    fix: 'Pre-define the invalidation price. If the thesis breaks, the position closes - no second chances intraday.',
  },
  {
    id: 'WINNER_CUTTING',
    name: 'Cutting winners early',
    test: (j) => {
      const p = Number(j.riskRewardPlanned), a = Number(j.riskRewardActual);
      return p > 0 && a > 0 && a < p * 0.6;
    },
    fix: 'Scale out: book half at 1R, trail the rest. You keep the discipline and the upside.',
  },
  {
    id: 'OVERLEVERAGE',
    name: 'Oversized positions',
    test: (j) => /over|too big|leverage|margin|full/i.test(`${j.mistakes} ${j.thesis}`),
    fix: 'Risk at most 1% of paper capital per trade. Size = risk / stop distance, not conviction.',
  },
  {
    id: 'NO_PLAN',
    name: 'Trading without a plan',
    test: (j) => !(j.setup || '').trim() || !(j.thesis || '').trim(),
    fix: 'Setup + thesis are mandatory journal fields. Blank plan = no trade next time.',
  },
  {
    id: 'EMOTIONAL_EXIT',
    name: 'Emotion-driven exits',
    test: (j) => /fear|panic|anxiet|greed/i.test(`${j.emotionOnExit} ${j.mistakes}`),
    fix: 'Exits are decided at entry (stop + target). Move the decision, not the stop.',
  },
];

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'was', 'were', 'this', 'that', 'from', 'have', 'has',
  'had', 'but', 'not', 'are', 'you', 'your', 'trade', 'trading', 'market', 'stock',
  'price', 'into', 'out', 'then', 'than', 'when', 'will', 'would', 'could', 'should',
]);

function entryText(j) {
  return [j.title, j.setup, j.thesis, j.mistakes, j.learnings].filter(Boolean).join(' ');
}

/** Rule layer: which biases fire for one entry, with the evidence attached. */
function analyzeEntry(j) {
  const hits = [];
  for (const r of RULES) {
    try { if (r.test(j)) hits.push({ id: r.id, name: r.name, fix: r.fix }); } catch {}
  }
  return hits;
}

/** Persona from the dominant pattern across entries. */
function persona(entries) {
  const counts = {};
  entries.forEach((j) => analyzeEntry(j).forEach((h) => { counts[h.id] = (counts[h.id] || 0) + 1; }));
  const total = entries.length || 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  let name = 'Disciplined Executor';
  let description = 'No dominant bias pattern. Process looks repeatable.';
  if (top && top[1] / total >= 0.3) {
    const map = {
      FOMO: ['Momentum Chaser', 'Enters late on green moves; needs written triggers.'],
      REVENGE: ['Revenge Trader', 'Sizes up after losses; needs a two-loss circuit breaker.'],
      LOSS_AVERSION: ['Loss-Aversion Holder', 'Holds losers hoping; needs hard invalidation levels.'],
      WINNER_CUTTING: ['Early Exiter', 'Books small wins; needs scale-out rules to keep upside.'],
      OVERLEVERAGE: ['Overconfident Scalper', 'Sizes on conviction; needs 1%-risk position sizing.'],
      NO_PLAN: ['Impulsive Entrant', 'Trades without a written plan; needs mandatory setup+thesis.'],
      EMOTIONAL_EXIT: ['Emotional Swinger', 'Exits on feeling; needs pre-decided stops and targets.'],
    };
    if (map[top[0]]) [name, description] = map[top[0]];
  }
  return { persona: name, personaDescription: description, biasCounts: counts };
}

/**
 * Train the text layer on the user's own journal: rule labels become training
 * targets, TF-IDF over the combined text becomes features, one-vs-rest
 * logistic regression per bias. Returns a JSON-serializable model.
 */
function trainTextModel(entries) {
  const docs = entries.map((j) => ({ tokens: tokenize(entryText(j)), labels: analyzeEntry(j).map((h) => h.id) }));
  const df = {};
  docs.forEach((d) => new Set(d.tokens).forEach((t) => { df[t] = (df[t] || 0) + 1; }));
  const vocab = Object.keys(df).filter((t) => df[t] >= 2 && df[t] <= Math.max(2, docs.length * 0.9));
  const index = new Map(vocab.map((t, i) => [t, i]));

  const tfidf = (tokens) => {
    const v = new Array(vocab.length).fill(0);
    const counts = {};
    tokens.forEach((t) => { if (index.has(t)) counts[t] = (counts[t] || 0) + 1; });
    const total = tokens.length || 1;
    for (const [t, c] of Object.entries(counts)) {
      const i = index.get(t);
      v[i] = (c / total) * Math.log(1 + docs.length / (df[t] || 1));
    }
    return v;
  };

  const biasIds = [...new Set(RULES.map((r) => r.id))];
  const heads = {};
  const { fit } = require('./logistic');
  for (const id of biasIds) {
    const X = [], y = [];
    docs.forEach((d) => { X.push(tfidf(d.tokens)); y.push(d.labels.includes(id) ? 1 : 0); });
    const pos = y.reduce((s, v) => s + v, 0);
    if (pos >= 2 && pos <= X.length - 2) {
      try { heads[id] = fit(X, y, vocab, { epochs: 200 }); } catch {}
    }
  }

  return {
    vocab,
    df: Object.fromEntries(vocab.map((t) => [t, df[t]])),
    heads,
    trainedAt: new Date().toISOString(),
    entries: entries.length,
  };
}

/** Score a fresh entry with the text model (probabilities per bias). */
function scoreText(model, text) {
  if (!model?.vocab?.length) return {};
  const { predictProba } = require('./logistic');
  const tokens = tokenize(text);
  const counts = {};
  tokens.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
  const total = tokens.length || 1;
  const v = model.vocab.map((t) => {
    const c = counts[t] || 0;
    return (c / total) * Math.log(1 + (model.entries || 1) / ((model.df || {})[t] || 1));
  });
  const out = {};
  for (const [id, head] of Object.entries(model.heads || {})) {
    out[id] = +predictProba(head, v).toFixed(3);
  }
  return out;
}

/** Full report over a journal list: rules + persona + per-bias evidence. */
function report(entries) {
  const perEntry = entries.map((j) => ({ id: j.id, title: j.title, hits: analyzeEntry(j) }));
  const p = persona(entries);
  const biases = [];
  const strengths = [];
  const recommendations = [];

  for (const r of RULES) {
    const withBias = perEntry.filter((e) => e.hits.some((h) => h.id === r.id));
    if (withBias.length) {
      biases.push(`${r.name} — seen in ${withBias.length}/${entries.length} entries`);
      recommendations.push(r.fix);
    }
  }
  const disciplined = entries.filter((j) => (j.rating || 0) >= 4 && !analyzeEntry(j).length);
  if (disciplined.length) strengths.push(`Clean executions (${disciplined.length} entries rated 4-5 with no bias flags)`);
  const planned = entries.filter((j) => (j.riskRewardPlanned || 0) > 0);
  if (planned.length >= Math.max(2, entries.length / 2)) strengths.push('Pre-trade planning habit (R:R written before entry)');

  return {
    ...p,
    biases: biases.length ? biases : ['No strong bias pattern yet — keep journaling.'],
    strengths: strengths.length ? strengths : ['Journaling consistently, which is the foundation.'],
    recommendations: [...new Set(recommendations)].slice(0, 5),
    entries: entries.length,
  };
}

module.exports = { RULES, analyzeEntry, persona, trainTextModel, scoreText, report, tokenize };
