import { useState } from 'react';
import './Kite.css';

function fmtINR(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
  if (Math.abs(v) >= 1e5) return (v / 1e5).toFixed(2) + 'L';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + 'k';
  return v.toLocaleString('en-IN');
}

// Kite-style quote header: exchange toggle NSE/BSE, OHLC, volume, avg price, circuits, 52w
export default function QuoteHeader({ symbol, quote, exchange, onExchangeChange, onBuy, onSell }) {
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

  const ohlc = [
    { l: 'Open', v: q.open != null ? fmtINR(q.open) : '—' },
    { l: 'High', v: q.high != null ? fmtINR(q.high) : '—' },
    { l: 'Low', v: q.low != null ? fmtINR(q.low) : '—' },
    { l: 'Prev Close', v: q.previousClose ?? q.prevClose != null ? fmtINR(q.previousClose ?? q.prevClose) : '—' },
    { l: 'Volume', v: q.volume != null ? fmtN(q.volume) : '—' },
    { l: 'Avg Price', v: q.vwap ?? q.averagePrice != null ? fmtINR(q.vwap ?? q.averagePrice) : '—' },
    { l: 'Lower Circuit', v: q.lowerCircuit != null ? fmtINR(q.lowerCircuit) : '—' },
    { l: 'Upper Circuit', v: q.upperCircuit != null ? fmtINR(q.upperCircuit) : '—' },
    { l: '52W H / L', v: (q.fiftyTwoWeekHigh ?? q.high52 ?? q.low52 ?? q.fiftyTwoWeekLow) ? `${q.fiftyTwoWeekHigh != null ? fmtN(q.fiftyTwoWeekHigh) : (q.high52 != null ? fmtN(q.high52) : '—')} / ${q.fiftyTwoWeekLow != null ? fmtN(q.fiftyTwoWeekLow) : (q.low52 != null ? fmtN(q.low52) : '—')}` : '—' },
    { l: 'Mkt Cap', v: q.marketCap != null ? fmtN(q.marketCap) : '—' },
    { l: 'Feed', v: q.freshness ? `${q.freshness}${q.source ? ` · ${q.source}` : ''}` : '—' },
  ];

  return (
    <div className="kite-quote">
      <div>
        <div className="kite-quote-sym">
          {symbol || '—'}
          <div className="kite-exch-toggle">
            {['NSE', 'BSE'].map(e => (
              <button key={e} className={exch === e ? 'active' : ''} onClick={() => setExchange(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {q.name || q.shortName || 'NSE Equity'} · EQ · Tick 0.05 · ISIN — · Lot 1
        </div>
      </div>
      <div>
        <div className="kite-quote-px" style={{ color: gain ? 'var(--gain)' : 'var(--loss)' }}>
          {ltp ? fmtINR(ltp) : '—'}
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
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button className="kite-submit buy" style={{ padding: '8px 20px' }} onClick={onBuy}>B BUY</button>
        <button className="kite-submit sell" style={{ padding: '8px 20px' }} onClick={onSell}>S SELL</button>
      </div>
    </div>
  );
}
