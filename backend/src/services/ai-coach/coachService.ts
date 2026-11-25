import axios from 'axios';
import { AccountMode } from '@broker/shared';
import { sanitizeUserMessage } from '../../infrastructure/providerAnonymizer';
import { retrieveKnowledge } from './indianMarketKnowledgeBase';
import { generateTradingDiagnostics } from './tradeBehaviorDiagnostics';

export interface CoachChatInput {
  userId: string;
  accountMode: AccountMode;
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface CoachChatResponse {
  answer: string;
  providerUsed: 'local-rag' | 'ollama' | 'gemini';
  sebiGuardrailTriggered: boolean;
  citations: Array<{ id: string; title: string; category: string }>;
  suggestedActions: Array<{ label: string; targetNav: string }>;
  disclaimer: string;
}

const SEBI_EDUCATIONAL_DISCLAIMER =
  'Educational Coach Only (SEBI Compliance): This guidance is strictly for market education, risk management, and platform literacy—not SEBI-registered investment advice or buy/sell recommendations.';

/**
 * Strict SEBI IA/RA Compliance Guardrail:
 * Detects personalized stock tips / price target requests and prevents giving buy/sell calls.
 */
export function detectInvestmentAdviceRequest(question: string): boolean {
  const q = question.toLowerCase();
  const patterns = [
    /\bshould i (buy|sell|short|hold|invest in)\b/i,
    /\b(buy|sell) (call|put|nifty|banknifty|sensex|reliance|tcs|hdfc|sbin|gold|crude)\b.*\b(now|today|tomorrow)\b/i,
    /\bwhich stock (will|should|to) (buy|double|multibagger|boom|go up)\b/i,
    /\bgive me (a )?(tip|tips|call|calls|stock pick|target price|sure shot)\b/i,
    /\bpredict (nifty|banknifty|sensex|market|stock)\b/i,
    /\bwill (nifty|banknifty|reliance|tcs|gold) go (up|down)\b/i,
  ];
  return patterns.some((re) => re.test(q));
}

function buildSystemPrompt(contextBlock: string): string {
  return [
    'You are BlockTrade AI Trading Coach — an expert, friendly Indian stock market & derivatives educator.',
    'STRICT RULES:',
    '1. NEVER give personalized stock tips, buy/sell recommendations, or price predictions (SEBI IA/RA Regulations). If asked what to buy/sell, politely refuse and teach the analytical framework instead.',
    '2. NEVER mention any external market-data vendor name or URL. Always refer to prices neutrally as "live market data".',
    '3. Use Indian market terminology accurately (NSE, BSE, MCX, INR ₹, Lakhs/Crores, CNC/MIS/NRML, T+1, VaR+ELM, Finance Act 2026 STT, SEBI F&O rules).',
    '4. Be structured, concise, practical, and beginner-friendly.',
    '',
    'GROUNDED VERIFIED CONTEXT:',
    contextBlock,
  ].join('\n');
}

async function callOllama(systemPrompt: string, question: string, history: Array<{ role: string; content: string }>) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'blocktrade-coach';
  const r = await axios.post<{ message?: { content?: string } }>(
    `${baseUrl}/api/chat`,
    {
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-6),
        { role: 'user', content: question },
      ],
    },
    { timeout: 30_000 }
  );
  const text = r.data?.message?.content?.trim();
  if (!text) throw new Error('Empty Ollama response');
  return text;
}

async function callGemini(systemPrompt: string, question: string) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const r = await axios.post<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
    },
    { timeout: 20_000 }
  );
  const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

function buildLocalRagAnswer(
  question: string,
  retrieved: ReturnType<typeof retrieveKnowledge>,
  diagnosticsSummary: string | null
): string {
  const qLower = question.toLowerCase();
  const asksAboutMyTrades =
    qLower.includes('my trade') ||
    qLower.includes('my performance') ||
    qLower.includes('diagnos') ||
    qLower.includes('review my') ||
    qLower.includes('doing wrong') ||
    qLower.includes('ready for real');

  if (asksAboutMyTrades && diagnosticsSummary) {
    return diagnosticsSummary;
  }

  if (retrieved.length > 0) {
    const primary = retrieved[0].doc;
    const secondary = retrieved.slice(1).map((r) => `- **${r.doc.title}:** ${r.doc.content}`);
    const parts = [
      `### ${primary.title}`,
      primary.content,
    ];
    if (secondary.length > 0) {
      parts.push('\n**Related Indian Market & Platform Context:**', ...secondary);
    }
    if (diagnosticsSummary && qLower.includes('improve')) {
      parts.push('\n**Based on Your Account History:**', diagnosticsSummary);
    }
    return parts.join('\n\n');
  }

  return [
    'I can help you master the Indian stock market and every feature of this platform! Here are great topics to ask me about:',
    '- **Indian Market Basics:** "Explain CNC vs MIS vs NRML" or "What are NSE/BSE and MCX market hours?"',
    '- **Charges & Taxes:** "What are the Finance Act 2026 STT rates and charges?"',
    '- **F&O & Option Chain:** "Explain Delta, Theta, Vega, IV, PCR and SEBI weekly expiry rules"',
    '- **Risk & Strategy:** "How do I calculate position size using the 1% risk rule?" or "How does zero-look-ahead backtesting work?"',
    '- **Personal Review:** "Review my trades and tell me if I am ready for REAL trading"',
    '- **Platform Help:** "How do I verify my trades on the SHA-256 blockchain?"',
  ].join('\n');
}

export async function askAiTradingCoach(input: CoachChatInput): Promise<CoachChatResponse> {
  const question = input.question.trim();

  // 1. Hard SEBI Compliance Guardrail (checked BEFORE any LLM call)
  if (detectInvestmentAdviceRequest(question)) {
    return {
      answer: [
        'Under **SEBI (Investment Advisers) Regulations, 2013**, I cannot recommend buying, selling, or predicting the price of any specific stock, index, option, or commodity.',
        '',
        '**Instead, here is the professional framework you can practice right now in DEMO mode:**',
        '1. **Check the Trend & Key Levels:** Open **Charts**, add `EMA 50`, `VWAP`, and `Volume`, and mark Support/Resistance zones.',
        '2. **Test Your Rules Historically:** Open **Strategy Lab & Backtest** and verify whether your entry/exit setup has positive Net Expectancy *after* Finance Act 2026 STT and slippage.',
        '3. **Size Your Risk (1% Rule):** Never risk more than 1% of your capital on a single trade; always define your Stop-Loss *before* placing an order.',
        '4. **Check Margin & Charges Preview:** Open the **Order Ticket** in **DEMO** mode to inspect exact VaR+ELM margin and statutory levies before executing.',
      ].join('\n'),
      providerUsed: 'local-rag',
      sebiGuardrailTriggered: true,
      citations: [
        { id: 'kb-risk-management', title: 'Risk Management & 1% Position Sizing', category: 'RISK_CHARGES' },
        { id: 'kb-strategy-backtest', title: 'Zero-Look-Ahead Strategy Backtesting', category: 'STRATEGY_BACKTEST' },
      ],
      suggestedActions: [
        { label: 'Open Strategy Lab & Backtest', targetNav: 'strategy-lab' },
        { label: 'Open Charts', targetNav: 'charts' },
      ],
      disclaimer: SEBI_EDUCATIONAL_DISCLAIMER,
    };
  }

  // 2. Retrieve grounded knowledge + live personal trading diagnostics
  const retrieved = retrieveKnowledge(question, 3);
  let diagnosticsSummary: string | null = null;
  try {
    const diag = await generateTradingDiagnostics(input.userId, input.accountMode);
    diagnosticsSummary = [
      `**Your ${diag.accountMode} Account Diagnostics (Readiness Score: ${diag.readinessScore}/100):**`,
      `- Trades Executed: ${diag.totalTrades} (${diag.closedRoundTrips} closed round-trips) | Win Rate: ${diag.winRatePct}% | Reward:Risk: ${diag.rewardToRiskRatio}:1`,
      `- Gross Realized P&L: ₹${diag.grossRealizedPnl} | Total Charges Paid: ₹${diag.totalChargesPaid} (${diag.chargesDragPct}% drag) | **Net Realized P&L: ₹${diag.netRealizedPnl}**`,
      `- Stop-Loss Order Usage: ${diag.stopLossUsagePct}% | Max Trades/Day: ${diag.maxTradesInSingleDay} | Revenge-Trade Flags: ${diag.revengeTradeFlags}`,
      ...(diag.strengths.length ? [`- **Strengths:** ${diag.strengths.join(' ')}`] : []),
      ...(diag.improvements.length ? [`- **Focus Areas:** ${diag.improvements.join(' ')}`] : []),
      `- **Next Step:** ${diag.nextStepAdvice}`,
    ].join('\n');
  } catch {
    diagnosticsSummary = null;
  }

  const contextBlock = [
    ...retrieved.map((r) => `[${r.doc.title}]\n${r.doc.content}`),
    ...(diagnosticsSummary ? [`\n[User Account Summary]\n${diagnosticsSummary}`] : []),
  ].join('\n\n');

  const preferredProvider = (process.env.AI_COACH_PROVIDER || 'local-rag').toLowerCase();
  let answer = '';
  let providerUsed: CoachChatResponse['providerUsed'] = 'local-rag';

  if (preferredProvider === 'ollama') {
    try {
      answer = await callOllama(buildSystemPrompt(contextBlock), question, input.history || []);
      providerUsed = 'ollama';
    } catch {
      answer = buildLocalRagAnswer(question, retrieved, diagnosticsSummary);
      providerUsed = 'local-rag';
    }
  } else if (preferredProvider === 'gemini') {
    try {
      answer = await callGemini(buildSystemPrompt(contextBlock), question);
      providerUsed = 'gemini';
    } catch {
      answer = buildLocalRagAnswer(question, retrieved, diagnosticsSummary);
      providerUsed = 'local-rag';
    }
  } else {
    answer = buildLocalRagAnswer(question, retrieved, diagnosticsSummary);
    providerUsed = 'local-rag';
  }

  // Enforce Rule 1.2 (zero market-data provider leaks in AI answers)
  answer = sanitizeUserMessage(answer);

  const suggestedActions: Array<{ label: string; targetNav: string }> = [];
  if (retrieved.some((r) => r.doc.category === 'FNO')) {
    suggestedActions.push({ label: 'Explore Live Option Chain', targetNav: 'option-chain' });
  }
  if (retrieved.some((r) => r.doc.category === 'STRATEGY_BACKTEST')) {
    suggestedActions.push({ label: 'Open Strategy Lab & Backtest', targetNav: 'strategy-lab' });
  }
  if (retrieved.some((r) => r.doc.category === 'RISK_CHARGES')) {
    suggestedActions.push({ label: 'Inspect P&L & Contract Notes', targetNav: 'reports' });
  }
  if (suggestedActions.length === 0) {
    suggestedActions.push({ label: 'Practice in DEMO Markets', targetNav: 'overview' });
  }

  return {
    answer,
    providerUsed,
    sebiGuardrailTriggered: false,
    citations: retrieved.map((r) => ({ id: r.doc.id, title: r.doc.title, category: r.doc.category })),
    suggestedActions,
    disclaimer: SEBI_EDUCATIONAL_DISCLAIMER,
  };
}
