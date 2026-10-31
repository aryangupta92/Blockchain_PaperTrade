/**
 * dhanDrawings.js — Dhan-style drawing model.
 * Serializable + compatible with existing backend POST /api/ext/drawings
 * { symbol, drawings: [{id,type,points,text,color,createdAt}] }
 * points use DATA coords: { time (unix sec), price } so they survive reload/zoom.
 */
export const DRAW_TYPES = {
  TREND: 'TRENDLINE',
  HORIZONTAL: 'HORIZONTAL',
  RECT: 'RECTANGLE',
  FIB: 'FIB',
  TEXT: 'TEXT',
};

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function newDrawing(type, symbol, a, b, text = '') {
  return {
    id: `d_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    type,
    symbol,
    points: [a, b].filter(Boolean), // [{time,price}]
    text,
    color: '#2962FF',
    createdAt: new Date().toISOString(),
  };
}

// Map data-coord point -> relative 0..1 using visible data bounds
export function toRelative(pt, times, minPrice, maxPrice) {
  if (!times.length) return { x: 0.5, y: 0.5 };
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const span = Math.max(1, t1 - t0);
  const x = (pt.time - t0) / span;
  const pr = Math.max(1e-9, maxPrice - minPrice);
  const y = 1 - (pt.price - minPrice) / pr; // svg y down
  return { x: Math.min(1.05, Math.max(-0.05, x)), y: Math.min(1.05, Math.max(-0.05, y)) };
}

export function fibPrices(p0, p1) {
  const diff = p1 - p0;
  return FIB_LEVELS.map((l) => ({ level: l, price: p0 + diff * l }));
}
