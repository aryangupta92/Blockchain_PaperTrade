/**
 * chart/ChartCore.js
 * ---------------------------------------------------------------------------
 * The engine: canvas lifecycle, coordinate transforms, the single rAF render
 * loop, and pointer interaction.
 *
 * Performance rules it enforces:
 *   - TWO canvases: a scene canvas (bars, indicators, axes) and an overlay
 *     canvas (crosshair, drawings, tooltips). A hover repaints only the
 *     overlay, ~0.2ms, so the browser composites two surfaces instead of
 *     repainting everything.
 *   - ONE rAF loop with a dirty flag; work happens at most once per frame.
 *   - VISIBLE-ONLY rendering: renderers never walk the full series.
 *   - No per-frame allocation: the transform, gridlines and label strings are
 *     reused; only floats are written per frame.
 */

import { SeriesStore } from './seriesStore.js';
import {
  TimeScale, PriceScale, SPACING, COLORS,
} from './scales.js';
import {
  drawGrid, drawTimeAxis, drawCandles, drawHollowCandles, drawBars,
  drawLine, drawArea, drawVolume, drawOverlayLine, drawBollinger,
  drawVolumeProfile, drawLastPrice, drawTradeMarkers,
  drawWatermark, drawLegend, drawCrosshair,
  drawHeikinAshi, drawRenko, drawStochasticPane, drawSAR, drawIchimoku,
  drawOBV, drawMFI, drawADX, drawWilliamsR, drawCCI,
  drawSRZones, drawSRPriceLabels,
} from './renderers.js';
import { drawRSIPane, drawMACDPane } from './panes.js';
import { computeSR } from './supportResistance.js';
import { drawDrawings, hitTestDrawing, newDrawing, DRAW_TYPES } from './drawings.js';
import {
  ema, rsi as rsiCalc, macd as macdCalc, bollinger as bbCalc,
  supertrend as stCalc, sessionVwap, volumeProfile,
  stochastic, parabolicSAR, ichimokuCloud, heikinAshi, renko,
  obv, moneyFlowIndex, williamsR, cci, adx,
} from './indicators.js';

const PANE_HEIGHT = 78;      // sub-pane height
const PRICE_SCALE_W = 72;
const TIME_AXIS_H = 24;
const VOLUME_PANE_H = 60;    // dedicated volume sub-pane height

export class ChartCore {
  /**
   * @param {HTMLElement} host  container element (position:relative)
   */
  constructor(host, options = {}) {
    this.host = host;
    this.opts = {
      tickSize: 0.05,
      symbol: '',
      timeframe: '5m',
      ...options,
    };

    // ── canvases ────────────────────────────────────────────────────────────
    this.scene = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    for (const c of [this.scene, this.overlay]) {
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.display = 'block';
    }
    this.scene.style.zIndex = '1';
    this.overlay.style.zIndex = '2';
    host.appendChild(this.scene);
    host.appendChild(this.overlay);
    this.sctx = this.scene.getContext('2d');
    this.octx = this.overlay.getContext('2d');

    // ── data ───────────────────────────────────────────────────────────────
    this.store = new SeriesStore();
    this.timeScale = null;
    this.priceScale = new PriceScale();
    if (this.opts.logScale) this.priceScale.setLog(true);
    this.maxVolume = 1;

    // ── viewport state ─────────────────────────────────────────────────────
    this.width = 0;
    this.height = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR: 3x costs 2.25x pixels
    this.barSpacing = SPACING.DEFAULT;
    this.rightIndex = null;   // null = follow the newest bar
    this.plotTop = 0;

    // ── interaction state ──────────────────────────────────────────────────
    this.pointer = { x: null, y: null, down: false, lastX: 0, lastY: 0 };
    this.hoverIndex = null;
    this.hoverDrawingId = null;
    this.draft = [];
    this.activeTool = null;
    this.measureMode = false;
    this.measure = null;
    this.drawings = [];
    this.markers = [];
    this.listeners = {};

    // ── loop bookkeeping ───────────────────────────────────────────────────
    this.dirty = true;
    this.rafId = null;
    this.lastFrameMs = 0;
    this.frameMs = 0;
    this.frames = 0;
    this.dataVersion = 0; // bumped on every data change, invalidates derived caches

    // ── indicator config ───────────────────────────────────────────────────
    this.indicators = {
      ema9: false, ema20: true, ema50: false, ema200: false,
      vwap: true, bb: false, supertrend: false, rsi: true, macd: true,
      volumeProfile: false,
      stochastic: false, sar: false, ichimoku: false,
      obv: false, mfi: false, williamsR: false, cci: false, adx: false,
    };
    this.indicatorParams = {};
    this.showSR = false;   // support/resistance auto-detection toggle
    this.srLevels = [];    // clustered pivot levels
    this.srZones = [];     // paired zone objects for rendering
    this.chartType = 'candle'; // candle | hollow | line | area | bars | heikin | renko
    this.compare = []; // {time, value}[] normalized overlay series

    // cached derived arrays (recomputed only when the visible range changes)
    this._cacheKey = '';
    this._cache = {};

    this._bindEvents();
    this.resize();
    this._start();
  }

  // ── public API ────────────────────────────────────────────────────────────
  on(event, cb) {
    (this.listeners[event] = this.listeners[event] || []).push(cb);
    return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== cb); };
  }
  _emit(event, payload) { (this.listeners[event] || []).forEach((cb) => { try { cb(payload); } catch (e) { console.error(e); } }); }

  setData(bars) {
    this.store.load(bars);
    this.dataVersion++;
    this.timeScale = new TimeScale(Array.from(this.store.time.subarray(0, this.store.len)));
    if (this.rightIndex == null) this.rightIndex = this.store.len - 1;
    this.autoscale();
    if (this.showSR) this.recomputeSR();
    this.invalidate();
  }

  appendOrUpdate(bar) {
    const grew = this.store.len === 0 || this.store.time[this.store.len - 1] < bar.time;
    this.store.push(bar, true);
    this.dataVersion++;
    if (grew) {
      this.timeScale = new TimeScale(Array.from(this.store.time.subarray(0, this.store.len)));
    }
    if (this.rightIndex == null) this.rightIndex = this.store.len - 1;
    this.autoscale();
    this.invalidate();
  }

  setConfig(patch) {
    Object.assign(this.indicators, patch.indicators || {});
    if (patch.chartType) this.chartType = patch.chartType;
    if (patch.drawings) this.drawings = patch.drawings;
    if (patch.markers) this.markers = patch.markers;
    if (patch.tickSize != null) this.opts.tickSize = patch.tickSize;
    if (patch.showSR != null) this.setShowSR(patch.showSR);
    this.invalidate();
  }

  setDrawings(list) { this.drawings = list || []; this.invalidate(); }
  setMarkers(list) { this.markers = list || []; this.invalidate(); }
  setMagnet(on) { this.magnet = Boolean(on); }
  setMeasureMode(on) {
    this.measureMode = Boolean(on);
    this.measure = null;
    if (this.measureMode) { this.activeTool = null; this.draft = []; }
    this.overlay.style.cursor = (this.measureMode || this.activeTool) ? 'crosshair' : 'default';
    this.invalidate();
  }
  setTool(tool) {
    this.activeTool = tool || null;
    this.draft = [];
    this.overlay.style.cursor = tool ? 'crosshair' : 'default';
    this.invalidate();
  }
  setTimeframe(tf) { this.opts.timeframe = tf; this.invalidate(); }
  setSymbol(sym) { this.opts.symbol = sym; this.invalidate(); }

  setShowSR(on) {
    this.showSR = Boolean(on);
    if (this.showSR) this.recomputeSR();
    else { this.srLevels = []; this.srZones = []; }
    this.invalidate();
  }

  recomputeSR() {
    const candles = [];
    for (let i = 0; i < this.store.len; i++) {
      candles.push({
        time: this.store.time[i], open: this.store.open[i], high: this.store.high[i],
        low: this.store.low[i], close: this.store.close[i], volume: this.store.volume[i],
      });
    }
    const { levels, zones } = computeSR(candles, 10);
    this.srLevels = levels;
    this.srZones = zones;
    this._emit('srComputed', { levels, zones });
  }

  legendIndicatorEntries() {
    const defs = [
      ['ema9', 'EMA 9', COLORS.ema9],
      ['ema20', 'EMA 20', COLORS.ema20],
      ['ema50', 'EMA 50', COLORS.ema50],
      ['ema200', 'EMA 200', COLORS.ema200],
      ['vwap', 'VWAP', COLORS.vwap],
      ['bb', 'BB', '#94a3b8'],
      ['supertrend', 'Supertrend', COLORS.supertrendUp],
    ];
    const out = [];
    for (const [id, label, color] of defs) {
      if (!this.indicators[id]) continue;
      const series = this._derived()[id];
      if (!series || !series.length) continue;
      const idx = (this.hoverIndex != null && this.hoverIndex >= 0 && this.hoverIndex < series.length) ? this.hoverIndex : series.length - 1;
      const v = series[idx];
      if (v == null) continue;
      out.push({ id, label, color, value: v });
    }
    return out;
  }

  appendTick(price, volume = 0, ts, timeframe) {
    const tf = timeframe || this.opts.timeframe;
    const wasAtEnd = (this.rightIndex == null) || (this.rightIndex >= this.store.len - 1);
    const grew = this.store.appendTick(price, volume, ts, tf);
    this.dataVersion++;
    if (grew) {
      this.timeScale = new TimeScale(Array.from(this.store.time.subarray(0, this.store.len)));
      if (wasAtEnd) this.rightIndex = this.store.len - 1;
    }
    this.autoscale();
    if (this.showSR) this.recomputeSR();
    this.invalidate();
    return grew;
  }

  setLogScale(on) {
    this.priceScale.setLog(Boolean(on));
    this.opts.logScale = Boolean(on);
    this.invalidate();
  }

  setIndicatorParams(params) {
    this.indicatorParams = { ...this.indicatorParams, ...params };
    this.invalidate();
  }

  setCompare(series) {
    this.compare = (series || []).map((p) => ({ time: Number(p.time), value: Number(p.value) })).filter((p) => Number.isFinite(p.value));
    this.invalidate();
  }

  zoomIn() {
    this.barSpacing = Math.min(SPACING.MAX, this.barSpacing * 1.2);
    this.autoscale();
    this.invalidate();
  }

  zoomOut() {
    this.barSpacing = Math.max(SPACING.MIN, this.barSpacing / 1.2);
    this.autoscale();
    this.invalidate();
  }

  fitContent() {
    if (!this.store.len) return;
    const plotW = this.width - PRICE_SCALE_W;
    const n = Math.min(this.store.len, Math.floor(plotW / SPACING.DEFAULT));
    this.barSpacing = SPACING.DEFAULT;
    this.rightIndex = this.store.len - 1;
    void n;
    this.autoscale();
    this.invalidate();
  }

  /** Composite scene + overlay into a PNG data URL (chart screenshot). */
  toDataURL() {
    if (!this.scene || !this.width || !this.height) return null;
    const out = document.createElement('canvas');
    out.width = this.scene.width;
    out.height = this.scene.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.scene, 0, 0, out.width, out.height);
    ctx.drawImage(this.overlay, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  autoscale() {
    const range = this.visibleRange();
    if (!range) return;
    const ext = this.store.priceExtent(range.from, range.to - range.from);
    if (!ext) return;
    // include overlay lines in the extent so EMA/BB never clip out of view
    const lo = this._overlayExtent(ext.min);
    const hi = this._overlayExtent(ext.max);
    this.priceScale.autoscale(
      Math.min(ext.min, lo.min),
      Math.max(ext.max, hi.max),
      this.opts.tickSize,
      0.08,
      this.plotHeight()
    );
    this.maxVolume = this.store.maxVolume(range.from, range.to - range.from) || 1;
  }

  _overlayExtent(v) {
    const c = this._derived();
    let min = v, max = v;
    const consider = (arr) => {
      if (!arr?.length) return;
      for (const p of arr) {
        if (p.time < this._viewFrom || p.time > this._viewTo) continue;
        const val = p.value != null ? p.value : p.mean;
        if (val == null) continue;
        if (val < min) min = val;
        if (val > max) max = val;
      }
    };
    if (this.indicators.bb) { consider(c.bb.upper); consider(c.bb.lower); }
    if (this.indicators.ema20) consider(c.ema20);
    if (this.indicators.ema50) consider(c.ema50);
    if (this.indicators.ema200) consider(c.ema200);
    if (this.indicators.ema9) consider(c.ema9);
    if (this.indicators.vwap) consider(c.vwap);
    if (this.indicators.supertrend) consider(c.supertrend);
    if (this.indicators.ichimoku) {
      consider(c.ichimoku.tenkan); consider(c.ichimoku.kijun);
      consider(c.ichimoku.senkouA); consider(c.ichimoku.senkouB);
    }
    if (this.indicators.sar) {
      for (const p of c.sar) {
        if (p.time < this._viewFrom || p.time > this._viewTo) continue;
        if (p.value < min) min = p.value;
        if (p.value > max) max = p.value;
      }
    }
    return { min, max };
  }

  plotHeight() {
    let h = this.height - TIME_AXIS_H;
    if (this.indicators.volume) h -= VOLUME_PANE_H;
    if (this.indicators.rsi) h -= PANE_HEIGHT;
    if (this.indicators.macd) h -= PANE_HEIGHT;
    if (this.indicators.stochastic) h -= PANE_HEIGHT;
    if (this.indicators.obv) h -= PANE_HEIGHT;
    if (this.indicators.mfi) h -= PANE_HEIGHT;
    if (this.indicators.williamsR) h -= PANE_HEIGHT;
    if (this.indicators.cci) h -= PANE_HEIGHT;
    if (this.indicators.adx) h -= PANE_HEIGHT;
    return Math.max(80, h);
  }

  // ── coordinate transforms ────────────────────────────────────────────────
  get view() {
    const plotW = this.width - PRICE_SCALE_W;
    const plotH = this.plotHeight();
    const rightOffset = 0;
    const refIndex = this.rightIndex == null ? this.store.len - 1 : this.rightIndex;
    return {
      width: this.width,
      height: this.height,
      priceScaleWidth: PRICE_SCALE_W,
      plotWidth: plotW,
      timeAxisHeight: TIME_AXIS_H,
      plotTop: 0,
      plotHeight: plotH,
      barSpacing: this.barSpacing,
      rightIndex: Math.max(0, refIndex),
      priceScale: this.priceScale,
      intraday: ['1m', '3m', '5m', '15m', '30m', '1h', '4h'].includes(this.opts.timeframe),
      maxVolume: this.maxVolume,
      xOf: (i) => this._xOf(i, plotW, rightOffset),
    };
  }

  _xOf(i, plotW, rightOffset) {
    if (!this.timeScale) return plotW - rightOffset;
    const refIdx = this.rightIndex == null ? this.store.len - 1 : this.rightIndex;
    const refSlot = this.timeScale.slots[Math.max(0, Math.min(this.timeScale.slots.length - 1, refIdx))] ?? 0;
    return plotW - rightOffset - (refSlot - this.timeScale.slots[i]) * this.barSpacing;
  }

  visibleRange() {
    if (!this.store.len) return null;
    const plotW = this.width - PRICE_SCALE_W;
    const maxVisible = Math.floor(plotW / this.barSpacing) + 2;
    let right = this.rightIndex == null ? this.store.len - 1 : this.rightIndex;
    right = Math.max(0, Math.min(this.store.len - 1, right));
    const count = Math.min(this.store.len, maxVisible);
    const from = Math.max(0, right - count + 1);
    const to = Math.min(this.store.len, from + count);
    this._viewFrom = from; this._viewTo = to;
    return { from, to };
  }

  // ── derived indicator arrays (cached per visible range) ───────────────────
  _derived() {
    const key = `${this._viewFrom}:${this._viewTo}:${this.store.len}:${this.dataVersion}:${Object.values(this.indicators).map(Number).join('')}:${JSON.stringify(this.indicatorParams)}`;
    if (this._cacheKey === key) return this._cache;
    const s = this.store;
    const n = s.len;
    const closes = Array.from(s.close.subarray(0, n));
    const highs = Array.from(s.high.subarray(0, n));
    const lows = Array.from(s.low.subarray(0, n));
    const cache = {};
    const p = (id, def) => ({ ...(def || {}), ...(this.indicatorParams[id] || {}) });
    cache.ema9 = this.indicators.ema9 ? ema(closes, p('ema9', { period: 9 }).period) : [];
    cache.ema20 = this.indicators.ema20 ? ema(closes, p('ema20', { period: 20 }).period) : [];
    cache.ema50 = this.indicators.ema50 ? ema(closes, p('ema50', { period: 50 }).period) : [];
    cache.ema200 = this.indicators.ema200 ? ema(closes, p('ema200', { period: 200 }).period) : [];
    cache.bb = this.indicators.bb ? bbCalc(closes, p('bb', { period: 20, mult: 2 }).period, p('bb', { period: 20, mult: 2 }).mult) : [];
    cache.rsi = this.indicators.rsi ? rsiCalc(closes, p('rsi', { period: 14 }).period) : [];
    cache.macd = this.indicators.macd ? macdCalc(closes, p('macd', { fast: 12, slow: 26, signal: 9 }).fast, p('macd', { fast: 12, slow: 26, signal: 9 }).slow, p('macd', { fast: 12, slow: 26, signal: 9 }).signal) : { line: [], signal: [], hist: [] };
    cache.vwap = this.indicators.vwap ? sessionVwap(s, this._viewFrom, this._viewTo - this._viewFrom, (t) => {
      const d = new Date((t * 1000) + 5.5 * 3600 * 1000);
      return d.getUTCFullYear() * 10000 + d.getUTCMonth() * 100 + d.getUTCDate();
    }) : [];
    cache.supertrend = this.indicators.supertrend ? stCalc(highs, lows, closes, p('supertrend', { period: 10, mult: 3 }).period, p('supertrend', { period: 10, mult: 3 }).mult) : [];
    cache.stochastic = this.indicators.stochastic ? stochastic(highs, lows, closes, p('stochastic', { k: 14, d: 3 }).k, p('stochastic', { k: 14, d: 3 }).d) : { k: [], d: [] };
    cache.sar = this.indicators.sar ? parabolicSAR(highs, lows, closes, 0.02, 0.2) : [];
    cache.ichimoku = this.indicators.ichimoku ? ichimokuCloud(highs, lows, closes) : { tenkan: [], kijun: [], senkouA: [], senkouB: [], chikun: [] };
    cache.obv = this.indicators.obv ? obv(closes, Array.from(s.volume.subarray(0, n))) : [];
    cache.mfi = this.indicators.mfi ? moneyFlowIndex(highs, lows, closes, Array.from(s.volume.subarray(0, n)), p('mfi', { period: 14 }).period) : [];
    cache.williamsR = this.indicators.williamsR ? williamsR(highs, lows, closes, p('williamsR', { period: 14 }).period) : [];
    cache.cci = this.indicators.cci ? cci(highs, lows, closes, p('cci', { period: 20 }).period) : [];
    cache.adx = this.indicators.adx ? adx(highs, lows, closes, p('adx', { period: 14 }).period) : { adx: [], plusDI: [], minusDI: [] };

    if (this.chartType === 'heikin') {
      const haData = heikinAshi({ len: n, open: s.open, high: s.high, low: s.low, close: s.close });
      cache.ha = { open: haData.open, high: haData.high, low: haData.low, close: haData.close };
    }
    if (this.chartType === 'renko') {
      const visibleBars = [];
      for (let i = Math.max(0, this._viewFrom); i < Math.min(n, this._viewTo); i++) {
        visibleBars.push({ time: s.time[i], open: s.open[i], high: s.high[i], low: s.low[i], close: s.close[i] });
      }
      const priceRange = visibleBars.length ? Math.max(...visibleBars.map(b => b.high)) - Math.min(...visibleBars.map(b => b.low)) : 0;
      const brickSize = priceRange > 0 ? Math.max(priceRange / 50, this.opts.tickSize) : this.opts.tickSize;
      cache.renko = renko(visibleBars, brickSize);
    }

    const vp = this.indicators.volumeProfile ? volumeProfile(s, this._viewFrom, this._viewTo - this._viewFrom) : null;
    if (vp) {
      // attach bucket array so the renderer can draw it
      const rows = vp.rows; const step = vp.step; const mn = vp.min;
      const buckets = new Float64Array(rows);
      for (let i = this._viewFrom; i < this._viewTo; i++) {
        const b0 = Math.max(0, Math.min(rows - 1, Math.floor((s.low[i] - mn) / step)));
        const b1 = Math.max(0, Math.min(rows - 1, Math.floor((s.high[i] - mn) / step)));
        const v = s.volume[i] || 0;
        if (b1 === b0) buckets[b0] += v; else { const per = v / (b1 - b0 + 1); for (let b = b0; b <= b1; b++) buckets[b] += per; }
      }
      vp._buckets = buckets;
    }
    cache.vp = vp;
    this._cacheKey = key;
    this._cache = cache;
    return cache;
  }

  invalidate() { this.dirty = true; }

  // ── sizing ───────────────────────────────────────────────────────────────
  resize() {
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width));
    const h = Math.max(120, Math.floor(rect.height));
    if (w === this.width && h === this.height && this.scene.width) return;
    this.width = w; this.height = h;
    for (const c of [this.scene, this.overlay]) {
      c.width = Math.floor(w * this.dpr);
      c.height = Math.floor(h * this.dpr);
    }
    this.sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.autoscale();
    this.invalidate();
  }

  // ── render loop ──────────────────────────────────────────────────────────
  _start() {
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      const t0 = performance.now();
      if (!this.dirty) { this.frameMs = 0; return; }
      this.dirty = false;
      this._render();
      this.frameMs = performance.now() - t0;
      this.frames++;
    };
    this.rafId = requestAnimationFrame(loop);
  }

  _render() {
    const ctx = this.sctx;
    const view = this.view;
    const range = this.visibleRange();
    // the overlay holds drawings + crosshair only; it must be cleared every
    // frame or traces smear across the chart
    this.octx.clearRect(0, 0, this.width, this.height);
    if (!range || !this.store.len) {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, this.width, this.height);
      this._renderOverlay();
      return;
    }

    drawGrid(ctx, view, this.timeScale);
    if (this.showSR && this.srZones?.length) drawSRZones(ctx, view, this.priceScale, this.srZones);
    if (this.indicators.volumeProfile) drawVolumeProfile(ctx, view, this._derived().vp);
    const volumeTop = view.plotHeight + 8;
    const volumeH = this.indicators.volume ? VOLUME_PANE_H : 0;
    if (this.indicators.volume) drawVolume(ctx, view, this.store, volumeTop, volumeH);

    const c = this._derived();
    if (this.indicators.bb) drawBollinger(ctx, view, c.bb);
    if (this.indicators.vwap) drawOverlayLine(ctx, view, c.vwap, COLORS.vwap, 1.5, []);
    if (this.indicators.ema9) drawOverlayLine(ctx, view, c.ema9, COLORS.ema9);
    if (this.indicators.ema20) drawOverlayLine(ctx, view, c.ema20, COLORS.ema20);
    if (this.indicators.ema50) drawOverlayLine(ctx, view, c.ema50, COLORS.ema50);
    if (this.indicators.ema200) drawOverlayLine(ctx, view, c.ema200, COLORS.ema200);
    if (this.indicators.supertrend) {
      const up = [], down = [];
      for (const p of c.supertrend) (p.direction === 1 ? up : down).push(p);
      drawOverlayLine(ctx, view, up, COLORS.supertrendUp, 1.6);
      drawOverlayLine(ctx, view, down, COLORS.supertrendDown, 1.6);
    }
    if (this.indicators.sar) drawSAR(ctx, view, c.sar);
    if (this.indicators.ichimoku) drawIchimoku(ctx, view, c.ichimoku);

    switch (this.chartType) {
      case 'line': drawLine(ctx, view, this.store, COLORS.accent, 2); break;
      case 'area': drawArea(ctx, view, this.store, '#6366f1'); break;
      case 'bars': drawBars(ctx, view, this.store); break;
      case 'hollow': drawHollowCandles(ctx, view, this.store); break;
      case 'heikin': drawHeikinAshi(ctx, view, { open: c.ha?.open || [], high: c.ha?.high || [], low: c.ha?.low || [], close: c.ha?.close || [] }); break;
      case 'renko': drawRenko(ctx, view, c.renko || []); break;
      default: drawCandles(ctx, view, this.store);
    }

    const last = this.store.last();
    if (last) {
      drawLastPrice(ctx, view, last.close, this.opts.tickSize, this._prevClose());
      drawLegend(ctx, view, this.store, this.hoverIndex, this.opts.symbol, this.opts.timeframe, this.legendIndicatorEntries());
    }
    if (this.showSR && this.srLevels?.length) drawSRPriceLabels(ctx, view, this.priceScale, this.srLevels);
    drawTradeMarkers(ctx, view, this.markers, this.store);
    drawWatermark(ctx, view, `${this.opts.symbol || ''} ${this.opts.timeframe || ''}`);

    // sub-panes (after the dedicated volume zone when volume is on)
    const volH = this.indicators.volume ? VOLUME_PANE_H : 0;
    let paneTop = view.plotHeight + 8 + (volH ? volH + 8 : 0);
    if (this.indicators.rsi) { drawRSIPane(ctx, view, c.rsi, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.macd) { drawMACDPane(ctx, view, c.macd, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.stochastic) { drawStochasticPane(ctx, view, c.stochastic, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.obv) { drawOBV(ctx, view, c.obv, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.mfi) { drawMFI(ctx, view, c.mfi, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.williamsR) { drawWilliamsR(ctx, view, c.williamsR, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.cci) { drawCCI(ctx, view, c.cci, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }
    if (this.indicators.adx) { drawADX(ctx, view, c.adx, paneTop, PANE_HEIGHT); paneTop += PANE_HEIGHT + 6; }

    // time axis sits below the last sub-pane (or below the main plot)
    drawTimeAxis(ctx, view, this.store, this.timeScale, paneTop);

    // drawings + crosshair live on the overlay canvas
    drawDrawings(this.octx, view, this.store, this.drawings, this.hoverDrawingId, this.activeTool, this.draft);
    if (this.pointer.x != null && this.pointer.y != null && !this.activeTool) {
      drawCrosshair(this.octx, view, this.pointer.x, this.pointer.y, this.timeScale, this.store, this.opts.tickSize);
    }
    this._drawMeasure(this.octx);
  }

  _renderOverlay() {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.width, this.height);
    const view = this.view;
    drawDrawings(ctx, view, this.store, this.drawings, this.hoverDrawingId, this.activeTool, this.draft);
    if (this.pointer.x != null && this.pointer.y != null && this.store.len && !this.activeTool) {
      drawCrosshair(ctx, view, this.pointer.x, this.pointer.y, this.timeScale, this.store, this.opts.tickSize);
    }
    if (this.compare.length && this.store.len) {
      drawOverlayLine(ctx, view, this.compare, '#a855f7', 1.4, [6, 4]);
    }
    this._drawMeasure(ctx);
  }

  _drawMeasure(ctx) {
    const m = this.measure;
    if (!m || !this.store.len) return;
    const plotH = this.plotHeight();
    const x0 = Math.round(m.x0), y0 = Math.round(m.y0);
    const x1 = Math.round(m.x1), y1 = Math.round(m.y1);
    const p0 = this.priceScale.price(y0, 0, plotH);
    const p1 = this.priceScale.price(y1, 0, plotH);
    const diff = p1 - p0;
    const pct = p0 ? (diff / p0) * 100 : 0;
    const up = diff >= 0;
    const color = up ? COLORS.up : COLORS.down;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    let bars = 0;
    if (this.timeScale && this.store.len) {
      const plotW = this.width - PRICE_SCALE_W;
      const i0 = this.timeScale.indexAtX(x0, this.barSpacing, this.view.rightIndex, plotW, 0);
      const i1 = this.timeScale.indexAtX(x1, this.barSpacing, this.view.rightIndex, plotW, 0);
      bars = Math.abs(i1 - i0);
    }
    const label = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) · ${bars} bars`;
    ctx.font = '600 11px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2 - 12;
    ctx.fillStyle = 'rgba(19,23,34,0.92)';
    ctx.fillRect(mx - tw / 2 - 6, my - 9, tw + 12, 18);
    ctx.strokeStyle = 'rgba(42,46,57,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - tw / 2 - 6, my - 9, tw + 12, 18);
    ctx.fillStyle = color;
    ctx.fillText(label, mx, my);
    ctx.restore();
  }

  _prevClose() {
    if (this._prevCloseCache != null) return this._prevCloseCache;
    // nearest earlier session's last close
    if (!this.store.len) return null;
    const dayOf = (t) => { const d = new Date((t * 1000) + 5.5 * 3600 * 1000); return d.getUTCFullYear() * 10000 + d.getUTCMonth() * 100 + d.getUTCDate(); };
    const d0 = dayOf(this.store.time[this.store.len - 1]);
    for (let i = this.store.len - 2; i >= 0; i--) {
      if (dayOf(this.store.time[i]) !== d0) { this._prevCloseCache = this.store.close[i]; return this._prevCloseCache; }
    }
    this._prevCloseCache = null;
    return null;
  }

  // ── events ────────────────────────────────────────────────────────────────
  _bindEvents() {
    const el = this.overlay; // all pointer input lands on the top canvas
    el.addEventListener('mousemove', (e) => this._onMove(e));
    el.addEventListener('mouseleave', () => { this.pointer.x = null; this.pointer.y = null; this.hoverDrawingId = null; this.invalidate(); });
    el.addEventListener('mousedown', (e) => this._onDown(e));
    window.addEventListener('mouseup', (e) => this._onUp(e));
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => this._onDouble(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.host);
  }

  _localPoint(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onMove(e) {
    const { x, y } = this._localPoint(e);
    this.pointer.x = x; this.pointer.y = y;
    if (this.measureMode && this.measure) {
      if (this.pointer.down) { this.measure.x1 = x; this.measure.y1 = y; }
      this.overlay.style.cursor = 'crosshair';
      this.invalidate();
      return;
    }
    // pan by dragging
    if (this.pointer.down && this._dragStart && !this.activeTool) {
      const dx = x - this._dragStart.x;
      const bars = Math.round(dx / this.barSpacing);
      const next = Math.max(0, Math.min(this.store.len - 1, this._dragStart.rightIndex - bars));
      this.rightIndex = next;
      this.invalidate();
      return;
    }
    const view = this.view;
    if (this.store.len) {
      this.hoverIndex = this.timeScale ? this.timeScale.indexAtX(x, this.barSpacing, view.rightIndex, view.width - PRICE_SCALE_W, 0) : null;
    }
    // hover highlight for drawings (only when not placing one)
    if (!this.activeTool && !this.measureMode) {
      const hit = hitTestDrawing(view, this.store, this.drawings, x, y, 9);
      this.hoverDrawingId = hit ? hit.id : null;
      this.overlay.style.cursor = hit ? 'pointer' : 'grab';
    }
    this.invalidate();
  }

  _onDown(e) {
    const { x, y } = this._localPoint(e);
    this.pointer.down = true;
    this.pointer.lastX = x;
    this.pointer.lastY = y;
    if (!this.measureMode && !this.activeTool) this.overlay.style.cursor = 'grabbing';

    if (e.button === 2) { this._emit('contextmenu', { x: e.clientX, y: e.clientY, price: this._priceAt(y) }); return; }
    if (this.measureMode) {
      if (e.button === 0) this.measure = { x0: x, y0: y, x1: x, y1: y };
      this.invalidate();
      return;
    }
    if (this.activeTool) { this._placePoint(x, y); return; }
    this._dragStart = { x, rightIndex: this.rightIndex == null ? this.store.len - 1 : this.rightIndex };
  }

  _onUp() {
    if (this.measureMode && this.measure) {
      this.measure.x1 = this.pointer.x ?? this.measure.x1;
      this.measure.y1 = this.pointer.y ?? this.measure.y1;
      this.invalidate();
    }
    this.pointer.down = false;
    this._dragStart = null;
    if (!this.measureMode && !this.activeTool) this.overlay.style.cursor = 'grab';
  }

  _onWheel(e) {
    e.preventDefault();
    const { x } = this._localPoint(e);
    const plotW = this.width - PRICE_SCALE_W;
    const view = this.view;
    const idxBefore = this.timeScale && this.store.len
      ? this.timeScale.indexAtX(x, this.barSpacing, view.rightIndex, plotW, 0)
      : null;
    const timeBefore = idxBefore != null ? this.store.time[Math.max(0, Math.min(this.store.len - 1, idxBefore))] : null;

    // wheel: up = zoom in (bigger bars), down = zoom out
    const factor = Math.pow(1.12, e.deltaY / 100);
    const next = Math.max(SPACING.MIN, Math.min(SPACING.MAX, this.barSpacing * factor));
    this.barSpacing = next;

    if (timeBefore != null && this.timeScale) {
      // Given x = plotW - (refSlot - targetSlot) * spacing, the reference slot
      // that keeps the cursor anchored after a spacing change is:
      //   refSlot = targetSlot + (plotW - x) / newSpacing
      const targetIdx = this.store.indexOfTime(timeBefore);
      if (targetIdx >= 0) {
        const targetSlot = this.timeScale.slots[targetIdx];
        const cursorSlotFrom = targetSlot + ((plotW - x) / this.barSpacing);
        // rightIndex whose slot equals cursorSlotFrom
        let lo = 0, hi = this.timeScale.slots.length - 1, ans = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (this.timeScale.slots[mid] <= cursorSlotFrom) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        this.rightIndex = ans;
      }
    }
    this.autoscale();
    this.invalidate();
  }

  _onDouble(e) {
    const { x, y } = this._localPoint(e);
    // double-click on a drawing deletes it (same affordance as the SVG version)
    const hit = hitTestDrawing(this.view, this.store, this.drawings, x, y, 10);
    if (hit) { this._emit('deleteDrawing', hit); return; }
    this.fitContent();
  }

  _priceAt(y) {
    return this.priceScale.price(y, 0, this.plotHeight());
  }

  /** Convert a pixel to a chart coordinate (used by the drawing tools). */
  pixelToData(x, y, magnet = true) {
    const view = this.view;
    if (!this.timeScale || !this.store.len) return null;
    const plotW = this.width - PRICE_SCALE_W;
    const idx = this.timeScale.indexAtX(x, this.barSpacing, view.rightIndex, plotW, 0);
    let price = this._priceAt(y);
    if (magnet && idx >= 0 && idx < this.store.len) {
      const cands = [this.store.open[idx], this.store.high[idx], this.store.low[idx], this.store.close[idx]];
      price = cands.reduce((a, b) => (Math.abs(b - price) < Math.abs(a - price) ? b : a));
    }
    return { time: this.store.time[idx], price: +price.toFixed(2), index: idx };
  }

  _placePoint(x, y) {
    const pt = this.pixelToData(x, y);
    if (!pt) return;

    if (this.activeTool === DRAW_TYPES.HORIZONTAL || this.activeTool === DRAW_TYPES.TEXT) {
      const d = newDrawing(this.activeTool, this.opts.symbol, [pt], this.activeTool === DRAW_TYPES.TEXT ? '' : '');
      if (this.activeTool === DRAW_TYPES.TEXT) {
        const text = window.prompt('Note text:', 'watch this level');
        if (text == null) { this._emit('toolDone', null); return; }
        d.text = text || 'note';
      }
      this._emit('newDrawing', d);
      this._emit('toolDone', null);
      return;
    }

    if (!this.draft.length) { this.draft = [pt]; this.invalidate(); return; }
    // second click completes a two-point shape
    const d = newDrawing(this.activeTool, this.opts.symbol, [this.draft[0], pt], '');
    this._emit('newDrawing', d);
    this._emit('toolDone', null);
    this.draft = [];
    this.invalidate();
  }

  /** Cancel an in-progress drawing (Escape). */
  cancelDraft() { this.draft = []; this.setTool(null); }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this._ro) this._ro.disconnect();
    this.scene.remove();
    this.overlay.remove();
  }

  stats() {
    return { frames: this.frames, lastFrameMs: +this.frameMs.toFixed(2), bars: this.store.len, barSpacing: +this.barSpacing.toFixed(2) };
  }
}

export default ChartCore;
