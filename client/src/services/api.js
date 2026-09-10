const BASE = '/api';

const headers = () => {
  const token = localStorage.getItem('bt_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

async function apiFetch(path, options = {}) {
  const res  = await fetch(BASE + path, { ...options, headers: { ...headers(), ...options.headers } });
  const data = await res.json().catch(() => ({}));

  // For OMS order rejections (422) we return the payload instead of throwing
  // so the caller can surface violations to the user gracefully.
  if (res.status === 422) return data;

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const api = {
  // ── Market — Core ────────────────────────────────────────────────────────────
  /** Live quotes for a comma-separated list of NSE/BSE symbols or indices */
  getQuotes:    (symbols) => apiFetch(`/market/quotes?symbols=${symbols}`).then(d => d.data),

  /** OHLCV candlestick data for charting */
  getCandles:   (symbol, range, interval) =>
    apiFetch(`/market/candles?symbol=${symbol}&range=${range}&interval=${interval}`).then(d => {
      const arr  = d.data || [];
      arr.meta   = d.meta || null;
      arr.source = d.source || null;
      return arr;
    }),

  /** Top gainers, losers, most active from full Nifty 50 */
  getMovers:    () => apiFetch('/market/movers'),

  /** Search stocks by name/symbol — returns NSE/BSE filtered results */
  searchStocks: (query) => apiFetch(`/market/search?q=${query}`).then(d => d.results || []),

  /** Indian market news (multi-source: Yahoo Finance + Economic Times RSS) */
  getNews:      () => apiFetch('/market/news').then(d => d.news || []),

  // ── Market — New Endpoints ───────────────────────────────────────────────────
  /** All major Indian market indices in one call (Nifty50, Sensex, BankNifty, etc.) */
  getIndices:   () => apiFetch('/market/indices').then(d => d.data || []),

  /** Sector-wise performance: IT, Banking, FMCG, Auto, Pharma, Energy, Infra */
  getSectors:   () => apiFetch('/market/sectors').then(d => d.data || []),

  /** Market breadth: advances, declines, unchanged from Nifty 50 */
  getMarketBreadth: () => apiFetch('/market/breadth'),

  /** Full Nifty 50 stocks with live prices — for watchlist & portfolio views */
  getTopStocks: () => apiFetch('/market/top-stocks').then(d => d.data || []),

  /** Live USD → INR exchange rate (Frankfurter API, no auth needed) */
  getInrRate:   () => apiFetch('/market/inr-rate'),

  /** FII/DII data (directional estimate until Dhan API is configured) */
  getFiiDii:    () => apiFetch('/market/fii-dii'),

  // ── Trades & Orders ───────────────────────────────────────────────────────────
  /**
   * Place an order via the OMS.
   * Returns: { success, status, trade?, block?, violations?, orderId }
   */
  executeTrade: (trade) =>
    apiFetch('/trades', { method: 'POST', body: JSON.stringify(trade) }).then(d => {
      // Normalise the response so legacy callers get blockIndex/hash on the top-level
      if (d.trade) {
        d.trade.blockIndex = d.trade.blockIndex ?? d.block?.index;
        d.trade.blockHash  = d.trade.blockHash  ?? d.block?.hash;
      }
      return d;
    }),

  /** Authenticated user's paginated trade history */
  getTrades: (limit = 50, offset = 0) => apiFetch(`/trades?limit=${limit}&offset=${offset}`),

  /** Authenticated user's order book — optionally filter by status */
  getOrders: (status) => apiFetch(`/trades/orders${status ? `?status=${status}` : ''}`),

  /** Cancel a PENDING or OPEN order */
  cancelOrder: (orderId) => apiFetch(`/trades/orders/${orderId}`, { method: 'DELETE' }),

  /** Real-time margin preview — called before placing order */
  getMarginPreview: ({ symbol, quantity, price, side, productType }) =>
    apiFetch(`/trades/margin?symbol=${symbol}&quantity=${quantity}&price=${price}&side=${side}&productType=${productType}`),

  getBlockchain: () => apiFetch('/trades/blockchain'),
  verifyChain:   () => apiFetch('/trades/verify'),

  // ── Auth ──────────────────────────────────────────────────────────────────────
  register:   (data) => apiFetch('/auth/register',       { method: 'POST', body: JSON.stringify(data) }),
  login:      (data) => apiFetch('/auth/login',          { method: 'POST', body: JSON.stringify(data) }),
  getMe:      ()     => apiFetch('/auth/me'),
  acceptRisk: ()     => apiFetch('/auth/risk-disclosure', { method: 'POST' }),

  // ── Subscription ──────────────────────────────────────────────────────────────
  getPlans:     ()       => apiFetch('/subscription/plans').then(d => d.plans),
  purchasePlan: (planId) => apiFetch('/subscription/purchase', { method: 'POST', body: JSON.stringify({ planId }) }),
  getSubStatus: ()       => apiFetch('/subscription/status'),

  // ── Options ───────────────────────────────────────────────────────────────────
  getOptionChain: (symbol, expiry) =>
    apiFetch(`/options/chain?symbol=${symbol}${expiry ? '&expiry=' + expiry : ''}`),

  // ── Watchlists ────────────────────────────────────────────────────────────────
  getWatchlists: () => apiFetch('/watchlists'),
  createWatchlist: (name) => apiFetch('/watchlists', { method: 'POST', body: JSON.stringify({ name }) }),
  addWatchlistItem: (id, symbol) => apiFetch(`/watchlists/${id}/items`, { method: 'POST', body: JSON.stringify({ symbol }) }),
  removeWatchlistItem: (id, symbol) => apiFetch(`/watchlists/${id}/items/${symbol}`, { method: 'DELETE' }),

  // ── Alerts ────────────────────────────────────────────────────────────────────
  getAlerts: () => apiFetch('/alerts'),
  createAlert: (data) => apiFetch('/alerts', { method: 'POST', body: JSON.stringify(data) }),
  deleteAlert: (id) => apiFetch(`/alerts/${id}`, { method: 'DELETE' }),

  // ── Portfolio ─────────────────────────────────────────────────────────────────
  getPortfolioSummary: () => apiFetch('/portfolio/summary'),
  getPortfolioTrades: (limit = 50, offset = 0) => apiFetch(`/portfolio/trades?limit=${limit}&offset=${offset}`),

  // ── Trade Journal ─────────────────────────────────────────────────────────────
  getJournalEntries: () => apiFetch('/journal'),
  getJournalEntry: (id) => apiFetch(`/journal/${id}`),
  createJournalEntry: (data) => apiFetch('/journal', { method: 'POST', body: JSON.stringify(data) }),
  updateJournalEntry: (id, data) => apiFetch(`/journal/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteJournalEntry: (id) => apiFetch(`/journal/${id}`, { method: 'DELETE' }),

  // ── AI Coach (Full Module Suite) ──────────────────────────────────────────────
  getPortfolioInsight: () => apiFetch('/ai/portfolio-insight', { method: 'POST' }),
  getJournalFeedback: (journalId) => apiFetch('/ai/journal-coach', { method: 'POST', body: JSON.stringify({ journalId }) }),
  /** NEW: Full AI portfolio risk advisor (Module 1) */
  getAIPortfolioRisk: () => apiFetch('/ai/portfolio-risk', { method: 'POST' }),
  /** NEW: Bias coach — analyses journal entries for behavioral patterns (Module 2) */
  getAIBiasCoach: () => apiFetch('/ai/bias-coach', { method: 'POST' }),
  /** NEW: Validate backtested strategy with AI (Module 3) */
  validateStrategy: (data) => apiFetch('/ai/validate-strategy', { method: 'POST', body: JSON.stringify(data) }),

  // ── Backtesting (Module 3) ────────────────────────────────────────────────────
  /** Run backtest engine with Indian tax model */
  runBacktest: (params) => apiFetch('/backtest/run', { method: 'POST', body: JSON.stringify(params) }),

  // ── Screener ──────────────────────────────────────────────────────────────────
  getScreenerResults: (filters) => apiFetch('/screener', { method: 'POST', body: JSON.stringify(filters) }).then(d => d.results || []),

  // ── Trader Control (Risk Management) ──────────────────────────────────────────
  getKillSwitchStatus: () => apiFetch('/trader-control/killswitch'),
  setKillSwitch: (action) => apiFetch('/trader-control/killswitch', { method: 'POST', body: JSON.stringify({ action }) }),
  getPnlExit: () => apiFetch('/trader-control/pnl-exit'),
  setPnlExit: (data) => apiFetch('/trader-control/pnl-exit', { method: 'POST', body: JSON.stringify(data) }),

  // ── Health & SEBI (System) ────────────────────────────────────────────────────
  getHealth:    () => apiFetch('/system/health'),
  getSebiRules: () => apiFetch('/system/sebi'),
};

export default api;
