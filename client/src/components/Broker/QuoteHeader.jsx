import { useState, useEffect, useRef } from 'react';
import { BarChart2 } from 'lucide-react';
import './Kite.css';

function fmtINR(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
  if (Math.abs(v) >= 1e5) return (v / 1e5).toFixed(2) + 'L';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + 'k';
  return v.toLocaleString('en-IN');
}

// Kite-style quote header: exchange toggle NSE/BSE, OHLC, volume, circuits, 52w
export default function QuoteHeader({ symbol, quote, exchange, onExchangeChange, onBuy, onSell, onOpenChart }) {
  const [exch, setExch] = useState(exchange || 'NSE');
  const q = quote || {};
  const ltp = q.price ?? q.ltp ?? 0;
  const chg = q.change ?? 0;
  const chgPct = q.changePercent ?? 0;
  const gain = chgPct >= 0;

  const setExchange = (e) => {
    setExch(e);
    onExchangeChange?.(e);
  };

  const prevClose = q.previousClose ?? q.prevClose ?? null;
  const avgPrice = q.vwap ?? q.averagePrice ?? null;
  const week52High = q.fiftyTwoWeekHigh ?? q.high52 ?? null;
  const week52Low = q.fiftyTwoWeekLow ?? q.low52 ?? null;
  const has52w = week52High != null || week52Low != null;
  const freshness = String(q.freshness || '').toUpperCase();
  const source = String(q.source || '').toUpperCase();
  const live = freshness === 'LIVE' || freshness === 'REALTIME' || freshness === 'REAL-TIME';
  const noData = !ltp || source === 'UNAVAILABLE';

  // quote flash: green/red flash on last price tick
  const [flashDir, setFlashDir] = useState(null); // 'up' | 'down' | null
  const prevLtpRef = useRef(ltp);
  useEffect(() => {
    const prev = prevLtpRef.current;
    const v = ltp ?? null;
    if (prev != null && v != null && v !== prev) {
      setFlashDir(v > prev ? 'up' : 'down');
    }
    prevLtpRef.current = v;
    if (flashDir) {
      const t = setTimeout(() => setFlashDir(null), 450);
      return () => clearTimeout(t);
    }
  }, [ltp]); // eslint-disable-line

  const ohlc = [
    { l: 'Open', v: q.open != null ? fmtINR(q.open) : '—' },
    { l: 'High', v: q.high != null ? fmtINR(q.high) : '—' },
    { l: 'Low', v: q.low != null ? fmtINR(q.low) : '—' },
    { l: 'Prev Close', v: prevClose != null ? fmtINR(prevClose) : '—' },
    { l: 'Volume', v: q.volume != null ? fmtN(q.volume) : '—' },
    { l: 'Avg Price', v: avgPrice != null ? fmtINR(avgPrice) : '—' },
    { l: 'Lower Circuit', v: q.lowerCircuit != null ? fmtINR(q.lowerCircuit) : '—' },
    { l: 'Upper Circuit', v: q.upperCircuit != null ? fmtINR(q.upperCircuit) : '—' },
    { l: '52W H / L', v: has52w ? `${week52High != null ? fmtN(week52High) : '—'} / ${week52Low != null ? fmtN(week52Low) : '—'}` : '—' },
    { l: 'Mkt Cap', v: q.marketCap != null ? fmtN(q.marketCap) : '—' },
  ];

  return (
    <div className="kite-quote">
      <div>
        <div className="kite-quote-sym">
          {symbol || '—'}
          {!noData && (
            <span className={`kite-feed-badge ${live ? 'live' : 'delayed'}`} title={`${freshness || 'FEED'}${source ? ` · ${source}` : ''}`}>
              {live ? 'LIVE' : 'DELAYED'}
            </span>
          )}
          {noData && <span className="kite-feed-badge none">NO DATA</span>}
          <div className="kite-exch-toggle">
            {['NSE', 'BSE'].map(e => (
              <button key={e} className={exch === e ? 'active' : ''} onClick={() => setExchange(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {q.name || q.shortName || 'NSE Equity'} · {exch} · EQ
        </div>
      </div>
      <div>
        <div className="kite-quote-px" style={{
          color: noData ? 'var(--text-muted)' : gain ? 'var(--gain)' : 'var(--loss)',
          ...(flashDir === 'up' ? { animation: 'bt-quote-flash-up 0.45s ease-out' } : {}),
          ...(flashDir === 'down' ? { animation: 'bt-quote-flash-down 0.45s ease-out' } : {}),
          ...(flashDir ? { backgroundColor: gain ? 'rgba(8,153,129,0.18)' : 'rgba(242,54,69,0.18)', borderRadius: 6 } : {}),
        }}>
          {ltp ? fmtINR(ltp) : '-'}
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: gain ? 'var(--gain)' : 'var(--loss)' }}>
          {gain ? '+' : ''}{Number(chg).toFixed(2)} ({gain ? '+' : ''}{Number(chgPct).toFixed(2)}%)
        </div>
      </div>
      <div className="kite-quote-meta">
        {ohlc.map(o => (
          <span key={o.l}>{o.l} <b>{o.v}</b></span>
        ))}
      </div>
      <div className="kite-quote-actions">
        {onOpenChart && (
          <button className="kite-chart-link" onClick={onOpenChart} title="Open full chart">
            <BarChart2 size={14} /> Chart
          </button>
        )}
        <button className="kite-submit buy" style={{ padding: '8px 20px' }} onClick={onBuy}>B BUY</button>
        <button className="kite-submit sell" style={{ padding: '8px 20px' }} onClick={onSell}>S SELL</button>
      </div>
    </div>
  );
}
