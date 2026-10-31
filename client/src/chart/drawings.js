/**
 * chart/drawings.js
 * ---------------------------------------------------------------------------
 * Canvas drawing objects, stored in data coordinates so they survive reloads,
 * zooms and time-frame changes (a pixel-based drawing would drift).
 *
 * Serialisation matches the backend contract:
 *   { id, type, symbol, points: [{ time, price }], text, color, createdAt }
 *
 * Types: TRENDLINE | HORIZONTAL | RECTANGLE | FIB | TEXT
 */

import { COLORS, defaultPriceFormatter } from './scales.js';

export const DRAW_TYPES = {
  TRENDLINE: 'TRENDLINE',
  HORIZONTAL: 'HORIZONTAL',
  RECTANGLE: 'RECTANGLE',
  FIB: 'FIB',
  TEXT: 'TEXT',
  GANN_FAN: 'GANN_FAN',
  ELLIOTT: 'ELLIOTT',
  PITCHFORK: 'PITCHFORK',
  PARALLEL: 'PARALLEL',
  FIB_EXTENSION: 'FIB_EXTENSION',
  ABCD: 'ABCD',
};

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const GANN_ANGLES = [
  { label: '1x4', deg: 14.04 },
  { label: '1x2', deg: 26.57 },
  { label: '1x1', deg: 45 },
  { label: '2x1', deg: 63.43 },
  { label: '4x1', deg: 75.96 },
];

export const FIB_EXTENSION_LEVELS = [0, 0.382, 0.618, 1, 1.382, 1.618, 2.618];

const POINT_COUNT = {
  [DRAW_TYPES.TRENDLINE]: 2,
  [DRAW_TYPES.HORIZONTAL]: 1,
  [DRAW_TYPES.RECTANGLE]: 2,
  [DRAW_TYPES.FIB]: 2,
  [DRAW_TYPES.TEXT]: 1,
  [DRAW_TYPES.GANN_FAN]: 2,
  [DRAW_TYPES.ELLIOTT]: 5,
  [DRAW_TYPES.PITCHFORK]: 3,
  [DRAW_TYPES.PARALLEL]: 3,
  [DRAW_TYPES.FIB_EXTENSION]: 2,
  [DRAW_TYPES.ABCD]: 4,
};

let seq = 0;
export function newDrawing(type, symbol, points, text = '', color = COLORS.accent) {
  const required = POINT_COUNT[type];
  return {
    id: `d_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    type,
    symbol,
    points: required != null ? (points || []).filter(Boolean).slice(0, required) : (points || []).filter(Boolean),
    text,
    color,
    createdAt: new Date().toISOString(),
  };
}

/** Closest candle index for a time value (used to keep drawings anchored). */
function anchorIndex(store, time) {
  const i = store.indexOfTime(time);
  return i < 0 ? 0 : i;
}

/**
 * Draw every object. `view` provides xOf/timeAtX/priceScale.
 * Hovered objects are drawn thicker so they feel interactive.
 */
export function drawDrawings(ctx, view, store, drawings, hoverId, activeTool, draft) {
  if (!drawings?.length && !draft?.length) return;
  ctx.save();

  const render = (d, isHover) => {
    const color = d.color || COLORS.accent;
    const width = isHover ? 2.2 : 1.6;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([]);

    const pts = (d.points || []).map((p) => {
      const idx = anchorIndex(store, p.time);
      return { x: view.xOf(idx), y: view.priceScale.y(p.price, view.plotTop, view.plotHeight), price: p.price, time: p.time, idx };
    });

    switch (d.type) {
      case DRAW_TYPES.HORIZONTAL: {
        if (!pts[0]) return;
        const y = Math.round(pts[0].y) + 0.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.width - view.priceScaleWidth, y); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, `${defaultPriceFormatter(pts[0].price, view.priceScale.tickSize)}`, 8, y - 8, color);
        // draggable handle
        ctx.beginPath(); ctx.arc(10, y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case DRAW_TYPES.TRENDLINE: {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        // extend slightly so the line reads as a ray, like real terminals
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const len = Math.hypot(dx, dy) || 1;
        ctx.beginPath();
        ctx.moveTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[1].x + (dx / len) * 60, pts[1].y + (dy / len) * 60);
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (const p of pts) {
          ctx.beginPath(); ctx.arc(p.x, p.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case DRAW_TYPES.RECTANGLE: {
        if (pts.length < 2) return;
        const x = Math.min(pts[0].x, pts[1].x);
        const y = Math.min(pts[0].y, pts[1].y);
        const w = Math.abs(pts[1].x - pts[0].x);
        const h = Math.abs(pts[1].y - pts[0].y);
        ctx.globalAlpha = isHover ? 0.28 : 0.14;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        // size tag
        const pct = priceChangePct(pts[0].price, pts[1].price);
        label(ctx, `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, x + 4, y - 8, color);
        break;
      }
      case DRAW_TYPES.FIB: {
        if (pts.length < 2) return;
        const [a, b] = pts;
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const diff = b.price - a.price;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        FIB_LEVELS.forEach((lvl) => {
          const price = a.price + diff * lvl;
          const y = Math.round(view.priceScale.y(price, view.plotTop, view.plotHeight)) + 0.5;
          const emphasis = lvl === 0.5 || lvl === 0.618;
          ctx.strokeStyle = emphasis ? COLORS.poc : color;
          ctx.globalAlpha = emphasis ? 1 : 0.75;
          ctx.lineWidth = emphasis ? 2 : 1;
          ctx.setLineDash(lvl === 0 || lvl === 1 ? [] : [4, 3]);
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.lineWidth = width;
          const txt = `${lvl.toFixed(3)}  ${defaultPriceFormatter(price, view.priceScale.tickSize)}`;
          ctx.fillStyle = COLORS.text;
          ctx.fillText(txt, x1 + 6, y + 3);
        });
        break;
      }
      case DRAW_TYPES.TEXT: {
        if (!pts[0]) return;
        ctx.font = '700 12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS.poc;
        ctx.fillText(`✎ ${d.text || 'note'}`, pts[0].x + 6, pts[0].y - 6);
        break;
      }
      case DRAW_TYPES.GANN_FAN: {
        if (pts.length < 2) return;
        const [origin, ref] = pts;
        const slope = (ref.y - origin.y) / ((ref.x - origin.x) || 1);
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        for (const { label, deg } of GANN_ANGLES) {
          const isUnit = deg === 45;
          ctx.strokeStyle = isUnit ? COLORS.poc : color;
          ctx.globalAlpha = isUnit ? 1 : 0.7;
          ctx.lineWidth = isUnit ? 2 : 1;
          ctx.setLineDash(isUnit ? [] : [4, 3]);
          const rad = deg * Math.PI / 180;
          const dx = Math.cos(rad) * (view.width - origin.x + view.priceScaleWidth);
          const dy = -Math.sin(rad) * (view.width - origin.x + view.priceScaleWidth) * (slope >= 0 ? 1 : -1);
          ctx.beginPath();
          ctx.moveTo(origin.x, origin.y);
          ctx.lineTo(origin.x + dx, origin.y + dy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.lineWidth = width;
          ctx.fillStyle = COLORS.text;
          ctx.fillText(label, origin.x + dx - 28, origin.y + dy + 3);
        }
        ctx.beginPath(); ctx.arc(origin.x, origin.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ref.x, ref.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case DRAW_TYPES.ELLIOTT: {
        if (pts.length < 2) return;
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < pts.length - 1; i++) {
          const [a, b] = [pts[i], pts[i + 1]];
          ctx.strokeStyle = i % 2 === 0 ? color : COLORS.poc;
          ctx.lineWidth = i % 2 === 0 ? width : 2;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.fillStyle = COLORS.text;
          ctx.fillText(`${i + 1}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
        }
        for (const p of pts) {
          ctx.beginPath(); ctx.arc(p.x, p.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case DRAW_TYPES.PITCHFORK: {
        if (pts.length < 3) return;
        const [start, handle, third] = pts;
        const midX = (handle.x + third.x) / 2;
        const midY = (handle.y + third.y) / 2;
        const offsets = [[start, null], [handle, midX], [third, midY]];
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        for (const [pt, mx] of offsets) {
          ctx.strokeStyle = mx == null ? COLORS.poc : color;
          ctx.lineWidth = mx == null ? width : 1.4;
          ctx.setLineDash(mx == null ? [] : [5, 3]);
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = width;
          if (mx != null) {
            ctx.fillStyle = COLORS.text;
            ctx.fillText('median', mx + 4, midY + 3);
          }
        }
        for (const p of pts) {
          ctx.beginPath(); ctx.arc(p.x, p.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case DRAW_TYPES.PARALLEL: {
        if (pts.length < 3) return;
        const [a, b, offset] = pts;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (offset.x - a.x);
        const ny = (dx / len) * (offset.y - a.y);
        const offX = a.x + nx;
        const offY = a.y + ny;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        for (const [pt, off, dashed] of [[a, { x: 0, y: 0 }, false], [b, { x: 0, y: 0 }, false], [offset, { x: offX, y: offY }, true]]) {
          ctx.strokeStyle = dashed ? color : COLORS.poc;
          ctx.lineWidth = dashed ? 1.4 : width;
          ctx.setLineDash(dashed ? [5, 3] : []);
          ctx.beginPath();
          ctx.moveTo(pt.x + off.x, pt.y + off.y);
          const dirX = b.x - a.x;
          const dirY = b.y - a.y;
          const dLen = Math.hypot(dirX, dirY) || 1;
          ctx.lineTo(pt.x + off.x + (dirX / dLen) * 600, pt.y + off.y + (dirY / dLen) * 600);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = width;
        }
        for (const p of pts) {
          ctx.beginPath(); ctx.arc(p.x, p.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case DRAW_TYPES.FIB_EXTENSION: {
        if (pts.length < 2) return;
        const [a, b] = pts;
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const diff = b.price - a.price;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        FIB_EXTENSION_LEVELS.forEach((lvl) => {
          const price = a.price + diff * lvl;
          const y = Math.round(view.priceScale.y(price, view.plotTop, view.plotHeight)) + 0.5;
          const emphasis = lvl === 1 || lvl === 1.618;
          ctx.strokeStyle = emphasis ? COLORS.poc : color;
          ctx.globalAlpha = emphasis ? 1 : 0.75;
          ctx.lineWidth = emphasis ? 2 : 1;
          ctx.setLineDash(lvl === 0 || lvl === 1 ? [] : [4, 3]);
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.lineWidth = width;
          const txt = `${lvl.toFixed(3)}  ${defaultPriceFormatter(price, view.priceScale.tickSize)}`;
          ctx.fillStyle = COLORS.text;
          ctx.fillText(txt, x1 + 6, y + 3);
        });
        for (const p of pts) {
          ctx.beginPath(); ctx.arc(p.x, p.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case DRAW_TYPES.ABCD: {
        if (pts.length < 4) return;
        const [a, b, c, dd] = pts;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.strokeStyle = COLORS.poc;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(dd.x, dd.y); ctx.stroke();
        ctx.setLineDash([]);
        const abDiff = b.price - a.price;
        const bcDiff = c.price - b.price;
        const retracement = bcDiff !== 0 ? Math.abs(abDiff / bcDiff) : 0;
        ctx.fillStyle = COLORS.text;
        ctx.fillText(`AB=CD  ${retracement.toFixed(2)}`, Math.max(a.x, b.x, c.x, dd.x) + 6, Math.min(a.y, b.y, c.y, dd.y) - 8);
        for (const p of pts) {
          ctx.beginPath(); ctx.arc(p.x, p.y, isHover ? 5 : 4, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      default: break;
    }
  };

  for (const d of drawings) render(d, d.id === hoverId);

  // in-progress draft
  if (draft?.length) {
    const d = { ...draft[0], points: [...(draft[1]?.points || []), ...(draft[0]?.points || [])] };
    ctx.globalAlpha = 0.7;
    render({ ...d, type: draft[0]?.type || draft[0]?.tool, color: '#22d3ee' }, true);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function label(ctx, text, x, y, color) {
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(19,23,34,0.9)';
  ctx.fillRect(x, y - 8, w, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 4, y + 2);
}

function priceChangePct(a, b) {
  if (!a) return 0;
  return ((b - a) / a) * 100;
}

/**
 * Hit-test a drawing. Returns the drawing when (px,py) is within grab distance,
 * so the UI can show a delete affordance.
 */
export function hitTestDrawing(view, store, drawings, px, py, tolerance = 8) {
  if (!drawings?.length) return null;
  const ps = view.priceScale;
  let best = null;
  let bestDist = Infinity;
  for (const d of drawings) {
    const pts = (d.points || []).map((p) => {
      const idx = anchorIndex(store, p.time);
      return { x: view.xOf(idx), y: ps.y(p.price, view.plotTop, view.plotHeight) };
    });
    let dist = Infinity;
    if (d.type === DRAW_TYPES.HORIZONTAL && pts[0]) {
      dist = Math.abs(py - pts[0].y);
    } else if ((d.type === DRAW_TYPES.TRENDLINE || d.type === DRAW_TYPES.FIB) && pts.length >= 2) {
      dist = distToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    } else if (d.type === DRAW_TYPES.RECTANGLE && pts.length >= 2) {
      const x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x);
      const y0 = Math.min(pts[0].y, pts[1].y), y1 = Math.max(pts[0].y, pts[1].y);
      const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
      dist = inside ? 0 : Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
    } else if (d.type === DRAW_TYPES.TEXT && pts[0]) {
      dist = Math.hypot(px - (pts[0].x + 6), py - (pts[0].y - 6));
    } else if (d.type === DRAW_TYPES.GANN_FAN && pts.length >= 2) {
      dist = Math.min(
        distToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y),
        Math.hypot(px - pts[0].x, py - pts[0].y)
      );
    } else if (d.type === DRAW_TYPES.ELLIOTT && pts.length >= 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        dist = Math.min(dist, distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
      }
    } else if (d.type === DRAW_TYPES.PITCHFORK && pts.length >= 3) {
      dist = Math.min(
        distToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y),
        distToSegment(px, py, pts[0].x, pts[0].y, pts[2].x, pts[2].y)
      );
    } else if (d.type === DRAW_TYPES.PARALLEL && pts.length >= 3) {
      dist = Math.min(
        distToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y),
        Math.hypot(px - pts[2].x, py - pts[2].y)
      );
    } else if (d.type === DRAW_TYPES.FIB_EXTENSION && pts.length >= 2) {
      dist = distToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    } else if (d.type === DRAW_TYPES.ABCD && pts.length >= 4) {
      dist = Math.min(
        distToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y),
        distToSegment(px, py, pts[1].x, pts[1].y, pts[2].x, pts[2].y),
        distToSegment(px, py, pts[2].x, pts[2].y, pts[3].x, pts[3].y)
      );
    }
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return bestDist <= tolerance ? best : null;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
