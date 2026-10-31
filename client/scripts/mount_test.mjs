/**
 * Mount the real React chart components in jsdom to capture runtime errors a
 * production build cannot surface (crash-on-mount, undefined handler, etc.).
 *
 * Modules load through Vite's SSR pipeline (handles JSX + bare imports), then
 * render into a jsdom DOM with a stubbed 2D canvas context.
 * Run: node client/scripts/mount_test.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '..');
const require = createRequire(path.join(clientDir, 'package.json'));
const jsdomMod = await import('file:///C:/Users/Lenovo/AppData/Local/Temp/opencode/domtest/node_modules/jsdom/lib/api.js');
const JSDOM = jsdomMod.JSDOM || jsdomMod.default || jsdomMod;

const windowErrors = [];

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function stub() {
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

globalThis.window = window;
globalThis.document = window.document;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch {}
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.SVGElement = window.SVGElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.ResizeObserver = window.ResizeObserver;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const { createServer } = await import(pathToFileURL(path.join(clientDir, 'node_modules/vite/dist/node/index.js')).href);
const vite = await createServer({
  root: clientDir,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  ssr: { external: ['react', 'react-dom', 'react-dom/client'] },
});

const ChartView = await vite.ssrLoadModule('/src/chart/ChartView.jsx');
const DhanToolbar = await vite.ssrLoadModule('/src/components/Chart/DhanToolbar.jsx');
const React = await vite.ssrLoadModule('react');
const ReactDOMClient = await vite.ssrLoadModule('react-dom/client');
const { createRoot } = ReactDOMClient;

let failures = 0;
async function mountCase(name, Comp, props) {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await new Promise((resolve) => {
      root.render(React.createElement(Comp, props));
      setTimeout(resolve, 400);
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

await mountCase('ChartView (line + drawing tool + markers)', CV, {
  symbol: 'TCS', timeframe: '15m', data: bars, chartType: 'line',
  indicators: { ema9: true, bb: true, supertrend: true, volumeProfile: true },
  activeTool: 'TRENDLINE', magnet: true,
  drawings: [{ id: 'd1', type: 'HORIZONTAL', symbol: 'TCS', points: [{ time: bars[0].time, price: 100 }] }],
  markers: [{ time: bars[10].time, side: 'buy', price: 105, qty: 10 }],
  onNewDrawing: () => {}, onDeleteDrawing: () => {}, onToolDone: () => {},
});

await mountCase('ChartView (area chart, no indicators)', CV, {
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
