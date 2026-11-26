import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Briefcase,
  Coins,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  GraduationCap,
  Keyboard,
  Layers,
  LineChart,
  LogOut,
  Moon,
  PanelLeft,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import {
  AccountMode,
  api,
  formatINR,
  getMarketWsUrl,
  setAccessToken,
  TradingAccountDTO,
  UserProfile,
} from './apiClient';
import { AuthGate } from './components/AuthGate';
import { FundsPage } from './components/FundsPage';
import { BlockchainPage } from './components/BlockchainPage';
import { SettingsPage } from './components/SettingsPage';
import { MarketPage } from './components/MarketPage';
import { OrderTicketModal } from './components/OrderTicketModal';
import { OrdersPage } from './components/OrdersPage';
import { PositionsHoldingsPage } from './components/PositionsHoldingsPage';
import { ChartsPage } from './components/ChartsPage';
import { OptionChainPage } from './components/OptionChainPage';
import { EtfsPage } from './components/EtfsPage';
import { CommoditiesPage } from './components/CommoditiesPage';
import { ReportsPage } from './components/ReportsPage';
import { StrategyLabPage } from './components/StrategyLabPage';
import { AiCoachPage } from './components/AiCoachPage';
import { BlockTradeLogo } from './components/BlockTradeLogo';
import { WatchlistDrawer } from './components/WatchlistDrawer';
import { MarketDepthModal } from './components/MarketDepthModal';
import { ScreenerPage } from './components/ScreenerPage';
import { TradersDiaryPage } from './components/TradersDiaryPage';
import { TradersControlsPage } from './components/TradersControlsPage';
import { TERMINAL_SHORTCUTS, useHotkeys } from './terminalHotkeys';

type Theme = 'dark' | 'light';

interface TicketTarget {
  symbol: string;
  side: 'BUY' | 'SELL';
  segment: string;
  ltp: string | null;
  priceOverride?: string | null;
  initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF';
  initialTab?: 'TRADING' | 'INVESTING' | 'SUPER' | 'FOREVER';
}

const PINNED_INDICES = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'INDIAVIX'];

const NAV_ITEMS = [
  { id: 'overview', label: 'Market Overview', section: 'Markets', icon: Activity },
  { id: 'screener', label: 'Screener & Heatmap', section: 'Markets', icon: Filter },
  { id: 'equity', label: 'Stocks (NSE/BSE)', section: 'Markets', icon: TrendingUp },
  { id: 'fno', label: 'Indices & F&O', section: 'Markets', icon: Layers },
  { id: 'option-chain', label: 'Option Chain & Flash', section: 'Markets', icon: BarChart3 },
  { id: 'etfs', label: 'ETFs', section: 'Markets', icon: Scale },
  { id: 'commodities', label: 'Commodities (MCX)', section: 'Markets', icon: Coins },
  { id: 'charts', label: 'Charts & Scalper', section: 'Terminal', icon: LineChart },
  { id: 'strategy-lab', label: 'Strategy Lab & Backtest', section: 'Terminal', icon: FlaskConical },
  { id: 'ai-coach', label: 'AI Coach & Academy', section: 'Learning', icon: GraduationCap },
  { id: 'orders', label: 'Orders, Super & GTT', section: 'Portfolio', icon: FileText },
  { id: 'positions', label: 'Positions, MTF & Pledge', section: 'Portfolio', icon: Briefcase },
  { id: 'diary', label: "Trader's Diary", section: 'Portfolio', icon: BookOpen },
  { id: 'funds', label: 'Funds & Ledger', section: 'Portfolio', icon: Wallet },
  { id: 'reports', label: 'P&L & Contract Notes', section: 'Portfolio', icon: FileSpreadsheet },
  { id: 'controls', label: 'Controls, Alerts & TV', section: 'Trust', icon: ShieldAlert },
  { id: 'blockchain', label: 'Blockchain Audit', section: 'Trust', icon: ShieldCheck },
  { id: 'settings', label: 'Settings & Rules', section: 'Trust', icon: Settings },
] as const;

const VALID_NAV_IDS = new Set<string>(NAV_ITEMS.map((item) => item.id));

interface NavHistorySnapshot {
  nav: string;
  symbol: string;
  segment: string;
  underlying: string;
  idx?: number;
}

function readSnapshotFromUrl(): NavHistorySnapshot {
  try {
    const qs = new URLSearchParams(window.location.search);
    const navParam = qs.get('page') || 'overview';
    return {
      nav: VALID_NAV_IDS.has(navParam) ? navParam : 'overview',
      symbol: qs.get('symbol') || 'RELIANCE',
      segment: qs.get('segment') || 'EQ',
      underlying: qs.get('underlying') || 'NIFTY',
    };
  } catch {
    return { nav: 'overview', symbol: 'RELIANCE', segment: 'EQ', underlying: 'NIFTY' };
  }
}

function buildNavUrl(snap: NavHistorySnapshot): string {
  const qs = new URLSearchParams();
  qs.set('page', snap.nav);
  if (snap.nav === 'charts') {
    qs.set('symbol', snap.symbol);
    qs.set('segment', snap.segment);
  } else if (snap.nav === 'option-chain') {
    qs.set('underlying', snap.underlying);
  }
  return `${window.location.pathname}?${qs.toString()}${window.location.hash || ''}`;
}

export function App() {
  const initialSnap = useMemo(() => readSnapshotFromUrl(), []);
  const [mode, setMode] = useState<AccountMode>('DEMO');
  const [theme, setTheme] = useState<Theme>('dark');
  const [activeNav, setActiveNav] = useState<string>(initialSnap.nav);
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<TradingAccountDTO[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);

  const [activeSymbol, setActiveSymbol] = useState<{ symbol: string; segment: string; ltp: string | null }>({
    symbol: initialSnap.symbol,
    segment: initialSnap.segment,
    ltp: null,
  });
  const [ticket, setTicket] = useState<TicketTarget | null>(null);
  const [depthTarget, setDepthTarget] = useState<{ symbol: string; segment: string } | null>(null);
  const [chartTarget, setChartTarget] = useState<{ symbol: string; segment: string }>({
    symbol: initialSnap.symbol,
    segment: initialSnap.segment,
  });
  const [chainUnderlying, setChainUnderlying] = useState<string>(initialSnap.underlying);
  const [historyMeta, setHistoryMeta] = useState<{ pos: number; maxPos: number }>({ pos: 0, maxPos: 0 });
  const historyPosRef = useRef(0);

  // Topbar Global Smart Search & Index Ticker Strip
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalHits, setGlobalHits] = useState<Array<{ symbol: string; tradingSymbol: string; exchange: string; segment: string }>>([]);
  const [indexQuotes, setIndexQuotes] = useState<Record<string, { ltp: string | null; changePercent: string | null }>>({});

  const navigateTo = useCallback(
    (
      navId: string,
      opts?: { symbol?: string; segment?: string; underlying?: string; replace?: boolean }
    ) => {
      const safeNav = VALID_NAV_IDS.has(navId) ? navId : 'overview';
      const nextSnap: NavHistorySnapshot = {
        nav: safeNav,
        symbol: opts?.symbol ?? chartTarget.symbol,
        segment: opts?.segment ?? chartTarget.segment,
        underlying: opts?.underlying ?? chainUnderlying,
      };
      setActiveNav(safeNav);
      if (opts?.symbol || opts?.segment) {
        setChartTarget({ symbol: nextSnap.symbol, segment: nextSnap.segment });
      }
      if (opts?.underlying) {
        setChainUnderlying(nextSnap.underlying);
      }

      const nextUrl = buildNavUrl(nextSnap);
      const curUrl = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`;
      if (opts?.replace) {
        window.history.replaceState({ ...nextSnap, idx: historyPosRef.current }, '', nextUrl);
        return;
      }
      if (nextUrl === curUrl && window.history.state?.nav === safeNav) return;

      const nextPos = historyPosRef.current + 1;
      historyPosRef.current = nextPos;
      window.history.pushState({ ...nextSnap, idx: nextPos }, '', nextUrl);
      setHistoryMeta((prev) => ({ pos: nextPos, maxPos: Math.max(prev.maxPos, nextPos) }));
    },
    [chartTarget.symbol, chartTarget.segment, chainUnderlying]
  );

  // Browser & Mouse Back/Forward navigation listener
  useEffect(() => {
    const initialState = window.history.state as (NavHistorySnapshot & { idx?: number }) | null;
    if (!initialState || typeof initialState.idx !== 'number') {
      const snap = { ...initialSnap, idx: 0 };
      window.history.replaceState(snap, '', buildNavUrl(snap));
    } else {
      historyPosRef.current = initialState.idx;
      setHistoryMeta({ pos: initialState.idx, maxPos: initialState.idx });
    }

    const onPopState = (evt: PopStateEvent) => {
      const st = (evt.state as (NavHistorySnapshot & { idx?: number }) | null) || readSnapshotFromUrl();
      const safeNav = VALID_NAV_IDS.has(st.nav) ? st.nav : 'overview';
      setActiveNav(safeNav);
      if (st.symbol && st.segment) {
        setChartTarget({ symbol: st.symbol, segment: st.segment });
        setActiveSymbol((prev) => ({ ...prev, symbol: st.symbol, segment: st.segment }));
      }
      if (st.underlying) {
        setChainUnderlying(st.underlying);
      }
      const nextIdx = typeof (st as { idx?: number }).idx === 'number' ? (st as { idx: number }).idx : Math.max(0, historyPosRef.current - 1);
      historyPosRef.current = nextIdx;
      setHistoryMeta((prev) => ({ pos: nextIdx, maxPos: Math.max(prev.maxPos, nextIdx) }));
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [initialSnap]);

  const openChart = useCallback(
    (symbol: string, segment: string) => {
      setActiveSymbol({ symbol, segment, ltp: null });
      navigateTo('charts', { symbol, segment });
    },
    [navigateTo]
  );

  const openOptionChain = useCallback(
    (symbol: string) => {
      const und = symbol.split('-')[0].split(' ')[0].toUpperCase();
      navigateTo('option-chain', { underlying: und });
    },
    [navigateTo]
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-theme', theme);
  }, [mode, theme]);

  useEffect(() => {
    api
      .refresh()
      .then((res) => {
        setAccessToken(res.accessToken);
        setUser(res.user);
        setAccounts(res.accounts);
      })
      .catch(() => setUser(null))
      .finally(() => setBootstrapping(false));
  }, []);

  // Pinned Index Ticker Strip (REST snapshot + 10s periodic poll + live WS)
  useEffect(() => {
    if (!user) return;
    const fetchIndices = () => {
      api.quotes(PINNED_INDICES).then((res) => {
        const next: Record<string, { ltp: string | null; changePercent: string | null }> = {};
        for (const q of res.quotes) next[q.symbol.toUpperCase()] = { ltp: q.ltp, changePercent: q.changePercent };
        setIndexQuotes(next);
      }).catch(() => {});
    };
    fetchIndices();
    const pollId = window.setInterval(fetchIndices, 10_000);

    const ws = new WebSocket(getMarketWsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', symbols: PINNED_INDICES }));
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'quote' && msg.data?.symbol) {
          const sym = String(msg.data.symbol).toUpperCase();
          if (PINNED_INDICES.includes(sym)) {
            setIndexQuotes((prev) => ({ ...prev, [sym]: { ltp: msg.data.ltp, changePercent: msg.data.changePercent } }));
          }
        }
      } catch { /* ignore */ }
    };
    return () => {
      window.clearInterval(pollId);
      ws.close();
    };
  }, [user]);

  // Debounced global smart search
  useEffect(() => {
    const q = globalQuery.trim();
    if (q.length < 2) { setGlobalHits([]); return; }
    const t = setTimeout(() => {
      api.searchInstruments({ q, limit: 10 }).then((r) => setGlobalHits(r.instruments)).catch(() => setGlobalHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [globalQuery]);

  // Global Terminal Hotkeys
  const hotkeyBindings = useMemo(
    () => ({
      onBuy: () => setTicket({ symbol: activeSymbol.symbol, side: 'BUY', segment: activeSymbol.segment, ltp: activeSymbol.ltp }),
      onSell: () => setTicket({ symbol: activeSymbol.symbol, side: 'SELL', segment: activeSymbol.segment, ltp: activeSymbol.ltp }),
      onOpenChart: () => openChart(activeSymbol.symbol, activeSymbol.segment),
      onNavigate: (navId: string) => navigateTo(navId),
      onFocusSearch: () => searchInputRef.current?.focus(),
      onToggleWatchlist: () => setShowWatchlist((v) => !v),
      onToggleShortcutsHelp: () => setShowShortcuts((v) => !v),
      onEscape: () => {
        setTicket(null);
        setDepthTarget(null);
        setShowShortcuts(false);
        setGlobalHits([]);
      },
    }),
    [activeSymbol]
  );
  useHotkeys(hotkeyBindings, Boolean(user));

  const refreshAccounts = async () => {
    try {
      const res = await api.accounts();
      setAccounts(res.accounts);
    } catch { /* ignore */ }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setAccessToken(null);
    setUser(null);
    setAccounts([]);
  };

  if (bootstrapping) {
    return (
      <div className="auth-wrapper">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <BlockTradeLogo size={54} showWordmark showTagline />
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading BlockTrade terminal...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthGate
        onAuthenticated={(u, accs) => {
          setUser(u);
          setAccounts(accs);
          navigateTo(readSnapshotFromUrl().nav || 'overview', { replace: true });
        }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.mode === mode) ||
    accounts[0] || {
      id: '',
      mode,
      cashBalance: '0.00',
      blockedMargin: '0.00',
      collateralMargin: '0.00',
      availableMargin: '0.00',
      resetEpoch: 1,
      killSwitchOn: false,
      maxDailyLoss: null,
      maxOrderValue: null,
      maxOpenOrders: 50,
      updatedAt: new Date().toISOString(),
    };

  const sections = ['Markets', 'Terminal', 'Learning', 'Portfolio', 'Trust'];

  return (
    <div className="app-shell">
      <div className="mode-ribbon">
        <span>
          {mode === 'DEMO'
            ? 'DEMO ACCOUNT ACTIVE — Virtual funds only (₹1,000 to ₹1,00,00,000). Real statutory charges & brokerage simulated identically to live trading.'
            : 'REAL ACCOUNT MODE — Live funds & SEBI-regulated broker execution adapter (Mock mode until broker registration & KYC).'}
        </span>
        <span className="mono">
          {mode} AVAIL: {formatINR(activeAccount.availableMargin)} | CASH: {formatINR(activeAccount.cashBalance)}
          {Number(activeAccount.collateralMargin || 0) > 0 ? ` | COLLAT: ${formatINR(activeAccount.collateralMargin || 0)}` : ''}
        </span>
      </div>

      <header className="topbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="brand">
            <BlockTradeLogo size={32} showWordmark />
            <span className={`badge ${mode === 'DEMO' ? 'badge-warn' : 'badge-gain'}`}>{mode}</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>
              <button
                type="button"
                className="theme-toggle"
                style={{ padding: '4px 6px', opacity: historyMeta.pos > 0 ? 1 : 0.45 }}
                disabled={historyMeta.pos <= 0}
                title="Back (Browser / Mouse Back)"
                onClick={() => window.history.back()}
              >
                <ArrowLeft size={13} />
              </button>
              <button
                type="button"
                className="theme-toggle"
                style={{ padding: '4px 6px', opacity: historyMeta.pos < historyMeta.maxPos ? 1 : 0.45 }}
                disabled={historyMeta.pos >= historyMeta.maxPos}
                title="Forward (Browser / Mouse Forward)"
                onClick={() => window.history.forward()}
              >
                <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* Live Pinned Index Ticker Strip */}
          <div className="index-ticker-strip">
            {PINNED_INDICES.map((idx) => {
              const q = indexQuotes[idx];
              const pct = q?.changePercent ? Number(q.changePercent) : 0;
              return (
                <div key={idx} className="index-pill" onClick={() => openChart(idx, 'FNO')} title={`Open ${idx} Chart`}>
                  <strong>{idx}</strong>
                  <span className="mono">{q?.ltp ? Number(q.ltp).toFixed(1) : '—'}</span>
                  {q?.changePercent && (
                    <span className="mono" style={{ color: pct >= 0 ? 'var(--gain)' : 'var(--loss)', fontSize: 10.5 }}>
                      {pct >= 0 ? '+' : ''}{q.changePercent}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Global Smart Search + Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 210 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '4px 8px' }}>
              <Search size={13} color="var(--text-muted)" />
              <input
                ref={searchInputRef}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 12, width: '100%', outline: 'none' }}
                placeholder="Search (Ctrl+K)..."
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
              />
            </div>
            {globalHits.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', right: 0, width: 320, zIndex: 90, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 9, marginTop: 4, maxHeight: 280, overflowY: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}>
                {globalHits.map((h) => (
                  <div key={`${h.exchange}-${h.tradingSymbol}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 9px', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
                    <div>
                      <strong>{h.tradingSymbol}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{h.exchange} · {h.segment}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button className="preset-btn" style={{ padding: '2px 5px', fontSize: 10, color: 'var(--gain)' }} onClick={() => { setTicket({ symbol: h.tradingSymbol, side: 'BUY', segment: h.segment, ltp: null }); setGlobalQuery(''); setGlobalHits([]); }}>B</button>
                      <button className="preset-btn" style={{ padding: '2px 5px', fontSize: 10, color: 'var(--loss)' }} onClick={() => { setTicket({ symbol: h.tradingSymbol, side: 'SELL', segment: h.segment, ltp: null }); setGlobalQuery(''); setGlobalHits([]); }}>S</button>
                      <button className="preset-btn" style={{ padding: '2px 5px', fontSize: 10 }} onClick={() => { openChart(h.tradingSymbol, h.segment); setGlobalQuery(''); setGlobalHits([]); }}>Ch</button>
                      <button className="preset-btn" style={{ padding: '2px 5px', fontSize: 10 }} onClick={() => { setDepthTarget({ symbol: h.tradingSymbol, segment: h.segment }); setGlobalQuery(''); setGlobalHits([]); }}>L3</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="theme-toggle" title="Toggle Watchlist Drawer (Alt+W)" onClick={() => setShowWatchlist((v) => !v)}>
            <PanelLeft size={14} />
          </button>

          <button className="theme-toggle" title="Keyboard Shortcuts (?)" onClick={() => setShowShortcuts(true)}>
            <Keyboard size={14} />
          </button>

          <div className="account-switcher" role="group" aria-label="Account mode switcher">
            <button className={`mode-btn ${mode === 'DEMO' ? 'active-demo' : ''}`} onClick={() => setMode('DEMO')}>DEMO</button>
            <button className={`mode-btn ${mode === 'REAL' ? 'active-real' : ''}`} onClick={() => setMode('REAL')}>REAL</button>
          </div>

          <button className="theme-toggle" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button className="theme-toggle" onClick={handleLogout} title={`Signed in as ${user.email}`}>
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <div className={showWatchlist ? 'workspace-with-watchlist' : 'workspace-no-watchlist'}>
        <aside className="sidebar">
          {sections.map((sec) => (
            <div key={sec}>
              <div className="nav-section-label">{sec}</div>
              {NAV_ITEMS.filter((item) => item.section === sec).map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} className={`nav-item ${activeNav === item.id ? 'active' : ''}`} onClick={() => navigateTo(item.id)}>
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {showWatchlist && (
          <WatchlistDrawer
            activeSymbol={activeSymbol.symbol}
            onSelectSymbol={(symbol, segment, ltp) => setActiveSymbol({ symbol, segment, ltp })}
            onTradeClick={(symbol, side, segment, ltp) => setTicket({ symbol, side, segment, ltp })}
            onChartClick={openChart}
            onDepthClick={(symbol, segment) => setDepthTarget({ symbol, segment })}
            onOptionChainClick={openOptionChain}
          />
        )}

        <main className="content">
          <div className="sebi-banner">
            <strong>SEBI Risk Disclosure (Derivatives):</strong> 9 out of 10 individual traders in equity Futures and
            Options incurred net losses (avg. ~₹50,000) plus ~28% additional transaction costs.{' '}
            <strong>Demo Disclaimer:</strong> Demo trading results do not guarantee real trading outcomes.
          </div>

          {(activeNav === 'overview' || activeNav === 'equity' || activeNav === 'fno') && (
            <MarketPage
              view={activeNav}
              onTradeClick={(symbol, side, segment, ltp, priceOverride, initialProduct) =>
                setTicket({ symbol, side, segment, ltp, priceOverride, initialProduct })
              }
              onChartClick={openChart}
              onOptionChainClick={openOptionChain}
            />
          )}

          {activeNav === 'screener' && (
            <ScreenerPage
              onTradeClick={(symbol, side, segment, ltp, priceOverride, initialProduct) =>
                setTicket({ symbol, side, segment, ltp, priceOverride, initialProduct })
              }
              onChartClick={openChart}
              onDepthClick={(symbol, segment) => setDepthTarget({ symbol, segment })}
              onOptionChainClick={openOptionChain}
            />
          )}

          {activeNav === 'etfs' && (
            <EtfsPage
              onTradeClick={(symbol, side, segment, ltp, priceOverride, initialProduct) =>
                setTicket({ symbol, side, segment, ltp, priceOverride, initialProduct })
              }
              onChartClick={openChart}
            />
          )}

          {activeNav === 'commodities' && (
            <CommoditiesPage
              onTradeClick={(symbol, side, segment, ltp, priceOverride, initialProduct) =>
                setTicket({ symbol, side, segment, ltp, priceOverride, initialProduct })
              }
              onChartClick={openChart}
            />
          )}

          {activeNav === 'charts' && (
            <ChartsPage
              mode={mode}
              theme={theme}
              initialSymbol={chartTarget.symbol}
              initialSegment={chartTarget.segment}
              onTradeClick={(symbol, side, segment, ltp, priceOverride, initialProduct) =>
                setTicket({ symbol, side, segment, ltp, priceOverride, initialProduct })
              }
              onOpenOptionChain={(und) => openOptionChain(und || chartTarget.symbol)}
            />
          )}

          {activeNav === 'strategy-lab' && (
            <StrategyLabPage
              mode={mode}
              onTradeClick={(symbol, side, segment, ltp) => setTicket({ symbol, side, segment, ltp })}
            />
          )}

          {activeNav === 'ai-coach' && <AiCoachPage mode={mode} onNavigate={(nav) => navigateTo(nav)} />}

          {activeNav === 'orders' && (
            <OrdersPage mode={mode} onJumpToBlockchain={() => navigateTo('blockchain')} />
          )}

          {activeNav === 'positions' && (
            <PositionsHoldingsPage
              mode={mode}
              account={activeAccount}
              onAccountsUpdated={setAccounts}
              onQuickTrade={(symbol, side, segment, ltp) => setTicket({ symbol, side, segment, ltp })}
            />
          )}

          {activeNav === 'diary' && <TradersDiaryPage mode={mode} />}

          {activeNav === 'controls' && <TradersControlsPage mode={mode} onAccountsUpdated={setAccounts} />}

          {activeNav === 'funds' && (
            <FundsPage mode={mode} account={activeAccount} onAccountsUpdated={setAccounts} />
          )}

          {activeNav === 'reports' && <ReportsPage mode={mode} />}

          {activeNav === 'blockchain' && <BlockchainPage />}

          {activeNav === 'settings' && <SettingsPage user={user} onUserUpdated={setUser} />}

          {activeNav === 'option-chain' && (
            <OptionChainPage
              mode={mode}
              initialUnderlying={chainUnderlying}
              onTradeClick={(symbol, side, segment, ltp) => setTicket({ symbol, side, segment, ltp })}
              onChartClick={openChart}
              onBasketExecuted={refreshAccounts}
            />
          )}
        </main>
      </div>

      {ticket && (
        <OrderTicketModal
          mode={mode}
          symbol={ticket.symbol}
          initialSide={ticket.side}
          segment={ticket.segment}
          ltp={ticket.ltp}
          initialPrice={ticket.priceOverride}
          initialProduct={ticket.initialProduct}
          initialTab={ticket.initialTab}
          onClose={() => setTicket(null)}
          onOrderPlaced={refreshAccounts}
        />
      )}

      {depthTarget && (
        <MarketDepthModal
          symbol={depthTarget.symbol}
          segment={depthTarget.segment}
          onClose={() => setDepthTarget(null)}
          onSelectPrice={(symbol, side, segment, price) => {
            setDepthTarget(null);
            setTicket({ symbol, side, segment, ltp: price, priceOverride: price });
          }}
        />
      )}

      {showShortcuts && (
        <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Keyboard size={16} color="var(--active-mode-accent)" /> Keyboard Shortcuts
              </strong>
              <button className="theme-toggle" onClick={() => setShowShortcuts(false)}><X size={14} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TERMINAL_SHORTCUTS.map((s) => (
                <div key={s.keys} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{s.description}</span>
                  <span className="badge mono">{s.keys}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
