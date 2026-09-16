import { useState, useEffect } from 'react';
import './RiskAdvisor.css';
import api from '../../services/api';
import { ShieldAlert, AlertTriangle, Activity, PieChart, RefreshCw, Zap, TrendingDown, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// ── What-If Scenario Definitions ─────────────────────────────────────────────
const SCENARIOS = [
  {
    id: 'rbi_hike',
    label: 'RBI Rate Hike (+50bps)',
    icon: '🏦',
    impacts: { Banking: +2.5, NBFC: -4, IT: -1.5, Pharma: 0, FMCG: -0.8, Auto: -2, Realty: -6, Energy: -1, Metals: -1.5, default: -1.2 },
    description: 'Rate-sensitive sectors (Banking NBFCs, Realty) decline. Export-heavy IT sees mild pressure.'
  },
  {
    id: 'rupee_fall',
    label: 'Rupee Depreciation (5%)',
    icon: '₹',
    impacts: { IT: +6, Pharma: +4, Metals: +3, Energy: -5, FMCG: -2, Auto: -3, Banking: -1.5, Realty: -1, NBFC: -2, default: -0.5 },
    description: 'IT and Pharma (USD earners) benefit. Import-heavy sectors (Energy, Auto) are hurt.'
  },
  {
    id: 'global_tech_selloff',
    label: 'Global Tech Selloff',
    icon: '💻',
    impacts: { IT: -12, FMCG: +1, Pharma: +0.5, Banking: -3, Energy: -2, Metals: -4, Auto: -2.5, Realty: -1, NBFC: -2.5, default: -3 },
    description: 'IT sector severely hit. Defensive sectors (FMCG, Pharma) act as safe haven.'
  },
  {
    id: 'crude_spike',
    label: 'Crude Oil Spike (+20%)',
    icon: '🛢️',
    impacts: { Energy: +8, Auto: -5, FMCG: -3, Chemicals: -2, Pharma: -1.5, IT: -1, Banking: -2, Metals: +2, Airlines: -15, default: -2 },
    description: 'Oil producers gain; input-cost-sensitive sectors (Auto, FMCG, Airlines) suffer.'
  },
  {
    id: 'budget_positive',
    label: 'Union Budget Positive',
    icon: '📋',
    impacts: { Infra: +8, Defence: +10, Realty: +5, Banking: +3, FMCG: +2, IT: +1, Auto: +4, PSU: +6, default: +2 },
    description: 'Capex-heavy budget boosts Infra, Defence, PSU banks. Broad market rally expected.'
  },
];

// ── Sector colour map ─────────────────────────────────────────────────────────
const SECTOR_COLORS = [
  '#6366f1','#10b981','#f59e0b','#3b82f6','#ec4899',
  '#8b5cf6','#14b8a6','#f97316','#06b6d4','#84cc16','#ef4444',
];

export default function RiskAdvisorPage({ holdings, quotes }) {
  const [report, setReport]       = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [activeScenario, setActiveScenario] = useState(null);

  const fetchRiskReport = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAIPortfolioRisk();
      setReport(data.report);
    } catch (err) {
      setError('Failed to fetch AI risk report. Please ensure GEMINI_API_KEY is configured.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRiskReport(); }, []);

  // ── Compute real sector exposure from holdings ────────────────────────────
  const sectorExposure = {};
  let totalValue = 0;

  Object.entries(holdings).forEach(([symbol, h]) => {
    const quote  = quotes[symbol];
    const ltp    = quote ? quote.price : h.avgPrice;
    const val    = ltp * h.quantity;
    totalValue  += val;
    // Use sector from holding data if available, otherwise infer from symbol pattern
    const sector = h.sector || inferSector(symbol);
    sectorExposure[sector] = (sectorExposure[sector] || 0) + val;
  });

  function inferSector(symbol) {
    const s = symbol.toUpperCase();
    if (/^(HDFCBANK|SBIN|ICICIBANK|AXISBANK|KOTAKBANK|BANDHANBNK|FEDERALBNK)/.test(s)) return 'Banking';
    if (/^(TCS|INFY|WIPRO|HCLTECH|TECHM|MPHASIS|LTIM)/.test(s)) return 'IT';
    if (/^(RELIANCE|ONGC|BPCL|IOC|CAIRN)/.test(s)) return 'Energy';
    if (/^(SUNPHARMA|DRREDDY|CIPLA|DIVISLAB|LUPIN)/.test(s)) return 'Pharma';
    if (/^(MARUTI|BAJAJ-AUTO|M&M|TATAMOTORS|EICHERMOT)/.test(s)) return 'Auto';
    if (/^(BAJFINANCE|BAJAJFINSV|CHOLAFIN|MUTHOOTFIN)/.test(s)) return 'NBFC';
    if (/^(HINDUNILVR|ITC|NESTLEIND|BRITANNIA|MARICO)/.test(s)) return 'FMCG';
    if (/^(TATASTEEL|HINDALCO|JSWSTEEL|VEDL|NMDC)/.test(s)) return 'Metals';
    if (/^(DLF|GODREJPROP|OBEROIRLTY|PHOENIXLTD)/.test(s)) return 'Realty';
    if (/CE$|PE$|FUT$/.test(s)) return 'F&O';
    return 'Equity';
  }

  // ── Scenario impact calculation ───────────────────────────────────────────
  const computeScenarioImpact = (scenario) => {
    let totalImpact = 0;
    Object.entries(sectorExposure).forEach(([sector, val]) => {
      const pct = scenario.impacts[sector] ?? scenario.impacts.default ?? 0;
      totalImpact += val * (pct / 100);
    });
    return totalImpact;
  };

  const getHeatmapColor = (pct) => {
    if (pct > 40) return 'var(--loss)';
    if (pct > 25) return '#f59e0b';
    return 'var(--gain)';
  };

  const hasHoldings  = Object.keys(holdings).length > 0;
  const sectorList   = Object.entries(sectorExposure).sort((a, b) => b[1] - a[1]);

  const selectedScenario = SCENARIOS.find(s => s.id === activeScenario);
  const scenarioImpact   = selectedScenario ? computeScenarioImpact(selectedScenario) : 0;

  return (
    <div className="risk-page">
      <div className="risk-header">
        <h2><ShieldAlert size={28} style={{ color: 'var(--accent-primary)' }} /> AI Portfolio Risk Advisor</h2>
        <div className="risk-subtitle">Institutional-grade portfolio analysis, sector concentration heatmap, and "what-if" scenario modeling.</div>
      </div>

      {!hasHoldings ? (
        <div className="empty-state">
          <PieChart size={48} opacity={0.5} />
          <h3>No Active Holdings</h3>
          <p>Start trading to build your portfolio and receive AI risk analysis.</p>
        </div>
      ) : (
        <>
          <div className="risk-grid">
            {/* ── Sector Concentration Heatmap ── */}
            <div className="risk-card">
              <div className="risk-card-header">
                <PieChart size={18} /> Sector Concentration Risk
              </div>
              {sectorList.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sector data…</div>
              ) : (
                <div>
                  {sectorList.map(([sector, val], i) => {
                    const pct = totalValue > 0 ? (val / totalValue) * 100 : 0;
                    return (
                      <div className="heatmap-row" key={sector}>
                        <div className="heatmap-label">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: SECTOR_COLORS[i % SECTOR_COLORS.length], display: 'inline-block' }} />
                            {sector}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{pct.toFixed(1)}%</span>
                        </div>
                        <div className="heatmap-bar-bg">
                          <div
                            className="heatmap-bar-fill"
                            style={{ width: `${pct}%`, background: getHeatmapColor(pct) }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontStyle: 'italic' }}>
                    ⚠️ Concentration &gt; 40% in a single sector is considered high risk by SEBI guidelines.
                  </div>
                </div>
              )}
            </div>

            {/* ── Portfolio Vital Signs ── */}
            <div className="risk-card">
              <div className="risk-card-header">
                <Activity size={18} /> Portfolio Vital Signs
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Exposure</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Holdings Count</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {Object.keys(holdings).length}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sectors</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {sectorList.length}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Top Sector</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: sectorList[0]?.[1] / totalValue > 0.4 ? 'var(--loss)' : 'var(--gain)' }}>
                    {sectorList[0]?.[0] || '—'}
                    <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                      {sectorList[0] ? ((sectorList[0][1] / totalValue) * 100).toFixed(1) + '% of portfolio' : ''}
                    </div>
                  </div>
                </div>
              </div>
              {/* Concentration Risk gauge */}
              {sectorList[0] && (
                <div style={{ marginTop: 16, padding: '12px', background: 'var(--bg-layer)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Diversification Score</div>
                  {(() => {
                    const topPct = (sectorList[0][1] / totalValue) * 100;
                    const score  = Math.max(0, 100 - topPct * 1.5);
                    const color  = score > 60 ? 'var(--gain)' : score > 35 ? '#f59e0b' : 'var(--loss)';
                    const label  = score > 60 ? 'Well Diversified' : score > 35 ? 'Moderate Risk' : 'High Concentration';
                    return (
                      <>
                        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
                          <span style={{ color }}>{label}</span>
                          <span style={{ color, fontWeight: 700 }}>{score.toFixed(0)}/100</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* ── What-If Scenario Simulator ── */}
          <div className="risk-card" style={{ marginBottom: 24 }}>
            <div className="risk-card-header">
              <Zap size={18} style={{ color: '#f59e0b' }} /> What-If Scenario Simulator
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', fontWeight: 400 }}>
                <Info size={11} style={{ verticalAlign: 'middle' }} /> Click a scenario to see estimated portfolio impact
              </span>
            </div>
            <div className="scenario-grid">
              {SCENARIOS.map(sc => {
                const impact = computeScenarioImpact(sc);
                const isActive = activeScenario === sc.id;
                return (
                  <button
                    key={sc.id}
                    className={`scenario-btn ${isActive ? 'scenario-active' : ''}`}
                    onClick={() => setActiveScenario(isActive ? null : sc.id)}
                  >
                    <span className="scenario-icon">{sc.icon}</span>
                    <span className="scenario-label">{sc.label}</span>
                    <span className={`scenario-impact ${impact >= 0 ? 'gain' : 'loss'}`}>
                      {impact >= 0 ? '+' : ''}₹{Math.abs(impact).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedScenario && (
              <div className={`scenario-detail ${scenarioImpact >= 0 ? 'scenario-detail-gain' : 'scenario-detail-loss'}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedScenario.icon} {selectedScenario.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{selectedScenario.description}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Estimated Portfolio Impact</div>
                    <div className={scenarioImpact >= 0 ? 'gain' : 'loss'} style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {scenarioImpact >= 0 ? '+' : ''}₹{scenarioImpact.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {totalValue > 0 ? ((scenarioImpact / totalValue) * 100).toFixed(2) : '0.00'}% of exposure
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <strong>Sector-wise breakdown:</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {sectorList.map(([sector, val]) => {
                      const impactPct = selectedScenario.impacts[sector] ?? selectedScenario.impacts.default ?? 0;
                      const sectorImpact = val * (impactPct / 100);
                      return (
                        <span key={sector} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10,
                          background: impactPct >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                          color: impactPct >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 600 }}>
                          {sector} {impactPct >= 0 ? '+' : ''}{impactPct}% → {sectorImpact >= 0 ? '+' : ''}₹{Math.abs(sectorImpact).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── AI Risk Assessment ── */}
          <div className="ai-report">
            <div className="risk-card-header" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} style={{ color: 'var(--accent-primary)' }} />
                AI Risk Assessment
              </span>
              <button
                onClick={fetchRiskReport}
                disabled={loading}
                style={{ background: 'transparent', border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                {loading ? 'Analyzing...' : 'Refresh'}
              </button>
            </div>

            {error ? (
              <div style={{ color: 'var(--loss)', fontSize: 14 }}>{error}</div>
            ) : (
              <div className="ai-report-content">
                {report ? (
                  <ReactMarkdown>{report}</ReactMarkdown>
                ) : (
                  <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
