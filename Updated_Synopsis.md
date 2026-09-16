# Project Synopsis: AI-Powered Paper Trading & Behavioral Analytics Platform (Indian Market Edition)

## 1. Introduction
With the exponential rise of retail participation in the Indian stock market (NSE/BSE), millions of new investors are trading without access to institutional-grade risk management tools. This project is an advanced, AI-driven extension of a Blockchain-based Paper Trading platform, specifically tailored for the Indian equity and derivatives market. It aims to bridge the gap between amateur speculation and disciplined, data-driven trading through a suite of intelligent, interconnected modules.

## 2. Problem Statement
Retail traders in India face several critical challenges:
1. **Lack of Risk Awareness:** Buying stocks based on tips without understanding portfolio correlation (e.g., overexposure to Bank Nifty or specific sectors like PSUs).
2. **Behavioral Biases:** High failure rates (especially in F&O) due to psychological errors like revenge trading, FOMO (Fear of Missing Out), and a lack of disciplined trade journaling.
3. **Flawed Strategies:** Relying on backtests that ignore Indian market realities like Securities Transaction Tax (STT), high brokerage charges, slippage, and specific market regimes.

## 3. Unified Goal & Core Philosophy
The core goal of this platform is to create a **Comprehensive AI-Driven Feedback Loop** that transitions users from speculative gambling to disciplined, data-backed trading. Rather than existing as isolated features, the three core modules are deeply connected to form a continuous cycle of improvement:
*   **Plan & Validate (Module 3):** Before risking capital, users test their trading strategies against real-world Indian market constraints using AI-assisted backtesting.
*   **Execute & Monitor (Module 1):** As users execute their validated strategies in the paper trading environment, the AI continuously monitors their live portfolio for hidden risks, sector overexposure, and macroeconomic threats.
*   **Reflect & Correct (Module 2):** Post-trade, users log their decisions. The AI trade coach analyzes these entries, identifies destructive psychological biases, and feeds behavioral insights back to the user, refining their future strategy planning.

## 4. Proposed Solution & Core Modules (Implementation)

### Module 1: AI-Powered Portfolio Risk Advisor
*   **Concept:** Continuously evaluates a user's simulated portfolio to uncover hidden risks and sector correlations.
*   **Indian Context:** Analyzes correlation against benchmark indices (Nifty 50, Sensex). Flags sector concentration (e.g., holding too many IT or Banking stocks). Simulates "what-if" scenarios (e.g., "What if the RBI hikes repo rates?").
*   **Implementation:** 
    *   The system fetches real-time portfolio holdings from the database.
    *   A Python-based risk engine calculates beta and correlation metrics using historical NSE/BSE data.
    *   The AI model processes these statistical metrics to generate plain-language risk warnings and actionable diversification suggestions directly on the user's dashboard.

### Module 2: Explainable AI Trade-Journal & Bias Coach
*   **Concept:** A psychological coach for traders that identifies destructive trading patterns based on their logged activities.
*   **Indian Context:** Users log the reasoning behind their paper trades. The AI tracks patterns and flags behavioral mistakes typical of Indian retail traders (e.g., "You consistently average down on losing mid-cap stocks, which historically leads to deeper drawdowns").
*   **Implementation:**
    *   Provides a structured UI for users to log entry/exit rationales, confidence levels, and emotional states for every trade.
    *   The AI model ingests these textual logs alongside the actual financial outcomes of the trades.
    *   It generates a personalized "Trader Persona" report, highlighting recurring biases (e.g., revenge trading, over-leveraging) and suggests concrete, psychological rules to mitigate them.

### Module 3: AI-Assisted Backtesting & Strategy Validator
*   **Concept:** Stress-tests user-defined trading strategies with institutional rigor.
*   **Indian Context:** Validates strategies by factoring in Indian market specifics: STT (Securities Transaction Tax), exchange transaction charges, stamp duty, and liquidity in specific options contracts. Prevents overfitting on historical Nifty data.
*   **Implementation:**
    *   Users define entry and exit criteria via a guided interface.
    *   The backend engine runs the backtest against historical Indian market data, automatically applying realistic tax and brokerage deduction models.
    *   The AI model generates a detailed "Validation Report," explaining in plain English why a strategy might fail in real market conditions despite looking profitable on paper (e.g., highlighting that high-frequency scalping profits are eaten by STT).

## 5. Technology Stack
*   **Frontend:** React.js (for a responsive, component-driven user interface).
*   **Backend:** Node.js / Express (for user authentication and core API routing) integrated with Python / FastAPI (for heavy data processing, statistical calculations, and AI model orchestration).
*   **Database:** MongoDB (for storing trade journals, user portfolios, and application state).
*   **AI/ML Model:** **Google Gemini 3.1 Pro** (Primary Large Language Model used for natural language understanding, generating explainable risk reports, analyzing trade journals for behavioral biases, and providing conversational insights on backtest results).
*   **Market Data Integration:** APIs providing reliable NSE/BSE data (e.g., Upstox API or Kite Connect).
*   **Blockchain Integration (Existing Base):** Leveraging the existing blockchain architecture for immutable ledgering of paper trades, ensuring verifiable and tamper-proof track records.

## 6. Functional Requirements
*   **User Authentication & Authorization:** Secure registration and login functionalities.
*   **Live Portfolio Tracking:** Dashboard displaying current paper holdings, P&L, and historical equity curves.
*   **Risk Engine Execution:** Ability to manually trigger or schedule daily AI portfolio risk assessments.
*   **Journal Entry Management:** Interface to create, read, update, and delete trade journal entries linked to specific paper trades.
*   **Bias Detection Reports:** Generation of behavioral analysis reports after a minimum threshold of journal entries is reached.
*   **Backtest Configuration & Execution:** Interface to input trading rules, date ranges, and capital, followed by the execution of the backtest simulation incorporating Indian taxation logic.

## 7. Non-Functional Requirements
*   **Performance:** Risk analysis and backtesting reports should be generated within a reasonable timeframe (e.g., under 10 seconds).
*   **Scalability:** The architecture must support concurrent backtesting requests without degrading overall system responsiveness, utilizing background task queues.
*   **Reliability & Availability:** The platform should maintain high uptime (99.9%) to ensure users can access their portfolios during market hours.
*   **Security:** Sensitive user data and API keys must be securely encrypted. The blockchain ledger must remain immutable and protected against tampering.
*   **Usability:** The interface must be intuitive, minimizing the learning curve for novice traders, and fully responsive across mobile and desktop devices.

## 8. Future Scope & Vision
*   **B2B Licensing:** Offering the risk and behavioral coaching modules to smaller Indian wealth management firms or sub-brokers who cannot afford expensive terminal software.
*   **Automated Robo-Advisory:** Evolving the platform to automatically suggest rebalancing of paper portfolios based on user-defined risk profiles and Indian macroeconomic indicators.
*   **Strategy Marketplace:** Creating a community-driven ecosystem where users can share, verify via blockchain, and rate AI-validated trading strategies specific to the Indian market.

---

## 9. Implementation Status

This section documents the actual build progress against the three core modules defined above.

### ✅ Module 1: AI-Powered Portfolio Risk Advisor — COMPLETE

| Layer | File | Description |
|-------|------|-------------|
| Backend | `server/routes/ai.js` — `POST /api/ai/portfolio-risk` | Fetches live holdings from DB, builds Indian-market-aware prompt, calls Gemini 1.5 Flash, returns structured Markdown risk report |
| Frontend | `client/src/components/RiskAdvisor/RiskAdvisorPage.jsx` | Sector concentration heatmap, portfolio vital signs, AI risk report rendered with ReactMarkdown, refresh button |
| Styles | `client/src/components/RiskAdvisor/RiskAdvisor.css` | Full dark-mode styling with heatmap bars and skeleton loader |
| API | `client/src/services/api.js` — `getAIPortfolioRisk()` | Thin fetch wrapper to the backend endpoint |
| Routing | `client/src/App.jsx` — key `risk` | Wired to `RiskAdvisorPage` and accessible from sidebar |
| Navigation | `client/src/components/BrokerShell/Sidebar.jsx` | "Risk Advisor" item with `AI` badge under PORTFOLIO section |

**What the AI analyses:** Sector over-concentration, benchmark correlation (Nifty 50/Sensex), "what-if" RBI rate hike scenarios, diversification suggestions — all in plain English Markdown.

---

### ✅ Module 2: Explainable AI Trade-Journal & Bias Coach — COMPLETE

| Layer | File | Description |
|-------|------|-------------|
| Backend | `server/routes/ai.js` — `POST /api/ai/journal-coach` | Per-entry AI feedback: structured prompt with emotions, R:R, mistakes → Gemini → punchy Markdown coaching |
| Backend | `server/routes/ai.js` — `POST /api/ai/bias-coach` | Analyses last 10 journal entries, returns JSON `{biases, strengths, recommendations}` — behavioral pattern detection |
| Backend | `server/routes/journal.js` | Full CRUD for `TradeJournal` model (title, setup, thesis, mistakes, learnings, emotionOnEntry, emotionOnExit, marketCondition, R:R planned/actual, rating) |
| Frontend | `client/src/components/Journal/JournalPage.jsx` | New-entry modal, per-entry "Ask AI Coach" button, AI Bias Coach panel showing biases/strengths/recommendations in 3-column grid |
| API | `client/src/services/api.js` — `getJournalFeedback()`, `getAIBiasCoach()` | Fetch wrappers |
| Navigation | `client/src/components/BrokerShell/Sidebar.jsx` | "Trade Journal" item with `AI` badge |

**Behavioral biases detected:** FOMO, revenge trading, cutting winners early, averaging down losers, over-leveraging in F&O, failure to follow pre-defined stop-losses.

---

### ✅ Module 3: AI-Assisted Backtesting & Strategy Validator — COMPLETE

| Layer | File | Description |
|-------|------|-------------|
| Backend | `server/routes/backtest.js` — `POST /api/backtest/run` | Full Indian-market backtesting engine with realistic cost model |
| Backend Cost Model | `server/routes/backtest.js` — `calculateIndianCosts()` | Computes STT, exchange transaction charges, SEBI fees, GST, brokerage, and stamp duty for all four instrument types (Equity Delivery, Equity Intraday, F&O Futures, F&O Options) |
| Backend Slippage | `server/routes/backtest.js` — `applySlippage()` | Adjusts fill prices for bid-ask spread and market impact |
| Backend Signal Engine | `server/routes/backtest.js` — `generateSignals()` | Interprets plain-English entry/exit rules into SMA crossover, RSI, and breakout signals |
| Backend AI Validator | `server/routes/ai.js` — `POST /api/ai/validate-strategy` | Sends strategy + backtest results to Gemini for an institutional-grade validation report covering edge, Indian cost reality, overfitting flags, and a PASS/FAIL verdict |
| Frontend | `client/src/components/Backtest/BacktestPage.jsx` | 2-step UI: (1) Config with presets, strategy form, risk params, Indian cost settings → (2) Results with KPI dashboard, SVG equity curve, trade log table, AI validation panel |
| Frontend | `client/src/components/Backtest/BacktestPage.css` | Full dark-mode styling |
| API | `client/src/services/api.js` — `runBacktest()`, `validateStrategy()` | Fetch wrappers |
| Routing | `client/src/App.jsx` — key `backtest` | Wired to `BacktestPage` |
| Navigation | `client/src/components/BrokerShell/Sidebar.jsx` | "Backtester" item with `AI` badge under PORTFOLIO section |

**Performance metrics computed:** Total return %, win rate, profit factor, max drawdown, avg win/loss, cost drag % on gross P&L, final balance vs. initial capital.

**Indian cost charges applied per trade:**

| Charge | Equity Delivery | Equity Intraday | F&O Futures | F&O Options |
|--------|----------------|-----------------|-------------|-------------|
| STT | 0.1% both sides | 0.025% sell | 0.01% sell | 0.05% sell |
| Brokerage | ≤₹20 (0.03%) | ≤₹20 (0.03%) | ₹20 flat | ₹20 flat |
| Exchange Tx | 0.00345% | 0.00345% | 0.00235% | 0.053% |
| Stamp Duty | 0.015% buy | 0.003% buy | 0.002% buy | 0.003% buy |
| GST | 18% on brokerage+charges | same | same | same |

---

### Platform Architecture (As-Built)

```
┌─────────────────────────────────────────────────────┐
│                  React Frontend                     │
│  Market │ Terminal │ Risk Advisor │ Journal │        │
│  Portfolio │ Screener │ Backtester │ Orders  │       │
└────────────────────┬────────────────────────────────┘
                     │ REST + WebSocket
┌────────────────────▼────────────────────────────────┐
│              Node.js / Express Backend              │
│  /api/market  /api/trades   /api/ai                 │
│  /api/journal /api/backtest /api/options            │
│  /api/portfolio /api/auth   /api/subscription       │
└────────────────┬────────────────┬───────────────────┘
                 │                │
    ┌────────────▼──┐    ┌────────▼──────────┐
    │  SQLite/Prisma│    │  Google Gemini AI  │
    │  (trades,     │    │  (portfolio risk,  │
    │  holdings,    │    │  bias coaching,    │
    │  journal,     │    │  strategy          │
    │  users)       │    │  validation)       │
    └───────────────┘    └───────────────────┘
         │
    ┌────▼──────────────────────┐
    │  Custom Blockchain Layer  │
    │  (immutable trade ledger) │
    └───────────────────────────┘
```

