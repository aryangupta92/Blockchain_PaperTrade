import { useCallback, useEffect, useState } from 'react';
import { Building2, Filter, Flame, Grid, Layers, LineChart, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { api, formatINR } from '../apiClient';
import { InstrumentInspectorPanel } from './InstrumentInspectorPanel';

interface ScreenerPageProps {
  onTradeClick: (
    symbol: string,
    side: 'BUY' | 'SELL',
    segment: string,
    ltp: string | null,
    priceOverride?: string | null,
    initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF'
  ) => void;
  onChartClick: (symbol: string, segment: string) => void;
  onDepthClick: (symbol: string, segment: string) => void;
  onOptionChainClick?: (underlying: string) => void;
}

const FIELDS = [
  { id: 'changePercent', label: '% Change' },
  { id: 'ltp', label: 'LTP (₹)' },
  { id: 'volume', label: 'Volume' },
  { id: 'vwapDiffPct', label: 'vs VWAP (%)' },
  { id: 'dayRangePosPct', label: 'Day Range Pos (%)' },
  { id: 'openGapPct', label: 'Open Gap (%)' },
];
const OPS = ['GT', 'GTE', 'LT', 'LTE'] as const;

export function ScreenerPage({ onTradeClick, onChartClick, onDepthClick, onOptionChainClick }: ScreenerPageProps) {
  const [tab, setTab] = useState<'presets' | 'custom' | 'heatmap' | 'fundamentals'>('presets');
  const [presets, setPresets] = useState<Awaited<ReturnType<typeof api.screenerPresets>>['presets']>([]);
  const [activePreset, setActivePreset] = useState<string>('ALL_NIFTY_CORE');
  const [sector, setSector] = useState<string>('ALL');
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.runScreener>>['results']>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Custom AST Builder
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<Array<{ field: string; op: string; value: number }>>([
    { field: 'changePercent', op: 'GTE', value: 0.5 },
    { field: 'vwapDiffPct', op: 'GT', value: 0 },
  ]);
  const [tplName, setTplName] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<Awaited<ReturnType<typeof api.screenerTemplates>>['templates']>([]);

  // Treemap Heatmap
  const [heatmap, setHeatmap] = useState<Awaited<ReturnType<typeof api.screenerHeatmap>> | null>(null);

  // Stock Fundamentals
  const [fundSymbol, setFundSymbol] = useState('RELIANCE');
  const [fundData, setFundData] = useState<Awaited<ReturnType<typeof api.marketFundamentals>> | null>(null);
  const [fundErr, setFundErr] = useState<string | null>(null);

  useEffect(() => {
    api.screenerPresets().then((r) => setPresets(r.presets)).catch(() => {});
    api.screenerTemplates().then((r) => setSavedTemplates(r.templates)).catch(() => {});
  }, []);

  const runPresetScan = useCallback(async (presetId: string, sec: string) => {
    setBusy(true);
    try {
      const res = await api.runScreener({ presetId, sector: sec === 'ALL' ? undefined : sec });
      setResults(res.results);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'presets') runPresetScan(activePreset, sector);
    else if (tab === 'heatmap') api.screenerHeatmap().then(setHeatmap).catch(() => {});
  }, [tab, activePreset, sector, runPresetScan]);

  const runCustomAst = async () => {
    setBusy(true);
    try {
      const res = await api.runScreener({ logic, rules, sector: sector === 'ALL' ? undefined : sector });
      setResults(res.results);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTemplate = async () => {
    await api.saveScreenerTemplate({
      name: tplName.trim() || `Custom Scan ${savedTemplates.length + 1}`,
      category: 'TECHNICAL',
      ast: { logic, rules },
    });
    setTplName('');
    const r = await api.screenerTemplates();
    setSavedTemplates(r.templates);
  };

  const loadFundamentals = async (sym: string) => {
    setFundErr(null);
    setFundData(null);
    setBusy(true);
    try {
      const res = await api.marketFundamentals(sym.trim().toUpperCase());
      setFundData(res);
    } catch (e) {
      setFundErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`preset-btn ${tab === 'presets' ? 'active' : ''}`} onClick={() => setTab('presets')}>
            <Flame size={13} /> Pre-Built Scanners ({presets.length})
          </button>
          <button className={`preset-btn ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>
            <Filter size={13} /> Custom AST Builder
          </button>
          <button className={`preset-btn ${tab === 'heatmap' ? 'active' : ''}`} onClick={() => setTab('heatmap')}>
            <Grid size={13} /> Treemap Heatmap &amp; Breadth
          </button>
          <button className={`preset-btn ${tab === 'fundamentals' ? 'active' : ''}`} onClick={() => { setTab('fundamentals'); if (!fundData) loadFundamentals(fundSymbol); }}>
            <Building2 size={13} /> Stock Fundamentals
          </button>
        </div>

        {(tab === 'presets' || tab === 'custom') && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="input" style={{ width: 135, padding: '5px 8px', fontSize: 12 }} value={sector} onChange={(e) => setSector(e.target.value)}>
              {['ALL', 'Banking', 'IT', 'Energy', 'Finance', 'Auto', 'FMCG', 'Pharma', 'Metals', 'Infra', 'Telecom', 'Consumer'].map((s) => (
                <option key={s} value={s}>{s === 'ALL' ? 'All Sectors' : s}</option>
              ))}
            </select>
            <button className="theme-toggle" onClick={() => (tab === 'presets' ? runPresetScan(activePreset, sector) : runCustomAst())} disabled={busy}>
              <RefreshCw size={13} /> Scan
            </button>
          </div>
        )}
      </section>

      {/* Pre-Built Presets Grid */}
      {tab === 'presets' && (
        <section className="card">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button
                key={p.id}
                className={`preset-btn ${activePreset === p.id ? 'active' : ''}`}
                title={p.description}
                onClick={() => setActivePreset(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Custom AST Builder */}
      {tab === 'custom' && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Custom Multi-Factor Screener Rules</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12 }}>Match:</span>
              <button className={`preset-btn ${logic === 'AND' ? 'active' : ''}`} onClick={() => setLogic('AND')}>ALL (AND)</button>
              <button className={`preset-btn ${logic === 'OR' ? 'active' : ''}`} onClick={() => setLogic('OR')}>ANY (OR)</button>
            </div>
          </div>

          {rules.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 8, background: 'var(--bg-elevated)', borderRadius: 8 }}>
              <select className="input" style={{ width: 170 }} value={r.field} onChange={(e) => setRules((p) => p.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))}>
                {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <select className="input" style={{ width: 90 }} value={r.op} onChange={(e) => setRules((p) => p.map((x, idx) => (idx === i ? { ...x, op: e.target.value } : x)))}>
                {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
              <input className="input mono" type="number" step="0.1" style={{ width: 110 }} value={r.value} onChange={(e) => setRules((p) => p.map((x, idx) => (idx === i ? { ...x, value: Number(e.target.value) } : x)))} />
              <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={() => setRules((p) => p.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="preset-btn" onClick={() => setRules((p) => [...p, { field: 'volume', op: 'GTE', value: 500000 }])}>
              <Plus size={13} /> Add Condition
            </button>
            <button className="btn-primary" onClick={runCustomAst} disabled={busy}>Run Custom Scan</button>
            <input className="input" style={{ width: 180 }} placeholder="Template name..." value={tplName} onChange={(e) => setTplName(e.target.value)} />
            <button className="preset-btn" onClick={handleSaveTemplate}><Save size={12} /> Save Template</button>
          </div>

          {savedTemplates.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              {savedTemplates.map((t) => (
                <div key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className="preset-btn"
                    onClick={() => {
                      const ast = t.ast as { logic?: 'AND' | 'OR'; rules?: typeof rules };
                      if (ast.logic) setLogic(ast.logic);
                      if (Array.isArray(ast.rules)) setRules(ast.rules);
                    }}
                  >
                    {t.name}
                  </button>
                  <button className="preset-btn" style={{ color: 'var(--loss)', padding: '3px 5px' }} onClick={async () => { await api.deleteScreenerTemplate(t.id); setSavedTemplates((p) => p.filter((x) => x.id !== t.id)); }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Results Table (shared for presets & custom) */}
      {(tab === 'presets' || tab === 'custom') && (
        <section className="card">
          <h3>Matched Stocks ({results.length})</h3>
          {results.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No stocks matched the current filter criteria.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Sector</th>
                    <th style={{ textAlign: 'right' }}>LTP</th>
                    <th style={{ textAlign: 'right' }}>Change %</th>
                    <th style={{ textAlign: 'right' }}>vs VWAP</th>
                    <th style={{ textAlign: 'right' }}>Day Range Pos</th>
                    <th style={{ textAlign: 'right' }}>Volume</th>
                    <th>Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const selected = (selectedSymbol || results[0]?.symbol) === r.symbol;
                    return (
                      <tr
                        key={r.symbol}
                        onClick={() => setSelectedSymbol(r.symbol)}
                        style={{
                          cursor: 'pointer',
                          background: selected ? 'var(--bg-elevated)' : 'transparent',
                        }}
                      >
                        <td><strong>{r.symbol}</strong></td>
                        <td><span className="badge">{r.sector}</span></td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{r.ltp != null ? formatINR(r.ltp) : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: r.changePercent >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                          {r.changePercent >= 0 ? '+' : ''}{r.changePercent.toFixed(2)}%
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: r.vwapDiffPct >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                          {r.vwapDiffPct >= 0 ? '+' : ''}{r.vwapDiffPct}%
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{r.dayRangePosPct}%</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{r.volume.toLocaleString('en-IN')}</td>
                        <td onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                          <button className="preset-btn" style={{ padding: '2px 6px', color: 'var(--gain)', borderColor: 'var(--gain)' }} onClick={() => onTradeClick(r.symbol, 'BUY', r.segment, r.ltp ? String(r.ltp) : null)}>B</button>
                          <button className="preset-btn" style={{ padding: '2px 6px', color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={() => onTradeClick(r.symbol, 'SELL', r.segment, r.ltp ? String(r.ltp) : null)}>S</button>
                          <button className="preset-btn" style={{ padding: '2px 6px' }} onClick={() => onChartClick(r.symbol, r.segment)}><LineChart size={11} /></button>
                          <button className="preset-btn" style={{ padding: '2px 6px' }} onClick={() => onDepthClick(r.symbol, r.segment)}><Layers size={11} /></button>
                          <button className="preset-btn" style={{ padding: '2px 6px' }} onClick={() => { setFundSymbol(r.symbol); setTab('fundamentals'); loadFundamentals(r.symbol); }}>Info</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {results.length > 0 && (() => {
            const sel = results.find((r) => r.symbol === selectedSymbol) || results[0];
            return (
              <div style={{ marginTop: 14 }}>
                <InstrumentInspectorPanel
                  symbol={sel.symbol}
                  segment={sel.segment}
                  initialQuote={{
                    symbol: sel.symbol,
                    segment: sel.segment,
                    ltp: sel.ltp != null ? String(sel.ltp) : null,
                    changePercent: String(sel.changePercent),
                    volume: sel.volume,
                  }}
                  onTradeClick={onTradeClick}
                  onChartClick={onChartClick}
                  onOptionChainClick={onOptionChainClick}
                  title="Selected Scan Instrument Details"
                />
              </div>
            );
          })()}
        </section>
      )}

      {/* Treemap Market Heatmap & Advance/Decline Breadth */}
      {tab === 'heatmap' && heatmap && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Market Breadth (Advance / Decline Ratio: {heatmap.breadth.adRatio})</h3>
              <div className="mono" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--gain)' }}>{heatmap.breadth.advancers} Adv</span> ·{' '}
                <span style={{ color: 'var(--loss)' }}>{heatmap.breadth.decliners} Dec</span> ·{' '}
                <span style={{ color: 'var(--text-muted)' }}>{heatmap.breadth.unchanged} Unch</span>
              </div>
            </div>
            <div style={{ height: 10, borderRadius: 99, background: 'var(--loss)', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--gain)', width: `${Math.round((heatmap.breadth.advancers / Math.max(1, heatmap.breadth.advancers + heatmap.breadth.decliners)) * 100)}%` }} />
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            {heatmap.sectors.map((sec) => (
              <section key={sec.sector} className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                  <strong>{sec.sector}</strong>
                  <span className="mono" style={{ fontWeight: 700, color: sec.avgChangePercent >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                    {sec.avgChangePercent >= 0 ? '+' : ''}{sec.avgChangePercent}%
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {sec.stocks.map((st) => {
                    const intensity = Math.min(0.65, 0.14 + Math.abs(st.changePercent) * 0.14);
                    const bg = st.changePercent >= 0 ? `rgba(16,185,129,${intensity})` : `rgba(239,68,68,${intensity})`;
                    return (
                      <button
                        key={st.symbol}
                        onClick={() => onChartClick(st.symbol, 'EQ')}
                        style={{
                          flex: `${Math.max(1, Math.round(st.mcapWeight))} 1 80px`,
                          background: bg,
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 7,
                          padding: '8px 6px',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 11.5 }}>{st.symbol}</div>
                        <div className="mono" style={{ fontSize: 11 }}>{st.changePercent >= 0 ? '+' : ''}{st.changePercent.toFixed(2)}%</div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {/* Company Fundamentals & Financials */}
      {tab === 'fundamentals' && (
        <section className="card">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}><Building2 size={15} /> Stock Fundamentals &amp; Ratios</h3>
            <input className="input" style={{ width: 160 }} value={fundSymbol} onChange={(e) => setFundSymbol(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE" />
            <button className="btn-primary" onClick={() => loadFundamentals(fundSymbol)} disabled={busy}>Fetch Fundamentals</button>
          </div>
          {fundErr && <div className="alert-error">{fundErr}</div>}
          {fundData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 10, borderRadius: 8, background: 'var(--bg-elevated)' }}>
                <div>
                  <strong style={{ fontSize: 15 }}>{fundData.tradingSymbol}</strong>{' '}
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{fundData.displayName}</span>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {fundData.exchange} · {fundData.segment} · ISIN {fundData.isin || '—'} · Lot {fundData.lotSize} · MTF {fundData.mtfLeverage}x
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>
                  {fundData.quote?.ltp ? formatINR(fundData.quote.ltp) : '—'}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                {[
                  ['Open / Close', `${fundData.quote?.open || '—'} / ${fundData.quote?.prevClose || '—'}`],
                  ['Day High / Low', `${fundData.quote?.high || '—'} / ${fundData.quote?.low || '—'}`],
                  ['52W High / Low', `${fundData.week52High || '—'} / ${fundData.week52Low || '—'}`],
                  ['Circuits (UC/LC)', `${fundData.upperCircuit || '—'} / ${fundData.lowerCircuit || '—'}`],
                  ['VWAP / Volume', `${fundData.quote?.vwap || '—'} / ${fundData.quote?.volume?.toLocaleString('en-IN') || '—'}`],
                  ['Surveillance', fundData.asmGsmFlag || 'None'],
                  ...Object.entries(fundData.companyInfo || {}).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 220) : String(v ?? '—')]),
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{k}</div>
                    <div className="mono" style={{ fontSize: 12, wordBreak: 'break-word' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
