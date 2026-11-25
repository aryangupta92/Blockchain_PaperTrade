import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Clock, FileText, Layers, Play, Plus, RefreshCw, Repeat, ShieldCheck, Trash2, XCircle, Zap } from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface OrdersPageProps {
  mode: AccountMode;
  onJumpToBlockchain: () => void;
}

type OrdersTab = 'orders' | 'super' | 'forever' | 'baskets' | 'conditional' | 'drafts' | 'sips' | 'trades';

export function OrdersPage({ mode, onJumpToBlockchain }: OrdersPageProps) {
  const [tab, setTab] = useState<OrdersTab>('orders');
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof api.orders>>['orders']>([]);
  const [trades, setTrades] = useState<Awaited<ReturnType<typeof api.trades>>['trades']>([]);
  const [forever, setForever] = useState<Awaited<ReturnType<typeof api.foreverOrders>>['foreverOrders']>([]);
  const [baskets, setBaskets] = useState<Awaited<ReturnType<typeof api.savedBaskets>>['baskets']>([]);
  const [triggers, setTriggers] = useState<Awaited<ReturnType<typeof api.conditionalTriggers>>['triggers']>([]);
  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof api.draftOrders>>['drafts']>([]);
  const [sips, setSips] = useState<Awaited<ReturnType<typeof api.stockSips>>['sips']>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Quick-create forms
  const [sipSymbol, setSipSymbol] = useState('NIFTYBEES');
  const [sipMode, setSipMode] = useState<'AMOUNT' | 'QTY'>('AMOUNT');
  const [sipVal, setSipVal] = useState('5000');
  const [sipFreq, setSipFreq] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('MONTHLY');

  const [condSym, setCondSym] = useState('RELIANCE');
  const [condOp, setCondOp] = useState<'GTE' | 'LTE'>('GTE');
  const [condVal, setCondVal] = useState('1500');
  const [condSide, setCondSide] = useState<'BUY' | 'SELL'>('BUY');
  const [condQty, setCondQty] = useState('1');

  const [basketName, setBasketName] = useState('');
  const [basketSym, setBasketSym] = useState('RELIANCE');
  const [basketQty, setBasketQty] = useState('5');
  const [basketSide, setBasketSide] = useState<'BUY' | 'SELL'>('BUY');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [o, t, f, b, c, d, s] = await Promise.all([
        api.orders(mode),
        api.trades(mode),
        api.foreverOrders(mode).catch(() => ({ foreverOrders: [] })),
        api.savedBaskets().catch(() => ({ baskets: [] })),
        api.conditionalTriggers(mode).catch(() => ({ triggers: [] })),
        api.draftOrders(mode).catch(() => ({ drafts: [] })),
        api.stockSips(mode).catch(() => ({ sips: [] })),
      ]);
      setOrders(o.orders);
      setTrades(t.trades);
      setForever(f.foreverOrders);
      setBaskets(b.baskets);
      setTriggers(c.triggers);
      setDrafts(d.drafts);
      setSips(s.sips);
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (fn: () => Promise<unknown>, successText: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(successText);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const superOrders = orders.filter((o) => o.orderType === 'SUPER' || o.orderType === 'BO' || o.orderType === 'CO' || o.parentOrderId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`preset-btn ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
            Order Book ({orders.length})
          </button>
          <button className={`preset-btn ${tab === 'super' ? 'active' : ''}`} onClick={() => setTab('super')}>
            Super / OCO ({superOrders.length})
          </button>
          <button className={`preset-btn ${tab === 'forever' ? 'active' : ''}`} onClick={() => setTab('forever')}>
            Forever GTT ({forever.length})
          </button>
          <button className={`preset-btn ${tab === 'baskets' ? 'active' : ''}`} onClick={() => setTab('baskets')}>
            Baskets ({baskets.length})
          </button>
          <button className={`preset-btn ${tab === 'conditional' ? 'active' : ''}`} onClick={() => setTab('conditional')}>
            Triggers ({triggers.length})
          </button>
          <button className={`preset-btn ${tab === 'drafts' ? 'active' : ''}`} onClick={() => setTab('drafts')}>
            Drafts ({drafts.length})
          </button>
          <button className={`preset-btn ${tab === 'sips' ? 'active' : ''}`} onClick={() => setTab('sips')}>
            Stock SIPs ({sips.length})
          </button>
          <button className={`preset-btn ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>
            Trades &amp; Charges ({trades.length})
          </button>
        </div>
        <button className="theme-toggle" onClick={load} disabled={busy}>
          <RefreshCw size={13} /> Refresh
        </button>
      </section>

      {msg && <div className="alert-success">{msg}</div>}
      {err && <div className="alert-error">{err}</div>}

      {/* 1. Standard Order Book */}
      {tab === 'orders' && (
        <section className="card">
          <h3><FileText size={15} /> {mode} Order Book</h3>
          {orders.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No orders placed in this {mode} epoch yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Product</th>
                    <th>Type / Leg</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Price / Trigger</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="mono">{new Date(o.createdAt).toLocaleTimeString('en-IN')}</td>
                      <td><strong>{o.instrument.symbol}</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.instrument.exchange}</span></td>
                      <td style={{ color: o.side === 'BUY' ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>{o.side}</td>
                      <td><span className="badge">{o.product}</span></td>
                      <td className="mono">
                        {o.orderType}{o.isAmo ? ' (AMO)' : ''}
                        {o.legRole ? <span className="badge badge-warn" style={{ marginLeft: 5 }}>{o.legRole}</span> : null}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{o.filledQuantity}/{o.quantity}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {o.price ? formatINR(o.price) : 'MKT'}
                        {o.triggerPrice ? ` (Trig ${formatINR(o.triggerPrice)})` : ''}
                      </td>
                      <td><span className={`badge ${o.status === 'FILLED' ? 'badge-gain' : 'badge-warn'}`}>{o.status}</span></td>
                      <td>
                        {['OPEN', 'PENDING', 'TRIGGER_PENDING'].includes(o.status) ? (
                          <button className="preset-btn" onClick={() => runAction(() => api.cancelOrder(o.id), `Cancelled order ${o.instrument.symbol}.`)}>
                            <XCircle size={12} /> Cancel
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 2. Super / OCO Orders */}
      {tab === 'super' && (
        <section className="card">
          <h3><Zap size={15} /> Super Orders (Entry + Target + Trailing Stop-Loss OCO)</h3>
          {superOrders.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No Super / Bracket / Cover orders placed yet. Open any Order Ticket → <strong>Super</strong> tab to attach Target, SL &amp; Trailing Jump.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Leg Role</th>
                    <th>Side / Prod</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Target</th>
                    <th style={{ textAlign: 'right' }}>Stop-Loss / Trigger</th>
                    <th style={{ textAlign: 'right' }}>Trail Jump</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {superOrders.map((o) => (
                    <tr key={o.id}>
                      <td><strong>{o.instrument.symbol}</strong></td>
                      <td><span className="badge">{o.legRole || 'ENTRY'}</span></td>
                      <td><strong style={{ color: o.side === 'BUY' ? 'var(--gain)' : 'var(--loss)' }}>{o.side}</strong> · {o.product}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{o.quantity}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--gain)' }}>{o.target ? formatINR(o.target) : o.legRole === 'TARGET' && o.price ? formatINR(o.price) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--loss)' }}>{o.stopLoss ? formatINR(o.stopLoss) : o.triggerPrice ? formatINR(o.triggerPrice) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{o.trailingJump ? `₹${o.trailingJump}` : '—'}</td>
                      <td><span className={`badge ${o.status === 'FILLED' ? 'badge-gain' : 'badge-warn'}`}>{o.status}</span></td>
                      <td>
                        {['OPEN', 'TRIGGER_PENDING'].includes(o.status) ? (
                          <button className="preset-btn" onClick={() => runAction(() => api.cancelOrder(o.id), 'Cancelled Super Order leg.')}>Cancel</button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 3. Forever Orders (GTT Single & OCO) */}
      {tab === 'forever' && (
        <section className="card">
          <h3><Clock size={15} /> Forever Orders (GTT — 365-Day Single &amp; OCO)</h3>
          {forever.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No Forever (GTT) orders active. Use the <strong>Forever GTT</strong> tab inside the Order Ticket to place 365-day Single or OCO triggers.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Mode</th>
                    <th>Side / Prod</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Trigger → Limit</th>
                    <th style={{ textAlign: 'right' }}>OCO Leg 2 (SL)</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {forever.map((f) => (
                    <tr key={f.id}>
                      <td><strong>{f.instrument.symbol}</strong></td>
                      <td><span className="badge">{f.orderFlag}</span></td>
                      <td><strong style={{ color: f.side === 'BUY' ? 'var(--gain)' : 'var(--loss)' }}>{f.side}</strong> · {f.product}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.quantity}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.triggerDirection} {formatINR(f.triggerPrice)} → {formatINR(f.limitPrice)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{f.triggerPrice2 ? `${formatINR(f.triggerPrice2)} → ${formatINR(f.limitPrice2 || 0)}` : '—'}</td>
                      <td className="mono">{new Date(f.expiresAt).toLocaleDateString('en-IN')}</td>
                      <td><span className={`badge ${f.status === 'ACTIVE' ? 'badge-gain' : 'badge-warn'}`}>{f.status}</span></td>
                      <td>
                        {f.status === 'ACTIVE' && (
                          <button className="preset-btn" onClick={() => runAction(() => api.cancelForeverOrder(f.id), 'Cancelled Forever Order.')}>Cancel</button>
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

      {/* 4. Saved Baskets */}
      {tab === 'baskets' && (
        <section className="card">
          <h3><Layers size={15} /> Saved Basket Orders (1-Click Multi-Leg Execution)</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
            <input className="input" style={{ width: 170 }} placeholder="Basket Name" value={basketName} onChange={(e) => setBasketName(e.target.value)} />
            <input className="input" style={{ width: 130 }} placeholder="Symbol" value={basketSym} onChange={(e) => setBasketSym(e.target.value.toUpperCase())} />
            <select className="input" style={{ width: 90 }} value={basketSide} onChange={(e) => setBasketSide(e.target.value as 'BUY' | 'SELL')}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <input className="input mono" style={{ width: 80 }} type="number" min={1} value={basketQty} onChange={(e) => setBasketQty(e.target.value)} />
            <button
              className="btn-primary"
              onClick={() =>
                runAction(
                  () =>
                    api.createSavedBasket({
                      name: basketName.trim() || `${basketSym} Basket`,
                      legs: [{ symbol: basketSym, side: basketSide, product: 'MIS', orderType: 'MARKET', quantity: Number(basketQty) || 1 }],
                    }),
                  'Saved new Basket template.'
                )
              }
            >
              <Plus size={14} /> Create Basket
            </button>
          </div>

          {baskets.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No saved baskets yet. Create one above or save directly from the Option Strategy Builder.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {baskets.map((b) => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                  <div>
                    <strong>{b.name}</strong> <span className="badge">{b.legs.length} leg(s)</span>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {b.legs.map((l, i) => `${l.side} ${l.quantity} ${l.symbol} (${l.product})`).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-primary"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => runAction(() => api.executeSavedBasket(b.id, mode, false), `Executed basket "${b.name}" in ${mode}.`)}
                    >
                      <Play size={12} /> Execute ({mode})
                    </button>
                    <button
                      className="preset-btn"
                      onClick={() => runAction(() => api.executeSavedBasket(b.id, mode, true), `Executed REVERSED basket "${b.name}".`)}
                    >
                      Reverse
                    </button>
                    <button
                      className="preset-btn"
                      style={{ color: 'var(--loss)' }}
                      onClick={() => runAction(() => api.deleteSavedBasket(b.id), 'Deleted basket.')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 5. Conditional Price/Indicator Triggers */}
      {tab === 'conditional' && (
        <section className="card">
          <h3><Zap size={15} /> Conditional Automated Order Triggers (If Price → Fire Order)</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
            <input className="input" style={{ width: 130 }} placeholder="Symbol" value={condSym} onChange={(e) => setCondSym(e.target.value.toUpperCase())} />
            <select className="input" style={{ width: 110 }} value={condOp} onChange={(e) => setCondOp(e.target.value as 'GTE' | 'LTE')}>
              <option value="GTE">LTP ≥</option>
              <option value="LTE">LTP ≤</option>
            </select>
            <input className="input mono" style={{ width: 100 }} type="number" step="0.05" value={condVal} onChange={(e) => setCondVal(e.target.value)} />
            <select className="input" style={{ width: 90 }} value={condSide} onChange={(e) => setCondSide(e.target.value as 'BUY' | 'SELL')}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <input className="input mono" style={{ width: 75 }} type="number" min={1} value={condQty} onChange={(e) => setCondQty(e.target.value)} />
            <button
              className="btn-primary"
              onClick={() =>
                runAction(
                  () =>
                    api.createConditionalTrigger({
                      accountMode: mode,
                      symbol: condSym,
                      condition: { indicator: 'LTP', timeframe: '5m', operator: condOp, value: Number(condVal) },
                      orders: [{ symbol: condSym, side: condSide, product: 'MIS', orderType: 'MARKET', quantity: Number(condQty) || 1 }],
                    }),
                  `Created Conditional Trigger on ${condSym}.`
                )
              }
            >
              <Plus size={14} /> Add Trigger
            </button>
          </div>
          {triggers.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No conditional triggers configured.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Symbol</th><th>Condition</th><th>Orders to Fire</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {triggers.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.symbol}</strong></td>
                      <td className="mono">{t.condition.indicator} {t.condition.operator} {t.condition.value}</td>
                      <td className="mono">{t.orders.map((o) => `${o.side} ${o.quantity} ${o.symbol}`).join(', ')}</td>
                      <td><span className={`badge ${t.status === 'ACTIVE' ? 'badge-gain' : 'badge-warn'}`}>{t.status}</span></td>
                      <td>
                        {t.status === 'ACTIVE' && (
                          <button className="preset-btn" onClick={() => runAction(() => api.cancelConditionalTrigger(t.id), 'Cancelled trigger.')}>Cancel</button>
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

      {/* 6. Draft Orders */}
      {tab === 'drafts' && (
        <section className="card">
          <h3><Bookmark size={15} /> Draft Orders (Pre-Market Ready Queue)</h3>
          {drafts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No draft orders saved. Click <strong>Draft</strong> inside any Order Ticket to stage orders for 1-click deployment.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Symbol</th><th>Side</th><th>Product</th><th>Type</th><th style={{ textAlign: 'right' }}>Qty</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id}>
                      <td><strong>{d.symbol}</strong></td>
                      <td style={{ color: d.side === 'BUY' ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>{d.side}</td>
                      <td><span className="badge">{d.product}</span></td>
                      <td className="mono">{d.orderType}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{d.quantity}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-primary" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={() => runAction(() => api.executeDraftOrder(d.id), `Executed draft ${d.symbol}.`)}>
                          <Play size={11} /> Deploy Now
                        </button>
                        <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={() => runAction(() => api.deleteDraftOrder(d.id), 'Deleted draft.')}>
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

      {/* 7. Stock & ETF SIPs */}
      {tab === 'sips' && (
        <section className="card">
          <h3><Repeat size={15} /> Stock &amp; ETF SIPs (Automated Recurring Investing)</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
            <input className="input" style={{ width: 140 }} value={sipSymbol} onChange={(e) => setSipSymbol(e.target.value.toUpperCase())} placeholder="Symbol (e.g. NIFTYBEES)" />
            <select className="input" style={{ width: 120 }} value={sipMode} onChange={(e) => setSipMode(e.target.value as 'AMOUNT' | 'QTY')}>
              <option value="AMOUNT">By Amount (₹)</option>
              <option value="QTY">By Qty</option>
            </select>
            <input className="input mono" style={{ width: 110 }} type="number" value={sipVal} onChange={(e) => setSipVal(e.target.value)} />
            <select className="input" style={{ width: 115 }} value={sipFreq} onChange={(e) => setSipFreq(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
            <button
              className="btn-primary"
              onClick={() =>
                runAction(
                  () => api.createStockSip({ accountMode: mode, symbol: sipSymbol, mode: sipMode, value: Number(sipVal), frequency: sipFreq }),
                  `Created ${sipFreq} SIP for ${sipSymbol}.`
                )
              }
            >
              <Plus size={14} /> Start SIP
            </button>
          </div>

          {sips.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No active Stock/ETF SIPs yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Symbol</th><th>Installment</th><th>Frequency</th><th>Runs</th><th>Next Run</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {sips.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.symbol}</strong></td>
                      <td className="mono">{s.mode === 'AMOUNT' ? formatINR(s.value) : `${s.value} shares`}</td>
                      <td><span className="badge">{s.frequency}</span></td>
                      <td className="mono">{s.runsCount}</td>
                      <td className="mono">{new Date(s.nextRunAt).toLocaleDateString('en-IN')}</td>
                      <td><span className={`badge ${s.active ? 'badge-gain' : 'badge-warn'}`}>{s.active ? 'ACTIVE' : 'PAUSED'}</span></td>
                      <td style={{ display: 'flex', gap: 5 }}>
                        <button className="preset-btn" onClick={() => runAction(() => api.runStockSipNow(s.id), `Executed SIP installment for ${s.symbol}.`)}>Run Now</button>
                        <button className="preset-btn" onClick={() => runAction(() => api.toggleStockSip(s.id), 'Toggled SIP status.')}>{s.active ? 'Pause' : 'Resume'}</button>
                        <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={() => runAction(() => api.deleteStockSip(s.id), 'Deleted SIP.')}><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 8. Executed Trades & Itemized Statutory Charges */}
      {tab === 'trades' && (
        <section className="card">
          <h3><ShieldCheck size={15} /> {mode} Executed Trade Book — Full Statutory Charges &amp; Blockchain Proof</h3>
          {trades.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No executed trades in this {mode} epoch yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Side / Prod</th>
                    <th style={{ textAlign: 'right' }}>Qty × Price</th>
                    <th style={{ textAlign: 'right' }}>Brokerage</th>
                    <th style={{ textAlign: 'right' }}>STT/CTT</th>
                    <th style={{ textAlign: 'right' }}>Exch+SEBI+Stamp+DP</th>
                    <th style={{ textAlign: 'right' }}>GST</th>
                    <th style={{ textAlign: 'right' }}>Total Charges</th>
                    <th>Blockchain Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const cb = t.chargeBreakdown;
                    const otherStatutory = cb
                      ? Number(cb.exchangeTransactionCharge) + Number(cb.sebiTurnoverFee) + Number(cb.stampDuty) + Number(cb.dpChargeExclGst)
                      : 0;
                    return (
                      <tr key={t.id}>
                        <td className="mono">{new Date(t.executedAt).toLocaleTimeString('en-IN')}</td>
                        <td><strong>{t.instrument.symbol}</strong></td>
                        <td>
                          <span style={{ color: t.side === 'BUY' ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>{t.side}</span> · {t.product}
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{t.quantity} × {formatINR(t.price)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{cb ? formatINR(cb.brokerage) : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{cb ? formatINR(cb.sttOrCtt) : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{formatINR(otherStatutory)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{cb ? formatINR(cb.gst) : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--warn)', fontWeight: 700 }}>
                          {cb ? formatINR(cb.totalCharges) : '—'}
                        </td>
                        <td>
                          {t.blockchainHash ? (
                            <button className="preset-btn mono" style={{ fontSize: 11 }} onClick={onJumpToBlockchain}>
                              <ShieldCheck size={11} /> {t.blockchainHash.slice(0, 10)}...
                            </button>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
