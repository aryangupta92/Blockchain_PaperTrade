import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { io } from 'socket.io-client';

// Pages / Auth
import AuthPage          from './pages/AuthPage';
import SubscriptionPage  from './pages/SubscriptionPage';

// Shell
import BrokerShell       from './components/BrokerShell/BrokerShell';

// Pages inside shell
import MarketPage        from './components/Market/MarketPage';
import TradePage         from './components/Trading/TradePage';
import PortfolioPage     from './components/Portfolio/PortfolioPage';
import BlockchainExplorer from './components/Blockchain/BlockchainExplorer';
import WatchlistPage     from './components/Watchlist/WatchlistPage';
import OrdersPage        from './components/Orders/OrdersPage';
import NewsPage          from './components/News/NewsPage';
import OptionChainPage   from './components/OptionChain/OptionChainPage';
import ScreenerPage      from './components/Screener/ScreenerPage';
import JournalPage       from './components/Journal/JournalPage';
import TerminalPage      from './components/Terminal/TerminalPage';
import RiskAdvisorPage   from './components/RiskAdvisor/RiskAdvisorPage';
import BacktestPage      from './components/Backtest/BacktestPage';

// Full-screen chart
import ChartPage         from './components/Chart/ChartPage';
import ErrorBoundary     from './components/ErrorBoundary';

// Services & utils
import api               from './services/api';
import { getMarketStatus, getBalanceWarning } from './utils/sebi';

// ── Initial state helpers ─────────────────────────────────────────────────────
const LOAD = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const SAVE = (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const WATCHED_DEFAULT = ['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','WIPRO','BAJFINANCE'];
const INDICES = ['^NSEI','^BSESN','^NSEBANK','^CNXIT','^NSEMDCP50'];

export default function App() {
  // ── Auth state ──────────────────────────────────────────────────────────────
  const [user, setUser]         = useState(() => LOAD('bt_user', null));
  const [token, setToken]       = useState(() => localStorage.getItem('bt_token'));
  const [subStatus, setSubStatus] = useState(null); // { active, reason, subscription, plan, balance }
  const [subLoading, setSubLoading] = useState(!!token);

  // ── Market state ─────────────────────────────────────────────────────────────
  const [quotes, setQuotes]     = useState({});
  const [marketDepth, setMarketDepth] = useState({});
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  // ── Trading state ────────────────────────────────────────────────────────────
  const [balance, setBalance]   = useState(() => LOAD('bt_balance', 100000));
  const [holdings, setHoldings] = useState(() => LOAD('bt_holdings', {}));
  const [trades, setTrades]     = useState(() => LOAD('bt_trades', []));
  const [watchlist, setWatchlist] = useState(() => LOAD('bt_watchlist', WATCHED_DEFAULT));

  // ── Navigation ────────────────────────────────────────────────────────────────
  const [activePage, setActivePage] = useState('market');
  const [chartTarget, setChartTarget] = useState(null); // { symbol, symbolData } — opens full-screen chart

  // ── Toast ─────────────────────────────────────────────────────────────────────
  const [toast, setToast]       = useState(null);
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Load subscription status on boot ─────────────────────────────────────────
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

  // ── Market clock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setMarketStatus(getMarketStatus()), 30000);
    return () => clearInterval(iv);
  }, []);

  // ── Market data WebSockets + OMS Fill Notifications ───────────────────
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user || !subStatus?.active) return;

    const socket = io('http://localhost:5000', { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      setMarketLoading(false);
      // Subscribe to market data rooms
      const allSymbols = [...INDICES, ...watchlist];
      socket.emit('subscribe:quotes', allSymbols);
      // Join user-private room with JWT for secure auth (v2 security fix)
      const jwtToken = localStorage.getItem('bt_token');
      if (jwtToken) socket.emit('auth:join', jwtToken);
    });

    // Market data push — tradingSymbol is the canonical key
    socket.on('quotes:update', (quote) => {
      const key = quote.tradingSymbol || quote.symbol;
      if (key) setQuotes(prev => ({ ...prev, [key]: quote }));
    });

    // Market depth (L2) update
    socket.on('depth:update', ({ symbol, depth }) => {
      if (symbol) setMarketDepth(prev => ({ ...prev, [symbol]: depth }));
    });

    // OMS push: order filled — re-sync authoritative state from server
    socket.on('order:filled', (fill) => {
      const costStr = fill.costs?.totalCost ? ` (charges: ₹${fill.costs.totalCost})` : '';
      showToast(`✅ ${fill.side.toUpperCase()} ${fill.quantity} × ${fill.symbol} @ ₹${Number(fill.price).toLocaleString('en-IN')} — Block #${fill.blockIndex}${costStr}`);
      api.getSubStatus().then(status => {
        if (Number.isFinite(Number(status.balance))) setBalance(Number(status.balance));
        if (status.holdings) setHoldings(status.holdings);
        if (status.trades)   setTrades(status.trades);
        setSubStatus(status);
      }).catch(() => {});
    });

    // Alert fired
    socket.on('alert:fired', (alert) => {
      showToast(`🔔 Alert: ${alert.message}`, 'info');
    });

    // Heartbeat pong
    socket.on('server:ping', () => socket.emit('client:pong'));

    return () => { socket.disconnect(); };
  }, [user, subStatus?.active]);

  // Update subscription when watchlist changes
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected) {
      const allSymbols = [...INDICES, ...watchlist];
      socketRef.current.emit('subscribe:quotes', allSymbols);
    }
  }, [watchlist]);

  // ── Persist to localStorage ───────────────────────────────────────────────────
  useEffect(() => { SAVE('bt_user', user); }, [user]);
  useEffect(() => { SAVE('bt_balance', balance); }, [balance]);
  useEffect(() => { SAVE('bt_holdings', holdings); }, [holdings]);
  useEffect(() => { SAVE('bt_trades', trades); }, [trades]);
  useEffect(() => { SAVE('bt_watchlist', watchlist); }, [watchlist]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleAuth = (u, t) => { setUser(u); setToken(t); setSubLoading(true); };
  const handleLogout = () => {
    localStorage.clear();
    setUser(null); setToken(null); setSubStatus(null);
    setBalance(0); setHoldings({}); setTrades([]);
  };

  const handleSubscribed = (sub) => {
    setSubStatus({ active: true, subscription: sub });
    setBalance(sub.virtualBalance);
    setHoldings({}); setTrades([]);
    showToast(`🎉 ${sub.planName} activated! ₹${sub.virtualBalance.toLocaleString('en-IN')} virtual capital ready.`);
  };

  const executeTrade = async ({ type, symbol, quantity, price, orderType = 'market', productType = 'DELIVERY' }) => {
    // Generate idempotency key to prevent duplicate orders on retry
    const idempotencyKey = `${user.id}-${symbol}-${type}-${quantity}-${price}-${Date.now()}`;
    const result = await api.executeTrade({ type, symbol, quantity, price, orderType, productType, idempotencyKey });

    if (!result.success && result.violations) {
      throw new Error(result.violations[0]?.message || 'Order rejected by risk engine');
    }

    // Dual-Chain Execution: Record on Ethereum/Sepolia via MetaMask (optional)
    try {
      const { recordTradeOnChain } = await import('./services/web3');
      const ethTxHash = await recordTradeOnChain(symbol, quantity, price, type, result?.trade?.blockHash);
      console.log('Recorded on Ethereum. TxHash:', ethTxHash);
    } catch (err) {
      console.warn('MetaMask trade sync failed or skipped:', err.message);
    }

    return result;
  };

  const handleAddWatch  = (s) => setWatchlist(prev => prev.includes(s) ? prev : [...prev, s]);
  const handleRemWatch  = (s) => setWatchlist(prev => prev.filter(x => x !== s));

  // ── Open chart ────────────────────────────────────────────────────────────────
  const openChart = (symbol, symbolData) => setChartTarget({ symbol, symbolData });

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER LOGIC
  // ═══════════════════════════════════════════════════════════════════════════

  // 1) Loading initial sub status
  if (subLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)', flexDirection: 'column', gap: 16 }}>
        <div className="spinner" style={{ width: 36, height: 36, borderWidth: 4 }} />
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading BlockTrade…</div>
      </div>
    );
  }

  // 2) Not logged in → Auth
  if (!user || !token) return <AuthPage onAuth={handleAuth} />;

  // 3) No active subscription → Subscription page
  if (!subStatus?.active) {
    return (
      <SubscriptionPage
        user={user}
        reason={subStatus?.reason}
        onSubscribed={handleSubscribed}
        onLogout={handleLogout}
      />
    );
  }

  // ── Balance warnings ──────────────────────────────────────────────────────
  const balanceWarn = getBalanceWarning(balance, subStatus?.subscription?.initialBalance || balance);

  // ── Page map ─────────────────────────────────────────────────────────────
  const pages = {
    market:     <MarketPage   quotes={quotes} marketStatus={marketStatus} marketLoading={marketLoading} onOpenChart={openChart} />,
    trade:      <TradePage    quotes={quotes} holdings={holdings} balance={balance} onTrade={executeTrade} watchlist={watchlist} onAddWatch={handleAddWatch} />,
    portfolio:  <PortfolioPage holdings={holdings} quotes={quotes} balance={balance} initialBalance={subStatus?.subscription?.initialBalance || balance} onTrade={executeTrade} />,
    blockchain: <BlockchainExplorer trades={trades} />,
    watchlist:  <WatchlistPage watchlist={watchlist} quotes={quotes} onAdd={handleAddWatch} onRemove={handleRemWatch} onTrade={() => setActivePage('trade')} />,
    orders:     <OrdersPage />,
    news:       <NewsPage />,
    options:    <OptionChainPage symbol="^NSEI" onTrade={executeTrade} balance={balance} quotes={quotes} holdings={holdings} />,
    screener:   <ScreenerPage openChart={openChart} executeTrade={executeTrade} />,
    journal:    <JournalPage showToast={showToast} />,
    risk:       <RiskAdvisorPage holdings={holdings} quotes={quotes} />,
    backtest:   <BacktestPage showToast={showToast} />,
    terminal:   <TerminalPage quotes={quotes} marketDepth={marketDepth} onTrade={executeTrade} balance={balance} user={user} />,
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
          ⚠️ {balanceWarn.message}
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
            {pages[activePage] || pages.market}
          </div>
        </ErrorBoundary>
      </BrokerShell>
    </div>
  );
}
