'use strict';
/* Unit tests for the chart engine's pure modules (no DOM/canvas needed).
   Verifies indicator math against known-good values and SeriesStore behaviour. */

const assert = require('assert');

// ESM imports in CJS Node: use dynamic import
(async () => {
  const { SeriesStore, aggregateBars } = await import('../../client/src/chart/seriesStore.js');
  const { sma, ema, rsi, macd, bollinger, atr, supertrend, volumeProfile, vwap, clamp } = await import('../../client/src/chart/indicators.js');
  const { niceStep, defaultPriceFormatter, formatVolume, istDayKey, isSessionTime, PriceScale, formatISTTime } = await import('../../client/src/chart/scales.js');

  let pass = 0, fail = 0;
  const t = (name, fn) => {
    try { fn(); pass++; console.log(`   PASS  ${name}`); }
    catch (e) { fail++; console.log(`   FAIL  ${name} :: ${e.message}`); }
  };

  console.log('\n=== SeriesStore ===');
  t('push appends and extends', () => {
    const s = new SeriesStore();
    s.push({ time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    s.push({ time: 200, open: 1.5, high: 2.5, low: 1, close: 2, volume: 20 });
    assert.strictEqual(s.length, 2);
    assert.strictEqual(s.at(1).close, 2);
    assert.strictEqual(s.at(1).volume, 20);
  });
  t('same-time push updates in place', () => {
    const s = new SeriesStore();
    s.push({ time: 100, open: 10, high: 11, low: 9, close: 10.5, volume: 100 });
    s.push({ time: 100, open: 10, high: 12, low: 8, close: 10.2, volume: 140 });
    assert.strictEqual(s.length, 1, 'length must not grow');
    assert.strictEqual(s.at(0).high, 12, 'high widens');
    assert.strictEqual(s.at(0).low, 8, 'low widens');
    assert.strictEqual(s.at(0).close, 10.2, 'close replaces');
    assert.strictEqual(s.at(0).volume, 140);
  });
  t('out-of-order bars are ignored', () => {
    const s = new SeriesStore();
    s.push({ time: 200, open: 1, high: 1, low: 1, close: 1 });
    s.push({ time: 100, open: 1, high: 1, low: 1, close: 1 });
    assert.strictEqual(s.length, 1);
  });
  t('grows past initial capacity', () => {
    const s = new SeriesStore(8);
    for (let i = 0; i < 1000; i++) {
      s.push({ time: i * 60, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: i });
    }
    assert.strictEqual(s.length, 1000);
    assert.strictEqual(s.at(999).close, 999.5);
    assert.ok(s.stats().cap >= 1000);
  });
  t('indexOfTime binary search', () => {
    const s = new SeriesStore();
    for (let i = 0; i < 50; i++) s.push({ time: i * 1000, open: 1, high: 1, low: 1, close: 1 });
    assert.strictEqual(s.indexOfTime(0), 0);
    assert.strictEqual(s.indexOfTime(19500), 19);
    assert.strictEqual(s.indexOfTime(49000), 49);
    assert.strictEqual(s.indexOfTime(999999), 49);
  });
  t('priceExtent over the visible slice', () => {
    const s = new SeriesStore();
    s.push({ time: 1, open: 10, high: 20, low: 5, close: 15 });
    s.push({ time: 2, open: 15, high: 30, low: 10, close: 25 });
    const e = s.priceExtent(0, 2);
    assert.strictEqual(e.min, 5);
    assert.strictEqual(e.max, 30);
    const e2 = s.priceExtent(1, 1);
    assert.strictEqual(e2.min, 10);
    assert.strictEqual(e2.max, 30);
  });
  t('aggregateBars combines buckets', () => {
    const bars = [
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 60, open: 11, high: 13, low: 10, close: 12, volume: 50 },
      { time: 120, open: 12, high: 14, low: 11, close: 13, volume: 25 },
    ];
    const out = aggregateBars(bars, 120);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].open, 10, 'open from first bar');
    assert.strictEqual(out[0].close, 12, 'close from last bar in bucket');
    assert.strictEqual(out[0].high, 13, 'max high');
    assert.strictEqual(out[0].low, 9, 'min low');
    assert.strictEqual(out[0].volume, 150, 'volume summed');
  });

  console.log('\n=== Indicators ===');
  t('sma matches a hand calculation', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0].value, 2);
    assert.strictEqual(out[1].value, 3);
    assert.strictEqual(out[2].value, 4);
  });
  t('ema converges to the series level', () => {
    const out = ema([10, 10, 10, 10, 10, 10, 10, 10], 4);
    assert.ok(Math.abs(out[out.length - 1].value - 10) < 1e-9);
  });
  t('ema seeds from an SMA of the first period', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    assert.strictEqual(out[0].value, 2, 'seed = mean(1,2,3)');
    // 4 * 0.5 + 2 * 0.5 = 3
    assert.strictEqual(out[1].value, 3);
  });
  t('rsi is 100 on a monotonic rise', () => {
    const out = rsi(Array.from({ length: 40 }, (_, i) => 100 + i), 14);
    assert.strictEqual(out[out.length - 1].value, 100);
  });
  t('rsi is 0 on a monotonic fall', () => {
    const out = rsi(Array.from({ length: 40 }, (_, i) => 100 - i), 14);
    assert.strictEqual(out[out.length - 1].value, 0);
  });
  t('rsi stays in range on mixed data', () => {
    const vals = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 7) * 10);
    for (const p of rsi(vals, 14)) {
      assert.ok(p.value >= 0 && p.value <= 100, `out of range: ${p.value}`);
    }
  });
  t('macd hist = line - signal', () => {
    const vals = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 9) * 5 + i * 0.1);
    const m = macd(vals, 12, 26, 9);
    assert.ok(m.line.length > 0 && m.signal.length > 0 && m.hist.length > 0);
    const sigMap = new Map(m.signal.map((p) => [p.time, p.value]));
    m.hist.forEach((h) => {
      const line = m.line.find((p) => p.time === h.time);
      const sig = sigMap.get(h.time);
      assert.ok(Math.abs(line.value - sig - h.value) < 1e-9, 'histogram must equal line minus signal');
    });
  });
  t('bollinger bounds contain the mean', () => {
    const vals = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 3);
    const bb = bollinger(vals, 20, 2);
    bb.forEach((p) => {
      assert.ok(p.upper > p.mean && p.mean > p.lower);
      assert.ok(Math.abs(p.upper - p.mean - (p.mean - p.lower)) < 1e-9, 'bands must be symmetric');
    });
  });
  t('atr is positive', () => {
    const highs = Array.from({ length: 40 }, (_, i) => 105 + Math.sin(i) * 2);
    const lows = Array.from({ length: 40 }, (_, i) => 95 + Math.sin(i) * 2);
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 2);
    for (const p of atr(highs, lows, closes, 14)) assert.ok(p.value > 0);
  });
  t('supertrend flips direction on a trend change', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i * 1.0);   // 100 -> 159
    const down = Array.from({ length: 60 }, (_, i) => 159 - i * 1.0); // 159 -> 100
    const closes = [...up, ...down];
    const highs = closes.map((v) => v + 1.5);
    const lows = closes.map((v) => v - 1.5);
    const st = supertrend(highs, lows, closes, 7, 2);
    const dirs = st.map((p) => p.direction);
    assert.ok(dirs.includes(1), 'has an up leg');
    assert.ok(dirs.includes(-1), 'has a down leg');
    // the flip must happen near the reversal (index 60), not at the very start
    const firstDown = dirs.indexOf(-1);
    assert.ok(firstDown >= 40, `down leg should start after the peak, got index ${firstDown}`);
  });
  t('volumeProfile: POC sits inside the value area', () => {
    const s = new SeriesStore();
    for (let i = 0; i < 100; i++) {
      const base = 100 + Math.sin(i / 5) * 2;
      s.push({ time: i * 60, open: base, high: base + 1, low: base - 1, close: base, volume: 1000 + i });
    }
    const vp = volumeProfile(s, 0, 100);
    assert.ok(vp, 'returns a profile');
    assert.ok(vp.val <= vp.poc && vp.poc <= vp.vah, 'POC must lie within the value area');
    assert.ok(vp.rows > 0);
    assert.ok(vp.totalVolume > 0);
  });
  t('vwap of constant prices is that constant', () => {
    const s = new SeriesStore();
    for (let i = 0; i < 10; i++) s.push({ time: i * 60, open: 50, high: 50, low: 50, close: 50, volume: 10 });
    const v = vwap(s, 0, 10);
    v.forEach((p) => assert.ok(Math.abs(p.value - 50) < 1e-9));
  });
  t('clamp bounds its input', () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(-5, 0, 10), 0);
    assert.strictEqual(clamp(50, 0, 10), 10);
  });

  console.log('\n=== Scales ===');
  t('niceStep respects NSE tick size', () => {
    const s = niceStep(0.03, 0.05);
    assert.strictEqual(s, 0.05);
    assert.strictEqual(niceStep(0.07, 0.05), 0.1);
    assert.strictEqual(niceStep(12, 5), 15);
  });
  t('price formatting uses INR decimals', () => {
    assert.strictEqual(defaultPriceFormatter(1234.5, 0.05), '1,234.50');
    assert.strictEqual(defaultPriceFormatter(100, 0.05), '100.00');
  });
  t('volume formatting uses Indian units', () => {
    assert.strictEqual(formatVolume(1500), '1.5k');
    assert.strictEqual(formatVolume(250000), '2.50L');
    assert.strictEqual(formatVolume(15000000), '1.50Cr');
  });
  t('IST session detection', () => {
    // 2026-10-12 is a Monday. 10:00 IST = 04:30 UTC
    const mondayOpen = Math.floor(Date.UTC(2026, 9, 12, 4, 30) / 1000);
    assert.strictEqual(isSessionTime(mondayOpen), true, 'Monday 10:00 IST is open');
    const mondayNight = Math.floor(Date.UTC(2026, 9, 12, 20, 0) / 1000);
    assert.strictEqual(isSessionTime(mondayNight), false, 'Monday night IST is closed');
    const saturday = Math.floor(Date.UTC(2026, 9, 10, 5, 0) / 1000);
    assert.strictEqual(isSessionTime(saturday), false, 'Saturday is closed');
  });
  t('istDayKey buckets by IST calendar day', () => {
    // 2026-10-10 20:00 UTC is already 2026-10-11 01:30 IST
    const a = Math.floor(Date.UTC(2026, 9, 10, 20, 0) / 1000);
    assert.strictEqual(istDayKey(a), 20261011, 'must roll to the next IST day');
  });
  t('IST time label format', () => {
    const t = Math.floor(Date.UTC(2026, 9, 12, 4, 5) / 1000); // 09:35 IST
    assert.strictEqual(formatISTTime(t, true), '09:35');
  });
  t('PriceScale maps price <-> y and back', () => {
    const ps = new PriceScale();
    ps.autoscale(100, 110, 0.05, 0.1, 300);
    const y = ps.y(105, 0, 300);
    const back = ps.price(y, 0, 300);
    assert.ok(Math.abs(back - 105) < 1e-6, `round trip failed: ${back}`);
  });
  t('PriceScale rejects degenerate ranges', () => {
    const ps = new PriceScale();
    assert.strictEqual(ps.autoscale(5, 5, 0.05), false);
    assert.strictEqual(ps.autoscale(NaN, 10, 0.05), false);
  });
  t('PriceScale advances upward', () => {
    const ps = new PriceScale();
    ps.autoscale(100, 110, 0.05, 0.1, 300);
    const yLow = ps.y(100, 0, 300);
    const yHigh = ps.y(110, 0, 300);
    assert.ok(yLow > yHigh, 'higher price must be smaller y');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
