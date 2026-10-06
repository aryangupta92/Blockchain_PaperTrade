import { useState, useEffect, useMemo } from 'react';
import './OptionChain.css';
import '../Broker/Kite.css';
import api from '../../services/api';
import { RefreshCw, Target, ShieldAlert, BarChart2 } from 'lucide-react';
import AdvancedChart from '../Chart/AdvancedChart';
import { UNDERLYINGS, getSpec, expiriesFor, expiryLabel, buildFOSymbol, legPayoff, payoffRange, SEBI_FO_WARNING } from '../../utils/fo';

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return `${Number(n) >= 0 ? '+' : ''}${fmt(n, 2)}%`;
}
function fmtLakhs(n) {
  if (!n) return '—';
  return (n / 100000).toFixed(2);
}
function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CHAIN_SYM = { NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', SENSEX: '^BSESN', FINNIFTY: 'FINNIFTY', MIDCPNIFTY: 'MIDCPNIFTY' };

// ISO date (server) → DDMMMYY code (OMS symbol)
function isoToCode(iso) {
  try {
    const d = new Date(iso);
    const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return `${String(d.getUTCDate()).padStart(2, '0')}${MON[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
  } catch { return ''; }
}

// ── Payoff-at-expiry chart (Sensibull-style pre-trade chart) ──
function PayoffChart({ leg, spot, step }) {
  if (!leg || !spot) return null;
  const spots = payoffRange(spot, step);
  const vals = spots.map(s => legPayoff(leg, s));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 560, H = 190, PAD = 28;
  const X = (s) => PAD + ((s - spots[0]) / (spots[spots.length - 1] - spots[0])) * (W - 2 * PAD);
  const Y = (v) => PAD + (1 - (v - min) / span) * (H - 2 * PAD);
  const pts = spots.map((s, i) => `${X(s).toFixed(1)},${Y(vals[i]).toFixed(1)}`).join(' ');
  const zeroY = Y(0);
  // breakevens: sign changes
  const bes = [];
  for (let i = 1; i < vals.length; i++) {
    if ((vals[i - 1] < 0 && vals[i] >= 0) || (vals[i - 1] > 0 && vals[i] <= 0)) {
      bes.push(spots[i]);
    }
  }
  const premium = (leg.premium || 0) * leg.qty;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 190 }}>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#475569" strokeWidth="1" strokeDasharray="4 3" />
        <line x1={X(spot)} y1={PAD} x2={X(spot)} y2={H - PAD} stroke="#818cf8" strokeWidth="1" strokeDasharray="4 3" />
        <polyline points={pts} fill="none" stroke={vals[vals.length - 1] >= vals[0] ? '#10b981' : '#f43f5e'} strokeWidth="2" />
        {bes.map((b, i) => (
          <g key={i}>
            <circle cx={X(b)} cy={zeroY} r="4" fill="#f59e0b" />
            <text x={X(b)} y={zeroY - 8} fill="#f59e0b" fontSize="10" textAnchor="middle" fontWeight="700">BE {fmt(b, 0)}</text>
          </g>
        ))}
        <text x={X(spot)} y={H - 6} fill="#818cf8" fontSize="10" textAnchor="middle" fontWeight="700">Spot {fmt(spot, 0)}</text>
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span>Max profit: <b style={{ color: 'var(--gain)' }}>{leg.side === 'sell' && leg.optionType !== 'FUT' ? fmtINR(premium) + ' (premium)' : leg.optionType === 'FUT' ? 'Unlimited' : 'Unlimited'}</b></span>
        <span>Max loss: <b style={{ color: 'var(--loss)' }}>{leg.side === 'buy' ? fmtINR(premium) + ' (premium)' : 'Unlimited (seller)'}</b></span>
        <span>Qty: <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{leg.qty} ({leg.qty / (leg.lot || 1)} lots)</b></span>
      </div>
    </div>
  );
}

export default function OptionChainPage({ symbol = '^NSEI', inModal = false, onTrade, balance, quotes = {}, holdings = {} }) {
  // Resolve initial underlying from incoming symbol
  const initialU = useMemo(() => {
    const s = String(symbol).toUpperCase();
    if (s.includes('BSESN') || s === 'SENSEX') return 'SENSEX';
    if (s.includes('BANK')) return 'BANKNIFTY';
    if (s.includes('FINN')) return 'FINNIFTY';
    if (s.includes('MIDC')) return 'MIDCPNIFTY';
    return 'NIFTY';
  }, [symbol]);

  const [underlying, setUnderlying] = useState(initialU);
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [serverExpiry, setServerExpiry] = useState(''); // value passed to API
  const [localExpiry, setLocalExpiry] = useState('');   // DDMMMYY for OMS symbol
  const [view, setView] = useState('ltp');              // 'ltp' | 'greeks'
  const [strikeWindow, setStrikeWindow] = useState(12);
  // Trade punch state
  const [punch, setPunch] = useState(null); // { strike, optionType, side, lots, product, price }
  const [placing, setPlacing] = useState(false);
  const [punchMsg, setPunchMsg] = useState(null);
  const [margin, setMargin] = useState(null);

  const spec = getSpec(underlying);
  const lot = spec?.lot || 1;
  const step = spec?.step || 50;
  const chainSym = CHAIN_SYM[underlying] || '^NSEI';
  const localExpiries = useMemo(() => expiriesFor(underlying), [underlying]);

  const fetchChain = async (exp) => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.getOptionChain(chainSym, exp);
      setChain(data);
      if (data.expiry && !exp) setServerExpiry(data.expiry);
    } catch (e) {
      console.error('Option chain fetch error:', e);
      setLoadError(e.message);
      setChain(null);
    } finally {
      setLoading(false);
    }
  };

  // Underlying changed → reset expiry, refetch
  useEffect(() => {
    setServerExpiry('');
    setLocalExpiry(localExpiries[0]?.code || '');
    setPunch(null);
    setChain(null);
    fetchChain('');
    // eslint-disable-next-line
  }, [underlying]);

  useEffect(() => { if (serverExpiry) fetchChain(serverExpiry); /* eslint-disable-line */ }, [serverExpiry]);

  // Keep local DDMMMYY in sync for OMS symbol building
  useEffect(() => {
    if (serverExpiry && /^\d{4}-\d{2}-\d{2}/.test(serverExpiry)) {
      setLocalExpiry(isoToCode(serverExpiry));
    } else if (serverExpiry && /^[0-9]{2}[A-Z]{3}[0-9]{2}$/.test(serverExpiry)) {
      setLocalExpiry(serverExpiry);
    }
  }, [serverExpiry]);

  // Margin preview for the punch
  useEffect(() => {
    if (!punch) { setMargin(null); return; }
    const t = setTimeout(async () => {
      try {
        const m = await api.getMarginPreview({
          symbol: buildFOSymbol(underlying, localExpiry, punch.strike, punch.optionType, false),
          quantity: punch.lots * lot,
          price: punch.price,
          side: punch.side,
          productType: punch.product,
        });
        setMargin(m);
      } catch { setMargin(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [punch, localExpiry, underlying, lot]);

  const rows = useMemo(() => chain?.chain || [], [chain]);
  const spot = chain?.spotPrice || 0;

  const visible = useMemo(() => {
    if (!rows.length) return [];
    let atmIdx = rows.findIndex(r => r.atm);
    if (atmIdx < 0 && spot) {
      let best = Infinity;
      rows.forEach((r, i) => {
        const d = Math.abs(r.strike - spot);
        if (d < best) { best = d; atmIdx = i; }
      });
    }
    if (atmIdx < 0) return rows.slice(0, 25);
    return rows.slice(Math.max(0, atmIdx - strikeWindow), atmIdx + strikeWindow + 1);
  }, [rows, spot, strikeWindow]);

  const maxOI = useMemo(() => Math.max(1, ...visible.flatMap(r => [r.call?.oi || 0, r.put?.oi || 0])), [visible]);

  const openPunch = (strike, optionType, side, price) => {
    setPunchMsg(null);
    setPunch({ strike, optionType, side, lots: 1, product: 'NRML', price: Number(price) || 0 });
  };

  const placePunch = async () => {
    if (!punch || !localExpiry) { setPunchMsg({ ok: false, text: 'Pick an expiry first.' }); return; }
    if (!punch.price || punch.price <= 0) { setPunchMsg({ ok: false, text: 'Enter a limit premium — MARKET execution has no live option quote feed.' }); return; }
    if (punch.lots > (spec?.freezeLots || Infinity)) { setPunchMsg({ ok: false, text: `Freeze quantity: max ${spec.freezeLots} lots per order.` }); return; }
    setPlacing(true);
    setPunchMsg(null);
    try {
      const foSym = buildFOSymbol(underlying, localExpiry, punch.strike, punch.optionType, false);
      const res = await onTrade?.({
        type: punch.side,
        symbol: foSym,
        quantity: punch.lots * lot,
        price: Number(punch.price),
        orderType: 'LIMIT',
        productType: punch.product,
      });
      if (res && !res.success && res.violations?.length) {
        setPunchMsg({ ok: false, text: res.violations[0].message });
      } else {
        setPunchMsg({ ok: true, text: `${punch.side.toUpperCase()} ${punch.lots} lot${punch.lots > 1 ? 's' : ''} (${punch.lots * lot} qty) ${foSym} @ ${fmtINR(punch.price)} — ${res?.order?.status || 'placed'}` });
      }
    } catch (e) {
      setPunchMsg({ ok: false, text: e.message });
    } finally {
      setPlacing(false);
    }
  };

  const punchLeg = punch ? {
    optionType: punch.optionType, strike: punch.strike,
    premium: punch.price, qty: punch.lots * lot, side: punch.side, lot,
  } : null;

  const expiryOptions = (chain?.expiries?.length ? chain.expiries : localExpiries.map(e => e.code));
  const expiryValue = serverExpiry || chain?.expiry || localExpiry;

  return (
    <div className={`oc-page ${inModal ? 'in-modal' : ''}`}>
      {!inModal && (
        <div className="oc-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>Option Chain</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>NSE Tue · BSE Thu expiries (SEBI) · lots per NSE FAOP/70616</span>
          </div>
        </div>
      )}

      {/* Underlying tabs */}
      <div className="kite-seg" style={{ marginBottom: 10 }}>
        {Object.entries(UNDERLYINGS).filter(([u]) => CHAIN_SYM[u]).map(([u, s]) => (
          <button key={u} className={underlying === u ? 'active' : ''} onClick={() => setUnderlying(u)}>
            {u} · {s.lot}
          </button>
        ))}
      </div>

      {/* Meta bar */}
      <div className="oc-meta-bar">
        <div className="oc-meta-select-wrap">
          <span className="oc-meta-label">{spec?.label} · {spec?.exchange} · Lot {lot} · Step {step}</span>
          <span className="oc-meta-label">Expiry:</span>
          <select className="oc-expiry-select" value={expiryValue} onChange={e => setServerExpiry(e.target.value)}>
            {expiryOptions.map(ex => {
              const local = localExpiries.find(l => l.code === ex);
              const label = local ? expiryLabel(local) : (/^\d{4}-/.test(ex) ? new Date(ex).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ex);
              return <option key={ex} value={ex}>{label}</option>;
            })}
          </select>
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => fetchChain(serverExpiry)}><RefreshCw size={12} /></button>
        </div>
      </div>

      <div className="ot-alert" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b', display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11, marginBottom: 10 }}>
        <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{SEBI_FO_WARNING}</span>
      </div>

      {loading ? (
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6 }} />)}
        </div>
      ) : !chain ? (
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Option chain unavailable for {underlying}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {loadError || 'All quote providers failed.'} Weekly chains exist only for NIFTY (Tue) &amp; SENSEX (Thu) — others are monthly.
            The spot chart below still works for analysis.
          </div>
          <div className="card" style={{ marginTop: 14, padding: 0, overflow: 'hidden', minHeight: 320 }}>
            <AdvancedChart symbol={chainSym} />
          </div>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="oc-summary">
            <div className="oc-stat"><div className="oc-stat-label">Spot (LTP)</div><div className="oc-stat-val gain">{fmt(spot)}</div></div>
            <div className="oc-stat"><div className="oc-stat-label">Lot / Step</div><div className="oc-stat-val">{lot} / {step}</div></div>
            <div className="oc-stat"><div className="oc-stat-label">PCR (OI)</div><div className="oc-stat-val" style={{ color: (chain.pcr ?? 0) > 1 ? 'var(--gain)' : 'var(--loss)' }}>{fmt(chain.pcr)}</div></div>
            <div className="oc-stat"><div className="oc-stat-label">Max Pain</div><div className="oc-stat-val">{chain.maxPain?.toLocaleString('en-IN') ?? '—'}</div></div>
            <div className="oc-stat"><div className="oc-stat-label">Strikes shown</div><div className="oc-stat-val">{visible.length} / {rows.length}</div></div>
            <div className="oc-stat"><div className="oc-stat-label">Exchange</div><div className="oc-stat-val">{chain.exchange || spec?.exchange}</div></div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <div className="kite-seg">
              <button className={view === 'ltp' ? 'active' : ''} onClick={() => setView('ltp')}>LTP &amp; OI</button>
              <button className={view === 'greeks' ? 'active' : ''} onClick={() => setView('greeks')}>Greeks</button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Strikes ±</span>
            <select value={strikeWindow} onChange={e => setStrikeWindow(Number(e.target.value))} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 12, padding: '4px 8px' }}>
              {[6, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Click a premium to punch the trade — qty is always in lots (1 lot = {lot})</span>
          </div>

          {/* Chain table */}
          <div className="oc-table-wrap">
            <table className="oc-table">
              <thead><tr>
                {view === 'greeks' ? (<><th className="oc-calls-col">IV%</th><th className="oc-calls-col">Δ</th><th className="oc-calls-col">Θ/day</th><th className="oc-calls-col">Vega</th><th className="oc-calls-col">LTP</th></>)
                  : (<><th className="oc-calls-col">OI (L)</th><th className="oc-calls-col">Vol (L)</th><th className="oc-calls-col">IV%</th><th className="oc-calls-col">Bid / Ask</th><th className="oc-calls-col">LTP &amp; Chg%</th></>)}
                <th className="oc-strike-col">STRIKE</th>
                {view === 'greeks' ? (<><th className="oc-puts-col">LTP</th><th className="oc-puts-col">Vega</th><th className="oc-puts-col">Θ/day</th><th className="oc-puts-col">Δ</th><th className="oc-puts-col">IV%</th></>)
                  : (<><th className="oc-puts-col">LTP &amp; Chg%</th><th className="oc-puts-col">Bid / Ask</th><th className="oc-puts-col">IV%</th><th className="oc-puts-col">Vol (L)</th><th className="oc-puts-col">OI (L)</th></>)}
              </tr></thead>
              <tbody>
                {visible.map((row) => {
                  const { strike, call = {}, put = {}, itm = {}, atm } = row;
                  const sel = punch?.strike === strike;
                  return (
                    <tr key={strike} className={`oc-row ${itm.call ? 'oc-itm-call' : ''} ${itm.put ? 'oc-itm-put' : ''} ${atm ? 'oc-atm' : ''} ${sel ? 'oc-highlight' : ''}`}>
                      {view === 'greeks' ? (<>
                        <td className="oc-calls-col mono">{fmt(call.iv, 1)}</td>
                        <td className="oc-calls-col mono">{fmt(call.delta, 2)}</td>
                        <td className="oc-calls-col mono">{fmt(call.theta, 2)}</td>
                        <td className="oc-calls-col mono">{fmt(call.vega, 2)}</td>
                        <td className="oc-calls-col oc-ltp-cell" onClick={() => openPunch(strike, 'CE', 'buy', call.ltp)}>
                          <span className="mono oc-ltp">{fmt(call.ltp)}</span>
                        </td>
                      </>) : (<>
                        <td className="oc-calls-col"><span className="mono">{fmtLakhs(call.oi)}</span>
                          <div className="oc-oi-bar-wrap"><div className="oc-oi-bar-call" style={{ width: `${Math.min(100, ((call.oi || 0) / maxOI) * 100)}%` }} /></div>
                        </td>
                        <td className="oc-calls-col mono">{fmtLakhs(call.volume)}</td>
                        <td className="oc-calls-col mono">{fmt(call.iv, 1)}</td>
                        <td className="oc-calls-col mono" style={{ fontSize: 11 }}>{fmt(call.bid)} / {fmt(call.ask)}</td>
                        <td className="oc-calls-col oc-ltp-cell" onClick={() => openPunch(strike, 'CE', 'buy', call.ltp)}>
                          <span className="mono oc-ltp">{fmt(call.ltp)}</span>
                          <span className={call.changePct >= 0 ? 'oc-chg gain' : 'oc-chg loss'}>{fmtPct(call.changePct)}</span>
                        </td>
                      </>)}
                      <td className={`oc-strike-col ${atm ? 'oc-strike-atm' : ''}`}>{strike.toLocaleString('en-IN')}</td>
                      {view === 'greeks' ? (<>
                        <td className="oc-puts-col oc-ltp-cell" onClick={() => openPunch(strike, 'PE', 'buy', put.ltp)}>
                          <span className="mono oc-ltp">{fmt(put.ltp)}</span>
                        </td>
                        <td className="oc-puts-col mono">{fmt(put.vega, 2)}</td>
                        <td className="oc-puts-col mono">{fmt(put.theta, 2)}</td>
                        <td className="oc-puts-col mono">{fmt(put.delta, 2)}</td>
                        <td className="oc-puts-col mono">{fmt(put.iv, 1)}</td>
                      </>) : (<>
                        <td className="oc-puts-col oc-ltp-cell" onClick={() => openPunch(strike, 'PE', 'buy', put.ltp)}>
                          <span className="mono oc-ltp">{fmt(put.ltp)}</span>
                          <span className={put.changePct >= 0 ? 'oc-chg gain' : 'oc-chg loss'}>{fmtPct(put.changePct)}</span>
                        </td>
                        <td className="oc-puts-col mono" style={{ fontSize: 11 }}>{fmt(put.bid)} / {fmt(put.ask)}</td>
                        <td className="oc-puts-col mono">{fmt(put.iv, 1)}</td>
                        <td className="oc-puts-col mono">{fmtLakhs(put.volume)}</td>
                        <td className="oc-puts-col"><span className="mono">{fmtLakhs(put.oi)}</span>
                          <div className="oc-oi-bar-wrap"><div className="oc-oi-bar-put" style={{ width: `${Math.min(100, ((put.oi || 0) / maxOI) * 100)}%` }} /></div>
                        </td>
                      </>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Trade punch + charts */}
          {punch && (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>
                  {punch.side === 'buy' ? 'BUY' : 'SELL'} {underlying} {punch.strike} {punch.optionType}
                </span>
                <span className="kite-exch">{spec?.exchange}</span>
                <span className="kite-chip nrml">{localExpiry || 'pick expiry'}</span>
                <div className="kite-seg" style={{ marginLeft: 'auto' }}>
                  <button className={punch.side === 'buy' ? 'active' : ''} onClick={() => setPunch(p => ({ ...p, side: 'buy' }))}>Buy</button>
                  <button className={punch.side === 'sell' ? 'active sell-active' : ''} onClick={() => setPunch(p => ({ ...p, side: 'sell' }))}>Sell</button>
                  <button className={punch.product === 'NRML' ? 'active' : ''} onClick={() => setPunch(p => ({ ...p, product: 'NRML' }))}>NRML</button>
                  <button className={punch.product === 'MIS' ? 'active' : ''} onClick={() => setPunch(p => ({ ...p, product: 'MIS' }))}>MIS</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div>
                  <div className="kite-field" style={{ marginBottom: 8 }}>
                    <label>Lots (1 lot = {lot} qty · max {spec?.freezeLots}/order)</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setPunch(p => ({ ...p, lots: Math.max(1, p.lots - 1) }))} style={{ width: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }}>−</button>
                      <input type="number" value={punch.lots} min={1} max={spec?.freezeLots} onChange={e => setPunch(p => ({ ...p, lots: Math.max(1, Math.min(spec?.freezeLots || 9999, Number(e.target.value) || 1)) }))} style={{ textAlign: 'center', width: '100%', padding: '7px 8px', borderRadius: 7, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }} />
                      <button onClick={() => setPunch(p => ({ ...p, lots: Math.min(spec?.freezeLots || 9999, p.lots + 1) }))} style={{ width: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }}>+</button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Qty {punch.lots * lot} × {fmtINR(punch.price)} = <b style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmtINR(punch.lots * lot * (punch.price || 0))}</b> premium
                      {punch.side === 'sell' && ' · seller blocks SPAN + exposure, not premium'}
                    </div>
                  </div>
                  <div className="kite-field" style={{ marginBottom: 8 }}>
                    <label>Limit premium (₹) — no live option feed, LIMIT only</label>
                    <input type="number" value={punch.price || ''} onChange={e => setPunch(p => ({ ...p, price: Number(e.target.value) }))} placeholder="e.g. 142.50"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }} />
                  </div>
                  {margin && (
                    <div style={{ fontSize: 12, marginBottom: 8 }}>
                      Margin required: <b style={{ fontFamily: 'var(--font-mono)', color: margin.sufficient ? 'var(--text-primary)' : 'var(--loss)' }}>{fmtINR(margin.margin?.required)}</b>
                      <span style={{ color: 'var(--text-muted)' }}> · avail {fmtINR(margin.available)}</span>
                      {margin.margin?.leverage && <span style={{ color: '#387ed1', fontWeight: 700 }}> · {margin.margin.leverage}</span>}
                    </div>
                  )}
                  {punchMsg && <div style={{ fontSize: 12, fontWeight: 700, color: punchMsg.ok ? 'var(--gain)' : 'var(--loss)', marginBottom: 8 }}>{punchMsg.text}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={`kite-submit ${punch.side}`} style={{ flex: 1 }} disabled={placing} onClick={placePunch}>
                      {placing ? 'Placing…' : `${punch.side === 'buy' ? 'BUY' : 'SELL'} ${punch.lots} lot${punch.lots > 1 ? 's' : ''} · ${punch.product}`}
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setPunch(null)}>Close</button>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
                    {buildFOSymbol(underlying, localExpiry, punch.strike, punch.optionType, false)} · STT {punch.side === 'sell' ? '0.15% of premium' : 'nil (0.15% only on exercise)'} · Brokerage max ₹20
                  </div>
                </div>
                <div>
                  <div className="section-title" style={{ marginBottom: 6 }}>Payoff at expiry · {punch.optionType} {punch.strike}</div>
                  <PayoffChart leg={punchLeg} spot={spot} step={step} />
                </div>
              </div>
            </div>
          )}

          {/* Spot chart */}
          <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden', minHeight: 340 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <BarChart2 size={14} style={{ color: 'var(--accent-primary)' }} />
              <span className="section-title">{spec?.label} spot · Greeks use TTM to {localExpiry || 'expiry'} @ 5% risk-free</span>
            </div>
            <AdvancedChart symbol={chainSym} quote={quotes[chainSym] || null} />
          </div>
        </>
      )}
    </div>
  );
}
