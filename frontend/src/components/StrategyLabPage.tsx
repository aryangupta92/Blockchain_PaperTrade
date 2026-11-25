import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Play, Plus, Radar, Save, Trash2 } from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface Operand {
  type: string;
  period?: number;
  value?: number;
  multiplier?: number;
  stdMult?: number;
}

interface RuleCond {
  left: Operand;
  operator: string;
  right: Operand;
}

interface StrategyDef {
  name: string;
  description?: string;
  exchange: 'NSE' | 'BSE' | 'MCX';
  segment: 'EQ' | 'FNO' | 'ETF' | 'COMM';
  instrumentKind: 'EQUITY' | 'ETF' | 'FUTURES' | 'OPTIONS';
  product: 'CNC' | 'MIS' | 'NRML';
  direction: 'LONG' | 'SHORT' | 'BOTH';
  entryCombinator: 'AND' | 'OR';
  entryConditions: RuleCond[];
  exitCombinator: 'AND' | 'OR';
  exitConditions: RuleCond[];
  risk: {
    stopLossPct: number | null;
    targetPct: number | null;
    trailingStopPct: number | null;
    maxHoldingBars: number | null;
    sizingMode: 'FIXED_QTY' | 'FIXED_CAPITAL' | 'RISK_PER_TRADE_PCT';
    fixedQty: number;
    fixedCapital: number;
    riskPerTradePct: number;
    slippageBps: number;
    maxTradesPerDay: number | null;
    misSquareOffIST: string;
  };
}

interface StrategyLabPageProps {
  mode: AccountMode;
  onTradeClick: (symbol: string, side: 'BUY' | 'SELL', segment: string, ltp: string | null) => void;
}

const OPERAND_TYPES = [
  'PRICE_CLOSE', 'PRICE_OPEN', 'PRICE_HIGH', 'PRICE_LOW', 'VOLUME',
  'SMA', 'EMA', 'VWAP', 'RSI', 'MACD_LINE', 'MACD_SIGNAL', 'MACD_HIST',
  'BB_UPPER', 'BB_MIDDLE', 'BB_LOWER', 'SUPERTREND', 'CONSTANT',
];
const OPERATORS = ['CROSSES_ABOVE', 'CROSSES_BELOW', '>', '<', '>=', '<='];

const DEFAULT_STRATEGY: StrategyDef = {
  name: 'EMA 9/21 Trend Crossover',
  description: 'Enters when EMA(9) crosses above EMA(21) with RSI > 48.',
  exchange: 'NSE',
  segment: 'EQ',
  instrumentKind: 'EQUITY',
  product: 'CNC',
  direction: 'LONG',
  entryCombinator: 'AND',
  entryConditions: [
    { left: { type: 'EMA', period: 9 }, operator: 'CROSSES_ABOVE', right: { type: 'EMA', period: 21 } },
    { left: { type: 'RSI', period: 14 }, operator: '>', right: { type: 'CONSTANT', value: 48 } },
  ],
  exitCombinator: 'OR',
  exitConditions: [
    { left: { type: 'EMA', period: 9 }, operator: 'CROSSES_BELOW', right: { type: 'EMA', period: 21 } },
  ],
  risk: {
    stopLossPct: 3,
    targetPct: 7,
    trailingStopPct: 2.5,
    maxHoldingBars: null,
    sizingMode: 'FIXED_CAPITAL',
    fixedQty: 10,
    fixedCapital: 100000,
    riskPerTradePct: 1,
    slippageBps: 5,
    maxTradesPerDay: 2,
    misSquareOffIST: '15:15',
  },
};

function EquityCurveSvg({
  curve,
}: {
  curve: Array<{ date: string; equity: number; buyAndHoldEquity: number; drawdownPct: number }>;
}) {
  if (curve.length < 2) return null;
  const W = 740;
  const H = 200;
  const pad = 26;
  const vals = curve.flatMap((p) => [p.equity, p.buyAndHoldEquity]);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const spanV = Math.max(1, maxV - minV);

  const sx = (i: number) => pad + (i / (curve.length - 1)) * (W - pad * 2);
  const sy = (v: number) => H - pad - ((v - minV) / spanV) * (H - pad * 2);

  const stratPath = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.equity).toFixed(1)}`).join(' ');
  const bhPath = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.buyAndHoldEquity).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 220, background: 'var(--bg-elevated)', borderRadius: 8 }}>
      <path d={bhPath} fill="none" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 4" />
      <path d={stratPath} fill="none" stroke="#10b981" strokeWidth={2.4} />
      <text x={pad} y={16} fill="#10b981" fontSize={11} fontWeight={700}>— Strategy Net Equity (After Charges &amp; Slippage)</text>
      <text x={pad + 310} y={16} fill="#94a3b8" fontSize={11}>--- Buy &amp; Hold Benchmark</text>
      <text x={pad} y={H - 6} fill="#94a3b8" fontSize={10}>{curve[0].date}</text>
      <text x={W - pad - 65} y={H - 6} fill="#94a3b8" fontSize={10}>{curve[curve.length - 1].date}</text>
    </svg>
  );
}

function OperandEditor({ op, onChange }: { op: Operand; onChange: (next: Operand) => void }) {
  const needsPeriod = ['SMA', 'EMA', 'RSI', 'BB_UPPER', 'BB_MIDDLE', 'BB_LOWER', 'SUPERTREND'].includes(op.type);
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select
        className="input"
        style={{ padding: '5px 7px', fontSize: 12, minWidth: 125 }}
        value={op.type}
        onChange={(e) => {
          const t = e.target.value;
          onChange({
            type: t,
            ...(t === 'CONSTANT' ? { value: 50 } : {}),
            ...(['SMA', 'EMA'].includes(t) ? { period: 20 } : {}),
            ...(t === 'RSI' ? { period: 14 } : {}),
            ...(t.startsWith('BB_') ? { period: 20, stdMult: 2 } : {}),
            ...(t === 'SUPERTREND' ? { period: 10, multiplier: 3 } : {}),
          });
        }}
      >
        {OPERAND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {needsPeriod && (
        <input
          className="input mono"
          style={{ width: 64, padding: '5px 6px', fontSize: 12 }}
          type="number"
          min={2}
          max={400}
          value={op.period ?? 14}
          onChange={(e) => onChange({ ...op, period: Number(e.target.value) })}
          title="Period"
        />
      )}
      {op.type === 'CONSTANT' && (
        <input
          className="input mono"
          style={{ width: 76, padding: '5px 6px', fontSize: 12 }}
          type="number"
          step="0.5"
          value={op.value ?? 0}
          onChange={(e) => onChange({ ...op, value: Number(e.target.value) })}
          title="Constant Value"
        />
      )}
    </div>
  );
}

export function StrategyLabPage({ mode, onTradeClick }: StrategyLabPageProps) {
  const [presets, setPresets] = useState<Array<StrategyDef & { id: string; difficulty: string }>>([]);
  const [savedStrategies, setSavedStrategies] = useState<Awaited<ReturnType<typeof api.strategies>>['strategies']>([]);
  const [savedRuns, setSavedRuns] = useState<Awaited<ReturnType<typeof api.backtestRuns>>['runs']>([]);

  const [strategy, setStrategy] = useState<StrategyDef>(DEFAULT_STRATEGY);
  const [symbol, setSymbol] = useState('RELIANCE');
  const [interval, setInterval] = useState('1D');
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = useState('200000');

  const [result, setResult] = useState<Awaited<ReturnType<typeof api.runBacktest>> | null>(null);
  const [liveSignal, setLiveSignal] = useState<Awaited<ReturnType<typeof api.scanStrategySignal>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    api.strategyPresets().then((r) => setPresets(r.presets as unknown as Array<StrategyDef & { id: string; difficulty: string }>)).catch(() => {});
    api.strategies().then((r) => setSavedStrategies(r.strategies)).catch(() => {});
    api.backtestRuns().then((r) => setSavedRuns(r.runs)).catch(() => {});
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const handleSave = async () => {
    setErr(null);
    setMsg(null);
    try {
      const saved = await api.saveStrategy({ definition: strategy as unknown as Record<string, unknown> });
      setMsg(`Saved strategy "${saved.name}" cleanly.`);
      loadMeta();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleRunBacktest = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.runBacktest({
        strategy: strategy as unknown as Record<string, unknown>,
        symbol: symbol.trim().toUpperCase(),
        interval,
        fromDate,
        toDate,
        initialCapital: Number(initialCapital) || 200000,
        saveRun: true,
      });
      setResult(res);
      loadMeta();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleScanSignal = async () => {
    setErr(null);
    try {
      const res = await api.scanStrategySignal({
        strategy: strategy as unknown as Record<string, unknown>,
        symbol: symbol.trim().toUpperCase(),
        interval: ['5m', '15m', '30m', '1h', '1D'].includes(interval) ? interval : '1D',
      });
      setLiveSignal(res);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const updateCond = (listKey: 'entryConditions' | 'exitConditions', idx: number, next: RuleCond) => {
    setStrategy((prev) => ({
      ...prev,
      [listKey]: prev[listKey].map((c, i) => (i === idx ? next : c)),
    }));
  };

  const removeCond = (listKey: 'entryConditions' | 'exitConditions', idx: number) => {
    setStrategy((prev) => ({
      ...prev,
      [listKey]: prev[listKey].filter((_, i) => i !== idx),
    }));
  };

  const addCond = (listKey: 'entryConditions' | 'exitConditions') => {
    setStrategy((prev) => ({
      ...prev,
      [listKey]: [
        ...prev[listKey],
        { left: { type: 'RSI', period: 14 }, operator: '>', right: { type: 'CONSTANT', value: 50 } },
      ],
    }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header & Starter Templates */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}><FlaskConical size={16} /> Visual Strategy Builder &amp; Zero-Bias Indian Backtester</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {savedStrategies.length > 0 && (
              <select
                className="input"
                style={{ width: 200, padding: '5px 8px', fontSize: 12 }}
                defaultValue=""
                onChange={(e) => {
                  const found = savedStrategies.find((s) => s.id === e.target.value);
                  if (found) setStrategy(found.definition as unknown as StrategyDef);
                }}
              >
                <option value="" disabled>Load saved strategy ({savedStrategies.length})...</option>
                {savedStrategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button className="preset-btn" onClick={handleSave}><Save size={12} /> Save Strategy</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>TEMPLATES:</span>
          {presets.map((p) => (
            <button
              key={p.id}
              className={`preset-btn ${strategy.name === p.name ? 'active' : ''}`}
              onClick={() => setStrategy(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {msg && <div className="alert-success">{msg}</div>}
      {err && <div className="alert-error">{err}</div>}

      {/* Visual Strategy Rule Editor + Backtest Run Config */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label className="field">
            <span>Strategy Name</span>
            <input className="input" value={strategy.name} onChange={(e) => setStrategy({ ...strategy, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Symbol (NSE/BSE/MCX)</span>
            <input className="input mono" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </label>
          <label className="field">
            <span>Product</span>
            <select className="input" value={strategy.product} onChange={(e) => setStrategy({ ...strategy, product: e.target.value as StrategyDef['product'] })}>
              <option value="CNC">CNC (Delivery — Long only)</option>
              <option value="MIS">MIS (Intraday — 15:15 Sq-Off)</option>
              <option value="NRML">NRML (F&amp;O / MCX)</option>
            </select>
          </label>
          <label className="field">
            <span>Interval</span>
            <select className="input" value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="5m">5 min</option>
              <option value="15m">15 min</option>
              <option value="1h">1 hour</option>
              <option value="1D">1 Day</option>
              <option value="1W">1 Week</option>
            </select>
          </label>
          <label className="field">
            <span>From Date</span>
            <input className="input mono" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="field">
            <span>To Date</span>
            <input className="input mono" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Initial Capital (₹)</span>
            <input className="input mono" type="number" min={1000} value={initialCapital} onChange={(e) => setInitialCapital(e.target.value)} />
          </label>
        </div>

        {/* Entry Conditions Builder */}
        <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, fontWeight: 700, color: 'var(--gain)' }}>
              ENTRY CONDITIONS
              <select
                className="input"
                style={{ width: 80, padding: '3px 6px', fontSize: 11 }}
                value={strategy.entryCombinator}
                onChange={(e) => setStrategy({ ...strategy, entryCombinator: e.target.value as 'AND' | 'OR' })}
              >
                <option value="AND">ALL (AND)</option>
                <option value="OR">ANY (OR)</option>
              </select>
            </div>
            <button className="preset-btn" onClick={() => addCond('entryConditions')}><Plus size={12} /> Add Rule</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {strategy.entryConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <OperandEditor op={c.left} onChange={(left) => updateCond('entryConditions', i, { ...c, left })} />
                <select className="input" style={{ width: 'auto', padding: '5px 7px', fontSize: 12 }} value={c.operator} onChange={(e) => updateCond('entryConditions', i, { ...c, operator: e.target.value })}>
                  {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <OperandEditor op={c.right} onChange={(right) => updateCond('entryConditions', i, { ...c, right })} />
                {strategy.entryConditions.length > 1 && (
                  <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={() => removeCond('entryConditions', i)}><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Exit Conditions Builder */}
        <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, fontWeight: 700, color: 'var(--loss)' }}>
              EXIT CONDITIONS (Optional Indicator Exit)
            </div>
            <button className="preset-btn" onClick={() => addCond('exitConditions')}><Plus size={12} /> Add Exit Rule</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {strategy.exitConditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <OperandEditor op={c.left} onChange={(left) => updateCond('exitConditions', i, { ...c, left })} />
                <select className="input" style={{ width: 'auto', padding: '5px 7px', fontSize: 12 }} value={c.operator} onChange={(e) => updateCond('exitConditions', i, { ...c, operator: e.target.value })}>
                  {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <OperandEditor op={c.right} onChange={(right) => updateCond('exitConditions', i, { ...c, right })} />
                <button className="preset-btn" style={{ color: 'var(--loss)' }} onClick={() => removeCond('exitConditions', i)}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Risk, Sizing & Execution Realism Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10 }}>
          <label className="field">
            <span>Stop Loss (%)</span>
            <input className="input mono" type="number" step="0.1" value={strategy.risk.stopLossPct ?? ''} onChange={(e) => setStrategy({ ...strategy, risk: { ...strategy.risk, stopLossPct: e.target.value ? Number(e.target.value) : null } })} />
          </label>
          <label className="field">
            <span>Target (%)</span>
            <input className="input mono" type="number" step="0.1" value={strategy.risk.targetPct ?? ''} onChange={(e) => setStrategy({ ...strategy, risk: { ...strategy.risk, targetPct: e.target.value ? Number(e.target.value) : null } })} />
          </label>
          <label className="field">
            <span>Trailing SL (%)</span>
            <input className="input mono" type="number" step="0.1" value={strategy.risk.trailingStopPct ?? ''} onChange={(e) => setStrategy({ ...strategy, risk: { ...strategy.risk, trailingStopPct: e.target.value ? Number(e.target.value) : null } })} />
          </label>
          <label className="field">
            <span>Position Sizing</span>
            <select className="input" value={strategy.risk.sizingMode} onChange={(e) => setStrategy({ ...strategy, risk: { ...strategy.risk, sizingMode: e.target.value as StrategyDef['risk']['sizingMode'] } })}>
              <option value="FIXED_CAPITAL">Fixed Capital (₹)</option>
              <option value="RISK_PER_TRADE_PCT">% Risk / Trade</option>
              <option value="FIXED_QTY">Fixed Qty</option>
            </select>
          </label>
          <label className="field">
            <span>{strategy.risk.sizingMode === 'FIXED_CAPITAL' ? 'Capital / Trade (₹)' : strategy.risk.sizingMode === 'RISK_PER_TRADE_PCT' ? 'Risk % / Trade' : 'Fixed Qty'}</span>
            <input
              className="input mono"
              type="number"
              value={strategy.risk.sizingMode === 'FIXED_CAPITAL' ? strategy.risk.fixedCapital : strategy.risk.sizingMode === 'RISK_PER_TRADE_PCT' ? strategy.risk.riskPerTradePct : strategy.risk.fixedQty}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (strategy.risk.sizingMode === 'FIXED_CAPITAL') setStrategy({ ...strategy, risk: { ...strategy.risk, fixedCapital: v } });
                else if (strategy.risk.sizingMode === 'RISK_PER_TRADE_PCT') setStrategy({ ...strategy, risk: { ...strategy.risk, riskPerTradePct: v } });
                else setStrategy({ ...strategy, risk: { ...strategy.risk, fixedQty: v } });
              }}
            />
          </label>
          <label className="field">
            <span>Slippage (bps)</span>
            <input className="input mono" type="number" min={0} max={100} value={strategy.risk.slippageBps} onChange={(e) => setStrategy({ ...strategy, risk: { ...strategy.risk, slippageBps: Number(e.target.value) } })} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" onClick={handleRunBacktest} disabled={busy}>
            <Play size={14} /> {busy ? 'Running Zero-Bias Backtest...' : `Run Historical Backtest on ${symbol}`}
          </button>
          <button className="preset-btn" onClick={handleScanSignal}>
            <Radar size={13} /> Check Live Signal Now
          </button>
          {liveSignal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span className={`badge ${liveSignal.signal.startsWith('ENTER') ? 'badge-gain' : 'badge-warn'}`}>
                LIVE SIGNAL: {liveSignal.signal}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{liveSignal.details[0]}</span>
              {(liveSignal.signal === 'ENTER_LONG' || liveSignal.signal === 'ENTER_SHORT') && (
                <button
                  className="preset-btn"
                  style={{ borderColor: 'var(--gain)', color: 'var(--gain)' }}
                  onClick={() =>
                    onTradeClick(
                      symbol,
                      liveSignal.signal === 'ENTER_LONG' ? 'BUY' : 'SELL',
                      strategy.segment,
                      liveSignal.evaluatedBarClose ? liveSignal.evaluatedBarClose.toFixed(2) : null
                    )
                  }
                >
                  Practice in {mode}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Backtest Results Dashboard */}
      {result && (
        <>
          {result.warnings.length > 0 && (
            <div className="sebi-banner">
              {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div className="card-grid">
            <div className="card">
              <h3>Net Profit &amp; Return (After Charges)</h3>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: result.metrics.netReturnPct >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                {formatINR(result.metrics.netProfit)} ({result.metrics.netReturnPct >= 0 ? '+' : ''}{result.metrics.netReturnPct}%)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Buy &amp; Hold: {result.metrics.buyAndHoldReturnPct}% · CAGR: {result.metrics.cagrPct}%
              </div>
            </div>
            <div className="card">
              <h3>Statutory Charges &amp; Slippage Drag</h3>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--warn)' }}>
                {formatINR(result.metrics.totalChargesPaid)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                Gross P&amp;L: {formatINR(result.metrics.grossProfitTotal)} · Slippage: {formatINR(result.metrics.totalSlippageCost)}
              </div>
            </div>
            <div className="card">
              <h3>Risk-Adjusted Ratios</h3>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.7 }}>
                Sharpe: {result.metrics.sharpeRatio} · Sortino: {result.metrics.sortinoRatio}
                <div>Max DD: <span style={{ color: 'var(--loss)' }}>-{result.metrics.maxDrawdownPct}%</span> ({formatINR(result.metrics.maxDrawdownINR)})</div>
              </div>
            </div>
            <div className="card">
              <h3>Trade Statistics ({result.metrics.totalTrades} Trades)</h3>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.7 }}>
                Win Rate: {result.metrics.winRatePct}% · PF: {result.metrics.profitFactor}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Expectancy: {formatINR(result.metrics.expectancyINR)} / trade</div>
              </div>
            </div>
          </div>

          <section className="card">
            <h3>Equity Curve — {result.symbol} ({result.interval} · {result.fromDate} → {result.toDate} · {result.barsAnalyzed} bars)</h3>
            <EquityCurveSvg curve={result.equityCurve} />
          </section>

          <section className="card">
            <h3>Backtest Trade-by-Trade Log ({result.trades.length})</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Side</th>
                    <th>Entry Date &amp; Px</th>
                    <th>Exit Date &amp; Px</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th>Exit Reason</th>
                    <th style={{ textAlign: 'right' }}>Gross P&amp;L</th>
                    <th style={{ textAlign: 'right' }}>Indian Charges</th>
                    <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t) => (
                    <tr key={t.tradeNo}>
                      <td className="mono">{t.tradeNo}</td>
                      <td style={{ color: t.direction === 'LONG' ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>{t.direction}</td>
                      <td className="mono">{t.entryDate} @ {formatINR(t.entryPrice)}</td>
                      <td className="mono">{t.exitDate} @ {formatINR(t.exitPrice)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{t.quantity}</td>
                      <td><span className="badge">{t.exitReason}</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatINR(t.grossPnl)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--warn)' }}>{formatINR(t.totalCharges)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: Number(t.netPnl) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                        {formatINR(t.netPnl)} ({t.returnPct}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Saved Backtest History Comparison */}
      {savedRuns.length > 0 && (
        <section className="card">
          <h3>Saved Backtest Runs ({savedRuns.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Symbol / TF</th>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Net Return</th>
                  <th style={{ textAlign: 'right' }}>Max DD</th>
                  <th style={{ textAlign: 'right' }}>Sharpe</th>
                  <th style={{ textAlign: 'right' }}>Trades</th>
                  <th style={{ textAlign: 'right' }}>Charges Paid</th>
                </tr>
              </thead>
              <tbody>
                {savedRuns.slice(0, 12).map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.strategyName}</strong></td>
                    <td className="mono">{r.symbol} · {r.interval}</td>
                    <td className="mono">{r.fromDate} → {r.toDate}</td>
                    <td className="mono" style={{ textAlign: 'right', color: Number(r.netReturnPct) >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
                      {r.netReturnPct}%
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--loss)' }}>-{r.maxDrawdownPct}%</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.sharpeRatio}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.totalTrades}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--warn)' }}>{formatINR(r.totalCharges)}</td>
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
