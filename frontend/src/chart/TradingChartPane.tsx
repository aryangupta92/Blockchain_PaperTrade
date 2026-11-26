import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineStyle,
  Logical,
  PriceScaleMode,
  UTCTimestamp,
} from 'lightweight-charts';
import { BarChart2, FastForward, Pause, Play, RotateCcw, Search, X } from 'lucide-react';
import { AccountMode, api, formatINR, getMarketWsUrl } from '../apiClient';
import {
  Bar,
  calcADX,
  calcATR,
  calcBollinger,
  calcCCI,
  calcDonchian,
  calcEMA,
  calcHeikinAshi,
  calcKeltner,
  calcMACD,
  calcOBV,
  calcPivots,
  calcRSI,
  calcSMA,
  calcStochRSI,
  calcSupertrend,
  calcVWAP,
  calcWMA,
} from './chartIndicators';

export type ChartType = 'candles' | 'heikin_ashi' | 'bars' | 'line' | 'area';
export type ScaleMode = 'normal' | 'log' | 'percent';
export type DrawingTool =
  | 'cursor'
  | 'hline'
  | 'vline'
  | 'trendline'
  | 'zone'
  | 'demand_zone'
  | 'supply_zone'
  | 'fib'
  | 'measure'
  | 'text'
  | 'eraser';

export interface ChartPoint {
  time: number;
  logical?: number;
  price: number;
}

export interface ChartDrawing {
  id: string;
  type: Exclude<DrawingTool, 'cursor' | 'eraser'>;
  p1: ChartPoint;
  p2?: ChartPoint;
  text?: string;
}

export interface ChartPaneProps {
  mode: AccountMode;
  theme: 'dark' | 'light';
  symbol: string;
  segment: string;
  interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W';
  chartType: ChartType;
  scaleMode: ScaleMode;
  indicators: string[];
  compareSymbol?: string;
  activeTool: DrawingTool;
  drawings: ChartDrawing[];
  onAddDrawing: (d: ChartDrawing) => void;
  onRemoveDrawing?: (id: string) => void;
  onRemoveIndicator?: (ind: string) => void;
  onTradeClick: (
    symbol: string,
    side: 'BUY' | 'SELL',
    segment: string,
    ltp: string | null,
    priceOverride?: string | null,
    initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF'
  ) => void;
  height?: number;
  isActivePane?: boolean;
  paneLabel?: string;
  onSelectPane?: () => void;
  onChangeSymbol?: (symbol: string, segment: string) => void;
  onOpenPaneOptionChain?: () => void;
  hideDrawings?: boolean;
  tradeProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF';
}

function dateRangeForInterval(interval: string): { from: string; to: string } {
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  const to = new Date(istNow.getTime() + 86400 * 1000).toISOString().slice(0, 10);
  const days =
    interval === '1W' ? 730 :
      interval === '1D' ? 365 :
        interval === '1h' ? 60 :
          interval === '30m' || interval === '15m' ? 30 : 14;
  const from = new Date(istNow.getTime() - days * 86400 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 1];

export function TradingChartPane({
  mode,
  theme,
  symbol,
  segment,
  interval,
  chartType,
  scaleMode,
  indicators,
  compareSymbol,
  activeTool,
  drawings,
  onAddDrawing,
  onTradeClick,
  height = 460,
  onRemoveDrawing,
  onRemoveIndicator,
  isActivePane = false,
  paneLabel,
  onSelectPane,
  onChangeSymbol,
  onOpenPaneOptionChain,
  hideDrawings = false,
  tradeProduct,
}: ChartPaneProps) {
  const mainContainerRef = useRef<HTMLDivElement | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement | null>(null);
  const macdContainerRef = useRef<HTMLDivElement | null>(null);
  const extraOscContainerRef = useRef<HTMLDivElement | null>(null);

  const chartApiRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null>(null);

  const [bars, setBars] = useState<Bar[]>([]);
  const [compareBars, setCompareBars] = useState<Bar[]>([]);
  const [liveLtp, setLiveLtp] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ o: number; h: number; l: number; c: number; v: number; oi?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPoint, setPendingPoint] = useState<{ time: number; price: number } | null>(null);
  const [tradeToast, setTradeToast] = useState<string | null>(null);
  const [, setRenderTick] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  // Bar Replay State
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);

  // Chart Trading state: open position & resting draggable orders
  const [positionLine, setPositionLine] = useState<{ qty: number; product: string; avgPrice: number; pnl: string } | null>(null);
  const [restingOrders, setRestingOrders] = useState<Array<{ id: string; side: string; price: number; qty: number; type: string; legRole?: string | null; isTrigger: boolean }>>([]);
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragPreviewPrice, setDragPreviewPrice] = useState<number | null>(null);

  // Right-Click Context Menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; price: number } | null>(null);

  const showRsi = indicators.includes('RSI');
  const showMacd = indicators.includes('MACD');
  const extraOsc = indicators.find((i) => ['ATR', 'STOCHRSI', 'ADX', 'CCI', 'OBV'].includes(i)) || null;

  const visibleBars = useMemo(() => {
    if (replayIdx == null) return bars;
    return bars.slice(0, Math.max(10, replayIdx));
  }, [bars, replayIdx]);

  // Bar Replay Timer
  useEffect(() => {
    if (!replayPlaying || replayIdx == null) return;
    const t = window.setInterval(() => {
      setReplayIdx((prev) => {
        if (prev == null || prev >= bars.length) {
          setReplayPlaying(false);
          return null;
        }
        return prev + 1;
      });
    }, 450);
    return () => window.clearInterval(t);
  }, [replayPlaying, replayIdx, bars.length]);

  useEffect(() => {
    setRetryCount(0);
  }, [symbol, interval]);

  // 1. Fetch historical candles
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setReplayIdx(null);
    setReplayPlaying(false);
    const { from, to } = dateRangeForInterval(interval);

    api
      .candles({ symbol, interval, from, to })
      .then((res) => {
        if (!active) return;
        const byTime = new Map<number, Bar>();
        for (const bar of res.candles) {
          if (bar && Number.isFinite(bar.time)) byTime.set(bar.time, bar);
        }
        const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
        setBars(sorted);
        if (sorted.length > 0) setLiveLtp(sorted[sorted.length - 1].close.toFixed(2));
      })
      .catch((e) => {
        if (!active) return;
        setBars([]);
        setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [symbol, interval, reloadNonce]);

  useEffect(() => {
    if (loading || bars.length > 0 || retryCount >= 3) return;
    const t = window.setTimeout(() => {
      setRetryCount((c) => c + 1);
      setReloadNonce((n) => n + 1);
    }, 4_000);
    return () => window.clearTimeout(t);
  }, [loading, bars.length, retryCount]);

  // 2. Fetch comparison symbol candles
  useEffect(() => {
    if (!compareSymbol?.trim()) { setCompareBars([]); return; }
    let active = true;
    const { from, to } = dateRangeForInterval(interval);
    api
      .candles({ symbol: compareSymbol.trim(), interval, from, to })
      .then((res) => { if (active) setCompareBars([...res.candles].sort((a, b) => a.time - b.time)); })
      .catch(() => { if (active) setCompareBars([]); });
    return () => { active = false; };
  }, [compareSymbol, interval]);

  // 3. Load active positions & resting orders for Chart Trading overlays
  const refreshChartOverlays = useCallback(async () => {
    const [posRes, ordRes] = await Promise.all([api.positions(mode).catch(() => null), api.orders(mode).catch(() => null)]);
    const symUp = symbol.toUpperCase();
    const pos = posRes?.positions.find((p) => p.symbol.toUpperCase() === symUp && p.netQuantity !== 0);
    if (pos) {
      setPositionLine({
        qty: pos.netQuantity,
        product: pos.product,
        avgPrice: Number(pos.netQuantity > 0 ? pos.avgBuyPrice : pos.avgSellPrice),
        pnl: pos.netPnl,
      });
    } else {
      setPositionLine(null);
    }

    const openOrds = (ordRes?.orders || [])
      .filter((o) => o.instrument.symbol.toUpperCase() === symUp && ['OPEN', 'TRIGGER_PENDING'].includes(o.status))
      .map((o) => ({
        id: o.id,
        side: o.side,
        price: Number(o.price || o.triggerPrice || 0),
        qty: o.quantity,
        type: o.orderType,
        legRole: o.legRole,
        isTrigger: o.status === 'TRIGGER_PENDING' || Boolean(o.triggerPrice && !o.price),
      }))
      .filter((o) => o.price > 0);
    setRestingOrders(openOrds);
  }, [mode, symbol]);

  useEffect(() => {
    refreshChartOverlays();
  }, [refreshChartOverlays]);

  // 4. Real-time WebSocket tick streaming updating right-most bar live
  useEffect(() => {
    if (replayIdx != null) return;
    const ws = new WebSocket(getMarketWsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', symbols: [symbol] }));
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as { type: string; data?: { symbol?: string; ltp?: string | null } };
        if (msg.type === 'quote' && msg.data?.ltp) {
          const px = Number(msg.data.ltp);
          if (!Number.isFinite(px) || px <= 0) return;
          setLiveLtp(px.toFixed(2));
          setBars((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            const updated: Bar = { ...last, close: px, high: Math.max(last.high, px), low: Math.min(last.low, px) };
            if (mainSeriesRef.current) {
              try {
                if (chartType === 'line' || chartType === 'area') {
                  (mainSeriesRef.current as ISeriesApi<'Line'>).update({ time: updated.time as UTCTimestamp, value: updated.close });
                } else {
                  (mainSeriesRef.current as ISeriesApi<'Candlestick'>).update({
                    time: updated.time as UTCTimestamp,
                    open: updated.open,
                    high: updated.high,
                    low: updated.low,
                    close: updated.close,
                  });
                }
              } catch { /* ignore */ }
            }
            return [...prev.slice(0, -1), updated];
          });
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [symbol, chartType, replayIdx]);

  const visibleBarsRef = useRef<Bar[]>(visibleBars);
  visibleBarsRef.current = visibleBars;
  const [previewPoint, setPreviewPoint] = useState<ChartPoint | null>(null);
  const dragStartPxRef = useRef<{ x: number; y: number } | null>(null);
  const [indicatorReadings, setIndicatorReadings] = useState<Array<{ id: string; label: string; color: string; value: string }>>([]);
  const [inlineSymOpen, setInlineSymOpen] = useState(false);
  const [inlineQuery, setInlineQuery] = useState('');
  const [inlineHits, setInlineHits] = useState<Array<{ symbol: string; tradingSymbol: string; exchange: string; segment: string }>>([]);
  const [textDraftPt, setTextDraftPt] = useState<ChartPoint | null>(null);
  const [textDraftVal, setTextDraftVal] = useState('');

  useEffect(() => {
    setPendingPoint(null);
    setPreviewPoint(null);
    setTextDraftPt(null);
  }, [activeTool, symbol]);

  useEffect(() => {
    const q = inlineQuery.trim();
    if (!inlineSymOpen || q.length < 1) {
      setInlineHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchInstruments({ q, limit: 10 }).then((r) => setInlineHits(r.instruments)).catch(() => { });
    }, 180);
    return () => clearTimeout(timer);
  }, [inlineQuery, inlineSymOpen]);

  const displayBars = useMemo(
    () => (chartType === 'heikin_ashi' ? calcHeikinAshi(visibleBars) : visibleBars),
    [visibleBars, chartType]
  );

  // 5. Mount & update Lightweight Charts
  useEffect(() => {
    const container = mainContainerRef.current;
    if (!container) return;

    const isDark = theme === 'dark';
    const chart = createChart(container, {
      width: Math.max(300, container.clientWidth),
      height,
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#0d1117' : '#ffffff' },
        textColor: isDark ? '#9ca3af' : '#334155',
      },
      grid: {
        vertLines: { color: isDark ? '#161e2e' : '#e2e8f0' },
        horzLines: { color: isDark ? '#161e2e' : '#e2e8f0' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(148, 163, 184, 0.45)', style: LineStyle.Dashed },
        horzLine: { color: 'rgba(148, 163, 184, 0.45)', style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: isDark ? '#1f2937' : '#cbd5e1',
        scaleMargins: { top: 0.08, bottom: 0.14 },
        mode:
          scaleMode === 'log'
            ? PriceScaleMode.Logarithmic
            : scaleMode === 'percent' || Boolean(compareSymbol?.trim())
              ? PriceScaleMode.Percentage
              : PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: isDark ? '#1f2937' : '#cbd5e1',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 16,
        barSpacing: 7,
      },
    });
    chartApiRef.current = chart;

    let mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>;
    if (chartType === 'line') {
      mainSeries = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2 });
      mainSeries.setData(displayBars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
    } else if (chartType === 'area') {
      mainSeries = chart.addAreaSeries({ lineColor: '#38bdf8', topColor: 'rgba(56, 189, 248, 0.35)', bottomColor: 'rgba(56, 189, 248, 0.02)' });
      mainSeries.setData(displayBars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
    } else if (chartType === 'bars') {
      mainSeries = chart.addBarSeries({ upColor: '#10b981', downColor: '#ef4444' });
      mainSeries.setData(displayBars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    } else {
      mainSeries = chart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981', borderDownColor: '#ef4444', wickUpColor: '#10b981', wickDownColor: '#ef4444',
      });
      mainSeries.setData(displayBars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    }
    mainSeriesRef.current = mainSeries;

    // Overlay Indicators + TradingView Legend Readouts
    const readings: Array<{ id: string; label: string; color: string; value: string }> = [];
    if (indicators.includes('EMA_CROSS_9_20')) {
      const e9 = calcEMA(visibleBars, 9);
      const e20 = calcEMA(visibleBars, 20);
      chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'EMA 9' }).setData(e9.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'EMA 20' }).setData(e20.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v9 = e9[e9.length - 1]?.value;
      const v20 = e20[e20.length - 1]?.value;
      readings.push({ id: 'EMA_CROSS_9_20', label: 'EMA Cross 9 20', color: '#f59e0b', value: `${v9 != null ? v9.toFixed(1) : '—'} · ${v20 != null ? v20.toFixed(1) : '—'}` });
    }
    if (indicators.includes('EMA9') && !indicators.includes('EMA_CROSS_9_20')) {
      const e9 = calcEMA(visibleBars, 9);
      chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'EMA 9' }).setData(e9.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = e9[e9.length - 1]?.value;
      readings.push({ id: 'EMA9', label: 'EMA 9', color: '#f59e0b', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('EMA20') && !indicators.includes('EMA_CROSS_9_20')) {
      const e20 = calcEMA(visibleBars, 20);
      chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'EMA 20' }).setData(e20.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = e20[e20.length - 1]?.value;
      readings.push({ id: 'EMA20', label: 'EMA 20', color: '#3b82f6', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('SMA20')) {
      const s20 = calcSMA(visibleBars, 20);
      chart.addLineSeries({ color: '#eab308', lineWidth: 1, title: 'SMA 20' }).setData(s20.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = s20[s20.length - 1]?.value;
      readings.push({ id: 'SMA20', label: 'SMA 20', color: '#eab308', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('SMA50')) {
      const s50 = calcSMA(visibleBars, 50);
      chart.addLineSeries({ color: '#06b6d4', lineWidth: 1, title: 'SMA 50' }).setData(s50.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = s50[s50.length - 1]?.value;
      readings.push({ id: 'SMA50', label: 'SMA 50', color: '#06b6d4', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('EMA50')) {
      const e50 = calcEMA(visibleBars, 50);
      chart.addLineSeries({ color: '#a855f7', lineWidth: 1, title: 'EMA 50' }).setData(e50.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = e50[e50.length - 1]?.value;
      readings.push({ id: 'EMA50', label: 'EMA 50', color: '#a855f7', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('EMA200')) {
      const e200 = calcEMA(visibleBars, 200);
      chart.addLineSeries({ color: '#ec4899', lineWidth: 2, title: 'EMA 200' }).setData(e200.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = e200[e200.length - 1]?.value;
      readings.push({ id: 'EMA200', label: 'EMA 200', color: '#ec4899', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('WMA20')) {
      const w20 = calcWMA(visibleBars, 20);
      chart.addLineSeries({ color: '#14b8a6', lineWidth: 1, title: 'WMA 20' }).setData(w20.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = w20[w20.length - 1]?.value;
      readings.push({ id: 'WMA20', label: 'WMA 20', color: '#14b8a6', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('VWAP')) {
      const vw = calcVWAP(visibleBars);
      chart.addLineSeries({ color: '#38bdf8', lineWidth: 2, lineStyle: LineStyle.Dashed, title: 'VWAP' }).setData(vw.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = vw[vw.length - 1]?.value;
      readings.push({ id: 'VWAP', label: 'VWAP', color: '#38bdf8', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('BB')) {
      const bb = calcBollinger(visibleBars, 20, 2);
      chart.addLineSeries({ color: 'rgba(148,163,184,0.65)', lineWidth: 1, title: 'BB Upper' }).setData(bb.upper.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      chart.addLineSeries({ color: 'rgba(148,163,184,0.4)', lineWidth: 1, lineStyle: LineStyle.Dotted }).setData(bb.middle.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      chart.addLineSeries({ color: 'rgba(148,163,184,0.65)', lineWidth: 1, title: 'BB Lower' }).setData(bb.lower.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      const v = bb.middle[bb.middle.length - 1]?.value;
      readings.push({ id: 'BB', label: 'BB(20,2)', color: '#94a3b8', value: v != null ? v.toFixed(1) : '—' });
    }
    if (indicators.includes('DONCHIAN')) {
      const dc = calcDonchian(visibleBars, 20);
      chart.addLineSeries({ color: '#22d3ee', lineWidth: 1, title: 'DC Upper' }).setData(dc.upper.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      chart.addLineSeries({ color: '#22d3ee', lineWidth: 1, title: 'DC Lower' }).setData(dc.lower.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      readings.push({ id: 'DONCHIAN', label: 'Donchian 20', color: '#22d3ee', value: `${dc.upper[dc.upper.length - 1]?.value?.toFixed(1) ?? '—'}` });
    }
    if (indicators.includes('KELTNER')) {
      const kc = calcKeltner(visibleBars, 20, 10, 2);
      chart.addLineSeries({ color: '#fb7185', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'KC Upper' }).setData(kc.upper.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      chart.addLineSeries({ color: '#fb7185', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'KC Lower' }).setData(kc.lower.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      readings.push({ id: 'KELTNER', label: 'Keltner', color: '#fb7185', value: `${kc.upper[kc.upper.length - 1]?.value?.toFixed(1) ?? '—'}` });
    }
    if (indicators.includes('SUPERTREND')) {
      const st = calcSupertrend(visibleBars, 10, 3);
      chart.addLineSeries({ lineWidth: 2, title: 'Supertrend' }).setData(st.map((p) => ({ time: p.time as UTCTimestamp, value: p.value, color: p.color })));
      const lastSt = st[st.length - 1];
      readings.push({ id: 'SUPERTREND', label: 'Supertrend', color: lastSt?.color || '#10b981', value: lastSt ? lastSt.value.toFixed(1) : '—' });
    }
    if (indicators.includes('PIVOTS')) {
      const piv = calcPivots(visibleBars);
      if (piv) {
        mainSeries.createPriceLine({ price: piv.pivot, color: '#eab308', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'CPR Pivot' });
        mainSeries.createPriceLine({ price: piv.r1, color: 'rgba(239,68,68,0.7)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'R1' });
        mainSeries.createPriceLine({ price: piv.s1, color: 'rgba(16,185,129,0.7)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'S1' });
        readings.push({ id: 'PIVOTS', label: 'Pivot', color: '#eab308', value: piv.pivot.toFixed(1) });
      }
    }
    if (indicators.includes('VOLUME')) {
      const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(visibleBars.map((b) => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? 'rgba(16,185,129,0.28)' : 'rgba(239,68,68,0.28)' })));
    }
    if (indicators.includes('OI') && visibleBars.some((b) => b.oi != null && b.oi > 0)) {
      const oiSeries = chart.addLineSeries({ color: '#ec4899', lineWidth: 1, priceScaleId: 'oi', title: 'OI' });
      chart.priceScale('oi').applyOptions({ scaleMargins: { top: 0.72, bottom: 0.1 } });
      oiSeries.setData(visibleBars.filter((b) => b.oi != null).map((b) => ({ time: b.time as UTCTimestamp, value: b.oi! })));
    }
    if (compareSymbol?.trim() && compareBars.length > 0) {
      chart.addLineSeries({ color: '#f97316', lineWidth: 2, title: compareSymbol.toUpperCase() }).setData(compareBars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
    }
    setIndicatorReadings(readings);

    // Position & Resting Order Price Lines
    if (positionLine) {
      mainSeries.createPriceLine({
        price: positionLine.avgPrice,
        color: positionLine.qty > 0 ? '#10b981' : '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `POS ${positionLine.qty > 0 ? '+' : ''}${positionLine.qty} (₹${positionLine.pnl})`,
      });
    }
    for (const o of restingOrders) {
      mainSeries.createPriceLine({
        price: o.price,
        color: o.legRole === 'TARGET' ? '#10b981' : (o.legRole === 'STOP_LOSS' || o.legRole === 'SL') ? '#ef4444' : o.side === 'BUY' ? '#38bdf8' : '#f59e0b',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${o.legRole || o.side} ${o.type} ×${o.qty} (Drag to Modify)`,
      });
    }

    if (!hideDrawings) {
      for (const d of drawings) {
        if (d.type === 'hline') {
          mainSeries.createPriceLine({ price: d.p1.price, color: '#f59e0b', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'H-Line' });
        } else if ((d.type === 'demand_zone' || d.type === 'supply_zone') && d.p2) {
          const zColor = d.type === 'demand_zone' ? '#22c55e' : '#ef4444';
          mainSeries.createPriceLine({ price: Math.max(d.p1.price, d.p2.price), color: zColor, lineWidth: 1, lineVisible: false, axisLabelVisible: true, title: '' });
          mainSeries.createPriceLine({ price: Math.min(d.p1.price, d.p2.price), color: zColor, lineWidth: 1, lineVisible: false, axisLabelVisible: true, title: '' });
        }
      }
    }

    chart.timeScale().fitContent();
    const barByTime = new Map(visibleBars.map((b) => [b.time, b]));
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return;
      const b = barByTime.get(Number(param.time));
      if (b) setHoverInfo({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, oi: b.oi });
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => setRenderTick((t) => t + 1));

    const ro = new ResizeObserver(() => {
      if (container.clientWidth > 0) {
        chart.applyOptions({ width: container.clientWidth });
        setRenderTick((t) => t + 1);
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart.remove();
      chartApiRef.current = null;
      mainSeriesRef.current = null;
    };
  }, [displayBars, visibleBars, compareBars, compareSymbol, chartType, scaleMode, indicators, theme, height, positionLine, restingOrders, drawings, hideDrawings]);

  // 6. RSI Sub-pane
  useEffect(() => {
    if (!showRsi || !rsiContainerRef.current) return;
    const isDark = theme === 'dark';
    const c = createChart(rsiContainerRef.current, {
      width: rsiContainerRef.current.clientWidth, height: 100,
      layout: { background: { type: ColorType.Solid, color: isDark ? '#0f1624' : '#ffffff' }, textColor: isDark ? '#94a3b8' : '#334155' },
      grid: { vertLines: { color: isDark ? '#1a2438' : '#e2e8f0' }, horzLines: { color: isDark ? '#1a2438' : '#e2e8f0' } },
      timeScale: { visible: false },
    });
    const s = c.addLineSeries({ color: '#c084fc', lineWidth: 2, title: 'RSI 14' });
    s.setData(calcRSI(visibleBars, 14).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    s.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    s.createPriceLine({ price: 30, color: 'rgba(16,185,129,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    c.timeScale().fitContent();
    return () => c.remove();
  }, [showRsi, visibleBars, theme]);

  // 7. MACD Sub-pane
  useEffect(() => {
    if (!showMacd || !macdContainerRef.current) return;
    const isDark = theme === 'dark';
    const c = createChart(macdContainerRef.current, {
      width: macdContainerRef.current.clientWidth, height: 100,
      layout: { background: { type: ColorType.Solid, color: isDark ? '#0f1624' : '#ffffff' }, textColor: isDark ? '#94a3b8' : '#334155' },
      grid: { vertLines: { color: isDark ? '#1a2438' : '#e2e8f0' }, horzLines: { color: isDark ? '#1a2438' : '#e2e8f0' } },
      timeScale: { visible: false },
    });
    const m = calcMACD(visibleBars, 12, 26, 9);
    c.addHistogramSeries({}).setData(m.hist.map((p) => ({ time: p.time as UTCTimestamp, value: p.value, color: p.color })));
    c.addLineSeries({ color: '#38bdf8', lineWidth: 1, title: 'MACD' }).setData(m.macd.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    c.addLineSeries({ color: '#f97316', lineWidth: 1, title: 'Signal' }).setData(m.signal.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [showMacd, visibleBars, theme]);

  // 8. Additional Oscillator Sub-pane (ATR / StochRSI / ADX / CCI / OBV)
  useEffect(() => {
    if (!extraOsc || !extraOscContainerRef.current) return;
    const isDark = theme === 'dark';
    const c = createChart(extraOscContainerRef.current, {
      width: extraOscContainerRef.current.clientWidth, height: 100,
      layout: { background: { type: ColorType.Solid, color: isDark ? '#0f1624' : '#ffffff' }, textColor: isDark ? '#94a3b8' : '#334155' },
      grid: { vertLines: { color: isDark ? '#1a2438' : '#e2e8f0' }, horzLines: { color: isDark ? '#1a2438' : '#e2e8f0' } },
      timeScale: { visible: false },
    });
    const data =
      extraOsc === 'ATR' ? calcATR(visibleBars, 14) :
        extraOsc === 'STOCHRSI' ? calcStochRSI(visibleBars, 14, 14) :
          extraOsc === 'ADX' ? calcADX(visibleBars, 14) :
            extraOsc === 'CCI' ? calcCCI(visibleBars, 20) :
              calcOBV(visibleBars);
    c.addLineSeries({ color: '#38bdf8', lineWidth: 2, title: extraOsc }).setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [extraOsc, visibleBars, theme]);

  // Drag-to-Modify release commits PUT /api/v1/orders/:id
  useEffect(() => {
    if (!draggingOrderId) return;
    const onMove = (e: MouseEvent) => {
      if (!mainContainerRef.current || !mainSeriesRef.current) return;
      const rect = mainContainerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const px = mainSeriesRef.current.coordinateToPrice(y);
      if (px != null && px > 0) setDragPreviewPrice(Number((Math.round(px * 20) / 20).toFixed(2)));
    };
    const onUp = async () => {
      const ord = restingOrders.find((o) => o.id === draggingOrderId);
      const targetPx = dragPreviewPrice;
      setDraggingOrderId(null);
      setDragPreviewPrice(null);
      if (!ord || targetPx == null) return;
      try {
        await api.modifyOrder(ord.id, ord.isTrigger ? { triggerPrice: targetPx } : { price: targetPx });
        setTradeToast(`Modified ${ord.legRole || ord.side} order to ${formatINR(targetPx)}.`);
        await refreshChartOverlays();
      } catch (err) {
        setTradeToast(`Modify failed: ${(err as Error).message}`);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingOrderId, dragPreviewPrice, restingOrders, refreshChartOverlays]);

  const handleReverseFromChart = async () => {
    if (!positionLine) return;
    try {
      await api.reversePosition(mode, { symbol, product: positionLine.product === 'NRML' ? 'NRML' : 'MIS' });
      setTradeToast(`Reversed ${symbol} position.`);
      await refreshChartOverlays();
    } catch (e) {
      setTradeToast((e as Error).message);
    }
  };

  const handleExitFromChart = async () => {
    if (!positionLine) return;
    try {
      await api.squareOffPosition(mode, {
        symbol,
        product: positionLine.product,
        quantity: Math.abs(positionLine.qty),
        currentNetQuantity: positionLine.qty,
      });
      setTradeToast(`Squared off ${symbol}.`);
      await refreshChartOverlays();
    } catch (e) {
      setTradeToast((e as Error).message);
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!mainContainerRef.current || !mainSeriesRef.current) return;
    const rect = mainContainerRef.current.getBoundingClientRect();
    const px = mainSeriesRef.current.coordinateToPrice(e.clientY - rect.top);
    if (px == null || px <= 0) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, price: Number((Math.round(px * 20) / 20).toFixed(2)) });
  };

  const toChartPoint = (clientX: number, clientY: number, svgEl: SVGSVGElement): ChartPoint | null => {
    const chart = chartApiRef.current;
    const series = mainSeriesRef.current;
    if (!chart || !series) return null;
    const rect = svgEl.getBoundingClientRect();
    const xPx = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
    const yPx = Math.max(0, Math.min(rect.height - 1, clientY - rect.top));
    const priceVal = series.coordinateToPrice(yPx);
    if (priceVal == null || !Number.isFinite(priceVal)) return null;
    const timeScale = chart.timeScale();
    const timeVal = timeScale.coordinateToTime(xPx);
    const logicalVal = timeScale.coordinateToLogical(xPx);
    const vb = visibleBarsRef.current;
    const lastIdx = vb.length - 1;
    const stepSec = vb.length >= 2 ? Math.max(60, vb[lastIdx].time - vb[lastIdx - 1].time) : 300;
    let resolvedTime = timeVal != null ? Number(timeVal) : 0;
    if (!resolvedTime && logicalVal != null && vb.length > 0) {
      resolvedTime = Math.round(vb[lastIdx].time + (Number(logicalVal) - lastIdx) * stepSec);
    }
    if (!resolvedTime) resolvedTime = Math.floor(Date.now() / 1000);
    return {
      time: resolvedTime,
      logical: logicalVal != null ? Number(logicalVal) : undefined,
      price: Number(priceVal.toFixed(2)),
    };
  };

  const handleOverlayPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    onSelectPane?.();
    if (activeTool === 'cursor' || activeTool === 'eraser' || e.button !== 0) return;
    const pt = toChartPoint(e.clientX, e.clientY, e.currentTarget);
    if (!pt) return;
    dragStartPxRef.current = { x: e.clientX, y: e.clientY };

    if (activeTool === 'hline' || activeTool === 'vline') {
      onAddDrawing({ id: `drw-${Date.now()}`, type: activeTool, p1: pt });
      setPendingPoint(null);
      setPreviewPoint(null);
      return;
    }
    if (activeTool === 'text') {
      setTextDraftPt(pt);
      setTextDraftVal('');
      return;
    }
    if (!pendingPoint) {
      setPendingPoint(pt);
      setPreviewPoint(pt);
    } else {
      onAddDrawing({ id: `drw-${Date.now()}`, type: activeTool, p1: pendingPoint, p2: pt });
      setPendingPoint(null);
      setPreviewPoint(null);
    }
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pendingPoint) return;
    const pt = toChartPoint(e.clientX, e.clientY, e.currentTarget);
    if (pt) setPreviewPoint(pt);
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const start = dragStartPxRef.current;
    dragStartPxRef.current = null;
    if (!start || !pendingPoint || activeTool === 'cursor' || activeTool === 'eraser') return;
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (dist > 10) {
      const pt = toChartPoint(e.clientX, e.clientY, e.currentTarget);
      if (pt) {
        onAddDrawing({ id: `drw-${Date.now()}`, type: activeTool, p1: pendingPoint, p2: pt });
        setPendingPoint(null);
        setPreviewPoint(null);
      }
    }
  };

  const projectPoint = (pt: ChartPoint) => {
    const chart = chartApiRef.current;
    const series = mainSeriesRef.current;
    if (!chart || !series) return null;
    const timeScale = chart.timeScale();
    let x = timeScale.timeToCoordinate(pt.time as UTCTimestamp);
    if (x == null) {
      const vb = visibleBarsRef.current;
      if (vb.length > 0) {
        const lastIdx = vb.length - 1;
        const stepSec = vb.length >= 2 ? Math.max(60, vb[lastIdx].time - vb[lastIdx - 1].time) : 300;
        if (pt.time >= vb[lastIdx].time) {
          const estLogical = lastIdx + (pt.time - vb[lastIdx].time) / stepSec;
          x = timeScale.logicalToCoordinate(estLogical as unknown as Logical);
        } else if (pt.logical != null) {
          x = timeScale.logicalToCoordinate(pt.logical as unknown as Logical);
        }
      }
    }
    const y = series.priceToCoordinate(pt.price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  const isIndex = segment === 'FNO' && !symbol.includes('-') && ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'INDIAVIX'].includes(symbol.toUpperCase());
  const latestBar = visibleBars[visibleBars.length - 1];
  const prevBar = visibleBars[visibleBars.length - 2];
  const ohlcShown = hoverInfo || (latestBar ? { o: latestBar.open, h: latestBar.high, l: latestBar.low, c: latestBar.close, v: latestBar.volume, oi: latestBar.oi } : null);
  const barRefPrev = prevBar ? prevBar.close : (ohlcShown?.o || 0);
  const barDelta = ohlcShown && barRefPrev > 0 ? ohlcShown.c - barRefPrev : 0;
  const barDeltaPct = ohlcShown && barRefPrev > 0 ? (barDelta / barRefPrev) * 100 : 0;
  const ohlcPos = barDelta >= 0;

  return (
    <div
      className="card"
      style={{
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: theme === 'dark' ? '#0b0f17' : undefined,
        border: isActivePane ? '2px solid #2563eb' : '1px solid var(--border-subtle)',
        boxShadow: isActivePane ? '0 0 0 1px rgba(37, 99, 235, 0.35)' : undefined,
      }}
      onClick={() => {
        setCtxMenu(null);
        onSelectPane?.();
      }}
    >
      {/* TradingView-style Pane Header & Top-Left Live Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {paneLabel && (
              <span
                className="badge"
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  background: isActivePane ? '#2563eb' : 'var(--bg-elevated)',
                  color: isActivePane ? '#fff' : 'var(--text-muted)',
                }}
              >
                {paneLabel}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectPane?.();
                setInlineSymOpen((v) => !v);
                setInlineQuery('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--text-primary)',
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
              title="Click to change this pane's symbol"
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              <span>{symbol}</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 11.5 }}>
                · {interval} · {segment}
              </span>
              {onChangeSymbol && <Search size={11} color="var(--text-muted)" />}
            </button>

            {onOpenPaneOptionChain && (
              <button
                type="button"
                className="preset-btn"
                style={{ padding: '1px 6px', fontSize: 10.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPane?.();
                  onOpenPaneOptionChain();
                }}
                title="Pick any Option Strike/Premium onto this pane"
              >
                <BarChart2 size={10} /> Option Chain
              </button>
            )}

            <span className="mono" style={{ fontSize: 13.5, fontWeight: 800 }}>
              {liveLtp ? formatINR(liveLtp) : '—'}
            </span>

            {ohlcShown && (
              <span className="mono" style={{ fontSize: 11, color: ohlcPos ? '#10b981' : '#ef4444' }}>
                O {ohlcShown.o.toFixed(1)} H {ohlcShown.h.toFixed(1)} L {ohlcShown.l.toFixed(1)} C {ohlcShown.c.toFixed(1)}{' '}
                ({barDelta >= 0 ? '+' : ''}{barDelta.toFixed(1)}, {barDeltaPct >= 0 ? '+' : ''}{barDeltaPct.toFixed(2)}%)
                {ohlcShown.oi ? ` · OI ${ohlcShown.oi.toLocaleString('en-IN')}` : ''}
              </span>
            )}
          </div>

          {inlineSymOpen && onChangeSymbol && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 26,
                left: 0,
                width: 300,
                zIndex: 80,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-strong)',
                borderRadius: 8,
                padding: 8,
                boxShadow: '0 14px 32px rgba(0,0,0,0.55)',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <input
                  autoFocus
                  className="input"
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
                  placeholder="Type symbol for this pane..."
                  value={inlineQuery}
                  onChange={(e) => setInlineQuery(e.target.value)}
                />
                <button type="button" className="theme-toggle" style={{ padding: '4px 6px' }} onClick={() => setInlineSymOpen(false)}>
                  <X size={12} />
                </button>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {inlineHits.map((h) => (
                  <div
                    key={`${h.exchange}-${h.tradingSymbol}`}
                    onClick={() => {
                      onChangeSymbol(h.tradingSymbol, h.segment);
                      setInlineSymOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '5px 6px',
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      fontSize: 11.5,
                    }}
                  >
                    <strong>{h.tradingSymbol}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{h.exchange} · {h.segment}</span>
                  </div>
                ))}
                {inlineQuery.trim() && inlineHits.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>Searching instruments...</div>
                )}
              </div>
            </div>
          )}

          {indicatorReadings.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11 }}>
              {indicatorReadings.map((ir) => (
                <span key={ir.id} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ir.color }} />
                  <span>{ir.label}</span>
                  <strong style={{ color: ir.color }}>{ir.value}</strong>
                  {onRemoveIndicator && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveIndicator(ir.id);
                      }}
                      style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: 11 }}
                      title={`Remove ${ir.label}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="preset-btn"
            style={{ fontSize: 11, padding: '3px 7px' }}
            title="Reload candles"
            onClick={(e) => {
              e.stopPropagation();
              setRetryCount(0);
              setReloadNonce((n) => n + 1);
            }}
          >
            <RotateCcw size={11} /> Reload
          </button>
          {/* Bar Replay Controls */}
          {bars.length > 25 && (
            <div style={{ display: 'inline-flex', gap: 3, alignItems: 'center', marginRight: 4 }}>
              {replayIdx == null ? (
                <button
                  className="preset-btn"
                  style={{ fontSize: 11, padding: '3px 7px' }}
                  title="Bar Replay Mode"
                  onClick={() => setReplayIdx(Math.max(15, Math.floor(bars.length * 0.6)))}
                >
                  <RotateCcw size={11} /> Replay
                </button>
              ) : (
                <>
                  <button className="preset-btn active" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => setReplayPlaying((p) => !p)}>
                    {replayPlaying ? <Pause size={11} /> : <Play size={11} />}
                  </button>
                  <button className="preset-btn" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => setReplayIdx((i) => (i != null && i < bars.length ? i + 1 : null))}>
                    <FastForward size={11} /> +1
                  </button>
                  <button className="preset-btn" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => { setReplayPlaying(false); setReplayIdx(null); }}>
                    Exit ({replayIdx}/{bars.length})
                  </button>
                </>
              )}
            </div>
          )}

          {!isIndex && (
            <>
              <button
                className="preset-btn"
                style={{ borderColor: '#ef4444', background: 'rgba(239,68,68,0.16)', color: '#f87171', fontWeight: 700, padding: '3px 9px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTradeClick(symbol, 'SELL', segment, liveLtp, null, tradeProduct);
                }}
              >
                Sell
              </button>
              <button
                className="preset-btn"
                style={{ borderColor: '#2563eb', background: '#2563eb', color: '#fff', fontWeight: 700, padding: '3px 9px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTradeClick(symbol, 'BUY', segment, liveLtp, null, tradeProduct);
                }}
              >
                Buy
              </button>
            </>
          )}
        </div>
      </div>

      {/* Live Position Action Bar + Draggable Order Handles */}
      {(positionLine || restingOrders.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, padding: '5px 8px', background: 'var(--bg-elevated)', borderRadius: 7 }}>
          {positionLine && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-gain">
                POS {positionLine.qty > 0 ? '+' : ''}{positionLine.qty} @ {formatINR(positionLine.avgPrice)} · P&amp;L {formatINR(positionLine.pnl)}
              </span>
              <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11 }} onClick={handleReverseFromChart}>⇄ Rev</button>
              <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={handleExitFromChart}>× Exit</button>
            </div>
          )}
          {restingOrders.map((o) => (
            <span
              key={o.id}
              className="badge badge-warn"
              style={{ cursor: 'ns-resize', userSelect: 'none' }}
              title="Drag up/down on chart to modify this order price"
              onMouseDown={() => setDraggingOrderId(o.id)}
            >
              ↕ {o.legRole || o.side} {o.qty} @ {formatINR(draggingOrderId === o.id && dragPreviewPrice ? dragPreviewPrice : o.price)}
            </span>
          ))}
        </div>
      )}

      {tradeToast && <div className="alert-success" style={{ padding: '5px 10px', fontSize: 11.5 }}>{tradeToast}</div>}
      {activeTool !== 'cursor' && (
        <div style={{ fontSize: 11, color: activeTool === 'eraser' ? '#f87171' : '#38bdf8' }}>
          {activeTool === 'eraser'
            ? 'Eraser active — click any drawn shape on this chart to remove it'
            : `Drawing: ${activeTool.replace('_', ' ').toUpperCase()} — ${pendingPoint ? 'move & click (or release drag) for 2nd point' : 'click or drag anywhere on chart (including right margin)'}`}
        </div>
      )}
      {error && <div className="alert-error">{error}</div>}
      {loading && bars.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading historical candles...</div>}

      {/* Main Chart Canvas + Drag Handles + SVG Drawing Overlay */}
      <div style={{ position: 'relative', width: '100%', height }} onContextMenu={handleContextMenu}>
        <div ref={mainContainerRef} style={{ width: '100%', height: '100%' }} />

        {bars.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 8,
              pointerEvents: 'none',
              color: 'var(--text-muted)',
              fontSize: 12.5,
            }}
          >
            <span>{loading ? `Loading ${symbol} (${interval}) candles...` : `No historical candles loaded yet for ${symbol}`}</span>
            {!loading && (
              <button
                type="button"
                className="preset-btn"
                style={{ pointerEvents: 'auto', fontSize: 11.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setRetryCount(0);
                  setReloadNonce((n) => n + 1);
                }}
              >
                <RotateCcw size={12} /> Reload Candles
              </button>
            )}
          </div>
        )}

        {/* Interactive Drag-to-Modify Pills projected directly onto order price Y coordinates */}
        {restingOrders.map((o) => {
          const y = mainSeriesRef.current?.priceToCoordinate(draggingOrderId === o.id && dragPreviewPrice ? dragPreviewPrice : o.price);
          if (y == null || y < 5 || y > height - 22) return null;
          return (
            <div
              key={o.id}
              onMouseDown={(e) => { e.stopPropagation(); setDraggingOrderId(o.id); }}
              style={{
                position: 'absolute',
                left: 8,
                top: y - 11,
                zIndex: 15,
                background: o.legRole === 'TARGET' ? '#10b981' : (o.legRole === 'STOP_LOSS' || o.legRole === 'SL') ? '#ef4444' : '#38bdf8',
                color: '#0b0f17',
                fontSize: 10.5,
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 5,
                cursor: 'ns-resize',
                userSelect: 'none',
                boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
              }}
            >
              ↕ {o.legRole || o.side} ×{o.qty} @ {(draggingOrderId === o.id && dragPreviewPrice ? dragPreviewPrice : o.price).toFixed(2)}
            </div>
          );
        })}

        {/* Inline Text Annotation Prompt */}
        {textDraftPt && (() => {
          const pt = projectPoint(textDraftPt);
          if (!pt) return null;
          return (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: Math.max(8, Math.min(pt.x, 300)),
                top: Math.max(8, Math.min(pt.y, height - 45)),
                zIndex: 40,
                background: 'var(--bg-surface)',
                border: '1px solid #38bdf8',
                borderRadius: 6,
                padding: 5,
                display: 'flex',
                gap: 4,
              }}
            >
              <input
                autoFocus
                className="input"
                style={{ fontSize: 11.5, padding: '3px 6px', width: 150 }}
                placeholder="Note / Level..."
                value={textDraftVal}
                onChange={(e) => setTextDraftVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && textDraftVal.trim()) {
                    onAddDrawing({ id: `drw-${Date.now()}`, type: 'text', p1: textDraftPt, text: textDraftVal.trim() });
                    setTextDraftPt(null);
                  } else if (e.key === 'Escape') {
                    setTextDraftPt(null);
                  }
                }}
              />
              <button
                type="button"
                className="preset-btn active"
                style={{ fontSize: 11, padding: '2px 7px' }}
                onClick={() => {
                  if (textDraftVal.trim()) {
                    onAddDrawing({ id: `drw-${Date.now()}`, type: 'text', p1: textDraftPt, text: textDraftVal.trim() });
                  }
                  setTextDraftPt(null);
                }}
              >
                Add
              </button>
            </div>
          );
        })()}

        <svg
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            zIndex: 12,
            pointerEvents: activeTool === 'cursor' ? 'none' : 'auto',
            cursor: activeTool === 'cursor' ? 'default' : activeTool === 'eraser' ? 'not-allowed' : 'crosshair',
          }}
        >
          {!hideDrawings &&
            [
              ...drawings,
              ...(pendingPoint && previewPoint && activeTool !== 'cursor' && activeTool !== 'eraser' && activeTool !== 'hline' && activeTool !== 'vline' && activeTool !== 'text'
                ? [{ id: '__preview__', type: activeTool, p1: pendingPoint, p2: previewPoint } as ChartDrawing]
                : []),
            ].map((d) => {
              const isEraser = activeTool === 'eraser' && d.id !== '__preview__';
              const eraserProps = isEraser
                ? {
                  style: { cursor: 'pointer', pointerEvents: 'all' as const },
                  onClick: (ev: React.MouseEvent) => {
                    ev.stopPropagation();
                    onRemoveDrawing?.(d.id);
                  },
                }
                : {};

              if (d.type === 'vline') {
                const p1 = projectPoint(d.p1);
                if (!p1) return null;
                return <line key={d.id} {...eraserProps} x1={p1.x} y1={0} x2={p1.x} y2={height} stroke="#38bdf8" strokeDasharray="4 4" strokeWidth={1.8} />;
              }
              if (d.type === 'text') {
                const p1 = projectPoint(d.p1);
                if (!p1 || !d.text) return null;
                return (
                  <g key={d.id} {...eraserProps}>
                    <rect x={p1.x - 4} y={p1.y - 13} width={Math.max(48, d.text.length * 7 + 12)} height={19} rx={4} fill="rgba(15, 23, 42, 0.85)" stroke="#38bdf8" strokeWidth={1} />
                    <text x={p1.x + 2} y={p1.y} fill="#f8fafc" fontSize={11} fontWeight={600}>{d.text}</text>
                  </g>
                );
              }
              if (d.type === 'trendline' && d.p2) {
                const p1 = projectPoint(d.p1), p2 = projectPoint(d.p2);
                if (!p1 || !p2) return null;
                return (
                  <g key={d.id} {...eraserProps}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#f59e0b" strokeWidth={2} />
                    <circle cx={p1.x} cy={p1.y} r={3.5} fill="#f59e0b" />
                    <circle cx={p2.x} cy={p2.y} r={3.5} fill="#f59e0b" />
                  </g>
                );
              }
              if ((d.type === 'zone' || d.type === 'demand_zone' || d.type === 'supply_zone') && d.p2) {
                const p1 = projectPoint(d.p1), p2 = projectPoint(d.p2);
                if (!p1 || !p2) return null;
                const fill =
                  d.type === 'demand_zone'
                    ? 'rgba(34, 197, 94, 0.16)'
                    : d.type === 'supply_zone'
                      ? 'rgba(239, 68, 68, 0.16)'
                      : 'rgba(56, 189, 248, 0.16)';
                const stroke =
                  d.type === 'demand_zone' ? '#22c55e' : d.type === 'supply_zone' ? '#ef4444' : '#38bdf8';
                return (
                  <rect
                    key={d.id}
                    {...eraserProps}
                    x={Math.min(p1.x, p2.x)}
                    y={Math.min(p1.y, p2.y)}
                    width={Math.max(6, Math.abs(p2.x - p1.x))}
                    height={Math.max(4, Math.abs(p2.y - p1.y))}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1.3}
                  />
                );
              }
              if (d.type === 'fib' && d.p2) {
                const p1 = projectPoint(d.p1), p2 = projectPoint(d.p2);
                if (!p1 || !p2) return null;
                const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x + 60, p2.x);
                return (
                  <g key={d.id} {...eraserProps}>
                    {FIB_LEVELS.map((lvl) => {
                      const priceLvl = d.p1.price + (d.p2!.price - d.p1.price) * lvl;
                      const y = mainSeriesRef.current?.priceToCoordinate(priceLvl);
                      if (y == null) return null;
                      return (
                        <g key={lvl}>
                          <line x1={xMin} y1={y} x2={xMax} y2={y} stroke="#a855f7" strokeWidth={1} strokeDasharray="3 3" />
                          <text x={xMin + 4} y={y - 3} fill="#c084fc" fontSize={10}>{(lvl * 100).toFixed(1)}% ({priceLvl.toFixed(2)})</text>
                        </g>
                      );
                    })}
                  </g>
                );
              }
              if (d.type === 'measure' && d.p2) {
                const p1 = projectPoint(d.p1), p2 = projectPoint(d.p2);
                if (!p1 || !p2) return null;
                const delta = d.p2.price - d.p1.price;
                const pct = d.p1.price > 0 ? (delta / d.p1.price) * 100 : 0;
                return (
                  <g key={d.id} {...eraserProps}>
                    <rect x={Math.min(p1.x, p2.x)} y={Math.min(p1.y, p2.y)} width={Math.max(4, Math.abs(p2.x - p1.x))} height={Math.max(4, Math.abs(p2.y - p1.y))} fill={delta >= 0 ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)'} stroke={delta >= 0 ? '#10b981' : '#ef4444'} />
                    <text x={Math.min(p1.x, p2.x) + 6} y={Math.min(p1.y, p2.y) + 14} fill="#f8fafc" fontSize={11} fontWeight={700}>{delta >= 0 ? '+' : ''}{delta.toFixed(2)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</text>
                  </g>
                );
              }
              return null;
            })}
        </svg>
      </div>

      {/* Right-Click Context Menu */}
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '4px 10px', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>
            {symbol} @ {formatINR(ctxMenu.price)}
          </div>
          {!isIndex && (
            <>
              <button style={{ color: 'var(--gain)' }} onClick={() => { onTradeClick(symbol, 'BUY', segment, liveLtp, ctxMenu.price.toFixed(2), tradeProduct); setCtxMenu(null); }}>
                BUY Limit @ {formatINR(ctxMenu.price)}
              </button>
              <button style={{ color: 'var(--loss)' }} onClick={() => { onTradeClick(symbol, 'SELL', segment, liveLtp, ctxMenu.price.toFixed(2), tradeProduct); setCtxMenu(null); }}>
                SELL Limit @ {formatINR(ctxMenu.price)}
              </button>
            </>
          )}
          <button
            onClick={async () => {
              const cond = Number(liveLtp || 0) < ctxMenu.price ? 'PRICE_ABOVE' : 'PRICE_BELOW';
              await api.createAlert({ symbol, condition: cond, targetValue: ctxMenu.price, note: 'Created from Chart' }).catch(() => { });
              setTradeToast(`Price alert set on ${symbol} (${cond} ${formatINR(ctxMenu.price)}).`);
              setCtxMenu(null);
            }}
          >
            Add Price Alert @ {formatINR(ctxMenu.price)}
          </button>
          <button
            onClick={() => {
              onAddDrawing({ id: `drw-${Date.now()}`, type: 'hline', p1: { time: visibleBars[visibleBars.length - 1]?.time || 0, price: ctxMenu.price } });
              setCtxMenu(null);
            }}
          >
            Draw Horizontal Line @ {formatINR(ctxMenu.price)}
          </button>
        </div>
      )}

      {showRsi && (
        <div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 2 }}>RSI (14)</div>
          <div ref={rsiContainerRef} style={{ width: '100%', height: 100 }} />
        </div>
      )}
      {showMacd && (
        <div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 2 }}>MACD (12, 26, 9)</div>
          <div ref={macdContainerRef} style={{ width: '100%', height: 100 }} />
        </div>
      )}
      {extraOsc && (
        <div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 2 }}>{extraOsc} Oscillator</div>
          <div ref={extraOscContainerRef} style={{ width: '100%', height: 100 }} />
        </div>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span>BlockTrade Chart Engine · TradingView Lightweight Charts (Apache 2.0)</span>
        <span>Right-click for Limit / Alert • Drag order pills • Select pane to switch symbol or draw</span>
      </div>
    </div>
  );
}
