/**
 * chart/scales.js
 * ---------------------------------------------------------------------------
 * IST-native time scale and auto-sizing price scale.
 *
 * Time scale: NSE sessions are 09:15-15:30 Mon-Fri. Naive linear time mapping
 * draws 18-hour gaps every night and 60-hour gaps every weekend, so the axis is
 * built from *trading sessions* instead: bars are laid out on a synthetic
 * index where consecutive bars inside a session are adjacent and a session jump
 * adds a fixed inset. The result is a chart that looks like a real broker's.
 */

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const SESSION_GAP_PX = 14;      // visual break between sessions
const MIN_BAR_SPACING = 1.2;
const MAX_BAR_SPACING = 90;
const DEFAULT_BAR_SPACING = 7;

export function istDate(epochSec) {
  return new Date((epochSec * 1000) + IST_OFFSET_MS);
}

export function istParts(epochSec) {
  const d = istDate(epochSec);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    weekday: d.getUTCDay(), // 0=Sun
  };
}

/**
 * Calendar day key in IST. `month` here is 0-indexed, so +1 is required for
 * the key to be stable across month boundaries (Oct = 9 -> 10).
 */
export function istDayKey(epochSec) {
  const p = istParts(epochSec);
  return p.year * 10000 + (p.month + 1) * 100 + p.day;
}

export function formatISTTime(epochSec, intraday) {
  const p = istParts(epochSec);
  const hh = String(p.hours).padStart(2, '0');
  const mm = String(p.minutes).padStart(2, '0');
  if (intraday) return `${hh}:${mm}`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(p.day).padStart(2, '0')} ${MON[p.month]}`;
}

export function formatISTDateTime(epochSec) {
  const p = istParts(epochSec);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(p.hours).padStart(2, '0');
  const mm = String(p.minutes).padStart(2, '0');
  return `${String(p.day).padStart(2, '0')} ${MON[p.month]} ${p.year} ${hh}:${mm}`;
}

/**
 * Builds a bar-index -> x mapping that respects session boundaries.
 * Bars that are not in the same session as their predecessor get a gap.
 */
export class TimeScale {
  constructor(times) {
    this.times = times;
    this.slots = new Float64Array(times.length); // synthetic coordinate
    let slot = 0;
    for (let i = 0; i < times.length; i++) {
      if (i > 0 && !sameSession(times[i - 1], times[i])) slot += SESSION_GAP_PX;
      this.slots[i] = slot;
      slot += 1;
    }
    this.totalSlots = slot;
    // precompute session start indices for gridlines
    this.sessionStarts = [0];
    for (let i = 1; i < times.length; i++) {
      if (!sameSession(times[i - 1], times[i])) this.sessionStarts.push(i);
    }
  }

  /** x for a bar index given the current viewport. */
  x(i, barSpacing, rightIndex, plotWidth, rightOffset) {
    const slot = this.slots[i];
    const refSlot = rightIndex < this.slots.length ? this.slots[rightIndex] : this.totalSlots;
    const base = plotWidth - rightOffset;
    return base - (refSlot - slot) * barSpacing;
  }

  /** Bar index nearest to an x pixel (inverse mapping). */
  indexAtX(x, barSpacing, rightIndex, plotWidth, rightOffset) {
    const refSlot = rightIndex < this.slots.length ? this.slots[rightIndex] : this.totalSlots;
    const base = plotWidth - rightOffset;
    const slot = refSlot - (base - x) / barSpacing;
    // binary search the slots array
    let lo = 0, hi = this.slots.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.slots[mid] <= slot) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return Math.max(0, Math.min(this.slots.length - 1, ans));
  }

  timeAtX(x, barSpacing, rightIndex, plotWidth, rightOffset) {
    const i = this.indexAtX(x, barSpacing, rightIndex, plotWidth, rightOffset);
    return this.times[i] ?? null;
  }
}

function sameSession(t0, t1) {
  if (istDayKey(t0) !== istDayKey(t1)) return false;
  const a = istParts(t0), b = istParts(t1);
  const beforeClose = a.hours * 60 + a.minutes <= 930;
  const afterClose = b.hours * 60 + b.minutes > 930;
  // a session jump happens when we cross the 15:30 boundary within a day
  if (beforeClose !== (b.hours * 60 + b.minutes <= 930)) return false;
  void afterClose;
  return true;
}

/** True when the market was open at this timestamp (weekday 09:15-15:30 IST). */
export function isSessionTime(epochSec) {
  const p = istParts(epochSec);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const mins = p.hours * 60 + p.minutes;
  return mins >= 555 && mins <= 930;
}

export const SPACING = { MIN: MIN_BAR_SPACING, MAX: MAX_BAR_SPACING, DEFAULT: DEFAULT_BAR_SPACING };

// ── Price scale ───────────────────────────────────────────────────────────────

/**
 * Auto-sizes the visible price range from the bars in view (plus a padded
 * margin) and snaps to "nice" tick steps like every real terminal.
 */
export class PriceScale {
  constructor() {
    this.min = 0;
    this.max = 1;
    this.tickSize = 0.05;
    this.formatter = defaultPriceFormatter;
    this.log = false;
  }

  setRange(min, max, tickSize = 0.05, log = false) {
    if (!isFinite(min) || !isFinite(max) || max <= min) return false;
    this.min = min;
    this.max = max;
    this.tickSize = tickSize;
    this.log = Boolean(log);
    return true;
  }

  setLog(on) { this.log = Boolean(on); this.invalidate(); }

  invalidate() { this.step = null; }

  /** Pad the range by a fraction of its height, then snap to nice steps. */
  autoscale(min, max, tickSize, marginPct = 0.08, heightPx = 300) {
    if (!isFinite(min) || !isFinite(max) || max <= min) return false;
    if (min <= 0) min = max * 0.5; // log cannot start at/below 0
    const span = max - min;
    const pad = Math.max(span * marginPct, tickSize);
    let lo = min - pad;
    let hi = max + pad;
    this.log = this.log || false;

    if (this.log) {
      // log scale: nice powers of 10 within range
      const loLog = Math.floor(Math.log10(Math.max(lo, 1e-9)));
      const hiLog = Math.ceil(Math.log10(hi));
      lo = Math.pow(10, loLog);
      hi = Math.pow(10, hiLog);
      this.min = lo;
      this.max = hi;
      this.tickSize = tickSize;
      this.step = null; // log uses power-of-10 ticks
      return true;
    }

    // choose a tick step that leaves >=34px between labels
    const targetPx = 34;
    const minStep = ((hi - lo) / Math.max(1, heightPx)) * targetPx;
    const step = niceStep(minStep, tickSize);
    // expand to whole multiples of step
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    this.min = lo;
    this.max = hi;
    this.tickSize = tickSize;
    this.step = step;
    return true;
  }

  y(price, top, height) {
    if (!isFinite(price) || price <= 0) return top + height;
    let h;
    if (this.log) {
      h = (Math.log10(price) - Math.log10(this.min)) / (Math.log10(this.max) - Math.log10(this.min));
    } else {
      h = (price - this.min) / (this.max - this.min);
    }
    return top + (1 - h) * height;
  }

  price(y, top, height) {
    const h = 1 - (y - top) / height;
    if (this.log) {
      return Math.pow(10, Math.log10(this.min) + h * (Math.log10(this.max) - Math.log10(this.min)));
    }
    return this.min + h * (this.max - this.min);
  }
}

/**
 * Smallest "nice" step >= minStep that is a whole multiple of tickSize.
 * Multiples of the tick matter: a 12.5 "tick" on a 0.05 tick-size instrument is
 * a label no order could ever be filled at.
 */
export function niceStep(minStep, tickSize) {
  const t = tickSize || 0.05;
  const raw = Math.max(minStep, t);
  const minMult = Math.ceil(raw / t);            // smallest whole multiple of the tick
  const nice = [1, 2, 3, 5, 10];
  for (let decade = 0; decade <= 14; decade++) {
    for (const n of nice) {
      const mult = n * Math.pow(10, decade);
      if (mult >= minMult) return mult * t;      // nice AND a tick multiple
    }
  }
  return minMult * t;
}

export function defaultPriceFormatter(price, tickSize = 0.05) {
  if (!isFinite(price)) return '';
  const decimals = decimalsFor(tickSize);
  return price.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function decimalsFor(tickSize) {
  if (!tickSize) return 2;
  const s = String(tickSize);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Indian short volume: 12.4k / 4.6L / 1.2Cr */
export function formatVolume(v) {
  if (!isFinite(v) || v <= 0) return '';
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export const COLORS = {
  bg: '#131722',
  grid: '#1e222d',
  gridBold: '#2a2e39',
  text: '#d1d4dc',
  textMuted: '#787b86',
  crosshair: '#758696',
  border: '#2a2e39',
  up: '#26a69a',
  down: '#ef5350',
  upWick: '#26a69a',
  downWick: '#ef5350',
  volumeUp: 'rgba(38,166,154,0.5)',
  volumeDown: 'rgba(239,83,80,0.5)',
  accent: '#2962ff',
  axisLabelBg: '#2a2e39',
  ema9: '#f7a600',
  ema20: '#2962ff',
  ema50: '#ff6d00',
  ema200: '#e91e63',
  vwap: '#ab47bc',
  bbUpper: 'rgba(120,123,134,0.7)',
  bbMid: 'rgba(120,123,134,0.9)',
  bbLower: 'rgba(120,123,134,0.7)',
  supertrendUp: '#26a69a',
  supertrendDown: '#ef5350',
  rsi: '#ab47bc',
  rsiOver: 'rgba(239,83,80,0.35)',
  rsiUnder: 'rgba(38,166,154,0.35)',
  macdLine: '#2962ff',
  macdSignal: '#f7a600',
  macdUp: 'rgba(38,166,154,0.6)',
  macdDown: 'rgba(239,83,80,0.6)',
  poc: '#f7a600',
  valueArea: 'rgba(247,166,0,0.12)',
  buy: '#26a69a',
  sell: '#ef5350',
  crosshairLabel: '#2a2e39',
};
