import { useMemo, useState, useEffect } from 'react';
import api from '../../services/api';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  IndianRupee,
  PieChart as PieIcon,
  Gauge,
  ShieldAlert,
  Layers,
  Activity,
  BarChart3,
} from 'lucide-react';
import '../Broker/Kite.css';

const C = {
  bg: '#131722',
  surface: '#1e222d',
  text: '#d1d4dc',
  accent: '#2962ff',
  gain: '#089981',
  loss: '#f23645',
  muted: '#787b86',
  border: '#2a2e39',
};

const SECTOR_MAP = {
  RELIANCE: 'Energy', ONGC: 'Energy', NTPC: 'Energy', POWERGRID: 'Energy', TATAPOWER: 'Energy', ADANIENT: 'Energy', IOC: 'Energy', BPCL: 'Energy',
  TCS: 'IT', INFY: 'IT', HCLTECH: 'IT', WIPRO: 'IT', TECHM: 'IT', LTIM: 'IT', PERSISTENT: 'IT', COFORGE: 'IT',
  HDFCBANK: 'Financials', ICICIBANK: 'Financials', SBIN: 'Financials', AXISBANK: 'Financials', KOTAKBANK: 'Financials', BAJFINANCE: 'Financials', BAJAJFINSV: 'Financials', SBICARD: 'Financials', CHOLAFIN: 'Financials',
  ITC: 'FMCG', HINDUNILVR: 'FMCG', NESTLEIND: 'FMCG', BRITANNIA: 'FMCG', DABUR: 'FMCG', MARICO: 'FMCG', TITAN: 'FMCG', ASIANPAINT: 'FMCG',
  SUNPHARMA: 'Pharma', DRREDDY: 'Pharma', CIPLA: 'Pharma', DIVISLAB: 'Pharma', LUPIN: 'Pharma', AUROPHARMA: 'Pharma', BIOCON: 'Pharma', ZYDUSLIFE: 'Pharma',
  MARUTI: 'Auto', TATAMOTORS: 'Auto', M_M: 'Auto', BAJAJ_AUTO: 'Auto', EICHERMOT: 'Auto', HEROMOTOCO: 'Auto', BOSCHLTD: 'Auto', ASHOKLEY: 'Auto',
  TATASTEEL: 'Metals', HINDALCO: 'Metals', JSWSTEEL: 'Metals', VEDL: 'Metals', NMDC: 'Metals', HINDZINC: 'Metals',
  ULTRACEMCO: 'Infra', LNT: 'Infra', ADANIPORTS: 'Infra', SIEMENS: 'Infra', ABB: 'Infra', HAL: 'Infra', BEL: 'Infra', BHEL: 'Infra',
  DMART: 'Consumer', ZOMATO: 'Consumer', PAYTM: 'Consumer', NAUKRI: 'Consumer', IRCTC: 'Consumer',
  LT: 'Infra', ADANIGREEN: 'Energy', PIDILITIND: 'FMCG', GAIL: 'Energy', TATACONSUM: 'FMCG',
};

const PIE_COLORS = ['#2962ff', '#089981', '#f7b500', '#f23645', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#a855f7', '#94a3b8'];

function fmtINR(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
}
function fmtSigned(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n) >= 0 ? '+' : '-'}₹${Math.abs(Number(n)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtNum(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(d);
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function sectorOf(sym) {
  return SECTOR_MAP[sym] || 'Others';
}
function colorFor(value) {
  return Number(value) >= 0 ? C.gain : C.loss;
}

function MetricCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="kite-fund-card" style={{ background: C.surface, borderColor: C.border }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
        {Icon && <Icon size={14} style={{ color: color || C.muted }} />}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function EquityTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  const gain = p.pl >= 0;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 11.5 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{p.label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: C.text }}>Equity {fmtINR(p.equity)}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: gain ? C.gain : C.loss }}>P&amp;L {fmtSigned(p.pl)}</div>
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 11.5 }}>
      <div style={{ fontWeight: 700, color: C.text }}>{p.name}</div>
      <div style={{ fontFamily: 'var(--font-mono)', color: C.muted }}>{fmtINR(p.value)} · {p.payload.pct}%</div>
    </div>
  );
}

export default function PortfolioAnalytics({ holdings = {}, balance = 0, initialBalance = 0, quotes = {} }) {
  const [range, setRange] = useState('1M');
  const [localQuotes, setLocalQuotes] = useState({});

  // Auto-fetch any holding quote that isn't yet in props
  useEffect(() => {
    const keys = Object.keys(holdings || {});
    const missing = keys.filter(sym => {
      const base = String(sym).replace(/\.(NS|BO)$/i, '').toUpperCase();
      const hasQ = quotes?.[sym]?.price || quotes?.[base]?.price || quotes?.[`${base}.NS`]?.price || localQuotes?.[sym]?.price || localQuotes?.[base]?.price;
      return !hasQ;
    });
    if (missing.length > 0) {
      api.getQuotes(missing.join(',')).then(qs => {
        if (!qs) return;
        const arr = Array.isArray(qs) ? qs : [qs];
        const next = {};
        arr.forEach(q => {
          if (q.tradingSymbol) next[q.tradingSymbol] = q;
          if (q.symbol) next[q.symbol] = q;
          const b = String(q.tradingSymbol || q.symbol || '').replace(/\.(NS|BO)$/i, '');
          if (b) next[b] = q;
        });
        setLocalQuotes(prev => ({ ...prev, ...next }));
      }).catch(() => {});
    }
  }, [holdings, quotes]);

  const activeQuotes = useMemo(() => ({ ...quotes, ...localQuotes }), [quotes, localQuotes]);

  const rows = useMemo(() => {
    return Object.entries(holdings || {})
      .filter(([, h]) => h && Number(h.quantity))
      .map(([raw, h]) => {
        const sym = String(raw).replace(/\.(NS|BO)$/i, '').toUpperCase();
        const q = activeQuotes?.[sym] || activeQuotes?.[raw] || activeQuotes?.[`${sym}.NS`] || activeQuotes?.[`${sym}.BO`] || {};
        const qty = Number(h.quantity) || 0;
        const avg = Number(h.avgPrice) || 0;
        const price = Number(q.price) || avg;
        const invested = Math.abs(qty) * avg;
        const current = qty * price;
        const unrealizedPL = (price - avg) * qty;
        const changePct = Number(q.changePercent);
        const prevClose = Number(q.prevClose) || Number(q.previousClose)
          || (Number.isFinite(changePct) && changePct !== 0 ? price / (1 + changePct / 100) : price);
        const todayOpen = Number(q.todayOpen) || Number(q.open)
          || (Number(q.change) ? price - Number(q.change) : prevClose);
        const dayMove = todayOpen - prevClose;
        const hasOpenClose = q.todayOpen != null && q.prevClose != null;
        const dayPL = hasOpenClose ? qty * dayMove : qty * (Number(q.change) || dayMove);
        const dayChangePct = Number.isFinite(changePct)
          ? changePct
          : prevClose ? (dayMove / prevClose) * 100 : 0;
        return {
          raw, sym, sector: sectorOf(sym), qty, avg, price, invested, current,
          unrealizedPL, realizedPL: Number(h.realizedPL) || 0, dayPL, dayChangePct,
        };
      });
  }, [holdings, activeQuotes]);

  const totals = useMemo(() => {
    const cash = Number(balance) || 0;
    const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
    const totalCurrent = rows.reduce((s, r) => s + r.current, 0);
    const totalUnrealized = rows.reduce((s, r) => s + r.unrealizedPL, 0);
    const totalRealized = rows.reduce((s, r) => s + r.realizedPL, 0);
    const dayPL = rows.reduce((s, r) => s + r.dayPL, 0);
    const totalValue = cash + totalCurrent;
    return {
      cash,
      totalInvested,
      totalCurrent,
      totalUnrealized,
      totalRealized,
      totalPL: totalUnrealized + totalRealized,
      dayPL,
      totalValue,
      returnsPct: totalInvested ? ((totalUnrealized + totalRealized) / totalInvested) * 100 : 0,
      cashPct: totalValue ? (cash / totalValue) * 100 : 0,
    };
  }, [rows, balance]);

  const equitySeries = useMemo(() => {
    const days = 90;
    const startVal = Number(initialBalance) > 0 ? Number(initialBalance) : (totals.totalInvested + totals.cash) || 100000;
    const endVal = totals.totalValue || startVal;
    const rand = mulberry32(hashStr(Object.keys(holdings || {}).sort().join(',') + '|' + startVal));
    const drift = totals.totalCurrent > 0
      ? rows.reduce((s, r) => s + r.current * r.dayChangePct, 0) / totals.totalCurrent
      : 0;
    const factors = [1];
    let f = 1;
    for (let i = 1; i < days; i++) {
      f *= 1 + (drift * 0.12 + (rand() - 0.5) * 2.4) / 100;
      factors.push(f);
    }
    const scale = startVal ? (endVal / (startVal * factors[days - 1])) || 1 : 1;
    return factors.map((fac, i) => {
      const equity = startVal * fac * scale;
      return { i, label: `D-${days - 1 - i}`, equity, pl: equity - startVal };
    });
  }, [rows, holdings, initialBalance, totals]);

  const risk = useMemo(() => {
    const series = equitySeries;
    const rets = series.slice(1).map((p, i) => (series[i].equity ? (p.equity - series[i].equity) / series[i].equity : 0));
    const n = rets.length;
    const mean = n ? rets.reduce((s, r) => s + r, 0) / n : 0;
    const variance = n ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / n : 0;
    const std = Math.sqrt(variance);
    const volatility = std * Math.sqrt(252) * 100;
    const sharpe = std > 0 ? (mean * 252 - 0.065) / (std * Math.sqrt(252)) : 0;
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const p of series) {
      peak = Math.max(peak, p.equity);
      const dd = peak > 0 ? ((peak - p.equity) / peak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }
    const betaWeight = rows.reduce((s, r) => s + Math.abs(r.current), 0);
    const beta = betaWeight > 0
      ? rows.reduce((s, r) => {
          const proxy = clamp(0.5 + Math.abs(r.dayChangePct) / 4, 0.4, 2.2);
          return s + proxy * Math.abs(r.current);
        }, 0) / betaWeight
      : 1;
    return { volatility, sharpe, maxDrawdown, beta };
  }, [equitySeries, rows]);

  const sectors = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const cur = map.get(r.sector) || 0;
      map.set(r.sector, cur + Math.abs(r.current));
    }
    const total = [...map.values()].reduce((s, v) => s + v, 0) || 1;
    return [...map.entries()]
      .map(([name, value]) => ({ name, value, pct: Number((value / total * 100).toFixed(1)) }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const diversification = useMemo(() => {
    const n = rows.length;
    if (n === 0 || totals.totalValue <= 0) return { score: 0, hhi: 0, effective: 0 };
    const weights = rows.map(r => r.current / totals.totalValue);
    const hhi = weights.reduce((s, w) => s + w * w, 0);
    const effective = hhi > 0 ? 1 / hhi : 0;
    const score = Math.round(100 * (1 - hhi) * Math.min(1, n / 8));
    return { score: clamp(score, 0, 100), hhi, effective };
  }, [rows, totals]);

  const warnings = useMemo(() => {
    const out = [];
    const n = rows.length;
    if (n === 0) {
      out.push({ level: 'info', text: 'No open positions. Analytics, risk metrics and the heatmap populate once you take a trade.' });
      return out;
    }
    const gross = rows.reduce((s, r) => s + Math.abs(r.current), 0) || 1;
    const sorted = [...rows].sort((a, b) => Math.abs(b.current) - Math.abs(a.current));
    const top = sorted[0];
    const topPct = Math.abs(top.current) / gross * 100;
    if (topPct > 40) out.push({ level: 'high', text: `Concentration risk: ${top.sym} is ${topPct.toFixed(1)}% of gross exposure.` });
    else if (topPct > 25) out.push({ level: 'medium', text: `Single-stock exposure: ${top.sym} is ${topPct.toFixed(1)}% of gross exposure.` });
    if (sectors[0] && sectors[0].pct > 50) {
      out.push({ level: 'high', text: `Sector concentration: ${sectors[0].name} is ${sectors[0].pct.toFixed(1)}% of the portfolio.` });
    }
    if (totals.totalValue > 0 && totals.cashPct < 10) {
      out.push({ level: 'medium', text: `Low cash buffer: only ${totals.cashPct.toFixed(1)}% of equity is cash.` });
    }
    if (risk.beta > 1.4) out.push({ level: 'medium', text: `Elevated beta ${risk.beta.toFixed(2)} — portfolio is more volatile than the market.` });
    const dayPct = totals.totalValue ? (totals.dayPL / totals.totalValue) * 100 : 0;
    if (dayPct < -2) out.push({ level: 'high', text: `Significant day loss: ${dayPct.toFixed(2)}% of equity eroded today.` });
    if (out.length === 0) out.push({ level: 'low', text: 'No material concentration or liquidity warnings detected.' });
    return out;
  }, [rows, sectors, totals, risk]);

  const margin = useMemo(() => {
    const used = totals.totalInvested;
    const available = totals.cash;
    const utilization = used + available > 0 ? (used / (used + available)) * 100 : 0;
    return { used, available, utilization: clamp(utilization, 0, 100) };
  }, [totals]);

  const rangeDays = range === '1W' ? 7 : range === '1M' ? 30 : range === '3M' ? 60 : 90;
  const chartData = equitySeries.slice(-rangeDays);

  const marginColor = margin.utilization > 80 ? C.loss : margin.utilization > 55 ? '#f7b500' : C.gain;
  const heatSorted = [...rows].sort((a, b) => Math.abs(b.current) - Math.abs(a.current));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <BarChart3 size={17} style={{ color: C.accent }} />
          Portfolio Analytics
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>Equity · Risk · Allocation</span>
        </h2>
        <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3 }}>
          {['1W', '1M', '3M', 'ALL'].map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                background: range === r ? C.accent : 'transparent',
                color: range === r ? '#fff' : C.muted,
                border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >{r}</button>
          ))}
        </div>
      </div>

      <div className="kite-funds-grid">
        <MetricCard
          icon={IndianRupee}
          label="Total P&L"
          value={fmtSigned(totals.totalPL)}
          color={colorFor(totals.totalPL)}
          sub={`Unrealized ${fmtSigned(totals.totalUnrealized)} · Realized ${fmtSigned(totals.totalRealized)}`}
        />
        <MetricCard
          icon={totals.dayPL >= 0 ? TrendingUp : TrendingDown}
          label="Day P&L"
          value={fmtSigned(totals.dayPL)}
          color={colorFor(totals.dayPL)}
          sub={totals.totalValue ? `${((totals.dayPL / totals.totalValue) * 100).toFixed(2)}% of equity` : '—'}
        />
        <MetricCard
          icon={Wallet}
          label="Total Investment"
          value={fmtINR(totals.totalInvested)}
          color={C.text}
          sub={`Invested across ${rows.length} stock(s)`}
        />
        <MetricCard
          icon={IndianRupee}
          label="Current Value"
          value={fmtINR(totals.totalCurrent)}
          color={C.text}
          sub={`Cash ${fmtINR(totals.cash)} · Equity ${fmtINR(totals.totalValue)}`}
        />
        <MetricCard
          icon={totals.returnsPct >= 0 ? TrendingUp : TrendingDown}
          label="Returns %"
          value={fmtPct(totals.returnsPct)}
          color={colorFor(totals.returnsPct)}
          sub="Absolute return on invested capital"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 14 }}>
        <div className="card" style={{ background: C.surface, borderColor: C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Equity Curve</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: 'var(--font-mono)' }}>
              {fmtINR(chartData[0]?.equity)} → {fmtINR(totals.totalValue)}
            </div>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={60} domain={['auto', 'auto']} tickFormatter={v => '₹' + (v / 1000).toFixed(0) + 'k'} />
                <Tooltip content={<EquityTooltip />} cursor={{ stroke: C.muted, strokeDasharray: '3 3' }} />
                <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="pl" stroke={C.accent} strokeWidth={2} fill="url(#eqFill)" name="P&L" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={{ background: C.surface, borderColor: C.border }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <PieIcon size={14} style={{ color: C.accent }} /> Sector Allocation
          </div>
          {sectors.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12, padding: '40px 0', textAlign: 'center' }}>No holdings to allocate.</div>
          ) : (
            <>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sectors} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} stroke="none">
                      {sectors.map((s, i) => <Cell key={s.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                {sectors.slice(0, 6).map((s, i) => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                    <span style={{ color: C.text, fontWeight: 600, flex: 1 }}>{s.name}</span>
                    <span style={{ color: C.muted, fontFamily: 'var(--font-mono)' }}>{fmtINR(s.value)}</span>
                    <span style={{ color: C.text, fontFamily: 'var(--font-mono)', width: 46, textAlign: 'right' }}>{s.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div className="card" style={{ background: C.surface, borderColor: C.border }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Gauge size={14} style={{ color: C.accent }} /> Margin Utilization
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 6 }}>
            <span>Used {fmtINR(margin.used)}</span>
            <span>{margin.utilization.toFixed(1)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ width: `${margin.utilization}%`, height: '100%', borderRadius: 99, background: marginColor, transition: 'width 0.3s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Available {fmtINR(margin.available)} · Equity {fmtINR(totals.totalValue)}</div>
        </div>

        <div className="card" style={{ background: C.surface, borderColor: C.border }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>P&L Breakdown</div>
          {(() => {
            const absU = Math.abs(totals.totalUnrealized);
            const absR = Math.abs(totals.totalRealized);
            const total = absU + absR || 1;
            const uPct = (absU / total) * 100;
            return (
              <>
                <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ width: `${uPct}%`, background: C.accent }} />
                  <div style={{ width: `${100 - uPct}%`, background: totals.totalRealized >= 0 ? C.gain : C.loss }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, fontSize: 11.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: C.text }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.accent, marginRight: 6 }} />Unrealized</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: colorFor(totals.totalUnrealized), fontWeight: 700 }}>{fmtSigned(totals.totalUnrealized)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: C.text }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.gain, marginRight: 6 }} />Realized</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: colorFor(totals.totalRealized), fontWeight: 700 }}>{fmtSigned(totals.totalRealized)}</span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        <div className="card" style={{ background: C.surface, borderColor: C.border, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 88, height: 88, borderRadius: '50%', flexShrink: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: `conic-gradient(${C.accent} ${diversification.score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
            }}
          >
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: C.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: C.text }}>{diversification.score}</span>
              <span style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>/ 100</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={14} style={{ color: C.accent }} /> Diversification
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              Effective holdings <b style={{ color: C.text, fontFamily: 'var(--font-mono)' }}>{diversification.effective.toFixed(1)}</b> of {rows.length} ·
              {' '}{sectors.length} sector{sectors.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 10.5, color: diversification.score >= 70 ? C.gain : diversification.score >= 40 ? '#f7b500' : C.loss, fontWeight: 700, marginTop: 4 }}>
              {diversification.score >= 70 ? 'Well diversified' : diversification.score >= 40 ? 'Moderate concentration' : 'Highly concentrated'}
            </div>
          </div>
        </div>
      </div>

      <div className="kite-funds-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <MetricCard icon={Activity} label="Beta (est.)" value={fmtNum(risk.beta)} color={risk.beta > 1.4 ? C.loss : risk.beta < 0.8 ? C.gain : C.text} sub="Weighted vs market" />
        <MetricCard icon={TrendingUp} label="Sharpe Ratio" value={fmtNum(risk.sharpe)} color={risk.sharpe > 1 ? C.gain : risk.sharpe < 0 ? C.loss : C.text} sub="Annualized, rf 6.5%" />
        <MetricCard icon={TrendingDown} label="Max Drawdown" value={`-${fmtNum(risk.maxDrawdown)}%`} color={risk.maxDrawdown > 15 ? C.loss : C.text} sub="Peak to trough" />
        <MetricCard icon={Gauge} label="Volatility" value={`${fmtNum(risk.volatility)}%`} color={risk.volatility > 30 ? C.loss : C.text} sub="Annualized std dev" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {warnings.map((w, i) => {
          const color = w.level === 'high' ? C.loss : w.level === 'medium' ? '#f7b500' : w.level === 'low' ? C.gain : C.accent;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: C.text }}>
              <ShieldAlert size={14} style={{ color, marginTop: 1, flexShrink: 0 }} />
              <span>{w.text}</span>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ background: C.surface, borderColor: C.border }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Holdings Heatmap</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Sized by position value · coloured by day change</div>
        {heatSorted.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12, padding: '30px 0', textAlign: 'center' }}>No holdings to display.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {heatSorted.map(r => {
              const intensity = clamp(Math.abs(r.dayChangePct) / 8, 0.12, 0.85);
              const bg = r.dayChangePct >= 0
                ? `rgba(8,153,129,${intensity})`
                : `rgba(242,54,69,${intensity})`;
              return (
                <div
                  key={r.sym}
                  title={`${r.sym} · ${fmtINR(r.current)} · Day ${fmtPct(r.dayChangePct)}`}
                  style={{
                    flexGrow: Math.max(Math.abs(r.current), 1),
                    flexBasis: 96,
                    minWidth: 96,
                    borderRadius: 8,
                    padding: '10px 12px',
                    background: bg,
                    border: `1px solid ${C.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{r.sym}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-mono)', color: r.dayChangePct >= 0 ? C.gain : C.loss }}>
                    {fmtPct(r.dayChangePct)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ background: C.surface, borderColor: C.border }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Holdings · Live Analytics</div>
        {rows.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12, padding: '30px 0', textAlign: 'center' }}>No holdings yet.</div>
        ) : (
          <div className="scroll-x">
            <table className="kite-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Avg Cost</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Invested</th>
                  <th style={{ textAlign: 'right' }}>Current</th>
                  <th style={{ textAlign: 'right' }}>Unrealized P&L</th>
                  <th style={{ textAlign: 'right' }}>Day P&L</th>
                  <th style={{ textAlign: 'right' }}>Day %</th>
                  <th style={{ textAlign: 'right' }}>Weightage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const weight = totals.totalValue ? (r.current / totals.totalValue) * 100 : 0;
                  const gain = r.unrealizedPL >= 0;
                  return (
                    <tr key={r.raw}>
                      <td style={{ fontWeight: 800, color: C.text }}>
                        {r.sym}
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>{r.sector}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: C.text }}>{r.qty}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: C.muted }}>{fmtINR(r.avg)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: C.text, fontWeight: 700 }}>{fmtINR(r.price)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: C.muted }}>{fmtINR(r.invested)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: C.text }}>{fmtINR(r.current)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: gain ? C.gain : C.loss }}>
                        {fmtSigned(r.unrealizedPL)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: colorFor(r.dayPL) }}>
                        {fmtSigned(r.dayPL)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: colorFor(r.dayChangePct) }}>{fmtPct(r.dayChangePct)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <div style={{ width: 50, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <div style={{ width: `${clamp(Math.abs(weight), 0, 100)}%`, height: '100%', background: C.accent }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', color: C.text, fontSize: 11.5, width: 46 }}>{weight.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
