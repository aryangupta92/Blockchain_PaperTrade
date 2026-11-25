import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Bookmark, Cpu, Flame, Layers, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface OptionChainPageProps {
  mode: AccountMode;
  initialUnderlying?: string;
  onTradeClick: (symbol: string, side: 'BUY' | 'SELL', segment: string, ltp: string | null) => void;
  onChartClick: (symbol: string, segment: string) => void;
  onBasketExecuted: () => void;
}

interface BasketLeg {
  id: string;
  symbol: string;
  underlying: string;
  optionType: 'CE' | 'PE';
  side: 'BUY' | 'SELL';
  strike: number;
  expiry: string;
  quantity: number;
  premium: number;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
}

const BUILDUP_LABELS: Record<string, { short: string; color: string }> = {
  LONG_BUILDUP: { short: 'LB', color: 'var(--gain)' },
  SHORT_BUILDUP: { short: 'SB', color: 'var(--loss)' },
  SHORT_COVERING: { short: 'SC', color: '#38bdf8' },
  LONG_UNWINDING: { short: 'LU', color: 'var(--warn)' },
  NEUTRAL: { short: '—', color: 'var(--text-muted)' },
};

const QUANT_RULE_OPTIONS = [
  { id: 'ATM_POINTS', label: 'ATM ± Points', defaultVal: 0 },
  { id: 'ATM_PERCENT', label: 'ATM ± %', defaultVal: 1 },
  { id: 'CLOSEST_PREMIUM', label: 'Closest Premium (₹)', defaultVal: 100 },
  { id: 'CLOSEST_DELTA', label: 'Closest Delta', defaultVal: 0.25 },
  { id: 'HIGHEST_OI', label: 'Highest OI', defaultVal: 0 },
  { id: 'HIGHEST_OI_CHG', label: 'Highest OI Change', defaultVal: 0 },
  { id: 'HIGHEST_VOLUME', label: 'Highest Volume', defaultVal: 0 },
  { id: 'STRADDLE_WIDTH', label: 'Straddle Width ×', defaultVal: 1 },
  { id: 'HIGHEST_GAMMA', label: 'Highest Gamma', defaultVal: 0 },
];

function DualPayoffSvg({
  curve,
  spot,
  simulatedSpot,
  sd1,
  sd2,
}: {
  curve: Array<{ spot: number; pnl: number; targetPnl?: number }>;
  spot: number;
  simulatedSpot?: number;
  sd1?: { low: number; high: number };
  sd2?: { low: number; high: number };
}) {
  if (curve.length < 2) return null;
  const W = 540;
  const H = 200;
  const pad = 26;
  const minX = curve[0].spot;
  const maxX = curve[curve.length - 1].spot;
  const allY = curve.flatMap((p) => (p.targetPnl != null ? [p.pnl, p.targetPnl] : [p.pnl]));
  const minY = Math.min(0, ...allY);
  const maxY = Math.max(0, ...allY);
  const spanY = Math.max(1, maxY - minY);
  const spanX = Math.max(1, maxX - minX);

  const sx = (v: number) => Math.max(pad, Math.min(W - pad, pad + ((v - minX) / spanX) * (W - pad * 2)));
  const sy = (v: number) => H - pad - ((v - minY) / spanY) * (H - pad * 2);
  const zeroY = sy(0);
  const spotX = sx(simulatedSpot ?? spot);

  const expiryPath = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.spot).toFixed(1)},${sy(p.pnl).toFixed(1)}`).join(' ');
  const t0Path = curve.some((p) => p.targetPnl != null)
    ? curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.spot).toFixed(1)},${sy(p.targetPnl ?? p.pnl).toFixed(1)}`).join(' ')
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 220, background: 'var(--bg-elevated)', borderRadius: 8 }}>
      {/* ±2 SD & ±1 SD Probability Bands */}
      {sd2 && (
        <rect x={sx(sd2.low)} y={pad} width={Math.max(0, sx(sd2.high) - sx(sd2.low))} height={H - pad * 2} fill="rgba(56,189,248,0.06)" />
      )}
      {sd1 && (
        <rect x={sx(sd1.low)} y={pad} width={Math.max(0, sx(sd1.high) - sx(sd1.low))} height={H - pad * 2} fill="rgba(56,189,248,0.11)" />
      )}
      <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#64748b" strokeDasharray="4 4" strokeWidth={1} />
      <line x1={spotX} y1={pad} x2={spotX} y2={H - pad} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1.3} />
      <path d={expiryPath} fill="none" stroke="#10b981" strokeWidth={2.2} />
      {t0Path && <path d={t0Path} fill="none" stroke="#38bdf8" strokeWidth={1.8} strokeDasharray="5 3" />}
      <text x={spotX + 4} y={pad + 10} fill="#f59e0b" fontSize={10}>Spot {(simulatedSpot ?? spot).toFixed(0)}</text>
      <text x={pad} y={pad + 10} fill="#10b981" fontSize={10}>Expiry Max +{maxY.toFixed(0)}</text>
      <text x={pad} y={H - 6} fill="#ef4444" fontSize={10}>Min {minY.toFixed(0)}</text>
      <text x={W - 165} y={pad + 10} fill="#38bdf8" fontSize={9.5}>--- T+0 Target Curve | ±1σ/2σ</text>
    </svg>
  );
}

export function OptionChainPage({
  mode,
  initialUnderlying,
  onTradeClick,
  onChartClick,
  onBasketExecuted,
}: OptionChainPageProps) {
  const [subTab, setSubTab] = useState<'chain' | 'quant' | 'flash' | 'analytics'>('chain');
  const [chainView, setChainView] = useState<'standard' | 'greeks' | 'oi'>('standard');

  const [underlyings, setUnderlyings] = useState<Awaited<ReturnType<typeof api.fnoUnderlyings>> | null>(null);
  const [selectedUnderlying, setSelectedUnderlying] = useState(initialUnderlying || 'NIFTY');
  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(undefined);
  const [chain, setChain] = useState<Awaited<ReturnType<typeof api.fnoOptionChain>> | null>(null);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof api.fnoTemplates>>['templates']>([]);
  const [outlookFilter, setOutlookFilter] = useState<'BULLISH' | 'BEARISH' | 'NON_DIRECTIONAL' | 'VOLATILITY'>('NON_DIRECTIONAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Strategy Builder + Interactive What-If Sliders
  const [legs, setLegs] = useState<BasketLeg[]>([]);
  const [targetDaysOffset, setTargetDaysOffset] = useState(0);
  const [ivShiftPct, setIvShiftPct] = useState(0);
  const [spotShiftPct, setSpotShiftPct] = useState(0);
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof api.analyzeStrategy>> | null>(null);
  const [basketMsg, setBasketMsg] = useState<string | null>(null);
  const [basketBusy, setBasketBusy] = useState(false);

  // Quant Mode State
  const [quantRules, setQuantRules] = useState<Array<{ optionType: 'CE' | 'PE'; side: 'BUY' | 'SELL'; lots: number; rule: string; value: number }>>([
    { optionType: 'CE', side: 'SELL', lots: 1, rule: 'CLOSEST_DELTA', value: 0.25 },
    { optionType: 'PE', side: 'SELL', lots: 1, rule: 'CLOSEST_DELTA', value: 0.25 },
  ]);
  const [quantResult, setQuantResult] = useState<Awaited<ReturnType<typeof api.fnoQuantBuild>> | null>(null);

  // Flash Trade State
  const [flashView, setFlashView] = useState<'BULLISH' | 'BEARISH'>('BULLISH');
  const [flashData, setFlashData] = useState<Awaited<ReturnType<typeof api.fnoFlash>> | null>(null);

  // Analytics State
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.fnoAnalytics>> | null>(null);

  useEffect(() => {
    if (initialUnderlying) {
      setSelectedUnderlying(initialUnderlying);
      setSelectedExpiry(undefined);
    }
  }, [initialUnderlying]);

  useEffect(() => {
    api.fnoUnderlyings().then(setUnderlyings).catch(() => {});
    api.fnoTemplates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  const loadChain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fnoOptionChain(selectedUnderlying, selectedExpiry);
      setChain(res);
      if (!selectedExpiry && res.expiry) setSelectedExpiry(res.expiry);
    } catch (e) {
      setChain(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedUnderlying, selectedExpiry]);

  useEffect(() => {
    loadChain();
  }, [loadChain]);

  useEffect(() => {
    if (subTab === 'flash') {
      api.fnoFlash(selectedUnderlying, flashView, selectedExpiry).then(setFlashData).catch(() => setFlashData(null));
    } else if (subTab === 'analytics') {
      api.fnoAnalytics(selectedUnderlying, selectedExpiry).then(setAnalytics).catch(() => setAnalytics(null));
    }
  }, [subTab, selectedUnderlying, selectedExpiry, flashView]);

  // Re-analyze multi-leg strategy whenever legs or What-If sliders change
  useEffect(() => {
    if (!chain || legs.length === 0) {
      setAnalysis(null);
      return;
    }
    api
      .analyzeStrategy({
        spotPrice: Number(chain.spotPrice),
        targetDaysOffset,
        ivShiftPct,
        spotShiftPct,
        legs: legs.map((l) => ({
          symbol: l.symbol,
          underlying: l.underlying,
          optionType: l.optionType,
          side: l.side,
          strike: l.strike,
          expiry: l.expiry,
          quantity: l.quantity,
          premium: l.premium,
          iv: l.iv,
          delta: l.delta,
          gamma: l.gamma,
          theta: l.theta,
          vega: l.vega,
        })),
      })
      .then(setAnalysis)
      .catch(() => setAnalysis(null));
  }, [chain, legs, targetDaysOffset, ivShiftPct, spotShiftPct]);

  const visibleRows = useMemo(() => {
    if (!chain) return [];
    const atmIdx = chain.rows.findIndex((r) => r.atm);
    const center = atmIdx >= 0 ? atmIdx : Math.floor(chain.rows.length / 2);
    return chain.rows.slice(Math.max(0, center - 10), Math.min(chain.rows.length, center + 11));
  }, [chain]);

  const maxOi = useMemo(() => {
    let m = 1;
    for (const r of visibleRows) m = Math.max(m, r.call.oi, r.put.oi);
    return m;
  }, [visibleRows]);

  const addLeg = (row: (typeof visibleRows)[number], opt: 'CE' | 'PE', side: 'BUY' | 'SELL') => {
    if (!chain) return;
    const legData = opt === 'CE' ? row.call : row.put;
    const sym = legData.tradingSymbol || `${chain.underlying}-${chain.expiry}-${row.strike}-${opt}`;
    setLegs((prev) => [
      ...prev,
      {
        id: `${sym}-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        symbol: sym,
        underlying: chain.underlying,
        optionType: opt,
        side,
        strike: row.strike,
        expiry: chain.expiry,
        quantity: legData.lotSize || chain.lotSize || 1,
        premium: Number(legData.ltp || 0),
        iv: legData.iv,
        delta: legData.delta,
        gamma: legData.gamma,
        theta: legData.theta,
        vega: legData.vega,
      },
    ]);
  };

  const applyStrategyTemplate = (tpl: (typeof templates)[number]) => {
    if (!chain || chain.rows.length < 5) return;
    const atmIdx = chain.rows.findIndex((r) => r.atm);
    const c = atmIdx >= 0 ? atmIdx : Math.floor(chain.rows.length / 2);
    const built: BasketLeg[] = tpl.legs.map((tl, i) => {
      const targetIdx = Math.max(0, Math.min(chain.rows.length - 1, c + tl.strikeOffsetSteps));
      const row = chain.rows[targetIdx];
      const d = tl.optionType === 'CE' ? row.call : row.put;
      const exp = tl.expiryIndex && chain.expiries[tl.expiryIndex] ? chain.expiries[tl.expiryIndex] : chain.expiry;
      return {
        id: `${tpl.id}-${i}-${Date.now()}`,
        symbol: d.tradingSymbol || `${chain.underlying}-${exp}-${row.strike}-${tl.optionType}`,
        underlying: chain.underlying,
        optionType: tl.optionType,
        side: tl.side,
        strike: row.strike,
        expiry: exp,
        quantity: (d.lotSize || chain.lotSize || 1) * tl.lots,
        premium: Number(d.ltp || 0),
        iv: d.iv,
        delta: d.delta,
        gamma: d.gamma,
        theta: d.theta,
        vega: d.vega,
      };
    });
    setLegs(built);
    setTargetDaysOffset(0);
    setIvShiftPct(0);
    setSpotShiftPct(0);
  };

  const handleRunQuant = async () => {
    setError(null);
    try {
      const res = await api.fnoQuantBuild({ underlying: selectedUnderlying, expiry: selectedExpiry, rules: quantRules });
      setQuantResult(res);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSaveAsBasket = async () => {
    if (legs.length === 0) return;
    await api.createSavedBasket({
      name: `${selectedUnderlying} ${legs.length}-Leg Strategy`,
      legs: legs.map((l) => ({ symbol: l.symbol, side: l.side, product: 'NRML', orderType: 'MARKET', quantity: l.quantity })),
    });
    setBasketMsg('Saved strategy to your Saved Baskets tab (Orders → Baskets).');
  };

  const handleExecuteBasket = async () => {
    if (legs.length === 0) return;
    setBasketBusy(true);
    setBasketMsg(null);
    try {
      const res = await api.executeBasket({
        accountMode: mode,
        product: 'NRML',
        legs: legs.map((l) => ({ symbol: l.symbol, side: l.side, quantity: l.quantity })),
      });
      setBasketMsg(`Basket executed in ${mode}: ${res.succeeded}/${res.totalLegs} legs filled (BUY hedges routed first).`);
      onBasketExecuted();
    } catch (e) {
      setBasketMsg((e as Error).message);
    } finally {
      setBasketBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header Controls & Sub-Tabs */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <BarChart3 size={18} color="var(--active-mode-accent)" />
            <select
              className="input"
              style={{ width: 170 }}
              value={selectedUnderlying}
              onChange={(e) => { setSelectedUnderlying(e.target.value); setSelectedExpiry(undefined); setLegs([]); }}
            >
              <optgroup label="Index F&O">
                {(underlyings?.indices || [{ symbol: 'NIFTY', displayName: 'Nifty 50', exchange: 'NSE', weeklyAllowed: true }]).map((idx) => (
                  <option key={idx.symbol} value={idx.symbol}>
                    {idx.symbol} ({idx.exchange}{idx.weeklyAllowed ? ' · Weekly' : ' · Monthly'})
                  </option>
                ))}
              </optgroup>
              {underlyings && underlyings.stocks.length > 0 && (
                <optgroup label="Stock F&O">
                  {underlyings.stocks.slice(0, 80).map((s) => (
                    <option key={s.symbol} value={s.symbol}>{s.symbol} (Lot {s.lotSize})</option>
                  ))}
                </optgroup>
              )}
            </select>

            <select className="input" style={{ width: 145 }} value={selectedExpiry || chain?.expiry || ''} onChange={(e) => setSelectedExpiry(e.target.value)}>
              {(chain?.expiries || []).map((exp) => <option key={exp} value={exp}>{exp}</option>)}
            </select>

            <button className="theme-toggle" onClick={loadChain} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`preset-btn ${subTab === 'chain' ? 'active' : ''}`} onClick={() => setSubTab('chain')}>
              <Layers size={12} /> Chain &amp; Strategy Builder
            </button>
            <button className={`preset-btn ${subTab === 'quant' ? 'active' : ''}`} onClick={() => setSubTab('quant')}>
              <Cpu size={12} /> Quant Mode (9 Rules)
            </button>
            <button className={`preset-btn ${subTab === 'flash' ? 'active' : ''}`} onClick={() => setSubTab('flash')}>
              <Flame size={12} /> Flash Trade
            </button>
            <button className={`preset-btn ${subTab === 'analytics' ? 'active' : ''}`} onClick={() => setSubTab('analytics')}>
              <Activity size={12} /> OI &amp; Straddle Analytics
            </button>
          </div>
        </div>

        {chain && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <span>Spot: <strong className="mono">{formatINR(chain.spotPrice)}</strong></span>
            <span>PCR: <strong className="mono">{chain.pcr ?? '—'}</strong></span>
            <span>Max Pain: <strong className="mono">{chain.maxPain ?? '—'}</strong></span>
            {chain.atmStraddlePrice != null && (
              <span>ATM Straddle: <strong className="mono" style={{ color: 'var(--warn)' }}>{formatINR(chain.atmStraddlePrice)} ({chain.atmStraddlePct}%)</strong></span>
            )}
            <span>Lot Size: <strong className="mono">{chain.lotSize}</strong></span>
            <span className={`badge ${chain.weeklyAllowed ? 'badge-gain' : 'badge-warn'}`}>
              {chain.weeklyAllowed ? 'SEBI Weekly Index' : 'Monthly Only'}
            </span>
          </div>
        )}
      </section>

      {error && <div className="alert-error">{error}</div>}

      {/* SUB-TAB 1: Option Chain + 17-Template Strategy Builder + T+0 What-If */}
      {subTab === 'chain' && (
        <>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}><Layers size={15} /> Multi-Leg Strategy Builder — 17 Templates &amp; T+0 What-If Simulator ({mode})</h3>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['BULLISH', 'BEARISH', 'NON_DIRECTIONAL', 'VOLATILITY'] as const).map((o) => (
                  <button key={o} className={`preset-btn ${outlookFilter === o ? 'active' : ''}`} style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setOutlookFilter(o)}>
                    {o.replace('_', ' ')}
                  </button>
                ))}
                {legs.length > 0 && (
                  <button className="preset-btn" style={{ color: 'var(--loss)', fontSize: 11, padding: '3px 8px' }} onClick={() => setLegs([])}>
                    <Trash2 size={11} /> Clear
                  </button>
                )}
              </div>
            </div>

            {/* Filtered Template Chips */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
              {templates.filter((t) => t.outlook === outlookFilter).map((tpl) => (
                <button key={tpl.id} className="preset-btn" style={{ fontSize: 11 }} title={tpl.description} onClick={() => applyStrategyTemplate(tpl)}>
                  {tpl.name}
                </button>
              ))}
            </div>

            {legs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Pick any of the 17 strategy templates above or click <strong>+B / +S</strong> on the Option Chain below to analyze Expiry vs T+0 payoff, POP%, ±1σ/±2σ moves, and hedge margins.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(300px, 1fr)', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>Side</th><th>Contract</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>LTP</th><th></th></tr>
                      </thead>
                      <tbody>
                        {legs.map((l) => (
                          <tr key={l.id}>
                            <td style={{ color: l.side === 'BUY' ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>{l.side}</td>
                            <td className="mono">{l.symbol}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{l.quantity}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{formatINR(l.premium)}</td>
                            <td><button className="preset-btn" onClick={() => setLegs((p) => p.filter((x) => x.id !== l.id))}>×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {analysis && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8, fontSize: 11.5, background: 'var(--bg-elevated)', padding: 10, borderRadius: 8 }}>
                      <div>Max Profit: <strong className="mono" style={{ color: 'var(--gain)' }}>{analysis.maxProfit}</strong></div>
                      <div>Max Loss: <strong className="mono" style={{ color: 'var(--loss)' }}>{analysis.maxLoss}</strong></div>
                      <div>POP%: <strong className="mono" style={{ color: '#38bdf8' }}>{analysis.probabilityOfProfitPct ?? '—'}%</strong></div>
                      <div>R:R: <strong className="mono">{analysis.riskRewardRatio ?? '—'}</strong></div>
                      <div>Hedged Margin: <strong className="mono">{formatINR(analysis.marginEstimate.hedgedMargin)}</strong></div>
                      <div>Hedge Saved: <strong className="mono" style={{ color: 'var(--gain)' }}>{formatINR(analysis.marginEstimate.hedgeBenefit)}</strong></div>
                      <div>Charges: <strong className="mono" style={{ color: 'var(--warn)' }}>{formatINR(analysis.charges.totalCharges)}</strong></div>
                      <div>Net Δ/Θ/ν: <strong className="mono">{analysis.netGreeks.delta}/{analysis.netGreeks.theta}/{analysis.netGreeks.vega}</strong></div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" style={{ flex: 1 }} onClick={handleExecuteBasket} disabled={basketBusy}>
                      <Play size={14} /> {basketBusy ? 'Executing...' : `Execute ${legs.length}-Leg Basket (${mode})`}
                    </button>
                    <button className="theme-toggle" onClick={handleSaveAsBasket}>
                      <Bookmark size={14} /> Save Basket
                    </button>
                  </div>
                  {basketMsg && <div className="alert-success" style={{ fontSize: 11.5 }}>{basketMsg}</div>}
                </div>

                {/* Dual-Curve Payoff Graph + Interactive What-If Sliders */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {analysis && (
                    <DualPayoffSvg
                      curve={analysis.payoffCurve}
                      spot={analysis.spotPrice}
                      simulatedSpot={analysis.simulatedSpot}
                      sd1={analysis.expectedMove1SD}
                      sd2={analysis.expectedMove2SD}
                    />
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg-elevated)', padding: 8, borderRadius: 8, fontSize: 11 }}>
                    <label>
                      <div>Spot Shift: <strong className="mono">{spotShiftPct > 0 ? '+' : ''}{spotShiftPct}%</strong></div>
                      <input type="range" min={-10} max={10} step={0.5} value={spotShiftPct} onChange={(e) => setSpotShiftPct(Number(e.target.value))} style={{ width: '100%' }} />
                    </label>
                    <label>
                      <div>Target Days: <strong className="mono">T+{targetDaysOffset}d</strong></div>
                      <input type="range" min={0} max={Math.max(1, Math.ceil(analysis?.daysToExpiry || 7))} step={1} value={targetDaysOffset} onChange={(e) => setTargetDaysOffset(Number(e.target.value))} style={{ width: '100%' }} />
                    </label>
                    <label>
                      <div>IV Shift: <strong className="mono">{ivShiftPct > 0 ? '+' : ''}{ivShiftPct}%</strong></div>
                      <input type="range" min={-20} max={30} step={1} value={ivShiftPct} onChange={(e) => setIvShiftPct(Number(e.target.value))} style={{ width: '100%' }} />
                    </label>
                  </div>
                  {analysis && analysis.breakevens.length > 0 && (
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Breakevens: {analysis.breakevens.join(', ')}
                      {analysis.expectedMove1SD ? ` · ±1σ: ${analysis.expectedMove1SD.low}–${analysis.expectedMove1SD.high}` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Option Chain Table with Presets & 4-Quadrant OI Buildup */}
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0 }}>CALLS (CE) — STRIKE — PUTS (PE)</h3>
              <div style={{ display: 'flex', gap: 5 }}>
                <button className={`preset-btn ${chainView === 'standard' ? 'active' : ''}`} style={{ fontSize: 11 }} onClick={() => setChainView('standard')}>Standard</button>
                <button className={`preset-btn ${chainView === 'greeks' ? 'active' : ''}`} style={{ fontSize: 11 }} onClick={() => setChainView('greeks')}>Full Greeks</button>
                <button className={`preset-btn ${chainView === 'oi' ? 'active' : ''}`} style={{ fontSize: 11 }} onClick={() => setChainView('oi')}>OI &amp; Buildup</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>CE Actions</th>
                    <th style={{ textAlign: 'right' }}>CE OI</th>
                    <th style={{ textAlign: 'right' }}>{chainView === 'greeks' ? 'Δ / Γ / Θ / ν' : 'Buildup / ΔOI'}</th>
                    <th style={{ textAlign: 'right' }}>IV</th>
                    <th style={{ textAlign: 'right' }}>CE LTP</th>
                    <th style={{ textAlign: 'center', background: 'var(--bg-elevated)' }}>STRIKE / PCR</th>
                    <th style={{ textAlign: 'right' }}>PE LTP</th>
                    <th style={{ textAlign: 'right' }}>IV</th>
                    <th style={{ textAlign: 'right' }}>{chainView === 'greeks' ? 'Δ / Γ / Θ / ν' : 'Buildup / ΔOI'}</th>
                    <th style={{ textAlign: 'right' }}>PE OI</th>
                    <th>PE Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const ceSym = row.call.tradingSymbol || `${chain?.underlying}-${row.strike}-CE`;
                    const peSym = row.put.tradingSymbol || `${chain?.underlying}-${row.strike}-PE`;
                    const ceBg = row.itmCall ? 'rgba(16,185,129,0.06)' : 'transparent';
                    const peBg = row.itmPut ? 'rgba(239,68,68,0.06)' : 'transparent';
                    const ceB = BUILDUP_LABELS[row.call.buildup || 'NEUTRAL'] || BUILDUP_LABELS.NEUTRAL;
                    const peB = BUILDUP_LABELS[row.put.buildup || 'NEUTRAL'] || BUILDUP_LABELS.NEUTRAL;
                    return (
                      <tr key={row.strike} style={{ outline: row.atm ? '1px solid var(--active-mode-accent)' : 'none' }}>
                        <td style={{ background: ceBg, display: 'flex', gap: 2 }}>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10, color: 'var(--gain)', borderColor: 'var(--gain)' }} onClick={() => onTradeClick(ceSym, 'BUY', 'FNO', row.call.ltp)}>B</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10, color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={() => onTradeClick(ceSym, 'SELL', 'FNO', row.call.ltp)}>S</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => addLeg(row, 'CE', 'BUY')}>+B</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => addLeg(row, 'CE', 'SELL')}>+S</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => onChartClick(ceSym, 'FNO')}>Ch</button>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', background: ceBg }}>
                          <div>{row.call.oi.toLocaleString('en-IN')}</div>
                          <div style={{ height: 3, background: 'rgba(16,185,129,0.55)', width: `${Math.min(100, (row.call.oi / maxOi) * 100)}%`, marginLeft: 'auto' }} />
                        </td>
                        <td className="mono" style={{ textAlign: 'right', background: ceBg }}>
                          {chainView === 'greeks' ? (
                            <span>{row.call.delta?.toFixed(2) ?? '—'} / {row.call.gamma?.toFixed(4) ?? '—'} / {row.call.theta?.toFixed(1) ?? '—'} / {row.call.vega?.toFixed(1) ?? '—'}</span>
                          ) : (
                            <span><strong style={{ color: ceB.color }}>{ceB.short}</strong> · {row.call.oiChange.toLocaleString('en-IN')}</span>
                          )}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', background: ceBg }}>{row.call.iv != null ? `${row.call.iv.toFixed(1)}%` : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, background: ceBg }}>{row.call.ltp ?? '—'}</td>

                        <td className="mono" style={{ textAlign: 'center', fontWeight: 800, background: row.atm ? 'var(--active-mode-bg)' : 'var(--bg-elevated)', color: row.atm ? 'var(--active-mode-accent)' : 'var(--text-primary)' }}>
                          <div>{row.strike} {row.atm ? 'ATM' : ''}</div>
                          {row.strikePcr != null && <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>PCR {row.strikePcr}</div>}
                        </td>

                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, background: peBg }}>{row.put.ltp ?? '—'}</td>
                        <td className="mono" style={{ textAlign: 'right', background: peBg }}>{row.put.iv != null ? `${row.put.iv.toFixed(1)}%` : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right', background: peBg }}>
                          {chainView === 'greeks' ? (
                            <span>{row.put.delta?.toFixed(2) ?? '—'} / {row.put.gamma?.toFixed(4) ?? '—'} / {row.put.theta?.toFixed(1) ?? '—'} / {row.put.vega?.toFixed(1) ?? '—'}</span>
                          ) : (
                            <span><strong style={{ color: peB.color }}>{peB.short}</strong> · {row.put.oiChange.toLocaleString('en-IN')}</span>
                          )}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', background: peBg }}>
                          <div>{row.put.oi.toLocaleString('en-IN')}</div>
                          <div style={{ height: 3, background: 'rgba(239,68,68,0.55)', width: `${Math.min(100, (row.put.oi / maxOi) * 100)}%` }} />
                        </td>
                        <td style={{ background: peBg, display: 'flex', gap: 2 }}>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10, color: 'var(--gain)', borderColor: 'var(--gain)' }} onClick={() => onTradeClick(peSym, 'BUY', 'FNO', row.put.ltp)}>B</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10, color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={() => onTradeClick(peSym, 'SELL', 'FNO', row.put.ltp)}>S</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => addLeg(row, 'PE', 'BUY')}>+B</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => addLeg(row, 'PE', 'SELL')}>+S</button>
                          <button className="preset-btn" style={{ padding: '2px 4px', fontSize: 10 }} onClick={() => onChartClick(peSym, 'FNO')}>Ch</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* SUB-TAB 2: Quant Mode (9 Automated Strike Selection Rules) */}
      {subTab === 'quant' && (
        <section className="card">
          <h3><Cpu size={15} /> Quant Mode — Rule-Based Automated Option Strategy Builder</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {quantRules.map((r, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 8, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <select className="input" style={{ width: 85 }} value={r.side} onChange={(e) => setQuantRules((p) => p.map((x, i) => (i === idx ? { ...x, side: e.target.value as 'BUY' | 'SELL' } : x)))}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select className="input" style={{ width: 80 }} value={r.optionType} onChange={(e) => setQuantRules((p) => p.map((x, i) => (i === idx ? { ...x, optionType: e.target.value as 'CE' | 'PE' } : x)))}>
                  <option value="CE">CE</option>
                  <option value="PE">PE</option>
                </select>
                <input className="input mono" type="number" min={1} max={50} style={{ width: 70 }} value={r.lots} onChange={(e) => setQuantRules((p) => p.map((x, i) => (i === idx ? { ...x, lots: Number(e.target.value) } : x)))} />
                <select className="input" style={{ width: 190 }} value={r.rule} onChange={(e) => setQuantRules((p) => p.map((x, i) => (i === idx ? { ...x, rule: e.target.value } : x)))}>
                  {QUANT_RULE_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                </select>
                <input className="input mono" type="number" step="0.05" style={{ width: 100 }} value={r.value} onChange={(e) => setQuantRules((p) => p.map((x, i) => (i === idx ? { ...x, value: Number(e.target.value) } : x)))} />
                <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={() => setQuantRules((p) => p.filter((_, i) => i !== idx))}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="preset-btn" onClick={() => setQuantRules((p) => [...p, { optionType: 'CE', side: 'BUY', lots: 1, rule: 'ATM_POINTS', value: 200 }])}>
              <Plus size={13} /> Add Leg Rule
            </button>
            <button className="btn-primary" onClick={handleRunQuant}>Build &amp; Resolve Strikes</button>
          </div>

          {quantResult && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Resolved {quantResult.legs.length} Legs (Spot {formatINR(quantResult.spotPrice)})</strong>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setLegs(quantResult.legs.map((l, i) => ({ ...l, id: `q-${i}-${Date.now()}` })));
                    setSubTab('chain');
                  }}
                >
                  Load into Payoff Builder →
                </button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Side</th><th>Contract</th><th>Strike</th><th>Qty</th><th>LTP</th><th>Delta</th></tr></thead>
                  <tbody>
                    {quantResult.legs.map((l, i) => (
                      <tr key={i}>
                        <td style={{ color: l.side === 'BUY' ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>{l.side}</td>
                        <td className="mono">{l.symbol}</td>
                        <td className="mono">{l.strike}</td>
                        <td className="mono">{l.quantity}</td>
                        <td className="mono">{formatINR(l.premium)}</td>
                        <td className="mono">{l.delta ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 3: Flash Trade (1-Click Directional Scalper Cards) */}
      {subTab === 'flash' && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}><Flame size={15} /> Flash Trade — Instant Scalper Selection ({selectedUnderlying})</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={`preset-btn ${flashView === 'BULLISH' ? 'active' : ''}`} style={{ color: 'var(--gain)' }} onClick={() => setFlashView('BULLISH')}>Bullish View (Calls)</button>
              <button className={`preset-btn ${flashView === 'BEARISH' ? 'active' : ''}`} style={{ color: 'var(--loss)' }} onClick={() => setFlashView('BEARISH')}>Bearish View (Puts)</button>
            </div>
          </div>
          {!flashData ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading curated Flash Trade contracts...</div>
          ) : (
            <div className="card-grid">
              {flashData.cards.map((c) => (
                <div key={c.tag} className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="badge badge-warn">{c.tag.replace('_', ' ')}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lot {c.lotSize}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>{c.strike} {c.optionType}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{c.badge}</div>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>{c.ltp ? formatINR(c.ltp) : '—'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
                    <span>OI: <strong>{c.oi.toLocaleString('en-IN')}</strong></span>
                    <span>Vol: <strong>{c.volume.toLocaleString('en-IN')}</strong></span>
                    <span>IV: <strong>{c.iv?.toFixed(1) ?? '—'}%</strong></span>
                    <span>Δ: <strong>{c.delta?.toFixed(2) ?? '—'}</strong></span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-primary" style={{ flex: 1, background: 'var(--gain)' }} onClick={() => onTradeClick(c.symbol, 'BUY', 'FNO', c.ltp)}>BUY</button>
                    <button className="btn-primary" style={{ flex: 1, background: 'var(--loss)', color: '#fff' }} onClick={() => onTradeClick(c.symbol, 'SELL', 'FNO', c.ltp)}>SELL</button>
                    <button className="preset-btn" onClick={() => onChartClick(c.symbol, 'FNO')}>Chart</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 4: OI Profile, Support/Resistance, ATM Straddle & IV Skew Analytics */}
      {subTab === 'analytics' && (
        <section className="card">
          <h3><Activity size={15} /> Derivatives OI Profile, Trending OI &amp; ATM Straddle Analytics ({selectedUnderlying})</h3>
          {!analytics ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading derivatives analytics...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card-grid">
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>Key Resistance (Max Call OI)</h3>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--loss)' }}>{analytics.resistanceStrike ?? '—'}</div>
                </div>
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>Key Support (Max Put OI)</h3>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--gain)' }}>{analytics.supportStrike ?? '—'}</div>
                </div>
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>Trending OI Diff (ΔPE − ΔCE)</h3>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: analytics.trendingOiDiff >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                    {analytics.trendingOiDiff >= 0 ? '+' : ''}{analytics.trendingOiDiff.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="card" style={{ background: 'var(--bg-elevated)' }}>
                  <h3>ATM Straddle Premium</h3>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--warn)' }}>
                    {analytics.atmStraddlePrice != null ? `${formatINR(analytics.atmStraddlePrice)} (${analytics.atmStraddlePct}%)` : '—'}
                  </div>
                </div>
              </div>

              {/* Strike-Wise Call vs Put OI Horizontal Profile */}
              <div className="table-wrap">
                <table className="data-table" style={{ fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      <th>Strike</th>
                      <th style={{ textAlign: 'right' }}>Call OI</th>
                      <th style={{ width: '25%' }}>Call Resistance</th>
                      <th style={{ width: '25%' }}>Put Support</th>
                      <th style={{ textAlign: 'right' }}>Put OI</th>
                      <th style={{ textAlign: 'right' }}>Straddle ₹</th>
                      <th style={{ textAlign: 'right' }}>CE / PE IV%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const peakOi = Math.max(1, ...analytics.oiProfile.map((p) => Math.max(p.ceOi, p.peOi)));
                      return analytics.oiProfile.map((p) => (
                        <tr key={p.strike} style={{ background: p.atm ? 'var(--active-mode-bg)' : undefined }}>
                          <td className="mono" style={{ fontWeight: 800 }}>{p.strike} {p.atm ? 'ATM' : ''}</td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--loss)' }}>{p.ceOi.toLocaleString('en-IN')}</td>
                          <td>
                            <div style={{ height: 10, borderRadius: 4, background: 'rgba(239,68,68,0.65)', width: `${Math.min(100, (p.ceOi / peakOi) * 100)}%`, marginLeft: 'auto' }} />
                          </td>
                          <td>
                            <div style={{ height: 10, borderRadius: 4, background: 'rgba(16,185,129,0.65)', width: `${Math.min(100, (p.peOi / peakOi) * 100)}%` }} />
                          </td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--gain)' }}>{p.peOi.toLocaleString('en-IN')}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatINR(p.straddlePrice)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{p.ceIv?.toFixed(1) ?? '—'}% / {p.peIv?.toFixed(1) ?? '—'}%</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
