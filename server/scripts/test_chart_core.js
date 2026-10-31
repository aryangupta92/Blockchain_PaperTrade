'use strict';
/* Smoke test for ChartCore's transform + interaction math using a minimal DOM
   mock. Validates x/y round-trips, zoom-to-cursor anchoring, and the visible
   range - the parts that cannot be eyeballed. */

const assert = require('assert');

const listeners = {};
class FakeCanvas {
  constructor() {
    this.width = 0; this.height = 0; this.style = {};
    this.readyState = 1;
    const noop = () => {};
    this.getContext = () => ({
      setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
      beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop,
      closePath: noop, arc: noop, save: noop, restore: noop, setLineDash: noop,
      measureText: () => ({ width: 40 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      fillText: noop, strokeText: noop,
    });
  }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  appendChild() {}
  remove() {}
}

const rafQueue = [];
global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
global.cancelAnimationFrame = () => {};
global.window = {
  devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
};
global.document = { createElement: () => new FakeCanvas() };
global.ResizeObserver = class { observe() {} disconnect() {} };
global.Window = function () {};

let ChartCore;
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`   PASS  ${name}`); }
  catch (e) { fail++; console.log(`   FAIL  ${name} :: ${e.message}`); }
};

(async () => {
  ({ ChartCore } = await import('../../client/src/chart/ChartCore.js').catch(async () => {
    // ESM default export shim
    const mod = await import('../../client/src/chart/ChartCore.js');
    return { ChartCore: mod.default };
  }));

  function makeCore(bars, width = 1000, height = 600) {
    const host = new FakeCanvas();
    host.width = width; host.height = height;
    const core = new ChartCore(host, { symbol: 'TEST', timeframe: '5m', tickSize: 0.05 });
    core.setData(bars);
    return core;
  }

  const bars = Array.from({ length: 400 }, (_, i) => ({
    time: 1760000000 + i * 300,
    open: 100 + Math.sin(i / 12) * 8,
    high: 100 + Math.sin(i / 12) * 8 + 3,
    low: 100 + Math.sin(i / 12) * 8 - 3,
    close: 100 + Math.sin(i / 12) * 8 + 1,
    volume: 100000 + i * 100,
  }));

  console.log('\n=== ChartCore transforms ===');

  t('instantiates and renders a frame without throwing', () => {
    const core = makeCore(bars);
    core.resize();
    core.invalidate();
    const cb = rafQueue.pop();
    if (cb) cb();
    assert.ok(core.store.len === 400);
    core.destroy();
  });

  t('x increases with index (older bars to the left)', () => {
    const core = makeCore(bars);
    core.barSpacing = 6;
    core.rightIndex = 399;
    const xs = [390, 395, 399].map((i) => core._xOf(i, 1000 - 72, 0));
    assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `expected increasing left-to-right: ${xs}`);
    core.destroy();
  });

  t('newest bar sits at the right edge', () => {
    const core = makeCore(bars);
    core.barSpacing = 6;
    core.rightIndex = 399;
    const last = core._xOf(399, 1000 - 72, 0);
    assert.ok(Math.abs(last - (1000 - 72)) < 6, `newest bar should be near the right edge, got ${last}`);
    core.destroy();
  });

  t('visibleRange covers only what the viewport can show', () => {
    const core = makeCore(bars);
    core.width = 1000; core.height = 600;
    core.barSpacing = 6;
    core.rightIndex = 399;
    const r = core.visibleRange();
    const maxVisible = Math.floor((1000 - 72) / 6) + 2;
    assert.ok(r.to - r.from <= maxVisible, `range ${r.to - r.from} exceeds maxVisible ${maxVisible}`);
    assert.strictEqual(r.to, 400, 'right edge is the newest bar');
    core.destroy();
  });

  t('pixelToData returns a real bar time', () => {
    const core = makeCore(bars);
    core.barSpacing = 6;
    core.rightIndex = 399;
    const d = core.pixelToData(500, 300, false);
    assert.ok(d, 'must return a point');
    assert.ok(bars.some((b) => b.time === d.time), 'time must be a real bar time');
    core.destroy();
  });

  t('magnet snaps the price to a real OHLC level', () => {
    const core = makeCore(bars);
    core.barSpacing = 6;
    core.rightIndex = 399;
    const free = core.pixelToData(500, 300, false);
    const snapped = core.pixelToData(500, 300, true);
    const idx = core.store.indexOfTime(snapped.time);
    const levels = [core.store.open[idx], core.store.high[idx], core.store.low[idx], core.store.close[idx]];
    // prices are rounded to 2dp by pixelToData, so allow the tick tolerance
    assert.ok(levels.some((l) => Math.abs(l - snapped.price) < 0.005), `magneted ${snapped.price} not in ${levels}`);
    assert.notStrictEqual(free.price, snapped.price);
    core.destroy();
  });

  t('zoom keeps the bar under the cursor anchored', () => {
    const core = makeCore(bars);
    core.width = 1000; core.height = 600;
    core.barSpacing = 6;
    core.rightIndex = 399;
    const idxBefore = core.pixelToData(400, 300, false).index;
    core._onWheel({ deltaY: -100, clientX: 400, clientY: 300, preventDefault() {} }); // zoom in
    const idxAfter = core.pixelToData(400, 300, false).index;
    assert.ok(Math.abs(idxAfter - idxBefore) <= 1, `anchor drifted from bar ${idxBefore} to ${idxAfter}`);
    assert.ok(core.barSpacing > 6, 'scrolling up must zoom in');
    core.destroy();
  });

  t('zoom respects spacing limits in both directions', () => {
    const core = makeCore(bars);
    core.barSpacing = 6;
    for (let i = 0; i < 30; i++) core._onWheel({ deltaY: 100, clientX: 500, clientY: 300, preventDefault() {} });
    assert.ok(core.barSpacing >= 1.19 && core.barSpacing < 6, `zoom out failed: ${core.barSpacing}`);
    for (let i = 0; i < 30; i++) core._onWheel({ deltaY: -100, clientX: 500, clientY: 300, preventDefault() {} });
    assert.ok(core.barSpacing <= 90.01 && core.barSpacing > 6, `zoom in failed: ${core.barSpacing}`);
    core.destroy();
  });

  t('price/y round-trips through the transform', () => {
    const core = makeCore(bars);
    core.autoscale();
    const ps = core.priceScale;
    const h = core.plotHeight();
    const y = ps.y(110, 0, h);
    const back = ps.price(y, 0, h);
    assert.ok(Math.abs(back - 110) < 1e-6, `round trip: ${back}`);
    core.destroy();
  });

  t('autoscale includes every bar high and low', () => {
    const core = makeCore(bars);
    core.autoscale();
    const r = core.visibleRange();
    const ext = core.store.priceExtent(r.from, r.to - r.from);
    const ps = core.priceScale;
    assert.ok(ps.min <= ext.min, `scale min ${ps.min} above data min ${ext.min}`);
    assert.ok(ps.max >= ext.max, `scale max ${ps.max} below data max ${ext.max}`);
    core.destroy();
  });

  t('live tick updates the newest bar in place', () => {
    const core = makeCore(bars);
    const before = core.store.len;
    const lastBefore = core.store.last().close;
    const lastTime = core.store.last().time;
    core.appendOrUpdate({ time: lastTime, open: core.store.last().open, high: core.store.last().high, low: core.store.last().low, close: lastBefore + 5, volume: core.store.last().volume });
    assert.strictEqual(core.store.len, before, 'no new bar for a same-time tick');
    core.appendOrUpdate({ time: lastTime + 300, open: lastBefore + 5, high: lastBefore + 6, low: lastBefore + 4, close: lastBefore + 5, volume: 1 });
    assert.strictEqual(core.store.len, before + 1, 'a new time opens a new bar');
    assert.strictEqual(core.store.last().close, lastBefore + 5);
    core.destroy();
  });

  t('switch series clears derived cache', () => {
    const core = makeCore(bars);
    core._derived();
    const k1 = core._cacheKey;
    core.setData(bars.slice(0, 50));
    core._derived();
    assert.notStrictEqual(core._cacheKey, k1, 'cache key must change with the data');
    core.destroy();
  });

  t('stats reports a frame time', () => {
    const core = makeCore(bars);
    core.invalidate();
    const cb = rafQueue.pop();
    if (cb) cb();
    const s = core.stats();
    assert.ok(s.frames >= 1 && typeof s.lastFrameMs === 'number');
    assert.ok(s.bars === 400);
    core.destroy();
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
