import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Plus, RotateCcw } from 'lucide-react';
import api from '../../services/api';
import './Kite.css';

function fmtINR(n) {
  if (n == null) return '₹0.00';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Zerodha Funds layout: Available margin / Used margin / Opening / Holdings value + statement
export default function FundsPage({ balance, quotes, holdings, showToast }) {
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api.getPortfolioSummary().catch(() => null),
        api.getLedger().catch(() => null),
      ]);
      setSummary(s);
      setLedger(l);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const liveCash = summary?.cash ?? balance ?? 0;
  const invested = summary?.totalInvested ?? 0;
  const currentVal = summary?.totalCurrentValue ?? 0;
  const used = Math.max(0, invested - Math.min(0, currentVal));
  const opening = ledger?.entries?.length ? liveCash : liveCash;
  const payinTotal = (ledger?.entries || []).filter(e => e.side === 'SELL').reduce((s, e) => s + (e.turnover || 0), 0);
  const payoutTotal = (ledger?.entries || []).filter(e => e.side === 'BUY').reduce((s, e) => s + (e.turnover || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wallet size={17} style={{ color: 'var(--accent-primary)' }} /> Funds · Margin Statement
        </h2>
        <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ fontSize: 12 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="kite-funds-grid">
        <div className="kite-fund-card">
          <div className="lbl">Available margin</div>
          <div className="val" style={{ color: 'var(--gain)' }}>{fmtINR(liveCash)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Cash + collateral · withdrawable</div>
        </div>
        <div className="kite-fund-card">
          <div className="lbl">Used margin</div>
          <div className="val">{fmtINR(summary?.totalInvested ?? invested)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Blocked in CNC / NRML / MIS positions</div>
        </div>
        <div className="kite-fund-card">
          <div className="lbl">Holdings value (live)</div>
          <div className="val">{fmtINR(currentVal)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{summary?.positionCount ?? 0} open positions</div>
        </div>
        <div className="kite-fund-card">
          <div className="lbl">Opening balance (today)</div>
          <div className="val">{fmtINR(opening)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Payin {fmtINR(payinTotal)} · Payout {fmtINR(payoutTotal)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="kite-chip cnc">CNC 1x · delivery</span>
          <span className="kite-chip mis">MIS 5x · auto SQ-OFF 15:15 IST</span>
          <span className="kite-chip nrml">NRML · F&O overnight SPAN + exposure</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            Paper mode — payin/payout are virtual. Real brokers settle T+1 with CDSL/NSCCL.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn-gain" style={{ fontSize: 12 }}
            onClick={() => showToast?.('Paper mode: funds are virtual. Add capital via Subscription → renew plan.', 'info')}
          >
            <Plus size={13} /> Add funds (paper)
          </button>
          <button
            className="btn btn-ghost" style={{ fontSize: 12 }}
            onClick={() => showToast?.('Paper mode: withdrawals disabled. Reset by renewing subscription.', 'info')}
          >
            <RotateCcw size={13} /> Withdraw
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Funds ledger (derived from executions)</div>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center' }}><div className="spinner" /></div>
        ) : (ledger?.entries?.length ?? 0) === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No ledger entries yet — place a trade. Real brokers show payin, payout, brokerage, STT, DP charges here.
          </div>
        ) : (
          <div className="scroll-x">
            <table className="kite-table">
              <thead><tr><th>Date</th><th>Narration</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Charges</th></tr></thead>
              <tbody>
                {(ledger.entries || []).slice(-25).reverse().map((e, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(e.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style={{ fontWeight: 600 }}>{e.label}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--loss)' }}>{e.side === 'BUY' ? fmtINR(e.turnover) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--gain)' }}>{e.side === 'SELL' ? fmtINR(e.turnover) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtINR(e.charges)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
