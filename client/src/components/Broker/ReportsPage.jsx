import { useEffect, useState } from 'react';
import { BookText, PieChart, ShoppingBasket, Download, Plus, Trash2, Send } from 'lucide-react';
import api from '../../services/api';
import './Kite.css';

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Ledger (funds statement) ──
export function LedgerPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getLedger().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <BookText size={17} style={{ color: 'var(--accent-primary)' }} /> Ledger · Funds Statement
      </h2>
      <div className="card">
        {loading ? <div style={{ padding: 20, textAlign: 'center' }}><div className="spinner" /></div>
          : (data?.entries?.length ?? 0) === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No entries yet. Every fill, charge and settlement posts here — like a real broker ledger.
            </div>
          ) : (
            <div className="scroll-x"><table className="kite-table">
              <thead><tr><th>Date</th><th>Narration</th><th style={{ textAlign: 'right' }}>Turnover</th><th style={{ textAlign: 'right' }}>Charges</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead>
              <tbody>
                {[...(data.entries || [])].reverse().map((e, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(e.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style={{ fontWeight: 600 }}>{e.label}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(e.turnover)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtINR(e.charges)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(e.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        Balance: <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmtINR(data?.balance)}</b> · Paper ledger is derived from fills (no schema change).
      </div>
    </div>
  );
}

// ── P&L + tax-ready ──
export function PnlPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getPnlReport().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <PieChart size={17} style={{ color: 'var(--accent-primary)' }} /> P&L · Tax Report
        </h2>
        <a href="/api/ext/pnl?format=csv" download="pnl.csv" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-secondary)', textDecoration: 'none' }}>
          <Download size={13} /> CSV
        </a>
      </div>
      {loading ? <div className="card" style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div> : (
        <>
          <div className="kite-funds-grid">
            <div className="kite-fund-card"><div className="lbl">Realized P&L</div><div className="val" style={{ color: (data?.realizedPL ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(data?.realizedPL)}</div></div>
            <div className="kite-fund-card"><div className="lbl">Unrealized P&L</div><div className="val" style={{ color: (data?.unrealizedPL ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(data?.unrealizedPL)}</div></div>
            <div className="kite-fund-card"><div className="lbl">Turnover</div><div className="val">{fmtINR(data?.turnover)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data?.tradeCount ?? 0} trades</div></div>
            <div className="kite-fund-card"><div className="lbl">STT + Brokerage paid</div><div className="val">{fmtINR((data?.sttPaid ?? 0) + (data?.brokeragePaid ?? 0))}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>STT {fmtINR(data?.sttPaid)} · Brk {fmtINR(data?.brokeragePaid)}</div></div>
          </div>
          <div className="card">
            <div className="section-title" style={{ marginBottom: 8 }}>Open positions (live)</div>
            <div className="scroll-x"><table className="kite-table">
              <thead><tr><th>Symbol</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Avg</th><th style={{ textAlign: 'right' }}>LTP</th><th style={{ textAlign: 'right' }}>Unrealized</th></tr></thead>
              <tbody>
                {(data?.positions || []).map(p => (
                  <tr key={p.symbol}>
                    <td style={{ fontWeight: 800 }}>{p.symbol}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.qty}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(p.avg)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(p.ltp)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: p.upl >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(p.upl)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{data?.taxNote}</div>
        </>
      )}
    </div>
  );
}

// ── Basket orders (multi-leg, atomic) ──
export function BasketPage({ showToast }) {
  const [legs, setLegs] = useState([
    { symbol: 'RELIANCE', side: 'buy', quantity: 1, price: 0, orderType: 'limit', productType: 'CNC' },
    { symbol: 'TCS', side: 'buy', quantity: 1, price: 0, orderType: 'limit', productType: 'CNC' },
  ]);
  const [placing, setPlacing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const setLeg = (i, k, v) => setLegs(prev => prev.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const place = async () => {
    setPlacing(true);
    try {
      const payload = legs.map(l => ({ ...l, quantity: Number(l.quantity), price: Number(l.price) }));
      const res = await api.placeBasket(payload);
      setLastResult(res);
      showToast?.(`Basket ${res.basketId.slice(0, 8)}… — ${res.results.filter(r => r.success).length}/${res.results.length} accepted`);
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <ShoppingBasket size={17} style={{ color: 'var(--accent-primary)' }} /> Basket Orders
      </h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Up to 20 legs, executed atomically like Zerodha baskets — hedge futures with options, or SIP a set of stocks in one tap.
      </div>
      <div className="card">
        {legs.map((l, i) => (
          <div key={i} className="kite-leg">
            <input value={l.symbol} onChange={e => setLeg(i, 'symbol', e.target.value.toUpperCase())} placeholder="SYMBOL" />
            <select value={l.side} onChange={e => setLeg(i, 'side', e.target.value)}>
              <option value="buy">BUY</option><option value="sell">SELL</option>
            </select>
            <input type="number" value={l.quantity} min={1} onChange={e => setLeg(i, 'quantity', e.target.value)} placeholder="Qty" />
            <input type="number" value={l.price} onChange={e => setLeg(i, 'price', e.target.value)} placeholder="Price ₹" />
            <button className="kite-action-link danger" onClick={() => setLegs(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setLegs(p => [...p, { symbol: '', side: 'buy', quantity: 1, price: 0, orderType: 'limit', productType: 'CNC' }])}>
            <Plus size={13} /> Add leg ({legs.length}/20)
          </button>
          <button className="kite-submit buy" style={{ marginLeft: 'auto' }} disabled={placing || legs.length === 0} onClick={place}>
            <Send size={13} style={{ verticalAlign: -2 }} /> {placing ? 'Placing…' : `Execute basket (${legs.length} legs)`}
          </button>
        </div>
      </div>
      {lastResult && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>Result · {lastResult.basketId}</div>
          <table className="kite-table">
            <thead><tr><th>Symbol</th><th>Status</th><th>Order</th><th>Note</th></tr></thead>
            <tbody>
              {lastResult.results.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{r.symbol}</td>
                  <td><span className={`kite-chip ${r.success ? 'filled' : 'rejected'}`}>{r.success ? (r.status || 'OK') : 'FAILED'}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.orderId?.slice(0, 8) ?? '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.violations?.[0]?.message || r.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
