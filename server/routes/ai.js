'use strict';
/**
 * routes/ai.js
 * AI Integration Layer for Portfolio insights and Trade Journal coach.
 */
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Helper to get Gemini model
function getModel() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
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

    const prompt = `You are an expert Trading Coach.
Review the following trade journal entry and provide constructive feedback on the trader's mindset, setup, and risk management.
Journal Entry:
Title: ${journal.title}
Setup: ${journal.setup}
Thesis: ${journal.thesis}
Mistakes: ${journal.mistakes}
Learnings: ${journal.learnings}
Rating: ${journal.rating}/5
Emotions: Entry(${journal.emotionOnEntry}), Exit(${journal.emotionOnExit})
Market Condition: ${journal.marketCondition}
Risk/Reward: Planned(${journal.riskRewardPlanned}), Actual(${journal.riskRewardActual})

Provide short, punchy feedback in Markdown format. Highlight one good thing and one area of improvement.`;

    const model = getModel();
    const result = await model.generateContent(prompt);
    res.json({ feedback: result.response.text() });
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

    const prompt = `You are an expert AI Portfolio Risk Manager for the Indian Stock Market.
Analyze the following portfolio and provide a comprehensive risk report.
Include sector concentration, correlation risks (e.g. overexposure to financials), and a "what-if" scenario analysis (e.g. what if RBI hikes rates, or global tech slows down).
Portfolio: ${JSON.stringify(portfolioData)}
Return the response in structured Markdown format. Ensure it is highly professional and actionable.`;

    const model = getModel();
    const result = await model.generateContent(prompt);
    res.json({ report: result.response.text() });
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

    const prompt = `You are a Trading Psychology Expert.
Analyze the trader's last ${journals.length} journal entries to identify behavioral patterns and cognitive biases (e.g., FOMO, revenge trading, cutting winners early).
Journal Data: ${JSON.stringify(journalData)}

Return the response STRICTLY as a JSON object with the following schema:
{
  "biases": ["List of identified biases"],
  "strengths": ["List of identified strengths"],
  "recommendations": ["Actionable steps to fix biases"]
}`;

    const model = getModel();
    const result = await model.generateContent(prompt);
    
    // Attempt to parse JSON from Markdown code blocks if any
    let text = result.response.text();
    text = text.replace(/^```json/m, '').replace(/```$/m, '').trim();
    
    try {
      const parsed = JSON.parse(text);
      res.json({ report: parsed });
    } catch (parseErr) {
      res.json({ report: { biases: [], strengths: [], recommendations: ["Error parsing AI response. Raw output: " + text] } });
    }
  } catch (err) {
    if (err.message.includes('not configured')) {
       return res.json({ report: { biases: [], strengths: [], recommendations: ["AI Coach is offline (missing GEMINI_API_KEY)"] } });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
