'use strict';
/**
 * services/recommendationEngine.js — Hybrid "where should I invest" recommender.
 * V1: deterministic, explainable, trainable linear model (no new deps).
 *
 * Skill side  (from DB): trade win-rate per segment + journal ratings/emotions/persona.
 * Market side (injected): sector momentum (avgChangePercent), breadth, RSI-ish trend.
 * Output: ranked segments with confidence + education + risk guardrails.
 *
 * Weights are persisted to server/ai/weights.json and updated by train() from
 * labelled trade outcomes. Python training (server/ai/) can overwrite same file.
 */

const fs = require('fs');
const path = require('path');

const WEIGHTS_FILE = path.join(__dirname, '..', 'ai', 'weights.json');

const DEFAULT_WEIGHTS = {
  version: 1,
  wSkill: 0.45,      // past win-rate in segment
  wMarket: 0.35,     // sector momentum right now
  wTemperament: 0.20,// persona fit (e.g. disciplined -> delivery, FOMO -> avoid F&O)
  segments: {},      // per-segment bias learned from P&L: { IT: 0.05, ... }
};

function loadWeights() {
  try {
    if (fs.existsSync(WEIGHTS_FILE)) return { ...DEFAULT_WEIGHTS, ...JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8')) };
  } catch {}
  return { ...DEFAULT_WEIGHTS };
}

function saveWeights(w) {
  try {
    fs.mkdirSync(path.dirname(WEIGHTS_FILE), { recursive: true });
    fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(w, null, 2));
  } catch {}
}

function inferSector(symbol = '') {
  const s = String(symbol).toUpperCase();
  if (/^(HDFCBANK|SBIN|ICICIBANK|AXISBANK|KOTAKBANK|BANDHANBNK|FEDERALBNK|INDUSINDBK)/.test(s)) return 'Banking';
  if (/^(TCS|INFY|WIPRO|HCLTECH|TECHM|MPHASIS|LTIM|PERSISTENT)/.test(s)) return 'IT';
  if (/^(RELIANCE|ONGC|BPCL|IOC|NTPC|POWERGRID|ADANIGREEN)/.test(s)) return 'Energy';
  if (/^(SUNPHARMA|DRREDDY|CIPLA|DIVISLAB|LUPIN|AUROPHARMA)/.test(s)) return 'Pharma';
  if (/^(MARUTI|TATAMOTORS|M&M|BAJAJ-AUTO|EICHERMOT|HEROMOTOCO)/.test(s)) return 'Auto';
  if (/^(BAJFINANCE|BAJAJFINSV|CHOLAFIN|MUTHOOTFIN|SHRIRAMFIN)/.test(s)) return 'NBFC';
  if (/^(HINDUNILVR|ITC|NESTLEIND|BRITANNIA|MARICO|DABUR)/.test(s)) return 'FMCG';
  if (/^(TATASTEEL|HINDALCO|JSWSTEEL|VEDL|NMDC|SAIL)/.test(s)) return 'Metals';
  if (/^(DLF|GODREJPROP|OBEROIRLTY|LODHA)/.test(s)) return 'Realty';
  if (/^(INFRA|L&T|LT$)/.test(s)) return 'Infra';
  if (/^NIFTY|^BANKNIFTY|^SENSEX|^\^/.test(s)) return 'Index';
  if (/CE$|PE$|FUT$/.test(s)) return 'F&O';
  return 'LargeCap';
}

function personaFromJournals(journals) {
  const emo = {};
  let fomo = 0, revenge = 0, disciplined = 0, ratings = [];
  journals.forEach((j) => {
    [j.emotionOnEntry, j.emotionOnExit].forEach((e) => { if (e) emo[e] = (emo[e] || 0) + 1; });
    if (/FOMO/i.test(`${j.emotionOnEntry} ${j.emotionOnExit} ${j.mistakes}`)) fomo++;
    if (/revenge/i.test(`${j.emotionOnEntry} ${j.emotionOnExit} ${j.mistakes} ${j.thesis}`)) revenge++;
    if (/disciplin/i.test(`${j.emotionOnExit} ${j.learnings}`)) disciplined++;
    if (j.rating) ratings.push(j.rating);
  });
  const avgRating = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 3;
  let persona = 'Systematic Planner';
  let desc = 'Balanced process, no dominant bias detected yet.';
  if (revenge >= 2) { persona = 'Revenge Trader'; desc = 'Trades to recover losses quickly; over-sizes after red days.'; }
  else if (fomo >= 3) { persona = 'FOMO Trader'; desc = 'Enters late on green moves; chases momentum.'; }
  else if ((emo.Fearful || 0) + (emo.Anxious || 0) >= 3) { persona = 'Risk-Averse Hesitator'; desc = 'Exits winners early, hesitates on valid setups.'; }
  else if (disciplined >= 3 && avgRating >= 3.5) { persona = 'Disciplined Executor'; desc = 'Follows plan, journals honestly, compounds steadily.'; }
  else if ((emo.Greedy || 0) >= 2) { persona = 'Overconfident Scalper'; desc = 'Overtrades when green; needs position caps.'; }
  return { persona, personaDescription: desc, avgRating, emoCounts: emo, fomo, revenge, disciplined };
}

//Win-rate per segment from realized trades. Uses FIFO-ish realized P&L proxy:
// sells matched against avg buy from holdings/trades is complex; here we score
// per-trade side profitability using (sell price vs prior avg buy) when possible,
// else fall back to journal ratings per setup.
function skillBySegment(trades, journals) {
  const seg = {}; // seg -> {trades,wins,rrSum,ratingSum,ratingN}
  const touch = (s) => (seg[s] = seg[s] || { trades: 0, wins: 0, rrSum: 0, ratingSum: 0, ratingN: 0 });
  // journal ratings mapped to setup keywords -> segment guess
  journals.forEach((j) => {
    const txt = `${j.setup} ${j.thesis} ${j.title}`.toUpperCase();
    let s = 'LargeCap';
    if (/BANK|NIFTY BANK|FIN/.test(txt)) s = 'Banking';
    else if (/IT |TCS|INFY/.test(txt)) s = 'IT';
    else if (/PHARMA/.test(txt)) s = 'Pharma';
    else if (/INTRADAY|SCALP/.test(txt)) s = 'Intraday';
    else if (/OPTION|CE$|PE$|STRADDLE|EXPIRY/.test(txt)) s = 'F&O';
    const t = touch(s);
    if (j.rating) { t.ratingSum += j.rating; t.ratingN++; }
    if (j.riskRewardActual && j.riskRewardActual > 0) t.rrSum += Math.min(3, j.riskRewardActual);
  });
  trades.forEach((t) => {
    const sym = t.instrument?.tradingSymbol || t.symbol || '';
    const s = inferSector(sym);
    const x = touch(s);
    x.trades++;
    // win proxy: sell trades with positive realized contribution unknown -> use netAmount sign when available
    if (t.side === 'SELL' && (t.netAmount > 0 || t.totalValue > 0)) x.wins += 0.5; // weak signal, refined by Python trainer
    const xi = touch(t.productType === 'INTRADAY' ? 'Intraday' : 'Delivery');
    xi.trades++;
  });
  const out = {};
  Object.entries(seg).forEach(([k, v]) => {
    const winRate = v.trades ? v.wins / v.trades : 0.5;
    const avgRating = v.ratingN ? v.ratingSum / v.ratingN / 5 : 0.6;
    out[k] = { ...v, winRate: +winRate.toFixed(3), avgRating: +avgRating.toFixed(3), skill: +((0.6 * winRate + 0.4 * avgRating)).toFixed(3) };
  });
  return out;
}

function temperamentFit(persona, segment) {
  // 0..1 fit of personality to segment risk
  const risky = new Set(['F&O', 'Intraday']);
  if (persona === 'Revenge Trader' && risky.has(segment)) return 0.15;
  if (persona === 'FOMO Trader' && risky.has(segment)) return 0.3;
  if (persona === 'Risk-Averse Hesitator' && risky.has(segment)) return 0.35;
  if (persona === 'Disciplined Executor') return segment === 'Delivery' || segment === 'LargeCap' ? 0.95 : 0.8;
  if (persona === 'Overconfident Scalper' && segment === 'F&O') return 0.4;
  if (segment === 'Delivery' || segment === 'LargeCap') return 0.75;
  return 0.6;
}

const SEGMENT_UNIVERSE = ['LargeCap', 'Banking', 'IT', 'Pharma', 'FMCG', 'Auto', 'Energy', 'Metals', 'Intraday', 'Delivery', 'F&O', 'Index'];
const SEGMENT_LEARN = {
  LargeCap: 'Nifty-50 leaders (RELIANCE, HDFCBANK, INFY). Tight spreads, lower STT drag.',
  Banking: 'HDFCBANK / SBIN / ICICIBANK. Rate-sensitive; size smaller around RBI policy.',
  IT: 'TCS / INFY. USD-rupee + US-tech beta; shines on rupee fall.',
  Pharma: 'SUNPHARMA / DIVISLAB. Defensive; holds in selloffs.',
  FMCG: 'ITC / HINDUNILVR. Defensive compounder; low beta.',
  Auto: 'MARUTI / TATAMOTORS. Festive + crude sensitive.',
  Energy: 'RELIANCE / NTPC. Crude + capex linked.',
  Metals: 'TATASTEEL / HINDALCO. Cyclical; use wider stops.',
  Intraday: 'Same-day MIS (9:15–15:15). Needs strict stop + square-off discipline.',
  Delivery: 'Multi-day CNC holds. Best for building skill + compounding.',
  'F&O': 'Options/futures. High leverage — only after 60%+ delivery win-rate + journal proof.',
  Index: 'NIFTY / BANKNIFTY paper index. Cleanest for learning price action.',
};

/**
 * recommend({trades, journals, holdings, market}) -> report
 * market: { sectors:[{sector, avgChangePercent}], breadth:{advances,declines} }
 */
function recommend({ trades = [], journals = [], holdings = [], market = {}, forecasts = {} }) {
  const weights = loadWeights();
  const { persona, personaDescription, avgRating } = personaFromJournals(journals);
  const skill = skillBySegment(trades, journals);

  const sectorMom = {};
  (market.sectors || []).forEach((s) => { sectorMom[s.sector] = s.avgChangePercent || 0; });

  const breadth = market.breadth || {};
  const total = (breadth.advances || 0) + (breadth.declines || 0) || 1;
  const breadthBias = ((breadth.advances || 0) - (breadth.declines || 0)) / total; // -1..1

  // Phase 3: trained forecaster signals per segment (representative symbols).
  // An UP forecast with confidence c adds up to +0.06 to that segment's score.
  const SEGMENT_SYMBOLS = {
    IT: ['TCS', 'INFY'], Banking: ['HDFCBANK', 'SBIN'], Energy: ['RELIANCE'],
    LargeCap: ['RELIANCE', 'TCS', 'INFY'], Index: ['^NSEI'],
  };
  const forecastBoost = {};
  for (const [seg, syms] of Object.entries(SEGMENT_SYMBOLS)) {
    let boost = 0, n = 0;
    for (const s of syms) {
      const f = forecasts[s];
      if (f && f.direction && f.confidence != null) {
        boost += (f.direction === 'UP' ? 1 : -1) * f.confidence;
        n++;
      }
    }
    if (n) forecastBoost[seg] = (boost / n) * 0.06;
  }

  const rows = SEGMENT_UNIVERSE.map((seg) => {
    const sk = skill[seg]?.skill ?? 0.5;
    let mk = 0.5;
    if (sectorMom[seg] != null) mk = Math.max(0, Math.min(1, 0.5 + sectorMom[seg] / 8)); // ±4% maps to 0..1
    else if (seg === 'Delivery' || seg === 'LargeCap') mk = 0.5 + breadthBias * 0.15;
    else if (seg === 'Intraday') mk = 0.5 + Math.min(0.2, Math.abs(breadthBias) * 0.2);
    else if (seg === 'F&O') mk = 0.5 + breadthBias * 0.1;
    const tf = temperamentFit(persona, seg);
    const learned = weights.segments[seg] || 0;
    const aiBoost = forecastBoost[seg] || 0;
    const score = weights.wSkill * sk + weights.wMarket * mk + weights.wTemperament * tf + learned + aiBoost;
    return {
      segment: seg,
      score: +score.toFixed(4),
      skill: +sk.toFixed(3),
      market: +mk.toFixed(3),
      temperamentFit: +tf.toFixed(3),
      aiBoost: +aiBoost.toFixed(4),
      momentumPct: sectorMom[seg] ?? null,
      evidence: SEGMENT_LEARN[seg],
      tradesSeen: skill[seg]?.trades || 0,
    };
  }).sort((a, b) => b.score - a.score);

  const top = rows[0];
  const confidence = Math.max(0.15, Math.min(0.95,
    0.35 + 0.25 * (journals.length >= 5 ? 1 : journals.length / 5) + 0.25 * (trades.length >= 20 ? 1 : trades.length / 20) + 0.15 * Math.min(1, Math.abs(top.score - rows[1].score) * 4)));

  const riskNotes = [];
  if (['Revenge Trader', 'FOMO Trader'].includes(persona) && ['F&O', 'Intraday'].includes(top.segment))
    riskNotes.push('Your journal shows impulsive entries — paper-trade this segment at 25% size with a hard stop until 5 green journals in a row.');
  if (avgRating < 2.5) riskNotes.push('Execution rating is low (<2.5/5). Fix process first: one setup, one timeframe, pre-written stop/target.');
  if (trades.length < 10) riskNotes.push('Small sample (<10 trades). Treat this as a starter allocation, not a verdict — re-run after 20 trades.');
  if ((market.breadth?.declines || 0) > (market.breadth?.advances || 0)) riskNotes.push('Breadth is weak today (more decliners). Prefer defensive Delivery (FMCG/Pharma) over fresh Intraday longs.');

  const plan = [
    `Start with ${top.segment}: ${top.evidence}`,
    `Position size: risk ≤1% of paper capital per trade; max 3 concurrent positions.`,
    `Journal every trade with setup + emotion + planned vs actual R:R — the model re-weights from this.`,
    `Re-check weekly: the ranking updates as your win-rate and sector momentum change.`,
  ];

  return {
    persona, personaDescription,
    topPick: top,
    ranking: rows,
    confidence: +confidence.toFixed(3),
    dataStats: { trades: trades.length, journals: journals.length, holdings: holdings.length, avgRating: +avgRating.toFixed(2) },
    riskNotes, plan,
    weightsVersion: weights.version,
    generatedAt: new Date().toISOString(),
    disclaimer: 'Paper-trading education only. Not investment advice. Combine with your own research; costs (STT/brokerage/slippage) can erase thin edges.',
  };
}

/**
 * Online update from a labelled outcome: outcome in {segment, pnl} (pnl>0 win).
 * Adjusts per-segment bias with small lr step. Called by future trade-close hook
 * and by the Python batch trainer (same weights.json).
 */
function trainOnline(outcomes = []) {
  const w = loadWeights();
  const lr = 0.02;
  outcomes.forEach((o) => {
    if (!o.segment) return;
    const y = o.pnl > 0 ? 1 : -1;
    w.segments[o.segment] = +(((w.segments[o.segment] || 0) + lr * y).toFixed(4));
    // clamp
    w.segments[o.segment] = Math.max(-0.3, Math.min(0.3, w.segments[o.segment]));
  });
  w.version += 1;
  saveWeights(w);
  return w;
}

module.exports = { recommend, trainOnline, loadWeights, saveWeights, inferSector, SEGMENT_UNIVERSE };
