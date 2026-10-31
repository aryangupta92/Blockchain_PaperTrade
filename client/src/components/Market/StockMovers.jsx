import { useState } from 'react';
import { TrendingUp, TrendingDown, Activity, DollarSign, ExternalLink } from 'lucide-react';

const TABS = [
  { id: 'gainers', label: 'Top Gainers',       icon: TrendingUp   },
  { id: 'losers',  label: 'Top Losers',        icon: TrendingDown },
  { id: 'active',  label: 'Most Active (Vol)', icon: Activity     },
];

function fmtVol(n) {
  if (!n) return '—';
  if (n >= 1e7) return (n / 1e7).toFixed(1) + 'Cr';
  if (n >= 1e5) return (n / 1e5).toFixed(1) + 'L';
  return Number(n).toLocaleString('en-IN');
}

function fmtPrice(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StockMovers({ data = {}, loading, quotes = {}, onOpenChart }) {
  const [tab, setTab]     = useState('gainers');
  const [hover, setHover] = useState(null);

  const rawRows = data[tab] || [];
  const TabIcon = TABS.find(t => t.id === tab)?.icon || TrendingUp;

  return (
    <div className="stock-movers-widget">
      {/* Header */}
      <div className="movers-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="movers-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
          <TabIcon size={14} style={{ color: 'var(--accent-primary)' }} />
          Stock Movement
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>(Nifty 50)</span>
        </div>
        <div className="tabs" style={{ display: 'flex', gap: 4 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 36, borderRadius: 6 }} />
          ))}
        </div>
      ) : (
        <table className="movers-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ fontSize: 10, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>COMPANY</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>LTP</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>CHANGE</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>VOLUME</th>
              <th style={{ textAlign: 'right', width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {rawRows.map(s => {
              // Overlay live quote if available
              const symKey = s.symbol.endsWith('.NS') ? s.symbol : `${s.symbol}.NS`;
              const liveQ = quotes[symKey] || quotes[s.symbol] || null;
              const price = liveQ?.price || s.price;
              const change = liveQ?.change !== undefined ? liveQ.change : s.change;
              const changePercent = liveQ?.changePercent !== undefined ? liveQ.changePercent : s.changePercent;
              const isGain = (changePercent || 0) >= 0;

              return (
                <tr
                  key={s.symbol}
                  style={{
                    cursor: 'pointer',
                    transition: 'background 0.12s ease',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                  }}
                  onMouseEnter={() => setHover(s.symbol)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onOpenChart && onOpenChart(symKey, { shortName: s.shortName, price, changePercent })}
                >
                  <td style={{ padding: '8px' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-primary)' }}>{s.symbol}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                      {s.shortName || s.symbol}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--text-primary)' }}>
                    ₹{fmtPrice(price)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px' }}>
                    <span
                      className={`mover-change-pill ${isGain ? 'gain' : 'loss'}`}
                      style={{
                        fontSize: 10.5,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {isGain ? '▲ +' : '▼ '}{Math.abs(changePercent || 0).toFixed(2)}%
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {fmtVol(s.volume)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px' }}>
                    {hover === s.symbol && (
                      <ExternalLink size={12} style={{ color: 'var(--accent-primary)' }} />
                    )}
                  </td>
                </tr>
              );
            })}
            {rawRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  No stocks found in this category
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
