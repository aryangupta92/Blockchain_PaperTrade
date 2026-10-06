import { useEffect, useState } from 'react';
import api from '../../services/api';
import './Kite.css';

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return `${Number(n) >= 0 ? '+' : ''}${Number(n || 0).toFixed(2)}%`;
}

// Kite parity: Day's Positions (MIS/intraday + intraday P&L) vs Holdings (CNC delivery)
// Our OMS stores productType on orders but holdings are net — we reconstruct product
// from recent orders: last order's productType wins; fallback CNC.
export default function PositionsBook({ quotes, onExit, compact }) {
  const [orders, setOrders] = useState([]);
  const [positions, setPositions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [squaring, setSquaring] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ordRes, portRes] = await Promise.all([
        api.getOrders().catch(() => ({ orders: [] })),
        api.getPortfolioSummary().catch(() => null),
      ]);
      setOrders(ordRes.orders || []);
      setSummary(portRes);
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
        const dayPL = h.quantity * ((quotes[sym]?.change ?? quotes[h.tradingSymbol]?.change ?? 0));
        return { ...h, sym, product, ltp, upl, dayPL };
      });
      setPositions(pos);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => {
    // re-price live without refetch
    setPositions(prev => prev.map(p => {
      const ltp = quotes[p.sym]?.price ?? quotes[p.tradingSymbol]?.price ?? p.ltp;
      return { ...p, ltp, upl: (ltp - p.avgPrice) * p.quantity };
    }));
  }, [quotes]);

  const intraday = positions.filter(p => ['MIS', 'INTRADAY'].includes(String(p.product).toUpperCase()));
  const delivery = positions.filter(p => !['MIS', 'INTRADAY'].includes(String(p.product).toUpperCase()));

  const dayPL = positions.reduce((s, p) => s + (p.dayPL || 0), 0);
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
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: (p.dayPL ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
          {(p.dayPL ?? 0) >= 0 ? '+' : ''}{fmtINR(p.dayPL ?? 0)}
        </td>
        <td style={{ textAlign: 'right' }}>
          <button className="kite-action-link danger" onClick={() => onExit?.(p.sym, p.ltp, p.quantity)}>EXIT</button>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>
          Day P&L <span style={{ fontFamily: 'var(--font-mono)', color: dayPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{dayPL >= 0 ? '+' : ''}{fmtINR(dayPL)}</span>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}> · Total P&L </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: totalPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{totalPL >= 0 ? '+' : ''}{fmtINR(totalPL)}</span>
        </div>
        {intraday.length > 0 && (
          <button className="btn btn-ghost" style={{ fontSize: 11, marginLeft: 'auto' }} onClick={squareOffMIS} disabled={squaring}>
            {squaring ? 'Squaring off…' : `Square-off all MIS (${intraday.length}) · 15:15 auto`}
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Positions · Intraday / F&O ({intraday.length})</div>
        {intraday.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>No intraday positions. MIS orders appear here with 5x leverage and auto square-off at 15:15 IST.</div>
        ) : (
          <div className="scroll-x"><table className="kite-table">
            <thead><tr><th>Instrument</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Avg</th><th style={{ textAlign: 'right' }}>LTP</th><th style={{ textAlign: 'right' }}>P&L</th><th style={{ textAlign: 'right' }}>Day P&L</th><th /></tr></thead>
            <tbody>{intraday.map(Row)}</tbody>
          </table></div>
        )}
      </div>

      {!compact && (
        <div className="card">
          <div className="section-title" style={{ marginBottom: 8 }}>Holdings · Delivery CNC ({delivery.length}) <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>· T+1 settlement</span></div>
          {delivery.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>No delivery holdings. CNC buys settle T+1 and stay here.</div>
          ) : (
            <div className="scroll-x"><table className="kite-table">
              <thead><tr><th>Instrument</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Avg cost</th><th style={{ textAlign: 'right' }}>LTP</th><th style={{ textAlign: 'right' }}>P&L</th><th style={{ textAlign: 'right' }}>Day P&L</th><th /></tr></thead>
              <tbody>{delivery.map(Row)}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
