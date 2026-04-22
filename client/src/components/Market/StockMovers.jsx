import { useState } from 'react';
import { TrendingUp, TrendingDown, Activity, ExternalLink } from 'lucide-react';

const TABS = [
  { id: 'active',  label: 'Active by Volume', icon: Activity    },
  { id: 'gainers', label: 'Top Gainers',       icon: TrendingUp  },
  { id: 'losers',  label: 'Top Losers',         icon: TrendingDown },
];

function fmtVol(n)   { if (!n) return '—'; if (n >= 1e7) return (n/1e7).toFixed(1)+'Cr'; if (n >= 1e5) return (n/1e5).toFixed(1)+'L'; return n.toLocaleString('en-IN'); }
function fmtPrice(n) { return n?.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})||'—'; }

export default function StockMovers({ data, loading, onOpenChart }) {
  const [tab, setTab]       = useState('active');
  const [hover, setHover]   = useState(null);

  const rows = data[tab] || [];
  const TabIcon = TABS.find(t => t.id === tab)?.icon || Activity;

  return (
    <div>
      {/* Header */}
      <div className="movers-header">
        <div className="movers-title" style={{ display:'flex', alignItems:'center', gap:6 }}>
          <TabIcon size={15} style={{ color:'var(--accent-primary)' }} />
          Stock Movement
          <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:400 }}>(Nifty 500)</span>
        </div>
        <div className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display:'flex',flexDirection:'column',gap:8,marginTop:8 }}>
          {[...Array(6)].map((_,i)=><div key={i} className="skeleton" style={{height:36,borderRadius:8}} />)}
        </div>
      ) : (
        <table className="movers-table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{textAlign:'right'}}>LTP</th>
              <th style={{textAlign:'right'}}>Change</th>
              <th style={{textAlign:'right'}}>Volume</th>
              <th style={{textAlign:'right',width:32}} />
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const isGain = s.changePercent >= 0;
              return (
                <tr
                  key={s.symbol}
                  style={{ cursor:'pointer' }}
                  onMouseEnter={()=>setHover(s.symbol)}
                  onMouseLeave={()=>setHover(null)}
                  onClick={()=>onOpenChart && onOpenChart(s.symbol+'.NS', { shortName: s.shortName, price: s.price, changePercent: s.changePercent })}
                >
                  <td>
                    <div className="mover-symbol">{s.symbol}</div>
                    <div className="mover-name">{s.shortName}</div>
                  </td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--text-primary)'}}>
                    ₹{fmtPrice(s.price)}
                  </td>
                  <td style={{textAlign:'right'}}>
                    <span className={`mover-change-pill ${isGain?'gain':'loss'}`}>
                      {isGain?'▲':'▼'} {Math.abs(s.changePercent).toFixed(2)}%
                    </span>
                  </td>
                  <td style={{textAlign:'right',color:'var(--text-muted)',fontFamily:'var(--font-mono)',fontSize:11}}>
                    {fmtVol(s.volume)}
                  </td>
                  <td style={{textAlign:'right'}}>
                    {hover===s.symbol && (
                      <ExternalLink size={12} style={{color:'var(--accent-primary)'}} />
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length===0 && (
              <tr><td colSpan={5} style={{textAlign:'center',color:'var(--text-muted)',padding:20}}>No data available</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
