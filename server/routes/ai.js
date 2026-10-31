'use strict';
/**
 * routes/ai.js
 * AI Integration Layer for Portfolio insights and Trade Journal coach.
 */
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const aiService = require('../services/aiService');

// Helper to get Gemini model (kept for compat; delegates to aiService)
function getModel() {
  return aiService.getModel();
}

// POST /api/ai/portfolio-insight
// Generates natural language insights on current portfolio
router.post('/portfolio-insight', authMiddleware, async (req, res) => {
  try {
    const holdings = await prisma.holding.findMany({
      where: { userId: req.user.id },
      include: { instrument: true }
    });
    
    if (holdings.length === 0) {
      return res.json({ insight: "You currently have no active holdings in your portfolio." });
    }

    const portfolioData = holdings.map(h => ({
      symbol: h.instrument.tradingSymbol,
      sector: h.instrument.sector,
      quantity: h.quantity,
      avgPrice: h.avgPrice
    }));

    const prompt = `You are a Principal FinTech AI Advisor.
Please provide a brief, professional, and actionable insight into the following portfolio.
Do not hallucinate live market data, just analyze the structure, diversification, and general outlook based on standard financial principles.
Portfolio: ${JSON.stringify(portfolioData)}
Return your response in clean Markdown format. Keep it to 2-3 paragraphs.`;

    const model = getModel();
    const result = await model.generateContent(prompt);
    res.json({ insight: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/journal-coach
// Provides feedback on a specific trade journal entry
router.post('/journal-coach', authMiddleware, async (req, res) => {
  try {
    const { journalId } = req.body;
    if (!journalId) return res.status(400).json({ error: 'journalId is required' });

    const journal = await prisma.tradeJournal.findUnique({
      where: { id: journalId },
      include: { trade: { include: { instrument: true } } }
    });

    if (!journal || journal.userId !== req.user.id) {
      return res.status(404).json({ error: 'Journal not found' });
    }

    try { aiService.checkRateLimit(req.user.id); } catch (e) { return res.status(e.status || 429).json({ error: e.message }); }
    const cacheKey = `journal:${journalId}:${journal.updatedAt?.toISOString?.() || ''}`;
    const prompt = aiService.journalPrompt(journal);

    try {
      const { text } = await aiService.generateText(prompt, { cacheKey });
      return res.json({ feedback: text });
    } catch (e) {
      if (e.message.includes('not configured')) {
        return res.json({ feedback: "_AI Coach is currently offline. Please configure GEMINI_API_KEY._" });
      }
      throw e;
    }
  } catch (err) {
    // Graceful fallback if API key not present
    if (err.message.includes('not configured')) {
       return res.json({ feedback: "_AI Coach is currently offline. Please configure GEMINI_API_KEY._" });
    }
    res.status(500).json({ error: err.message });
  }
});
// POST /api/ai/portfolio-risk
// Module 1: AI Portfolio Risk Advisor
router.post('/portfolio-risk', authMiddleware, async (req, res) => {
  try {
    const holdings = await prisma.holding.findMany({
      where: { userId: req.user.id },
      include: { instrument: true }
    });
    
    if (holdings.length === 0) {
      return res.json({ report: "Your portfolio is currently empty. Start trading to receive risk analysis." });
    }

    const portfolioData = holdings.map(h => ({
      symbol: h.instrument.tradingSymbol,
      sector: h.instrument.sector || 'Unknown',
      quantity: h.quantity,
      avgPrice: h.avgPrice
    }));

    try { aiService.checkRateLimit(req.user.id); } catch (e) { return res.status(e.status || 429).json({ error: e.message }); }
    const cacheKey = `risk:${req.user.id}:${portfolioData.length}:${portfolioData.map(p => p.symbol + p.quantity).join(',').slice(0, 200)}`;
    const prompt = aiService.riskPrompt(portfolioData);

    try {
      const { text } = await aiService.generateText(prompt, { cacheKey });
      return res.json({ report: text });
    } catch (e) {
      if (e.message.includes('not configured')) {
        return res.json({ report: "_AI Risk Advisor is currently offline. Please configure GEMINI_API_KEY._" });
      }
      throw e;
    }
  } catch (err) {
    if (err.message.includes('not configured')) {
       return res.json({ report: "_AI Risk Advisor is currently offline. Please configure GEMINI_API_KEY._" });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/bias-coach
// Module 2: Trade Journal Bias Coach
router.post('/bias-coach', authMiddleware, async (req, res) => {
  try {
    const journals = await prisma.tradeJournal.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { trade: { include: { instrument: true } } }
    });

    if (journals.length === 0) {
      return res.json({ report: { biases: [], strengths: [], recommendations: ["Not enough journal entries to analyze biases. Keep trading and journaling!"] } });
    }

    const journalData = journals.map(j => ({
      setup: j.setup,
      mistakes: j.mistakes,
      learnings: j.learnings,
      rating: j.rating,
      emotionEntry: j.emotionOnEntry,
      emotionExit: j.emotionOnExit,
      marketCondition: j.marketCondition,
      rrPlanned: j.riskRewardPlanned,
      rrActual: j.riskRewardActual
    }));

    try { aiService.checkRateLimit(req.user.id); } catch (e) { return res.status(e.status || 429).json({ error: e.message }); }
    const { text: prompt } = aiService.biasPrompt(journals);
    const cacheKey = `bias:${req.user.id}:${journals.map(j => j.id).join(',').slice(0, 300)}`;

    let text;
    try {
      const r = await aiService.generateText(prompt, { cacheKey });
      text = r.text;
    } catch (e) {
      if (e.message.includes('not configured')) {
        return res.json({ report: { biases: [], strengths: [], recommendations: ["AI Coach is offline (missing GEMINI_API_KEY)"] } });
      }
      throw e;
    }
    
    // Attempt to parse JSON from Markdown code blocks if any
    text = text.replace(/^```json/m, '').replace(/```$/m, '').trim();
    
    try {
      const parsed = aiService.extractJson(text) || JSON.parse(text);
      res.json({ report: parsed });
    } catch (parseErr) {
      res.json({ report: { persona: 'Unknown', personaDescription: '', biases: [], strengths: [], recommendations: ['Error parsing AI response. Raw output: ' + text] } });
    }

  } catch (err) {
    if (err.message.includes('not configured')) {
       return res.json({ report: { biases: [], strengths: [], recommendations: ["AI Coach is offline (missing GEMINI_API_KEY)"] } });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/validate-strategy
// Module 3: AI-Assisted Strategy Validator
router.post('/validate-strategy', authMiddleware, async (req, res) => {
  try {
    const {
      strategyName, entryCondition, exitCondition, stopLoss, target,
      capital, instrument, timeframe, backtestResults
    } = req.body;

    if (!strategyName || !entryCondition || !exitCondition) {
      return res.status(400).json({ error: 'strategyName, entryCondition, and exitCondition are required.' });
    }

    const prompt = `You are an expert Indian Stock Market Strategy Analyst and Quant Researcher.
A retail trader has backtested the following strategy on Indian markets. Your job is to provide a rigorous, institutional-grade validation report.

**Strategy Details:**
- Name: ${strategyName}
- Instrument: ${instrument || 'Not specified'}
- Timeframe: ${timeframe || 'Not specified'}
- Entry Condition: ${entryCondition}
- Exit Condition: ${exitCondition}
- Stop Loss: ${stopLoss || 'Not specified'}
- Target: ${target || 'Not specified'}
- Capital: ₹${capital?.toLocaleString('en-IN') || 'Not specified'}

**Backtest Results (if provided):**
${backtestResults ? JSON.stringify(backtestResults, null, 2) : 'No backtest results provided; validate the strategy logic theoretically.'}

**Your Validation Must Include:**
1. **Strategy Summary** - A brief plain-English explanation of what this strategy does.
2. **Edge Assessment** - Does this strategy have a statistically valid edge? Why or why not?
3. **Indian Market Reality Check** - Critically analyze the strategy against:
   - STT (Securities Transaction Tax) impact on profitability
   - Exchange transaction charges & stamp duty erosion
   - Slippage in Indian markets (especially mid-cap/small-cap liquidity gaps)
   - Impact cost during high-volatility events (Union Budget, RBI policy)
   - F&O expiry anomalies if applicable
4. **Overfitting Red Flags** - Is this strategy curve-fitted to historical Nifty/Sensex data? Identify any warning signs.
5. **Risk-Reward Reality** - Evaluate actual vs. claimed risk-reward after costs.
6. **Verdict** - A clear PASS / CONDITIONAL PASS / FAIL verdict with confidence level.
7. **Improvement Suggestions** - 3 concrete, actionable improvements.

Format the entire response in professional Markdown. Be direct, rigorous, and avoid sugarcoating weak strategies.`;

    const model = getModel();
    const result = await model.generateContent(prompt);
    res.json({ validationReport: result.response.text() });
  } catch (err) {
    if (err.message.includes('not configured')) {
      return res.json({ validationReport: '_AI Strategy Validator is offline. Please configure GEMINI_API_KEY._' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/invest-recommendation
// Hybrid skill+market recommender: "where should this person invest?"
router.post('/invest-recommendation', authMiddleware, async (req, res) => {
  try {
    const engine = require('../services/recommendationEngine');
    try { aiService.checkRateLimit(req.user.id); } catch (e) { return res.status(e.status || 429).json({ error: e.message }); }

    const [holdings, trades, journals] = await Promise.all([
      prisma.holding.findMany({ where: { userId: req.user.id }, include: { instrument: true } }),
      prisma.trade.findMany({ where: { userId: req.user.id }, include: { instrument: true }, orderBy: { executedAt: 'desc' }, take: 200 }),
      prisma.tradeJournal.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);

    // Market snapshot (best-effort, never fails the recommendation)
    let market = { sectors: [], breadth: null };
    try {
      const mkt = require('../services/marketDataService');
      const [sectors, breadth] = await Promise.all([
        (async () => {
          const SECTORS = mkt.SECTORS || {};
          const all = [...new Set(Object.values(SECTORS).flat())].slice(0, 40);
          const quotes = await mkt.fetchQuotesBatch(all.map((s) => `${s}.NS`), 10, 150).catch(() => []);
          const lookup = {};
          quotes.forEach((q) => { lookup[(q.yahooSymbol || '').replace('.NS', '')] = q; });
          return Object.entries(SECTORS).map(([sector, stocks]) => {
            const qs = stocks.map((s) => lookup[s]).filter(Boolean);
            const avg = qs.length ? qs.reduce((a, q) => a + (q.changePercent || 0), 0) / qs.length : 0;
            return { sector, avgChangePercent: +avg.toFixed(2) };
          });
        })(),
        (async () => {
          const NIFTY50 = mkt.NIFTY50 || [];
          const quotes = await mkt.fetchQuotesBatch(NIFTY50.map((s) => `${s}.NS`), 10, 150).catch(() => []);
          const all = quotes.filter((q) => q.price > 0);
          return {
            advances: all.filter((s) => s.changePercent > 0).length,
            declines: all.filter((s) => s.changePercent < 0).length,
          };
        })(),
      ]);
      market = { sectors, breadth };
    } catch {}

    const flatTrades = trades.map((t) => ({
      side: t.side, quantity: t.quantity, price: t.price,
      netAmount: t.netAmount, totalValue: t.totalValue,
      symbol: t.instrument?.tradingSymbol, instrument: t.instrument,
      executedAt: t.executedAt,
    }));

    // Phase 3: fold live forecaster signals into the ranking
    let forecasts = {};
    try {
      const forecaster = require('../ai/forecaster');
      for (const s of ['TCS', 'INFY', 'HDFCBANK', 'SBIN', 'RELIANCE']) {
        const rows = await prisma.candle.findMany({
          where: { tradingSymbol: s, timeframe: '5m' },
          orderBy: { ts: 'desc' }, take: 400,
        });
        const bars = rows.reverse().map((r) => ({ time: r.ts, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
        const p = forecaster.predict(s, '5m', bars);
        if (p) forecasts[s] = p;
      }
    } catch {}

    const report = engine.recommend({ trades: flatTrades, journals, holdings, market, forecasts });

    // Optional Gemini polish (cached, offline-tolerant)
    let aiSummary = null;
    try {
      const prompt = `You are a SEBI-aware investment coach. In 4-6 crisp bullets, explain WHY ${report.topPick.segment} fits this trader (persona: ${report.persona}) given skill ${JSON.stringify(report.topPick)} and risk notes ${JSON.stringify(report.riskNotes)}. Plain English, no hype, end with one next action.`;
      const { text } = await aiService.generateText(prompt, { cacheKey: `reco:${req.user.id}:${report.topPick.segment}:${flatTrades.length}:${journals.length}` });
      aiSummary = text;
    } catch { aiSummary = null; }

    // Online learn from latest closed P&L (weak labels keep weights fresh)
    try {
      const realized = holdings.map((h) => ({ segment: (h.instrument?.sector || engine.inferSector(h.instrument?.tradingSymbol)), pnl: h.realizedPL || 0 })).filter((o) => o.pnl !== 0).slice(0, 20);
      if (realized.length) engine.trainOnline(realized);
    } catch {}

    res.json({ recommendation: report, aiSummary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Phase 3: trained direction forecaster ─────────────────────────────────────
// GET /api/ai/forecast?symbol=TCS&timeframe=5m
// Returns the model's next-bar direction with its honest walk-forward accuracy.
// When there is no live model, the response says so instead of guessing.
router.get('/forecast', authMiddleware, async (req, res) => {
  try {
    const forecaster = require('../ai/forecaster');
    const symbol = (req.query.symbol || '').toUpperCase();
    const timeframe = req.query.timeframe || '5m';
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const to = Math.floor(Date.now() / 1000);
    const rows = await prisma.candle.findMany({
      where: { tradingSymbol: symbol, timeframe, ts: { lte: to } },
      orderBy: { ts: 'desc' },
      take: 400,
    });
    const bars = rows.reverse().map((r) => ({ time: r.ts, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
    const out = forecaster.status(symbol, timeframe, bars);
    res.json({ symbol, timeframe, ...out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Phase 3: news sentiment ───────────────────────────────────────────────────
// GET /api/ai/sentiment?symbols=RELIANCE,TCS
// Scores the latest headlines per symbol with the financial lexicon.
router.get('/sentiment', authMiddleware, async (req, res) => {
  try {
    const sentiment = require('../ai/sentiment');
    const symbols = (req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

    // reuse the market news endpoint's sources via the provider
    let headlines = [];
    try {
      const r = await require('axios').get(
        `http://localhost:${process.env.PORT || 5000}/api/market/news`,
        { headers: { Authorization: req.headers.authorization || '' }, timeout: 12000 }
      );
      headlines = (r.data?.news || []).map((n) => ({ title: n.title, publishedAt: n.publishedAt, publisher: n.publisher }));
    } catch {}
    // fallback: score whatever the caller passes
    if (req.body && Array.isArray(req.body.headlines)) headlines = req.body.headlines;

    const universe = symbols.length ? symbols : ['^NSEI', '^BSESN', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY'];
    const tagged = headlines.map((h) => ({ ...h, symbols: sentiment.detectSymbols(h.title, universe) }));
    const withSym = [];
    tagged.forEach((h) => (h.symbols.length ? h.symbols : ['^NSEI']).forEach((s) => withSym.push({ symbol: s, ...h })));
    const signals = sentiment.aggregate(withSym);

    const out = {};
    universe.forEach((s) => { out[s] = signals[s] || { score: 0, label: 'neutral', headlines: 0 }; });
    res.json({ sentiment: out, scored: headlines.length, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Phase 3: journal bias coach (rule layer, always works) ───────────────────
// GET /api/ai/bias-report — deterministic bias analysis over your journals.
router.get('/bias-report', authMiddleware, async (req, res) => {
  try {
    const biasCoach = require('../ai/biasCoach');
    const journals = await prisma.tradeJournal.findMany({
      where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    if (!journals.length) {
      return res.json({ entries: 0, message: 'Write your first journal entry and the coach will start working.' });
    }
    res.json({ entries: journals.length, ...biasCoach.report(journals) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/bias-score { text } — score a draft entry before saving it.
router.post('/bias-score', authMiddleware, (req, res) => {
  try {
    const biasCoach = require('../ai/biasCoach');
    const sentiment = require('../ai/sentiment');
    const text = req.body?.text || '';
    const rules = biasCoach.analyzeEntry({
      title: req.body?.title || '', setup: req.body?.setup || '', thesis: req.body?.thesis || '',
      mistakes: req.body?.mistakes || '', learnings: req.body?.learnings || '',
      emotionOnEntry: req.body?.emotionOnEntry || '', emotionOnExit: req.body?.emotionOnExit || '',
      rating: req.body?.rating, riskRewardPlanned: req.body?.riskRewardPlanned, riskRewardActual: req.body?.riskRewardActual,
    });
    let textProbs = {};
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = process.env.AI_MODEL_DIR || path.join(__dirname, '..', 'ai', 'models');
      const p = path.join(dir, 'bias_text.json');
      if (fs.existsSync(p)) textProbs = biasCoach.scoreText(JSON.parse(fs.readFileSync(p, 'utf8')), text);
    } catch {}
    res.json({ rules, textProbs, tone: sentiment.scoreText(text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

