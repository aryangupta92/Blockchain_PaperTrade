/**
 * chart/panes.js
 * ---------------------------------------------------------------------------
 * Sub-panes (RSI, MACD) that share the main pane's time axis.
 * Each pane owns its own y-mapping but reuses the same x mapping, so panning
 * the price pane moves every pane identically.
 */

import { COLORS, defaultPriceFormatter } from './scales.js';

function paneFrame(ctx, view, top, height) {
  const w = view.width - view.priceScaleWidth;
  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, top, view.width, height);
  return w;
}

/** RSI(14) with the standard 70/30 bands. */
export function drawRSIPane(ctx, view, points, top, height) {
  if (!points?.length) return;
  const w = paneFrame(ctx, view, top, height);

  // bands
  ctx.strokeStyle = 'rgba(120,123,134,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const lvl of [30, 50, 70]) {
    const y = Math.round(yFor(lvl, top, height)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // shaded over/under zones
  ctx.fillStyle = COLORS.rsiOver;
  ctx.fillRect(0, yFor(70, top, height), w, yFor(100, top, height) - yFor(70, top, height));
  ctx.fillStyle = COLORS.rsiUnder;
  ctx.fillRect(0, yFor(30, top, height), w, yFor(0, top, height) - yFor(30, top, height));

  // the line
  ctx.strokeStyle = COLORS.rsi;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    const x = view.xOf(p.time);
    if (x < -20 || x > view.width + 20) { started = false; continue; }
    const y = yFor(p.value, top, height);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // axis labels
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const lvl of [70, 30]) {
    ctx.fillText(String(lvl), view.width - view.priceScaleWidth + 6, yFor(lvl, top, height));
  }
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText('RSI 14', 8, top + 12);
  const last = points[points.length - 1];
  if (last) {
    ctx.fillStyle = COLORS.rsi;
    ctx.fillText(last.value.toFixed(2), 64, top + 12);
  }
  ctx.restore();

  function yFor(v, t, h) {
    return t + (1 - (v / 100)) * h;
  }
}

/** MACD(12,26,9): histogram bars + line + signal. */
export function drawMACDPane(ctx, view, macd, top, height) {
  if (!macd || (!macd.line.length && !macd.hist.length)) return;
  const w = paneFrame(ctx, view, top, height);

  const vals = [];
  macd.line.forEach((p) => vals.push(p.value));
  macd.signal.forEach((p) => vals.push(p.value));
  macd.hist.forEach((p) => vals.push(p.value));
  let mn = Math.min(...vals);
  let mx = Math.max(...vals);
  if (!isFinite(mn) || !isFinite(mx) || mn === mx) { mn -= 1; mx += 1; }
  const pad = (mx - mn) * 0.08;
  mn -= pad; mx += pad;
  const zeroY = Math.round(((0 - mn) / (mx - mn)) * height) + top;

  // zero line
  ctx.strokeStyle = 'rgba(120,123,134,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, zeroY + 0.5); ctx.lineTo(w, zeroY + 0.5); ctx.stroke();

  const yFor = (v) => top + (1 - (v - mn) / (mx - mn)) * height;

  // histogram
  const spacing = view.barSpacing;
  const barW = Math.max(1, Math.min(6, spacing - 2));
  ctx.fillStyle = COLORS.macdUp;
  macd.hist.forEach((p) => {
    const x = view.xOf(p.time);
    if (x < -10 || x > view.width + 10) return;
    const y = yFor(p.value);
    ctx.fillStyle = p.value >= 0 ? COLORS.macdUp : COLORS.macdDown;
    ctx.fillRect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(zeroY - y));
  });

  // line + signal
  const line = (pts, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const x = view.xOf(p.time);
      if (x < -20 || x > view.width + 20) { started = false; continue; }
      const y = yFor(p.value);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  line(macd.line, COLORS.macdLine);
  line(macd.signal, COLORS.macdSignal);

  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MACD 12/26/9', 8, top + 12);
  if (macd.line.length) {
    ctx.fillStyle = COLORS.macdLine;
    ctx.fillText(macd.line[macd.line.length - 1].value.toFixed(3), 92, top + 12);
  }
  if (macd.signal.length) {
    ctx.fillStyle = COLORS.macdSignal;
    ctx.fillText(macd.signal[macd.signal.length - 1].value.toFixed(3), 160, top + 12);
  }
  ctx.restore();
}

/** A tiny pane header: name + current value, with a left accent bar. */
export function drawPaneHeader(ctx, view, label, value, color, top) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, top, 3, 14);
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText(label, 8, top + 7);
  if (value != null) {
    ctx.fillStyle = color;
    ctx.fillText(defaultPriceFormatter(value, 0.01), 8 + ctx.measureText(label).width + 8, top + 7);
  }
  ctx.restore();
}
