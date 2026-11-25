import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, History, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';
import {
  AccountMode,
  api,
  DemoArchiveDTO,
  formatINR,
  LedgerEntryDTO,
  TradingAccountDTO,
} from '../apiClient';

interface FundsPageProps {
  mode: AccountMode;
  account: TradingAccountDTO;
  onAccountsUpdated: (accounts: TradingAccountDTO[]) => void;
}

const DEMO_PRESETS = [
  { label: '₹1,000', value: 1000 },
  { label: '₹10,000', value: 10000 },
  { label: '₹2,00,000', value: 200000 },
  { label: '₹10,00,000', value: 1000000 },
  { label: '₹1,00,00,000 (1 Cr)', value: 10000000 },
];

export function FundsPage({ mode, account, onAccountsUpdated }: FundsPageProps) {
  const [entries, setEntries] = useState<LedgerEntryDTO[]>([]);
  const [archives, setArchives] = useState<DemoArchiveDTO[]>([]);
  const [realSummary, setRealSummary] = useState<Awaited<ReturnType<typeof api.realFundingSummary>> | null>(null);

  const [amountInput, setAmountInput] = useState('200000');
  const [depAmount, setDepAmount] = useState('25000');
  const [depRail, setDepRail] = useState<'UPI' | 'NETBANKING'>('UPI');
  const [upiId, setUpiId] = useState('trader@upi');
  const [wdAmount, setWdAmount] = useState('5000');
  const [wdBank, setWdBank] = useState('XXXX-8821');
  const [wdIfsc, setWdIfsc] = useState('HDFC0001234');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const ledgerRes = await api.ledger(mode);
      setEntries(ledgerRes.entries);
      if (mode === 'DEMO') {
        const archRes = await api.demoArchives();
        setArchives(archRes.archives);
        setRealSummary(null);
      } else {
        const rs = await api.realFundingSummary();
        setRealSummary(rs);
        setArchives([]);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [mode]);

  useEffect(() => {
    setMessage(null);
    setError(null);
    loadData();
  }, [loadData]);

  const handleSetDemoBalance = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.setDemoBalance(amountInput);
      const refreshed = await api.accounts();
      onAccountsUpdated(refreshed.accounts);
      await loadData();
      setMessage(
        `DEMO balance updated to ${formatINR(res.account.cashBalance)} (Epoch #${res.account.resetEpoch}). Sealed on Blockchain Block #${res.blockchainProof.blockIndex} (${res.blockchainProof.hash.slice(0, 14)}...).`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRealDeposit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.depositRealFunds({
        amount: depAmount,
        rail: depRail,
        upiId: depRail === 'UPI' ? upiId : undefined,
        bankCode: depRail === 'NETBANKING' ? 'HDFC' : undefined,
      });
      const refreshed = await api.accounts();
      onAccountsUpdated(refreshed.accounts);
      await loadData();
      setMessage(
        `REAL Deposit ${formatINR(res.receipt.amount)} via ${res.receipt.rail} (Ref ${res.receipt.utr}) credited. Sealed on Blockchain Block #${res.blockchainProof.blockIndex}.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRealWithdraw = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.withdrawRealFunds({
        amount: wdAmount,
        bankAccountMasked: wdBank,
        ifsc: wdIfsc.toUpperCase(),
      });
      const refreshed = await api.accounts();
      onAccountsUpdated(refreshed.accounts);
      await loadData();
      setMessage(
        `REAL Withdrawal ${formatINR(res.receipt.amount)} initiated (Ref ${res.receipt.payoutRef}). Sealed on Blockchain Block #${res.blockchainProof.blockIndex}.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isZeroDemo = mode === 'DEMO' && Number(account.cashBalance) === 0 && entries.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card-grid">
        <div className="card">
          <h3><Wallet size={15} /> {mode} Cash Balance</h3>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{formatINR(account.cashBalance)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Epoch #{account.resetEpoch} • Isolated {mode} ledger
          </div>
        </div>
        <div className="card">
          <h3>Blocked Margin</h3>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{formatINR(account.blockedMargin)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Upfront VaR + ELM / SPAN + Exposure
          </div>
        </div>
        <div className="card">
          <h3>{mode === 'REAL' ? 'Settled Withdrawable Cash' : 'Available to Trade'}</h3>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: 'var(--gain)' }}>
            {mode === 'REAL' && realSummary ? formatINR(realSummary.withdrawableBalance) : formatINR(account.availableMargin)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {mode === 'REAL' && realSummary
              ? `Unsettled T+1 sell credits: ${formatINR(realSummary.unsettledT1Proceeds)}`
              : 'Charges apply identically in DEMO & REAL'}
          </div>
        </div>
      </div>

      {message && <div className="alert-success">{message}</div>}
      {error && <div className="alert-error">{error}</div>}

      {mode === 'DEMO' ? (
        <section className="card">
          <h3><RotateCcw size={15} /> {isZeroDemo ? 'Set Initial DEMO Virtual Balance' : 'Reset DEMO Virtual Balance'}</h3>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Choose any virtual amount between <strong>₹1,000</strong> and <strong>₹1,00,00,000 (1 Crore)</strong>.
            Resetting clears active positions &amp; open orders, archives your outgoing epoch summary, and seals a new
            SHA-256 blockchain proof.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {DEMO_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className="preset-btn"
                onClick={() => setAmountInput(String(p.value))}
              >
                {p.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSetDemoBalance} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input mono"
              style={{ maxWidth: 260 }}
              type="number"
              min={1000}
              max={10000000}
              step="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={busy}>
              <ShieldCheck size={15} />
              {busy ? 'Sealing...' : isZeroDemo ? 'Set DEMO Balance' : 'Reset & Archive DEMO Account'}
            </button>
          </form>
        </section>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <section className="card">
            <h3><ArrowDownLeft size={15} /> Deposit REAL Funds ({realSummary?.gateway.isMock ? 'Mock Gateway' : 'Live'})</h3>
            <form onSubmit={handleRealDeposit} className="form-stack">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label className="field">
                  <span>Amount (₹)</span>
                  <input className="input mono" type="number" min={100} value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
                </label>
                <label className="field">
                  <span>Payment Rail</span>
                  <select className="input" value={depRail} onChange={(e) => setDepRail(e.target.value as 'UPI' | 'NETBANKING')}>
                    <option value="UPI">UPI</option>
                    <option value="NETBANKING">NetBanking (IMPS/NEFT)</option>
                  </select>
                </label>
              </div>
              {depRail === 'UPI' && (
                <label className="field">
                  <span>UPI ID</span>
                  <input className="input" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
                </label>
              )}
              <button className="btn-primary" type="submit" disabled={busy}>
                <ShieldCheck size={14} /> Deposit {formatINR(depAmount)} (REAL)
              </button>
            </form>
          </section>

          <section className="card">
            <h3><ArrowUpRight size={15} /> Withdraw Settled REAL Funds (T+1 Rule)</h3>
            <form onSubmit={handleRealWithdraw} className="form-stack">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label className="field">
                  <span>Amount (₹)</span>
                  <input className="input mono" type="number" min={100} value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} />
                </label>
                <label className="field">
                  <span>Bank IFSC</span>
                  <input className="input mono" value={wdIfsc} onChange={(e) => setWdIfsc(e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>Linked Bank Account</span>
                <input className="input mono" value={wdBank} onChange={(e) => setWdBank(e.target.value)} />
              </label>
              <button className="btn-primary" type="submit" disabled={busy}>
                Withdraw {formatINR(wdAmount)}
              </button>
            </form>
            {realSummary && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{realSummary.settlementNote}</div>
            )}
          </section>
        </div>
      )}

      {mode === 'REAL' && realSummary?.brokerCompliance && (
        <section className="card">
          <h3>SEBI Going-Live Broker Licensing Checklist ({realSummary.brokerCompliance.adapterMode})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {realSummary.brokerCompliance.mandatoryPrerequisites.map((p) => (
              <div key={p.requirement} style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.requirement}</div>
                <span className="badge badge-warn">{p.status}</span>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{p.details}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h3>Double-Entry Funds Ledger ({mode})</h3>
        {entries.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            No ledger entries recorded yet for your {mode} account.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Epoch</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Debit</th>
                  <th style={{ textAlign: 'right' }}>Credit</th>
                  <th style={{ textAlign: 'right' }}>Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{new Date(row.createdAt).toLocaleString('en-IN')}</td>
                    <td className="mono">#{row.epoch}</td>
                    <td><span className="badge">{row.entryType}</span></td>
                    <td>{row.description}</td>
                    <td className="mono" style={{ textAlign: 'right', color: Number(row.debit) > 0 ? 'var(--loss)' : 'var(--text-muted)' }}>
                      {formatINR(row.debit)}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: Number(row.credit) > 0 ? 'var(--gain)' : 'var(--text-muted)' }}>
                      {formatINR(row.credit)}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {formatINR(row.runningBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {mode === 'DEMO' && archives.length > 0 && (
        <section className="card">
          <h3><History size={15} /> Archived DEMO Reset History</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Epoch</th>
                  <th>Starting Balance</th>
                  <th>Ending Cash</th>
                  <th>Realized P&amp;L</th>
                  <th>Total Trades</th>
                  <th>Archived At</th>
                </tr>
              </thead>
              <tbody>
                {archives.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">#{a.epoch}</td>
                    <td className="mono">{formatINR(a.startingBalance)}</td>
                    <td className="mono">{formatINR(a.endingCashBalance)}</td>
                    <td className="mono">{formatINR(a.realizedPnl)}</td>
                    <td className="mono">{a.totalTrades}</td>
                    <td className="mono">{new Date(a.archivedAt).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
