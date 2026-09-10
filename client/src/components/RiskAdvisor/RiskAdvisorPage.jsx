import { useState, useEffect } from 'react';
import './RiskAdvisor.css';
import api from '../../services/api';
import { ShieldAlert, AlertTriangle, Activity, PieChart, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function RiskAdvisorPage({ holdings, quotes }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  useEffect(() => {
    fetchRiskReport();
  }, []);

  // Compute sector exposure
  const sectorExposure = {};
  let totalValue = 0;

  Object.values(holdings).forEach(h => {
    const quote = quotes[h.symbol];
    const ltp = quote ? quote.price : h.avgPrice;
    const val = ltp * h.quantity;
    totalValue += val;
    // We assume h has sector, or we fallback to 'Unknown'
    const sector = 'Equity'; // Placeholder if instrument data isn't joined locally
    sectorExposure[sector] = (sectorExposure[sector] || 0) + val;
  });

  const getHeatmapColor = (pct) => {
    if (pct > 40) return 'var(--loss)'; // High concentration risk
    if (pct > 20) return '#f59e0b';     // Medium
    return 'var(--gain)';               // Good
  };

  return (
    <div className="risk-page">
      <div className="risk-header">
        <h2><ShieldAlert size={28} style={{ color: 'var(--accent-primary)' }} /> AI Portfolio Risk Advisor</h2>
        <div className="risk-subtitle">Institutional-grade portfolio analysis and "what-if" scenario modeling.</div>
      </div>

      {Object.keys(holdings).length === 0 ? (
        <div className="empty-state">
          <PieChart size={48} opacity={0.5} />
          <h3>No Active Holdings</h3>
          <p>Start trading to build your portfolio and receive AI risk analysis.</p>
        </div>
      ) : (
        <>
          <div className="risk-grid">
            {/* Sector Concentration */}
            <div className="risk-card">
              <div className="risk-card-header">
                <PieChart size={18} /> Sector Concentration Risk
              </div>
              <div>
                {Object.entries(sectorExposure).map(([sector, val]) => {
                  const pct = totalValue > 0 ? (val / totalValue) * 100 : 0;
                  return (
                    <div className="heatmap-row" key={sector}>
                      <div className="heatmap-label">
                        <span>{sector}</span>
                        <span>{pct.toFixed(1)}%</span>
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
                  Concentration &gt; 40% in a single sector is considered high risk.
                </div>
              </div>
            </div>

            {/* Quick Stats */}
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
              </div>
            </div>
          </div>

          {/* AI Report Section */}
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
