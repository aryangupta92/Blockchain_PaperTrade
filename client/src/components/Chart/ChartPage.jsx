import { useEffect, useRef, useState, useCallback } from 'react';
import './ChartPage.css';
import api from '../../services/api';
import { X, Maximize2, TrendingUp, Info, ChevronRight, ShoppingCart, Target, Minus } from 'lucide-react';
import OptionChainPage from '../OptionChain/OptionChainPage';

const TIMEFRAMES = ['1m','3m','5m','15m','30m','1h','4h','1D','1W'];
const TF_TO_API = { '1m':'1m','3m':'2m','5m':'5m','15m':'15m','30m':'30m','1h':'60m','4h':'90m','1D':'1d','1W':'1wk' };
// Maximise historical depth: intraday limited by Yahoo (7d for 1m; 60d for 15/30m; 2y for 1h/4h)
// Daily and weekly use 'max' to retrieve all available years of data
const TF_TO_RANGE = { '1m':'7d','3m':'7d','5m':'7d','15m':'60d','30m':'60d','1h':'2y','4h':'2y','1D':'max','1W':'max' };

// IST offset in seconds (+5:30 = 19800 s)
const IST_OFFSET_S = 5.5 * 3600;

/**
 * Format a Unix timestamp (seconds) as an IST string.
 * isIntraday=true  →  "HH:MM"   (used for sub-daily chart timeframes)
 * isIntraday=false →  "DD MMM" (used for daily/weekly charts)
 */
function fmtTimeIST(unixSec, isIntraday) {
  const d = new Date((unixSec + IST_OFFSET_S) * 1000);
  if (isIntraday) {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/** Format current wall clock time in IST using Intl */
function getISTClock() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date()) + ' UTC+5:30';
}

const DRAWING_TOOLS = [
  { id: 'cursor', label: 'Cursor', icon: '✛' },
  { id: 'crosshair', label: 'Crosshair', icon: '⊕' },
  { id: 'line', label: 'Trend Line', icon: '╱' },
  { id: 'hline', label: 'Horizontal Line', icon: '─' },
  { id: 'vline', label: 'Vertical Line', icon: '│' },
  { id: 'ray', label: 'Ray', icon: '↗' },
  { id: 'rect', label: 'Rectangle', icon: '▭' },
  { id: 'fibr', label: 'Fib Retracement', icon: '≋' },
  { id: 'text', label: 'Text', icon: 'T' },
  { id: 'measure', label: 'Measure', icon: '⟺' },
  { id: 'eraser', label: 'Eraser', icon: '⌫' },
];

function fmtPrice(n) { return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—'; }

export default function ChartPage({ symbol, symbolData, onClose, onTrade, holdings, balance, subscription, watchlist, onAddWatch, onRemWatch }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const orderLinesRef = useRef([]);

  const [timeframe, setTimeframe] = useState('5m');
  const [chartType, setChartType] = useState('candle'); // 'candle' | 'line'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [quote, setQuote] = useState(symbolData || null);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'option-chain' | 'technicals'
  const [activeTool, setActiveTool] = useState('cursor');
  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [orderQty, setOrderQty] = useState(1);
  const [orderType, setOrderType] = useState('market');
  const [orderPrice, setOrderPrice] = useState('');
  const [tradeResult, setTradeResult] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(symbolData?.price || 0);
  const [priceZoom, setPriceZoom] = useState(1.0);
  const [activeOrders, setActiveOrders] = useState([]); // orders placed ON the chart

  const isIndex = symbol?.startsWith('^');
  const lotSize = symbol?.includes('NSEBANK') ? 15 : (isIndex ? 75 : 1);
  const held = holdings?.[symbol]?.quantity || 0;
  const avgBuy = holdings?.[symbol]?.avgPrice || 0;
  const unrealizedPL = held > 0 ? (currentPrice - avgBuy) * held : 0;
  
  const isWatched = watchlist?.includes(symbol);

  // ── Load chart data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tf = TF_TO_API[timeframe] || '5m';
      const range = TF_TO_RANGE[timeframe] || '1d';
      const bars = await api.getCandles(symbol, range, tf);
      setData(bars);
      if (bars.length > 0) {
        const last = bars[bars.length - 1];
        setCurrentPrice(last.close);
      }
    } catch (err) { console.error('Chart load error:', err); }
    finally { setLoading(false); }
  }, [symbol, timeframe]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Initialize TradingView Lightweight Chart ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    let chart = null, destroyed = false;

    const init = async () => {
      try {
        const { createChart } = await import('lightweight-charts');
        if (destroyed || !containerRef.current) return;

        // Destroy old chart
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

        // Determine if this timeframe shows intraday (sub-daily) data
        const tfIsIntraday = !['1D','1W'].includes(timeframe);

        chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          layout: { background: { color: '#0d1117' }, textColor: '#64748b' },
          grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
          crosshair: { mode: 1, vertLine: { color: '#6366f130', width: 1, style: 0 }, horzLine: { color: '#6366f130', width: 1, style: 0 } },
          rightPriceScale: { borderColor: '#21262d', minimumWidth: 65 },
          timeScale: {
            borderColor: '#21262d',
            timeVisible: true,
            secondsVisible: false,
            // Render x-axis tick labels in IST so market open (09:15) shows correctly
            tickMarkFormatter: (time) => fmtTimeIST(time, tfIsIntraday),
          },
          localization: {
            // Format crosshair time tooltip in IST as well
            timeFormatter: (time) => fmtTimeIST(time, tfIsIntraday),
          },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });

        if (destroyed) { chart.remove(); return; }
        chartRef.current = chart;

        // Series based on chart type
        let mainSeries;
        if (chartType === 'candle') {
          mainSeries = chart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350',
            borderUpColor: '#26a69a', borderDownColor: '#ef5350',
            wickUpColor: '#26a69a', wickDownColor: '#ef5350',
          });
        } else {
          mainSeries = chart.addLineSeries({
            color: '#6366f1', lineWidth: 2, crosshairMarkerVisible: true,
          });
        }

        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol',
          color: '#26a69a30',
        });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

        if (chartType === 'candle') {
          mainSeries.setData(data);
        } else {
          mainSeries.setData(data.map(d => ({ time: d.time, value: d.close })));
        }
        volumeSeries.setData(data.map(d => ({ time: d.time, value: d.volume, color: d.close >= d.open ? '#26a69a30' : '#ef535030' })));
        chart.timeScale().fitContent();

        candleSeriesRef.current = mainSeries;
        volumeSeriesRef.current = volumeSeries;

        // ── Real-time price crosshair update ────────────────────────────────
        chart.subscribeCrosshairMove(param => {
          if (param.time && candleSeriesRef.current) {
            const p = param.seriesData.get(candleSeriesRef.current);
            if (p) setCurrentPrice(chartType === 'candle' ? p.close : p.value);
          }
        });

        // ── Custom wheel: detect chart area vs price scale ──────────────────
        const handleWheel = (e) => {
          if (!containerRef.current) return;
          const bounds = containerRef.current.getBoundingClientRect();
          const priceScaleW = 70;
          const isOnPriceScale = e.clientX > bounds.right - priceScaleW;

          if (isOnPriceScale) {
            // Zoom Y axis (price scale)
            e.preventDefault();
            e.stopPropagation();
            setPriceZoom(prev => {
              const next = prev * (e.deltaY > 0 ? 1.12 : 0.88);
              const clamped = Math.max(0.1, Math.min(8, next));
              const top = Math.min(0.4, 0.05 * clamped);
              const bot = Math.min(0.4, 0.05 * clamped);
              chart.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top, bottom: bot } });
              return clamped;
            });
          }
          // else: let lightweight-charts handle natural X-axis zoom
        };

        containerRef.current.addEventListener('wheel', handleWheel, { passive: false, capture: true });

        // ── Click on chart to place order line ────────────────────────────
        chart.subscribeClick(param => {
          if (activeTool === 'cursor' && param.point && candleSeriesRef.current) {
            const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
            if (price && price > 0) {
              const line = candleSeriesRef.current.createPriceLine({
                price,
                color: '#6366f1',
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: `🎯 ${fmtPrice(price)}`,
              });
              setActiveOrders(prev => [...prev, { price, line, qty: 1, type: 'limit', side: 'buy' }]);
            }
          }
        });

        // ── ResizeObserver ────────────────────────────────────────────────
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight,
            });
          }
        });
        ro.observe(containerRef.current);
        chartRef.current._ro = ro;
        chartRef.current._wheelHandler = handleWheel;

      } catch (err) { console.error('ChartPage init error:', err); }
    };

    init();
    return () => {
      destroyed = true;
      // Disconnect ResizeObserver first so no more paint callbacks fire
      if (chartRef.current?._ro) {
        chartRef.current._ro.disconnect();
      }
      // Remove wheel listener from the DOM element before removing chart
      if (containerRef.current && chartRef.current?._wheelHandler) {
        containerRef.current.removeEventListener('wheel', chartRef.current._wheelHandler, { capture: true });
      }
      // Null refs BEFORE calling remove() to prevent any in-flight callbacks
      // from accessing the disposed series
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      const c = chartRef.current;
      chartRef.current = null;
      try { c?.remove(); } catch {}
    };
  }, [data, chartType]);

  // ── Live price polling ──────────────────────────────────────────────────────
  useEffect(() => {
    const pollPrice = async () => {
      try {
        const [q] = await api.getQuotes(symbol);
        if (q) {
          setQuote(q);
          setCurrentPrice(q.price);
          // Update last candle with new close price
          if (candleSeriesRef.current && data.length > 0) {
            const last = data[data.length - 1];
            candleSeriesRef.current.update({ ...last, close: q.price, high: Math.max(last.high, q.price), low: Math.min(last.low, q.price) });
          }
        }
      } catch {}
    };
    const iv = setInterval(pollPrice, 5000);
    return () => clearInterval(iv);
  }, [symbol, data]);

  // ── Trade handler ───────────────────────────────────────────────────────────
  const executeTrade = async (side) => {
    const price = orderType === 'market' ? currentPrice : Number(orderPrice);
    if (!price) return;
    try {
      const result = await onTrade({ type: side, symbol, quantity: Number(orderQty), price, orderType });
      setTradeResult({ side, price, qty: orderQty, ...result });
      setShowBuy(false); setShowSell(false);
      // Add order line on chart
      if (candleSeriesRef.current) {
        candleSeriesRef.current.createPriceLine({
          price,
          color: side === 'buy' ? '#26a69a' : '#ef5350',
          lineWidth: 1, lineStyle: 0,
          axisLabelVisible: true,
          title: `${side.toUpperCase()} ${orderQty}`,
        });
      }
    } catch (err) { setTradeResult({ error: err.message }); }
  };

  const liveChange = quote ? quote.changePercent : 0;
  const isGain = currentPrice >= (quote?.previousClose || currentPrice);

  return (
    <div className="chart-page">
      {/* ── Top Bar ────────────────────────────────────────────────────────── */}
      <div className="cpage-topbar">
        <div className="cpage-breadcrumb">
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Home</span>
          <span style={{ color: 'var(--text-disabled)' }}>›</span>
          <span style={{ color: 'var(--text-primary)' }}>{symbolData?.shortName || symbol}</span>
        </div>

        <div className="cpage-title-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="cpage-symbol-badge">{symbolData?.shortName || symbol}</div>
            <div className={`cpage-price ${isGain ? 'gain' : 'loss'}`}>{fmtPrice(currentPrice)}</div>
            <div className={`mover-change-pill ${isGain ? 'gain' : 'loss'}`}>
              {isGain ? '▲' : '▼'} {Math.abs(liveChange).toFixed(2)}%
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="cpage-tf-btn" onClick={() => isWatched ? onRemWatch?.(symbol) : onAddWatch?.(symbol)}>
              {isWatched ? '★ Watched' : '☆ Add to Watchlist'}
            </button>
            <div style={{width: 1, height: 16, background: 'var(--border-color)', margin: '0 4px'}} />
            <button className={`cpage-chart-type-btn ${chartType === 'line' ? 'active' : ''}`} onClick={() => setChartType('line')}>Line chart</button>
            <button className={`cpage-chart-type-btn ${chartType === 'candle' ? 'active' : ''}`} onClick={() => setChartType('candle')}>Technical Chart</button>
            <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }}>Indicators</button>
            <button className="btn btn-ghost" style={{ padding: '6px 10px' }} onClick={onClose}><X size={15} /></button>
          </div>
        </div>

        {/* OHLC bar */}
        <div className="cpage-ohlc-bar">
          <span className="ohlc-label">{symbol} · {timeframe} · NSE</span>
          {data.length > 0 && (() => {
            const last = data[data.length - 1];
            return <>
              <span>O <strong>{fmtPrice(last.open)}</strong></span>
              <span>H <strong style={{ color: 'var(--gain)' }}>{fmtPrice(last.high)}</strong></span>
              <span>L <strong style={{ color: 'var(--loss)' }}>{fmtPrice(last.low)}</strong></span>
              <span>C <strong>{fmtPrice(last.close)}</strong></span>
            </>;
          })()}
          {held > 0 && (
            <span className="ohlc-pnl">
              <span className="ohlc-holding-badge">Holding {held} @ {fmtPrice(avgBuy)}</span>
              <span className={unrealizedPL >= 0 ? 'gain' : 'loss'}>
                {unrealizedPL >= 0 ? '+' : ''}₹{Math.abs(unrealizedPL).toFixed(2)}
              </span>
            </span>
          )}
        </div>

        {/* Timeframe row */}
        <div className="cpage-tf-row">
          {TIMEFRAMES.map(tf => (
            <button key={tf} className={`cpage-tf-btn ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>
              {tf}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {getISTClock()}
          </span>
        </div>
      </div>

      <div className="cpage-body">
        {/* ── Left: Drawing Tools ─────────────────────────────────────────── */}
        <div className="cpage-tools">
          {DRAWING_TOOLS.map(tool => (
            <button
              key={tool.id}
              className={`cpage-tool-btn ${activeTool === tool.id ? 'active' : ''}`}
              onClick={() => setActiveTool(tool.id)}
              title={tool.label}
            >
              {tool.icon}
            </button>
          ))}
          <div className="cpage-tool-divider" />
          <button className="cpage-tool-btn" title="Remove drawings" onClick={() => setActiveOrders([])}>🗑</button>
        </div>

        {/* ── Center: Chart ───────────────────────────────────────────────── */}
        <div className="cpage-chart-wrap">
          {/* BUY/SELL overlay on chart */}
          {!isIndex && (
            <div className="chart-trade-buttons">
              <button className="chart-buy-btn" onClick={() => { setShowBuy(true); setShowSell(false); }}>
                {fmtPrice(currentPrice)} BUY
              </button>
              <button className="chart-sell-btn" onClick={() => { setShowSell(true); setShowBuy(false); }}>
                {fmtPrice(currentPrice)} SELL
              </button>
            </div>
          )}

          {/* Active order lines P&L overlay */}
          {activeOrders.length > 0 && (
            <div className="chart-orders-overlay">
              {activeOrders.slice(-3).map((o, i) => (
                <div key={i} className="chart-order-item">
                  <Target size={11} />
                  Target @ ₹{fmtPrice(o.price)}
                  <span className={currentPrice >= o.price ? 'gain' : 'loss'} style={{ marginLeft: 6 }}>
                    P&L: {currentPrice >= o.price ? '+' : ''}₹{((currentPrice - o.price) * (o.qty || 1)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Trade Result Toast */}
          {tradeResult && (
            <div className={`chart-trade-toast ${tradeResult.error ? 'error' : 'success'}`}>
              {tradeResult.error
                ? `❌ ${tradeResult.error}`
                : `✅ ${tradeResult.side?.toUpperCase()} ${tradeResult.qty} · Blk #${tradeResult.blockIndex}`
              }
              <button onClick={() => setTradeResult(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}>×</button>
            </div>
          )}

          {/* Order Form Popup */}
          {(showBuy || showSell) && (
            <div className="chart-order-form">
              <div className="chart-order-form-header">
                <span style={{ fontWeight: 700, color: showBuy ? 'var(--gain)' : 'var(--loss)', fontSize: 14 }}>
                  {showBuy ? '▲ BUY' : '▼ SELL'} {symbol}
                </span>
                <button onClick={() => { setShowBuy(false); setShowSell(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button className={`chart-order-type-btn ${orderType === 'market' ? 'active' : ''}`} onClick={() => setOrderType('market')}>Market</button>
                <button className={`chart-order-type-btn ${orderType === 'limit' ? 'active' : ''}`} onClick={() => setOrderType('limit')}>Limit</button>
              </div>
              {orderType === 'limit' && (
                <input className="input" type="number" value={orderPrice} onChange={e => setOrderPrice(e.target.value)} placeholder="Limit Price" style={{ marginBottom: 8, fontSize: 12 }} />
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => setOrderQty(q => Math.max(1, q - 1))}>−</button>
                <input className="input" type="number" value={orderQty} onChange={e => setOrderQty(Number(e.target.value))} min={1} style={{ textAlign: 'center', width: 60, fontSize: 12 }} />
                <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={() => setOrderQty(q => q + 1)}>+</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Total: ₹{fmtPrice((orderType === 'market' ? currentPrice : Number(orderPrice)) * orderQty)}
                · Balance: ₹{fmtPrice(balance)}
              </div>
              <button
                className={showBuy ? 'btn-gain' : 'btn-loss'}
                onClick={() => executeTrade(showBuy ? 'buy' : 'sell')}
                style={{ fontSize: 12 }}
              >
                {showBuy ? 'BUY' : 'SELL'} {orderQty} × {symbol}
              </button>
            </div>
          )}

          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,17,23,0.7)', zIndex: 20 }}>
              <div className="spinner" />
            </div>
          )}
          <div ref={containerRef} className="cpage-chart-container" />
        </div>

        {/* ── Right Panel ─────────────────────────────────────────────────── */}
        <div className="cpage-info-panel">
          {/* Info toggle */}
          <div className="info-panel-header">
            <span className="info-panel-title">Info</span>
            <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
          </div>

          {/* Symbol name + price */}
          <div className="info-name">{symbolData?.shortName || symbol}</div>
          <div className="info-ticker">{symbol} NSE</div>
          <div className={`info-price ${isGain ? 'gain' : 'loss'}`}>{fmtPrice(currentPrice)}</div>
          <div className={`info-change ${isGain ? 'gain' : 'loss'}`}>
            {isGain ? '▲' : '▼'} {Math.abs(quote?.change || 0).toFixed(2)} ({Math.abs(liveChange).toFixed(2)}%) 1D
          </div>

          {/* Market Data */}
          <div className="info-divider" />
          <div className="info-row"><span>Open Price</span><span>{fmtPrice(quote?.previousClose || 0)}</span></div>
          <div className="info-row"><span>Prev Close</span><span>{fmtPrice(quote?.previousClose || 0)}</span></div>
          {!isIndex && <>
            <div className="info-row"><span>Upper Circuit</span><span className="gain">+5%</span></div>
            <div className="info-row"><span>Lower Circuit</span><span className="loss">-5%</span></div>
            <div className="info-row"><span>Volume</span><span>{quote?.volume ? (quote.volume / 1e5).toFixed(2) + 'L' : '—'}</span></div>
          </>}

          {/* Today's Low-High */}
          <div className="info-divider" />
          <div className="info-lowhigh">
            <div>
              <div className="info-lowhigh-val loss">{fmtPrice((currentPrice * 0.989).toFixed(2))}</div>
              <div className="info-lowhigh-label">Today's Low</div>
            </div>
            <div style={{ flex: 1, height: 4, background: 'linear-gradient(90deg, var(--loss) 0%, var(--gain) 100%)', borderRadius: 4, margin: '0 10px', alignSelf: 'center' }} />
            <div style={{ textAlign: 'right' }}>
              <div className="info-lowhigh-val gain">{fmtPrice((currentPrice * 1.008).toFixed(2))}</div>
              <div className="info-lowhigh-label">Today's High</div>
            </div>
          </div>

          {/* 52W Low-High */}
          <div className="info-divider" />
          <div className="info-lowhigh">
            <div>
              <div className="info-lowhigh-val" style={{ color: 'var(--text-secondary)' }}>{fmtPrice((currentPrice * 0.78).toFixed(0))}</div>
              <div className="info-lowhigh-label">52W Low</div>
            </div>
            <div style={{ flex: 1, height: 4, background: 'linear-gradient(90deg, #ef5350 0%, #26a69a 100%)', borderRadius: 4, margin: '0 10px', alignSelf: 'center' }} />
            <div style={{ textAlign: 'right' }}>
              <div className="info-lowhigh-val" style={{ color: 'var(--text-secondary)' }}>{fmtPrice((currentPrice * 1.12).toFixed(0))}</div>
              <div className="info-lowhigh-label">52W High</div>
            </div>
          </div>

          {/* Option Chain link */}
          <div className="info-divider" />
          <button className="info-option-chain-btn" onClick={() => setActiveTab('option-chain')}>
            <Target size={14} /> Option Chain <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
          </button>

          {/* Advancers/Decliners for indices */}
          {isIndex && (
            <>
              <div className="info-divider" />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="gain" style={{ fontSize: 13, fontWeight: 700 }}>Advancers 72.00%</span>
                <span className="loss" style={{ fontSize: 13, fontWeight: 700 }}>Decliners 28.00%</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--loss)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '72%', background: 'var(--gain)', borderRadius: 99 }} />
              </div>
            </>
          )}

          {/* Historical Performance */}
          <div className="info-divider" />
          <div className="info-section-label">Historical Performance</div>
          <div className="info-perf-grid">
            {[
              { label: '1 Day', val: '+0.28%' },
              { label: '5 Days', val: '+0.89%' },
              { label: '1 Month', val: '+2.90%' },
            ].map(({ label, val }) => (
              <div key={label} className="info-perf-card">
                <div className="info-perf-val gain">{val}</div>
                <div className="info-perf-label">{label}</div>
              </div>
            ))}
          </div>

          {/* Market Depth + BUY/SELL for stocks */}
          {!isIndex && (
            <>
              <div className="info-divider" />
              <div className="info-section-label">Market Depth</div>
              <div className="market-depth-table">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span style={{ flex: 1 }}>BID QTY</span><span style={{ flex: 0.7, textAlign: 'center' }}>PRICE</span><span style={{ flex: 1, textAlign: 'right' }}>ASK QTY</span>
                </div>
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="depth-row">
                    <span className="gain" style={{ flex: 1 }}>{(500 - i * 80 + Math.floor(Math.random() * 50)).toLocaleString()}</span>
                    <span style={{ flex: 0.7, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {fmtPrice(currentPrice - (i * 0.5))}
                    </span>
                    <span className="loss" style={{ flex: 1, textAlign: 'right' }}>{(480 - i * 60 + Math.floor(Math.random() * 50)).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <button className="btn-gain" onClick={() => { setShowBuy(true); setShowSell(false); }}>BUY</button>
                <button className="btn-loss" onClick={() => { setShowSell(true); setShowBuy(false); }}>SELL</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Bottom Tabs ──────────────────────────────────────────────────────── */}
      <div className="cpage-bottom-tabs">
        {!isIndex
          ? ['overview', 'financials', 'technicals', 'events', 'news'].map(t => (
              <button key={t} className={`cpage-bottom-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))
          : ['overview', 'option-chain', 'technicals'].map(t => (
              <button key={t} className={`cpage-bottom-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
                {t === 'option-chain' ? 'Option Chain' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))
        }
      </div>

      {/* ── Bottom Panel ─────────────────────────────────────────────────────── */}
      {activeTab === 'option-chain' && (
        <div className="cpage-bottom-panel">
          <OptionChainPage symbol={symbol} inModal onTrade={onTrade} balance={balance} />
        </div>
      )}
      {activeTab === 'technicals' && (
        <div className="cpage-bottom-panel">
          <TechnicalsPanel price={currentPrice} />
        </div>
      )}
    </div>
  );
}

function TechnicalsPanel({ price }) {
  const rsi = (30 + Math.random() * 50).toFixed(1);
  const macd = (Math.random() - 0.5) * 50;
  const signals = [
    { name: 'RSI(14)', value: rsi, signal: rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL', type: rsi > 70 ? 'loss' : rsi < 30 ? 'gain' : 'neutral' },
    { name: 'MACD(12,26)', value: macd.toFixed(2), signal: macd > 0 ? 'BULLISH' : 'BEARISH', type: macd > 0 ? 'gain' : 'loss' },
    { name: 'SMA(20)', value: fmtPrice(price * 0.98), signal: price > price * 0.98 ? 'ABOVE' : 'BELOW', type: price > price * 0.98 ? 'gain' : 'loss' },
    { name: 'EMA(50)', value: fmtPrice(price * 0.975), signal: 'BULLISH', type: 'gain' },
    { name: 'BB Width', value: '2.1%', signal: 'NORMAL', type: 'neutral' },
    { name: 'Volume', value: 'HIGH', signal: 'BULLISH', type: 'gain' },
  ];
  return (
    <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
      {signals.map(s => (
        <div key={s.name} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{s.name}</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: 4 }}>{s.value}</div>
          <div className={`mover-change-pill ${s.type === 'gain' ? 'gain' : s.type === 'loss' ? 'loss' : ''}`} style={{ fontSize: 10, padding: '2px 6px' }}>{s.signal}</div>
        </div>
      ))}
    </div>
  );
}
