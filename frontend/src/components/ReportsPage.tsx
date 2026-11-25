import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface ReportsPageProps {
  mode: AccountMode;
}

export function ReportsPage({ mode }: ReportsPageProps) {
  const [tab, setTab] = useState<'tax' | 'notes'>('tax');
  const [tax, setTax] = useState<Awaited<ReturnType<typeof api.taxPnlReport>> | null>(null);
  const [notes, setNotes] = useState<Awaited<ReturnType<typeof api.contractNotes>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [t, n] = await Promise.all([api.taxPnlReport(mode), api.contractNotes(mode)]);
      setTax(t);
      setNotes(n);
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`preset-btn ${tab === 'tax' ? 'active' : ''}`} onClick={() => setTab('tax')}>
            FIFO Tax P&amp;L &amp; Charges ({mode})
          </button>
          <button className={`preset-btn ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
            Daily Contract Notes ({notes?.count ?? 0})
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="preset-btn" onClick={() => api.downloadCsvReport(mode, 'trades')}>
            <Download size={12} /> Trades CSV
          </button>
          <button className="preset-btn" onClick={() => api.downloadCsvReport(mode, 'ledger')}>
            <Download size={12} /> Ledger CSV
          </button>
          <button className="preset-btn" onClick={() => api.downloadCsvReport(mode, 'tax-pnl')}>
            <Download size={12} /> Tax P&amp;L CSV
          </button>
          <button className="theme-toggle" onClick={load} disabled={busy}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </section>

      {tab === 'tax' && tax && (
        <>
          <div className="card-grid">
            <div className="card">
              <h3>Gross Realized P&amp;L (FIFO)</h3>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: Number(tax.summary.grossRealizedPnl) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                {formatINR(tax.summary.grossRealizedPnl)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{tax.totalTrades} executed trades</div>
            </div>
            <div className="card">
              <h3>Total Statutory Charges &amp; Brokerage</h3>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--warn)' }}>
                {formatINR(tax.summary.totalCharges)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                STT/CTT {formatINR(tax.chargesBreakdown.sttOrCtt)} · Brok {formatINR(tax.chargesBreakdown.brokerage)} · GST {formatINR(tax.chargesBreakdown.gst)}
              </div>
            </div>
            <div className="card">
              <h3>Net Realized P&amp;L (After Charges)</h3>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: Number(tax.summary.netRealizedPnl) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                {formatINR(tax.summary.netRealizedPnl)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Identical tax math in DEMO &amp; REAL</div>
            </div>
          </div>

          <section className="card">
            <h3><FileSpreadsheet size={15} /> Indian Income Tax Classification (FIFO)</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Income Tax Head</th>
                    <th style={{ textAlign: 'right' }}>Amount (INR)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Equity / ETF Delivery — Short-Term Capital Gains (STCG)</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(tax.taxBuckets.equityDeliverySTCG)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>Holding period &lt; 12 months</td>
                  </tr>
                  <tr>
                    <td>Equity / ETF Delivery — Long-Term Capital Gains (LTCG)</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(tax.taxBuckets.equityDeliveryLTCG)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>Holding period ≥ 12 months</td>
                  </tr>
                  <tr>
                    <td>Equity Intraday (MIS) — Speculative Business Income</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(tax.taxBuckets.intradaySpeculativeBusinessIncome)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>Sec 43(5) speculative head</td>
                  </tr>
                  <tr>
                    <td>F&amp;O &amp; MCX Commodities — Non-Speculative Business Income</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatINR(tax.taxBuckets.derivativesNonSpeculativeIncome)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>ICAI Turnover: {formatINR(tax.taxBuckets.derivativesIcaiTurnover)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === 'notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!notes || notes.contractNotes.length === 0 ? (
            <section className="card" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              No daily contract notes generated yet for {mode}. Execute a trade to generate your itemized contract note.
            </section>
          ) : (
            notes.contractNotes.map((cn) => (
              <section key={cn.contractNoteNumber} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <div>
                    <strong className="mono">{cn.contractNoteNumber}</strong>{' '}
                    <span className="badge">{cn.tradeDate}</span>
                  </div>
                  <button className="preset-btn" onClick={() => window.print()}>
                    <Printer size={12} /> Print Contract Note
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, fontSize: 12, background: 'var(--bg-elevated)', padding: 10, borderRadius: 8, marginBottom: 10 }}>
                  <div>Buy Value: <strong className="mono">{formatINR(cn.totals.grossBuyValue)}</strong></div>
                  <div>Sell Value: <strong className="mono">{formatINR(cn.totals.grossSellValue)}</strong></div>
                  <div>Brokerage: <strong className="mono">{formatINR(cn.totals.brokerage)}</strong></div>
                  <div>STT / CTT: <strong className="mono">{formatINR(cn.totals.sttOrCtt)}</strong></div>
                  <div>Exch + SEBI: <strong className="mono">{formatINR(Number(cn.totals.exchangeTransactionCharge) + Number(cn.totals.sebiTurnoverFee))}</strong></div>
                  <div>Stamp + DP: <strong className="mono">{formatINR(Number(cn.totals.stampDuty) + Number(cn.totals.dpChargeExclGst))}</strong></div>
                  <div>GST (18%): <strong className="mono">{formatINR(cn.totals.gst)}</strong></div>
                  <div>Total Levies: <strong className="mono" style={{ color: 'var(--warn)' }}>{formatINR(cn.totals.totalCharges)}</strong></div>
                  <div>Net Obligation: <strong className="mono">{formatINR(cn.totals.netObligation)}</strong></div>
                </div>

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Symbol</th>
                        <th>Side / Prod</th>
                        <th style={{ textAlign: 'right' }}>Qty × Price</th>
                        <th style={{ textAlign: 'right' }}>Turnover</th>
                        <th style={{ textAlign: 'right' }}>Charges</th>
                        <th>Blockchain Proof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cn.trades.map((t) => (
                        <tr key={t.id}>
                          <td className="mono">{new Date(t.executedAt).toLocaleTimeString('en-IN')}</td>
                          <td><strong>{t.symbol}</strong> ({t.exchange})</td>
                          <td>{t.side} · {t.product}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{t.quantity} × {formatINR(t.price)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(t.turnover)}</td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--warn)' }}>{formatINR(t.totalCharges)}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{t.blockchainHash ? `${t.blockchainHash.slice(0, 12)}...` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
