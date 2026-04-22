import { useState } from 'react';
import { Plus, Trash2, Eye } from 'lucide-react';

const ALL_STOCKS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'WIPRO', 'BAJFINANCE',
  'BHARTIARTL', 'AXISBANK', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'MARUTI', 'SUNPHARMA', 'TITAN'];

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

export default function WatchlistPage({ watchlist, quotes, onAdd, onRemove, onTrade }) {
  const [newSymbol, setNewSymbol] = useState('');

  const handleAdd = () => {
    const s = newSymbol.trim().toUpperCase();
    if (s) { onAdd(s); setNewSymbol(''); }
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={16} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Watchlist</h2>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({watchlist.length} stocks)</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="input" style={{ width: 160 }} value={newSymbol} onChange={e => setNewSymbol(e.target.value)}>
            <option value="">Add symbol…</option>
            {ALL_STOCKS.filter(s => !watchlist.includes(s)).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-primary" onClick={handleAdd}><Plus size={14} /> Add</button>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th style={{ textAlign: 'right' }}>LTP</th>
              <th style={{ textAlign: 'right' }}>Change</th>
              <th style={{ textAlign: 'right' }}>% Change</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map(symbol => {
              const q = quotes[symbol] || null;
              const isGain = (q?.changePercent || 0) >= 0;
              return (
                <tr key={symbol}>
                  <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: isGain ? 'var(--gain)' : 'var(--loss)' }}>
                    {q ? '₹' + fmtPrice(q.price) : <span className="skeleton" style={{ height: 14, width: 60, display: 'inline-block' }} />}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: isGain ? 'var(--gain)' : 'var(--loss)' }}>
                    {q ? (isGain ? '+' : '') + q.change?.toFixed(2) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {q ? <span className={`mover-change-pill ${isGain ? 'gain' : 'loss'}`}>{isGain ? '+' : ''}{q.changePercent?.toFixed(2)}%</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {q?.volume ? (q.volume / 1e5).toFixed(1) + 'L' : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onTrade}>Trade</button>
                    <button onClick={() => onRemove(symbol)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 6px', marginLeft: 4 }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {watchlist.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Your watchlist is empty. Add some stocks!</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
