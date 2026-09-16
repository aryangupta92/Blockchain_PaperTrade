import { useState } from 'react';
import api from '../../services/api';
import ReactMarkdown from 'react-markdown';
import { FlaskConical, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, RefreshCw, BarChart3, IndianRupee, Percent } from 'lucide-react';
import './BacktestPage.css';

// ── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); }

// ── Synthetic candle generator (fallback when real data is insufficient) ──────
function generateSyntheticCandles(basePrice = 19500, days = 365) {
  const candles = [];
  let price = basePrice;
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // skip weekends
    const change  = (Math.random() - 0.48) * price * 0.015;
    const open    = +price.toFixed(2);
    price        += change;
    const close   = +price.toFixed(2);
    const high    = +(Math.max(open, close) * (1 + Math.random() * 0.008)).toFixed(2);
    const low     = +(Math.min(open, close) * (1 - Math.random() * 0.008)).toFixed(2);
    candles.push({ date: date.toISOString().slice(0, 10), open, high, low, close, volume: Math.floor(Math.random() * 5000000 + 500000) });
  }
  return candles;
}

const INSTRUMENT_OPTIONS = [
  { value: 'EQUITY_DELIVERY', label: 'Equity (Delivery)',  hint: 'STT 0.1% both sides' },
  { value: 'EQUITY_INTRADAY', label: 'Equity (Intraday)',  hint: 'STT 0.025% sell side' },
  { value: 'FNO_FUTURES',     label: 'F&O — Futures',      hint: 'STT 0.01% sell side' },
  { value: 'FNO_OPTIONS',     label: 'F&O — Options',      hint: 'STT 0.05% sell side' },
];

const STRATEGY_PRESETS = [
  { name: 'Nifty SMA Crossover', entry: 'Buy when daily close crosses above 20-day SMA', exit: 'Sell when daily close crosses below 20-day SMA', stopLossPct: 3, targetPct: 9, instrument: 'EQUITY_DELIVERY' },
  { name: 'RSI Oversold Bounce', entry: 'Buy when RSI falls below 30 (oversold)', exit: 'Sell when RSI rises above 70 (overbought)', stopLossPct: 4, targetPct: 8, instrument: 'EQUITY_INTRADAY' },
  { name: 'Breakout Strategy',   entry: 'Buy when price breaks above 20-day high', exit: 'Sell when price falls below 10-day low', stopLossPct: 5, targetPct: 15, instrument: 'EQUITY_DELIVERY' },
];

const INITIAL_FORM = {
  strategyName:    '',
  entryCondition:  '',
  exitCondition:   '',
  stopLossPct:     5,
  targetPct:       10,
  capital:         100000,
  instrument:      'EQUITY_DELIVERY',
  positionSizePct: 20,
  slippagePct:     0.1,
  symbol:          'NIFTY 50',
  startDate:       daysAgo(365),
  endDate:         toDateStr(new Date()),
  useRealData:     true,
};

// ── Stat Card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="bt-stat-card">
      <div className="bt-stat-icon" style={{ background: color + '22', color }}>{Icon && <Icon size={16} />}</div>
      <div>
        <div className="bt-stat-value" style={{ color }}>{value}</div>
        <div className="bt-stat-label">{label}</div>
        {sub && <div className="bt-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ── Mini Equity Curve Chart ────────────────────────────────────────────────────
function EquityCurve({ data, capital }) {
  if (!data || data.length < 2) return null;
  const values = data.map(d => d.balance);
  const min    = Math.min(...values, capital);
  const max    = Math.max(...values, capital);
  const range  = max - min || 1;
  const W = 600, H = 120;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(' ');
  const baselineY = H - ((capital - min) / range) * H;
  const lastColor = values[values.length - 1] >= capital ? '#10b981' : '#ef4444';

  return (
    <div className="bt-equity-chart">
      <div className="bt-equity-label">Equity Curve</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="bt-equity-svg">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lastColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lastColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Baseline (starting capital) */}
        <line x1="0" y1={baselineY} x2={W} y2={baselineY} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4" />
        {/* Fill */}
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#eqGrad)" />
        {/* Line */}
        <polyline points={pts} fill="none" stroke={lastColor} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ── Trade Log Table ────────────────────────────────────────────────────────────
function TradeLog({ trades }) {
  const [open, setOpen] = useState(false);
  if (!trades || trades.length === 0) return null;

  return (
    <div className="bt-trade-log">
      <button className="bt-log-toggle" onClick={() => setOpen(p => !p)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Trade Log ({trades.length} trades shown)
      </button>
      {open && (
        <div className="bt-log-table-wrap">
          <table className="bt-log-table">
            <thead>
              <tr>
                <th>Entry</th><th>Exit</th><th>Symbol</th>
                <th>Entry ₹</th><th>Exit ₹</th><th>Qty</th>
                <th>Gross P&L</th><th>Costs</th><th>Net P&L</th><th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className={t.netPnl >= 0 ? 'bt-row-win' : 'bt-row-loss'}>
                  <td>{t.entryDate}</td>
                  <td>{t.exitDate}</td>
                  <td>{t.symbol}</td>
                  <td>₹{t.entryPrice.toLocaleString('en-IN')}</td>
                  <td>₹{t.exitPrice.toLocaleString('en-IN')}</td>
                  <td>{t.qty}</td>
                  <td className={t.grossPnl >= 0 ? 'gain' : 'loss'}>₹{t.grossPnl.toLocaleString('en-IN')}</td>
                  <td className="loss">₹{t.totalCosts.toLocaleString('en-IN')}</td>
                  <td className={t.netPnl >= 0 ? 'gain' : 'loss'} style={{ fontWeight: 700 }}>₹{t.netPnl.toLocaleString('en-IN')}</td>
                  <td><span className={`bt-exit-badge bt-exit-${t.exitReason?.toLowerCase()}`}>{t.exitReason}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function BacktestPage({ showToast }) {
  const [form, setForm]       = useState(INITIAL_FORM);
  const [result, setResult]   = useState(null);
  const [aiReport, setAiReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [step, setStep]       = useState(1); // 1=configure, 2=results

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const applyPreset = (preset) => {
    setForm(f => ({
      ...f,
      strategyName:   preset.name,
      entryCondition: preset.entry,
      exitCondition:  preset.exit,
      stopLossPct:    preset.stopLossPct,
      targetPct:      preset.targetPct,
      instrument:     preset.instrument,
    }));
  };

  const runBacktest = async () => {
    if (!form.strategyName || !form.entryCondition || !form.exitCondition) {
      showToast('Please fill Strategy Name, Entry, and Exit conditions.', 'error');
      return;
    }
    setLoading(true);
    setResult(null);
    setAiReport('');
    try {
      let candles = [];
      if (form.useRealData) {
        try {
          // getCandles format: (symbol, range, interval). '1y' covers enough for a date filter.
          const apiCandles = await api.getCandles(form.symbol, '1y', '1d');
          if (Array.isArray(apiCandles) && apiCandles.length > 0) {
            candles = apiCandles.filter(c => c.date >= form.startDate && c.date <= form.endDate);
          }
          if (candles.length < 10) throw new Error("Insufficient real data for selected dates");
        } catch (e) {
          console.warn('Real data fallback', e);
          showToast('Insufficient real data, falling back to synthetic history', 'error');
          candles = generateSyntheticCandles(19500, 365);
        }
      } else {
        candles = generateSyntheticCandles(19500, 365);
      }


      const data = await api.runBacktest({
        strategy: {
          entryCondition: form.entryCondition,
          exitCondition:  form.exitCondition,
          symbol:         form.symbol,
        },
        candles,
        capital:         Number(form.capital),
        instrument:      form.instrument,
        stopLossPct:     Number(form.stopLossPct),
        targetPct:       Number(form.targetPct),
        slippagePct:     Number(form.slippagePct),
        positionSizePct: Number(form.positionSizePct),
      });

      if (data.error) throw new Error(data.error);
      setResult(data.result);
      setStep(2);
      showToast('Backtest complete!', 'success');
    } catch (err) {
      showToast('Backtest failed: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const validateWithAI = async () => {
    setAiLoading(true);
    try {
      const data = await api.validateStrategy({
        strategyName:    form.strategyName,
        entryCondition:  form.entryCondition,
        exitCondition:   form.exitCondition,
        stopLoss:        `${form.stopLossPct}%`,
        target:          `${form.targetPct}%`,
        capital:         Number(form.capital),
        instrument:      form.instrument,
        timeframe:       'Daily',
        backtestResults: result?.summary || null,
      });
      setAiReport(data.validationReport || '');
      showToast('AI Validation Report ready!', 'success');
    } catch (err) {
      showToast('AI Validation failed: ' + err.message, 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const s = result?.summary;

  return (
    <div className="bt-page">
      {/* Header */}
      <div className="bt-header">
        <div className="bt-header-left">
          <h2><FlaskConical size={26} className="bt-header-icon" /> AI Strategy Backtester</h2>
          <p className="bt-header-sub">Stress-test strategies with Indian market costs: STT, brokerage, slippage &amp; stamp duty.</p>
        </div>
        {step === 2 && (
          <button className="bt-btn-outline" onClick={() => setStep(1)}>← Back to Config</button>
        )}
      </div>

      {step === 1 && (
        <div className="bt-config">
          {/* Presets */}
          <div className="bt-presets">
            <div className="bt-presets-label">Quick Presets</div>
            <div className="bt-presets-row">
              {STRATEGY_PRESETS.map(p => (
                <button key={p.name} className="bt-preset-btn" onClick={() => applyPreset(p)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Form Grid */}
          <div className="bt-form-grid">
            {/* Strategy Info */}
            <div className="bt-card bt-card-full">
              <div className="bt-card-title">Strategy Definition</div>
              <div className="bt-field-row">
                <div className="bt-field">
                  <label>Strategy Name</label>
                  <input className="bt-input" value={form.strategyName} onChange={e => set('strategyName', e.target.value)} placeholder="e.g., Nifty Momentum Play" />
                </div>
                <div className="bt-field">
                  <label>Symbol / Index</label>
                  <input className="bt-input" value={form.symbol} onChange={e => set('symbol', e.target.value)} placeholder="e.g., NIFTY 50, RELIANCE" />
                </div>
              </div>
              <div className="bt-field">
                <label>Entry Condition</label>
                <textarea className="bt-input bt-textarea" value={form.entryCondition} onChange={e => set('entryCondition', e.target.value)}
                  placeholder="e.g., Buy when daily close crosses above 20-day SMA and RSI > 50" />
              </div>
              <div className="bt-field">
                <label>Exit Condition</label>
                <textarea className="bt-input bt-textarea" value={form.exitCondition} onChange={e => set('exitCondition', e.target.value)}
                  placeholder="e.g., Sell when daily close crosses below 20-day SMA or stop-loss is hit" />
              </div>

              {/* Date Ranges & Real Data */}
              <div className="bt-field-row" style={{ marginTop: 12 }}>
                <div className="bt-field">
                  <label>Start Date</label>
                  <input type="date" className="bt-input" value={form.startDate} onChange={e => set('startDate', e.target.value)} disabled={!form.useRealData} />
                </div>
                <div className="bt-field">
                  <label>End Date</label>
                  <input type="date" className="bt-input" value={form.endDate} onChange={e => set('endDate', e.target.value)} disabled={!form.useRealData} />
                </div>
              </div>
              <div className="bt-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <input type="checkbox" id="realDataToggle" checked={form.useRealData} onChange={e => set('useRealData', e.target.checked)} />
                <label htmlFor="realDataToggle" style={{ textTransform: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Use real market data (if available)</label>
              </div>
            </div>

            {/* Parameters */}
            <div className="bt-card">
              <div className="bt-card-title">Risk Parameters</div>
              <div className="bt-param-grid">
                <div className="bt-field">
                  <label>Stop Loss (%)</label>
                  <input type="number" min="0.5" max="50" step="0.5" className="bt-input" value={form.stopLossPct} onChange={e => set('stopLossPct', e.target.value)} />
                </div>
                <div className="bt-field">
                  <label>Target (%)</label>
                  <input type="number" min="1" max="100" step="0.5" className="bt-input" value={form.targetPct} onChange={e => set('targetPct', e.target.value)} />
                </div>
                <div className="bt-field">
                  <label>Capital (₹)</label>
                  <input type="number" min="10000" step="10000" className="bt-input" value={form.capital} onChange={e => set('capital', e.target.value)} />
                </div>
                <div className="bt-field">
                  <label>Position Size (%)</label>
                  <input type="number" min="5" max="100" step="5" className="bt-input" value={form.positionSizePct} onChange={e => set('positionSizePct', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Indian Costs */}
            <div className="bt-card">
              <div className="bt-card-title">Indian Market Costs</div>
              <div className="bt-field">
                <label>Instrument Type</label>
                <select className="bt-input" value={form.instrument} onChange={e => set('instrument', e.target.value)}>
                  {INSTRUMENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label} — {opt.hint}</option>
                  ))}
                </select>
              </div>
              <div className="bt-field">
                <label>Slippage (%) per trade</label>
                <input type="number" min="0" max="2" step="0.05" className="bt-input" value={form.slippagePct} onChange={e => set('slippagePct', e.target.value)} />
              </div>
              <div className="bt-cost-note">
                ℹ️ STT, exchange charges, SEBI fees, GST &amp; stamp duty are applied automatically per the selected instrument.
              </div>
            </div>
          </div>

          <button className="bt-run-btn" onClick={runBacktest} disabled={loading}>
            {loading ? (
              <><RefreshCw size={16} className="spin" /> Running Backtest…</>
            ) : (
              <><FlaskConical size={16} /> Run Backtest</>
            )}
          </button>
        </div>
      )}

      {step === 2 && s && (
        <div className="bt-results">
          {/* KPI Strip */}
          <div className="bt-kpi-grid">
            <StatCard label="Total Return" value={`${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct}%`}
              color={s.totalReturnPct >= 0 ? '#10b981' : '#ef4444'} icon={Percent}
              sub={`₹${s.totalNetPnl.toLocaleString('en-IN')} net P&L`} />
            <StatCard label="Win Rate" value={`${s.winRate}%`}
              color={s.winRate >= 50 ? '#10b981' : '#f59e0b'} icon={TrendingUp}
              sub={`${s.totalTrades} total trades`} />
            <StatCard label="Profit Factor" value={s.profitFactor === 999 ? '∞' : s.profitFactor}
              color={s.profitFactor >= 1.5 ? '#10b981' : '#ef4444'} icon={BarChart3}
              sub="Avg Win / Avg Loss" />
            <StatCard label="Max Drawdown" value={`${s.maxDrawdownPct}%`}
              color={s.maxDrawdownPct < 10 ? '#10b981' : s.maxDrawdownPct < 20 ? '#f59e0b' : '#ef4444'} icon={TrendingDown}
              sub="Peak-to-trough loss" />
            <StatCard label="Costs Paid" value={`₹${s.totalCostsPaid.toLocaleString('en-IN')}`}
              color="#f59e0b" icon={IndianRupee}
              sub={`${s.costDragPct.toFixed(1)}% cost drag on gross P&L`} />
            <StatCard label="Final Balance" value={`₹${s.finalBalance.toLocaleString('en-IN')}`}
              color={s.finalBalance >= s.capital ? '#10b981' : '#ef4444'} icon={IndianRupee}
              sub={`Started with ₹${s.capital.toLocaleString('en-IN')}`} />
          </div>

          {/* Cost Breakdown Warning */}
          {s.costDragPct > 30 && (
            <div className="bt-cost-warning">
              <AlertTriangle size={16} />
              <strong>Cost Alert:</strong> Indian transaction costs are eating <strong>{s.costDragPct.toFixed(1)}%</strong> of your gross profit.
              High-frequency strategies are particularly vulnerable to STT and brokerage erosion.
            </div>
          )}

          {/* Equity Curve */}
          <div className="bt-card">
            <EquityCurve data={result.equityCurve} capital={s.capital} />
          </div>

          {/* Trade Log */}
          <div className="bt-card">
            <TradeLog trades={result.trades} />
          </div>

          {/* AI Validation */}
          <div className="bt-ai-section">
            <div className="bt-ai-header">
              <div>
                <div className="bt-ai-title">
                  <CheckCircle size={18} style={{ color: 'var(--accent-primary)' }} /> AI Strategy Validation Report
                </div>
                <div className="bt-ai-sub">Get a rigorous institutional-grade analysis of your strategy against Indian market realities.</div>
              </div>
              <button className="bt-btn-ai" onClick={validateWithAI} disabled={aiLoading}>
                {aiLoading ? <><RefreshCw size={14} className="spin" /> Validating…</> : '🤖 Validate with AI'}
              </button>
            </div>

            {aiReport && (
              <div className="bt-ai-report">
                <ReactMarkdown>{aiReport}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
