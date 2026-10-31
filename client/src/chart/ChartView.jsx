import { forwardRef, useEffect, useRef, useState, useImperativeHandle } from 'react';
import ChartCore from './ChartCore';
import { DRAW_TYPES } from './drawings';

/**
 * ChartView - React wrapper around our own canvas engine.
 *
 * Owns nothing that affects frame rate: all geometry lives in ChartCore, this
 * component only mounts the engine, forwards props, and mirrors the handful of
 * UI-facing signals (hover price, tool state, perf stats).
 */
const ChartView = forwardRef(function ChartView({
  symbol,
  timeframe,
  data,
  chartType = 'candle',
  indicators = {},
  drawings = [],
  markers = [],
  activeTool = null,
  magnet = true,
  livePrice = null,
  tickSize = 0.05,
  onNewDrawing,
  onDeleteDrawing,
  onToolDone,
  onContextMenu,
  onHoverPrice,
  onCapture,
  fitToken = 0,
  captureToken = 0,
  measureMode = false,
  zoomToken = 0,
  zoomDir = 1,
  showStats = false,
  logScale = false,
  compare = [],
  indicatorParams = {},
  showSR = false,
}, ref) {
  const hostRef = useRef(null);
  const coreRef = useRef(null);
  useImperativeHandle(ref, () => ({
    appendTick: (price, volume, ts, timeframe) => coreRef.current?.appendTick(price, volume, ts, timeframe),
    core: () => coreRef.current,
  }), []);
  const [stats, setStats] = useState({ frames: 0, lastFrameMs: 0, bars: 0, barSpacing: 0 });

  // Latest callbacks in a ref. The engine is created once (mount effect with an
  // empty dep list), so subscribing to props directly would capture the FIRST
  // render's closures - a drawing created later would be appended to a stale
  // array and silently dropped.
  const cbs = useRef({});
  cbs.current = {
    onNewDrawing, onDeleteDrawing, onToolDone, onContextMenu, onHoverPrice, onCapture,
  };

  // ── mount the engine once ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current) return;
    const core = new ChartCore(hostRef.current, { symbol, timeframe, tickSize });
    coreRef.current = core;

    const offNew = core.on('newDrawing', (d) => cbs.current.onNewDrawing?.(d));
    const offDel = core.on('deleteDrawing', (d) => cbs.current.onDeleteDrawing?.(d));
    const offTool = core.on('toolDone', () => cbs.current.onToolDone?.());
    const offCtx = core.on('contextmenu', (p) => cbs.current.onContextMenu?.(p));
    const offHover = core.on('hoverPrice', (p) => cbs.current.onHoverPrice?.(p));

    let raf;
    if (showStats) {
      const tick = () => { setStats(core.stats()); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      offNew(); offDel(); offTool(); offCtx(); offHover();
      core.destroy();
      coreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── data ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const core = coreRef.current;
    if (!core || !data?.length) return;
    core.setData(data);
  }, [data]);

  // live tick: mutate only the newest bar (no full re-render work)
  useEffect(() => {
    const core = coreRef.current;
    if (!core || livePrice == null || !data?.length) return;
    const lastBar = data[data.length - 1];
    core.appendOrUpdate({
      time: lastBar.time,
      open: lastBar.open,
      high: Math.max(lastBar.high, livePrice),
      low: Math.min(lastBar.low, livePrice),
      close: livePrice,
      volume: lastBar.volume,
    });
  }, [livePrice, data]);

  // ── config forwarding ─────────────────────────────────────────────────────
  useEffect(() => { coreRef.current?.setConfig({ indicators, chartType, tickSize, showSR }); }, [indicators, chartType, tickSize, showSR]);
  useEffect(() => { coreRef.current?.setDrawings(drawings); }, [drawings]);
  useEffect(() => { coreRef.current?.setMarkers(markers); }, [markers]);
  useEffect(() => { coreRef.current?.setSymbol(symbol); }, [symbol]);
  useEffect(() => { coreRef.current?.setTimeframe(timeframe); }, [timeframe]);
  useEffect(() => { coreRef.current?.setTool(activeTool); }, [activeTool]);
  useEffect(() => { coreRef.current?.setMagnet(magnet); }, [magnet]);
  // a parent-bumped token is a clean way to request fit-content
  useEffect(() => { if (fitToken) coreRef.current?.fitContent(); }, [fitToken]);

  // screenshot request (skip the value the view is mounting with)
  const captureRef = useRef(captureToken);
  useEffect(() => {
    if (captureToken === captureRef.current) return;
    captureRef.current = captureToken;
    cbs.current.onCapture?.(coreRef.current?.toDataURL?.());
  }, [captureToken]);

  useEffect(() => { coreRef.current?.setMeasureMode(measureMode); }, [measureMode]);

  const zoomRef = useRef(zoomToken);
  useEffect(() => {
    if (zoomToken === zoomRef.current) return;
    zoomRef.current = zoomToken;
    if (zoomDir > 0) coreRef.current?.zoomIn();
    else coreRef.current?.zoomOut();
  }, [zoomToken, zoomDir]);

  useEffect(() => { coreRef.current?.setLogScale(logScale); }, [logScale]);
  useEffect(() => { coreRef.current?.setIndicatorParams(indicatorParams); }, [indicatorParams]);
  useEffect(() => { coreRef.current?.setCompare(compare); }, [compare]);

  // Escape cancels a draft drawing
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') coreRef.current?.cancelDraft(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);


  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {showStats && (
        <div style={{
          position: 'absolute', right: 78, top: 6, zIndex: 5,
          fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b',
          background: 'rgba(19,23,34,0.75)', padding: '3px 8px', borderRadius: 4,
          display: 'flex', gap: 10, pointerEvents: 'none',
        }}>
          <span>{stats.lastFrameMs.toFixed(1)}ms/frame</span>
          <span>{stats.bars.toLocaleString('en-IN')} bars</span>
          <span>@{stats.barSpacing}px</span>
        </div>
      )}
    </div>
  );
});

export { DRAW_TYPES };
export default ChartView;
