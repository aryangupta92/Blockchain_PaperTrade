const BASE = '/api';

const headers = () => {
  const token = localStorage.getItem('bt_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, { ...options, headers: { ...headers(), ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const api = {
  // ── Market ────────────────────────────────────────────────────────────────
  getQuotes: (symbols) => apiFetch(`/market/quotes?symbols=${symbols}`).then(d => d.data),
  getCandles: (symbol, range, interval) => apiFetch(`/market/candles?symbol=${symbol}&range=${range}&interval=${interval}`).then(d => d.data),
  getMovers: () => apiFetch('/market/movers'),
  getNews:   () => apiFetch('/market/news').then(d => d.news || []),
  searchStocks: (query) => apiFetch(`/market/search?q=${query}`).then(d => d.results || []),

  // ── Trades ────────────────────────────────────────────────────────────────
  executeTrade: (trade) =>
    apiFetch('/trades', { method: 'POST', body: JSON.stringify(trade) }).then((d) => {
      // Server returns { trade, block }. The app expects a flat trade-like object
      // with `blockIndex` and `hash` for dual-chain syncing.
      const t = d?.trade || d;
      if (!t) return d;
      return {
        ...t,
        // normalize: `hash` is used by web3 sync; map to local block hash
        hash: t.hash || t.blockHash || d?.block?.hash,
        blockIndex: t.blockIndex ?? d?.block?.index,
      };
    }),
  getBlockchain: () => apiFetch('/trades/blockchain'),
  verifyChain: () => apiFetch('/trades/verify'),

  // ── Auth ──────────────────────────────────────────────────────────────────
  register: (data) => apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  getMe: () => apiFetch('/auth/me'),
  acceptRisk: () => apiFetch('/auth/risk-disclosure', { method: 'POST' }),

  // ── Subscription ──────────────────────────────────────────────────────────
  getPlans: () => apiFetch('/subscription/plans').then(d => d.plans),
  purchasePlan: (planId) => apiFetch('/subscription/purchase', { method: 'POST', body: JSON.stringify({ planId }) }),
  getSubStatus: () => apiFetch('/subscription/status'),

  // ── Options ───────────────────────────────────────────────────────────────
  getOptionChain: (symbol, expiry) => apiFetch(`/options/chain?symbol=${symbol}${expiry ? '&expiry=' + expiry : ''}`),

  // ── Health & SEBI ─────────────────────────────────────────────────────────
  getHealth: () => apiFetch('/health'),
  getSebiRules: () => apiFetch('/sebi/rules'),
};

export default api;
