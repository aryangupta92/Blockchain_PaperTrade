# Changelog

All notable changes are documented per build phase.

## [1.1.0] — Strategy Lab & Zero-Bias Backtester, AI Trading Coach & Beginner Academy, and QLoRA Model Training Kit
- **Visual Strategy Builder & Institutional Zero-Look-Ahead Backtesting Engine** (`packages/shared/src/backtester.ts`, `/api/v1/strategies/*`, `StrategyLabPage.tsx`):
  - No-code visual Entry/Exit condition builder supporting `SMA`, `EMA`, `VWAP`, `RSI`, `MACD`, `Bollinger Bands`, `Supertrend`, `Volume`, and 5 built-in Indian market templates.
  - Strict zero-look-ahead execution: causal indicators evaluated on bar `i`, filled strictly at bar `i+1` open + slippage (bps), honest gap SL fills, conservative SL-before-Target intrabar tie-break, trailing stop-loss ratchet for next bar, CNC short-sell ban enforcement, MIS `15:15 IST` forced square-off, and exact effective-dated Indian statutory charges (`calculateTradeCharges`, Finance Act 2026 & historical schedules) on every trade.
  - Institutional metrics: Net Return vs Buy-and-Hold benchmark, CAGR, Max Drawdown (₹ / % / duration), Sharpe, Sortino, Calmar, Profit Factor, Expectancy, Fee Drag %, SVG equity curve, saved strategies & runs in Prisma, and Live Signal Scanner with 1-click DEMO order handoff.
- **SEBI-Compliant AI Trading Coach & Indian Market Beginner Academy** (`apps/api/src/services/coach/*`, `/api/v1/coach/*`, `AiCoachPage.tsx`):
  - Interactive Q&A Coach with hard pre-LLM SEBI IA/RA investment-advice refusal guardrail (`detectInvestmentAdviceRequest`), grounded Indian Market & Platform RAG knowledge base (`local-rag` default on CPU), plus seamless `ollama` (custom fine-tuned model) and `gemini` provider adapters via `.env`.
  - 6-Module Beginner-to-Pro Indian Market Curriculum with real INR examples and Prisma-persisted interactive quizzes.
  - 5 Hands-On DEMO Practice Missions automatically verified against the user's live database state.
  - Personal Trade Behavior Diagnostics & 0–100 DEMO→REAL Readiness Scorecard (Win Rate, Reward:Risk, Charges Drag %, Stop-Loss usage %, Overtrading & Revenge-Trading alerts).
- **Custom Model Training Kit (`platform/ml/`)** (zero local GPU required):
  - `generate_dataset.py` curating SEBI-compliant ChatML `train.jsonl` & `eval.jsonl` with automated zero-provider-leak enforcement.
  - `train_qlora_colab.py` for 4-bit QLoRA fine-tuning (`Qwen2.5-3B/7B-Instruct`, Unsloth + Transformers/PEFT fallback) on free Google Colab T4 (16 GB VRAM) with `Q4_K_M` GGUF export.
  - `Modelfile` + `evaluate_model.py` compliance suite for local CPU serving via Ollama (`AI_COACH_PROVIDER=ollama`).

## [1.0.0] — Phase 8: Regulatory Watch, Admin Governance, DPDP Rights, Security Hardening & Final Audit
- Built **Regulatory Watch** pipeline (`regulatoryWatchService.ts`, `/api/v1/regulatory/*`): daily official-source monitor (`07:30 IST`) creating `DRAFT` effective-dated config entries for Admin review (never auto-applied).
- Built RBAC-protected Admin approval flow sealing approved regulatory updates onto the **SHA-256 Blockchain (`REGULATORY_CONFIG_APPROVAL`)** and publishing them to the user-facing **"What's Changed"** notice feed + Audit Log.
- Added **DPDP Act (India)** personal data & risk-disclosure consent export (`GET /api/v1/regulatory/dpdp-export`).
- Hardened Fastify security (1 MB payload limit, CSRF Origin validation on mutating cookie requests in production, Helmet headers, vendor bundle code-splitting in Vite).
- Completed full **OpenAPI 3.1** specification (`docs/openapi.yaml`) and verified 50-request concurrent load + zero-provider-leak audit across API and frontend production bundles.

## [0.8.0] — Phase 7: REAL Funding Gateway, Pluggable Broker Adapter, Daily Contract Notes, FIFO Tax P&L & CSV Exports
- Built `PaymentGatewayAdapter` abstraction (`MockPaymentGatewayAdapter` supporting UPI & NetBanking) + REAL account deposit & **SEBI T+1 settlement-aware withdrawal** endpoints (`/api/v1/accounts/real/deposit`, `/withdraw`, `/funding-summary`) sealing every fund movement onto the SHA-256 Blockchain ledger.
- Built full pluggable `RealBrokerAdapter` interface (`MockRealBrokerAdapter`) with explicit SEBI Stock Broker / Clearing / DP / KYC / Licensing compliance checklist surfaced in both API and UI.
- Built broker-grade **Daily Contract Notes** (`/api/v1/reports/:mode/contract-notes`, printable), **FIFO Realized & Indian Tax-Ready P&L Engine** (`/api/v1/reports/:mode/tax-pnl` classifying STCG, LTCG, Speculative Intraday, Non-Speculative F&O/MCX + ICAI Turnover net of statutory charges), and **CSV Exporters** (`trades`, `ledger`, `tax-pnl`).
- Built `ReportsPage.tsx` and upgraded `FundsPage.tsx` with live REAL UPI/NetBanking deposit & settlement-aware withdrawal flows.

## [0.7.0] — Phase 6: ETFs Discovery, MCX Commodities Derivatives & Live Sector Heatmap / Movers
- Built categorized NSE/BSE **ETFs Catalog** (`GET /api/v1/segments/etfs`, `EtfsPage.tsx`) spanning Gold, Silver, Nifty/Bank Nifty Index, Sectoral, and Liquid/Debt ETFs with one-click CNC/MIS trading & charting.
- Built **MCX Commodities Derivatives Explorer** (`GET /api/v1/segments/commodities`, `CommoditiesPage.tsx`) dynamically surfacing active Bullion, Energy (Crude Oil / Natural Gas), and Base Metal Futures & Options with exact MCX lot sizes, tick sizes, evening trading hours (`09:00–23:30 IST`), CTT calculation, and Indian commodity regulation note.
- Built live **Market Overview Analytics** (`GET /api/v1/segments/analytics`): 8-sector NSE Heatmap, Top Gainers, Top Losers, and Most Active by volume computed strictly from the single primary market data feed (zero secondary feeds).

## [0.6.0] — Phase 5: F&O Suite — Live Option Chain, Multi-Leg Strategy Builder, Hedge Margins & Expiry Auto-Exercise
- Built dynamic live Index & Stock F&O underlying discovery (`GET /api/v1/fno/underlyings`) from the daily scrip master with SEBI weekly-expiry index compliance (`NIFTY` on NSE, `SENSEX` on BSE) and F&O Ban flagging.
- Built enriched Option Chain endpoint (`GET /api/v1/fno/chain`) joining live Greeks, IV, OI, ΔOI, PCR, and Max Pain with exact contract `tradingSymbol`, `instrumentId`, and `lotSize` for one-click trading and one-click strike charting.
- Built pure TypeScript Multi-Leg Strategy Payoff & SEBI Hedge-Margin Engine (`strategyPayoff.ts`) enforcing SEBI Circular `SEBI/HO/MRD/TPD/P/CIR/2024/132` (100% upfront option premium, expiry-day calendar spread benefit removal, +2% short option expiry ELM) plus Finance Act 2026 combined charges.
- Built atomic Multi-Leg Basket Execution (`POST /api/v1/fno/basket`, BUY legs routed before SELL legs) and ITM Option Auto-Exercise / Assignment Expiry Settlement (`POST /api/v1/fno/expiry/settle`, applying Finance Act 2026 0.15% exercised-option STT and SHA-256 Blockchain sealing).
- Built interactive Option Chain + Strategy Builder + SVG Expiry Payoff Chart UI (`OptionChainPage.tsx`) with preset strategy templates (Long Straddle, Short Strangle, Bull Call Spread, Iron Condor).

## [0.5.0] — Phase 4: TradingView Lightweight Charts Terminal, Indicators, Drawings, Layouts & Chart Trading
- Built pure TypeScript Technical Indicator & Heikin Ashi engine (`SMA`, `EMA`, `VWAP`, `Bollinger Bands`, `Supertrend`, `RSI 14`, `MACD 12/26/9`, `Volume`, `OI`) with unit test coverage in `@broker/shared`.
- Built swappable `ChartProvider` implementation (`TradingChartPane.tsx`) powered by TradingView Lightweight Charts (Apache 2.0 with required attribution): smooth pan/zoom, multi-timeframe (`1m–1W`), chart types (Candles, Heikin Ashi, Bars, Line, Area), Normal/Log/% scales, symbol comparison, real-time WebSocket candle updates, and synchronized RSI/MACD sub-panes.
- Implemented interactive drawing tools (`Horizontal Line`, `Vertical Line`, `Trendline`, `Support/Resistance Zone`, `Fibonacci Retracement`, `Price/Time Range Measure`) synchronized with chart pan/zoom.
- Implemented Chart Trading overlays (live Position average-price line + resting Open/SL Order lines + one-click BUY/SELL buttons) and 2-Chart Split View.
- Added Prisma-persisted per-user Chart Layout & Template API (`/api/v1/charts/layouts`) and one-click Chart open from every Watchlist row.

## [0.4.0] — Phase 3: Unified OMS, SEBI Risk/Margin Engine, Equity CNC/MIS Trading, Auto Square-Off & Blockchain-Sealed Trades
- Built unified idempotent OMS (`omsService.ts`) with common `ExecutionEngine` interface (`DemoExecutionEngine` depth/LTP fill simulator + `MockRealExecutionBroker` adapter).
- Built SEBI Risk & Margin Engine (`riskMarginEngine.ts`): per-instrument dynamic VaR+ELM (no hardcoded flat 5x), CNC delivery no-short-selling enforcement + T+1 settlement & BTST warnings, tick-size & lot-size checks, circuit price-band limits, freeze-qty slicing calculation, F&O ban check, expiry-day +2% short option ELM, market hours & AMO validation, Kill Switch, Max Daily Loss, and Max Order Value.
- Wired Finance Act 2026 line-by-line statutory charges + double-entry ledger updates + **SHA-256 Proof-of-Work Blockchain sealing** on every executed trade across both DEMO and REAL accounts.
- Built tick-driven resting order monitor (`LIMIT / SL / SL_M / GTT`), Super Order trailing stop-loss ratchet (`trailingJump`), MIS auto square-off scheduler (`15:15 IST`), MIS → CNC delivery conversion, and one-click Exit All.
- Built Web Terminal Order Ticket Modal (with live pre-trade margin & itemized charges breakdown), Orders & Trades Book (with Blockchain proof links), and live Positions & Holdings page.

## [0.3.0] — Phase 2: Single-Provider, Provider-Neutral Market Data Layer & Live Terminal
- Built single-source `MarketDataProvider` adapter with token-bucket rate limiting, 429 circuit breaker, in-memory TTL cache (Redis-ready), and zero secondary/fallback feeds.
- Implemented daily Scrip Master downloader & fast multi-segment search across NSE/BSE Equity, Indices, F&O contracts, ETFs, and MCX Commodities (scheduled refresh at 08:30 IST).
- Built binary WebSocket live feed decoder (Ticker, Quote, OI, PrevClose, Full 5-level depth) + **20-level L3 Market Depth** binary socket + tick sanity filter (drops corrupt prints) + heartbeat & exponential backoff.
- Exposed all provider capabilities through neutral `/api/v1/market/*` endpoints and `/ws/market` multiplexed WebSocket fan-out: live quotes, 5/20-level depth, daily/intraday candles, expired/rolling options data, live option chain with Greeks/IV/OI/PCR/Max Pain, live SPAN margin calculator, and OAuth/TOTP session management.
- Built IST Market Session Engine (Pre-Open, Open, Post-Close, Weekend, Holiday, and MCX evening hours).
- Built Live Market Overview & Segment Watchlists UI (`Stocks | Indices & F&O | ETFs | Commodities`) with WebSocket streaming, global instrument search, and 5-level depth panel.

## [0.2.0] — Phase 1: Auth, 2FA (TOTP), Dual Accounts (DEMO/REAL), Double-Entry Ledger & Blockchain Explorer
- Added secure auth (`scrypt` salted passwords, RFC 7519 HS256 JWT access tokens + httpOnly refresh cookies, AES-256-GCM secret encryption, RFC 6238 TOTP 2FA setup & login enforcement, SEBI risk disclosure gate, audit logging).
- Provisioned BOTH `DEMO` and `REAL` trading accounts starting at `₹0.00` on user registration with strict isolation.
- Built server-validated DEMO virtual balance set/reset (`₹1,000` to `₹1,00,00,000`) with automatic epoch archival (`DemoResetArchive`), double-entry `LedgerEntry` tracking, and SHA-256 Proof-of-Work blockchain sealing.
- Added Blockchain Audit API (`/api/v1/blockchain/verify`, `/blocks`, `/blocks/:hash`) and interactive Web Terminal UI for Auth, Account Switcher, Funds & Ledger, Blockchain Proof Explorer, and Settings/2FA/Regulatory Rules.
- Verified primary Market Data subscription (`Data Plan Active` + Equity/Derivatives/Currency/MCX segments + live quotes) via server-side environment token.

## [0.1.0] — Phase 0: Foundation, Config System, Charges, Blockchain Verifier & Design System
- Scaffolded clean TypeScript monorepo (`packages/shared`, `apps/api`, `apps/web`).
- Implemented strict decimal arithmetic (`decimal.js`) for all financial calculations.
- Built effective-dated SEBI/exchange regulatory configuration (`RULES.md` + `COMPLIANCE.md`), including Finance Act 2026 STT rates (effective April 1, 2026) and SEBI F&O framework rules.
- Implemented line-by-line statutory **Charges Engine** (Brokerage, STT/CTT, Exchange Transaction Charges, SEBI Turnover Fee, Stamp Duty, GST, DP Charges) with worked-example unit tests across Equity Delivery, Intraday, Futures, Options (sell & exercise), ETFs, and MCX Commodities.
- Implemented **Blockchain Ledger Verification** (`LedgerChain` SHA-256 Proof-of-Work hash chain + Merkle root + tamper detection + `contracts/TradeRegistry.sol`) with full unit test coverage.
- Created Prisma schema for dual accounts (DEMO/REAL), double-entry ledger, blockchain blocks, OMS, holdings/positions, charges breakdowns, and effective-dated regulatory configs.
- Built Fastify API bootstrap with Zod environment validation, security headers, rate limiting, and provider-anonymity response sanitizer.
- Built React 19 + TypeScript trading terminal shell & design system (DEMO vs REAL theme switcher, segment navigation, SEBI risk disclosure banner, live API & regulatory config status).
- Added Docker Compose (PostgreSQL 16 + Redis 7), GitHub Actions CI, and OpenAPI 3.1 spec.
