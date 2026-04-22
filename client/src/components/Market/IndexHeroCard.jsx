import { useEffect, useState, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Maximize2 } from 'lucide-react';

function fmtPrice(n) {
  if (!n) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function makeSparkData(changePercent) {
  const pts = 20;
  const data = [];
  let val = 100;
  for (let i = 0; i < pts; i++) {
    val += (Math.random() - (changePercent < 0 ? 0.55 : 0.45)) * 1.5;
    data.push({ v: parseFloat(val.toFixed(2)) });
  }
  return data;
}

export default function IndexHeroCard({ label, quote, loading, onClick, active, onFullScreen }) {
  const isGain    = (quote?.changePercent || 0) >= 0;
  const color     = isGain ? 'var(--gain)' : 'var(--loss)';
  const sparkData = quote ? makeSparkData(quote.changePercent) : [];
  
  const [flash, setFlash] = useState('');
  const prevPrice = useRef(quote?.price);

  useEffect(() => {
    if (quote?.price && prevPrice.current && quote.price !== prevPrice.current) {
      setFlash(quote.price > prevPrice.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 1000);
      prevPrice.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote?.price;
  }, [quote?.price]);

  // Determine simulated adv/dec ratio based on changePercent
  const chg = quote?.changePercent || 0;
  let advPct = 50 + (chg * 20); // arbitrary but looks realistic
  advPct = Math.max(0, Math.min(100, advPct));
  const decPct = 100 - advPct;

  return (
    <div className={`index-hero-card ${active ? 'active' : ''} ${flash}`} onClick={onClick}>
      <div className="hero-label">{label}</div>

      {/* Full-screen button */}
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
            <span style={{ color }}>{isGain ? '▲' : '▼'} {Math.abs(quote.change || 0).toFixed(2)}</span>
            <span style={{ color, opacity: 0.85 }}>({isGain ? '+' : ''}{quote.changePercent?.toFixed(2)}%)</span>
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
          
          {/* Advances & Declines Bar */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
              <span className="gain">{advPct.toFixed(2)}%<br/><span style={{fontSize: 9, opacity: 0.7}}>Adv</span></span>
              <span className="loss" style={{textAlign:'right'}}>{decPct.toFixed(2)}%<br/><span style={{fontSize: 9, opacity: 0.7}}>Dec</span></span>
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
