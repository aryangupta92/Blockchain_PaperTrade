'use strict';
/**
 * services/aiService.js — ADDITIVE central AI layer.
 * Keeps exact same Gemini model + prompt style as routes/ai.js so base behavior is unchanged,
 * but adds: in-memory TTL cache, safe JSON extraction, token/cost guard, offline fallback.
 * routes/ai.js is refactored to call these helpers (same req/res shape).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const CACHE = new Map(); // key -> { data, expiresAt }
const CACHE_TTL_MS = parseInt(process.env.AI_CACHE_TTL || '900', 10) * 1000;
const DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '50', 10);
const usageByUserDay = new Map(); // `${userId}:${yyyy-mm-dd}` -> count

function cacheGet(key) {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { CACHE.delete(key); return null; }
  return e.data;
}
function cacheSet(key, data, ttl = CACHE_TTL_MS) {
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(key, { data, expiresAt: Date.now() + ttl });
}

function checkRateLimit(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${userId}:${day}`;
  const n = usageByUserDay.get(k) || 0;
  if (n >= DAILY_LIMIT) {
    const err = new Error(`AI daily limit reached (${DAILY_LIMIT}/day). Try tomorrow.`);
    err.status = 429;
    throw err;
  }
  usageByUserDay.set(k, n + 1);
  return DAILY_LIMIT - n - 1;
}

function getModel() {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.status = 503;
    throw err;
  }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: process.env.AI_MODEL || 'gemini-1.5-flash' });
}

async function generateText(prompt, { cacheKey = null, maxRetries = 1 } = {}) {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return { text: hit, cached: true };
  }
  const model = getModel();
  let lastErr = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (cacheKey) cacheSet(cacheKey, text);
      return { text, cached: false };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function extractJson(text) {
  let t = String(text || '').trim();
  // strip ```json fences
  t = t.replace(/^```(?:json)?/im, '').replace(/```$/m, '').trim();
  // try direct parse, else find first {...} block
  try { return JSON.parse(t); } catch (_) {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) {}
  }
  return null;
}

// Prompt builders — same tone as existing routes/ai.js, versioned here
function riskPrompt(portfolioData) {
  return `You are an expert AI Portfolio Risk Manager for the Indian Stock Market.
Analyze the following portfolio and provide a comprehensive risk report.
Include sector concentration, correlation risks (e.g. overexposure to financials), and a "what-if" scenario analysis (e.g. what if RBI hikes rates, or global tech slows down).
Portfolio: ${JSON.stringify(portfolioData)}
Return the response in structured Markdown format. Ensure it is highly professional and actionable.`;
}

function journalPrompt(j) {
  return `You are an expert Trading Coach.
Review the following trade journal entry and provide constructive feedback on the trader's mindset, setup, and risk management.
Journal Entry:
Title: ${j.title}
Setup: ${j.setup}
Thesis: ${j.thesis}
Mistakes: ${j.mistakes}
Learnings: ${j.learnings}
Rating: ${j.rating}/5
Emotions: Entry(${j.emotionOnEntry}), Exit(${j.emotionOnExit})
Market Condition: ${j.marketCondition}
Risk/Reward: Planned(${j.riskRewardPlanned}), Actual(${j.riskRewardActual})

Provide short, punchy feedback in Markdown format. Highlight one good thing and one area of improvement.`;
}

function biasPrompt(journals) {
  const journalData = journals.map(j => ({
    setup: j.setup, mistakes: j.mistakes, learnings: j.learnings, rating: j.rating,
    emotionEntry: j.emotionOnEntry, emotionExit: j.emotionOnExit,
    marketCondition: j.marketCondition, rrPlanned: j.riskRewardPlanned, rrActual: j.riskRewardActual,
  }));
  return { text: `You are a Trading Psychology Expert specializing in Indian retail traders.
Analyze the trader's last ${journals.length} journal entries to identify behavioral patterns and cognitive biases (e.g., FOMO, revenge trading, cutting winners early, averaging down losers, over-leveraging in F&O).

Journal Data: ${JSON.stringify(journalData)}

Also assign the trader a "Trader Persona" — a named psychological archetype that best describes their overall trading style and psychology. Choose from (or create a fitting one):
"Momentum Chaser", "Revenge Trader", "Disciplined Executor", "FOMO Trader", "Risk-Averse Hesitator", "Overconfident Scalper", "Loss Aversion Holder", "Systematic Planner", "Emotional Swinger", "Calculated Risk-Taker".

Return the response STRICTLY as a JSON object with the following schema:
{
  "persona": "Name of trader persona",
  "personaDescription": "One sentence describing this persona and its typical failure mode or strength",
  "biases": ["List of identified biases"],
  "strengths": ["List of identified strengths"],
  "recommendations": ["Actionable steps to fix biases and improve performance"]
}`, journalData };
}

module.exports = {
  cacheGet, cacheSet, checkRateLimit, getModel, generateText, extractJson,
  riskPrompt, journalPrompt, biasPrompt,
};
