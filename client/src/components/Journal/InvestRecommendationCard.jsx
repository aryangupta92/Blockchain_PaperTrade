import { useState } from 'react';
import api from '../../services/api';
import { Compass, RefreshCw, ShieldAlert } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

/**
 * InvestRecommendationCard — "Trade Journal recommendation model:
 *  where should the person invest, with complete knowledge."
 * Hybrid: journal persona + trade win-rate + live sector momentum.
 */
export default function InvestRecommendationCard({ showToast }) {
  const [data, setData] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReco = async () => {
    setLoading(true);
    try {
      const res = await api.getInvestRecommendation();
      setData(res.recommendation);
      setAiSummary(res.aiSummary || null);
      showToast?.('Recommendation refreshed', 'success');
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ padding: 20, marginBottom: 20, border: '1px solid rgba(16,185,129,0.35)', background: 'linear-gradient(180deg, rgba(16,185,129,0.07), transparent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
          <Compass size={18} style={{ color: 'var(--gain)' }} /> Where should I invest?
        </h3>
        <button className="btn btn-outline" onClick={fetchReco} disabled={loading} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'Scoring…' : data ? 'Refresh' : 'Get recommendation'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Blends your journal persona + trade win-rate with live sector momentum. Educational — not investment advice.
      </div>

      {!data && !loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>One click scores 12 segments (Banking, IT, Pharma, Intraday, F&amp;O, Delivery…) against your own history.</div>
      ) : null}
      {loading && !data ? <div className="spinner" style={{ margin: '12px auto' }} /> : null}

      {data ? (
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '1 1 220px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Top pick · {(data.confidence * 100).toFixed(0)}% confidence</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gain)' }}>{data.topPick.segment}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{data.topPick.evidence}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                <span>skill {data.topPick.skill}</span><span>market {data.topPick.market}</span><span>fit {data.topPick.temperamentFit}</span>
              </div>
            </div>
            <div style={{ flex: '1 1 220px', background: 'var(--bg-layer)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Your persona</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>🎭 {data.persona}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{data.personaDescription}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{data.dataStats.trades} trades · {data.dataStats.journals} journals · rating {data.dataStats.avgRating}/5</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {data.ranking.slice(0, 8).map((r, i) => (
              <span key={r.segment} title={`skill ${r.skill} · market ${r.market} · fit ${r.temperamentFit}`} style={{
                fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
                background: i === 0 ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${i === 0 ? 'rgba(16,185,129,0.5)' : 'var(--border)'}`,
                color: i === 0 ? 'var(--gain)' : 'var(--text-secondary)',
              }}>#{i + 1} {r.segment} · {r.score}</span>
            ))}
          </div>

          {(data.riskNotes?.length) ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
              <ShieldAlert size={15} style={{ color: 'var(--loss)', flexShrink: 0, marginTop: 1 }} />
              <div>{data.riskNotes.map((n, i) => <div key={i} style={{ marginBottom: 4 }}>⚠️ {n}</div>)}</div>
            </div>
          ) : null}

          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 700 }}>Next actions</div>
          <ol style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 18, margin: '0 0 8px 0', lineHeight: 1.6 }}>
            {data.plan.map((p, i) => <li key={i}>{p}</li>)}
          </ol>

          {aiSummary ? (
            <div style={{ marginTop: 10, padding: 12, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, fontSize: 13 }}>
              <div style={{ fontWeight: 800, marginBottom: 6, color: 'var(--accent-primary)' }}>🤖 Coach's take</div>
              <ReactMarkdown>{aiSummary}</ReactMarkdown>
            </div>
          ) : null}
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>{data.disclaimer}</div>
        </div>
      ) : null}
    </div>
  );
}
