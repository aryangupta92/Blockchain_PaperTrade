import { useMemo } from 'react';
import './Portfolio.css';
import { TrendingUp, TrendingDown, Wallet, BarChart2, Activity, Target, ArrowUpRight, ArrowDownRight } from 'lucide-react';

function fmtPrice(n) {
  if (n === undefined || n === null) return '0.00';
  const abs = Math.abs(n);
  if (abs >= 10000000) return (n / 10000000).toFixed(2) + 'Cr';
  if (abs >= 100000)   return (n / 100000).toFixed(2) + 'L';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00%';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

// Mini sparkline component (pure CSS bars)
function Sparkline({ values = [], color }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, width: 80 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(10, ((v - min) / range) * 100)}%`,
            background: color,
            borderRadius: 2,
            opacity: 0.7 + (i / values.length) * 0.3,
          }}
        />
      ))}
    </div>
  );
}

// Radial donut segment component
function DonutChart({ segments }) {
  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0);
  if (!total) return null;

  let cumulative = 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, transform: 'rotate(-90deg)' }}>
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--bg-surface)" strokeWidth="16" />
      {segments.map((seg, i) => {
        const pct = Math.abs(seg.value) / total;
        const dashArray = `${pct * circumference} ${circumference}`;
        const dashOffset = -cumulative * circumference;
        cumulative += pct;
        return (
          <circle
            key={i}
            cx="70" cy="70" r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth="16"
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
        );
      })}
    </svg>
  );
}

const POSITION_COLORS = [
  '#6366f1','#10b981','#f59e0b','#3b82f6','#ec4899',
  '#8b5cf6','#14b8a6','#f97316','#06b6d4','#84cc16',
];

export default function PortfolioPage({ holdings, quotes, balance, initialBalance, onTrade }) {
  const positions = Object.entries(holdings).filter(([, h]) => h.quantity !== 0);
  const canTrade = typeof onTrade === 'function';

  const stats = useMemo(() => {
    const totalInvested = positions.reduce((sum, [, h]) => sum + Math.abs(h.quantity) * h.avgPrice, 0);
    const currentValue = positions.reduce((sum, [symbol, h]) => {
      const ltp = quotes[symbol]?.price || h.avgPrice;
      return sum + h.quantity * ltp;
    }, 0);
    const totalPL = positions.reduce((sum, [symbol, h]) => {
      const ltp = quotes[symbol]?.price || h.avgPrice;
      const qty = h.quantity;
      const pl = qty >= 0 ? (ltp - h.avgPrice) * qty : (h.avgPrice - ltp) * Math.abs(qty);
      return sum + pl;
    }, 0);
    const totalPLPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const portfolioValue = balance + Math.max(0, currentValue);
    const overallReturn = portfolioValue - initialBalance;
    const overallReturnPct = initialBalance > 0 ? (overallReturn / initialBalance) * 100 : 0;
    const winPositions = positions.filter(([symbol, h]) => {
      const ltp = quotes[symbol]?.price || h.avgPrice;
      const qty = h.quantity;
      return qty >= 0 ? ltp > h.avgPrice : ltp < h.avgPrice;
    });
    const winRate = positions.length > 0 ? (winPositions.length / positions.length) * 100 : 0;

    return { totalInvested, currentValue, totalPL, totalPLPct, portfolioValue, overallReturn, overallReturnPct, winRate };
  }, [holdings, quotes, balance, initialBalance, positions]);

  const donutSegments = positions.slice(0, 10).map(([symbol, h], i) => {
    const ltp = quotes[symbol]?.price || h.avgPrice;
    const value = Math.abs(h.quantity) * ltp;
    return { symbol, value, color: POSITION_COLORS[i % POSITION_COLORS.length] };
  });

  return (
    <div className="portfolio-page">

      {/* ── KPI Summary Row ─────────────────────────────────────────────────── */}
      <div className="portfolio-kpi-row">
        <div className="card pf-kpi-card">
          <div className="pf-kpi-icon" style={{ background: 'rgba(99,102,241,0.15)' }}>
            <Wallet size={16} style={{ color: '#6366f1' }} />
          </div>
          <div>
            <div className="pf-kpi-label">Portfolio Value</div>
            <div className="pf-kpi-value">₹{fmtPrice(stats.portfolioValue)}</div>
            <div className={`pf-kpi-sub ${stats.overallReturn >= 0 ? 'gain' : 'loss'}`}>
              {stats.overallReturn >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
              {fmtPct(stats.overallReturnPct)} overall
            </div>
          </div>
        </div>

        <div className="card pf-kpi-card">
          <div className="pf-kpi-icon" style={{ background: 'rgba(16,185,129,0.15)' }}>
            <Wallet size={16} style={{ color: '#10b981' }} />
          </div>
          <div>
            <div className="pf-kpi-label">Cash Balance</div>
            <div className="pf-kpi-value gain">₹{fmtPrice(balance)}</div>
            <div className="pf-kpi-sub">Available to deploy</div>
          </div>
        </div>

        <div className="card pf-kpi-card">
          <div className="pf-kpi-icon" style={{ background: 'rgba(245,158,11,0.15)' }}>
            <BarChart2 size={16} style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <div className="pf-kpi-label">Invested</div>
            <div className="pf-kpi-value">₹{fmtPrice(stats.totalInvested)}</div>
            <div className="pf-kpi-sub">{positions.length} open position{positions.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <div className="card pf-kpi-card">
          <div className="pf-kpi-icon" style={{ background: stats.totalPL >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)' }}>
            {stats.totalPL >= 0 ? <TrendingUp size={16} style={{ color: '#10b981' }} /> : <TrendingDown size={16} style={{ color: '#f43f5e' }} />}
          </div>
          <div>
            <div className="pf-kpi-label">Unrealized P&amp;L</div>
            <div className={`pf-kpi-value ${stats.totalPL >= 0 ? 'gain' : 'loss'}`}>
              {stats.totalPL >= 0 ? '+' : '-'}₹{fmtPrice(Math.abs(stats.totalPL))}
            </div>
            <div className={`pf-kpi-sub ${stats.totalPLPct >= 0 ? 'gain' : 'loss'}`}>
              {fmtPct(stats.totalPLPct)} on invested
            </div>
          </div>
        </div>

        <div className="card pf-kpi-card">
          <div className="pf-kpi-icon" style={{ background: 'rgba(59,130,246,0.15)' }}>
            <Target size={16} style={{ color: '#3b82f6' }} />
          </div>
          <div>
            <div className="pf-kpi-label">Win Rate</div>
            <div className="pf-kpi-value" style={{ color: stats.winRate >= 50 ? '#10b981' : '#f43f5e' }}>
              {stats.winRate.toFixed(0)}%
            </div>
            <div className="pf-kpi-sub">{positions.filter(([s, h]) => { const ltp = quotes[s]?.price || h.avgPrice; return h.quantity >= 0 ? ltp > h.avgPrice : ltp < h.avgPrice; }).length} / {positions.length} winning</div>
          </div>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────────────── */}
      <div className="portfolio-main-row">
        {/* Left: Holdings Table */}
        <div className="card" style={{ flex: '1 1 65%', minWidth: 0 }}>
          <div className="section-header" style={{ marginBottom: 12 }}>
            <Activity size={15} style={{ color: 'var(--accent-primary)' }} />
            <span className="section-title">Open Positions</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {positions.length} positions
            </span>
          </div>

          {positions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px 0', color: 'var(--text-muted)' }}>
              <BarChart2 size={36} style={{ marginBottom: 12, opacity: 0.2 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No Open Positions</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Place a trade to start building your portfolio</div>
            </div>
          ) : (
            <div className="scroll-x">
              <table className="data-table holdings-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Avg Cost</th>
                    <th style={{ textAlign: 'right' }}>LTP</th>
                    <th style={{ textAlign: 'right' }}>Invested</th>
                    <th style={{ textAlign: 'right' }}>Mkt Value</th>
                    <th style={{ textAlign: 'right' }}>P&amp;L</th>
                    <th style={{ textAlign: 'right' }}>% Chg</th>
                    <th style={{ textAlign: 'right' }}>Trend</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(([symbol, h], i) => {
                    const ltp = quotes[symbol]?.price || h.avgPrice;
                    const qty = h.quantity;
                    const invested = Math.abs(qty) * h.avgPrice;
                    const curValue = qty * ltp;
                    const pl = qty >= 0 ? (ltp - h.avgPrice) * qty : (h.avgPrice - ltp) * Math.abs(qty);
                    const plPct = invested > 0 ? (pl / invested) * 100 : 0;
                    const isGain = pl >= 0;
                    const isShort = qty < 0;
                    const dayChg = quotes[symbol]?.changePercent || 0;
                    const color = POSITION_COLORS[i % POSITION_COLORS.length];

                    // Generate mock sparkline values from price data
                    const basePrice = h.avgPrice;
                    const sparkValues = [basePrice, basePrice * 1.01, basePrice * 0.99, basePrice * 1.015, basePrice * 1.008, ltp * 0.99, ltp];

                    return (
                      <tr key={symbol}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{symbol}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{/\b(CE|PE)\b/.test(symbol) ? 'OPTION' : 'NSE EQ'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: isShort ? 'var(--loss)' : 'var(--text-primary)' }}>
                          {isShort ? `${Math.abs(qty)} ↓` : qty}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>₹{fmtPrice(h.avgPrice)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: dayChg >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                          ₹{fmtPrice(ltp)}
                          <div style={{ fontSize: 10, fontWeight: 500, color: dayChg >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                            {fmtPct(dayChg)} today
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>₹{fmtPrice(invested)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>₹{fmtPrice(Math.abs(curValue))}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: isGain ? 'var(--gain)' : 'var(--loss)' }}>
                          {isGain ? '+' : '-'}₹{fmtPrice(Math.abs(pl))}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`mover-change-pill ${isGain ? 'gain' : 'loss'}`} style={{ fontSize: 11 }}>
                            {fmtPct(plPct)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Sparkline values={sparkValues} color={isGain ? '#10b981' : '#f43f5e'} />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className={isShort ? 'btn-gain' : 'btn-loss'}
                            style={{ padding: '5px 10px', fontSize: 11, borderRadius: 8, width: 'auto' }}
                            onClick={() => canTrade && onTrade({ type: isShort ? 'buy' : 'sell', symbol, quantity: Math.abs(qty), price: ltp, orderType: 'market' })}
                            title={isShort ? 'Buy to cover' : 'Square off'}
                          >
                            {isShort ? '↑ COVER' : '↓ EXIT'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Allocation Donut + Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '0 0 260px' }}>
          {/* Allocation Donut */}
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="section-title" style={{ marginBottom: 12 }}>Allocation</div>
            {positions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0' }}>No positions</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
                  <DonutChart segments={donutSegments} />
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Positions</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{positions.length}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {donutSegments.map(seg => (
                    <div key={seg.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{seg.symbol}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {((seg.value / donutSegments.reduce((s, x) => s + x.value, 0)) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* P&L Progress Bar Card */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 12 }}>Capital Utilization</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Deployed', value: stats.totalInvested, total: initialBalance, color: '#6366f1' },
                { label: 'Cash', value: balance, total: initialBalance, color: '#10b981' },
                { label: 'P&L', value: Math.abs(stats.totalPL), total: stats.totalInvested || 1, color: stats.totalPL >= 0 ? '#10b981' : '#f43f5e' },
              ].map(({ label, value, total, color }) => {
                const pct = Math.min(100, Math.max(0, (value / total) * 100));
                return (
                  <div key={label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>₹{fmtPrice(value)}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg-surface)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
