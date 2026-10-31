import { useEffect, useState, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Maximize2 } from 'lucide-react';
import api from '../../services/api';

function fmtPrice(n) {
  if (!n) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function IndexHeroCard({ label, quote, loading, onClick, active, onFullScreen }) {
  const safeChgPct = Number.isFinite(Number(quote?.changePercent)) ? Number(quote.changePercent) : 0;
  const safeChgAbs = Number.isFinite(Number(quote?.change)) ? Number(quote.change) : 0;
  const isGain    = safeChgPct >= 0;
  const color     = isGain ? 'var(--gain)' : 'var(--loss)';

  const [sparkData, setSparkData] = useState([]);
  const [breadth, setBreadth] = useState(null);
  const [flash, setFlash] = useState('');
  const prevPrice = useRef(quote?.price);

  // Fetch real intraday candles for sparkline
  useEffect(() => {
    if (!quote?.symbol) return;
    let alive = true;
    api.getCandles(quote.symbol, '1d', '5m')
      .then(data => {
        if (!alive || !data?.length) return;
        const pts = data.slice(-30).map(c => ({ v: c.close }));
        setSparkData(pts);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [quote?.symbol]);

  // Fetch real breadth for advances/declines
  useEffect(() => {
    let alive = true;
    api.getMarketBreadth()
      .then(d => { if (alive && d) setBreadth(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (quote?.price && prevPrice.current && quote.price !== prevPrice.current) {
      setFlash(quote.price > prevPrice.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 1000);
      prevPrice.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote?.price;
  }, [quote?.price]);

  const advPct = breadth?.advances != null && breadth?.total > 0
    ? (breadth.advances / breadth.total) * 100
    : 50;
  const decPct = breadth?.declines != null && breadth?.total > 0
    ? (breadth.declines / breadth.total) * 100
    : 50;

  return (
    <div className={`index-hero-card ${active ? 'active' : ''} ${flash}`} onClick={onClick}>
      <div className="hero-label">{label}</div>

      {onFullScreen && (
        <button
          className="hero-fullscreen"
          onClick={e => { e.stopPropagation(); onFullScreen(); }}
          title="Open full chart"
        >
          <Maximize2 size={12} />
        </button>
      )}

      {loading || !quote ? (
        <>
          <div className="skeleton" style={{ height: 26, width: '70%', marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 14, width: '40%' }} />
        </>
      ) : (
        <>
          <div className="hero-price" style={{ color }}>{fmtPrice(quote.price)}</div>
          <div className="hero-change">
            <span style={{ color }}>{isGain ? '▲' : '▼'} {Math.abs(safeChgAbs).toFixed(2)}</span>
            <span style={{ color, opacity: 0.85 }}>({isGain ? '+' : ''}{safeChgPct.toFixed(2)}%)</span>
          </div>
          {sparkData.length > 0 && (
            <div className="hero-mini-chart">
              <ResponsiveContainer width="100%" height={36}>
                <LineChart data={sparkData}>
                  <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Real Advances & Declines from breadth API */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
              <span className="gain">{advPct.toFixed(1)}%<br/><span style={{fontSize: 9, opacity: 0.7}}>Adv {breadth?.advances ?? '—'}</span></span>
              <span className="loss" style={{textAlign:'right'}}>{decPct.toFixed(1)}%<br/><span style={{fontSize: 9, opacity: 0.7}}>Dec {breadth?.declines ?? '—'}</span></span>
            </div>
            <div style={{ display: 'flex', height: 3, borderRadius: 2, background: 'var(--loss)', overflow: 'hidden' }}>
              <div style={{ width: `${advPct}%`, background: 'var(--gain)' }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
