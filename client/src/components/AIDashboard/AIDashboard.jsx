import { useState, useEffect, useCallback } from 'react';
import './AIDashboard.css';
import api from '../../services/api';
import ReactMarkdown from 'react-markdown';
import {
  TrendingUp, TrendingDown, Brain, Newspaper, ShieldAlert, Sparkles,
  RefreshCw, Activity, Target, AlertTriangle, CheckCircle, Info,
  BarChart3, PieChart, Zap, Award, Lightbulb, FileText, Gauge,
} from 'lucide-react';

// ─── Confidence Gauge ────────────────────────────────────────────────────────
function ConfidenceGauge({ value, direction }) {
  const clamped = Math.min(100, Math.max(0, value || 0));
  const color = direction === 'UP' ? 'var(--gain)' : direction === 'DOWN' ? 'var(--loss)' : 'var(--neutral)';
  const angle = (clamped / 100) * 180 - 90;

  return (
    <div className="ai-gauge">
      <svg viewBox="0 0 120 70" className="ai-gauge-svg">
        <defs>
          <linearGradient id={`gaugeGrad-${direction}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={direction === 'UP' ? '#10b981' : '#f43f5e'} stopOpacity="0.6" />
            <stop offset="100%" stopColor={direction === 'UP' ? '#10b981' : '#f43f5e'} />
          </linearGradient>
        </defs>
        {/* Background arc */}
        <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="var(--bg-layer)" strokeWidth="10" strokeLinecap="round" />
        {/* Value arc */}
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * 157} 157`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
        {/* Needle */}
        <line
          x1="60" y1="60"
          x2={60 + 35 * Math.cos((angle * Math.PI) / 180)}
          y2={60 + 35 * Math.sin((angle * Math.PI) / 180)}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transition: 'all 0.8s ease' }}
        />
        <circle cx="60" cy="60" r="4" fill={color} />
      </svg>
      <div className="ai-gauge-value" style={{ color }}>{clamped.toFixed(0)}%</div>
      <div className="ai-gauge-label">Confidence</div>
    </div>
  );
}

// ─── Sentiment Bar ───────────────────────────────────────────────────────────
function SentimentBar({ score }) {
  const pct = ((score + 1) / 2) * 100; // -1..1 → 0..100
  const color = score > 0.1 ? 'var(--gain)' : score < -0.1 ? 'var(--loss)' : 'var(--neutral)';
  const label = score > 0.3 ? 'Bullish' : score > 0.1 ? 'Mildly Bullish' : score < -0.3 ? 'Bearish' : score < -0.1 ? 'Mildly Bearish' : 'Neutral';

  return (
    <div className="ai-sentiment-bar">
      <div className="ai-sentiment-track">
        <div className="ai-sentiment-fill" style={{ width: `${pct}%`, background: color }} />
        <div className="ai-sentiment-marker" style={{ left: `${pct}%`, background: color }} />
      </div>
      <div className="ai-sentiment-labels">
        <span style={{ color: 'var(--loss)' }}>Bearish</span>
        <span style={{ color, fontWeight: 600 }}>{label}</span>
        <span style={{ color: 'var(--gain)' }}>Bullish</span>
      </div>
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data, color = 'var(--accent-primary)', width = 120, height = 36 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Card Shell ──────────────────────────────────────────────────────────────
function AICard({ icon: Icon, title, badge, onRefresh, loading, error, children, className = '' }) {
  return (
    <div className={`ai-card ${className}`}>
      <div className="ai-card-header">
        <div className="ai-card-title">
          <Icon size={18} className="ai-card-icon" />
          <span>{title}</span>
          {badge && <span className="ai-card-badge">{badge}</span>}
        </div>
        {onRefresh && (
          <button className="ai-refresh-btn" onClick={onRefresh} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        )}
      </div>
      <div className="ai-card-body">
        {error ? (
          <div className="ai-error"><AlertTriangle size={16} /> {error}</div>
        ) : loading ? (
          <div className="ai-loading">
            <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            <span>Analyzing...</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ─── Render helpers (API returns string arrays; tolerate objects too) ───────
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v.text || v.description || v.detail || v.name || v.type || JSON.stringify(v);
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function AIDashboard({ watchlist = [], holdings = {}, quotes = {} }) {
  const defaultSymbol = watchlist[0] || 'RELIANCE';
  const [forecastSymbol, setForecastSymbol] = useState(defaultSymbol);
  const [forecastTimeframe, setForecastTimeframe] = useState('5m');

  // Section data
  const [forecast, setForecast] = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const [biasReport, setBiasReport] = useState(null);
  const [investRec, setInvestRec] = useState(null);
  const [portfolioInsight, setPortfolioInsight] = useState(null);
  const [portfolioRisk, setPortfolioRisk] = useState(null);
  const [biasCoach, setBiasCoach] = useState(null);

  // Loading & error states
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const fetchSection = useCallback(async (key, fn) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    setErrors(prev => ({ ...prev, [key]: null }));
    try {
      const data = await fn();
      return data;
    } catch (err) {
      setErrors(prev => ({ ...prev, [key]: err.message || 'Failed to load' }));
      return null;
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  const loadForecast = useCallback((sym, tf) => {
    const s = sym || forecastSymbol;
    const t = tf || forecastTimeframe;
    return fetchSection('forecast', async () => {
      const data = await api.getForecast(s, t);
      setForecast(data);
    });
  }, [forecastSymbol, forecastTimeframe, fetchSection]);

  const loadSentiment = useCallback(() => {
    return fetchSection('sentiment', async () => {
      const symbols = watchlist.slice(0, 8).join(',');
      const data = await api.getSentiment(symbols);
      setSentiment(data);
    });
  }, [watchlist, fetchSection]);

  const loadBiasReport = useCallback(() => {
    return fetchSection('biasReport', async () => {
      const data = await api.getBiasReport();
      setBiasReport(data);
    });
  }, [fetchSection]);

  const loadInvestRec = useCallback(() => {
    return fetchSection('investRec', async () => {
      const data = await api.getInvestRecommendation();
      setInvestRec(data);
    });
  }, [fetchSection]);

  const loadPortfolioInsight = useCallback(() => {
    return fetchSection('portfolioInsight', async () => {
      const data = await api.getPortfolioInsight();
      setPortfolioInsight(data);
    });
  }, [fetchSection]);

  const loadPortfolioRisk = useCallback(() => {
    return fetchSection('portfolioRisk', async () => {
      const data = await api.getAIPortfolioRisk();
      setPortfolioRisk(data);
    });
  }, [fetchSection]);

  const loadBiasCoach = useCallback(() => {
    return fetchSection('biasCoach', async () => {
      const data = await api.getAIBiasCoach();
      setBiasCoach(data);
    });
  }, [fetchSection]);

  // Initial load
  useEffect(() => {
    loadForecast();
    loadSentiment();
    loadBiasReport();
    loadInvestRec();
    loadPortfolioInsight();
    loadPortfolioRisk();
    loadBiasCoach();
  }, []); // eslint-disable-line

  // ── Derived data ───────────────────────────────────────────────────────────
  const forecastDirection = forecast?.direction || 'NEUTRAL';
  const forecastConfidence = forecast?.confidence || 0;
  const forecastRows = forecast?.rows || [];
  const pooledAcc = forecast?.pooledAcc;
  const topFeatures = forecast?.topFeatures || [];

  const sentimentData = sentiment?.sentiment || {};
  const sentimentEntries = Object.entries(sentimentData);

  const biasEntries = biasReport?.entries || [];
  const biases = biasReport?.biases || [];
  const strengths = biasReport?.strengths || [];
  const recommendations = biasReport?.recommendations || [];

  const topPick = investRec?.recommendation?.topPick;
  const persona = investRec?.recommendation?.persona;
  const riskNotes = investRec?.recommendation?.riskNotes || [];
  const aiSummary = investRec?.aiSummary || '';

  const insightText = typeof portfolioInsight?.insight === 'string' ? portfolioInsight.insight : asText(portfolioInsight?.insight || '');
  const riskReport = typeof portfolioRisk?.report === 'string' ? portfolioRisk.report : asText(portfolioRisk?.report || '');
  const coachReportRaw = biasCoach?.report || '';
  const coachReport = typeof coachReportRaw === 'string' ? coachReportRaw : '';
  const coachReportObj = coachReportRaw && typeof coachReportRaw === 'object' ? coachReportRaw : null;

  // Strategy validator form state
  const [stratForm, setStratForm] = useState({
    strategyName: '', entryCondition: '', exitCondition: '',
    stopLoss: '', target: '', capital: 100000, instrument: 'NIFTY 50', timeframe: '15m',
  });
  const [strategyReport, setStrategyReport] = useState('');

  const runStrategyValidation = useCallback(() => {
    return fetchSection('strategyValidation', async () => {
      if (!stratForm.strategyName.trim() || !stratForm.entryCondition.trim() || !stratForm.exitCondition.trim()) {
        throw new Error('Strategy name, entry and exit conditions are required.');
      }
      const data = await api.validateStrategy({
        ...stratForm,
        capital: Number(stratForm.capital) || 100000,
      });
      setStrategyReport(data.validationReport || '');
    });
  }, [stratForm, fetchSection]);

  // Sparkline data from forecast rows
  const sparkData = forecastRows.slice(-20).map(r => r.close || r.price || 0);

  const hasHoldings = Object.keys(holdings).length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="ai-dashboard">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-left">
          <Brain size={32} className="ai-header-icon" />
          <div>
            <h1>AI Dashboard</h1>
            <p>Unified AI intelligence — forecasts, sentiment, bias coaching, and portfolio insights</p>
          </div>
        </div>
        <button
          className="ai-refresh-all"
          onClick={() => {
            loadForecast();
            loadSentiment();
            loadBiasReport();
            loadInvestRec();
            loadPortfolioInsight();
            loadPortfolioRisk();
            loadBiasCoach();
          }}
          disabled={Object.values(loading).some(Boolean)}
        >
          <RefreshCw size={14} className={Object.values(loading).some(Boolean) ? 'spin' : ''} />
          Refresh All
        </button>
      </div>

      {/* ═══ Row 1: Forecast + Sentiment ═══ */}
      <div className="ai-grid ai-grid-2">
        {/* ── Section 1: AI Market Forecast ── */}
        <AICard
          icon={TrendingUp}
          title="AI Market Forecast"
          badge="Phase 3"
          loading={loading.forecast}
          error={errors.forecast}
          onRefresh={() => loadForecast()}
          className="ai-card-forecast"
        >
          {forecast && (
            <div className="ai-forecast-content">
              {/* Symbol & Timeframe Selectors */}
              <div className="ai-forecast-controls">
                <select
                  className="ai-select"
                  value={forecastSymbol}
                  onChange={(e) => { setForecastSymbol(e.target.value); loadForecast(e.target.value); }}
                >
                  {watchlist.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  className="ai-select"
                  value={forecastTimeframe}
                  onChange={(e) => { setForecastTimeframe(e.target.value); loadForecast(null, e.target.value); }}
                >
                  <option value="1m">1 min</option>
                  <option value="5m">5 min</option>
                  <option value="15m">15 min</option>
                  <option value="1h">1 hour</option>
                </select>
              </div>

              {/* Direction + Gauge */}
              <div className="ai-forecast-main">
                <div className="ai-forecast-direction">
                  <div className={`ai-direction-badge ai-direction-${forecastDirection.toLowerCase()}`}>
                    {forecastDirection === 'UP' ? <TrendingUp size={20} /> : forecastDirection === 'DOWN' ? <TrendingDown size={20} /> : <Activity size={20} />}
                    {forecastDirection}
                  </div>
                  <div className="ai-forecast-symbol">{forecast.symbol}</div>
                  <div className="ai-forecast-timeframe">{forecast.timeframe}</div>
                </div>
                <ConfidenceGauge value={forecastConfidence} direction={forecastDirection} />
              </div>

              {/* Sparkline */}
              {sparkData.length > 1 && (
                <div className="ai-sparkline-container">
                  <div className="ai-sparkline-label">Recent Price Action</div>
                  <Sparkline data={sparkData} color={forecastDirection === 'UP' ? 'var(--gain)' : forecastDirection === 'DOWN' ? 'var(--loss)' : 'var(--neutral)'} />
                </div>
              )}

              {/* Stats Row */}
              <div className="ai-stats-row">
                <div className="ai-stat">
                  <span className="ai-stat-label">Pooled Accuracy</span>
                  <span className="ai-stat-value">{pooledAcc != null ? `${(pooledAcc * 100).toFixed(1)}%` : '—'}</span>
                </div>
                <div className="ai-stat">
                  <span className="ai-stat-label">Data Points</span>
                  <span className="ai-stat-value">{forecastRows.length || '—'}</span>
                </div>
                <div className="ai-stat">
                  <span className="ai-stat-label">State</span>
                  <span className={`ai-stat-value ai-state-${forecast.state || 'unknown'}`}>{forecast.state || '—'}</span>
                </div>
              </div>

              {/* Top Features */}
              {topFeatures.length > 0 && (
                <div className="ai-features">
                  <div className="ai-features-title"><Zap size={13} /> Top Influencing Features</div>
                  <div className="ai-features-list">
                    {topFeatures.map((f, i) => (
                      <div key={i} className="ai-feature-chip">
                        <span className="ai-feature-name">{f.name || f.feature}</span>
                        <span className="ai-feature-weight">{f.weight != null ? f.weight.toFixed(3) : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </AICard>

        {/* ── Section 2: News Sentiment ── */}
        <AICard
          icon={Newspaper}
          title="News Sentiment"
          badge="Live"
          loading={loading.sentiment}
          error={errors.sentiment}
          onRefresh={loadSentiment}
          className="ai-card-sentiment"
        >
          {sentiment && (
            <div className="ai-sentiment-content">
              <div className="ai-sentiment-summary">
                <span className="ai-sentiment-count">{sentimentEntries.length} symbols</span>
                <span className="ai-sentiment-scored">{sentiment?.scored || 0} headlines analyzed</span>
              </div>
              {sentimentEntries.length === 0 ? (
                <div className="ai-empty"><Newspaper size={32} opacity={0.4} /><p>No sentiment data available</p></div>
              ) : (
                <div className="ai-sentiment-list">
                  {sentimentEntries.map(([symbol, data]) => (
                    <div key={symbol} className="ai-sentiment-item">
                      <div className="ai-sentiment-symbol">{symbol}</div>
                      <div className="ai-sentiment-score" style={{
                        color: data.score > 0.1 ? 'var(--gain)' : data.score < -0.1 ? 'var(--loss)' : 'var(--neutral)'
                      }}>
                        {data.score > 0 ? '+' : ''}{data.score.toFixed(3)}
                      </div>
                      <div className="ai-sentiment-headlines">
                        {data.headlines?.length || 0} headlines
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Sentiment gauge for first symbol */}
              {sentimentEntries.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <SentimentBar score={sentimentEntries[0][1].score} />
                </div>
              )}
            </div>
          )}
        </AICard>
      </div>

      {/* ═══ Row 2: Bias Coach + Investment Recommendation ═══ */}
      <div className="ai-grid ai-grid-2">
        {/* ── Section 3: Trading Bias Coach ── */}
        <AICard
          icon={ShieldAlert}
          title="Trading Bias Coach"
          badge="AI"
          loading={loading.biasReport}
          error={errors.biasReport}
          onRefresh={loadBiasReport}
          className="ai-card-bias"
        >
          {biasReport && (
            <div className="ai-bias-content">
              {biasEntries.length > 0 && (
                <div className="ai-bias-entries">
                  <div className="ai-bias-section-title"><FileText size={13} /> Journal Entries Analyzed: {biasEntries.length}</div>
                </div>
              )}

              {/* Biases */}
              {biases.length > 0 && (
                <div className="ai-bias-section">
                  <div className="ai-bias-section-title"><AlertTriangle size={13} /> Detected Biases</div>
                  <div className="ai-bias-list">
                    {biases.map((b, i) => (
                      <div key={i} className="ai-bias-item ai-bias-warning">
                        <span className="ai-bias-name">{asText(b)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Strengths */}
              {strengths.length > 0 && (
                <div className="ai-bias-section">
                  <div className="ai-bias-section-title"><Award size={13} /> Strengths</div>
                  <div className="ai-bias-list">
                    {strengths.map((s, i) => (
                      <div key={i} className="ai-bias-item ai-bias-strength">
                        <CheckCircle size={13} />
                        <span>{asText(s)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <div className="ai-bias-section">
                  <div className="ai-bias-section-title"><Lightbulb size={13} /> Recommendations</div>
                  <div className="ai-bias-list">
                    {recommendations.map((r, i) => (
                      <div key={i} className="ai-bias-item ai-bias-rec">
                        <span className="ai-bias-rec-text">{asText(r)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bias Coach Report (from bias-coach endpoint) */}
              {coachReport && (
                <div className="ai-bias-coach-report">
                  <div className="ai-bias-section-title"><Brain size={13} /> AI Bias Analysis</div>
                  <div className="ai-markdown"><ReactMarkdown>{coachReport}</ReactMarkdown></div>
                </div>
              )}
              {coachReportObj && (
                <div className="ai-bias-coach-report">
                  <div className="ai-bias-section-title"><Brain size={13} /> AI Bias Analysis</div>
                  {coachReportObj.persona && <div style={{ fontSize: 12, marginBottom: 6 }}><strong>{asText(coachReportObj.persona)}</strong>{coachReportObj.personaDescription ? ` — ${asText(coachReportObj.personaDescription)}` : ''}</div>}
                  {(coachReportObj.biases || []).map((b, i) => <div key={i} className="ai-bias-item ai-bias-warning" style={{ marginBottom: 4 }}>{asText(b)}</div>)}
                  {(coachReportObj.recommendations || []).map((r, i) => <div key={i} className="ai-bias-item ai-bias-rec" style={{ marginBottom: 4 }}>{asText(r)}</div>)}
                </div>
              )}

              {biases.length === 0 && strengths.length === 0 && recommendations.length === 0 && !coachReport && (
                <div className="ai-empty"><ShieldAlert size={32} opacity={0.4} /><p>No bias data — add journal entries to get started</p></div>
              )}
            </div>
          )}
        </AICard>

        {/* ── Section 4: Investment Recommendation ── */}
        <AICard
          icon={Sparkles}
          title="Investment Recommendation"
          badge="AI"
          loading={loading.investRec}
          error={errors.investRec}
          onRefresh={loadInvestRec}
          className="ai-card-invest"
        >
          {investRec && (
            <div className="ai-invest-content">
              {/* Top Pick */}
              {topPick && (
                <div className="ai-top-pick">
                  <div className="ai-top-pick-label">Top Pick</div>
                  <div className="ai-top-pick-symbol">{typeof topPick === 'string' ? topPick : (topPick.segment || topPick.symbol || asText(topPick))}</div>
                  {(topPick.reasoning || topPick.why) && <div className="ai-top-pick-reasoning">{topPick.reasoning || topPick.why}</div>}
                  {topPick.score != null && (
                    <div className="ai-top-pick-score">
                      Score: <strong>{Number(topPick.score).toFixed(1)}</strong>/10
                    </div>
                  )}
                </div>
              )}

              {/* Persona */}
              {persona && (
                <div className="ai-persona">
                  <div className="ai-persona-label">Your Persona</div>
                  <div className="ai-persona-value">{persona}</div>
                </div>
              )}

              {/* Risk Notes */}
              {riskNotes.length > 0 && (
                <div className="ai-risk-notes">
                  <div className="ai-risk-notes-title"><AlertTriangle size={13} /> Risk Notes</div>
                  <ul>
                    {riskNotes.map((note, i) => (
                      <li key={i}>{asText(note)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* AI Summary */}
              {aiSummary && (
                <div className="ai-summary">
                  <div className="ai-summary-title"><Brain size={13} /> AI Summary</div>
                  <div className="ai-markdown"><ReactMarkdown>{aiSummary}</ReactMarkdown></div>
                </div>
              )}

              {!topPick && !aiSummary && (
                <div className="ai-empty"><Sparkles size={32} opacity={0.4} /><p>No recommendation available</p></div>
              )}
            </div>
          )}
        </AICard>
      </div>

      {/* ═══ Row 3: Portfolio AI Insights ═══ */}
      <div className="ai-grid ai-grid-2">
        {/* ── Section 5a: Portfolio Insight ── */}
        <AICard
          icon={PieChart}
          title="Portfolio AI Insight"
          loading={loading.portfolioInsight}
          error={errors.portfolioInsight}
          onRefresh={loadPortfolioInsight}
          className="ai-card-insight"
        >
          {insightText ? (
            <div className="ai-markdown ai-insight-text"><ReactMarkdown>{insightText}</ReactMarkdown></div>
          ) : (
            <div className="ai-empty"><PieChart size={32} opacity={0.4} /><p>No portfolio insight available</p></div>
          )}
        </AICard>

        {/* ── Section 5b: Portfolio Risk ── */}
        <AICard
          icon={BarChart3}
          title="Portfolio Risk Assessment"
          loading={loading.portfolioRisk}
          error={errors.portfolioRisk}
          onRefresh={loadPortfolioRisk}
          className="ai-card-risk"
        >
          {riskReport ? (
            <div className="ai-markdown"><ReactMarkdown>{riskReport}</ReactMarkdown></div>
          ) : (
            <div className="ai-empty"><BarChart3 size={32} opacity={0.4} /><p>No risk report available</p></div>
          )}
        </AICard>
      </div>

      {/* ═══ Row 4: Strategy Validation ═══ */}
      <AICard
        icon={Target}
        title="Strategy Validator"
        badge="AI"
        loading={loading.strategyValidation}
        error={errors.strategyValidation}
        className="ai-card-strategy"
      >
        <div className="ai-strategy-form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <input className="input" placeholder="Strategy name *" value={stratForm.strategyName} onChange={(e) => setStratForm((f) => ({ ...f, strategyName: e.target.value }))} style={{ gridColumn: '1 / -1' }} />
          <input className="input" placeholder="Entry condition * (e.g. EMA 9 crosses above EMA 20)" value={stratForm.entryCondition} onChange={(e) => setStratForm((f) => ({ ...f, entryCondition: e.target.value }))} style={{ gridColumn: '1 / -1' }} />
          <input className="input" placeholder="Exit condition * (e.g. RSI > 70 or 2% target)" value={stratForm.exitCondition} onChange={(e) => setStratForm((f) => ({ ...f, exitCondition: e.target.value }))} style={{ gridColumn: '1 / -1' }} />
          <input className="input" placeholder="Stop loss (e.g. 1.5%)" value={stratForm.stopLoss} onChange={(e) => setStratForm((f) => ({ ...f, stopLoss: e.target.value }))} />
          <input className="input" placeholder="Target (e.g. 3%)" value={stratForm.target} onChange={(e) => setStratForm((f) => ({ ...f, target: e.target.value }))} />
          <input className="input" type="number" placeholder="Capital (₹)" value={stratForm.capital} onChange={(e) => setStratForm((f) => ({ ...f, capital: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="input" value={stratForm.instrument} onChange={(e) => setStratForm((f) => ({ ...f, instrument: e.target.value }))} style={{ flex: 1 }}>
              {['NIFTY 50', 'BANK NIFTY', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'SBIN'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input" value={stratForm.timeframe} onChange={(e) => setStratForm((f) => ({ ...f, timeframe: e.target.value }))} style={{ width: 90 }}>
              {['5m', '15m', '30m', '1h', '1D'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={runStrategyValidation} disabled={loading.strategyValidation} style={{ marginBottom: 12 }}>
          {loading.strategyValidation ? 'Validating…' : 'Validate Strategy'}
        </button>
        {strategyReport ? (
          <div className="ai-markdown"><ReactMarkdown>{strategyReport}</ReactMarkdown></div>
        ) : (
          <div className="ai-strategy-placeholder" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--text-muted)', fontSize: 12 }}>
            <Gauge size={28} opacity={0.4} style={{ flexShrink: 0 }} />
            <p>Describe your setup above and the AI validator will grade edge, costs (STT/slippage), overfitting risk and give a PASS / CONDITIONAL / FAIL verdict.</p>
          </div>
        )}
      </AICard>
    </div>
  );
}
