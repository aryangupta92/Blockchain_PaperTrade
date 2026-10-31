import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import './App.css';
import { io } from 'socket.io-client';

// Pages / Auth
import AuthPage          from './pages/AuthPage';
import SubscriptionPage  from './pages/SubscriptionPage';

// Shell
import BrokerShell       from './components/BrokerShell/BrokerShell';

// Pages inside shell (light — loaded eagerly)
import MarketPage        from './components/Market/MarketPage';
import TradePage         from './components/Trading/TradePage';
import PortfolioPage     from './components/Portfolio/PortfolioPage';
import OrdersPage        from './components/Orders/OrdersPage';
import NewsPage          from './components/News/NewsPage';
import JournalPage       from './components/Journal/JournalPage';
// Heavy pages — code-split via lazy()
const BlockchainExplorer = lazy(() => import('./components/Blockchain/BlockchainExplorer'));
const OptionChainPage    = lazy(() => import('./components/OptionChain/OptionChainPage'));
const BacktestPage       = lazy(() => import('./components/Backtest/BacktestPage'));
const AIDashboard        = lazy(() => import('./components/AIDashboard/AIDashboard'));
const StrategyBuilder    = lazy(() => import('./components/OptionChain/StrategyBuilder'));
const PortfolioAnalytics = lazy(() => import('./components/Portfolio/PortfolioAnalytics'));
const PriceAlerts        = lazy(() => import('./components/Alerts/PriceAlerts'));
// Broker-parity pages (Kite/Upstox/Dhan layout)
import DashboardPage     from './components/Broker/DashboardPage';
import FundsPage         from './components/Broker/FundsPage';
import PositionsBook     from './components/Broker/PositionsBook';
import SessionBanner     from './components/Broker/SessionBanner';
import DhanFeedSettings  from './components/Settings/DhanFeedSettings';
import { LedgerPage, PnlPage } from './components/Broker/ReportsPage';
import LandingPage        from './pages/LandingPage';
import { DisclaimerPage, PrivacyPolicyPage, TermsOfServicePage, DpdpPage } from './pages/LegalPages';

// Full-screen chart
import ChartPage         from './components/Chart/ChartPage';
import ErrorBoundary     from './components/ErrorBoundary';

// Services & utils
import api               from './services/api';
import { getMarketStatus, getBalanceWarning } from './utils/sebi';

// â”€â”€ Initial state helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LOAD = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const SAVE = (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } };

const WATCHED_DEFAULT = ['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','WIPRO','BAJFINANCE'];
const INDICES = ['^NSEI','^BSESN','^NSEBANK','^CNXFINANCE','^CNXIT','^NSMIDCP150'];
const WATCHLIST_KEY = 'bt_watchlists_v3';
const ACTIVE_LIST_KEY = 'bt_active_watchlist';

const newListId = () => `wl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function loadWatchlists() {
  const saved = LOAD(WATCHLIST_KEY, null);
  if (Array.isArray(saved) && saved.length) {
    return saved
      .map((l, i) => ({
        id: l.id || `wl-${i + 1}`,
        name: l.name || `Watchlist ${i + 1}`,
        symbols: Array.isArray(l.symbols) ? l.symbols : [],
      }));
  }
  // Migrate the old single-list format. Extra tabs from the old (buggy)
  // 'kite_lists_v2' key shared one stock array, so they are intentionally dropped.
  const legacy = LOAD('bt_watchlist', WATCHED_DEFAULT);
  return [{
    id: 'wl-1',
    name: 'Watchlist 1',
    symbols: Array.isArray(legacy) && legacy.length ? legacy : WATCHED_DEFAULT,
  }];
}

export default function App() {
  // â”€â”€ Auth state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [user, setUser]         = useState(() => LOAD('bt_user', null));
  const [token, setToken]       = useState(() => localStorage.getItem('bt_token'));
  const [subStatus, setSubStatus] = useState(null); // { active, reason, subscription, plan, balance }
  const [subLoading, setSubLoading] = useState(!!token);
  const [showAuth, setShowAuth] = useState(false);

  // Verify the persisted session on mount; clear stale/invalid tokens so the
  // user is sent back to the landing page instead of a half-broken session.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.getMe()
      .then((u) => { if (!cancelled && u) setUser(u); })
      .catch(() => {
        if (cancelled) return;
        try { localStorage.removeItem('bt_token'); } catch { /* ignore */ }
        setUser(null); setToken(null);
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // â”€â”€ Market state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [quotes, setQuotes]     = useState({});
  const [marketDepth, setMarketDepth] = useState({});
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  // â”€â”€ Trading state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [balance, setBalance]   = useState(() => LOAD('bt_balance', 100000));
  const [holdings, setHoldings] = useState(() => LOAD('bt_holdings', {}));
  const [trades, setTrades]     = useState(() => LOAD('bt_trades', []));
  const [watchlists, setWatchlists] = useState(loadWatchlists);
  const [activeListId, setActiveListId] = useState(() => LOAD(ACTIVE_LIST_KEY, 'wl-1'));
  const activeList = watchlists.find(l => l.id === activeListId) || watchlists[0];
  const watchlist = useMemo(() => activeList?.symbols || [], [activeList]);

  // â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activePage, setActivePage] = useState('dashboard'); // Kite parity: Dashboard is home
  const [chartTarget, setChartTarget] = useState(null); // { symbol, symbolData } â€” opens full-screen chart

  // â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [toast, setToast]       = useState(null);
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // â”€â”€ Load subscription status on boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!token) { setSubLoading(false); return; }
    api.getSubStatus()
      .then(status => {
        setSubStatus(status);
        // Pull portfolio state from server so balance doesn't "drift" across reloads
        if (Number.isFinite(Number(status.balance))) setBalance(Number(status.balance));
        if (status.holdings) setHoldings(status.holdings);
        if (status.trades) setTrades(status.trades);
      })
      .catch(() => { localStorage.removeItem('bt_token'); setToken(null); setUser(null); })
      .finally(() => setSubLoading(false));
  }, [token]);

  // â”€â”€ Market clock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const iv = setInterval(() => setMarketStatus(getMarketStatus()), 30000);
    return () => clearInterval(iv);
  }, []);

  // â”€â”€ Market data WebSockets + OMS Fill Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const socketRef = useRef(null);

  // Canonical feed symbol: server broadcasts on the Yahoo-suffixed room
  // (getQuote('RELIANCE') returns tradingSymbol 'RELIANCE.NS'). Subscribing
  // with the bare symbol joins a room that never receives ticks â€” that was
  // why the dashboard watchlist stayed empty while indices (^NSEI) worked.
  const toFeedSym = (s) => {
    if (!s) return s;
    if (s.startsWith('^')) return s;
    const base = s.replace('.NS', '').replace('.BO', '');
    return s.endsWith('.BO') ? `${base}.BO` : `${base}.NS`;
  };
  const baseSym = (s) => (s || '').replace('.NS', '').replace('.BO', '');
  const feedSymbols = () => [...new Set([
    ...INDICES,
    ...watchlists.flatMap(l => l.symbols || []),
    ...Object.keys(holdings || {}),
    ...(chartTarget?.symbol ? [chartTarget.symbol] : []),
  ])].map(toFeedSym);

  // Store every tick under BOTH the feed key and the bare base key so all
  // consumers (watchlist, positions, quote header) find it either way.
  const storeQuote = (quote) => {
    const feed = quote.tradingSymbol || quote.symbol;
    if (!feed) return;
    const base = baseSym(feed);
    setQuotes(prev => ({ ...prev, [feed]: quote, ...(base && base !== feed ? { [base]: quote } : {}) }));
  };
  const storeDepth = (symbol, depth) => {
    if (!symbol) return;
    const base = baseSym(symbol);
    setMarketDepth(prev => ({ ...prev, [symbol]: depth, ...(base && base !== symbol ? { [base]: depth } : {}) }));
  };

  // REST bootstrap + safety-net poll: instant data on login even before the
  // first WS tick, and recovery if the socket drops silently.
  // Runs for every signed-in user - market data is never subscription-gated.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const bootstrap = async () => {
      try {
        const syms = feedSymbols();
        if (!syms.length) return;
        const qs = await api.getQuotes(syms.join(','));
        if (!alive || !qs) return;
        (Array.isArray(qs) ? qs : [qs]).forEach(storeQuote);
        setMarketLoading(false);
      } catch { /* keep last known quotes; socket will retry */ }
    };
    bootstrap();
    const iv = setInterval(bootstrap, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, [user, watchlists, holdings]); // eslint-disable-line

  useEffect(() => {
    if (!user) return;

    const socket = io('http://localhost:5000', { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      setMarketLoading(false);
      // Subscribe with canonical feed symbols (RELIANCE.NS, ^NSEI, â€¦)
      socket.emit('subscribe:quotes', feedSymbols());
      // Join user-private room with JWT for secure auth (v2 security fix)
      const jwtToken = localStorage.getItem('bt_token');
      if (jwtToken) socket.emit('auth:join', jwtToken);
    });

    // Market data push â€” stored under feed key AND bare base key
    socket.on('quotes:update', storeQuote);

    // Market depth (L2) update
    socket.on('depth:update', ({ symbol, depth }) => storeDepth(symbol, depth));

    // OMS push: order filled â€” re-sync authoritative state from server
    socket.on('order:filled', (fill) => {
      const costStr = fill.costs?.totalCost ? ` (charges: â‚¹${fill.costs.totalCost})` : '';
      showToast(`âœ… ${fill.side.toUpperCase()} ${fill.quantity} Ã— ${fill.symbol} @ â‚¹${Number(fill.price).toLocaleString('en-IN')} â€” Block #${fill.blockIndex}${costStr}`);
      api.getSubStatus().then(status => {
        if (Number.isFinite(Number(status.balance))) setBalance(Number(status.balance));
        if (status.holdings) setHoldings(status.holdings);
        if (status.trades)   setTrades(status.trades);
        setSubStatus(status);
      }).catch(() => {});
    });

    // Alert fired
    socket.on('alert:fired', (alert) => {
      showToast(`ðŸ”” Alert: ${alert.message}`, 'info');
    });

    // Heartbeat pong
    socket.on('server:ping', () => socket.emit('client:pong'));

    return () => { socket.disconnect(); };
  }, [user]);

  // Global keyboard shortcuts (BlockTrade master spec):
  //   G+H -> Home (dashboard)      G+P -> Portfolio
  //   G+C -> Open full-screen chart   /  -> focus global search
  useEffect(() => {
    let gTimer = null;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
      if (e.key === '/') {
        if (typing) return;
        e.preventDefault();
        const inp = document.querySelector('.topbar-search input');
        if (inp) { inp.focus(); inp.select?.(); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'g') { gTimer = setTimeout(() => { gTimer = null; }, 1500); return; }
      const map = { h: 'dashboard', p: 'portfolio', c: 'chart' };
      const page = map[k];
      if (gTimer) {
        clearTimeout(gTimer);
        gTimer = null;
        e.preventDefault();
        const p = map[k];
        if (p === 'chart') setChartTarget({ symbol: 'NIFTY 50', symbolData: null });
        else setActivePage(p);
      }
    };
    const onKeyUp = (e) => { if (e.key && e.key.toLowerCase() !== 'g') gTimer = null; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // Update subscription when any watchlist or holdings changes
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('subscribe:quotes', feedSymbols());
    }
  }, [watchlists, holdings]); // eslint-disable-line

  // â”€â”€ Persist to localStorage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => { SAVE('bt_user', user); }, [user]);
  useEffect(() => { SAVE('bt_balance', balance); }, [balance]);
  useEffect(() => { SAVE('bt_holdings', holdings); }, [holdings]);
  useEffect(() => { SAVE('bt_trades', trades); }, [trades]);
  useEffect(() => {
    SAVE(WATCHLIST_KEY, watchlists);
    if (!watchlists.some(l => l.id === activeListId)) setActiveListId(watchlists[0]?.id);
  }, [watchlists, activeListId]);
  useEffect(() => { SAVE(ACTIVE_LIST_KEY, activeListId); }, [activeListId]);
  useEffect(() => { SAVE('bt_watchlist', watchlist); }, [watchlist]);

  // â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAuth = (u, t) => { setUser(u); setToken(t); setSubLoading(true); };
  const handleLogout = () => {
    localStorage.clear();
    api.logout().catch(() => {});
    setUser(null); setToken(null); setSubStatus(null);
    setBalance(0); setHoldings({}); setTrades([]);
  };

  const executeTrade = async ({ type, symbol, quantity, price, orderType = 'market', productType = 'DELIVERY', stopLoss, target }) => {
    const idempotencyKey = `${user.id}-${symbol}-${type}-${quantity}-${price}-${Date.now()}`;
    const result = await api.executeTrade({ type, symbol, quantity, price, orderType, productType, stopLoss, target, idempotencyKey });

    if (!result.success && result.violations) {
      throw new Error(result.violations[0]?.message || 'Order rejected by risk engine');
    }

    // Dual-Chain Execution: Record on Ethereum/Sepolia via MetaMask (optional)
    try {
      const { recordTradeOnChain } = await import('./services/web3');
      const ethRes = await recordTradeOnChain(symbol, quantity, price, type, result?.trade?.blockHash);
      const ethTxHash = typeof ethRes === 'string' ? ethRes : ethRes?.hash;
      if (ethRes?.simulated) console.log('Trade simulated on-chain (no contract deployed). TxHash:', ethTxHash);
      else console.log('Recorded on Ethereum. TxHash:', ethTxHash);
    } catch (err) {
      console.warn('MetaMask trade sync failed or skipped:', err.message);
    }

    return result;
  };

  const updateList = (id, fn) => setWatchlists(prev => prev.map(l => (l.id === id ? fn(l) : l)));
  const handleAddWatch = (raw) => {
    const s = String(raw || '').toUpperCase().replace('.NS', '').replace('.BO', '');
    if (!s) return;
    updateList(activeList?.id, l => (l.symbols.includes(s) ? l : { ...l, symbols: [...l.symbols, s] }));
  };
  const handleRemWatch = (s) => {
    updateList(activeList?.id, l => ({ ...l, symbols: l.symbols.filter(x => x !== s) }));
  };
  const handleAddList = (name) => {
    const id = newListId();
    const title = String(name || '').trim() || `Watchlist ${watchlists.length + 1}`;
    setWatchlists(prev => [...prev, { id, name: title.slice(0, 24), symbols: [] }]);
    setActiveListId(id);
  };
  const handleRenameList = (id, name) => {
    const title = String(name || '').trim().slice(0, 24);
    if (!title) return;
    updateList(id, l => ({ ...l, name: title }));
  };
  const handleDeleteList = (id) => {
    if (watchlists.length <= 1) return;
    const next = watchlists.filter(l => l.id !== id);
    setWatchlists(next);
    if (activeListId === id) setActiveListId(next[0].id);
  };

  // â”€â”€ Open chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openChart = (symbol, symbolData) => setChartTarget({ symbol, symbolData });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // RENDER LOGIC
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // 1) Loading initial sub status
  if (subLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)', flexDirection: 'column', gap: 16 }}>
        <div className="spinner" style={{ width: 36, height: 36, borderWidth: 4 }} />
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading BlockTradeâ€¦</div>
      </div>
    );
  }

  // 2) Not logged in â†’ Auth
  if (!user || !token) {
    if (showAuth) {
      return <AuthPage onAuth={(u, t) => { setUser(u); setToken(t); setSubLoading(true); }} />;
    }
    return <LandingPage onGetStarted={() => setShowAuth(true)} />;
  }

  // 3) Subscription status is informational, never a wall.

  // â”€â”€ Balance warnings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const balanceWarn = getBalanceWarning(balance, subStatus?.subscription?.initialBalance || balance);

  // â”€â”€ Page map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Kite parity: Dashboard (watchlist+chart+depth+dock) is home; Trade Desk keeps legacy desk
  const exitPosition = (sym) => {
    setActivePage('dashboard');
    showToast(`Exit ${sym} from Positions dock below the chart`, 'info');
  };
  const pages = {
    dashboard:  <DashboardPage
      quotes={quotes}
      marketDepth={marketDepth}
      watchlists={watchlists}
      activeListId={activeList?.id}
      onAddWatch={handleAddWatch}
      onRemoveWatch={handleRemWatch}
      onAddList={handleAddList}
      onRenameList={handleRenameList}
      onDeleteList={handleDeleteList}
      onSelectList={setActiveListId}
      holdings={holdings}
      balance={balance}
      onTrade={executeTrade}
      onOpenChart={openChart}
      onNav={setActivePage}
    />,
    market:     <MarketPage   quotes={quotes} marketStatus={marketStatus} marketLoading={marketLoading} onOpenChart={openChart} />,
    trade:      <TradePage    quotes={quotes} holdings={holdings} balance={balance} onTrade={executeTrade} watchlist={watchlist} onAddWatch={handleAddWatch} marketDepth={marketDepth} />,
    portfolio:  <PortfolioPage holdings={holdings} quotes={quotes} balance={balance} initialBalance={subStatus?.subscription?.initialBalance || balance} onTrade={executeTrade} />,
    positions:  <><SessionBanner /><PositionsBook quotes={quotes} onExit={exitPosition} /></>,
    funds:      <FundsPage balance={balance} quotes={quotes} holdings={holdings} showToast={showToast} />,
    settings:   <div style={{ maxWidth: 980 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 14px' }}>Settings</h2>
      <DhanFeedSettings pushToast={showToast} />
    </div>,
    ledger:     <LedgerPage />,
    pnl:        <PnlPage />,
    blockchain: <BlockchainExplorer trades={trades} />,
    orders:     <OrdersPage />,
    news:       <NewsPage />,
    options:    <OptionChainPage symbol="^NSEI" onTrade={executeTrade} balance={balance} quotes={quotes} holdings={holdings} />,
    journal:    <JournalPage showToast={showToast} />,
    backtest:   <BacktestPage showToast={showToast} />,
    'ai-dashboard': <AIDashboard watchlist={watchlist} holdings={holdings} quotes={quotes} />,
    'strategy-builder': <StrategyBuilder spot={quotes['^NSEI']?.price || 0} underlying="NIFTY" onTrade={executeTrade} balance={balance} quotes={quotes} />,
    'analytics': <PortfolioAnalytics holdings={holdings} balance={balance} initialBalance={subStatus?.subscription?.initialBalance || balance} quotes={quotes} />,
    'alerts': <PriceAlerts quotes={quotes} watchlist={watchlist} showToast={showToast} />,
    'legal-disclaimer': <DisclaimerPage />,
    'legal-privacy': <PrivacyPolicyPage />,
    'legal-terms': <TermsOfServicePage />,
    'legal-dpdp': <DpdpPage />,
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Balance Warning Banner */}
      {balanceWarn && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: balanceWarn.level === 'critical' ? 'var(--loss)' : '#f59e0b',
          color: '#fff', fontSize: 12, fontWeight: 700,
          padding: '6px 20px', textAlign: 'center',
        }}>
          âš ï¸ {balanceWarn.message}
          {balanceWarn.level === 'critical' && (
            <button onClick={() => { setSubStatus(null); }} style={{ marginLeft: 12, background: '#fff', color: '#dc2626', border: 'none', padding: '2px 10px', borderRadius: 99, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
              Renew Subscription
            </button>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'error' ? 'var(--loss)' : 'var(--gain)',
          color: '#fff', padding: '12px 20px', borderRadius: 12,
          fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Full-Screen Chart */}
      {chartTarget && (
        <ErrorBoundary>
          <ChartPage
            symbol={chartTarget.symbol}
            symbolData={chartTarget.symbolData}
            onClose={() => setChartTarget(null)}
            onTrade={executeTrade}
            holdings={holdings}
            balance={balance}
            subscription={subStatus?.subscription}
            watchlist={watchlist}
            onAddWatch={handleAddWatch}
            onRemWatch={handleRemWatch}
            quotes={quotes}
          />
        </ErrorBoundary>
      )}

      {/* Main Broker Shell */}
      <BrokerShell
        activePage={activePage}
        onNav={setActivePage}
        balance={balance}
        quotes={quotes}
        marketLoading={marketLoading}
        marketStatus={marketStatus}
        user={user}
        subscription={subStatus?.subscription}
        onLogout={handleLogout}
        onOpenChart={openChart}
      >
        <ErrorBoundary key={activePage}>
          <div className="page-content fade-in-up" style={{ marginTop: balanceWarn ? 32 : 0 }}>
            <Suspense fallback={(
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, flexDirection: 'column', gap: 12 }}>
                <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading page…</div>
              </div>
            )}>
              {pages[activePage] || pages.dashboard}
            </Suspense>
          </div>
        </ErrorBoundary>
      </BrokerShell>
    </div>
  );
}
