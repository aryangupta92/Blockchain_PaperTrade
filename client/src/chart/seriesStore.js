/**
 * chart/seriesStore.js
 * ---------------------------------------------------------------------------
 * Columnar OHLCV storage built on typed arrays.
 *
 * Why not [{time,o,h,l,c,v}]:
 *   - 200k objects = 200k allocations, GC pressure on every frame
 *   - objects are scattered in memory, so panning over the visible slice is
 *     cache-hostile
 *   - live ticks mutate the newest bar; with objects the optimizer deopts
 *
 * Columnar Float64Array keeps one series contiguous; a live tick is a single
 * element write. The store grows by doubling so a 5-year daily backfill does
 * not reallocate on every append.
 */

const MIN_CAP = 1024;

export class SeriesStore {
  constructor(initialCapacity = 4096) {
    this.cap = Math.max(MIN_CAP, initialCapacity);
    this.len = 0;
    this._alloc();
  }

  _alloc() {
    const c = this.cap;
    this.time = new Float64Array(c);
    this.open = new Float64Array(c);
    this.high = new Float64Array(c);
    this.low = new Float64Array(c);
    this.close = new Float64Array(c);
    this.volume = new Float64Array(c);
    this.oi = new Float64Array(c);
    this.oiHas = new Uint8Array(c); // 1 when oi is meaningful
  }

  /** Grow by doubling and copy. Amortised O(1) per append. */
  _grow() {
    const old = this.cap;
    const nc = old * 2;
    const copy = (src, hasOi) => {
      const d = hasOi ? new Float64Array(nc) : new Uint8Array(nc);
      d.set(src.subarray(0, this.len));
      return d;
    };
    const t = new Float64Array(nc); t.set(this.time.subarray(0, this.len));
    const o = new Float64Array(nc); o.set(this.open.subarray(0, this.len));
    const h = new Float64Array(nc); h.set(this.high.subarray(0, this.len));
    const l = new Float64Array(nc); l.set(this.low.subarray(0, this.len));
    const c2 = new Float64Array(nc); c2.set(this.close.subarray(0, this.len));
    const v = new Float64Array(nc); v.set(this.volume.subarray(0, this.len));
    const oi = new Float64Array(nc); oi.set(this.oi.subarray(0, this.len));
    const oiHas = new Uint8Array(nc); oiHas.set(this.oiHas.subarray(0, this.len));
    this.time = t; this.open = o; this.high = h; this.low = l;
    this.close = c2; this.volume = v; this.oi = oi; this.oiHas = oiHas;
    this.cap = nc; void old;
  }

  /**
   * appendTick - updates the last candle with a new price tick, or creates a
   * new candle when the timeframe boundary is crossed.
   * @returns {boolean} true when a new bar was appended.
   */
  appendTick(price, volume = 0, ts, timeframe = '5m') {
    if (!Number.isFinite(price)) return false;
    const barSeconds = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
                         '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800 }[timeframe] || 300;
    const tickTs = Number.isFinite(ts) ? Math.floor(ts) : Math.floor(Date.now() / 1000);

    if (this.len === 0) {
      if (this.len === this.cap) this._grow();
      const i = this.len++;
      const barStart = Math.floor(tickTs / barSeconds) * barSeconds;
      this.time[i] = barStart;
      this.open[i] = price; this.high[i] = price; this.low[i] = price; this.close[i] = price;
      this.volume[i] = volume || 0;
      this.dirty = true;
      return true;
    }

    const last = this.len - 1;
    const lastBarStart = Math.floor(this.time[last] / barSeconds) * barSeconds;
    const thisBarStart = Math.floor(tickTs / barSeconds) * barSeconds;

    if (thisBarStart > lastBarStart) {
      if (this.len === this.cap) this._grow();
      const i = this.len++;
      this.time[i] = thisBarStart;
      this.open[i] = price; this.high[i] = price; this.low[i] = price; this.close[i] = price;
      this.volume[i] = volume || 0;
      this.dirty = true;
      return true;
    }

    // update existing last candle
    this.close[last] = price;
    if (price > this.high[last]) this.high[last] = price;
    if (price < this.low[last]) this.low[last] = price;
    this.volume[last] += volume || 0;
    this.dirty = true;
    return false;
  }

  /** Whether derived caches should recompute (set by appendTick). */
  get dirtyFlag() { return this.dirty; }

  at(i) {
    if (i < 0 || i >= this.len) return null;
    return {
      time: this.time[i],
      open: this.open[i],
      high: this.high[i],
      low: this.low[i],
      close: this.close[i],
      volume: this.volume[i],
      oi: this.oiHas[i] ? this.oi[i] : null,
    };
  }

  last() { return this.at(this.len - 1); }

  /**
   * Append or update the newest bar. Exchange data always arrives newest-last,
   * so a tick either extends the bucket in place (same time) or opens a new one.
   */
  push(bar, replaceIfSameTime = true) {
    if (this.len === 0 || this.time[this.len - 1] < bar.time) {
      if (this.len === this.cap) this._grow();
      const i = this.len++;
      this.time[i] = bar.time;
      this.open[i] = bar.open;
      this.high[i] = bar.high;
      this.low[i] = bar.low;
      this.close[i] = bar.close;
      this.volume[i] = bar.volume || 0;
      if (bar.oi != null) { this.oi[i] = bar.oi; this.oiHas[i] = 1; }
      return i;
    }
    if (replaceIfSameTime && this.time[this.len - 1] === bar.time) {
      const i = this.len - 1;
      // update-in-place semantics: high/low widen, close replaces
      this.high[i] = Math.max(this.high[i], bar.high);
      this.low[i] = Math.min(this.low[i], bar.low);
      this.close[i] = bar.close;
      this.volume[i] = bar.volume || this.volume[i];
      if (bar.oi != null) { this.oi[i] = bar.oi; this.oiHas[i] = 1; }
      return i;
    }
    // out-of-order bar: ignore (history is loaded oldest->newest)
    return -1;
  }

  /** Bulk load. Sorts by time only when necessary. */
  load(bars, sort = true) {
    if (!bars || !bars.length) return;
    if (sort) {
      let ordered = true;
      for (let i = 1; i < bars.length; i++) { if (bars[i].time < bars[i - 1].time) { ordered = false; break; } }
      if (!ordered) bars = [...bars].sort((a, b) => a.time - b.time);
    }
    for (let i = 0; i < bars.length; i++) this.push(bars[i], false);
  }

  /** Index of the last bar with time <= t, or -1. Binary search. */
  indexOfTime(t) {
    let lo = 0, hi = this.len - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.time[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /** Visible price extent. Returns null when empty. */
  priceExtent(from, count) {
    if (this.len === 0) return null;
    const lo = Math.max(0, from);
    const hi = Math.min(this.len, from + count);
    if (hi <= lo) return null;
    let mn = Infinity, mx = -Infinity;
    for (let i = lo; i < hi; i++) {
      if (this.high[i] > mx) mx = this.high[i];
      if (this.low[i] < mn) mn = this.low[i];
    }
    return { min: mn, max: mx };
  }

  /** Max volume in the visible slice. */
  maxVolume(from, count) {
    const lo = Math.max(0, from);
    const hi = Math.min(this.len, from + count);
    let m = 0;
    for (let i = lo; i < hi; i++) if (this.volume[i] > m) m = this.volume[i];
    return m;
  }

  clear() { this.len = 0; }

  /** Snapshot for debugging. */
  stats() {
    return { len: this.len, cap: this.cap };
  }
}

/**
 * Aggregate smaller bars into larger buckets (e.g. 1m -> 5m).
 * Returns plain bars so it can be fed into another SeriesStore.
 */
export function aggregateBars(bars, bucketSec) {
  if (!bars?.length || !bucketSec) return bars || [];
  const out = [];
  let cur = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const bucket = Math.floor(b.time / bucketSec) * bucketSec;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, oi: b.oi ?? null };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
      if (b.oi != null) cur.oi = b.oi;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Decimate to at most one OHLCV bucket per horizontal pixel column.
 * This is what keeps panning at 60fps when the viewport shows 200k bars.
 */
export function decimateToPixels(store, from, count, maxPoints) {
  const n = Math.min(count, store.len - from);
  if (n <= 0) return null;
  if (n <= maxPoints || maxPoints <= 1) {
    return { from, count: n, buckets: 1 };
  }
  const buckets = maxPoints;
  const per = Math.ceil(n / buckets);
  const out = {
    from,
    count: n,
    buckets: Math.ceil(n / per),
    per,
    // views read from the store directly using this stride
    stride: per,
  };
  return out;
}
