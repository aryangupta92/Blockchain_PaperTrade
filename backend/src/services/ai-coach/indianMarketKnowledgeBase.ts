export interface KnowledgeDoc {
  id: string;
  category: 'MARKET_BASICS' | 'EQUITY' | 'FNO' | 'RISK_CHARGES' | 'PLATFORM_GUIDE' | 'STRATEGY_BACKTEST';
  title: string;
  tags: string[];
  content: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface AcademyModule {
  id: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'PRO';
  title: string;
  durationMin: number;
  summary: string;
  lessons: Array<{ heading: string; body: string; indianExample: string }>;
  quiz: QuizQuestion[];
}

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  {
    id: 'kb-indian-exchanges',
    category: 'MARKET_BASICS',
    title: 'How Indian Stock & Commodity Exchanges Work (NSE, BSE, MCX)',
    tags: ['nse', 'bse', 'mcx', 'market hours', 'pre-open', 'amo', 'session', 'beginner', 'indian market'],
    content:
      'India has three primary trading exchanges: NSE (National Stock Exchange) and BSE (Bombay Stock Exchange) for Equities, ETFs, and Equity/Index F&O; and MCX (Multi Commodity Exchange) for Gold, Silver, Crude Oil, Natural Gas, and Base Metal derivatives. Equity & F&O normal trading runs 09:15–15:30 IST (Mon–Fri), preceded by a 09:00–09:15 Pre-Open session and followed by 15:30–16:00 Post-Close. MCX trades 09:00–23:30 IST (23:55 during US non-DST). Outside trading hours you can queue an AMO (After-Market Order) for the next open.',
  },
  {
    id: 'kb-cnc-vs-mis',
    category: 'EQUITY',
    title: 'CNC (Delivery) vs MIS (Intraday) vs NRML (Derivatives)',
    tags: ['cnc', 'mis', 'nrml', 'delivery', 'intraday', 'short selling', 'leverage', 't+1', 'btst', 'square off'],
    content:
      'CNC (Cash & Carry) is for Equity/ETF Delivery: you pay 100% upfront cash, shares settle in T+1 working day, and SEBI prohibits short selling in CNC. Selling unsettled T+1 shares (BTST) carries short-delivery auction risk in live markets. MIS (Margin Intraday Square-off) is for same-day trades: both Buy-first and Short-Sell-first are allowed, upfront margin follows per-scrip VaR + ELM (typically 20%–25%, i.e., 4x–5x, never a flat hardcoded 5x), and open MIS positions auto square-off at 15:15 IST. NRML is for carry-forward Futures & Options (F&O and MCX).',
  },
  {
    id: 'kb-order-types',
    category: 'EQUITY',
    title: 'Order Types: MARKET, LIMIT, SL, SL-M, BO, CO, SUPER & GTT',
    tags: ['order', 'market', 'limit', 'sl', 'sl-m', 'stop loss', 'bracket', 'bo', 'co', 'super', 'trailing', 'gtt', 'ioc'],
    content:
      'MARKET executes immediately at best available bid/ask depth. LIMIT executes only at your specified price or better. SL (Stop-Loss Limit) and SL-M (Stop-Loss Market) stay TRIGGER_PENDING until price crosses your Trigger Price to cap losses or enter breakouts. CO (Cover Order) bundles an entry + mandatory Stop Loss. BO (Bracket Order) adds both Target and Stop Loss. SUPER Order adds a Trailing Stop-Loss (trailingJump) that ratchets your stop favorably as price moves in your favor. GTT (Good-Till-Triggered / Forever) stays armed across sessions until triggered.',
  },
  {
    id: 'kb-charges-finance-act-2026',
    category: 'RISK_CHARGES',
    title: 'Indian Statutory Charges & Finance Act 2026 STT Rates',
    tags: ['stt', 'ctt', 'gst', 'stamp duty', 'brokerage', 'charges', 'tax', 'dp charges', 'sebi fee', 'contract note', '2026'],
    content:
      'Every Indian trade incurs statutory levies applied identically in both DEMO and REAL accounts here: (1) Brokerage (default plan: ₹0 Equity Delivery, min ₹20 or 0.03% for MIS/Futures, ₹20 flat per Options order). (2) STT effective April 1, 2026 (Finance Act 2026): Equity Delivery 0.1% Buy & Sell; Equity Intraday 0.025% Sell; Equity Futures 0.05% Sell; Equity Options 0.15% on Sell premium and 0.15% on exercised ITM intrinsic value. (3) Exchange Transaction Charges + SEBI Turnover Fee (0.0001% = ₹10/Cr). (4) Stamp Duty on Buy side (0.015% CNC, 0.003% MIS/Options, 0.002% Futures). (5) DP Charge on CNC delivery sells (~₹13.50 + GST per scrip). (6) 18% GST on Brokerage + Exchange + SEBI + DP fees. Always check Net P&L after charges in P&L & Contract Notes!',
  },
  {
    id: 'kb-option-chain-greeks',
    category: 'FNO',
    title: 'Option Chain, Greeks (Delta, Gamma, Theta, Vega), IV, PCR & Max Pain',
    tags: ['options', 'option chain', 'greeks', 'delta', 'gamma', 'theta', 'vega', 'iv', 'pcr', 'max pain', 'ce', 'pe', 'atm', 'itm', 'otm'],
    content:
      'Calls (CE) profit when the underlying rises; Puts (PE) profit when it falls. Strikes near spot are ATM; strikes with intrinsic value are ITM (shaded on our Option Chain); others are OTM. Delta measures option price change per ₹1 underlying move (0 to 1 for CE, 0 to -1 for PE). Gamma is how fast Delta changes (spikes near expiry!). Theta is daily time decay—option buyers lose Theta every day even if price is flat! Vega measures sensitivity to Implied Volatility (IV)—buying options right before an event can suffer IV crush even if direction is right. PCR (Put/Call OI Ratio) gauges sentiment, and Max Pain is the strike where total option buyers lose the most at expiry.',
  },
  {
    id: 'kb-sebi-fno-rules',
    category: 'FNO',
    title: 'SEBI F&O Framework Rules (Weekly Expiries, Upfront Premium & Expiry ELM)',
    tags: ['sebi', 'fno', 'expiry', 'weekly', 'calendar spread', 'elm', 'lot size', 'ban', 'exercise', 'margin'],
    content:
      'Under SEBI Circular SEBI/HO/MRD/TPD/P/CIR/2024/132: (1) Weekly index options are limited to ONE benchmark index per exchange (NIFTY on NSE, SENSEX on BSE); BANKNIFTY, FINNIFTY, and MIDCPNIFTY have monthly expiries only. (2) Minimum contract notional is ₹15–20 lakh at introduction. (3) Option buyers must pay 100% option premium upfront (effective Feb 1, 2025). (4) Calendar spread margin benefits are stripped on the near-month contract expiry day. (5) Short index options attract an additional +2% Extreme Loss Margin (ELM) on expiry day. (6) Stocks in the F&O Ban Period (MWPL > 95%) allow only position-closing orders. (7) ITM options held into expiry auto-exercise and attract 0.15% STT on intrinsic value.',
  },
  {
    id: 'kb-risk-management',
    category: 'RISK_CHARGES',
    title: 'Risk Management, 1% Rule, Position Sizing & Avoiding Blowups',
    tags: ['risk', 'position sizing', 'stop loss', 'drawdown', 'overtrading', 'psychology', 'kill switch', 'beginner', 'capital'],
    content:
      'Professional Indian traders protect capital before chasing returns. Follow the 1% Risk Rule: never risk more than 1% of your total capital on a single trade. Calculate Quantity = Floor((Capital × Risk%) / |Entry - StopLoss|). Example: With ₹2,00,000 capital and 1% risk (₹2,000) and a ₹20 stop-loss distance, buy at most 100 shares. Always use a hard Stop Loss, set a Max Daily Loss in Positions → Risk Controls, and trigger the Kill Switch if you hit your daily limit to prevent revenge trading and fee-drag overtrading.',
  },
  {
    id: 'kb-strategy-backtest',
    category: 'STRATEGY_BACKTEST',
    title: 'Building & Backtesting Strategies Without Look-Ahead Bias',
    tags: ['strategy', 'backtest', 'strategy lab', 'sharpe', 'drawdown', 'slippage', 'overfitting', 'ema', 'rsi', 'supertrend', 'vwap'],
    content:
      'In Strategy Lab & Backtest, build visual Entry/Exit rules using SMA, EMA, VWAP, RSI, MACD, Bollinger Bands, or Supertrend, or load a starter template. Our engine avoids classic backtest traps: signals at bar i close execute strictly at bar i+1 open (+ configurable slippage in bps), overnight gaps fill at actual gap open, same-bar SL/Target ties resolve conservatively to SL, MIS positions force square-off at 15:15 IST, and exact effective-dated Indian statutory charges are deducted on every trade. Look for positive Net Expectancy, Profit Factor > 1.3, Sharpe > 1.0, manageable Max Drawdown (<15%), and low Fee Drag before practicing live in DEMO.',
  },
  {
    id: 'kb-platform-guide',
    category: 'PLATFORM_GUIDE',
    title: 'Platform Guide: Dual Accounts (DEMO/REAL), Blockchain Verification, Charts & Reports',
    tags: ['platform', 'how to', 'demo', 'real', 'switch', 'blockchain', 'hash', 'verify', 'charts', 'drawings', 'funds', 'reports', 'etf', 'commodities'],
    content:
      'Use the top-right DEMO / REAL switcher anytime—both accounts start at ₹0.00 and stay strictly isolated. In Funds & Ledger (DEMO), pick any virtual balance from ₹1,000 to ₹1 Crore (resetting archives your old epoch). Use Stocks / Indices & F&O / ETFs / Commodities to watch live prices, inspect 5-level depth, click Chart for TradingView Lightweight Charts (with indicators, drawings, saved layouts & chart trading), or click B / S to open the Order Ticket showing live margin + itemized charges BEFORE confirmation. Every executed trade, fund event, and admin rule approval is sealed on our SHA-256 Proof-of-Work Blockchain—open Blockchain Audit to verify the Merkle Root or any individual block proof. Open P&L & Contract Notes for FIFO Tax P&L, printable Daily Contract Notes, and CSV exports.',
  },
  {
    id: 'kb-commodities-etfs',
    category: 'MARKET_BASICS',
    title: 'Trading Gold, Silver & Crude Oil in India (ETFs vs MCX Derivatives)',
    tags: ['gold', 'silver', 'crude', 'crudeoil', 'natural gas', 'etf', 'goldbees', 'silverbees', 'mcx', 'commodity'],
    content:
      'In India, you can invest in Gold and Silver via NSE/BSE ETFs (like GOLDBEES, SILVERBEES) in CNC delivery with small capital and no expiry. However, Crude Oil, Natural Gas, Copper, and leveraged Gold/Silver contracts do NOT trade as spot ETFs—they trade as MCX Commodity Derivatives (Futures & Options) in the Commodities (MCX) tab with fixed lot sizes, evening trading hours up to 23:30 IST, and CTT (Commodities Transaction Tax).',
  },
];

export const ACADEMY_MODULES: AcademyModule[] = [
  {
    id: 'mod-1-indian-markets',
    level: 'BEGINNER',
    title: 'Module 1: How Indian Markets Work (NSE, BSE, MCX & Order Types)',
    durationMin: 10,
    summary: 'Master exchange timings, Pre-Open, AMO, T+1 settlement, and choosing the right order type.',
    lessons: [
      {
        heading: 'Exchanges & Sessions (IST)',
        body: 'NSE & BSE handle equities, ETFs, and equity derivatives from 09:15 to 15:30 IST (Pre-Open 09:00–09:15). MCX handles commodity futures & options from 09:00 to 23:30 IST.',
        indianExample: 'If you place an equity order at 20:00 IST, mark it as AMO so it queues for the 09:15 IST open—whereas MCX Gold Futures can trade live at 20:00 IST.',
      },
      {
        heading: 'CNC vs MIS vs NRML',
        body: 'CNC (1x cash) is for delivery investing with no short selling. MIS allows intraday long/short with per-stock VaR+ELM margin and 15:15 IST auto square-off. NRML is for overnight F&O and MCX.',
        indianExample: 'Buying 10 shares of RELIANCE @ ₹1,400 in CNC blocks ₹14,000 + charges; in MIS (20% VaR+ELM) it blocks ~₹2,800 margin and must close before 15:15 IST.',
      },
    ],
    quiz: [
      {
        id: 'q1-1',
        question: 'Can you short-sell an equity share in CNC (Delivery) without owning it in India?',
        options: ['Yes, anytime', 'No — SEBI restricts delivery short selling; use MIS intraday instead', 'Only on Fridays', 'Only on BSE'],
        correctIndex: 1,
        explanation: 'Under SEBI rules, short selling in cash equity is permitted intraday (MIS) only, not in CNC delivery.',
      },
      {
        id: 'q1-2',
        question: 'When does Equity/F&O regular trading operate on NSE/BSE?',
        options: ['09:00–17:00 IST', '09:15–15:30 IST', '10:00–16:00 IST', '24x7'],
        correctIndex: 1,
        explanation: 'Regular equity & F&O continuous trading runs 09:15–15:30 IST (with 09:00–09:15 Pre-Open).',
      },
    ],
  },
  {
    id: 'mod-2-charges-and-taxes',
    level: 'BEGINNER',
    title: 'Module 2: Finance Act 2026 Charges, STT & Breakeven Math',
    durationMin: 12,
    summary: 'Understand why gross profits shrink after Brokerage, STT, Exchange Fees, Stamp Duty, DP & GST.',
    lessons: [
      {
        heading: 'Every Statutory Levy Explained',
        body: 'Every trade pays Brokerage, STT/CTT, Exchange Transaction Charges, SEBI Turnover Fee (₹10/Cr), Stamp Duty (Buy side), DP charges (CNC Sell), and 18% GST on services.',
        indianExample: 'Under Finance Act 2026 (effective Apr 1, 2026), Equity Futures sell STT is 0.05% and Options sell premium STT is 0.15%—making overtrading very expensive!',
      },
      {
        heading: 'Indian Tax Heads',
        body: 'CNC Equity profits are STCG (<12 months) or LTCG (≥12 months); MIS Intraday is Speculative Business Income; F&O/MCX is Non-Speculative Business Income.',
        indianExample: 'Open P&L & Contract Notes in your platform to see automatic FIFO STCG/LTCG/Speculative/F&O buckets net of charges.',
      },
    ],
    quiz: [
      {
        id: 'q2-1',
        question: 'Effective April 1, 2026 (Finance Act 2026), what is the STT rate on selling Equity Options premium?',
        options: ['0.025%', '0.05%', '0.10%', '0.15%'],
        correctIndex: 3,
        explanation: 'Finance Act 2026 raised STT on equity options sale premium from 0.10% to 0.15% (and futures sell STT to 0.05%).',
      },
      {
        id: 'q2-2',
        question: 'On which side of a trade is Indian Stamp Duty charged?',
        options: ['Buy side only', 'Sell side only', 'Both Buy and Sell', 'Only on profitable trades'],
        correctIndex: 0,
        explanation: 'Under the Indian Stamp Act, stamp duty is levied strictly on the buy side.',
      },
    ],
  },
  {
    id: 'mod-3-risk-psychology',
    level: 'BEGINNER',
    title: 'Module 3: Position Sizing, 1% Risk Rule & Avoiding Overtrading',
    durationMin: 12,
    summary: 'Learn the exact math professional traders use to survive losing streaks and pass DEMO before REAL.',
    lessons: [
      {
        heading: 'The 1% Risk Position Sizing Formula',
        body: 'Decide your Stop Loss BEFORE clicking Buy. Never risk >1% of account equity on one idea: Qty = Floor((Equity × 1%) / StopLossDistance).',
        indianExample: 'On a ₹1,00,000 DEMO account, 1% risk = ₹1,000. Buying a stock at ₹500 with SL at ₹490 (₹10 risk/share) means max qty = 100 shares.',
      },
      {
        heading: 'Kill Switch & Daily Loss Cap',
        body: 'Revenge trading after 2 consecutive losses causes most retail blowups. Configure Max Daily Loss and use the Kill Switch in Positions & Holdings.',
        indianExample: 'SEBI studies show 9 out of 10 individual F&O traders lose money—mostly from unhedged oversizing and ignoring stop-losses.',
      },
    ],
    quiz: [
      {
        id: 'q3-1',
        question: 'With ₹2,00,000 capital, 1% risk limit (₹2,000), entry ₹1,000, and Stop-Loss ₹980, what is the right quantity?',
        options: ['200 shares', '100 shares', '500 shares', '20 shares'],
        correctIndex: 1,
        explanation: 'Risk per share = ₹20. Max qty = ₹2,000 / ₹20 = 100 shares.',
      },
    ],
  },
  {
    id: 'mod-4-technical-analysis',
    level: 'INTERMEDIATE',
    title: 'Module 4: Reading Charts, Candlesticks, VWAP, EMA, RSI & Supertrend',
    durationMin: 15,
    summary: 'Use your TradingView Lightweight Charts terminal to identify trends, support/resistance, and momentum.',
    lessons: [
      {
        heading: 'Trend vs Mean Reversion',
        body: 'EMA crossovers and Supertrend excel in trending markets but whip-saw in sideways ranges. RSI and Bollinger Bands work best in range-bound conditions.',
        indianExample: 'Open Charts → toggle EMA 50, VWAP, and Volume, then draw Support/Resistance Zones and Fibonacci levels and save your layout.',
      },
    ],
    quiz: [
      {
        id: 'q4-1',
        question: 'What does intraday VWAP represent on an equity chart?',
        options: ['Simple average of last 50 days', 'Volume-weighted average price reset each trading session', 'Option Implied Volatility', 'Exchange circuit limit'],
        correctIndex: 1,
        explanation: 'VWAP weights each bar by traded volume and resets daily at the Indian market open—institutional desks use it as a fair-value benchmark.',
      },
    ],
  },
  {
    id: 'mod-5-fno-mastery',
    level: 'INTERMEDIATE',
    title: 'Module 5: Indian F&O, Option Chain, Greeks & SEBI F&O Rules',
    durationMin: 18,
    summary: 'Master Calls/Puts, Delta/Theta/Vega, Hedged Spreads, and SEBI weekly-expiry & margin rules.',
    lessons: [
      {
        heading: 'Why Option Buyers Lose Even When Right on Direction',
        body: 'Theta decays option value every day, and IV crush after events shrinks premiums. Hedged spreads (Bull Call Spread, Iron Condor) cap risk and reduce SPAN margin.',
        indianExample: 'Open Option Chain → load a Bull Call Spread in the Strategy Builder and inspect how hedged margin drops vs unhedged margin (except calendar spreads on expiry day!).',
      },
    ],
    quiz: [
      {
        id: 'q5-1',
        question: 'Under SEBI F&O rules, which NSE index is permitted to have weekly options expiries?',
        options: ['All NSE indices', 'Only NIFTY 50 (one benchmark index per exchange)', 'Only BANKNIFTY', 'None'],
        correctIndex: 1,
        explanation: 'SEBI Circular SEBI/HO/MRD/TPD/P/CIR/2024/132 limits weekly options to one benchmark index per exchange (NIFTY on NSE, SENSEX on BSE).',
      },
    ],
  },
  {
    id: 'mod-6-systematic-backtesting',
    level: 'PRO',
    title: 'Module 6: Systematic Strategy Design, Honest Backtesting & Demo-to-Real',
    durationMin: 15,
    summary: 'Eliminate look-ahead bias, measure Sharpe/Drawdown/Fee Drag, and validate edge in DEMO before risking REAL capital.',
    lessons: [
      {
        heading: 'Why Honest Backtesting Saves Capital',
        body: 'Always execute signals on the next bar open, include realistic slippage (5+ bps) and full Indian statutory charges, and test across multiple market regimes before trading live.',
        indianExample: 'In Strategy Lab & Backtest, compare Net Return vs Gross Return and check Fee Drag %—a strategy making 15% gross that loses 12% to STT/brokerage needs fewer, higher-quality setups.',
      },
    ],
    quiz: [
      {
        id: 'q6-1',
        question: 'Why must a signal generated at Bar i close execute at Bar i+1 open in a backtest?',
        options: ['To make the code slower', 'To eliminate look-ahead bias because you cannot trade at a close price after seeing it close', 'Only for MCX commodities', 'To reduce STT'],
        correctIndex: 1,
        explanation: 'Evaluating indicators on bar i close and filling at bar i close is look-ahead bias; realistic execution happens at bar i+1 open plus slippage.',
      },
    ],
  },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+%\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** Pure local BM25/TF-IDF-style knowledge retriever (works 100% offline on CPU). */
export function retrieveKnowledge(query: string, topK = 3): Array<{ doc: KnowledgeDoc; score: number }> {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scored = KNOWLEDGE_DOCS.map((doc) => {
    const titleTokens = new Set(tokenize(doc.title));
    const tagSet = new Set(doc.tags.flatMap((t) => tokenize(t)));
    const bodyTokens = tokenize(doc.content);
    const bodyFreq = new Map<string, number>();
    for (const t of bodyTokens) bodyFreq.set(t, (bodyFreq.get(t) ?? 0) + 1);

    let score = 0;
    for (const qt of qTokens) {
      if (tagSet.has(qt)) score += 5;
      if (titleTokens.has(qt)) score += 3.5;
      const bf = bodyFreq.get(qt) ?? 0;
      if (bf > 0) score += Math.min(3, bf * 1.2);
    }
    return { doc, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}
