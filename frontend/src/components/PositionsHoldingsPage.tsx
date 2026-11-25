import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart2, Briefcase, Lock, PieChart, RefreshCw, Repeat, ShieldAlert, TrendingUp } from 'lucide-react';
import { AccountMode, api, formatINR, TradingAccountDTO } from '../apiClient';

interface PositionsHoldingsPageProps {
  mode: AccountMode;
  account: TradingAccountDTO;
  onAccountsUpdated: (accounts: TradingAccountDTO[]) => void;
  onQuickTrade: (symbol: string, side: 'BUY' | 'SELL', segment: string, ltp: string) => void;
}

type PortfolioTab = 'positions' | 'insights' | 'mtf' | 'pledges' | 'analyzer';

export function PositionsHoldingsPage({
  mode,
  account,
  onAccountsUpdated,
  onQuickTrade,
}: PositionsHoldingsPageProps) {
  const [tab, setTab] = useState<PortfolioTab>('positions');
  const [posData, setPosData] = useState<Awaited<ReturnType<typeof api.positions>> | null>(null);
  const [holdData, setHoldData] = useState<Awaited<ReturnType<typeof api.holdings>> | null>(null);
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof api.positionInsights>> | null>(null);
  const [mtfData, setMtfData] = useState<Awaited<ReturnType<typeof api.mtfPositions>> | null>(null);
  const [pledgeData, setPledgeData] = useState<Awaited<ReturnType<typeof api.pledges>> | null>(null);
  const [analyzer, setAnalyzer] = useState<Awaited<ReturnType<typeof api.portfolioAnalyzer>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [p, h, mtf, pl] = await Promise.all([
        api.positions(mode),
        api.holdings(mode),
        api.mtfPositions(mode).catch(() => null),
        api.pledges(mode).catch(() => null),
      ]);
      setPosData(p);
      setHoldData(h);
      setMtfData(mtf);
      setPledgeData(pl);
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => {
    setMsg(null);
    setErr(null);
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'insights') api.positionInsights(mode).then(setInsights).catch(() => setInsights(null));
    else if (tab === 'analyzer') api.portfolioAnalyzer(mode).then(setAnalyzer).catch(() => setAnalyzer(null));
  }, [tab, mode]);

  const refreshAccounts = async () => {
    const res = await api.accounts();
    onAccountsUpdated(res.accounts);
    await load();
  };

  const exec = async (fn: () => Promise<unknown>, successText: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(successText);
      await refreshAccounts();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary & Risk Action Bar */}
      <div className="card-grid">
        <div className="card">
          <h3>Live MTM Unrealized P&amp;L</h3>
          <div className="mono" style={{ fontSize: 21, fontWeight: 800, color: Number(posData?.summary.totalUnrealizedPnl || 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
            {formatINR(posData?.summary.totalUnrealizedPnl || '0')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Realized: {formatINR(posData?.summary.totalRealizedPnl || '0')}
          </div>
        </div>
        <div className="card">
          <h3>Holdings &amp; Collateral Margin</h3>
          <div className="mono" style={{ fontSize: 21, fontWeight: 800 }}>
            {formatINR(holdData?.summary.totalCurrentValue || '0')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            P&amp;L: {formatINR(holdData?.summary.totalUnrealizedPnl || '0')} · Collateral: <strong style={{ color: '#38bdf8' }}>{formatINR(account.collateralMargin || '0')}</strong>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
          <h3><ShieldAlert size={15} /> Emergency Controls ({mode})</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="preset-btn"
              style={{ borderColor: 'var(--loss)', color: 'var(--loss)' }}
              onClick={() => exec(() => api.exitAllPositions(mode), 'Executed Exit All open positions & cancelled pending orders.')}
            >
              <AlertTriangle size={12} /> Exit All
            </button>
            <button
              className="preset-btn"
              style={{ borderColor: account.killSwitchOn ? 'var(--loss)' : 'var(--warn)', color: account.killSwitchOn ? 'var(--loss)' : 'var(--warn)' }}
              onClick={() => exec(() => api.updateRiskControls(mode, { killSwitchOn: !account.killSwitchOn }), account.killSwitchOn ? 'Kill Switch deactivated.' : 'Kill Switch ACTIVATED.')}
            >
              Kill Switch: {account.killSwitchOn ? 'ON' : 'OFF'}
            </button>
            <button className="theme-toggle" onClick={load} disabled={busy}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <section className="card" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 10 }}>
        <button className={`preset-btn ${tab === 'positions' ? 'active' : ''}`} onClick={() => setTab('positions')}>
          <Briefcase size={12} /> Positions &amp; Holdings
        </button>
        <button className={`preset-btn ${tab === 'insights' ? 'active' : ''}`} onClick={() => setTab('insights')}>
          <BarChart2 size={12} /> Position Insights (F&amp;O Payoff)
        </button>
        <button className={`preset-btn ${tab === 'mtf' ? 'active' : ''}`} onClick={() => setTab('mtf')}>
          <TrendingUp size={12} /> MTF 4x Delivery ({mtfData?.count || 0})
        </button>
        <button className={`preset-btn ${tab === 'pledges' ? 'active' : ''}`} onClick={() => setTab('pledges')}>
          <Lock size={12} /> Margin Pledge ({pledgeData?.pledges.filter((p) => p.status === 'PLEDGED').length || 0})
        </button>
        <button className={`preset-btn ${tab === 'analyzer' ? 'active' : ''}`} onClick={() => setTab('analyzer')}>
          <PieChart size={12} /> Portfolio Analyzer (XIRR &amp; TLH)
        </button>
      </section>

      {msg && <div className="alert-success">{msg}</div>}
      {err && <div className="alert-error">{err}</div>}

      {/* TAB 1: Positions & Delivery Holdings */}
      {tab === 'positions' && (
        <>
          <section className="card">
            <h3><Briefcase size={15} /> Intraday &amp; Derivative Positions ({posData?.positions.length || 0})</h3>
            {!posData || posData.positions.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No positions in this {mode} epoch yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Product</th>
                      <th style={{ textAlign: 'right' }}>Net Qty</th>
                      <th style={{ textAlign: 'right' }}>Avg Entry</th>
                      <th style={{ textAlign: 'right' }}>LTP</th>
                      <th style={{ textAlign: 'right' }}>MTM P&amp;L</th>
                      <th style={{ textAlign: 'right' }}>Blocked Margin</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posData.positions.map((p) => {
                      const pnl = Number(p.netPnl);
                      const isDeriv = p.segment === 'FNO' || p.segment === 'COMM';
                      return (
                        <tr key={p.id}>
                          <td><strong>{p.symbol}</strong></td>
                          <td><span className="badge">{p.product}</span></td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: p.netQuantity > 0 ? 'var(--gain)' : p.netQuantity < 0 ? 'var(--loss)' : 'var(--text-muted)' }}>
                            {p.netQuantity}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(p.netQuantity >= 0 ? p.avgBuyPrice : p.avgSellPrice)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(p.ltp)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnl >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                            {formatINR(p.netPnl)}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(p.blockedMargin)}</td>
                          <td style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {p.netQuantity !== 0 && (
                              <>
                                <button
                                  className="preset-btn"
                                  onClick={() => exec(() => api.squareOffPosition(mode, { symbol: p.symbol, product: p.product, quantity: Math.abs(p.netQuantity), currentNetQuantity: p.netQuantity }), `Squared off ${p.symbol}.`)}
                                >
                                  Exit
                                </button>
                                {(p.product === 'MIS' || p.product === 'NRML') && (
                                  <button
                                    className="preset-btn"
                                    title="Reverse Position (2x opposite market order)"
                                    onClick={() => exec(() => api.reversePosition(mode, { symbol: p.symbol, product: p.product as 'MIS' | 'NRML' }), `Reversed ${p.symbol} position.`)}
                                  >
                                    <Repeat size={11} /> Rev
                                  </button>
                                )}
                              </>
                            )}
                            {p.product === 'MIS' && p.netQuantity > 0 && !isDeriv && (
                              <button className="preset-btn" onClick={() => exec(() => api.convertPosition(mode, { symbol: p.symbol, fromProduct: 'MIS', toProduct: 'CNC' }), `Converted ${p.symbol} MIS → CNC.`)}>
                                → CNC
                              </button>
                            )}
                            {isDeriv && p.netQuantity !== 0 && (p.product === 'MIS' || p.product === 'NRML') && (
                              <button
                                className="preset-btn"
                                onClick={() =>
                                  exec(
                                    () => api.convertPosition(mode, { symbol: p.symbol, fromProduct: p.product, toProduct: p.product === 'MIS' ? 'NRML' : 'MIS' }),
                                    `Converted ${p.symbol} to ${p.product === 'MIS' ? 'NRML' : 'MIS'}.`
                                  )
                                }
                              >
                                → {p.product === 'MIS' ? 'NRML' : 'MIS'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3>Delivery Holdings (CNC — SEBI T+1 Settlement &amp; Instant Pledge) ({holdData?.holdings.length || 0})</h3>
            {!holdData || holdData.holdings.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No CNC delivery holdings in this {mode} account yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th style={{ textAlign: 'right' }}>Settled / T+1</th>
                      <th style={{ textAlign: 'right' }}>Pledged</th>
                      <th style={{ textAlign: 'right' }}>Avg Cost</th>
                      <th style={{ textAlign: 'right' }}>LTP</th>
                      <th style={{ textAlign: 'right' }}>Current Value</th>
                      <th style={{ textAlign: 'right' }}>Unrealized P&amp;L</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdData.holdings.map((h) => {
                      const pnl = Number(h.unrealizedPnl);
                      const unpledged = h.totalQty - (h.pledgedQty || 0);
                      return (
                        <tr key={h.id}>
                          <td><strong>{h.symbol}</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.exchange}</span></td>
                          <td className="mono" style={{ textAlign: 'right' }}>{h.settledQty} / <span style={{ color: h.t1Qty > 0 ? 'var(--warn)' : 'var(--text-muted)' }}>{h.t1Qty}</span></td>
                          <td className="mono" style={{ textAlign: 'right', color: (h.pledgedQty || 0) > 0 ? '#38bdf8' : 'var(--text-muted)' }}>{h.pledgedQty || 0}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(h.avgCost)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(h.ltp)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(h.currentValue)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnl >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                            {formatINR(h.unrealizedPnl)} ({h.unrealizedPnlPct}%)
                          </td>
                          <td style={{ display: 'flex', gap: 5 }}>
                            <button className="preset-btn" onClick={() => onQuickTrade(h.symbol, 'SELL', h.segment, h.ltp)}>Sell</button>
                            {unpledged > 0 && (
                              <button
                                className="preset-btn"
                                style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
                                onClick={() => exec(() => api.pledgeHolding(mode, h.symbol, unpledged), `Pledged ${unpledged} ${h.symbol} for instant collateral margin.`)}
                              >
                                Pledge ({unpledged})
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* TAB 2: Position Insights (Live F&O Payoff & Greeks) */}
      {tab === 'insights' && (
        <section className="card">
          <h3><BarChart2 size={15} /> Live Position Insights — Combined F&amp;O Payoff &amp; Net Greeks</h3>
          {!insights || insights.groups.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No open F&amp;O derivative positions in {mode} to analyze. Place an option or futures strategy to inspect combined live payoff and Greeks here.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {insights.groups.map((g) => (
                <div key={g.underlying} style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <strong>{g.underlying} ({g.legCount} open leg{g.legCount > 1 ? 's' : ''}) · Spot {formatINR(g.spotPrice)}</strong>
                    <div className="mono" style={{ fontSize: 12, display: 'flex', gap: 12 }}>
                      <span style={{ color: 'var(--gain)' }}>Max Profit: {g.analysis.maxProfit}</span>
                      <span style={{ color: 'var(--loss)' }}>Max Loss: {g.analysis.maxLoss}</span>
                      <span>POP: {g.analysis.probabilityOfProfitPct ?? '—'}%</span>
                      <span>Δ {g.analysis.netGreeks.delta} · Θ {g.analysis.netGreeks.theta}</span>
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Breakevens: {g.analysis.breakevens.length ? g.analysis.breakevens.join(', ') : 'None'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: MTF (4x Leveraged Delivery) */}
      {tab === 'mtf' && (
        <section className="card">
          <h3><TrendingUp size={15} /> MTF — Margin Trading Facility (Up to 4x Leveraged Delivery)</h3>
          {!mtfData || mtfData.positions.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No open MTF positions. Choose <strong>MTF</strong> product in any Equity Order Ticket to pay 25% client margin and fund 75%.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Avg / LTP</th>
                    <th style={{ textAlign: 'right' }}>Client Margin</th>
                    <th style={{ textAlign: 'right' }}>Funded (75%)</th>
                    <th style={{ textAlign: 'right' }}>Est. Interest</th>
                    <th style={{ textAlign: 'right' }}>Unrealized P&amp;L</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {mtfData.positions.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.symbol}</strong> <span className="badge">{m.leverage}x</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{m.quantity}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatINR(m.avgPrice)} / {formatINR(m.ltp)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatINR(m.clientMargin)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatINR(m.fundedAmount)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--warn)' }}>{formatINR(m.estimatedInterest)} ({m.interestRatePct}% p.a.)</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: Number(m.unrealizedPnl) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                        {formatINR(m.unrealizedPnl)}
                      </td>
                      <td>
                        <button
                          className="preset-btn"
                          onClick={() => exec(() => api.convertMtfToCnc(mode, m.id), `Converted ${m.symbol} from MTF → CNC Delivery.`)}
                        >
                          Convert → CNC
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 4: Holdings Margin Pledge & Collateral */}
      {tab === 'pledges' && (
        <section className="card">
          <h3><Lock size={15} /> Instant Margin Pledge — Collateral Margin (SEBI 50:50 Cash:Collateral Rule)</h3>
          <div style={{ marginBottom: 12, fontSize: 12.5, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
            Active Collateral Margin: <strong className="mono" style={{ color: '#38bdf8' }}>{formatINR(pledgeData?.collateralMargin || '0')}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>· Usable up to 50% of overnight F&amp;O margin alongside liquid cash (20% equity haircut / 10% ETF haircut).</span>
          </div>
          {!pledgeData || pledgeData.pledges.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No pledged holdings yet. Click <strong>Pledge</strong> next to any CNC holding in the Positions &amp; Holdings tab.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Symbol</th><th style={{ textAlign: 'right' }}>Pledged Qty</th><th style={{ textAlign: 'right' }}>Ref Price</th><th style={{ textAlign: 'right' }}>Haircut</th><th style={{ textAlign: 'right' }}>Collateral Value</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {pledgeData.pledges.map((pl) => (
                    <tr key={pl.id}>
                      <td><strong>{pl.instrument.symbol}</strong></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{pl.pledgedQty}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatINR(pl.referencePrice)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{pl.haircutPct}%</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#38bdf8', fontWeight: 700 }}>{formatINR(pl.collateralValue)}</td>
                      <td><span className={`badge ${pl.status === 'PLEDGED' ? 'badge-gain' : 'badge-warn'}`}>{pl.status}</span></td>
                      <td>
                        {pl.status === 'PLEDGED' && (
                          <button className="preset-btn" onClick={() => exec(() => api.unpledgeHolding(mode, pl.id), `Unpledged ${pl.instrument.symbol}.`)}>
                            Unpledge
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 5: Portfolio Analyzer (XIRR, Allocation, Concentration & Tax Loss Harvesting) */}
      {tab === 'analyzer' && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3><PieChart size={15} /> Portfolio Analyzer — XIRR, Concentration Risk &amp; Tax Loss Harvesting</h3>
          {!analyzer ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading portfolio analytics...</div>
          ) : (
            <>
              <div className="card-grid">
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>Portfolio XIRR (Annualized)</h3>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: (analyzer.xirrPct ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                    {analyzer.xirrPct != null ? `${analyzer.xirrPct}%` : 'N/A'}
                  </div>
                </div>
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>Top-3 Concentration</h3>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: analyzer.top3ConcentrationPct > 70 ? 'var(--warn)' : 'var(--text-primary)' }}>
                    {analyzer.top3ConcentrationPct}%
                  </div>
                </div>
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>Tax-Loss Harvesting Candidates</h3>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: '#38bdf8' }}>
                    {analyzer.taxLossHarvesting.length} stock(s)
                  </div>
                </div>
              </div>

              {analyzer.allocations.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-secondary)' }}>Holding Weights</h4>
                  {analyzer.allocations.map((a) => (
                    <div key={a.symbol} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 75px 110px', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                      <strong>{a.symbol}</strong>
                      <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, a.weightPct)}%`, background: 'var(--active-mode-accent)' }} />
                      </div>
                      <span className="mono" style={{ textAlign: 'right' }}>{a.weightPct}%</span>
                      <span className="mono" style={{ textAlign: 'right' }}>{formatINR(a.currentValue)}</span>
                    </div>
                  ))}
                </div>
              )}

              {analyzer.taxLossHarvesting.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--warn)' }}>Tax Loss Harvesting Opportunities (20% STCG Offset Estimate)</h4>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Symbol</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Avg / LTP</th><th style={{ textAlign: 'right' }}>Unrealized Loss</th><th style={{ textAlign: 'right' }}>Est. Tax Saved (20%)</th></tr></thead>
                      <tbody>
                        {analyzer.taxLossHarvesting.map((t) => (
                          <tr key={t.symbol}>
                            <td><strong>{t.symbol}</strong></td>
                            <td className="mono" style={{ textAlign: 'right' }}>{t.totalQty}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{formatINR(t.avgCost)} / {formatINR(t.ltp)}</td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--loss)' }}>-{formatINR(t.harvestableLoss)}</td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--gain)', fontWeight: 700 }}>{formatINR(t.estimatedTaxSaved20Pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
