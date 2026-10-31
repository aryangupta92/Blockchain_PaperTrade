import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import ChartView from '../../chart/ChartView';
import { fmtPct, NoDataBadge, hasPrice } from '../../utils/price';
import './Chart.css';

/**
 * AdvancedChart - the chart used across Dashboard, Market, Terminal, Trades.
 *
 * Timeframes (1m … 1W) are the single control. The old 1D/5D/1M/1Y range
 * selector duplicated the same concept and overlapped the dashboard chart, so
 * it has been removed entirely.
 */

const TIMEFRAMES = [
  { label: '1m', tf: '1m', range: '1d' },
  { label: '5m', tf: '5m', range: '5d' },
  { label: '15m', tf: '15m', range: '1mo' },
  { label: '30m', tf: '30m', range: '1mo' },
  { label: '1h', tf: '60m', range: '3mo' },
  { label: '1D', tf: '1d', range: '1y' },
  { label: '1W', tf: '1wk', range: '5y' },
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
  { label: 'SBIN', value: 'SBIN' },
];

export default function AdvancedChart({
  symbol, label, defaultTimeframe = '5m', onSymbolChange, quote, height = 320,
}) {
  const [timeframe, setTimeframe] = useState(
    TIMEFRAMES.some(t => t.label === defaultTimeframe) ? defaultTimeframe : '5m'
  );
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chartType, setChartType] = useState('candle');
  const [showVolume, setShowVolume] = useState(true);
  const [indicators] = useState({ ema20: true, vwap: true, rsi: false, macd: false });

  const active = useMemo(
    () => TIMEFRAMES.find(t => t.label === timeframe) || TIMEFRAMES[1],
    [timeframe]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const bars = await api.getCandles(symbol, active.range, active.tf);
      setData(bars || []);
    } catch (e) {
      setError(e.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, active.range, active.tf]);

  useEffect(() => { loadData(); }, [loadData]);

  const symbolOptions = useMemo(
    () => (SYMBOL_OPTIONS.some(o => o.value === symbol)
      ? SYMBOL_OPTIONS
      : [{ label: symbol, value: symbol }, ...SYMBOL_OPTIONS]),
    [symbol]
  );

  const livePrice = quote?.price ?? (data.length ? data[data.length - 1].close : null);
  const chg = quote?.change ?? null;
  const chgPct = quote?.changePercent ?? (chg != null && livePrice ? (chg / (livePrice - chg)) * 100 : null);
  const isGain = (chgPct ?? 0) >= 0;

  return (
    <div className="adv-chart" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chart-controls">
        <div className="chart-controls-left">
          {onSymbolChange ? (
            <select className="chart-symbol-select" value={symbol} onChange={(e) => onSymbolChange(e.target.value)}>
              {symbolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <span style={{ fontWeight: 800, fontSize: 13 }}>{label || symbol}</span>
          )}
          {loading && <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
          {hasPrice(livePrice) ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: isGain ? 'var(--gain)' : 'var(--loss)' }}>
              {livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              {fmtPct(chgPct) && (
                <span style={{ fontSize: 12, marginLeft: 6, fontWeight: 600 }}>
                  {isGain ? '+' : ''}{Math.abs(chg ?? 0).toFixed(2)} ({fmtPct(chgPct)})
                </span>
              )}
            </span>
          ) : <NoDataBadge compact />}
        </div>

        <div className="chart-controls-right">
          <div className="chart-type-group">
            {[
              { id: 'candle', label: 'C' },
              { id: 'line', label: 'L' },
              { id: 'area', label: 'A' },
            ].map((ct) => (
              <button key={ct.id} className={`cpage-chart-type-btn ${chartType === ct.id ? 'active' : ''}`} onClick={() => setChartType(ct.id)} style={{ fontSize: 10, padding: '2px 7px' }}>
                {ct.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowVolume((v) => !v)}
            className={`chart-vol-btn ${showVolume ? 'active' : ''}`}
            title="Toggle volume"
          >Vol</button>
          <div className="chart-ranges">
            {TIMEFRAMES.map((t) => (
              <button key={t.label} className={`chart-range-btn ${timeframe === t.label ? 'active' : ''}`} onClick={() => setTimeframe(t.label)}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ padding: '10px 14px', background: 'var(--loss-bg)', color: 'var(--loss)', fontSize: 12 }}>
          Data unavailable: {error}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: height, position: 'relative' }}>
          <ChartView
            key={`${symbol}-${active.tf}`}
            symbol={symbol}
            timeframe={active.tf}
            data={data}
            chartType={chartType}
            indicators={{ ...indicators, volume: showVolume }}
            livePrice={livePrice}
            showStats
          />
        </div>
      )}
    </div>
  );
}
