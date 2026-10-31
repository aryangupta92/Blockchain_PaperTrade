# BlockTrade - System Design

Paper-trading platform for Indian markets (NSE/BSE) with a broker-style terminal,
real-time market data, portfolio/order management, option-chain tooling, AI
analytics, and an optional blockchain trade ledger.

---

## 1. Goals and Non-Goals

### Goals
- Broker-parity trading UX: watchlists, quote header, charts, market depth,
  positions, orders, holdings, funds.
- Real market data only. When a source is unavailable the UI must say so; it must
  never render a fabricated price as if it were live.
- Deterministic paper execution with full transaction-cost modelling.
- Low-latency quote updates over WebSocket, with REST as the fallback.
- Clear provider abstraction so DhanHQ, Yahoo and future feeds are swappable.

### Non-Goals (current scope)
- Real-money order routing to a broker.
- Tick-by-tick exchange-grade co-location latency.
- Multi-tenant deployment hardening (this is a single-instance demo/learning app).

---

## 2. High-Level Architecture

```
+--------------------+        REST /api/*          +---------------------------+
|  React SPA (Vite)  | <--------------------------> |  Express API (server.js)  |
|  client/src        |                              |  routes/*                 |
|                    | <==== socket.io quotes ====  |  services/websocketService|
+--------------------+                              +-------------+-------------+
                                                                  |
                              +-----------------------------------+------------------+
                              |                                   |                  |
                    +---------v----------+             +----------v-------+  +-----v------+
                    | Market Data Layer  |             | Trading Engine    |  | Prisma ORM |
                    | marketDataService  |             | execution / risk  |  | SQLite     |
                    | provider registry  |             | portfolio         |  | dev.db     |
                    +----+---------+-----+             +-------------------+  +------------+
                         |         |
                 +-------v--+  +---v------+
                 | DhanHQ   |  | Yahoo    |
                 | (WS/REST)|  | (REST)   |
                 +----------+  +----------+
                         |
                 +-------v------------------+
                 | Candle Store (SQLite)    |
                 | backfill + cache         |
                 +--------------------------+
```

### Runtime topology
- `client/` - React 19 + Vite 8, canvas chart engine, socket.io client.
- `server/` - Express 4, Prisma 5.22 (SQLite), socket.io server, provider adapters.
- Single process by default; SQLite is the shared store. Candle and quote history
  are persisted so charts survive restarts.

---

## 3. Frontend Structure

```
client/src/
  App.jsx                  top-level state: auth, quotes, watchlists, routing
  chart/                   custom canvas engine (ChartCore, renderers, scales)
  components/
    BrokerShell/           Sidebar, TopBar, TopSearchBar (terminal chrome)
    Broker/                Dashboard, watchlist, quote header, depth, positions
    Chart/                 AdvancedChart, ChartPage, option-chain panel
    Options/               OptionChainPage
    AI/ Portfolio/ ...     analytics, alerts, journal, backtester
  pages/                   auth, subscription, marketing
  services/api.js          typed-ish REST wrapper
  services/web3.js         wallet / blockchain ledger
```

### State ownership
- `App.jsx` owns server-backed and cross-page state: user, balance, holdings,
  portfolio, orders, `watchlists`, `activeListId`, `quotes`, `marketDepth`,
  `feedHealth`, chart target, notifications.
- Quote subscriptions are keyed off the union of index symbols, every watchlist
  symbol, and the active chart symbol. Duplicate subscriptions are impossible
  because the symbol set is built with `Set`.
- Watchlists persist client-side under `bt_watchlists_v3` with
  `bt_active_watchlist`; legacy `bt_watchlist` is still written for older pages.
- Page components keep only ephemeral UI state (tabs, modals, form drafts).

### Terminal layout
- `BrokerShell` renders a fixed sidebar, top bar and routed page content.
- `DashboardPage` uses a three-column desk: watchlist rail / chart + dock / market
  depth + quick trade.
- Chart pages use a dedicated full-height layout; the order form is an inline
  panel, never an overlay on top of candles.

---

## 4. Backend Structure

```
server/
  server.js                 app bootstrap, middleware, route mounts, socket.io
  routes/
    market.js               quotes, candles, indices, breadth, news, FII/DII
    trades.js               order placement / history
    auth.js                 register, login, session
    portfolio.js            holdings, summary, P&L
    watchlists.js           server-persisted watchlists
    options.js              option chain, greeks, strategy analytics
    dhanAuth.js             Dhan consent login + feed health
    alerts.js journal.js ai.js screener.js backtest.js ...
  services/
    marketDataService.js    normalization, freshness, fan-out
    data/registry.js        provider priority (DHAN > YAHOO > STORE)
    data/dhanMarketFeed.js  Dhan REST + websocket adapter
    data/yahooProvider.js   Yahoo fallback quotes/candles
    data/candleStore.js     candle persistence and backfill
    data/instrumentMaster.js symbol master / search
    websocketService.js     quote polling + socket.io broadcast
    continuousSync.js       background quote/candle refresh loops
    nseProxy.js             NSE public endpoints (FII/DII, option chain v3)
    optionChainService.js   Dhan/NSE chain adapters + normalized source metadata
  prisma/schema.prisma      data model
  prisma/dev.db             SQLite database
```

### Request flow (quotes)
1. Client `api.getQuote(symbol)` or socket subscribe.
2. `marketDataService` asks `registry` for a quote.
3. Registry tries DhanHQ, then Yahoo, then last stored snapshot.
4. Result is normalized (`price`, `change`, `freshness`, `source`, `latency`).
5. If no provider can answer, `freshness = UNAVAILABLE` and price is `null`.
   The UI shows `NO DATA`; it never invents a number.
6. `websocketService` polls the active symbol set and emits `quotes:update`.

### Request flow (candles)
1. Client requests `/api/market/candles?symbol=&range=&interval=`.
2. Cache/store is checked first for the timeframe bucket.
3. Missing buckets are backfilled from DhanHQ (Yahoo fallback).
4. Bars are de-duplicated by timestamp and returned ascending.
5. Empty result is a valid response; the chart renders an explicit empty state.

---

## 5. Data Model (SQLite / Prisma)

| Model | Purpose |
|---|---|
| `User` | Account, plan, balance, risk acceptance, MFA flag |
| `Instrument` | Symbol master: equities, indices, F&O, tick/lot, circuits |
| `Order` | Full order lifecycle, costs snapshot, idempotency key |
| `OrderEvent` | Immutable status history per order |
| `Trade` | Executions, actual costs, slippage, optional block fields |
| `Holding` | Net position per user+instrument, average price |
| `Watchlist` / `WatchlistItem` | Multi-list watchlists, ordering, notes |
| `Alert` | Price/percentage/indicator conditions |
| `TradeJournal` | Post-trade review, emotion, mistakes, ratings |
| `Notification` | In-app inbox |
| `AuditLog` | Security and order audit trail |
| `QuoteSnapshot` | Last known quote per provider with freshness/confidence |
| `Candle` | OHLCV + OI time series, unique per symbol/timeframe/ts |

Key invariants
- `Order.idempotencyKey` is unique; retries cannot double-execute.
- `Holding` is unique per `(userId, instrumentId)`.
- `Candle` is unique per `(tradingSymbol, timeframe, ts)`.
- All money math is done in floats for demo simplicity; production would move to
  integer paise / decimal types.

---

## 6. Trading Engine

- Paper fills use the latest real quote plus configurable slippage and cost model
  (brokerage, STT, exchange fee, GST, stamp duty, break-even price).
- Risk checks before execution: balance, quantity, lot size, market hours,
  circuit limits, product type.
- Every order writes `Order`, `OrderEvent`, and on fill `Trade` + `Holding`
  updates inside a transaction.
- Portfolio summary recomputes live P&L from `quotes`; unrealized values are
  never stored as if realized.
- Optional blockchain ledger (`services/blockchain*`, `web3.js`) hashes filled
  trades for tamper-evident demo records. It is not a settlement system.

---

## 7. Market Data and Integrity Rules

1. **One normalization shape** for all providers: price, change, changePercent,
   open/high/low/prevClose, volume, bid/ask, freshness, source, latency.
2. **Freshness contract**: `LIVE` (Dhan stream/recent REST), `DELAYED` (Yahoo or
   stale timestamp), `UNAVAILABLE` (all providers failed). UI badges must match.
3. **No synthetic prices** for missing equities. Missing data is `null`.
4. **Indices** are real index feeds when available; breadth is computed from the
   actual Nifty 50 constituent quotes.
5. **FII/DII**: `/api/market/breadth` and `/api/market/fii-dii` prefer NSE's
   provisional cash-flow feed via `nseProxy.getFiiDii()`. If NSE is unreachable,
   the response falls back to an index-derived estimate and marks it with
   `estimated: true` and a `dataSource` string saying it is estimated.
6. **Option chain**: `/api/options/chain` prefers Dhan (`/v2/optionchain`) and
   falls back to NSE `/api/option-chain-v3` with real OI, volume, LTP, IV and
   derived Greeks. Only when both exchange feeds are unavailable does it return a
   deterministic Black-Scholes model chain, always marked `source:
   'BLACK-SCHOLES-ESTIMATE'` and `estimated: true`; the UI shows a MODEL badge
   and warning banner. Random values are never used.
7. **News**: Yahoo Finance search + Economic Times RSS, cached, with failures
   degrading to an empty list rather than stale fake headlines.
8. **Backtests** require real daily candles for the selected symbol and date
   range. There is no synthetic-data fallback; insufficient history is an error.
9. **Caching**: short TTLs for breadth/news/sector data; candle store is the
   long-lived cache.

---

## 8. API Surface (grouped)

| Mount | Examples |
|---|---|
| `/api/market` | `/quote/:symbol`, `/quotes`, `/candles`, `/search`, `/indices`, `/sector-indices`, `/breadth`, `/fii-dii`, `/news`, `/inr-rate` |
| `/api/trades` | place order, list orders, cancel, square-off |
| `/api/auth` | register, login, session, profile |
| `/api/portfolio` | summary, holdings, P&L |
| `/api/watchlists` | CRUD lists and items |
| `/api/options` | chain, greeks, payoff, strategy |
| `/api/dhan` | `/auth/start`, `/auth/finish`, `/auth/status`, `/auth/logout`, `/feed-health` |
| `/api/alerts` | create/list/pause alerts |
| `/api/journal` | trade journal entries |
| `/api/ai` | insights, sentiment, risk analysis |
| `/api/screener` | saved screens and scans |
| `/api/backtest` | strategy backtests |
| `/api/ext` | session/calendar/ledger/pnl/basket/indicators/drawings |
| `/api/notifications` | inbox, read/unread |

WebSocket events: `quotes:update`, `depth:update`, `order:update`,
`alert:triggered`, `notification:new`.

---

## 9. Security and Compliance Notes

- Passwords hashed; JWT/session auth on protected routes.
- `AuditLog` records login, order and subscription events.
- Secrets live in `server/.env` (never committed); `.env.example` documents keys.
- Dhan access tokens are obtained through the consent flow and stored server-side.
- The platform is a simulator. It must not imply SEBI registration, guaranteed
  returns, or real exchange connectivity. Risk-acceptance is recorded per user.

---

## 10. Known Gaps / Roadmap

| Priority | Gap | Planned fix |
|---|---|---|
| Done | Option chain used model/random values | Real Dhan + NSE v3 chain with explicit `source` / `estimated`; deterministic model fallback |
| Done | Backtest silently fell back to random synthetic candles | Requires real candles; shows an error when history is insufficient |
| P0 | FII/DII fallback is an estimate when NSE is down | Keep flag, add caching + alerting; never drop the `estimated` flag |
| P1 | Single-process, SQLite | Postgres + Redis, horizontal API |
| P1 | In-memory quote fan-out | Dedicated market-data service / Redis pub-sub |
| P1 | No E2E tests for order lifecycle | Playwright + API integration suite |
| P2 | No server-persisted watchlists in the terminal UI | Sync `bt_watchlists_v3` to `/api/watchlists` |
| P2 | AI modules are heuristic/statistical | Add model versioning and evaluation |
| P2 | Blockchain ledger is demo-grade | Document scope or remove from marketing |

---

## 11. Local Development

```bash
# server
cd server
npm install
npx prisma generate
npx prisma db push
npm run dev

# client
cd client
npm install
npm run dev
```

Environment: copy `server/.env.example` to `server/.env` and fill DhanHQ /
optional provider keys. Without a Dhan token the app runs on Yahoo fallback and
shows `DELAYED`/`NO DATA` badges honestly.

Build check: `npm --prefix client run build`.
