import { useEffect, useState } from 'react';
import { Briefcase, RefreshCw, Zap, X } from 'lucide-react';
import api from '../../services/api';
import ReactMarkdown from 'react-markdown';
import '../Broker/Kite.css';

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return `${Number(n) >= 0 ? '+' : ''}${Number(n || 0).toFixed(2)}%`;
}

// Kite Holdings: Instrument | Qty | Avg cost | LTP | Invested | Current | P&L | Net chg | Day chg
// T+1 settlement note, Day P&L split, live LTP from quotes with server fallback
export default function PortfolioPage({ holdings, quotes, balance, initialBalance, onTrade }) {
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiInsight, setAiInsight] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.getPortfolioSummary().catch(() => null);
      setServer(s);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const rows = (server?.holdings?.length ? server.holdings : Object.entries(holdings || {}).map(([tradingSymbol, h]) => {
    const sym = tradingSymbol.replace('.NS', '').replace('.BO', '');
    const ltp = quotes[sym]?.price ?? quotes[tradingSymbol]?.price ?? h.avgPrice;
    return {
      tradingSymbol, symbol: sym, quantity: h.quantity, avgPrice: h.avgPrice, ltp,
      investedValue: Math.abs(h.quantity) * h.avgPrice,
      currentValue: h.quantity * ltp,
      unrealizedPL: (ltp - h.avgPrice) * h.quantity,
      dayPL: h.quantity * (quotes[sym]?.change ?? 0),
      dayChangePct: quotes[sym]?.changePercent ?? 0,
      exchange: 'NSE',
    };
  })).map(h => {
    const sym = (h.symbol || h.tradingSymbol || '').replace('.NS', '').replace('.BO', '');
    const liveLtp = quotes[sym]?.price ?? quotes[h.tradingSymbol]?.price ?? h.ltp;
    const upl = (liveLtp - h.avgPrice) * h.quantity;
    return { ...h, sym, ltp: liveLtp, unrealizedPL: upl };
  });

  const totalInvested = rows.reduce((s, h) => s + (h.investedValue || Math.abs(h.quantity) * h.avgPrice || 0), 0);
  const totalCurrent = rows.reduce((s, h) => s + (h.currentValue || h.quantity * h.ltp || 0), 0);
  const totalPL = rows.reduce((s, h) => s + (h.unrealizedPL || 0), 0);
  const dayPL = rows.reduce((s, h) => s + (h.dayPL || h.quantity * (quotes[h.sym]?.change ?? 0) || 0), 0);
  const cash = server?.cash ?? balance ?? 0;
  const portfolioValue = cash + Math.max(0, totalCurrent);

  const fetchAiInsight = async () => {
    setShowAiModal(true);
    setAiLoading(true);
    try {
      const res = await api.getAIPortfolioRisk();
      setAiInsight(res.report);
    } catch {
      setAiInsight('Failed to fetch AI insights. Please check API keys.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={17} style={{ color: 'var(--accent-primary)' }} />
          Holdings <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>CNC delivery · T+1 settlement · {rows.length} stock(s)</span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={load} disabled={loading}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="btn-gain" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 12 }} onClick={fetchAiInsight}>
            <Zap size={13} /> AI Insights
          </button>
        </div>
      </div>

      {showAiModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '90%', maxWidth: 600, maxHeight: '80vh', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => setShowAiModal(false)} style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={18} /></button>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)', marginBottom: 14 }}><Zap size={16} /> AI Portfolio Insights</h3>
            {aiLoading ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Analyzing holdings…</div>
              : <div style={{ fontSize: 13, lineHeight: 1.6 }}><ReactMarkdown>{aiInsight}</ReactMarkdown></div>}
          </div>
        </div>
      )}

      <div className="kite-funds-grid">
        <div className="kite-fund-card"><div className="lbl">Total investment</div><div className="val">{fmtINR(totalInvested)}</div></div>
        <div className="kite-fund-card"><div className="lbl">Current value</div><div className="val">{fmtINR(totalCurrent)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cash {fmtINR(cash)} · Total {fmtINR(portfolioValue)}</div></div>
        <div className="kite-fund-card"><div className="lbl">Day's P&L</div><div className="val" style={{ color: dayPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{dayPL >= 0 ? '+' : ''}{fmtINR(dayPL)}</div></div>
        <div className="kite-fund-card"><div className="lbl">Total P&L</div><div className="val" style={{ color: totalPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{totalPL >= 0 ? '+' : ''}{fmtINR(totalPL)}</div><div style={{ fontSize: 11, color: totalPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtPct(totalInvested ? (totalPL / totalInvested) * 100 : 0)}</div></div>
      </div>

      <div className="card">
        {loading && rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 0', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>No holdings</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>CNC buys appear here after T+1. MIS intraday stays in Positions and auto-squares at 15:15.</div>
          </div>
        ) : (
          <div className="scroll-x">
            <table className="kite-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Avg cost</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Invested</th>
                  <th style={{ textAlign: 'right' }}>Current</th>
                  <th style={{ textAlign: 'right' }}>P&L</th>
                  <th style={{ textAlign: 'right' }}>Net chg</th>
                  <th style={{ textAlign: 'right' }}>Day chg</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(h => {
                  const gain = (h.unrealizedPL ?? 0) >= 0;
                  const invested = h.investedValue ?? Math.abs(h.quantity) * h.avgPrice;
                  const cur = h.currentValue ?? h.quantity * h.ltp;
                  const netPct = invested ? ((h.unrealizedPL ?? 0) / invested) * 100 : 0;
                  const dayPct = h.dayChangePct ?? quotes[h.sym]?.changePercent ?? 0;
                  const isShort = h.quantity < 0;
                  return (
                    <tr key={h.tradingSymbol || h.sym}>
                      <td style={{ fontWeight: 800 }}>{h.sym}
                        <div style={{ marginTop: 3 }}><span className="kite-chip cnc">CNC</span> <span className="kite-exch">{h.exchange || 'NSE'}</span></div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{h.quantity}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(h.avgPrice)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: (dayPct ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(h.ltp)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(invested)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtINR(Math.abs(cur))}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: gain ? 'var(--gain)' : 'var(--loss)' }}>
                        {gain ? '+' : ''}{fmtINR(h.unrealizedPL)}
                      </td>
                      <td style={{ textAlign: 'right' }}><span className={`kite-chip ${gain ? 'filled' : 'rejected'}`}>{fmtPct(netPct)}</span></td>
                      <td style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: (dayPct ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtPct(dayPct)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="kite-action-link danger"
                          onClick={() => onTrade?.({ type: isShort ? 'buy' : 'sell', symbol: h.sym, quantity: Math.abs(h.quantity), price: h.ltp, orderType: 'market', productType: 'CNC' })}
                        >EXIT</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        Holdings show CNC delivery only (T+1). Intraday MIS lives in Positions with 15:15 IST auto square-off — exactly like Zerodha/Upstox.
      </div>
    </div>
  );
}
