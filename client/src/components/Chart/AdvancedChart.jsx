import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import './Chart.css';
import { Settings2 } from 'lucide-react';

const RANGES = [
  { label: '1D', value: '1d' },
  { label: '5D', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
  { label: '3Y', value: '3y' },
  { label: '5Y', value: '5y' },
  { label: 'ALL', value: 'max' },
];

const SYMBOL_OPTIONS = [
  { label: 'NIFTY 50', value: '^NSEI' },
  { label: 'BSE SENSEX', value: '^BSESN' },
  { label: 'BANK NIFTY', value: '^NSEBANK' },
  { label: 'NIFTY IT', value: '^CNXIT' },
  { label: 'RELIANCE', value: 'RELIANCE' },
  { label: 'TCS', value: 'TCS' },
  { label: 'HDFC BANK', value: 'HDFCBANK' },
  { label: 'INFOSYS', value: 'INFY' },
  { label: 'ICICI BANK', value: 'ICICIBANK' },
  { label: 'SBI', value: 'SBIN' },
];

// IST offset in seconds: +5:30 = 19800 seconds
const IST_OFFSET_S = 5.5 * 3600;

/**
 * Format a Unix timestamp (seconds) as IST time string "HH:MM" or "DD MMM"
 * depending on whether it is an intraday or daily candle.
 */
function fmtTimeIST(unixSec, isIntraday) {
  const d = new Date((unixSec + IST_OFFSET_S) * 1000);
  if (isIntraday) {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  // For daily+: "08 Jun"
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

// Helper to calculate Simple Moving Average
function calculateSMA(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

function CandleChart({ data, currentPrice, isIntraday }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const smaSeriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    let destroyed = false;

    const init = async () => {
      try {
        const { createChart, CrosshairMode, LineStyle } = await import('lightweight-charts');
        if (destroyed || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 400,
          layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
          grid: {
            vertLines: { color: 'rgba(30, 41, 59, 0.4)', style: LineStyle.Dotted },
            horzLines: { color: 'rgba(30, 41, 59, 0.4)', style: LineStyle.Dotted }
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { width: 1, color: '#475569', style: LineStyle.Dash, labelBackgroundColor: '#1e293b' },
            horzLine: { width: 1, color: '#475569', style: LineStyle.Dash, labelBackgroundColor: '#1e293b' }
          },
          rightPriceScale: {
            borderColor: '#1e293b',
            scaleMargins: { top: 0.1, bottom: 0.2 },
            autoScale: true,
            alignLabels: true
          },
          timeScale: {
            borderColor: '#1e293b',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5,
            // Format timestamps in IST on the x-axis tick marks
            tickMarkFormatter: (time) => fmtTimeIST(time, isIntraday),
          },
          localization: {
            // Format crosshair time tooltip in IST
            timeFormatter: (time) => fmtTimeIST(time, isIntraday),
          },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });

        if (destroyed) { chart.remove(); return; }

        // Main Candle Series
        const candleSeries = chart.addCandlestickSeries({
          upColor: '#10b981', downColor: '#f43f5e',
          borderUpColor: '#10b981', borderDownColor: '#f43f5e',
          wickUpColor: '#10b981', wickDownColor: '#f43f5e',
          priceFormat: { type: 'price', precision: 2, minMove: 0.05 }
        });

        candleSeries.applyOptions({
          lastValueVisible: true,
          priceLineVisible: true,
          priceLineColor: currentPrice >= (data[data.length - 1].open || 0) ? '#10b981' : '#f43f5e',
          priceLineWidth: 1,
          priceLineStyle: LineStyle.SparseDotted,
        });

        // Volume Histogram
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

        // SMA 20 indicator
        const smaSeries = chart.addLineSeries({
          color: '#3b82f6',
          lineWidth: 1.5,
          lineStyle: LineStyle.Solid,
          title: 'SMA 20',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3
        });

        candleSeries.setData(data);
        smaSeries.setData(calculateSMA(data, 20));
        volumeSeries.setData(data.map(d => ({
          time: d.time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)',
        })));

        chart.timeScale().fitContent();

        // Wheel handler for independent Y-scale zoom
        const handleWheel = (e) => {
          if (!containerRef.current) return;
          const bounds = containerRef.current.getBoundingClientRect();
          const isOnPriceScale = e.clientX > bounds.right - 60;
          if (isOnPriceScale) {
            e.preventDefault();
            e.stopPropagation();
            chart.priceScale('right').applyOptions({ autoScale: false });
          }
        };
        containerRef.current.addEventListener('wheel', handleWheel, { passive: false, capture: true });

        // ResizeObserver
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chart) {
            chart.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight
            });
          }
        });
        ro.observe(containerRef.current);

        candleSeriesRef.current = candleSeries;
        smaSeriesRef.current = smaSeries;
        chartRef.current = { chart, ro, handleWheel };
      } catch (e) {
        console.error('Chart init error:', e);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (chartRef.current) {
        if (chartRef.current.ro) chartRef.current.ro.disconnect();
        if (containerRef.current && chartRef.current.handleWheel) {
          containerRef.current.removeEventListener('wheel', chartRef.current.handleWheel, { capture: true });
        }
        candleSeriesRef.current = null;
        smaSeriesRef.current = null;
        try { chartRef.current.chart?.remove(); } catch (e) { }
        chartRef.current = null;
      }
    };
  }, [data]);

  // Handle live price update
  useEffect(() => {
    if (currentPrice && candleSeriesRef.current && data.length > 0) {
      const last = data[data.length - 1];
      const newClose = currentPrice;
      const isGain = newClose >= last.open;

      candleSeriesRef.current.update({
        ...last,
        close: newClose,
        high: Math.max(last.high, newClose),
        low: Math.min(last.low, newClose)
      });

      candleSeriesRef.current.applyOptions({
        priceLineColor: isGain ? '#10b981' : '#f43f5e',
      });
    }
  }, [currentPrice, data]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

/**
 * AdvancedChart — dashboard inline chart.
 * Props:
 *   symbol, onRangeChange, onSymbolChange
 *   quote  — live quote from parent (has .change, .changePercent, .previousClose)
 */
export default function AdvancedChart({ symbol, onRangeChange, onSymbolChange, quote }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [currentRange, setCurrentRange] = useState('1d');
  const [error, setError] = useState('');
  const [livePrice, setLivePrice] = useState(null);
  const [localQuote, setLocalQuote] = useState(null); // fallback polled quote

  // True when the active range is intraday (sub-daily intervals)
  const isIntraday = ['1d', '5d'].includes(currentRange);

  useEffect(() => {
    let active = true;
    const r = RANGES.find(x => x.value === currentRange) || RANGES[0];

    // Intraday: 1-minute candles for best resolution; others: auto
    const customInterval = r.value === '1d' ? '1m' : 'auto';

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.getCandles(symbol, r.value, customInterval);
        if (!active) return;
        setData(res || []);
        if (res?.length) setLivePrice(res[res.length - 1].close);
      } catch (e) {
        if (active) { setError(e.message); setData([]); }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [symbol, currentRange]);

  // Live price polling — also refresh localQuote for indices without a parent quote
  useEffect(() => {
    let interval;
    if (data.length > 0) {
      interval = setInterval(async () => {
        try {
          const qs = await api.getQuotes(symbol);
          const q = Array.isArray(qs) ? qs[0] : qs;
          if (q?.price) {
            setLivePrice(q.price);
            setLocalQuote(q);
          }
        } catch (e) { }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [symbol, data]);

  const handleRange = (val) => {
    setCurrentRange(val);
    onRangeChange?.(val);
  };

  // ── Derive price change for the header ─────────────────────────────────────
  // Priority order:
  // 1. If viewing 1D: use official server-supplied change (quote prop or localQuote)
  // 2. If viewing longer ranges: compare current price vs first candle's open
  const lastVal = data[data.length - 1];
  const firstVal = data[0];
  const currentDisplayPrice = livePrice || lastVal?.close || 0;

  let chg = 0;
  let chgPct = 0;

  const activeQuote = quote || localQuote; // prefer parent-supplied live quote

  if (currentRange === '1d' && activeQuote) {
    // Use the server-computed official daily change (matches hero cards)
    chg = activeQuote.change ?? 0;
    chgPct = activeQuote.changePercent ?? 0;
  } else if (data.meta?.previousClose && currentRange === '1d') {
    // Fallback: derive from meta.previousClose
    chg = currentDisplayPrice - data.meta.previousClose;
    chgPct = data.meta.previousClose ? (chg / data.meta.previousClose) * 100 : 0;
  } else if (lastVal && firstVal) {
    // Multi-day ranges: show gain/loss vs first candle open in the dataset
    chg = currentDisplayPrice - firstVal.open;
    chgPct = firstVal.open ? (chg / firstVal.open) * 100 : 0;
  }

  const isGain = chg >= 0;

  return (
    <div className="adv-chart" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chart-controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select className="chart-symbol-select" value={symbol} onChange={e => onSymbolChange?.(e.target.value)} style={{ fontWeight: 800 }}>
            {SYMBOL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {loading && <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
          {currentDisplayPrice > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: isGain ? 'var(--gain)' : 'var(--loss)' }}>
              {currentDisplayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              <span style={{ fontSize: 12, marginLeft: 6, fontWeight: 600 }}>
                {isGain ? '▲' : '▼'}{Math.abs(chg).toFixed(2)} ({isGain ? '+' : ''}{chgPct.toFixed(2)}%)
              </span>
            </span>
          )}
        </div>
        <div className="chart-ranges">
          {RANGES.map(r => (
            <button key={r.value} className={`chart-range-btn ${currentRange === r.value ? 'active' : ''}`} onClick={() => handleRange(r.value)}>
              {r.label}
            </button>
          ))}
          <button className="chart-range-btn" title="Chart Settings" style={{ marginLeft: 4 }}>
            <Settings2 size={13} style={{ opacity: 0.7 }} />
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: '12px 16px', background: 'var(--loss-bg)', color: 'var(--loss)', fontSize: 12 }}>
          ⚠️ Data Fetch Error: {error}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 400, position: 'relative' }}>
          {data.length > 0 ? (
            <CandleChart key={`${symbol}-${currentRange}`} data={data} currentPrice={livePrice} isIntraday={isIntraday} />
          ) : !loading ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No chart data available for this market timeframe.
            </div>
          ) : null}

          {loading && data.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" style={{ width: 30, height: 30, borderWidth: 3 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
