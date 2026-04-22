import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import './Chart.css';
import { Maximize2, Settings2 } from 'lucide-react';

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

function CandleChart({ data, currentPrice }) {
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
            rightOffset: 5 // Padding on the right for current price line
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

        // Current Live Price Line mapping
        candleSeries.applyOptions({
            lastValueVisible: true,
            priceLineVisible: true,
            priceLineColor: currentPrice >= (data[data.length-1].open || 0) ? '#10b981' : '#f43f5e',
            priceLineWidth: 1,
            priceLineStyle: LineStyle.SparseDotted,
        });

        // Volume Histogram Series
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });

        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

        // Indicator: SMA 20
        const smaSeries = chart.addLineSeries({
            color: '#3b82f6', // Blueprint blue
            lineWidth: 1.5,
            lineStyle: LineStyle.Solid,
            title: 'SMA 20',
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 3
        });

        candleSeries.setData(data);
        const smaData = calculateSMA(data, 20);
        smaSeries.setData(smaData);

        volumeSeries.setData(data.map(d => ({
          time: d.time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)',
        })));
        
        chart.timeScale().fitContent();

        // Custom wheel logic for independent scaling
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

        // Resize observer
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
        try { chartRef.current.chart?.remove(); } catch(e){}
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
      
      // Flash live line color
      candleSeriesRef.current.applyOptions({
         priceLineColor: isGain ? '#10b981' : '#f43f5e',
      });
    }
  }, [currentPrice, data]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

export default function AdvancedChart({ symbol, onRangeChange, onSymbolChange }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [currentRange, setCurrentRange] = useState('1d');
  const [error, setError] = useState('');
  const [livePrice, setLivePrice] = useState(null);

  const lastVal = data[data.length - 1];
  const firstVal = data[0];

  useEffect(() => {
    let active = true;
    const r = RANGES.find(x => x.value === currentRange) || RANGES[0];
    
    // For 1D specifically, fetch 1minute intervals to make it look professional
    const customInterval = r.value === '1d' ? '1m' : 'auto';
    
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.getCandles(symbol, r.value, customInterval);
        if (!active) return;
        setData(res || []);
        if (res?.length) setLivePrice(res[res.length-1].close);
      } catch (e) {
        if (active) { setError(e.message); setData([]); }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [symbol, currentRange]);

  // Live polling
  useEffect(() => {
    let interval;
    if (data.length > 0) {
      interval = setInterval(async () => {
        try {
          const [q] = await api.getQuotes(symbol);
          if (q?.price) setLivePrice(q.price);
        } catch(e){}
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [symbol, data]);

  const handleRange = (val) => {
    setCurrentRange(val);
    onRangeChange?.(val);
  };

  const currentDisplayPrice = livePrice || lastVal?.close || 0;
  const chg = lastVal && firstVal ? currentDisplayPrice - firstVal.open : 0;
  const chgPct = firstVal?.open ? (chg / firstVal.open) * 100 : 0;
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
          <button className="chart-range-btn" title="Chart Settings" style={{marginLeft: 4}}>
              <Settings2 size={13} style={{opacity: 0.7}}/>
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
            <CandleChart key={`${symbol}-${currentRange}`} data={data} currentPrice={livePrice} />
          ) : !loading ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No chart data available for this market timeframe.
            </div>
          ) : null}
          
          {loading && data.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" style={{width: 30, height: 30, borderWidth: 3}} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

