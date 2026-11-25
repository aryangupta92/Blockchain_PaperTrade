<p align="center">
  <img src="./frontend/public/logo.svg" alt="BlockTrade Logo" width="320" />
</p>

# BlockTrade — Indian Stock Broker Platform (DEMO + REAL + Blockchain Audit)

A SEBI-compliant, full-stack Indian market trading platform (**NSE / BSE / MCX**) built in TypeScript where every user owns **two strictly isolated trading accounts** — **DEMO** (virtual funds ₹1,000–₹1,00,00,000 with reset archival) and **REAL** (deposited funds via payment gateway adapter, starting at ₹0.00) — sharing one unified OMS, SEBI risk/margin engine, Finance Act 2026 charges engine, TradingView-class charting, Regulatory Watch governance, Strategy Lab, AI Trading Coach, and **cryptographic SHA-256 Proof-of-Work blockchain trade & ledger verification**.

---

## Project Layout

| Directory | Responsibility |
| --- | --- |
| `shared-engine/` | Pure TypeScript domain core (`@broker/shared`): decimal math, SEBI regulatory config, Finance Act 2026 tax & charges, SHA-256 blockchain ledger, technical indicators, F&O payoff analyzer, zero-look-ahead strategy backtester |
| `backend/` | Fastify REST + WebSocket API (`@broker/api`), Prisma ORM, single-source market data engine, unified trading OMS, AI Coach & Beginner Academy, SHA-256 chain persistence |
| `frontend/` | React 19 + Vite trading terminal (`@broker/web`): Market Watch, TradingView Lightweight Charts, Option Chain & Strategy Analyzer, Strategy Lab & Backtester, AI Coach & Academy, Portfolio/Reports, Blockchain Explorer |
| `ai-coach-training/` | No-local-GPU QLoRA fine-tuning pipeline for Google Colab T4 + local CPU Ollama deployment (`build_sebi_coach_dataset.py`, `finetune_coach_qlora_colab.py`, `BlockTrade_AI_Coach_Colab_T4.ipynb`, `evaluate_coach_compliance.py`, `Modelfile`) |
| `contracts/` | `TradeRegistry.sol` optional on-chain Merkle-root anchoring contract |
| `docs/` | [COMPLIANCE.md](./docs/COMPLIANCE.md), [RULES.md](./docs/RULES.md), [openapi.yaml](./docs/openapi.yaml), [CHANGELOG.md](./docs/CHANGELOG.md) |

---

## Key Modules Implemented
- **Dual Zero-Start Accounts & Security:** `scrypt` salted hashes, HS256 JWT + `HttpOnly` refresh cookies, AES-256-GCM encrypted RFC 6238 TOTP 2FA, SEBI Risk Disclosure gate, isolated DEMO (₹1,000–₹1,00,00,000 with epoch archival) and REAL accounts, double-entry ledger, and SHA-256 Blockchain Proof Explorer.
- **Single-Source Market Data:** Daily scrip master (NSE/BSE/MCX), token-bucket rate limiter + 429 circuit breaker, binary live feed + 20-level L3 depth socket, `/ws/market` multiplexed fan-out, IST Equity/F&O & MCX sessions, and 8-sector analytics.
- **Unified OMS & SEBI Risk Engine:** Per-scrip VaR+ELM margins, Equity CNC (no short selling, T+1 holdings, DP charge, Pledge/MTF) & MIS (`15:15 IST` auto square-off, MIS → CNC conversion), Super Orders (3-leg OCO + Trailing SL), GTT/Baskets/SIPs/Iceberg/AMO, Kill Switch, Exit All, and Blockchain sealing.
- **TradingView Lightweight Charts & F&O Suite:** 8 timeframes, Heikin Ashi, SMA/EMA/VWAP/Bollinger/Supertrend/RSI/MACD, interactive drawings, saved layouts, live Option Chain with Greeks/PCR/Max Pain, Multi-Leg Strategy Payoff Analyzer, BUY-first baskets, and ITM auto-exercise settlement.
- **Strategy Lab & Zero-Bias Backtester:** Visual no-code rule builder, 5 starter templates, strict next-bar-open fills, gap SL slippage, conservative SL-before-Target tie-break, MIS `15:15 IST` square-off, exact effective-dated Indian statutory charges, Sharpe/Sortino/Calmar/MaxDD/Fee Drag KPIs, and Live Signal Scanner.
- **AI Trading Coach & Beginner Academy:** SEBI-compliant Q&A coach (`local-rag` default on CPU, pluggable `ollama` & `gemini`), 6-module Indian Market Academy with persisted quizzes, 5 DB-verified DEMO Practice Missions, and Personal Trade Diagnostics + 0–100 DEMO→REAL Readiness Score.

---

## Quick Start

```bash
npm install
cp .env.example .env   # Configure server-side credentials
npm run db:generate
npm run db:push
npm run typecheck
npm test
npm run build

# Run API (http://localhost:5100) and Web Terminal (http://localhost:5174)
npm run dev:api
npm run dev:web
```

## Documentation
- [COMPLIANCE.md](./docs/COMPLIANCE.md) — SEBI rules, citations, mandatory risk disclosures & going-live broker licensing checklist
- [RULES.md](./docs/RULES.md) — Effective-dated tax, fee, margin, and expiry configuration map
- [docs/openapi.yaml](./docs/openapi.yaml) — Complete OpenAPI 3.1 REST specification
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) — Phase-by-phase build log
- [ai-coach-training/README.md](./ai-coach-training/README.md) — Custom QLoRA LLM fine-tuning & Ollama deployment guide
