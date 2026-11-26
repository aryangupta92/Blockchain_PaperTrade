import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart2,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Eraser,
  Eye,
  EyeOff,
  Grid,
  Layers,
  Minus,
  MousePointer,
  PenTool,
  RotateCcw,
  Ruler,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';
import {
  ChartDrawing,
  ChartType,
  DrawingTool,
  ScaleMode,
  TradingChartPane,
} from '../chart/TradingChartPane';

interface ChartsPageProps {
  mode: AccountMode;
  theme: 'dark' | 'light';
  initialSymbol: string;
  initialSegment: string;
  onTradeClick: (
    symbol: string,
    side: 'BUY' | 'SELL',
    segment: string,
    ltp: string | null,
    priceOverride?: string | null,
    initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF'
  ) => void;
  onOpenOptionChain: (underlying?: string) => void;
}

type GridLayoutMode = '1' | '2V' | '2H' | '3L' | '4G';
type ChartInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W';

interface PaneConfig {
  id: string;
  symbol: string;
  segment: string;
  interval: ChartInterval;
  indicators: string[];
}

const INTERVALS: ChartInterval[] = ['1m', '3m', '5m', '15m', '30m', '1h', '1D', '1W'];

const INDICATORS = [
  { id: 'EMA9', label: 'EMA 9' },
  { id: 'EMA20', label: 'EMA 20' },
  { id: 'EMA_CROSS_9_20', label: 'EMA Cross 9/20' },
  { id: 'SMA20', label: 'SMA 20' },
  { id: 'SMA50', label: 'SMA 50' },
  { id: 'EMA50', label: 'EMA 50' },
  { id: 'EMA200', label: 'EMA 200' },
  { id: 'WMA20', label: 'WMA 20' },
  { id: 'VWAP', label: 'VWAP' },
  { id: 'BB', label: 'Bollinger (20,2)' },
  { id: 'SUPERTREND', label: 'Supertrend' },
  { id: 'DONCHIAN', label: 'Donchian' },
  { id: 'KELTNER', label: 'Keltner' },
  { id: 'PIVOTS', label: 'CPR / Pivots' },
  { id: 'VOLUME', label: 'Volume' },
  { id: 'OI', label: 'Open Interest' },
  { id: 'RSI', label: 'RSI (14)' },
  { id: 'MACD', label: 'MACD' },
  { id: 'ATR', label: 'ATR (14)' },
  { id: 'STOCHRSI', label: 'StochRSI' },
  { id: 'ADX', label: 'ADX (14)' },
  { id: 'CCI', label: 'CCI (20)' },
  { id: 'OBV', label: 'OBV' },
];

const QUICK_RANGES: Array<{ id: string; interval: ChartInterval }> = [
  { id: '5Y', interval: '1W' },
  { id: '3Y', interval: '1W' },
  { id: '1Y', interval: '1D' },
  { id: '6M', interval: '1D' },
  { id: '3M', interval: '1D' },
  { id: '1M', interval: '1h' },
  { id: '1W', interval: '15m' },
  { id: '1D', interval: '5m' },
];

const DRAWING_TOOLS: Array<{ id: DrawingTool; label: string; badge?: string; icon: typeof MousePointer }> = [
  { id: 'cursor', label: 'Crosshair / Select', icon: MousePointer },
  { id: 'trendline', label: 'Trendline (Click/Drag)', icon: PenTool },
  { id: 'hline', label: 'Horizontal Level', icon: Minus },
  { id: 'vline', label: 'Vertical Line', badge: 'V', icon: Minus },
  { id: 'demand_zone', label: 'Demand Zone (Green Box)', badge: 'D', icon: Square },
  { id: 'supply_zone', label: 'Supply Zone (Red Box)', badge: 'S', icon: Square },
  { id: 'zone', label: 'Rectangle Zone', icon: Square },
  { id: 'fib', label: 'Fib Retracement', icon: Layers },
  { id: 'text', label: 'Text Annotation', icon: Type },
  { id: 'measure', label: 'Price Range Measure', icon: Ruler },
  { id: 'eraser', label: 'Eraser (Click drawing)', icon: Eraser },
];

const DRAWINGS_STORAGE_KEY = 'blocktrade_chart_drawings_v2';

function loadStoredDrawings(): Record<string, ChartDrawing[]> {
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ChartDrawing[]>) : {};
  } catch {
    return {};
  }
}

const EMPTY_DRAWINGS: ChartDrawing[] = [];

function IstClockBadge() {
  const [istClock, setIstClock] = useState('');
  useEffect(() => {
    const tick = () => {
      const str = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      setIstClock(`${str} UTC+5:30`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="mono" style={{ color: 'var(--text-secondary)' }}>{istClock}</span>;
}

export function ChartsPage({
  mode,
  theme,
  initialSymbol,
  initialSegment,
  onTradeClick,
  onOpenOptionChain,
}: ChartsPageProps) {
  const [gridMode, setGridMode] = useState<GridLayoutMode>('1');
  const [activePaneIdx, setActivePaneIdx] = useState<number>(0);

  const [panes, setPanes] = useState<PaneConfig[]>(() => [
    { id: 'pane-0', symbol: initialSymbol || 'NIFTY', segment: initialSegment || 'FNO', interval: '5m', indicators: ['EMA_CROSS_9_20', 'VOLUME'] },
    { id: 'pane-1', symbol: 'BANKNIFTY', segment: 'FNO', interval: '1m', indicators: ['EMA9', 'VWAP'] },
    { id: 'pane-2', symbol: 'RELIANCE', segment: 'EQ', interval: '5m', indicators: ['EMA9', 'EMA20'] },
    { id: 'pane-3', symbol: 'HDFCBANK', segment: 'EQ', interval: '15m', indicators: ['EMA9', 'VWAP'] },
  ]);

  useEffect(() => {
    setPanes((prev) => prev.map((p, idx) => (idx === 0 ? { ...p, symbol: initialSymbol, segment: initialSegment } : p)));
    setActivePaneIdx(0);
  }, [initialSymbol, initialSegment]);

  // Global chart appearance settings (separate from symbols so Chart Layouts never touch symbols)
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normal');
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [hideDrawings, setHideDrawings] = useState(false);
  const [drawingsByKey, setDrawingsByKey] = useState<Record<string, ChartDrawing[]>>(loadStoredDrawings);
  const [showIndicatorsMenu, setShowIndicatorsMenu] = useState(false);
  const [showLayoutsMenu, setShowLayoutsMenu] = useState(false);

  // Clear separation: Normal/Overnight (CNC·NRML) vs Intraday Scalper (MIS)
  const [scalperMode, setScalperMode] = useState(false);
  const [scalperLots, setScalperLots] = useState(1);
  const [scalperLotSize, setScalperLotSize] = useState(1);
  const [scalperBusy, setScalperBusy] = useState(false);
  const [scalperMsg, setScalperMsg] = useState<string | null>(null);

  // Topbar symbol search targeting the selected pane
  const [paneQuery, setPaneQuery] = useState('');
  const [paneHits, setPaneHits] = useState<Array<{ symbol: string; tradingSymbol: string; exchange: string; segment: string }>>([]);
  const paneSearchRef = useRef<HTMLInputElement | null>(null);

  // Saved Chart Layouts (settings only — no symbols)
  const [layouts, setLayouts] = useState<Array<{ id: string; name: string; layout: Record<string, unknown>; updatedAt: string }>>([]);
  const [layoutName, setLayoutName] = useState('My EMA 9/20 Setup');
  const [activeLayoutName, setActiveLayoutName] = useState<string>('Default Setup');

  // In-chart Option Chain Popup Box (TradingView-style selector for selected pane)
  const [showChainBox, setShowChainBox] = useState(false);
  const [chainTargetPane, setChainTargetPane] = useState<number>(0);
  const [keepChainOpen, setKeepChainOpen] = useState(true);
  const [chainUnderlying, setChainUnderlying] = useState<string>('NIFTY');
  const [chainExpiry, setChainExpiry] = useState<string>('');
  const [chainData, setChainData] = useState<Awaited<ReturnType<typeof api.fnoOptionChain>> | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [underlyings, setUnderlyings] = useState<string[]>(['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'RELIANCE', 'HDFCBANK', 'TCS']);

  // Bottom Account Manager / Trade tray + live IST clock
  const [showBottomTray, setShowBottomTray] = useState(false);
  const [trayTab, setTrayTab] = useState<'positions' | 'orders'>('positions');
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof api.positions>>['positions']>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof api.orders>>['orders']>([]);

  const activePane = panes[activePaneIdx] || panes[0];

  const visiblePaneIndices = useMemo(() => {
    if (gridMode === '1') return [0];
    if (gridMode === '2V' || gridMode === '2H') return [0, 1];
    if (gridMode === '3L') return [0, 1, 2];
    return [0, 1, 2, 3];
  }, [gridMode]);

  useEffect(() => {
    if (!visiblePaneIndices.includes(activePaneIdx)) {
      setActivePaneIdx(0);
    }
  }, [visiblePaneIndices, activePaneIdx]);

  // Persist drawings locally per symbol+interval pane context
  useEffect(() => {
    try {
      localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(drawingsByKey));
    } catch { /* ignore quota */ }
  }, [drawingsByKey]);

  const drawingKeyForPane = (p: PaneConfig) => `${p.symbol.toUpperCase()}::${p.segment}`;

  // Load saved layouts & F&O underlyings
  useEffect(() => {
    api.chartLayouts().then((r) => setLayouts(r.layouts)).catch(() => { });
    api.fnoUnderlyings().then((r) => {
      const syms = [
        ...r.indices.map((i) => i.symbol),
        ...r.stocks.slice(0, 12).map((s) => s.symbol),
      ];
      if (syms.length > 0) setUnderlyings(Array.from(new Set(syms)));
    }).catch(() => { });
  }, []);

  // Resolve lot size for active pane when scalper mode is used
  useEffect(() => {
    api.marketFundamentals(activePane.symbol).then((f) => {
      setScalperLotSize(Math.max(1, f.lotSize || 1));
    }).catch(() => setScalperLotSize(1));
  }, [activePane.symbol]);

  // Symbol Search debounce for topbar search
  useEffect(() => {
    const q = paneQuery.trim();
    if (!q) {
      setPaneHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchInstruments({ q, limit: 12 }).then((r) => setPaneHits(r.instruments)).catch(() => { });
    }, 180);
    return () => clearTimeout(timer);
  }, [paneQuery]);

  // Load Option Chain box data when open
  const loadOptionChainBox = useCallback(async (und: string, exp?: string) => {
    setChainLoading(true);
    try {
      const res = await api.fnoOptionChain(und, exp || undefined);
      setChainData(res);
      if (res && !exp && res.expiry) setChainExpiry(res.expiry);
    } catch {
      setChainData(null);
    } finally {
      setChainLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showChainBox) return;
    loadOptionChainBox(chainUnderlying, chainExpiry);
  }, [showChainBox, chainUnderlying, chainExpiry, loadOptionChainBox]);

  // Refresh Account Manager bottom tray when visible
  const loadBottomTray = useCallback(async () => {
    try {
      const [pRes, oRes] = await Promise.allSettled([api.positions(mode), api.orders(mode)]);
      if (pRes.status === 'fulfilled') setPositions(pRes.value.positions.filter((p) => p.netQuantity !== 0));
      if (oRes.status === 'fulfilled') setOrders(oRes.value.orders.slice(0, 20));
    } catch { /* ignore */ }
  }, [mode]);

  useEffect(() => {
    if (!showBottomTray) return;
    loadBottomTray();
    const id = setInterval(loadBottomTray, 5000);
    return () => clearInterval(id);
  }, [showBottomTray, loadBottomTray]);

  const setPaneSymbol = (paneIdx: number, symbol: string, segment: string) => {
    setPanes((prev) => prev.map((p, i) => (i === paneIdx ? { ...p, symbol, segment } : p)));
    setActivePaneIdx(paneIdx);
  };

  const setActivePaneInterval = (iv: ChartInterval) => {
    setPanes((prev) => prev.map((p, i) => (i === activePaneIdx ? { ...p, interval: iv } : p)));
  };

  const toggleActiveIndicator = (id: string) => {
    setPanes((prev) =>
      prev.map((p, i) => {
        if (i !== activePaneIdx) return p;
        const exists = p.indicators.includes(id);
        return { ...p, indicators: exists ? p.indicators.filter((x) => x !== id) : [...p.indicators, id] };
      })
    );
  };

  const addDrawingToPane = (p: PaneConfig, d: ChartDrawing) => {
    const k = drawingKeyForPane(p);
    setDrawingsByKey((prev) => ({ ...prev, [k]: [...(prev[k] || []), d] }));
  };

  const removeDrawingFromPane = (p: PaneConfig, drawingId: string) => {
    const k = drawingKeyForPane(p);
    setDrawingsByKey((prev) => ({ ...prev, [k]: (prev[k] || []).filter((x) => x.id !== drawingId) }));
  };

  const undoLastDrawingOnActive = () => {
    const k = drawingKeyForPane(activePane);
    setDrawingsByKey((prev) => ({ ...prev, [k]: (prev[k] || []).slice(0, -1) }));
  };

  const clearDrawingsOnActive = () => {
    const k = drawingKeyForPane(activePane);
    setDrawingsByKey((prev) => ({ ...prev, [k]: [] }));
  };

  // Save Chart Layout -> SETTINGS ONLY (never saves symbols)
  const handleSaveChartLayout = async () => {
    const trimmed = layoutName.trim();
    if (!trimmed) return;
    const saved = await api.saveChartLayout({
      name: trimmed,
      layout: {
        kind: 'chart-settings-only',
        gridMode,
        chartType,
        scaleMode,
        paneSettings: panes.map((p) => ({
          interval: p.interval,
          indicators: p.indicators,
        })),
      },
    });
    setLayouts((prev) => [saved, ...prev.filter((l) => l.id !== saved.id)]);
    setActiveLayoutName(saved.name);
    setShowLayoutsMenu(false);
  };

  // Load Chart Layout -> SETTINGS ONLY (preserves all open symbols!)
  const applyChartLayout = (item: { id: string; name: string; layout: Record<string, unknown> }) => {
    const l = item.layout as {
      gridMode?: GridLayoutMode;
      chartType?: ChartType;
      scaleMode?: ScaleMode;
      interval?: ChartInterval;
      indicators?: string[];
      paneSettings?: Array<{ interval?: ChartInterval; indicators?: string[] }>;
    };
    if (l.gridMode && ['1', '2V', '2H', '3L', '4G'].includes(l.gridMode)) {
      setGridMode(l.gridMode);
    }
    if (l.chartType) setChartType(l.chartType);
    if (l.scaleMode) setScaleMode(l.scaleMode);

    if (Array.isArray(l.paneSettings) && l.paneSettings.length > 0) {
      setPanes((prev) =>
        prev.map((p, idx) => {
          const ps = l.paneSettings![idx] || l.paneSettings![0];
          return {
            ...p, // Symbol & segment stay UNCHANGED!
            interval: ps?.interval || p.interval,
            indicators: Array.isArray(ps?.indicators) ? ps.indicators : p.indicators,
          };
        })
      );
    } else {
      // Legacy v1 layout compatibility without overwriting symbols
      setPanes((prev) =>
        prev.map((p, idx) =>
          idx === activePaneIdx
            ? {
              ...p,
              interval: l.interval || p.interval,
              indicators: Array.isArray(l.indicators) ? l.indicators : p.indicators,
            }
            : p
        )
      );
    }
    setActiveLayoutName(item.name);
    setShowLayoutsMenu(false);
  };

  // 1-Click Spot + Call + Put 3-Pane Setup (matches TradingView 3L workflow)
  const loadThreePaneSpotCallPut = () => {
    if (!chainData || chainData.rows.length === 0) return;
    const atm = chainData.rows.find((r) => r.atm) || chainData.rows[Math.floor(chainData.rows.length / 2)];
    const spotSym = chainData.underlying;
    const spotSeg = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY'].includes(spotSym) ? 'FNO' : 'EQ';
    const ceSym = atm.call.tradingSymbol || panes[1].symbol;
    const peSym = atm.put.tradingSymbol || panes[2].symbol;
    setPanes((prev) => [
      { ...prev[0], symbol: spotSym, segment: spotSeg, interval: '5m' },
      { ...prev[1], symbol: ceSym, segment: 'FNO', interval: '1m' },
      { ...prev[2], symbol: peSym, segment: 'FNO', interval: '1m' },
      prev[3],
    ]);
    setGridMode('3L');
    setActivePaneIdx(0);
    setShowChainBox(false);
  };

  // Intraday Scalper (MIS) Instant Order Trigger
  const fireScalperOrder = async (side: 'BUY' | 'SELL') => {
    const qty = Math.max(1, scalperLots) * scalperLotSize;
    setScalperBusy(true);
    setScalperMsg(null);
    try {
      const res = await api.placeOrder({
        mode,
        symbol: activePane.symbol,
        side,
        product: 'MIS',
        orderType: 'MARKET',
        validity: 'DAY',
        quantity: qty,
      });
      setScalperMsg(`⚡ Intraday Scalper MIS ${side} ×${qty} ${activePane.symbol}: ${res.order.status}`);
      if (showBottomTray) loadBottomTray();
    } catch (err) {
      setScalperMsg(`Scalper MIS failed: ${(err as Error).message}`);
    } finally {
      setScalperBusy(false);
    }
  };

  const openOptionBoxForPane = (paneIdx: number) => {
    const p = panes[paneIdx] || panes[0];
    const guessUnd = p.symbol.split('-')[0].split(' ')[0].toUpperCase();
    if (underlyings.includes(guessUnd)) {
      setChainUnderlying(guessUnd);
      setChainExpiry('');
    }
    setChainTargetPane(paneIdx);
    setActivePaneIdx(paneIdx);
    setShowChainBox(true);
  };

  const isIndexSymbol = (sym: string, seg: string) =>
    (seg === 'FNO' || seg === 'IDX') &&
    !sym.includes('-') &&
    !sym.includes(' ') &&
    ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'INDIAVIX'].includes(sym.toUpperCase());

  const defaultNormalProduct: 'CNC' | 'NRML' =
    activePane.segment === 'FNO' || activePane.segment === 'COMM' ? 'NRML' : 'CNC';

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}
      onClick={() => {
        setShowIndicatorsMenu(false);
        setShowLayoutsMenu(false);
      }}
    >
      {/* TradingView Top Action Toolbar */}
      <section
        className="card"
        style={{
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          background: theme === 'dark' ? '#0f141e' : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Active Pane Search (types & switches selected pane symbol) */}
          <div style={{ position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-elevated)',
                border: '1px solid #2563eb',
                borderRadius: 7,
                padding: '4px 8px',
                width: 240,
              }}
            >
              <Search size={13} color="#38bdf8" />
              <span className="badge" style={{ fontSize: 9.5, padding: '1px 5px', background: '#2563eb', color: '#fff' }}>
                P{activePaneIdx + 1}
              </span>
              <input
                ref={paneSearchRef}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontWeight: 700,
                  width: '100%',
                  outline: 'none',
                }}
                placeholder={`${activePane.symbol} (type symbol)`}
                value={paneQuery}
                onChange={(e) => setPaneQuery(e.target.value)}
              />
            </div>

            {paneHits.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  width: 320,
                  zIndex: 95,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 9,
                  marginTop: 4,
                  maxHeight: 260,
                  overflowY: 'auto',
                  boxShadow: '0 14px 36px rgba(0,0,0,0.6)',
                }}
              >
                {paneHits.map((h) => (
                  <div
                    key={`${h.exchange}-${h.tradingSymbol}`}
                    onClick={() => {
                      setPaneSymbol(activePaneIdx, h.tradingSymbol, h.segment);
                      setPaneQuery('');
                      setPaneHits([]);
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <strong>{h.tradingSymbol}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>
                      {h.exchange} · {h.segment} → Pane {activePaneIdx + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* In-Chart Option Chain Selector Box Button */}
          <button
            type="button"
            className={`preset-btn ${showChainBox ? 'active' : ''}`}
            style={{ fontSize: 11.5, padding: '5px 9px', borderColor: '#38bdf8', color: showChainBox ? '#fff' : '#38bdf8' }}
            onClick={(e) => {
              e.stopPropagation();
              openOptionBoxForPane(activePaneIdx);
            }}
            title="Open Option Chain popup to pick any Call/Put premium into the selected pane"
          >
            <BarChart2 size={13} /> Option Chain Box
          </button>

          {/* Timeframes for active pane */}
          <div style={{ display: 'inline-flex', gap: 2, background: 'var(--bg-elevated)', padding: 3, borderRadius: 7 }}>
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                className={`preset-btn ${activePane.interval === iv ? 'active' : ''}`}
                style={{ padding: '3px 7px', fontSize: 11, border: 'none' }}
                onClick={() => setActivePaneInterval(iv)}
              >
                {iv}
              </button>
            ))}
          </div>

          {/* Chart Type */}
          <select
            className="input"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 11.5 }}
            value={chartType}
            onChange={(e) => setChartType(e.target.value as ChartType)}
            title="Chart Series Style"
          >
            <option value="candles">Candles</option>
            <option value="heikin_ashi">Heikin-Ashi</option>
            <option value="bars">OHLC Bars</option>
            <option value="line">Line</option>
            <option value="area">Area</option>
          </select>

          {/* Indicators Popover (includes EMA 9 & EMA Cross 9/20) */}
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`preset-btn ${showIndicatorsMenu ? 'active' : ''}`}
              style={{ fontSize: 11.5, padding: '5px 9px' }}
              onClick={() => {
                setShowLayoutsMenu(false);
                setShowIndicatorsMenu((v) => !v);
              }}
            >
              <SlidersHorizontal size={13} /> Indicators ({activePane.indicators.length})
            </button>

            {showIndicatorsMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  width: 340,
                  zIndex: 96,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 10,
                  marginTop: 6,
                  padding: 10,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 12 }}>Indicators · Pane {activePaneIdx + 1} ({activePane.symbol})</strong>
                  <button type="button" className="theme-toggle" style={{ padding: '2px 5px' }} onClick={() => setShowIndicatorsMenu(false)}>
                    <X size={12} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {INDICATORS.map((ind) => {
                    const on = activePane.indicators.includes(ind.id);
                    return (
                      <button
                        key={ind.id}
                        type="button"
                        className={`preset-btn ${on ? 'active' : ''}`}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => toggleActiveIndicator(ind.id)}
                      >
                        {on ? '✓ ' : '+ '}{ind.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Multi-Pane Grid Layout Switcher (includes 3L Spot + CE + PE!) */}
          <div style={{ display: 'inline-flex', gap: 2, background: 'var(--bg-elevated)', padding: 3, borderRadius: 7 }} title="Multi-Pane Chart Grid">
            {(
              [
                { id: '1', label: '1' },
                { id: '2V', label: '2 Columns' },
                { id: '2H', label: '2 Rows' },
                { id: '3L', label: '3 (1+2)' },
                { id: '4G', label: '4 Grid' },
              ] as const
            ).map((g) => (
              <button
                key={g.id}
                type="button"
                className={`preset-btn ${gridMode === g.id ? 'active' : ''}`}
                style={{ padding: '3px 7px', fontSize: 11, border: 'none' }}
                onClick={() => setGridMode(g.id)}
              >
                <Grid size={11} /> {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Controls: Normal/Overnight vs Intraday Scalper + Chart Settings Layouts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Normal / Overnight Orders (CNC / NRML) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRight: '1px solid var(--border-subtle)', paddingRight: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
              Normal ({defaultNormalProduct})
            </span>
            <button
              type="button"
              className="btn-primary"
              style={{ background: '#ef4444', borderColor: '#ef4444', padding: '4px 10px', fontSize: 11.5 }}
              onClick={() =>
                onTradeClick(
                  activePane.symbol,
                  'SELL',
                  activePane.segment,
                  null,
                  null,
                  defaultNormalProduct
                )
              }
            >
              Sell
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: '#2563eb', borderColor: '#2563eb', padding: '4px 10px', fontSize: 11.5 }}
              onClick={() =>
                onTradeClick(
                  activePane.symbol,
                  'BUY',
                  activePane.segment,
                  null,
                  null,
                  defaultNormalProduct
                )
              }
            >
              Buy
            </button>
          </div>

          {/* Intraday Scalper (MIS ONLY) Toggle */}
          <button
            type="button"
            className={`preset-btn ${scalperMode ? 'active' : ''}`}
            style={{
              fontSize: 11.5,
              padding: '5px 10px',
              borderColor: scalperMode ? '#38bdf8' : 'rgba(56, 189, 248, 0.45)',
              background: scalperMode ? 'rgba(37, 99, 235, 0.25)' : 'transparent',
              color: scalperMode ? '#38bdf8' : 'var(--text-primary)',
              fontWeight: 700,
            }}
            onClick={() => setScalperMode((v) => !v)}
            title="Toggle Intraday Scalper Mode (MIS Orders Only — separate from Normal/Overnight CNC/NRML)"
          >
            <Zap size={12} /> Scalper (MIS)
          </button>

          {/* Chart Layout (SETTINGS ONLY — never alters symbols) */}
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`preset-btn ${showLayoutsMenu ? 'active' : ''}`}
              style={{ fontSize: 11.5, padding: '5px 9px' }}
              onClick={() => {
                setShowIndicatorsMenu(false);
                setShowLayoutsMenu((v) => !v);
              }}
              title="Save or load Chart Settings & Indicators (symbols are preserved)"
            >
              <Bookmark size={12} /> {activeLayoutName}
            </button>

            {showLayoutsMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  width: 310,
                  zIndex: 96,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 10,
                  marginTop: 6,
                  padding: 12,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Chart Layout (Settings Only)</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Saves grid, chart style, scale &amp; indicators. Loading never changes your pane symbols.
                </div>
                <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                  <input
                    className="input"
                    style={{ fontSize: 11.5, padding: '4px 8px', flex: 1 }}
                    value={layoutName}
                    onChange={(e) => setLayoutName(e.target.value)}
                    placeholder="Template name..."
                  />
                  <button type="button" className="btn-primary" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={handleSaveChartLayout}>
                    Save
                  </button>
                </div>

                <div style={{ maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {layouts.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '5px 7px',
                        background: 'var(--bg-elevated)',
                        borderRadius: 6,
                        fontSize: 11.5,
                      }}
                    >
                      <button
                        type="button"
                        style={{
                          border: 'none',
                          background: 'none',
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                          flex: 1,
                        }}
                        onClick={() => applyChartLayout(l)}
                      >
                        {l.name}
                      </button>
                      <button
                        type="button"
                        className="theme-toggle"
                        style={{ padding: '2px 5px', color: 'var(--loss)' }}
                        onClick={async () => {
                          await api.deleteChartLayout(l.id).catch(() => { });
                          setLayouts((prev) => prev.filter((x) => x.id !== l.id));
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  {layouts.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No saved templates yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="preset-btn"
            style={{ fontSize: 11.5, padding: '5px 8px' }}
            onClick={() => onOpenOptionChain(activePane.symbol)}
            title="Open Full Option Chain Page"
          >
            Full Chain →
          </button>
        </div>
      </section>

      {/* Distinct INTRADAY SCALPER (MIS) Execution Strip */}
      {scalperMode && (
        <section
          className="card"
          style={{
            padding: '7px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            borderColor: 'rgba(56, 189, 248, 0.55)',
            background: theme === 'dark' ? 'rgba(15, 32, 62, 0.72)' : 'rgba(56, 189, 248, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="pill" style={{ background: 'rgba(56, 189, 248, 0.18)', color: '#38bdf8', borderColor: '#38bdf8' }}>
              ⚡ INTRADAY SCALPER (MIS ONLY)
            </span>
            <strong style={{ fontSize: 12.5 }}>
              Target Pane {activePaneIdx + 1}: {activePane.symbol}
            </strong>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              Lot: {scalperLotSize} · Total Qty: <strong>{scalperLots * scalperLotSize}</strong>
            </span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              {[1, 2, 5, 10].map((mult) => (
                <button
                  key={mult}
                  type="button"
                  className={`preset-btn ${scalperLots === mult ? 'active' : ''}`}
                  style={{ padding: '2px 7px', fontSize: 11 }}
                  onClick={() => setScalperLots(mult)}
                >
                  {mult}x
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {scalperMsg && (
              <span className="mono" style={{ fontSize: 11.5, color: '#38bdf8', marginRight: 6 }}>
                {scalperMsg}
              </span>
            )}
            {isIndexSymbol(activePane.symbol, activePane.segment) ? (
              <button
                type="button"
                className="preset-btn"
                style={{ borderColor: '#38bdf8', color: '#38bdf8', fontSize: 11 }}
                onClick={() => openOptionBoxForPane(activePaneIdx)}
              >
                Select Strike Option in Box to Scalp MIS
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={scalperBusy}
                  style={{ background: '#10b981', borderColor: '#10b981', padding: '5px 12px', fontSize: 11.5 }}
                  onClick={() => fireScalperOrder('BUY')}
                >
                  ⚡ Market Buy MIS ({scalperLots * scalperLotSize})
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={scalperBusy}
                  style={{ background: '#ef4444', borderColor: '#ef4444', padding: '5px 12px', fontSize: 11.5 }}
                  onClick={() => fireScalperOrder('SELL')}
                >
                  ⚡ Market Sell MIS ({scalperLots * scalperLotSize})
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  style={{ fontSize: 11, padding: '5px 8px' }}
                  onClick={() => onTradeClick(activePane.symbol, 'BUY', activePane.segment, null, null, 'MIS')}
                >
                  MIS Limit Ticket
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* Workspace Body: Left Drawing Strip + Center TradingView Chart Panes */}
      <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
        {/* Left Vertical Drawing Toolbar */}
        <aside
          className="card"
          style={{
            padding: '8px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            background: theme === 'dark' ? '#0f141e' : undefined,
          }}
        >
          {DRAWING_TOOLS.map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            const customColor =
              t.id === 'demand_zone' ? '#22c55e' : t.id === 'supply_zone' ? '#ef4444' : undefined;
            return (
              <button
                key={t.id}
                type="button"
                className={`preset-btn ${active ? 'active' : ''}`}
                style={{
                  width: 34,
                  height: 32,
                  padding: 0,
                  justifyContent: 'center',
                  position: 'relative',
                  color: customColor,
                  borderColor: active ? '#2563eb' : undefined,
                }}
                title={`${t.label} (draws on active Pane ${activePaneIdx + 1})`}
                onClick={() => setActiveTool(t.id)}
              >
                <Icon size={14} />
                {t.badge && (
                  <span style={{ position: 'absolute', bottom: 1, right: 2, fontSize: 8, fontWeight: 800 }}>
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}

          <div style={{ width: 24, height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />

          <button
            type="button"
            className="preset-btn"
            style={{ width: 34, height: 30, padding: 0, justifyContent: 'center' }}
            title={`Undo last drawing on Pane ${activePaneIdx + 1}`}
            onClick={undoLastDrawingOnActive}
          >
            <Undo2 size={13} />
          </button>

          <button
            type="button"
            className={`preset-btn ${hideDrawings ? 'active' : ''}`}
            style={{ width: 34, height: 30, padding: 0, justifyContent: 'center' }}
            title={hideDrawings ? 'Show Drawings' : 'Hide Drawings'}
            onClick={() => setHideDrawings((v) => !v)}
          >
            {hideDrawings ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>

          <button
            type="button"
            className="preset-btn"
            style={{ width: 34, height: 30, padding: 0, justifyContent: 'center', color: 'var(--loss)' }}
            title={`Clear all drawings on Pane ${activePaneIdx + 1}`}
            onClick={clearDrawingsOnActive}
          >
            <Trash2 size={13} />
          </button>
        </aside>

        {/* Multi-Pane Charts Container (Supports 1, 2V, 2H, 3L [Spot + Call + Put], 4G) */}
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns:
              gridMode === '1' || gridMode === '2H' ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
          }}
        >
          {visiblePaneIndices.map((idx) => {
            const p = panes[idx];
            const k = drawingKeyForPane(p);
            const paneDrawings = drawingsByKey[k] || EMPTY_DRAWINGS;
            const paneHeight =
              gridMode === '1'
                ? 540
                : gridMode === '3L'
                  ? idx === 0
                    ? 584
                    : 266
                  : 288;
            const wrapperStyle =
              gridMode === '3L' && idx === 0 ? { gridRow: 'span 2' as const } : undefined;

            return (
              <div key={p.id} style={wrapperStyle}>
                <TradingChartPane
                  mode={mode}
                  theme={theme}
                  symbol={p.symbol}
                  segment={p.segment}
                  interval={p.interval}
                  chartType={chartType}
                  scaleMode={scaleMode}
                  indicators={p.indicators}
                  activeTool={idx === activePaneIdx ? activeTool : 'cursor'}
                  drawings={paneDrawings}
                  onAddDrawing={(d) => addDrawingToPane(p, d)}
                  onRemoveDrawing={(id) => removeDrawingFromPane(p, id)}
                  onRemoveIndicator={(ind) =>
                    setPanes((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, indicators: item.indicators.filter((x) => x !== ind) } : item
                      )
                    )
                  }
                  onTradeClick={onTradeClick}
                  height={paneHeight}
                  isActivePane={idx === activePaneIdx}
                  paneLabel={gridMode !== '1' ? `Pane ${idx + 1}` : undefined}
                  onSelectPane={() => setActivePaneIdx(idx)}
                  onChangeSymbol={(sym, seg) => setPaneSymbol(idx, sym, seg)}
                  onOpenPaneOptionChain={() => openOptionBoxForPane(idx)}
                  hideDrawings={hideDrawings}
                  tradeProduct={scalperMode ? 'MIS' : p.segment === 'FNO' || p.segment === 'COMM' ? 'NRML' : 'CNC'}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Time-Range Bar + Clock + Scale Controls + Account Manager Tray */}
      <section
        className="card"
        style={{
          padding: '6px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: theme === 'dark' ? '#0f141e' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`preset-btn ${showBottomTray ? 'active' : ''}`}
              style={{ fontSize: 11.5, padding: '3px 9px' }}
              onClick={() => setShowBottomTray((v) => !v)}
            >
              <Activity size={12} /> Account Manager · Trade {showBottomTray ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>

            <div style={{ display: 'inline-flex', gap: 3 }}>
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="preset-btn"
                  style={{ fontSize: 11, padding: '2px 7px', border: 'none' }}
                  onClick={() => setActivePaneInterval(r.interval)}
                >
                  {r.id}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <IstClockBadge />
            <span style={{ color: 'var(--border-strong)' }}>|</span>
            {(['percent', 'log', 'normal'] as const).map((sm) => (
              <button
                key={sm}
                type="button"
                className={`preset-btn ${scaleMode === sm ? 'active' : ''}`}
                style={{ fontSize: 11, padding: '2px 7px' }}
                onClick={() => setScaleMode(sm)}
              >
                {sm === 'percent' ? '%' : sm === 'normal' ? 'auto' : 'log'}
              </button>
            ))}
          </div>
        </div>

        {showBottomTray && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                className={`preset-btn ${trayTab === 'positions' ? 'active' : ''}`}
                style={{ fontSize: 11 }}
                onClick={() => setTrayTab('positions')}
              >
                Open Positions ({positions.length})
              </button>
              <button
                type="button"
                className={`preset-btn ${trayTab === 'orders' ? 'active' : ''}`}
                style={{ fontSize: 11 }}
                onClick={() => setTrayTab('orders')}
              >
                Recent Orders ({orders.length})
              </button>
            </div>

            {trayTab === 'positions' ? (
              <div className="table-wrap" style={{ maxHeight: 170 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Product</th>
                      <th style={{ textAlign: 'right' }}>Net Qty</th>
                      <th style={{ textAlign: 'right' }}>LTP</th>
                      <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <tr key={pos.id}>
                        <td>
                          <button
                            type="button"
                            style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                            onClick={() => setPaneSymbol(activePaneIdx, pos.symbol, pos.segment)}
                          >
                            {pos.symbol}
                          </button>
                        </td>
                        <td><span className="badge">{pos.product}</span></td>
                        <td className="mono" style={{ textAlign: 'right' }}>{pos.netQuantity}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{formatINR(pos.ltp)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: Number(pos.netPnl) >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
                          {formatINR(pos.netPnl)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="preset-btn"
                            style={{ padding: '2px 7px', fontSize: 10.5, color: 'var(--loss)', borderColor: 'var(--loss)' }}
                            onClick={async () => {
                              await api.squareOffPosition(mode, {
                                symbol: pos.symbol,
                                product: pos.product,
                                quantity: Math.abs(pos.netQuantity),
                                currentNetQuantity: pos.netQuantity,
                              });
                              loadBottomTray();
                            }}
                          >
                            Exit
                          </button>
                        </td>
                      </tr>
                    ))}
                    {positions.length === 0 && (
                      <tr><td colSpan={6} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No open positions</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 170 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side / Product</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((ord) => (
                      <tr key={ord.id}>
                        <td><strong>{ord.instrument.symbol}</strong></td>
                        <td>{ord.side} · {ord.product} ({ord.orderType})</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{ord.quantity}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{ord.price ? formatINR(ord.price) : 'MKT'}</td>
                        <td><span className="badge">{ord.status}</span></td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No orders yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Non-Blurring Floating In-Chart Option Chain Selector Box */}
      {showChainBox && (
        <div
          style={{
            position: 'fixed',
            top: 78,
            right: 22,
            width: 'min(760px, 95vw)',
            maxHeight: '82vh',
            zIndex: 130,
            background: 'var(--bg-surface)',
            border: '1.5px solid #2563eb',
            borderRadius: 12,
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.78)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <strong style={{ fontSize: 13.5 }}>Option Chain → Chart Pane Selector</strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Click any CE or PE premium to load that contract directly onto the selected chart pane
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={keepChainOpen} onChange={(e) => setKeepChainOpen(e.target.checked)} />
                Keep open
              </label>
              <button type="button" className="theme-toggle" style={{ padding: '4px 7px' }} onClick={() => setShowChainBox(false)}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '8px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="input"
                style={{ width: 'auto', fontSize: 12, padding: '4px 8px', fontWeight: 700 }}
                value={chainUnderlying}
                onChange={(e) => {
                  setChainUnderlying(e.target.value);
                  setChainExpiry('');
                }}
              >
                {underlyings.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>

              <select
                className="input"
                style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
                value={chainExpiry}
                onChange={(e) => setChainExpiry(e.target.value)}
              >
                {(chainData?.expiries || []).map((ex) => (
                  <option key={ex} value={ex}>{ex.slice(0, 10)}</option>
                ))}
              </select>

              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Target:</span>
              {[0, 1, 2, 3].map((pIdx) => (
                <button
                  key={pIdx}
                  type="button"
                  className={`preset-btn ${chainTargetPane === pIdx ? 'active' : ''}`}
                  style={{ padding: '3px 7px', fontSize: 11 }}
                  onClick={() => {
                    setChainTargetPane(pIdx);
                    setActivePaneIdx(pIdx);
                  }}
                >
                  P{pIdx + 1}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '4px 10px', fontSize: 11.5 }}
                onClick={loadThreePaneSpotCallPut}
                disabled={!chainData || chainData.rows.length === 0}
              >
                Load 3-Pane Spot + CE + PE
              </button>
              <button
                type="button"
                className="theme-toggle"
                style={{ padding: '4px 7px' }}
                onClick={() => loadOptionChainBox(chainUnderlying, chainExpiry)}
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>

          <div style={{ padding: '6px 14px', fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
            <span>
              Spot: <strong className="mono">{chainData?.spotPrice ? formatINR(chainData.spotPrice) : '—'}</strong> · PCR:{' '}
              <strong className="mono">{chainData?.pcr != null ? chainData.pcr.toFixed(2) : '—'}</strong> · ATM:{' '}
              <strong className="mono">{chainData?.atmStrike ?? '—'}</strong>
            </span>
            <span>Lot Size: <strong className="mono">{chainData?.lotSize ?? '—'}</strong></span>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {chainLoading && (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                Loading option strikes for {chainUnderlying}...
              </div>
            )}
            {!chainLoading && chainData && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right' }}>CE OI</th>
                    <th style={{ textAlign: 'right' }}>CE Delta</th>
                    <th style={{ textAlign: 'right' }}>Call Premium (Click → P{chainTargetPane + 1})</th>
                    <th style={{ textAlign: 'center' }}>Strike</th>
                    <th style={{ textAlign: 'left' }}>Put Premium (Click → P{chainTargetPane + 1})</th>
                    <th style={{ textAlign: 'right' }}>PE Delta</th>
                    <th style={{ textAlign: 'right' }}>PE OI</th>
                  </tr>
                </thead>
                <tbody>
                  {chainData.rows.map((r) => (
                    <tr
                      key={r.strike}
                      style={{
                        background: r.atm ? 'rgba(37, 99, 235, 0.14)' : undefined,
                      }}
                    >
                      <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{r.call.oi.toLocaleString('en-IN')}</td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.call.delta != null ? r.call.delta.toFixed(2) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="preset-btn"
                          style={{
                            borderColor: 'rgba(16, 185, 129, 0.5)',
                            color: '#10b981',
                            fontWeight: 700,
                            padding: '3px 9px',
                            fontSize: 11.5,
                          }}
                          disabled={!r.call.tradingSymbol}
                          onClick={() => {
                            if (!r.call.tradingSymbol) return;
                            setPaneSymbol(chainTargetPane, r.call.tradingSymbol, 'FNO');
                            if (!keepChainOpen) setShowChainBox(false);
                          }}
                          title={r.call.tradingSymbol || 'Unavailable'}
                        >
                          {r.call.ltp ? formatINR(r.call.ltp) : '—'} CE
                        </button>
                      </td>
                      <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>
                        {r.strike} {r.atm ? '★' : ''}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <button
                          type="button"
                          className="preset-btn"
                          style={{
                            borderColor: 'rgba(239, 68, 68, 0.5)',
                            color: '#ef4444',
                            fontWeight: 700,
                            padding: '3px 9px',
                            fontSize: 11.5,
                          }}
                          disabled={!r.put.tradingSymbol}
                          onClick={() => {
                            if (!r.put.tradingSymbol) return;
                            setPaneSymbol(chainTargetPane, r.put.tradingSymbol, 'FNO');
                            if (!keepChainOpen) setShowChainBox(false);
                          }}
                          title={r.put.tradingSymbol || 'Unavailable'}
                        >
                          {r.put.ltp ? formatINR(r.put.ltp) : '—'} PE
                        </button>
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.put.delta != null ? r.put.delta.toFixed(2) : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{r.put.oi.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
