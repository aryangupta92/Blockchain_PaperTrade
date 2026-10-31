/**
 * chart/renderers.js
 * ---------------------------------------------------------------------------
 * Immediate-mode canvas renderers. Every renderer:
 *   - reads only the visible slice (never the whole series)
 *   - decimates to at most one shape per pixel column
 *   - holds zero state between frames
 *
 * Two call signatures exist deliberately:
 *   drawX(ctx, geom, store, view)   - price-space renderers
 *   drawLinePts(...)                - index-space overlays
 */

import { COLORS, defaultPriceFormatter, formatVolume, istDayKey, formatISTTime, formatISTDateTime } from './scales.js';

const { PI } = Math;

// ── helpers ──────────────────────────────────────────────────────────────────

function visibleRange(store, view) {
  const count = store.len;
  if (!count) return null;
  const barSpacing = view.barSpacing;
  const plotWidth = view.width - view.priceScaleWidth;
  const maxVisible = Math.floor(plotWidth / barSpacing) + 2;
  let rightIndex = view.rightIndex;
  if (rightIndex == null || rightIndex < 0 || rightIndex > count - 1) rightIndex = count - 1;
  const visibleCount = Math.min(count, maxVisible);
  const from = Math.max(0, rightIndex - visibleCount + 1);
  return { from, to: Math.min(count, from + visibleCount), visibleCount };
}

/** Grid + axes. Painted first; everything else draws on top. */
export function drawGrid(ctx, view, timeScale) {
  const { width, height, priceScaleWidth, plotWidth, plotTop, plotHeight } = view;
  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // horizontal price gridlines at "nice" steps
  const ps = view.priceScale;
  const logMode = ps && ps.log;
  if (ps && (logMode || ps.step)) {
    ctx.lineWidth = 1;
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const ticks = logMode
      ? (() => {
          const out = [];
          const lo = Math.floor(Math.log10(Math.max(ps.min, 1e-9)));
          const hi = Math.ceil(Math.log10(ps.max));
          for (let e = lo; e <= hi; e++) {
            const base = Math.pow(10, e);
            for (const m of [1, 2, 5]) {
              const v = base * m;
              if (v >= ps.min && v <= ps.max) out.push(v);
            }
          }
          return out;
        })()
      : (() => {
          const out = [];
          const first = Math.ceil(ps.min / ps.step) * ps.step;
          for (let p = first; p <= ps.max; p += ps.step) out.push(p);
          return out;
        })();
    for (const p of ticks) {
      const y = Math.round(ps.y(p, plotTop, plotHeight)) + 0.5;
      if (y < plotTop - 1 || y > plotTop + plotHeight + 1) continue;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();

      // price label on the right scale
      const label = defaultPriceFormatter(p, ps.tickSize);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(plotWidth + 1, y - 9, view.priceScaleWidth - 2, 18);
      ctx.fillStyle = COLORS.textMuted;
      ctx.fillText(label, plotWidth + 6, y);
    }
  }

  // vertical session gridlines
  if (timeScale && timeScale.sessionStarts) {
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (const si of timeScale.sessionStarts) {
      const x = Math.round(view.xOf(si)) + 0.5;
      if (x < 0 || x > plotWidth) continue;
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
    }
    ctx.stroke();
  }

  // last price marker on the price scale
  ctx.restore();
}

/** Time axis: bottom strip with IST labels and day separators. */
export function drawTimeAxis(ctx, view, store, timeScale, top) {
  const { width, plotWidth, plotHeight, timeAxisHeight } = view;
  const axisTop = top != null ? top : (plotHeight + 4);
  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, axisTop, plotWidth, timeAxisHeight);

  if (!timeScale || !store.len) { ctx.restore(); return; }

  ctx.font = '11px JetBrains Mono, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const intraday = view.intraday;
  const minLabelGap = 64;
  let lastLabelX = -Infinity;

  // session starts -> day labels
  for (const si of timeScale.sessionStarts) {
    const x = view.xOf(si);
    if (x < 0 || x > plotWidth) continue;
    ctx.strokeStyle = COLORS.gridBold;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, plotHeight);
    ctx.stroke();

    if (x - lastLabelX > minLabelGap) {
      ctx.fillStyle = COLORS.textMuted;
      ctx.fillText(formatISTTime(store.time[si], intraday), Math.max(24, Math.min(plotWidth - 24, x)), axisTop + timeAxisHeight / 2);
      lastLabelX = x;
    }
  }

  // a few interior hour ticks on the newest session so the axis is not sparse
  if (store.len) {
    const last = store.len - 1;
    for (let i = Math.max(0, last - 60); i <= last; i++) {
      const t = store.time[i];
      const mins = istMinutes(t);
      if (mins % 60 !== 0) continue;
      const x = view.xOf(i);
      if (x < 20 || x > plotWidth - 20) continue;
      if (x - lastLabelX < minLabelGap) continue;
      ctx.fillStyle = COLORS.textMuted;
      ctx.fillText(formatISTTime(t, true), x, axisTop + timeAxisHeight / 2);
      lastLabelX = x;
    }
  }
  ctx.restore();
}

function istMinutes(t) {
  const d = new Date((t * 1000) + 5.5 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Candlesticks with per-pixel-column decimation. */
export function drawCandles(ctx, view, store, opts = {}) {
  const range = visibleRange(store, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const spacing = view.barSpacing;
  const bodyWidth = Math.max(1, Math.floor(spacing - Math.max(1, spacing * 0.18)));
  const x0 = view.xOf(from) - spacing / 2;

  // decimate: when the viewport shows more bars than there are pixels,
  // aggregate each pixel column into one OHLC bucket.
  const plotWidth = view.width - view.priceScaleWidth;
  const pxCols = Math.max(1, Math.floor(plotWidth));
  const barsInView = to - from;
  const stride = barsInView > pxCols ? Math.ceil(barsInView / pxCols) : 1;

  ctx.save();
  for (let i = from; i < to; i += stride) {
    const hi = Math.min(to, i + stride);
    let o = store.open[i], c = store.close[i], h = store.high[i], l = store.low[i];
    let v = store.volume[i];
    for (let j = i + 1; j < hi; j++) {
      if (store.high[j] > h) h = store.high[j];
      if (store.low[j] < l) l = store.low[j];
      v += store.volume[j];
    }
    const up = c >= o;
    const x = x0 + (i - from) * spacing;
    const px = Math.round(x + spacing / 2);

    ctx.strokeStyle = up ? COLORS.up : COLORS.down;
    ctx.fillStyle = up ? COLORS.up : COLORS.down;
    ctx.lineWidth = 1;

    const yHigh = Math.round(ps.y(h, view.plotTop, view.plotHeight));
    const yLow = Math.round(ps.y(l, view.plotTop, view.plotHeight));
    const yOpen = Math.round(ps.y(o, view.plotTop, view.plotHeight));
    const yClose = Math.round(ps.y(c, view.plotTop, view.plotHeight));

    // wick
    const bodyTop = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    const bodyH = Math.max(1, bodyBottom - bodyTop);
    if (bodyWidth <= 1) {
      // very zoomed out: a single vertical line per column
      ctx.beginPath();
      ctx.moveTo(px + 0.5, yHigh);
      ctx.lineTo(px + 0.5, yLow);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(px + 0.5, yHigh);
      ctx.lineTo(px + 0.5, bodyTop);
      ctx.moveTo(px + 0.5, bodyBottom);
      ctx.lineTo(px + 0.5, yLow);
      ctx.stroke();
      ctx.fillRect(px - Math.floor(bodyWidth / 2), bodyTop, bodyWidth, bodyH);
    }
  }
  ctx.restore();
}

/** Hollow candles (outlined body when up, filled when down). */
export function drawHollowCandles(ctx, view, store) {
  const range = visibleRange(store, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const spacing = view.barSpacing;
  const bodyWidth = Math.max(1, Math.floor(spacing - Math.max(1, spacing * 0.18)));
  const x0 = view.xOf(from) - spacing / 2;
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = from; i < to; i++) {
    const o = store.open[i], c = store.close[i];
    const up = c >= o;
    const x = x0 + (i - from) * spacing;
    const px = Math.round(x + spacing / 2);
    const yHigh = Math.round(ps.y(store.high[i], view.plotTop, view.plotHeight));
    const yLow = Math.round(ps.y(store.low[i], view.plotTop, view.plotHeight));
    const yOpen = Math.round(ps.y(o, view.plotTop, view.plotHeight));
    const yClose = Math.round(ps.y(c, view.plotTop, view.plotHeight));
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    const col = up ? COLORS.up : COLORS.down;
    ctx.strokeStyle = col;
    ctx.fillStyle = up ? COLORS.bg : col;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, yHigh); ctx.lineTo(px + 0.5, yLow); ctx.stroke();
    if (bodyWidth > 1) {
      ctx.fillRect(px - Math.floor(bodyWidth / 2), bodyTop, bodyWidth, bodyH);
      ctx.strokeRect(px - Math.floor(bodyWidth / 2) + 0.5, bodyTop + 0.5, bodyWidth - 1, bodyH - 1);
    }
  }
  ctx.restore();
}

/** OHLC bars. */
export function drawBars(ctx, view, store) {
  const range = visibleRange(store, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const spacing = view.barSpacing;
  const tick = Math.max(2, spacing * 0.22);
  const x0 = view.xOf(from) - spacing / 2;
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = from; i < to; i++) {
    const o = store.open[i], c = store.close[i];
    const up = c >= o;
    const x = Math.round(x0 + (i - from) * spacing + spacing / 2) + 0.5;
    const yHigh = Math.round(ps.y(store.high[i], view.plotTop, view.plotHeight)) + 0.5;
    const yLow = Math.round(ps.y(store.low[i], view.plotTop, view.plotHeight)) + 0.5;
    const yOpen = Math.round(ps.y(o, view.plotTop, view.plotHeight)) + 0.5;
    const yClose = Math.round(ps.y(c, view.plotTop, view.plotHeight)) + 0.5;
    ctx.strokeStyle = up ? COLORS.up : COLORS.down;
    ctx.beginPath();
    ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow);            // vertical
    ctx.moveTo(x - tick, yOpen); ctx.lineTo(x, yOpen);    // open tick
    ctx.moveTo(x, yClose); ctx.lineTo(x + tick, yClose);  // close tick
    ctx.stroke();
  }
  ctx.restore();
}

/** Line with min/max envelope decimation: identical look, a fraction of the work. */
export function drawLine(ctx, view, store, color = COLORS.accent, lineWidth = 2) {
  const range = visibleRange(store, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const spacing = view.barSpacing;
  const x0 = view.xOf(from);
  const plotWidth = view.width - view.priceScaleWidth;
  const pxCols = Math.max(1, Math.floor(plotWidth));
  const n = to - from;
  const stride = n > pxCols ? Math.ceil(n / pxCols) : 1;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  if (stride === 1) {
    for (let i = from; i < to; i++) {
      const x = x0 + (i - from) * spacing;
      const y = ps.y(store.close[i], view.plotTop, view.plotHeight);
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  } else {
    // one min and one max vertex per pixel column keeps the silhouette exact
    for (let i = from; i < to; i += stride) {
      const hi = Math.min(to, i + stride);
      let mn = Infinity, mx = -Infinity;
      for (let j = i; j < hi; j++) {
        const v = store.close[j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const x = x0 + (i - from) * spacing;
      if (i === from) ctx.moveTo(x, ps.y(mx, view.plotTop, view.plotHeight));
      ctx.lineTo(x, ps.y(mx, view.plotTop, view.plotHeight));
      ctx.lineTo(x, ps.y(mn, view.plotTop, view.plotHeight));
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Area with a gradient fill under the line. */
export function drawArea(ctx, view, store, lineColor = '#6366f1') {
  const range = visibleRange(store, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const spacing = view.barSpacing;
  const x0 = view.xOf(from);
  const bottom = view.plotTop + view.plotHeight;

  const pts = [];
  for (let i = from; i < to; i++) {
    pts.push([x0 + (i - from) * spacing, ps.y(store.close[i], view.plotTop, view.plotHeight)]);
  }
  if (!pts.length) return;

  const grad = ctx.createLinearGradient(0, view.plotTop, 0, bottom);
  grad.addColorStop(0, hexAlpha(lineColor, 0.35));
  grad.addColorStop(1, hexAlpha(lineColor, 0.02));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], bottom);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Volume histogram pinned to the bottom of the plot (or an explicit zone). */
export function drawVolume(ctx, view, store, top, height) {
  const range = visibleRange(store, view);
  if (!range) return;
  const { from, to } = range;
  const spacing = view.barSpacing;
  const plotWidth = view.width - view.priceScaleWidth;
  const pxCols = Math.max(1, Math.floor(plotWidth));
  const n = to - from;
  const stride = n > pxCols ? Math.ceil(n / pxCols) : 1;

  const volTop = top != null ? top : (view.plotTop + view.plotHeight * 0.82);
  const volHeight = height != null ? height : (view.plotHeight * 0.18);
  const maxV = view.maxVolume || 1;
  const bodyWidth = Math.max(1, Math.floor(spacing - Math.max(1, spacing * 0.18)));
  const x0 = view.xOf(from) - spacing / 2;

  ctx.save();
  for (let i = from; i < to; i += stride) {
    const hi = Math.min(to, i + stride);
    let v = 0;
    let o = store.open[i], c = store.close[i];
    for (let j = i; j < hi; j++) { v += store.volume[j]; c = store.close[j]; }
    const h = Math.min(volHeight, (v / maxV) * volHeight);
    const x = x0 + (i - from) * spacing;
    const px = Math.round(x + spacing / 2);
    ctx.fillStyle = c >= o ? COLORS.volumeUp : COLORS.volumeDown;
    ctx.fillRect(px - Math.floor(bodyWidth / 2), volTop + volHeight - h, bodyWidth, h);
  }
  ctx.restore();
}

/** Index-space overlay line: [{time: barIndex, value}] precomputed per frame. */
export function drawOverlayLine(ctx, view, points, color, lineWidth = 1.5, dash = null) {
  if (!points || !points.length) return;
  const ps = view.priceScale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    const x = view.xOf(p.time);
    if (x < -50 || x > view.width + 50) { started = false; continue; }
    const y = ps.y(p.value, view.plotTop, view.plotHeight);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Bollinger band: three lines + a translucent fill. */
export function drawBollinger(ctx, view, bb) {
  if (!bb || !bb.length) return;
  const ps = view.priceScale;
  ctx.save();
  ctx.fillStyle = 'rgba(41,98,255,0.07)';
  ctx.beginPath();
  let started = false;
  for (const p of bb) {
    const x = view.xOf(p.time);
    if (x < -50 || x > view.width + 50) continue;
    const y = ps.y(p.upper, view.plotTop, view.plotHeight);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  for (let i = bb.length - 1; i >= 0; i--) {
    const x = view.xOf(bb[i].time);
    if (x < -50 || x > view.width + 50) continue;
    ctx.lineTo(x, ps.y(bb[i].lower, view.plotTop, view.plotHeight));
  }
  ctx.closePath();
  ctx.fill();

  drawOverlayLine(ctx, view, bb.map((p) => ({ time: p.time, value: p.mid })), COLORS.bbMid, 1, [4, 3]);
  drawOverlayLine(ctx, view, bb.map((p) => ({ time: p.time, value: p.upper })), COLORS.bbUpper, 1, [4, 3]);
  drawOverlayLine(ctx, view, bb.map((p) => ({ time: p.time, value: p.lower })), COLORS.bbLower, 1, [4, 3]);
  ctx.restore();
}

/** Volume profile (POC / value area) drawn as a horizontal histogram. */
export function drawVolumeProfile(ctx, view, vp) {
  if (!vp || !vp.rows) return;
  const ps = view.priceScale;
  const maxBucket = vp.pocVolume || 1;
  const width = 130;
  const right = view.width - view.priceScaleWidth - 6;
  ctx.save();
  for (let i = 0; i < vp.rows; i++) {
    const pLo = vp.min + i * vp.step;
    const pHi = pLo + vp.step;
    const y = ps.y(pHi, view.plotTop, view.plotHeight);
    const h = Math.max(1, ps.y(pLo, view.plotTop, view.plotHeight) - y);
    const w = (vp._buckets ? vp._buckets[i] : 0) / maxBucket * width;
    if (w <= 0) continue;
    ctx.fillStyle = COLORS.valueArea;
    ctx.fillRect(right - w, y, w, h);
  }
  // POC line
  const yPoc = Math.round(ps.y(vp.poc, view.plotTop, view.plotHeight)) + 0.5;
  ctx.strokeStyle = COLORS.poc;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, yPoc); ctx.lineTo(right, yPoc); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.poc;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('POC', right - 4, yPoc - 6);

  const yVah = Math.round(ps.y(vp.vah, view.plotTop, view.plotHeight)) + 0.5;
  const yVal = Math.round(ps.y(vp.val, view.plotTop, view.plotHeight)) + 0.5;
  ctx.strokeStyle = 'rgba(247,166,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(0, yVah); ctx.lineTo(right, yVah);
  ctx.moveTo(0, yVal); ctx.lineTo(right, yVal);
  ctx.stroke();
  ctx.restore();
}

/** Last-price tag on the price axis + a dashed line across the plot. */
export function drawLastPrice(ctx, view, price, tickSize, prevClose) {
  if (!isFinite(price)) return;
  const ps = view.priceScale;
  const y = Math.round(ps.y(price, view.plotTop, view.plotHeight)) + 0.5;
  if (y < view.plotTop - 2 || y > view.plotTop + view.plotHeight + 2) return;
  const up = prevClose == null || price >= prevClose;
  const color = up ? COLORS.up : COLORS.down;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(view.width - view.priceScaleWidth, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const text = defaultPriceFormatter(price, tickSize);
  ctx.font = '11px JetBrains Mono, monospace';
  const tw = ctx.measureText(text).width + 12;
  const x = view.width - tw;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 9, tw, 18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + 1);
  ctx.restore();
}

/** Previous close reference line (Dhan/TradingView parity). */
export function drawPrevClose(ctx, view, prevClose) {
  if (!isFinite(prevClose)) return;
  const y = Math.round(view.priceScale.y(prevClose, view.plotTop, view.plotHeight)) + 0.5;
  if (y < view.plotTop - 2 || y > view.plotTop + view.plotHeight + 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(120,123,134,0.6)';
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y); ctx.lineTo(view.width - view.priceScaleWidth, y); ctx.stroke();
  ctx.restore();
}

/** Buy/sell execution markers. */
export function drawTradeMarkers(ctx, view, markers, store) {
  if (!markers?.length) return;
  const ps = view.priceScale;
  ctx.save();
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  for (const m of markers) {
    const idx = store.indexOfTime(m.time);
    if (idx < 0) continue;
    const x = view.xOf(idx);
    if (x < -20 || x > view.width + 20) continue;
    const isBuy = m.side === 'buy' || m.side === 'BUY';
    const color = isBuy ? COLORS.buy : COLORS.sell;
    // place the arrow just below/above the bar
    const barLow = store.low[idx];
    const barHigh = store.high[idx];
    const y = isBuy
      ? ps.y(barLow, view.plotTop, view.plotHeight) + 12
      : ps.y(barHigh, view.plotTop, view.plotHeight) - 12;

    ctx.fillStyle = isBuy ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)';
    ctx.fillRect(x - 22, y - 8, 44, 16);

    ctx.fillStyle = color;
    ctx.beginPath();
    if (isBuy) {
      ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y - 5); ctx.lineTo(x, y + 2);
    } else {
      ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y + 5); ctx.lineTo(x, y - 2);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillText(`${m.qty}`, x, y - 10);

    // the execution price itself, as a dotted line
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(view.width - view.priceScaleWidth, ps.y(m.price, view.plotTop, view.plotHeight));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Watermark: symbol + timeframe, bottom-right of the plot. */
export function drawWatermark(ctx, view, label) {
  if (!label) return;
  ctx.save();
  ctx.font = '700 46px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(120,123,134,0.10)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, view.width - view.priceScaleWidth - 16, view.plotTop + view.plotHeight - 10);
  ctx.restore();
}

/** Legend: OHLC + volume for the hovered bar, top-left of the plot. */
export function drawLegend(ctx, view, store, hoverIndex, symbolLabel, timeframeLabel, indEntries = []) {
  if (store.len === 0) return;
  const i = hoverIndex != null && hoverIndex >= 0 && hoverIndex < store.len ? hoverIndex : store.len - 1;
  const bar = {
    o: store.open[i], h: store.high[i], l: store.low[i], c: store.close[i], v: store.volume[i], t: store.time[i],
  };
  const up = bar.c >= bar.o;
  ctx.save();
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.textBaseline = 'top';

  let x = 8;
  let y = 8;

  const write = (txt, color, xx, yy) => {
    ctx.fillStyle = color;
    ctx.fillText(txt, xx, yy);
    return ctx.measureText(txt).width;
  };

  if (symbolLabel) {
    x += write(symbolLabel, COLORS.text, x, y);
    x += 8;
  }
  if (timeframeLabel) {
    x += write(timeframeLabel, COLORS.textMuted, x, y);
    x += 12;
  }
  const dt = formatISTDateTime(bar.t);
  x += write(dt, COLORS.textMuted, x, y);
  x += 12;

  const entries = [
    ['O', bar.o],
    ['H', bar.h],
    ['L', bar.l],
    ['C', bar.c],
    ['V', bar.v],
  ];
  for (const [k, v] of entries) {
    const valColor = k === 'V' ? COLORS.text : (up ? COLORS.up : COLORS.down);
    const valTxt = k === 'V' ? formatVolume(v) : defaultPriceFormatter(v, view.priceScale.tickSize);
    const lw = write(k, COLORS.textMuted, x, y);
    x += lw + 3;
    const vw = write(valTxt, valColor, x, y);
    x += vw + 10;
    if (x > view.width - 8) { x = 8; y += 14; }
  }
  // inline indicator values for the bar under the cursor
  for (const ind of indEntries) {
    const valTxt = defaultPriceFormatter(ind.value, view.priceScale.tickSize);
    const lw = write(ind.label, COLORS.textMuted, x, y);
    x += lw + 4;
    const vw = write(valTxt, ind.color, x, y);
    x += vw + 14;
    if (x > view.width - 8) { x = 8; y += 14; }
  }
  ctx.restore();
}

// ── crosshair (drawn on the overlay canvas) ───────────────────────────────────

export function drawCrosshair(ctx, view, px, py, timeScale, store, tickSize) {
  if (px == null || py == null) return;
  const plotW = view.width - view.priceScaleWidth;
  ctx.save();
  ctx.strokeStyle = COLORS.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // vertical snapped to the bar
  let snapX = px;
  if (timeScale && store.len) {
    const idx = timeScale.indexAtX(px, view.barSpacing, view.rightIndex, plotW, 0);
    snapX = view.xOf(idx);
  }
  ctx.beginPath();
  ctx.moveTo(Math.round(snapX) + 0.5, view.plotTop);
  ctx.lineTo(Math.round(snapX) + 0.5, view.plotTop + view.plotHeight);
  ctx.stroke();

  // horizontal
  ctx.beginPath();
  ctx.moveTo(0, Math.round(py) + 0.5);
  ctx.lineTo(plotW, Math.round(py) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // price label on the right axis
  const price = view.priceScale.price(py, view.plotTop, view.plotHeight);
  const text = defaultPriceFormatter(price, tickSize);
  ctx.font = '11px JetBrains Mono, monospace';
  const tw = ctx.measureText(text).width + 12;
  ctx.fillStyle = COLORS.crosshairLabel;
  ctx.fillRect(view.width - tw, py - 9, tw, 18);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, view.width - tw + 6, py + 1);

  // time label on the bottom axis
  if (store.len && timeScale) {
    const t = timeScale.timeAtX(px, view.barSpacing, view.rightIndex, plotW, 0);
    if (t != null) {
      const label = view.intraday
        ? formatISTDateTime(t)
        : `${formatISTTime(t, false)}`;
      const lw = ctx.measureText(label).width + 12;
      const lx = Math.max(0, Math.min(plotW - lw, snapX - lw / 2));
      ctx.fillStyle = COLORS.crosshairLabel;
      ctx.fillRect(lx, view.plotTop + view.plotHeight + 2, lw, view.timeAxisHeight - 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx + 6, view.plotTop + view.plotHeight + 2 + (view.timeAxisHeight - 2) / 2);
    }
  }
  ctx.restore();
}

export function drawHeikinAshi(ctx, view, data) {
  if (!data || !data.open || !data.open.length) return;
  const range = visibleRange({ len: data.open.length }, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const spacing = view.barSpacing;
  const plotW = view.width - view.priceScaleWidth;
  const bodyWidth = Math.max(1, Math.floor(spacing - Math.max(1, spacing * 0.18)));
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = from; i < to; i++) {
    const po = data.open[i], ph = data.high[i], pl = data.low[i], pc = data.close[i];
    if (!po || !ph || !pl || !pc) continue;
    const o = ptVal(po, 'open'), h = ptVal(ph, 'high');
    const l = ptVal(pl, 'low'), c = ptVal(pc, 'close');
    const x = view.xOf(po.time);
    const px = Math.round(x + spacing / 2);
    if (px < -spacing || px > plotW + spacing) continue;
    const up = c >= o;
    const yHigh = Math.round(ps.y(h, view.plotTop, view.plotHeight));
    const yLow = Math.round(ps.y(l, view.plotTop, view.plotHeight));
    const yOpen = Math.round(ps.y(o, view.plotTop, view.plotHeight));
    const yClose = Math.round(ps.y(c, view.plotTop, view.plotHeight));
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.strokeStyle = up ? COLORS.up : COLORS.down;
    ctx.fillStyle = up ? COLORS.up : COLORS.down;
    if (bodyWidth <= 1) {
      ctx.beginPath();
      ctx.moveTo(px + 0.5, yHigh);
      ctx.lineTo(px + 0.5, yLow);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(px + 0.5, yHigh);
      ctx.lineTo(px + 0.5, bodyTop);
      ctx.moveTo(px + 0.5, bodyTop + bodyH);
      ctx.lineTo(px + 0.5, yLow);
      ctx.stroke();
      ctx.fillRect(px - Math.floor(bodyWidth / 2), bodyTop, bodyWidth, bodyH);
    }
  }
  ctx.restore();
}

export function drawRenko(ctx, view, bricks) {
  if (!bricks || !bricks.length) return;
  const range = visibleRange({ len: bricks.length }, view);
  if (!range) return;
  const { from, to } = range;
  const ps = view.priceScale;
  const plotW = view.width - view.priceScaleWidth;
  const bw = Math.max(2, Math.floor(view.barSpacing - 2));
  ctx.save();
  for (let i = from; i < to; i++) {
    const b = bricks[i];
    if (!b || !isFinite(b.open) || !isFinite(b.close)) continue;
    const x = view.xOf(b.time);
    if (x < -bw || x > plotW + bw) continue;
    const up = b.direction !== -1;
    const yTop = Math.round(ps.y(Math.max(b.open, b.close), view.plotTop, view.plotHeight));
    const yBot = Math.round(ps.y(Math.min(b.open, b.close), view.plotTop, view.plotHeight));
    ctx.fillStyle = up ? COLORS.up : COLORS.down;
    ctx.fillRect(Math.round(x - bw / 2), yTop, bw, Math.max(1, yBot - yTop));
  }
  ctx.restore();
}

export function drawStochasticPane(ctx, view, data, paneTop, paneHeight) {
  if (!data || !data.k || !data.k.length) return;
  drawPane(ctx, view, paneTop, paneHeight, 'Stochastic');
  const yHi = scaleY(80, 0, 100, paneTop, paneHeight);
  const yLo = scaleY(20, 0, 100, paneTop, paneHeight);
  drawBands(ctx, view, yHi, yLo, paneTop, paneTop + paneHeight);
  drawSeries(ctx, view, data.k, '#2962ff', null, 0, 100, paneTop, paneHeight);
  drawSeries(ctx, view, data.d, '#f7a600', [4, 3], 0, 100, paneTop, paneHeight);
}

export function drawSAR(ctx, view, sarData) {
  if (!sarData || !sarData.length) return;
  const range = visibleRange({ len: sarData.length }, view);
  if (!range) return;
  const ps = view.priceScale;
  const plotW = view.width - view.priceScaleWidth;
  ctx.save();
  for (let i = range.from; i < range.to; i++) {
    const p = sarData[i];
    if (!p || !isFinite(p.value)) continue;
    const x = view.xOf(p.time);
    if (x < -10 || x > plotW + 10) continue;
    const y = Math.round(ps.y(p.value, view.plotTop, view.plotHeight));
    ctx.fillStyle = p.direction === -1 ? COLORS.down : COLORS.up;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * PI);
    ctx.fill();
  }
  ctx.restore();
}

export function drawIchimoku(ctx, view, cloud) {
  if (!cloud) return;
  const ps = view.priceScale;
  const { plotTop, plotHeight } = view;
  drawIchimokuCloud(ctx, view, cloud.senkouA, cloud.senkouB, ps.min, ps.max, plotTop, plotHeight);
  drawSeries(ctx, view, cloud.tenkan, COLORS.accent, null, ps.min, ps.max, plotTop, plotHeight);
  drawSeries(ctx, view, cloud.kijun, COLORS.down, null, ps.min, ps.max, plotTop, plotHeight);
  drawSeries(ctx, view, cloud.senkouA, COLORS.up, null, ps.min, ps.max, plotTop, plotHeight);
  drawSeries(ctx, view, cloud.senkouB, COLORS.ema50, null, ps.min, ps.max, plotTop, plotHeight);
  drawSeries(ctx, view, cloud.chikun, COLORS.vwap, [4, 3], ps.min, ps.max, plotTop, plotHeight);
}

export function drawOBV(ctx, view, obvData, paneTop, paneHeight) {
  if (!obvData || !obvData.length) return;
  drawPane(ctx, view, paneTop, paneHeight, 'OBV');
  const plotW = view.width - view.priceScaleWidth;
  let min = Infinity, max = -Infinity;
  for (const p of obvData) {
    if (!p || !isFinite(p.value)) continue;
    const x = view.xOf(p.time);
    if (x < 0 || x > plotW) continue;
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  if (!isFinite(min)) return;
  if (max - min < 1e-9) max = min + 1;
  drawSeries(ctx, view, obvData, '#2962ff', null, min, max, paneTop, paneHeight);
}

export function drawMFI(ctx, view, mfiData, paneTop, paneHeight) {
  if (!mfiData || !mfiData.length) return;
  drawPane(ctx, view, paneTop, paneHeight, 'MFI');
  const yHi = scaleY(80, 0, 100, paneTop, paneHeight);
  const yLo = scaleY(20, 0, 100, paneTop, paneHeight);
  drawBands(ctx, view, yHi, yLo, paneTop, paneTop + paneHeight);
  drawSeries(ctx, view, mfiData, '#2962ff', null, 0, 100, paneTop, paneHeight);
}

export function drawADX(ctx, view, adxData, paneTop, paneHeight) {
  if (!adxData || !adxData.adx || !adxData.adx.length) return;
  drawPane(ctx, view, paneTop, paneHeight, 'ADX');
  const plotW = view.width - view.priceScaleWidth;
  let min = Infinity, max = -Infinity;
  for (const arr of [adxData.adx, adxData.plusDI, adxData.minusDI]) {
    if (!arr) continue;
    for (const p of arr) {
      if (!p || !isFinite(p.value)) continue;
      const x = view.xOf(p.time);
      if (x < 0 || x > plotW) continue;
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  }
  if (!isFinite(min)) return;
  if (max - min < 1e-9) max = min + 1;
  if (min > 0) min = 0;
  drawSeries(ctx, view, adxData.plusDI, COLORS.up, null, min, max, paneTop, paneHeight);
  drawSeries(ctx, view, adxData.minusDI, COLORS.down, null, min, max, paneTop, paneHeight);
  drawSeries(ctx, view, adxData.adx, COLORS.text, null, min, max, paneTop, paneHeight);
  if (25 > min && 25 < max) {
    const y = Math.round(scaleY(25, min, max, paneTop, paneHeight)) + 0.5;
    ctx.strokeStyle = COLORS.textMuted;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawWilliamsR(ctx, view, wrData, paneTop, paneHeight) {
  if (!wrData || !wrData.length) return;
  drawPane(ctx, view, paneTop, paneHeight, 'Williams %R');
  const yHi = scaleY(-20, -100, 0, paneTop, paneHeight);
  const yLo = scaleY(-80, -100, 0, paneTop, paneHeight);
  drawBands(ctx, view, yHi, yLo, paneTop, paneTop + paneHeight);
  drawSeries(ctx, view, wrData, '#ab47bc', null, -100, 0, paneTop, paneHeight);
}

export function drawCCI(ctx, view, cciData, paneTop, paneHeight) {
  if (!cciData || !cciData.length) return;
  drawPane(ctx, view, paneTop, paneHeight, 'CCI');
  const plotW = view.width - view.priceScaleWidth;
  let min = Infinity, max = -Infinity;
  for (const p of cciData) {
    if (!p || !isFinite(p.value)) continue;
    const x = view.xOf(p.time);
    if (x < 0 || x > plotW) continue;
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  if (!isFinite(min)) return;
  if (max - min < 1e-9) max = min + 1;
  for (const lvl of [100, -100]) {
    if (lvl < min || lvl > max) continue;
    const y = Math.round(scaleY(lvl, min, max, paneTop, paneHeight)) + 0.5;
    ctx.strokeStyle = COLORS.textMuted;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (min < 0 && max > 0) {
    const y = Math.round(scaleY(0, min, max, paneTop, paneHeight)) + 0.5;
    ctx.strokeStyle = COLORS.gridBold;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
  }
  drawSeries(ctx, view, cciData, '#f7a600', null, min, max, paneTop, paneHeight);
}

function ptVal(p, key) {
  return p[key] != null ? p[key] : p.value;
}

function scaleY(v, min, max, top, height) {
  const span = max - min;
  return top + (1 - (span > 0 ? (v - min) / span : 0.5)) * height;
}

function drawPane(ctx, view, paneTop, paneHeight, label) {
  const plotW = view.width - view.priceScaleWidth;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, paneTop, plotW, paneHeight);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, paneTop + 0.5);
  ctx.lineTo(plotW, paneTop + 0.5);
  ctx.stroke();
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, 6, paneTop + 5);
}

function drawBands(ctx, view, yHi, yLo, top, bottom) {
  const plotW = view.width - view.priceScaleWidth;
  ctx.fillStyle = 'rgba(239,83,80,0.08)';
  ctx.fillRect(0, top, plotW, Math.max(0, yHi - top));
  ctx.fillStyle = 'rgba(38,166,154,0.08)';
  ctx.fillRect(0, yLo, plotW, Math.max(0, bottom - yLo));
  ctx.strokeStyle = COLORS.textMuted;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, Math.round(yHi) + 0.5);
  ctx.lineTo(plotW, Math.round(yHi) + 0.5);
  ctx.moveTo(0, Math.round(yLo) + 0.5);
  ctx.lineTo(plotW, Math.round(yLo) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSeries(ctx, view, pts, color, dash, min, max, top, height) {
  if (!pts || !pts.length) return;
  const plotW = view.width - view.priceScaleWidth;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    if (!p || !isFinite(p.value)) { started = false; continue; }
    const x = view.xOf(p.time);
    if (x < -50 || x > plotW + 50) { started = false; continue; }
    const y = scaleY(p.value, min, max, top, height);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawIchimokuCloud(ctx, view, a, b, min, max, top, height) {
  if (!a || !b || a.length !== b.length) return;
  let segFrom = -1, segUp = false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i], pb = b[i];
    if (!pa || !pb || !isFinite(pa.value) || !isFinite(pb.value)) { segFrom = -1; continue; }
    const up = pa.value >= pb.value;
    if (segFrom === -1) { segFrom = i; segUp = up; continue; }
    if (up === segUp) continue;
    drawCloudSeg(ctx, view, a, b, segFrom, i, segUp, min, max, top, height);
    segFrom = i;
    segUp = up;
  }
  if (segFrom !== -1) drawCloudSeg(ctx, view, a, b, segFrom, a.length, segUp, min, max, top, height);
}

function drawCloudSeg(ctx, view, a, b, from, to, up, min, max, top, height) {
  const plotW = view.width - view.priceScaleWidth;
  ctx.fillStyle = up ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)';
  ctx.beginPath();
  let started = false;
  for (let i = from; i < to; i++) {
    const x = view.xOf(a[i].time);
    if (x < -50 || x > plotW + 50) { started = false; continue; }
    const y = scaleY(a[i].value, min, max, top, height);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  for (let i = to - 1; i >= from; i--) {
    const x = view.xOf(b[i].time);
    if (x < -50 || x > plotW + 50) continue;
    ctx.lineTo(x, scaleY(b[i].value, min, max, top, height));
  }
  ctx.closePath();
  ctx.fill();
}

function hexAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * drawSRZones - renders support/resistance ZONE FILLS between paired levels.
 * Call BEFORE drawCandles so zones render behind candles.
 */
export function drawSRZones(ctx, view, ps, zones) {
  if (!zones?.length) return;
  const { plotTop, plotHeight, width, priceScaleWidth } = view;
  const plotWidth = width - priceScaleWidth;

  for (const zone of zones) {
    const p1 = zone.price1, p2 = zone.price2;
    const y1 = ps.y(p1, plotTop, plotHeight);
    const y2 = (p2 != null) ? ps.y(p2, plotTop, plotHeight) : y1;
    const top = Math.min(y1, y2);
    const zoneH = Math.max(1, Math.abs(y2 - y1));
    if (zoneH < 1) continue;

    ctx.fillStyle = zone.type === 'support'
      ? 'rgba(38, 166, 154, 0.08)'
      : 'rgba(239, 83, 80, 0.08)';
    ctx.fillRect(0, top, plotWidth, zoneH);

    ctx.lineWidth = 1;
    ctx.strokeStyle = zone.type === 'support' ? '#26a69a' : '#ef5350';
    ctx.setLineDash([]);
    for (const y of [y1, y2]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();
    }

    if (zone.label) {
      ctx.save();
      ctx.font = 'italic 11px Inter, sans-serif';
      ctx.fillStyle = zone.type === 'support'
        ? 'rgba(38, 166, 154, 0.6)'
        : 'rgba(239, 83, 80, 0.6)';
      ctx.fillText(zone.label, 60, top + zoneH / 2 + 4);
      ctx.restore();
    }
  }
}

/**
 * drawSRPriceLabels - colored box labels on the right price axis for S/R levels.
 */
export function drawSRPriceLabels(ctx, view, ps, levels) {
  if (!levels?.length) return;
  const { plotTop, plotHeight, width, priceScaleWidth } = view;
  const plotWidth = width - priceScaleWidth;
  const boxW = priceScaleWidth - 4;
  const boxH = 16;

  ctx.font = 'bold 10px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const level of levels) {
    const price = (level.price1 != null) ? level.price1 : level.price;
    if (price == null) continue;
    const y = ps.y(price, plotTop, plotHeight);
    if (y < plotTop || y > plotTop + plotHeight) continue;

    const bg = level.type === 'support' ? '#26a69a' : '#ef5350';
    const label = Number(price).toFixed(1);

    ctx.fillStyle = bg;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(plotWidth + 2, y - boxH / 2, boxW, boxH, 3);
      ctx.fill();
    } else {
      ctx.fillRect(plotWidth + 2, y - boxH / 2, boxW, boxH);
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, plotWidth + 2 + boxW / 2, y + 1);
  }
}

void PI;
void istDayKey;
void drawVolumeProfile;
