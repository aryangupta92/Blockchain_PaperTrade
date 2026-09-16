import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { Target, BarChart2, Zap, Brain, TrendingUp, TrendingDown, RefreshCw, User, Link } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function JournalPage({ showToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState({ 
    title: '', setup: '', thesis: '', mistakes: '', learnings: '', rating: 3,
    emotionOnEntry: 'Neutral', emotionOnExit: 'Neutral', marketCondition: 'TRENDING',
    riskRewardPlanned: '', riskRewardActual: ''
  });
  
  // AI Coach state
  const [aiFeedback, setAiFeedback] = useState({});
  const [coachLoading, setCoachLoading] = useState({});
  
  // Bias Coach state
  const [biasReport, setBiasReport] = useState(null);
  const [biasLoading, setBiasLoading] = useState(false);

  // Recent trades for journal linker
  const [recentTrades, setRecentTrades] = useState([]);

  useEffect(() => {
    fetchEntries();
    api.getTrades(20, 0).then(d => setRecentTrades(d.trades || [])).catch(() => {});
  }, []);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const data = await api.getJournalEntries();
      setEntries(data.entries || []);
    } catch (err) {
      showToast('Failed to load journal entries', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api.createJournalEntry({
        ...formData,
        riskRewardPlanned: Number(formData.riskRewardPlanned) || null,
        riskRewardActual: Number(formData.riskRewardActual) || null
      });
      showToast('Journal entry saved!', 'success');
      setShowModal(false);
      fetchEntries();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const getAiFeedback = async (id) => {
    setCoachLoading(prev => ({ ...prev, [id]: true }));
    try {
      const res = await api.getJournalFeedback(id);
      setAiFeedback(prev => ({ ...prev, [id]: res.feedback }));
    } catch (err) {
      showToast('Failed to get AI feedback', 'error');
    } finally {
      setCoachLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const getBiasCoachReport = async () => {
    if (entries.length < 3) {
      showToast('Add at least 3 journal entries before running Bias Coach analysis.', 'error');
      return;
    }
    setBiasLoading(true);
    try {
      const res = await api.getAIBiasCoach();
      setBiasReport(res.report);
      showToast('Bias analysis complete!', 'success');
    } catch (err) {
      showToast('Failed to get Bias Coach report', 'error');
    } finally {
      setBiasLoading(false);
    }
  };

  const emotions = ['Confident', 'FOMO', 'Anxious', 'Greedy', 'Fearful', 'Neutral', 'Revenge Trade', 'Disciplined'];
  const marketConditions = ['TRENDING', 'RANGING', 'VOLATILE', 'NEWS_DRIVEN'];

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart2 size={24} style={{ color: 'var(--accent-primary)' }} /> Trade Journal
          </h2>
          <p className="text-muted" style={{ marginTop: 4 }}>Document trades and analyze behavioral biases</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button 
            className="btn btn-outline" 
            onClick={getBiasCoachReport}
            disabled={biasLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
          >
            <Brain size={16} className={biasLoading ? 'spin' : ''} />
            {biasLoading ? 'Analyzing...' : 'AI Bias Coach'}
          </button>
          <button className="btn btn-primary" onClick={() => { 
            setFormData({ title: '', setup: '', thesis: '', mistakes: '', learnings: '', rating: 3, emotionOnEntry: 'Neutral', emotionOnExit: 'Neutral', marketCondition: 'TRENDING', riskRewardPlanned: '', riskRewardActual: '' }); 
            setShowModal(true); 
          }}>
            + New Entry
          </button>
        </div>
      </div>

      {/* Bias Coach Report Card */}
      {biasReport && (
        <div className="card" style={{ padding: 24, marginBottom: 24, background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)', marginBottom: 16 }}>
            <Brain size={20} /> AI Behavioral Pattern Analysis
          </h3>

          {/* Trader Persona Card */}
          {biasReport.persona && (
            <div style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <User size={24} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>Your Trader Persona</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-primary)', marginBottom: 4 }}>🎭 {biasReport.persona}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{biasReport.personaDescription}</div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
            <div>
              <h4 style={{ color: 'var(--loss)', marginBottom: 8 }}>⚠️ Identified Biases</h4>
              <ul style={{ paddingLeft: 20, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6 }}>
                {(biasReport.biases || []).map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
            <div>
              <h4 style={{ color: 'var(--gain)', marginBottom: 8 }}>✅ Strengths</h4>
              <ul style={{ paddingLeft: 20, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6 }}>
                {(biasReport.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div>
              <h4 style={{ color: '#f59e0b', marginBottom: 8 }}>🎯 Recommendations</h4>
              <ul style={{ paddingLeft: 20, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6 }}>
                {(biasReport.recommendations || []).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {loading ? (
          <div className="spinner" style={{ margin: '40px auto' }} />
        ) : entries.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No journal entries yet. Start logging your trades!
          </div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: 18, color: 'var(--text-primary)' }}>{entry.title}</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    <span style={{ padding: '2px 6px', background: 'var(--bg-layer)', borderRadius: 4 }}>Rating: {entry.rating}/5</span>
                    <span style={{ padding: '2px 6px', background: 'var(--bg-layer)', borderRadius: 4 }}>{entry.marketCondition}</span>
                  </div>
                </div>
                <button 
                  className="btn btn-outline" 
                  onClick={() => getAiFeedback(entry.id)}
                  disabled={coachLoading[entry.id]}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  {coachLoading[entry.id] ? 'Analyzing...' : '🤖 Ask AI Coach'}
                </button>
              </div>

              {/* Tags Row */}
              <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Emotions:</span>
                  <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 12 }}>IN: {entry.emotionOnEntry || 'Neutral'}</span>
                  <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 12 }}>OUT: {entry.emotionOnExit || 'Neutral'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>R:R:</span>
                  <span style={{ color: 'var(--text-primary)' }}>Planned 1:{entry.riskRewardPlanned || '-'}</span>
                  <span style={{ color: 'var(--text-primary)' }}>Actual 1:{entry.riskRewardActual || '-'}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, background: 'var(--bg-layer)', padding: 16, borderRadius: 8 }}>
                <div>
                  <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Setup & Thesis</h4>
                  <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--text-primary)' }}><strong>Setup:</strong> {entry.setup || '-'}</p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}><strong>Thesis:</strong> {entry.thesis || '-'}</p>
                </div>
                <div>
                  <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Review</h4>
                  <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--text-primary)' }}><strong>Mistakes:</strong> {entry.mistakes || '-'}</p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}><strong>Learnings:</strong> {entry.learnings || '-'}</p>
                </div>
              </div>

              {aiFeedback[entry.id] && (
                <div style={{ marginTop: 8, padding: 16, background: 'rgba(99, 102, 241, 0.1)', border: '1px solid var(--accent-primary)', borderRadius: 8 }}>
                  <h4 style={{ margin: '0 0 12px 0', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    🤖 Entry Feedback
                  </h4>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                    <ReactMarkdown>{aiFeedback[entry.id]}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: 700, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 18 }}>New Journal Entry</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Title</label>
                <input className="input-field" style={{ width: '100%' }} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="e.g., Nifty Breakout Trade" />
              </div>

              {/* Trade Linker */}
              {recentTrades.length > 0 && (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Link size={11} /> Link to a Trade (optional)
                  </label>
                  <select className="input-field" style={{ width: '100%' }} value={formData.tradeId || ''} onChange={e => setFormData({...formData, tradeId: e.target.value || null})}>
                    <option value="">— No trade linked —</option>
                    {recentTrades.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.side?.toUpperCase()} {t.quantity} × {t.instrument?.tradingSymbol || 'Unknown'} @ ₹{Number(t.price).toLocaleString('en-IN')} ({new Date(t.executedAt).toLocaleDateString('en-IN')})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Market Condition</label>
                  <select className="input-field" style={{ width: '100%' }} value={formData.marketCondition} onChange={e => setFormData({...formData, marketCondition: e.target.value})}>
                    {marketConditions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Emotion on Entry</label>
                  <select className="input-field" style={{ width: '100%' }} value={formData.emotionOnEntry} onChange={e => setFormData({...formData, emotionOnEntry: e.target.value})}>
                    {emotions.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Emotion on Exit</label>
                  <select className="input-field" style={{ width: '100%' }} value={formData.emotionOnExit} onChange={e => setFormData({...formData, emotionOnExit: e.target.value})}>
                    {emotions.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Risk:Reward (Planned) e.g., 2 for 1:2</label>
                  <input type="number" className="input-field" style={{ width: '100%' }} value={formData.riskRewardPlanned} onChange={e => setFormData({...formData, riskRewardPlanned: e.target.value})} placeholder="e.g., 2" />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Risk:Reward (Actual) e.g., 1.5</label>
                  <input type="number" className="input-field" style={{ width: '100%' }} value={formData.riskRewardActual} onChange={e => setFormData({...formData, riskRewardActual: e.target.value})} placeholder="e.g., 1.5" />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Setup / Strategy</label>
                <input className="input-field" style={{ width: '100%' }} value={formData.setup} onChange={e => setFormData({...formData, setup: e.target.value})} placeholder="e.g., ORB, Pullback to 20EMA" />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Thesis (Why did you take it?)</label>
                <textarea className="input-field" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={formData.thesis} onChange={e => setFormData({...formData, thesis: e.target.value})} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Mistakes Made</label>
                  <textarea className="input-field" style={{ width: '100%', minHeight: 60 }} value={formData.mistakes} onChange={e => setFormData({...formData, mistakes: e.target.value})} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Key Learnings</label>
                  <textarea className="input-field" style={{ width: '100%', minHeight: 60 }} value={formData.learnings} onChange={e => setFormData({...formData, learnings: e.target.value})} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>Execution Rating (1-5)</label>
                <input type="range" min="1" max="5" value={formData.rating} onChange={e => setFormData({...formData, rating: Number(e.target.value)})} style={{ width: '100%' }} />
                <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 'bold' }}>{formData.rating} / 5</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
