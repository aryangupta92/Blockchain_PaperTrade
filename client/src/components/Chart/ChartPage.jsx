import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import './ChartPage.css';
import api from '../../services/api';
import { io } from 'socket.io-client';
import {
  X, TrendingUp, ChevronRight, Target, Sliders, BellPlus, Activity, Ruler, Star,
  Maximize, Maximize2, Minimize2, Undo2, Redo2, Download, EyeOff, Settings, RefreshCw,
} from 'lucide-react';
const OptionChainPage = lazy(() => import('../OptionChain/OptionChainPage'));
import { getMarketStatus } from '../../utils/sebi';
import { fmtPrice, fmtPct, fmtGap, NoDataBadge, hasPrice } from '../../utils/price';
import DhanToolbar from './DhanToolbar';
import ChartView from '../../chart/ChartView';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1D', '1W'];
const TF_TO_API = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '1D': '1d', '1W': '1wk' };
const TF_TICK = { '1m': 0.01, '5m': 0.05, '15m': 0.05, '30m': 0.05, '1h': 0.05, '1D': 0.05, '1W': 0.05 };
// Sensible full-history defaults per timeframe, with an explicit range override.
const TF_DEFAULT_RANGE = { '1m': '5d', '5m': '1mo', '15m': '3mo', '30m': '6mo', '1h': '1y', '1D': 'max', '1W': 'max' };
const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max'];
const RANGE_LABEL = { '1d': '1D', '5d': '5D', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', '5y': '5Y', max: 'MAX' };

const CHART_TYPES = [
  { id: 'candle', label: 'Candles' },
  { id: 'heikin', label: 'Heikin' },
  { id: 'hollow', label: 'Hollow' },
  { id: 'bars', label: 'Bars' },
  { id: 'renko', label: 'Renko' },
  { id: 'area', label: 'Area' },
  { id: 'line', label: 'Line' },
];

const INDICATORS = [
  { id: 'ema9', label: 'EMA 9', color: '#f7a600' },
  { id: 'ema20', label: 'EMA 20', color: '#2962ff' },
  { id: 'ema50', label: 'EMA 50', color: '#ff6d00' },
  { id: 'ema200', label: 'EMA 200', color: '#e91e63' },
  { id: 'vwap', label: 'VWAP', color: '#ab47bc' },
  { id: 'bb', label: 'Bollinger', color: '#94a3b8' },
  { id: 'supertrend', label: 'SuperTrend', color: '#26a69a' },
  { id: 'sar', label: 'SAR', color: '#ef5350' },
  { id: 'ichimoku', label: 'Ichimoku', color: '#2962ff' },
  { id: 'rsi', label: 'RSI 14', color: '#a855f7' },
  { id: 'macd', label: 'MACD', color: '#22d3ee' },
  { id: 'stochastic', label: 'Stoch', color: '#f7a600' },
  { id: 'adx', label: 'ADX', color: '#22d3ee' },
  { id: 'obv', label: 'OBV', color: '#26a69a' },
  { id: 'cci', label: 'CCI', color: '#a855f7' },
  { id: 'mfi', label: 'MFI', color: '#ff6d00' },
  { id: 'williamsR', label: 'W%R', color: '#e91e63' },
  { id: 'volumeProfile', label: 'Vol Profile', color: '#f7a600' },
  { id: 'volume', label: 'Volume', color: '#94a3b8' },
];

// The canvas engine has a fixed plot area; cap stacked sub-panes so candles stay readable.
const PANE_INDICATORS = ['rsi', 'macd', 'stochastic', 'adx', 'obv', 'cci', 'mfi', 'williamsR'];
const MAX_PANES = 3;

function getISTClock() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()) + ' IST';
}

export default function ChartPage({
  symbol,
  symbolData,
  onClose,
  onTrade,
  holdings,
  balance,
  watchlist,
  onAddWatch,
  onRemWatch,
  quotes = {},
}) {
  const [timeframe, setTimeframe] = useState('5m');
  const [range, setRange] = useState(TF_DEFAULT_RANGE['5m']);
  const [chartType, setChartType] = useState('candle');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [quote, setQuote] = useState(symbolData || null);
  const [activeTab, setActiveTab] = useState('overview');
  const [currentPrice, setCurrentPrice] = useState(symbolData?.price || 0);

  const [indicators, setIndicators] = useState({
    ema9: false, ema20: true, ema50: false, ema200: false,
    vwap: true, bb: false, supertrend: false, sar: false, ichimoku: false,
    rsi: true, macd: true, stochastic: false, adx: false, obv: false,
    cci: false, mfi: false, williamsR: false, volumeProfile: false,
  });
  const [showVolume, setShowVolume] = useState(true);
  const [showSR, setShowSR] = useState(true);
  const chartViewRef = useRef(null);

  const [drawings, setDrawings] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [captureToken, setCaptureToken] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pageRef = useRef(null);
  const [activeTool, setActiveTool] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [magnet, setMagnet] = useState(true);
  const [saveMsg, setSaveMsg] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [alertMsg, setAlertMsg] = useState('');
  const [tradeMarkers, setTradeMarkers] = useState([]);
  const [fitToken, setFitToken] = useState(0);
  const [zoomToken, setZoomToken] = useState(0);
  const [zoomDir, setZoomDir] = useState(1);
  const [watchQuotes, setWatchQuotes] = useState({});
  const [news, setNews] = useState([]);
  const [rightTab, setRightTab] = useState('watch');
  const [forecast, setForecast] = useState(null);
  const [clock, setClock] = useState(getISTClock());
  const [newsRefreshTimer, setNewsRefreshTimer] = useState(30);

  // ── socket live feed (fixes delayed chart data) ────────────────────────────
  const socketRef = useRef(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [dataFreshness, setDataFreshness] = useState('LIVE');
  const socketUrl = useRef('http://localhost:5000');

  // ── chart settings ─────────────────────────────────────────────────────────
  const [logScale, setLogScale] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [indSettingsOpen, setIndSettingsOpen] = useState(false);
  const [indDropdownOpen, setIndDropdownOpen] = useState(false);
  const [compareSymbol, setCompareSymbol] = useState('');
  const [compareData, setCompareData] = useState([]);
  const [replayMode, setReplayMode] = useState(false);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayPaused, setReplayPaused] = useState(false);
  const replayTimerRef = useRef(null);
  const [indicatorParams, setIndicatorParams] = useState({
    ema9: { period: 9 }, ema20: { period: 20 }, ema50: { period: 50 }, ema200: { period: 200 },
    rsi: { period: 14 }, macd: { fast: 12, slow: 26, signal: 9 },
    bb: { period: 20, mult: 2 }, supertrend: { period: 10, mult: 3 },
    stochastic: { k: 14, d: 3 }, adx: { period: 14 }, obv: {}, cci: { period: 20 },
    mfi: { period: 14 }, williamsR: { period: 14 }, vwap: {}, volumeProfile: {},
  });

  const isIndex = symbol?.startsWith('^');
  const held = holdings?.[symbol]?.quantity || 0;
  const avgBuy = holdings?.[symbol]?.avgPrice || 0;
  const unrealizedPL = held > 0 && currentPrice ? (currentPrice - avgBuy) * held : 0;
  const isWatched = watchlist?.includes(symbol);

  const symClean = symbol?.replace('.NS', '').replace('.BO', '');
  const symCanonical = symbol?.endsWith('.NS') || symbol?.startsWith('^') ? symbol : `${symbol}.NS`;
  const liveQ = quotes[symbol] || quotes[symCanonical] || quotes[symClean] || null;

  // ── live clock tick ───────────────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setClock(getISTClock()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── news countdown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (rightTab !== 'news') return;
    setNewsRefreshTimer(30);
    const iv = setInterval(() => {
      setNewsRefreshTimer((t) => {
        if (t <= 1) { refreshNews(); return 30; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [rightTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── live quote ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (liveQ?.price) { setCurrentPrice(liveQ.price); setQuote(liveQ); }
  }, [liveQ]);

  // ── candles ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const tf = TF_TO_API[timeframe] || '5m';
      const bars = await api.getCandles(symbol, range, tf);
      setData(bars || []);
      if (bars?.length) setCurrentPrice(bars[bars.length - 1].close);
    } catch (err) {
      console.error('Chart load error:', err);
      if (!silent) setLoadError(err.message || 'Could not load candles');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [symbol, timeframe, range]);

  useEffect(() => { loadData(); }, [loadData]);

  // Keep the newest bar complete while the market is open (TradingView-style live refresh).
  useEffect(() => {
    const iv = setInterval(() => {
      if (getMarketStatus().open) loadData({ silent: true });
    }, 15000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── socket.io live quotes (fixes delayed chart data) ───────────────────────
  useEffect(() => {
    const sym = symCanonical;
    if (!sym) return;
    const socket = io(socketUrl.current, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      setDataFreshness('LIVE');
      socket.emit('subscribe:quotes', [sym]);
    });
    socket.on('disconnect', () => {
      setSocketConnected(false);
      setDataFreshness('DELAYED');
    });
    socket.on('quotes:update', (q) => {
      if (!q || !q.price) return;
      const canonicalQ = String(q.symbol || q.tradingSymbol || '').toUpperCase();
      if (canonicalQ !== sym.toUpperCase() && canonicalQ !== symbol.toUpperCase()) return;
      setCurrentPrice(q.price);
      setQuote(q);
      setDataFreshness('LIVE');
      const nowSec = Math.floor(Date.now() / 1000);
      chartViewRef.current?.appendTick?.(q.price, 0, nowSec, timeframe);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [symCanonical, symbol]);

  // ── compare symbol overlay ─────────────────────────────────────────────────
  useEffect(() => {
    let on = true;
    if (!compareSymbol) { setCompareData([]); return; }
    const tf = TF_TO_API[timeframe] || '5m';
    const range = TF_DEFAULT_RANGE[timeframe] || '5d';
    api.getCandles(compareSymbol, range, tf).then((bars) => {
      if (!on || !bars?.length) { if (on) setCompareData([]); return; }
      const first = bars[0].close;
      const symFirst = data.length ? data[0].close : first;
      const factor = symFirst / first;
      const normalized = bars.map((b) => ({ time: b.time, value: +(b.close * factor).toFixed(2) }));
      if (on) setCompareData(normalized);
    }).catch(() => { if (on) setCompareData([]); });
    return () => { on = false; };
  }, [compareSymbol, timeframe, data]);

  // ── replay mode ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!replayMode || !data.length || replayPaused) { replayTimerRef.current && clearInterval(replayTimerRef.current); return; }
    const ms = Math.max(100, 1000 / replaySpeed);
    replayTimerRef.current = setInterval(() => {
      setReplayIdx((i) => (i >= data.length - 1 ? 0 : i + 1));
    }, ms);
    return () => { replayTimerRef.current && clearInterval(replayTimerRef.current); };
  }, [replayMode, replaySpeed, data.length, replayPaused]);

  const changeTimeframe = (tf) => {
    setTimeframe(tf);
    setRange(TF_DEFAULT_RANGE[tf] || '5d');
  };

  // ── drawings persistence + undo/redo ──────────────────────────────────────
  useEffect(() => {
    let on = true;
    setDrawings([]); setActiveTool(null); setMeasureMode(false);
    setUndoStack([]); setRedoStack([]);
    api.getDrawings(symbol).then((d) => { if (on) setDrawings(d?.drawings || []); }).catch(() => {});
    return () => { on = false; };
  }, [symbol]);

  const saveDrawings = useCallback(async (next) => {
    setDrawings(next);
    try {
      await api.saveDrawings(symbol, next);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 1200);
    } catch { setSaveMsg('Save failed'); }
  }, [symbol]);

  const persistDrawings = useCallback(async (next, { record = true } = {}) => {
    if (record) {
      setUndoStack((prev) => [...prev.slice(-49), drawings]);
      setRedoStack([]);
    }
    await saveDrawings(next);
  }, [drawings, saveDrawings]);

  const undoDrawings = useCallback(() => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((prev) => [...prev, drawings]);
    saveDrawings(previous);
  }, [undoStack, drawings, saveDrawings]);

  const redoDrawings = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((prev) => [...prev, drawings]);
    saveDrawings(next);
  }, [redoStack, drawings, saveDrawings]);

  const handleNewDrawing = useCallback((d) => {
    persistDrawings([...drawings, d]);
  }, [drawings, persistDrawings]);

  const handleDeleteDrawing = useCallback((d) => {
    persistDrawings(drawings.filter((x) => x.id !== d.id));
  }, [drawings, persistDrawings]);

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoDrawings(); else undoDrawings();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoDrawings();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoDrawings, redoDrawings]);

  // ── fullscreen ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === pageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else pageRef.current?.requestFullscreen?.();
  };

  const downloadChart = useCallback((url) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symClean || 'chart'}-${timeframe}-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }, [symClean, timeframe]);

  const createAlertAtPrice = async () => {
    const input = window.prompt('Price alert level (₹)', currentPrice ? String(currentPrice) : '');
    if (input == null) return;
    const price = Number(input);
    if (!Number.isFinite(price) || price <= 0) return;
    try {
      await api.createAlert({
        symbol,
        type: price >= currentPrice ? 'PRICE_ABOVE' : 'PRICE_BELOW',
        triggerValue: price,
        message: `${symClean} ${price >= currentPrice ? 'crossed above' : 'fell below'} ₹${price}`,
      });
      setAlertMsg(`Alert set @ ₹${fmtPrice(price)}`);
    } catch (e) { setAlertMsg('Alert failed: ' + e.message); }
    setTimeout(() => setAlertMsg(''), 2500);
  };

  const toggleIndicator = (id) => {
    if (id === 'volume') { setShowVolume((v) => !v); return; }
    setIndicators((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (PANE_INDICATORS.includes(id) && next[id]) {
        const active = PANE_INDICATORS.filter((k) => next[k]);
        if (active.length > MAX_PANES) {
          const oldest = active.find((k) => k !== id);
          if (oldest) next[oldest] = false;
        }
      }
      return next;
    });
  };

  // ── trade markers from history ────────────────────────────────────────────
  useEffect(() => {
    let on = true;
    api.getTrades(100, 0).then((d) => {
      if (!on) return;
      const trades = (d.trades || []).filter((t) => {
        const s = t.instrument?.tradingSymbol || t.symbol || '';
        return s === symbol || s.replace('.NS', '') === String(symbol).replace('.NS', '');
      }).slice(0, 40);
      if (!data.length) return;
      const markers = trades.map((t) => {
        const tx = Math.floor(new Date(t.executedAt).getTime() / 1000);
        let best = null; let bestD = Infinity;
        for (const c of data) { const dd = Math.abs(c.time - tx); if (dd < bestD) { bestD = dd; best = c.time; } }
        return { time: best, side: String(t.side).toLowerCase(), price: t.price, qty: t.quantity };
      }).filter((m) => m.time != null);
      setTradeMarkers(markers);
    }).catch(() => {});
    return () => { on = false; };
  }, [data, symbol]);

  // ── Escape cancels a tool ─────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { setActiveTool(null); setMeasureMode(false); setCtxMenu(null); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── right-panel watchlist universe ───────────────────────────────────────
  const WATCH_UNIVERSE = useCallback(() => {
    const base = ['^NSEI', '^BSESN', '^NSEBANK', '^CNXIT', '^CNXAUTO', '^CNXPHARMA'];
    const wl = (watchlist || []).slice(0, 12);
    return [...new Set([...base, ...wl, symbol])];
  }, [watchlist, symbol]);

  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const qs = await api.getQuotes(WATCH_UNIVERSE().join(','));
        if (!on || !qs) return;
        const map = {};
        (Array.isArray(qs) ? qs : [qs]).forEach((q) => { if (q?.symbol) map[q.symbol] = q; });
        setWatchQuotes(map);
      } catch { /* watchlist quotes are optional */ }
    };
    load();
    const iv = setInterval(load, 20000);
    return () => { on = false; clearInterval(iv); };
  }, [WATCH_UNIVERSE]);

  // merge the socket-fed `quotes` prop so the panel updates in real time
  const panelQuotes = { ...watchQuotes };
  Object.entries(quotes || {}).forEach(([k, q]) => { if (q?.price != null) panelQuotes[k] = q; });

  // ── news loading ─────────────────────────────────────────────────────────
  const refreshNews = useCallback(async () => {
    try {
      const n = await api.getNews();
      setNews((n || []).slice(0, 15));
    } catch { /* news is optional */ }
  }, []);

  useEffect(() => {
    refreshNews();
  }, [refreshNews]);

  // ── Phase 3: trained direction forecast ───────────────────────────────────
  useEffect(() => {
    let on = true;
    setForecast(null);
    api.getForecast(symbol?.replace('.NS', ''), timeframe)
      .then((f) => { if (on) setForecast(f); })
      .catch(() => {});
    return () => { on = false; };
  }, [symbol, timeframe, data.length]);

  // ── chart data fed to the engine ──────────────────────────────────────────
  const engineData = replayMode && data.length ? data.slice(0, Math.min(replayIdx + 1, data.length)) : data;
  const engineIndicators = { ...indicators, volume: showVolume };
  const livePrice = getMarketStatus().open ? currentPrice : null;

  // ── order form state ──────────────────────────────────────────────────────
  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [orderQty, setOrderQty] = useState(1);
  const [orderType, setOrderType] = useState('market');
  const [orderPrice, setOrderPrice] = useState('');
  const [tradeResult, setTradeResult] = useState(null);

  const executeTrade = async (side, price) => {
    const px = price || currentPrice;
    if (!px) return;
    try {
      const result = await onTrade({ type: side, symbol, quantity: Number(orderQty), price: px, orderType });
      setTradeResult({ side, price: px, qty: orderQty, ...result });
      setShowBuy(false); setShowSell(false);
    } catch (err) {
      setTradeResult({ error: err.message });
    }
  };

  // ── computed values ──────────────────────────────────────────────────────
  const liveChange = quote?.changePercent != null ? quote.changePercent : 0;
  const isGain = liveChange >= 0;
  const changePct = fmtPct(liveChange);
  const marketStatus = getMarketStatus();

  const dayLow = quote?.low ?? (data.length ? Math.min(...data.map((d) => d.low)) : null);
  const dayHigh = quote?.high ?? (data.length ? Math.max(...data.map((d) => d.high)) : null);
  const week52Low = quote?.week52Low ?? null;
  const week52High = quote?.week52High ?? null;
  const prevClose = quote?.prevClose ?? (data.length > 1 ? data[data.length - 2]?.close : null);
  const open = quote?.open ?? (data.length ? data[0]?.open : null);
  const volume = quote?.volume ?? null;
  const avgPrice = quote?.avgPrice ?? null;
  const marketCap = quote?.marketCap ?? null;
  const pe = quote?.pe ?? null;

  // Total P&L across all positions
  const totalPL = Object.entries(holdings || {}).reduce((sum, [sym, h]) => {
    if (!h?.quantity || !h?.avgPrice) return sum;
    const q = quotes[sym] || quotes[sym + '.NS'] || quotes[sym.replace('.NS', '')];
    const px = q?.price || 0;
    return sum + (px - h.avgPrice) * h.quantity;
  }, 0);

  return (
    <div className="chart-page" ref={pageRef}>
      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div className="cpage-topbar">
        {/* Row 1: Symbol info + Chart type + Actions */}
        <div className="cpage-title-row">
          {/* Left: Symbol name, price, change, live dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                {symbolData?.shortName || symbol}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
                {isIndex ? 'Index' : 'NSE'} · {timeframe}
              </span>
            </div>
            {hasPrice(currentPrice) ? (
              <>
                <div style={{ width: 1, height: 28, background: 'var(--border)', borderRadius: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <div className={`cpage-price ${isGain ? 'gain' : 'loss'}`}>
                    ₹{fmtPrice(currentPrice)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={`mover-change-pill ${isGain ? 'gain' : 'loss'}`}>
                      {isGain ? '▲ ' : '▼ '}{fmtGap(quote?.change)} {changePct}
                    </span>
                    <span className="live-indicator-dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 99, background: socketConnected ? 'var(--gain)' : '#f59e0b', boxShadow: socketConnected ? '0 0 6px var(--gain)' : '0 0 6px #f59e0b' }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: socketConnected ? 'var(--gain)' : '#f59e0b', marginLeft: 4 }}>{dataFreshness}</span>
                  </div>
                </div>
              </>
            ) : <NoDataBadge />}
          </div>

          {/* Center: Chart type selector */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 3, gap: 2, border: '1px solid var(--border)' }}>
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.id}
                className={`cpage-chart-type-btn ${chartType === ct.id ? 'active' : ''}`}
                onClick={() => setChartType(ct.id)}
                style={{ border: 'none', padding: '5px 10px', borderRadius: 6 }}
              >
                {ct.label}
              </button>
            ))}
          </div>

          {/* Right: Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="cpage-tf-btn"
              onClick={() => isWatched ? onRemWatch?.(symbol) : onAddWatch?.(symbol)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11 }}
            >
              <Star size={12} fill={isWatched ? 'var(--accent-primary)' : 'none'} color={isWatched ? 'var(--accent-primary)' : 'var(--text-muted)'} />
              {isWatched ? 'Watched' : 'Watch'}
            </button>
            <button className="cpage-tf-btn" title="Fit content" onClick={() => setFitToken((t) => t + 1)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <Maximize size={13} />
            </button>
            <button className="cpage-tf-btn" title="Refresh chart data" onClick={() => loadData()} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <RefreshCw size={13} />
            </button>
            <button
              className="cpage-tf-btn"
              title="Undo drawing (Ctrl+Z)"
              onClick={undoDrawings}
              disabled={!undoStack.length}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', opacity: undoStack.length ? 1 : 0.4 }}
            >
              <Undo2 size={13} />
            </button>
            <button
              className="cpage-tf-btn"
              title="Redo drawing (Ctrl+Shift+Z)"
              onClick={redoDrawings}
              disabled={!redoStack.length}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', opacity: redoStack.length ? 1 : 0.4 }}
            >
              <Redo2 size={13} />
            </button>
            <button className="cpage-tf-btn" title="Download chart PNG" onClick={() => setCaptureToken((t) => t + 1)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <Download size={13} />
            </button>
            <button className="cpage-tf-btn" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button className={`cpage-tf-btn ${logScale ? 'bg-active' : ''}`} title="Log scale" onClick={() => setLogScale((l) => !l)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: logScale ? 'rgba(99,102,241,0.2)' : 'transparent' }}>
              <EyeOff size={13} />
            </button>
            <button className="cpage-tf-btn" title="Chart settings" onClick={() => setSettingsOpen(true)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <Settings size={13} />
            </button>
            <button className="cpage-tf-btn" title="Quick Buy" onClick={() => { setOrderType('market'); setShowBuy(true); }} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--gain)', background: 'rgba(38,166,154,0.15)', color: 'var(--gain)', fontSize: 11, fontWeight: 700 }}>
              BUY
            </button>
            <button className="cpage-tf-btn" title="Quick Sell" onClick={() => { setOrderType('market'); setShowSell(true); }} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--loss)', background: 'rgba(239,83,80,0.15)', color: 'var(--loss)', fontSize: 11, fontWeight: 700 }}>
              SELL
            </button>
            <button className="cpage-tf-btn" title="Create price alert" onClick={createAlertAtPrice} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <BellPlus size={13} />
            </button>
            <button className="btn btn-ghost" style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }} onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Row 2: Indicator dropdown (compact) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 14px', borderTop: '1px solid rgba(33,38,45,0.6)', position: 'relative' }}>
          <button
            onClick={() => setIndDropdownOpen((o) => !o)}
            style={{
              fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)',
              color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Sliders size={11} /> Indicators
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>▾</span>
          </button>
          <button title="Indicator settings" onClick={() => setIndSettingsOpen(true)} style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <Settings size={11} />
          </button>
          {/* Active indicator chips */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1 }}>
            {INDICATORS.filter((ind) => (ind.id === 'volume' ? showVolume : indicators[ind.id])).map((ind) => (
              <span key={ind.id} style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: `${ind.color}20`, color: ind.color, border: `1px solid ${ind.color}40`, whiteSpace: 'nowrap' }}>
                {ind.label}
              </span>
            ))}
          </div>
          {indDropdownOpen && (
            <>
              <div onClick={() => setIndDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
              <div style={{ position: 'absolute', top: '100%', left: 14, zIndex: 50, background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 8, minWidth: 260, maxHeight: 320, overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {INDICATORS.map((ind) => {
                const active = ind.id === 'volume' ? showVolume : indicators[ind.id];
                return (
                  <button
                    key={ind.id}
                    onClick={() => toggleIndicator(ind.id)}
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 4, textAlign: 'left',
                      border: active ? `1px solid ${ind.color}` : '1px solid rgba(255,255,255,0.06)',
                      background: active ? `${ind.color}20` : 'transparent',
                      color: active ? ind.color : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {ind.label}
                  </button>
                );
              })}
              <button
                onClick={() => setShowSR((v) => !v)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 4, textAlign: 'left',
                  border: showSR ? '1px solid #26a69a' : '1px solid rgba(255,255,255,0.06)',
                  background: showSR ? 'rgba(38,166,154,0.12)' : 'transparent',
                  color: showSR ? '#26a69a' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                S/R Zones
              </button>
            </div>
            </>
          )}
        </div>

        {/* Row 3: OHLC bar */}
        <div className="cpage-ohlc-bar">
          <span className="ohlc-label" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {symClean} · {timeframe}
          </span>
          {data.length > 0 && (
            <span className="ohlc-data" title={`Range ${RANGE_LABEL[range]} · ${data.length} bars`}>
              {data.length.toLocaleString('en-IN')} bars{data.source ? ` · ${data.source}` : ''}
            </span>
          )}
          {data.length > 0 && (() => {
            const last = data[data.length - 1];
            const up = last.close >= last.open;
            return <>
              <span>O <strong style={{ color: up ? 'var(--gain)' : 'var(--loss)' }}>{fmtPrice(last.open)}</strong></span>
              <span>H <strong style={{ color: up ? 'var(--gain)' : 'var(--loss)' }}>{fmtPrice(last.high)}</strong></span>
              <span>L <strong style={{ color: up ? 'var(--gain)' : 'var(--loss)' }}>{fmtPrice(last.low)}</strong></span>
              <span>C <strong style={{ color: up ? 'var(--gain)' : 'var(--loss)' }}>{fmtPrice(last.close)}</strong></span>
              <span style={{ color: up ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
                {fmtGap(last.close - last.open)} ({fmtPct(last.open ? ((last.close - last.open) / last.open) * 100 : 0)})
              </span>
            </>;
          })()}
          {held > 0 && (
            <span className="ohlc-pnl">
              <span className="ohlc-holding-badge">Holding {held} @ {fmtPrice(avgBuy)}</span>
              <span className={unrealizedPL >= 0 ? 'gain' : 'loss'}>
                {unrealizedPL >= 0 ? '+' : ''}₹{Math.abs(unrealizedPL).toFixed(2)}
              </span>
            </span>
          )}
          {forecast?.state === 'live' && (
            <span
              title={`Trained on ${forecast.rows} bars · walk-forward ${(forecast.pooledAcc * 100).toFixed(1)}% accuracy`}
              style={{
                fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99, cursor: 'help',
                background: forecast.direction === 'UP' ? 'rgba(8,153,129,0.15)' : 'rgba(242,54,69,0.15)',
                border: `1px solid ${forecast.direction === 'UP' ? 'rgba(8,153,129,0.5)' : 'rgba(242,54,69,0.5)'}`,
                color: forecast.direction === 'UP' ? 'var(--gain)' : 'var(--loss)',
              }}
            >
              AI {forecast.direction} {(forecast.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {/* ══ BODY ═════════════════════════════════════════════════════════════ */}
      <div className="cpage-body">
        {/* ── Left Toolbar ─────────────────────────────────────────────────── */}
        <DhanToolbar
          activeTool={activeTool}
          onTool={(t) => { setActiveTool(t); setMeasureMode(false); }}
          magnet={magnet}
          onMagnet={() => setMagnet((m) => !m)}
          onClear={() => { if (window.confirm('Delete all drawings for ' + symbol + '?')) persistDrawings([]); }}
          onSave={() => persistDrawings(drawings, { record: false })}
          saveState={saveMsg || `${drawings.length} drawings`}
          onZoomIn={() => { setZoomDir(1); setZoomToken((t) => t + 1); }}
          onZoomOut={() => { setZoomDir(-1); setZoomToken((t) => t + 1); }}
          onResetView={() => setFitToken((t) => t + 1)}
          onMeasure={() => { setMeasureMode((m) => !m); setActiveTool(null); }}
          measureActive={measureMode}
        />

        {/* ── Chart Area ──────────────────────────────────────────────────── */}
        <div className="cpage-chart-wrap">
          {/* Loading spinner */}
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,17,23,0.7)', zIndex: 20 }}>
              <div className="spinner" />
            </div>
          )}

          {/* Empty / error state — never leave a blank canvas */}
          {!loading && data.length === 0 && (
            <div className="cpage-chart-empty">
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                {loadError ? 'Chart data unavailable' : 'No candles for this timeframe'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.6, textAlign: 'center' }}>
                {loadError || `The feed returned no bars for ${symbol} at ${timeframe}. Try another timeframe or refresh the data feed.`}
              </div>
              <button className="btn btn-primary" style={{ marginTop: 12, fontSize: 12 }} onClick={() => loadData()}>Retry</button>
            </div>
          )}

          {/* Chart engine */}
          <ChartView
            ref={chartViewRef}
            key={`${symbol}-${timeframe}`}
            symbol={symbol}
            timeframe={timeframe}
            data={engineData}
            chartType={chartType}
            indicators={engineIndicators}
            showSR={showSR}
            drawings={drawings}
            markers={tradeMarkers}
            activeTool={activeTool}
            magnet={magnet}
            livePrice={livePrice}
            tickSize={TF_TICK[timeframe] || 0.05}
            fitToken={fitToken}
            zoomToken={zoomToken}
            zoomDir={zoomDir}
            captureToken={captureToken}
            onCapture={downloadChart}
            measureMode={measureMode}
            logScale={logScale}
            replayMode={replayMode}
            compare={compareData}
            indicatorParams={indicatorParams}
            onNewDrawing={handleNewDrawing}
            onDeleteDrawing={handleDeleteDrawing}
            onToolDone={() => setActiveTool(null)}
            onContextMenu={(p) => setCtxMenu({ x: p.x, y: p.y, price: p.price })}
          />

          {/* Order form popup */}
          {(showBuy || showSell) && (
            <div className="chart-order-form">
              <div className="chart-order-form-header">
                <span style={{ fontWeight: 700, color: showBuy ? 'var(--gain)' : 'var(--loss)', fontSize: 13 }}>
                  {showBuy ? '+' : '-'} {showBuy ? 'BUY' : 'SELL'} {symClean}
                </span>
                <button onClick={() => { setShowBuy(false); setShowSell(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={14} /></button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button className={`chart-order-type-btn ${orderType === 'market' ? 'active' : ''}`} onClick={() => setOrderType('market')}>Market</button>
                <button className={`chart-order-type-btn ${orderType === 'limit' ? 'active' : ''}`} onClick={() => setOrderType('limit')}>Limit</button>
              </div>
              {orderType === 'limit' && (
                <input className="input" type="number" value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} placeholder="Limit Price" style={{ marginBottom: 8, fontSize: 12 }} />
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => setOrderQty((q) => Math.max(1, q - 1))}>-</button>
                <input className="input" type="number" value={orderQty} onChange={(e) => setOrderQty(Number(e.target.value))} min={1} style={{ textAlign: 'center', width: 60, fontSize: 12 }} />
                <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => setOrderQty((q) => q + 1)}>+</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Total: ₹{fmtPrice((orderType === 'market' ? currentPrice : Number(orderPrice)) * orderQty)} | Balance: ₹{fmtPrice(balance)}
              </div>
              <button className={showBuy ? 'btn-gain' : 'btn-loss'} onClick={() => executeTrade(showBuy ? 'buy' : 'sell', orderType === 'limit' ? Number(orderPrice) : null)} style={{ fontSize: 12 }}>
                {showBuy ? 'BUY' : 'SELL'} {orderQty} x {symClean}
              </button>
              {tradeResult?.error && <div style={{ fontSize: 11, color: 'var(--loss)', marginTop: 6 }}>{tradeResult.error}</div>}
            </div>
          )}

          {/* Context menu (right-click) */}
          {ctxMenu && (
            <div style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 100, background: '#1c2128', border: '1px solid #30363d', borderRadius: 10, padding: 6, minWidth: 220, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }} onMouseLeave={() => setCtxMenu(null)}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>₹{fmtPrice(ctxMenu.price)} | {symClean}</div>
              <button className="cpage-tf-btn" style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 6 }} onClick={async () => {
                try {
                  await api.createAlert({ symbol, type: ctxMenu.price >= currentPrice ? 'PRICE_ABOVE' : 'PRICE_BELOW', triggerValue: ctxMenu.price, message: `${symClean} ${ctxMenu.price >= currentPrice ? 'crossed above' : 'fell below'} at ${ctxMenu.price}` });
                  setAlertMsg(`Alert set @ ₹${fmtPrice(ctxMenu.price)}`);
                } catch (e) { setAlertMsg('Alert failed: ' + e.message); }
                setCtxMenu(null); setTimeout(() => setAlertMsg(''), 2500);
              }}><BellPlus size={13} /> Create price alert</button>
              {!isIndex && (
                <div style={{ display: 'flex', gap: 6, padding: '4px 8px' }}>
                  <button className="chart-buy-btn" onClick={() => { executeTrade('buy', currentPrice); setCtxMenu(null); }}>Buy here</button>
                  <button className="chart-sell-btn" onClick={() => { executeTrade('sell', currentPrice); setCtxMenu(null); }}>Sell here</button>
                </div>
              )}
            </div>
          )}
          {alertMsg && <div className="chart-trade-toast success" style={{ zIndex: 30 }}>{alertMsg}</div>}
        </div>

        {/* ══ RIGHT PANEL ═══════════════════════════════════════════════════ */}
        <div className="cpage-info-panel">
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            {[
              { id: 'watch', label: 'Watchlist' },
              { id: 'detail', label: symClean },
              { id: 'news', label: 'News' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setRightTab(t.id)}
                style={{
                  flex: 1, padding: '9px 4px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: 'transparent', border: 'none',
                  borderBottom: rightTab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  color: rightTab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  transition: 'var(--transition)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Watchlist tab ─────────────────────────────────────────────── */}
          {rightTab === 'watch' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--text-muted)', padding: '8px 12px 4px', fontWeight: 700, letterSpacing: '0.05em' }}>
                <span style={{ flex: 2 }}>SYMBOL</span>
                <span style={{ flex: 1, textAlign: 'right' }}>LAST</span>
                <span style={{ flex: 1, textAlign: 'right' }}>CHG</span>
                <span style={{ flex: 1, textAlign: 'right' }}>CHG%</span>
              </div>
              {WATCH_UNIVERSE().map((s) => {
                const q = panelQuotes[s] || panelQuotes[s.replace('.NS', '')] || panelQuotes[s.replace('.BO', '')];
                const p = q?.price;
                const pct = q?.changePercent;
                const ok = hasPrice(p);
                const gain = (pct || 0) >= 0;
                const isActive = s === symbol;
                const isIdx = s.startsWith('^');
                return (
                  <button
                    key={s}
                    onClick={() => onTrade?.({ __switchSymbol: true, symbol: s })}
                    title={`Open ${s} chart`}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', padding: '7px 12px',
                      background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                      border: 'none', borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'pointer', fontSize: 12, transition: 'var(--transition)',
                    }}
                  >
                    <div style={{ flex: 2, textAlign: 'left', overflow: 'hidden' }}>
                      <div style={{ fontWeight: 700, color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.replace('.NS', '')}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>
                        {isIdx ? 'Index' : s.endsWith('.BO') ? 'BSE' : 'NSE'}
                      </div>
                    </div>
                    {ok ? (
                      <>
                        <span style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{fmtPrice(p)}</span>
                        <span style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', color: gain ? 'var(--gain)' : 'var(--loss)', fontSize: 11 }}>{fmtGap(q?.change)}</span>
                        <span style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: gain ? 'var(--gain)' : 'var(--loss)', fontSize: 11 }}>{fmtPct(pct)}</span>
                      </>
                    ) : (
                      <span style={{ flex: 3, textAlign: 'right' }}><NoDataBadge compact /></span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Symbol Detail tab ─────────────────────────────────────────── */}
          {rightTab === 'detail' && (
            <div style={{ padding: '14px' }}>
              {/* Header */}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, fontWeight: 600 }}>
                {isIndex ? 'Index' : 'NSE'} · {symClean}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{symbolData?.shortName || symClean}</div>
              <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'var(--font-mono)', color: isGain ? 'var(--gain)' : 'var(--loss)', marginTop: 6, letterSpacing: '-0.02em' }}>
                {hasPrice(currentPrice) ? `₹${fmtPrice(currentPrice)}` : <NoDataBadge />}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: isGain ? 'var(--gain)' : 'var(--loss)', marginTop: 2 }}>
                {fmtGap(quote?.change)} ({fmtPct(liveChange)})
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="live-indicator-dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 99, background: marketStatus.open ? 'var(--gain)' : '#f59e0b' }} />
                {marketStatus.status === 'OPEN' ? 'Market open' : marketStatus.reason}
              </div>

              <div className="info-divider" />

              {/* Day's Range */}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700, letterSpacing: '0.05em' }}>DAY&apos;S RANGE</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 4px' }}>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--loss)', fontWeight: 700 }}>{fmtPrice(dayLow)}</span>
                <div style={{ flex: 1, height: 4, background: 'linear-gradient(90deg, var(--loss), var(--gain))', borderRadius: 4, position: 'relative' }}>
                  {hasPrice(currentPrice) && hasPrice(dayLow) && hasPrice(dayHigh) && dayHigh > dayLow && (
                    <span style={{ position: 'absolute', left: `${Math.min(100, Math.max(0, ((currentPrice - dayLow) / (dayHigh - dayLow)) * 100))}%`, top: -3, width: 2, height: 10, background: '#fff', borderRadius: 2 }} />
                  )}
                </div>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--gain)', fontWeight: 700 }}>{fmtPrice(dayHigh)}</span>
              </div>

              {/* 52-Week Range */}
              {hasPrice(week52Low) && hasPrice(week52High) && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700, letterSpacing: '0.05em', marginTop: 10 }}>52-WEEK RANGE</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--loss)' }}>{fmtPrice(week52Low)}</span>
                    <div style={{ flex: 1, height: 4, background: 'linear-gradient(90deg, var(--loss), var(--gain))', borderRadius: 4, position: 'relative' }}>
                      {hasPrice(currentPrice) && week52High > week52Low && (
                        <span style={{ position: 'absolute', left: `${Math.min(100, Math.max(0, ((currentPrice - week52Low) / (week52High - week52Low)) * 100))}%`, top: -3, width: 2, height: 10, background: '#fff', borderRadius: 2 }} />
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--gain)' }}>{fmtPrice(week52High)}</span>
                  </div>
                </>
              )}

              <div className="info-divider" />

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginTop: 4 }}>
                {[
                  { label: 'Open', value: hasPrice(open) ? `₹${fmtPrice(open)}` : '--' },
                  { label: 'Prev Close', value: hasPrice(prevClose) ? `₹${fmtPrice(prevClose)}` : '--' },
                  { label: 'Volume', value: hasPrice(volume) ? volume.toLocaleString('en-IN') : '--' },
                  { label: 'Avg Price', value: hasPrice(avgPrice) ? `₹${fmtPrice(avgPrice)}` : '--' },
                  { label: 'Market Cap', value: hasPrice(marketCap) ? `₹${(marketCap / 1e7).toFixed(2)}Cr` : '--' },
                  { label: 'P/E Ratio', value: hasPrice(pe) ? pe.toFixed(2) : '--' },
                  { label: '52w High', value: hasPrice(week52High) ? `₹${fmtPrice(week52High)}` : '--' },
                  { label: '52w Low', value: hasPrice(week52Low) ? `₹${fmtPrice(week52Low)}` : '--' },
                ].map((s) => (
                  <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{s.value}</span>
                  </div>
                ))}
              </div>

              {/* Holding info */}
              {held > 0 && (
                <>
                  <div className="info-divider" />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700, letterSpacing: '0.05em' }}>YOUR HOLDING</div>
                  <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Quantity</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{held}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Avg Buy Price</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(avgBuy)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Unrealized P&amp;L</span>
                      <span style={{ fontWeight: 800, color: unrealizedPL >= 0 ? 'var(--gain)' : 'var(--loss)', fontFamily: 'var(--font-mono)' }}>
                        {unrealizedPL >= 0 ? '+' : ''}₹{Math.abs(unrealizedPL).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* Option Chain button */}
              {!isIndex && (
                <>
                  <div className="info-divider" />
                  <button className="info-option-chain-btn" onClick={() => setActiveTab('option-chain')}>
                    <Target size={14} /> Option Chain <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
                  </button>
                </>
              )}

              {/* Market Depth */}
              <div className="info-divider" />
              <div className="info-section-label">Market Depth</div>
              <div className="market-depth-table" style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 700, letterSpacing: '0.05em' }}>
                  <span style={{ flex: 1 }}>BID QTY</span>
                  <span style={{ flex: 1, textAlign: 'center' }}>PRICE</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>ASK QTY</span>
                </div>
                {quote?.bidDepth?.length ? (
                  quote.bidDepth.slice(0, 5).map((b, i) => {
                    const ask = quote?.askDepth?.[i] || { price: null, quantity: null };
                    return (
                      <div key={i} className="depth-row">
                        <span className="gain" style={{ flex: 1 }}>{b.quantity?.toLocaleString('en-IN') || '-'}</span>
                        <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{fmtPrice(b.price)}</span>
                        <span className="loss" style={{ flex: 1, textAlign: 'right' }}>{ask.quantity?.toLocaleString('en-IN') || '-'}</span>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0', lineHeight: 1.5 }}>
                    Depth requires a Dhan account. Prices shown are from the free feed.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── News tab ───────────────────────────────────────────────────── */}
          {rightTab === 'news' && (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>Latest News</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Refresh in {newsRefreshTimer}s</span>
              </div>
              {news.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No news available right now.</div>}
              {news.map((n, i) => {
                const symbolsMentioned = (watchlist || []).filter((wl) => n.title?.toUpperCase().includes(wl.replace('.NS', '').toUpperCase()));
                return (
                  <a key={i} href={n.link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span>{n.publishedAt ? new Date(n.publishedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      <span>·</span>
                      <span>{n.publisher || 'Market'}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.45, marginTop: 3 }}>{n.title}</div>
                    {symbolsMentioned.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {symbolsMentioned.slice(0, 3).map((s) => (
                          <span key={s} style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)', border: '1px solid rgba(99,102,241,0.25)' }}>
                            {s.replace('.NS', '')}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══ BOTTOM BAR ═══════════════════════════════════════════════════════ */}
      <div className="cpage-bottom-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        {/* Left: BUY/SELL + Account */}
        {!isIndex && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="chart-buy-btn" style={{ fontSize: 11, padding: '5px 14px' }} onClick={() => { setShowBuy(true); setShowSell(false); }}>
              BUY ₹{fmtPrice(currentPrice)}
            </button>
            <button className="chart-sell-btn" style={{ fontSize: 11, padding: '5px 14px' }} onClick={() => { setShowSell(true); setShowBuy(false); }}>
              SELL ₹{fmtPrice(currentPrice)}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
              Account <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(balance)}</span>
            </div>
          </div>
        )}

        {/* Center: timeframe selector */}
        <span style={{ flex: 1 }} />
        <div className="cpage-tf-group">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} className={`cpage-tf-btn ${timeframe === tf ? 'active' : ''}`} onClick={() => changeTimeframe(tf)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4 }}>
              {tf}
            </button>
          ))}
        </div>

        {/* Right: Clock + Market status + P&L */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {Object.keys(holdings || {}).length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: totalPL >= 0 ? 'var(--gain)' : 'var(--loss)', fontFamily: 'var(--font-mono)' }}>
              P&amp;L: {totalPL >= 0 ? '+' : ''}₹{Math.abs(totalPL).toFixed(2)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: marketStatus.open ? 'var(--gain)' : '#f59e0b' }}>
            <span className="live-indicator-dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 99, background: marketStatus.open ? 'var(--gain)' : '#f59e0b' }} />
            {marketStatus.status}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {clock}
          </span>
        </div>
      </div>

      {replayMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', background: '#161b22', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>REPLAY</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{replayIdx + 1} / {data.length} bars</span>
          <button onClick={() => setReplayIdx((i) => Math.max(0, i - 1))} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', cursor: 'pointer' }}>◀</button>
          <button onClick={() => setReplayPaused((p) => !p)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', cursor: 'pointer' }}>{replayPaused ? '▶' : '⏸'}</button>
          <button onClick={() => setReplayIdx((i) => Math.min(data.length - 1, i + 1))} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', cursor: 'pointer' }}>▶</button>
          <button onClick={() => setReplayIdx(0)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', cursor: 'pointer' }}>⏮</button>
          <button onClick={() => setReplayIdx(data.length - 1)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', cursor: 'pointer' }}>⏭</button>
        </div>
      )}

      {/* ══ BOTTOM TABS ══════════════════════════════════════════════════════ */}
      <div className="cpage-bottom-tabs">
        {['overview', 'option-chain'].map((t) => (
          <button key={t} className={`cpage-bottom-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t === 'option-chain' ? 'Option Chain' : 'Overview'}
          </button>
        ))}
      </div>
      {activeTab === 'option-chain' && (
        <div className="cpage-bottom-panel">
          <Suspense fallback={<div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading option chain…</div>}>
            <OptionChainPage symbol={symbol} inModal onTrade={onTrade} balance={balance} quotes={quotes} />
          </Suspense>
        </div>
      )}
      {/* ══ CHART SETTINGS DIALOG ═════════════════════════════════════════════ */}
      {settingsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, width: 420, padding: 20, color: 'var(--text-primary)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Chart Settings</span>
              <button onClick={() => setSettingsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>Logarithmic price scale</span>
                <button onClick={() => setLogScale((l) => !l)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: logScale ? 'var(--accent-primary)' : 'transparent', color: logScale ? '#fff' : 'var(--text-primary)', fontSize: 11, fontWeight: 700 }}>
                  {logScale ? 'ON' : 'OFF'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>Compare symbol</span>
                <input value={compareSymbol} onChange={(e) => setCompareSymbol(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE.NS" style={{ width: 140, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', fontSize: 11 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>Replay mode</span>
                <button onClick={() => setReplayMode((m) => !m)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: replayMode ? 'var(--accent-primary)' : 'transparent', color: replayMode ? '#fff' : 'var(--text-primary)', fontSize: 11, fontWeight: 700 }}>
                  {replayMode ? 'ON' : 'OFF'}
                </button>
              </div>
              {replayMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Speed</span>
                  <button onClick={() => setReplaySpeed((s) => Math.max(0.5, s - 0.5))} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', fontSize: 11 }}>−</button>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 30, textAlign: 'center' }}>{replaySpeed}x</span>
                  <button onClick={() => setReplaySpeed((s) => Math.min(4, s + 0.5))} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', fontSize: 11 }}>+</button>
                </div>
              )}
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setSettingsOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>Close</button>
              <button onClick={() => { setSettingsOpen(false); setFitToken((t) => t + 1); }} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ INDICATOR SETTINGS DIALOG ══════════════════════════════════════════ */}
      {indSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, width: 460, padding: 20, color: 'var(--text-primary)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Indicator Settings</span>
              <button onClick={() => setIndSettingsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 400, overflowY: 'auto' }}>
              {Object.entries(indicatorParams).map(([id, params]) => (
                <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{id.toUpperCase()}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {Object.entries(params).map(([key, val]) => (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
                        <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{key}</label>
                        <input type="number" value={val != null ? val : ''} onChange={(e) => {
                          const n = Number(e.target.value);
                          setIndicatorParams((prev) => ({ ...prev, [id]: { ...prev[id], [key]: Number.isFinite(n) ? n : val } }));
                        }} style={{ width: 70, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: '#0d1117', color: 'var(--text-primary)', fontSize: 11 }} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setIndSettingsOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
