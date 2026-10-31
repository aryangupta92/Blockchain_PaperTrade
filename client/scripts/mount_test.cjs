'use strict';
/**
 * Mount the real React chart components in jsdom to capture runtime errors a
 * production build cannot surface (crash-on-mount, undefined handler, etc.).
 *
 * Modules are loaded through Vite's own transform pipeline (which handles JSX
 * and bare imports), then rendered into a jsdom DOM with a stubbed 2D context.
 * Run from the client/ directory.
 */
const path = require('path');
const clientDir = path.resolve(__dirname, '..');
const JSDOM = require(path.join('C:/Users/Lenovo/AppData/Local/Temp/opencode/domtest/node_modules/jsdom'));

const container = new (class {
  constructor() { this.window = null; }
})();

async function main() {
  const { createServer } = require(path.join(clientDir, 'node_modules', 'vite'));

  // ── jsdom DOM first, so globals exist before Vite/React load ──
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
  });
  container.window = dom.window;
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    return {
      setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
      beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop,
      closePath: noop, arc: noop, save: noop, restore: noop, setLineDash: noop,
      measureText: () => ({ width: 40 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      fillText: noop, strokeText: noop, scale: noop, translate: noop, rect: noop,
    };
  };
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.addEventListener('error', (e) => windowErrors.push(e.message || String(e.error)));

  const windowErrors = [];
  global.window = window;
  global.document = window.document;
  try { Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true }); } catch {}
  global.HTMLElement = window.HTMLElement;
  global.HTMLCanvasElement = window.HTMLCanvasElement;
  global.SVGElement = window.SVGElement;
  global.Element = window.Element;
  global.Node = window.Node;
  global.Event = window.Event;
  global.MouseEvent = window.MouseEvent;
  global.requestAnimationFrame = window.requestAnimationFrame;
  global.cancelAnimationFrame = window.cancelAnimationFrame;
  global.ResizeObserver = window.ResizeObserver;
  global.getComputedStyle = window.getComputedStyle;

  // ── Vite SSR server: transforms our JSX/ESM on import ──
  const vite = await createServer({
    root: clientDir,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  });

  const load = async (id) => vite.ssrLoadModule(id);
  const ChartView = await load('/src/chart/ChartView.jsx');
  const DhanToolbar = await load('/src/components/Chart/DhanToolbar.jsx');
  const AdvancedChart = await load('/src/components/Chart/AdvancedChart.jsx');

  const React = await load('react');
  const { createRoot } = await load('react-dom/client');

  let failures = 0;
  async function mountCase(name, Comp, props) {
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await new Promise((resolve) => {
        root.render(React.createElement(Comp, props));
        setTimeout(resolve, 350);
      });
      console.log(`   PASS  ${name}`);
    } catch (e) {
      failures++;
      console.log(`   FAIL  ${name} :: ${e.message}`);
    } finally {
      try { root.unmount(); } catch {}
      host.remove();
    }
  }

  console.log('\n=== Mounting chart components in jsdom ===\n');

  const bars = Array.from({ length: 200 }, (_, i) => ({
    time: 1760000000 + i * 300,
    open: 100 + Math.sin(i / 10) * 6,
    high: 100 + Math.sin(i / 10) * 6 + 3,
    low: 100 + Math.sin(i / 10) * 6 - 3,
    close: 100 + Math.sin(i / 10) * 6 + 1,
    volume: 100000 + i * 50,
  }));

  const CV = ChartView.default || ChartView;
  const TB = DhanToolbar.default || DhanToolbar;

  await mountCase('ChartView (candles + EMA/VWAP/RSI/MACD)', CV, {
    symbol: 'RELIANCE', timeframe: '5m', data: bars, chartType: 'candle',
    indicators: { ema20: true, vwap: true, rsi: true, macd: true }, showStats: true,
  });

  await mountCase('ChartView (line + active drawing tool + markers)', CV, {
    symbol: 'TCS', timeframe: '15m', data: bars, chartType: 'line',
    indicators: { ema9: true, bb: true, supertrend: true, volumeProfile: true },
    activeTool: 'TRENDLINE', magnet: true,
    drawings: [{ id: 'd1', type: 'HORIZONTAL', symbol: 'TCS', points: [{ time: bars[0].time, price: 100 }] }],
    markers: [{ time: bars[10].time, side: 'buy', price: 105, qty: 10 }],
    onNewDrawing: () => {}, onDeleteDrawing: () => {}, onToolDone: () => {},
  });

  await mountCase('ChartView (area chart)', CV, {
    symbol: 'INFY', timeframe: '1D', data: bars, chartType: 'area', indicators: {},
  });

  await mountCase('ChartView (empty data)', CV, {
    symbol: 'RELIANCE', timeframe: '5m', data: [], chartType: 'candle', indicators: {},
  });

  await mountCase('DhanToolbar', TB, {
    activeTool: null, onTool: () => {}, magnet: true, onMagnet: () => {},
    onClear: () => {}, onSave: () => {}, saveState: '0 drawings',
  });

  console.log(`\n${failures} mount failures, ${windowErrors.length} window errors`);
  if (windowErrors.length) console.log('   window errors:', windowErrors.slice(0, 8));

  await vite.close();
  process.exit(failures || windowErrors.length ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR', e && e.message); process.exit(1); });
