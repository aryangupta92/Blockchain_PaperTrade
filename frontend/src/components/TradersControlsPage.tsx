import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Bell, Copy, Plus, RefreshCw, ShieldAlert, Trash2, Webhook } from 'lucide-react';
import { AccountMode, api, TradingAccountDTO } from '../apiClient';

interface TradersControlsPageProps {
  mode: AccountMode;
  onAccountsUpdated: (accounts: TradingAccountDTO[]) => void;
}

const SEGMENTS = ['EQ', 'FNO', 'ETF', 'COMM'] as const;

export function TradersControlsPage({ mode, onAccountsUpdated }: TradersControlsPageProps) {
  const [tab, setTab] = useState<'controls' | 'alerts' | 'webhooks'>('controls');
  const [ctrl, setCtrl] = useState<Awaited<ReturnType<typeof api.controlsGet>> | null>(null);
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof api.alertsList>>['alerts']>([]);
  const [wh, setWh] = useState<Awaited<ReturnType<typeof api.webhookConfig>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Controls form
  const [maxDailyLoss, setMaxDailyLoss] = useState('');
  const [dailyProfitTarget, setDailyProfitTarget] = useState('');
  const [enableAutoPnlExit, setEnableAutoPnlExit] = useState(false);
  const [pnlExitKillSwitch, setPnlExitKillSwitch] = useState(true);
  const [maxOrderValue, setMaxOrderValue] = useState('');
  const [maxTradesPerDay, setMaxTradesPerDay] = useState('');
  const [lossStreakLimit, setLossStreakLimit] = useState('');
  const [cooldownMinutes, setCooldownMinutes] = useState('15');
  const [lockedSegments, setLockedSegments] = useState<string[]>([]);

  // Alert form
  const [alertSym, setAlertSym] = useState('RELIANCE');
  const [alertCond, setAlertCond] = useState('PRICE_ABOVE');
  const [alertVal, setAlertVal] = useState('1500');
  const [alertNote, setAlertNote] = useState('');

  // Webhook JSON Generator form
  const [whMode, setWhMode] = useState<'SINGLE' | 'SUPER' | 'PINE'>('PINE');
  const [whSym, setWhSym] = useState('RELIANCE');
  const [whSide, setWhSide] = useState('BUY');
  const [whQty, setWhQty] = useState('1');
  const [whProd, setWhProd] = useState('MIS');
  const [whSl, setWhSl] = useState('');
  const [whTgt, setWhTgt] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [c, a, w] = await Promise.all([
        api.controlsGet(mode),
        api.alertsList(),
        api.webhookConfig(),
      ]);
      setCtrl(c);
      setAlerts(a.alerts);
      setWh(w);
      const acc = c.account;
      setMaxDailyLoss(acc.maxDailyLoss ?? '');
      setDailyProfitTarget(acc.dailyProfitTarget ?? '');
      setEnableAutoPnlExit(Boolean(acc.enableAutoPnlExit));
      setPnlExitKillSwitch(acc.pnlExitKillSwitch ?? true);
      setMaxOrderValue(acc.maxOrderValue ?? '');
      setMaxTradesPerDay(acc.maxTradesPerDay != null ? String(acc.maxTradesPerDay) : '');
      setLossStreakLimit(acc.lossStreakLimit != null ? String(acc.lossStreakLimit) : '');
      setCooldownMinutes(String(acc.cooldownMinutes ?? 15));
      setLockedSegments(acc.lockedSegments || []);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [mode]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSaveControls = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.controlsUpdate(mode, {
        lockedSegments,
        maxDailyLoss: maxDailyLoss.trim() ? maxDailyLoss : null,
        dailyProfitTarget: dailyProfitTarget.trim() ? dailyProfitTarget : null,
        enableAutoPnlExit,
        pnlExitKillSwitch,
        maxOrderValue: maxOrderValue.trim() ? maxOrderValue : null,
        maxTradesPerDay: maxTradesPerDay.trim() ? Number(maxTradesPerDay) : null,
        lossStreakLimit: lossStreakLimit.trim() ? Number(lossStreakLimit) : null,
        cooldownMinutes: Number(cooldownMinutes) || 15,
      });
      const accRes = await api.accounts();
      onAccountsUpdated(accRes.accounts);
      await loadAll();
      setMsg(`Saved Trader's Controls for ${mode} account.`);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const handleCreateAlert = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.createAlert({ symbol: alertSym, condition: alertCond, targetValue: Number(alertVal), note: alertNote || undefined });
      setAlertNote('');
      setMsg(`Created live alert on ${alertSym}.`);
      await loadAll();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const generatedWebhookJson = (() => {
    const secretVal = wh?.secret || 'YOUR_SECRET';
    if (whMode === 'PINE') {
      return JSON.stringify(
        {
          secret: secretVal,
          accountMode: mode,
          symbol: '{{ticker}}',
          transactionType: '{{strategy.order.action}}',
          quantity: '{{strategy.order.contracts}}',
          orderType: 'MARKET',
          productType: whProd,
        },
        null,
        2
      );
    }
    if (whMode === 'SUPER') {
      return JSON.stringify(
        {
          secret: secretVal,
          accountMode: mode,
          symbol: whSym,
          transactionType: whSide,
          quantity: Number(whQty) || 1,
          orderType: 'SUPER',
          productType: whProd,
          stopLossPrice: whSl ? Number(whSl) : 1380,
          targetPrice: whTgt ? Number(whTgt) : 1450,
          trailingJump: 5,
        },
        null,
        2
      );
    }
    return JSON.stringify(
      {
        secret: secretVal,
        accountMode: mode,
        symbol: whSym,
        transactionType: whSide,
        quantity: Number(whQty) || 1,
        orderType: 'MARKET',
        productType: whProd,
      },
      null,
      2
    );
  })();

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`preset-btn ${tab === 'controls' ? 'active' : ''}`} onClick={() => setTab('controls')}>
            <ShieldAlert size={13} /> Trader&apos;s Controls ({mode})
          </button>
          <button className={`preset-btn ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>
            <Bell size={13} /> Price &amp; Technical Alerts ({alerts.length})
          </button>
          <button className={`preset-btn ${tab === 'webhooks' ? 'active' : ''}`} onClick={() => setTab('webhooks')}>
            <Webhook size={13} /> TradingView Webhooks &amp; JSON Builder
          </button>
        </div>
        <button className="theme-toggle" onClick={loadAll}><RefreshCw size={13} /> Refresh</button>
      </section>

      {msg && <div className="alert-success">{msg}</div>}
      {err && <div className="alert-error">{err}</div>}

      {/* TAB 1: Trader's Controls (Kill Switch, Segment Locks, Auto P&L Exit, Overtrading Guard) */}
      {tab === 'controls' && ctrl && (
        <form onSubmit={handleSaveControls} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="card">
            <h3><ShieldAlert size={15} /> Master &amp; Segment Kill Switches ({mode})</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <button
                type="button"
                className="btn-primary"
                style={{ background: ctrl.account.killSwitchOn ? 'var(--gain)' : 'var(--loss)', color: ctrl.account.killSwitchOn ? '#0b0f17' : '#fff' }}
                onClick={async () => {
                  await api.controlsUpdate(mode, { killSwitchOn: !ctrl.account.killSwitchOn });
                  const accRes = await api.accounts();
                  onAccountsUpdated(accRes.accounts);
                  await loadAll();
                }}
              >
                {ctrl.account.killSwitchOn ? 'Deactivate Master Kill Switch' : 'ACTIVATE Master Kill Switch (Blocks All Orders)'}
              </button>
              <span className="badge">Today&apos;s Trades: {ctrl.todayTrades}</span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Lock Individual Segments (prevents emotional trading in specific segments):</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SEGMENTS.map((seg) => {
                const locked = lockedSegments.includes(seg);
                return (
                  <button
                    key={seg}
                    type="button"
                    className={`preset-btn ${locked ? 'active' : ''}`}
                    style={locked ? { borderColor: 'var(--loss)', color: 'var(--loss)' } : undefined}
                    onClick={() => setLockedSegments((p) => (p.includes(seg) ? p.filter((x) => x !== seg) : [...p, seg]))}
                  >
                    {seg}: {locked ? 'LOCKED' : 'Unlocked'}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h3>Auto P&amp;L Exit &amp; Overtrading Guardrails</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
              <label className="field">
                <span>Daily Max Loss Limit (₹)</span>
                <input className="input mono" type="number" placeholder="e.g. 5000" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(e.target.value)} />
              </label>
              <label className="field">
                <span>Daily Profit Target (₹)</span>
                <input className="input mono" type="number" placeholder="e.g. 15000" value={dailyProfitTarget} onChange={(e) => setDailyProfitTarget(e.target.value)} />
              </label>
              <label className="field">
                <span>Max Single Order Value (₹)</span>
                <input className="input mono" type="number" placeholder="e.g. 200000" value={maxOrderValue} onChange={(e) => setMaxOrderValue(e.target.value)} />
              </label>
              <label className="field">
                <span>Max Trades / Day (Overtrading Cap)</span>
                <input className="input mono" type="number" placeholder="e.g. 15" value={maxTradesPerDay} onChange={(e) => setMaxTradesPerDay(e.target.value)} />
              </label>
              <label className="field">
                <span>Loss Streak Cooldown Trigger</span>
                <input className="input mono" type="number" placeholder="e.g. 3 consecutive losses" value={lossStreakLimit} onChange={(e) => setLossStreakLimit(e.target.value)} />
              </label>
              <label className="field">
                <span>Cooldown Duration (Minutes)</span>
                <input className="input mono" type="number" min={1} max={240} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: 12.5 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={enableAutoPnlExit} onChange={(e) => setEnableAutoPnlExit(e.target.checked)} />
                Auto square-off all open positions when Daily Max Loss or Profit Target is hit
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={pnlExitKillSwitch} onChange={(e) => setPnlExitKillSwitch(e.target.checked)} />
                Also engage Kill Switch automatically after Auto P&amp;L Exit
              </label>
            </div>

            <button className="btn-primary" type="submit">Save Trader&apos;s Controls ({mode})</button>
          </section>
        </form>
      )}

      {/* TAB 2: Live Price & Technical Alerts */}
      {tab === 'alerts' && (
        <section className="card">
          <h3><Bell size={15} /> Live Price &amp; Technical Alerts (Evaluated Real-Time on Every Tick)</h3>
          <form onSubmit={handleCreateAlert} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
            <input className="input" style={{ width: 140 }} value={alertSym} onChange={(e) => setAlertSym(e.target.value.toUpperCase())} placeholder="Symbol" />
            <select className="input" style={{ width: 160 }} value={alertCond} onChange={(e) => setAlertCond(e.target.value)}>
              <option value="PRICE_ABOVE">Price Above ≥</option>
              <option value="PRICE_BELOW">Price Below ≤</option>
              <option value="PCT_MOVE">% Move ≥</option>
              <option value="RSI_GT">RSI(14) Above</option>
              <option value="RSI_LT">RSI(14) Below</option>
            </select>
            <input className="input mono" style={{ width: 110 }} type="number" step="0.05" value={alertVal} onChange={(e) => setAlertVal(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Alert note..." value={alertNote} onChange={(e) => setAlertNote(e.target.value)} />
            <button className="btn-primary" type="submit"><Plus size={14} /> Add Alert</button>
          </form>

          {alerts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No price alerts set yet. Create one above or right-click directly on any Chart!</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Symbol</th><th>Condition</th><th style={{ textAlign: 'right' }}>Target</th><th>Note</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.symbol}</strong></td>
                      <td className="mono">{a.condition}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{a.targetValue}</td>
                      <td>{a.note || '—'}</td>
                      <td><span className={`badge ${a.status === 'ACTIVE' ? 'badge-gain' : 'badge-warn'}`}>{a.status}</span></td>
                      <td style={{ display: 'flex', gap: 5 }}>
                        {a.status !== 'TRIGGERED' && (
                          <button className="preset-btn" onClick={async () => { await api.toggleAlert(a.id); loadAll(); }}>
                            {a.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                          </button>
                        )}
                        <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={async () => { await api.deleteAlert(a.id); loadAll(); }}>
                          <Trash2 size={12} />
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

      {/* TAB 3: TradingView Webhooks + Interactive JSON Generator */}
      {tab === 'webhooks' && wh && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}><Webhook size={15} /> Personal TradingView Alert Webhook Endpoint</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`preset-btn ${wh.active ? 'active' : ''}`}
                  onClick={async () => { await api.toggleWebhook(!wh.active); loadAll(); }}
                >
                  {wh.active ? 'Webhook ACTIVE' : 'Webhook PAUSED'}
                </button>
                <button className="preset-btn" onClick={async () => { await api.rotateWebhook(); setMsg('Rotated Webhook URL & Secret.'); loadAll(); }}>
                  Rotate Secret (30d)
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input className="input mono" readOnly value={`${window.location.origin}${wh.webhookPath}`} />
              <button className="preset-btn" onClick={() => copyText('url', `${window.location.origin}${wh.webhookPath}`)}>
                <Copy size={12} /> {copied === 'url' ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Expires: {new Date(wh.expiresAt).toLocaleDateString('en-IN')} · Protected by per-user URL token + timing-safe secret verification.
            </div>
          </section>

          <section className="card">
            <h3>Interactive &ldquo;Create JSON&rdquo; Payload Generator (Paste into TradingView Alert Message)</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <button className={`preset-btn ${whMode === 'PINE' ? 'active' : ''}`} onClick={() => setWhMode('PINE')}>Pine Script Dynamic</button>
              <button className={`preset-btn ${whMode === 'SINGLE' ? 'active' : ''}`} onClick={() => setWhMode('SINGLE')}>Single Order</button>
              <button className={`preset-btn ${whMode === 'SUPER' ? 'active' : ''}`} onClick={() => setWhMode('SUPER')}>Super Order (SL + Target)</button>
            </div>

            {whMode !== 'PINE' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <input className="input" style={{ width: 130 }} value={whSym} onChange={(e) => setWhSym(e.target.value.toUpperCase())} placeholder="Symbol" />
                <select className="input" style={{ width: 90 }} value={whSide} onChange={(e) => setWhSide(e.target.value)}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <input className="input mono" style={{ width: 75 }} type="number" value={whQty} onChange={(e) => setWhQty(e.target.value)} />
                <select className="input" style={{ width: 95 }} value={whProd} onChange={(e) => setWhProd(e.target.value)}>
                  <option value="MIS">MIS</option>
                  <option value="CNC">CNC</option>
                  <option value="NRML">NRML</option>
                </select>
                {whMode === 'SUPER' && (
                  <>
                    <input className="input mono" style={{ width: 95 }} placeholder="SL Price" value={whSl} onChange={(e) => setWhSl(e.target.value)} />
                    <input className="input mono" style={{ width: 95 }} placeholder="Target" value={whTgt} onChange={(e) => setWhTgt(e.target.value)} />
                  </>
                )}
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <pre className="mono" style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>
                {generatedWebhookJson}
              </pre>
              <button className="btn-primary" style={{ position: 'absolute', top: 8, right: 8, padding: '5px 10px', fontSize: 11.5 }} onClick={() => copyText('json', generatedWebhookJson)}>
                <Copy size={12} /> {copied === 'json' ? 'Copied JSON!' : 'Copy JSON'}
              </button>
            </div>
          </section>

          <section className="card">
            <h3>Webhook Execution Audit Log ({wh.logs.length})</h3>
            {wh.logs.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No incoming webhook alerts received yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Time</th><th>Status</th><th>Latency</th><th>Response</th><th>Payload Preview</th></tr></thead>
                  <tbody>
                    {wh.logs.map((l) => (
                      <tr key={l.id}>
                        <td className="mono">{new Date(l.createdAt).toLocaleTimeString('en-IN')}</td>
                        <td><span className={`badge ${l.status === 'EXECUTED' ? 'badge-gain' : 'badge-warn'}`}>{l.status}</span></td>
                        <td className="mono">{l.latencyMs}ms</td>
                        <td style={{ fontSize: 11.5 }}>{l.responseText || '—'}</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.payloadPreview.slice(0, 80)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
