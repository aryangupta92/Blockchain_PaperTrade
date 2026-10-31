import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../services/api';
import './Kite.css';

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return `${Number(n) >= 0 ? '+' : ''}${Number(n || 0).toFixed(2)}%`;
}

// Single, tidy positions book. One summary line, one table — no duplicated
// Position / Order / Day P&L / Holdings panels.
export default function PositionsBook({ quotes, onExit, compact }) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [squaring, setSquaring] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ordRes, portRes] = await Promise.all([
        api.getOrders().catch(() => ({ orders: [] })),
        api.getPortfolioSummary().catch(() => null),
      ]);
      const bySym = {};
      (ordRes.orders || []).forEach(o => {
        const sym = o.instrument?.tradingSymbol?.replace('.NS', '').replace('.BO', '') || '—';
        if (!bySym[sym]) bySym[sym] = o;
      });
      const pos = (portRes?.holdings || []).map(h => {
        const sym = h.tradingSymbol?.replace('.NS', '').replace('.BO', '');
        const lastOrder = bySym[sym] || bySym[h.tradingSymbol];
        const product = lastOrder?.productType || 'CNC';
        const ltp = quotes[sym]?.price ?? quotes[h.tradingSymbol]?.price ?? h.ltp;
        const upl = (ltp - h.avgPrice) * h.quantity;
        return { ...h, sym, product, ltp, upl };
      });
      setPositions(pos);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => {
    setPositions(prev => prev.map(p => {
      const ltp = quotes[p.sym]?.price ?? quotes[p.tradingSymbol]?.price ?? p.ltp;
      return { ...p, ltp, upl: (ltp - p.avgPrice) * p.quantity };
    }));
  }, [quotes]);

  const intraday = positions.filter(p => ['MIS', 'INTRADAY'].includes(String(p.product).toUpperCase()));
  const totalPL = positions.reduce((s, p) => s + (p.upl || 0), 0);

  const squareOffMIS = async () => {
    if (!window.confirm('Square off ALL MIS/intraday positions at market? (like Kite Square-off)')) return;
    setSquaring(true);
    try {
      await api.squareOffAll();
      await load();
    } catch (e) { alert(e.message); }
    finally { setSquaring(false); }
  };

  if (loading) return <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div>;

  const Row = (p) => {
    const gain = p.upl >= 0;
    return (
      <tr key={p.tradingSymbol}>
        <td style={{ fontWeight: 800 }}>{p.sym}
          <div style={{ marginTop: 3 }}><span className={`kite-chip ${String(p.product).toLowerCase()}`}>{p.product}</span> <span className="kite-exch">NSE</span></div>
        </td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{p.quantity}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(p.avgPrice)}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: gain ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(p.ltp)}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: gain ? 'var(--gain)' : 'var(--loss)' }}>
          {gain ? '+' : ''}{fmtINR(p.upl)} <span style={{ fontSize: 10 }}>({fmtPct(p.investedValue ? (p.upl / p.investedValue) * 100 : 0)})</span>
        </td>
        <td style={{ textAlign: 'right' }}>
          <button className="kite-action-link danger" onClick={() => onExit?.(p.sym, p.ltp, p.quantity)}>EXIT</button>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="kite-positions-head">
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>
          Open positions <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>({positions.length})</span>
          <span style={{ marginLeft: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Net P&amp;L </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: totalPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
            {totalPL >= 0 ? '+' : ''}{fmtINR(totalPL)}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {intraday.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={squareOffMIS} disabled={squaring}>
              {squaring ? 'Squaring off…' : `Square-off MIS (${intraday.length})`}
            </button>
          )}
          <button className="btn btn-ghost" title="Refresh positions" onClick={load} style={{ padding: '5px 8px' }}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {positions.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '14px 0' }}>
          No open positions. Filled orders appear here with live mark-to-market P&amp;L.
        </div>
      ) : (
        <div className="scroll-x">
          <table className="kite-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Avg</th>
                <th style={{ textAlign: 'right' }}>LTP</th>
                <th style={{ textAlign: 'right' }}>P&amp;L</th>
                <th />
              </tr>
            </thead>
            <tbody>{positions.map(Row)}</tbody>
          </table>
        </div>
      )}
      {compact && positions.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
          P&amp;L is marked to the live feed · MIS auto square-off 15:15 IST
        </div>
      )}
    </div>
  );
}
