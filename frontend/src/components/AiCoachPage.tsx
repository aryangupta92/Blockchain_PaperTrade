import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Award,
  BookOpen,
  CheckCircle2,
  Compass,
  GraduationCap,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface AiCoachPageProps {
  mode: AccountMode;
  onNavigate: (navId: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  providerUsed?: 'local-rag' | 'ollama' | 'gemini';
  sebiGuardrailTriggered?: boolean;
  citations?: Array<{ id: string; title: string; category: string }>;
  suggestedActions?: Array<{ label: string; targetNav: string }>;
  disclaimer?: string;
}

const STARTER_PROMPTS = [
  'I am a beginner — explain CNC vs MIS vs NRML in the Indian market',
  'What are the Finance Act 2026 STT rates and all trading charges?',
  'How do I calculate position size using the 1% risk rule?',
  'Explain Option Chain Greeks (Delta, Theta, Vega) and SEBI weekly expiry rules',
  'How does zero-look-ahead backtesting work in Strategy Lab?',
  'Review my trades and tell me if I am ready for REAL trading',
  'How do I trade Gold or Crude Oil in India (ETFs vs MCX)?',
  'How do I verify my trades on the SHA-256 blockchain?',
];

export function AiCoachPage({ mode, onNavigate }: AiCoachPageProps) {
  const [tab, setTab] = useState<'chat' | 'academy' | 'missions' | 'diagnostics'>('chat');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Namaste! I am your BlockTrade AI Trading Coach. Ask me anything about the Indian stock & commodity markets (NSE, BSE, MCX), F&O Greeks, Finance Act 2026 charges, position sizing, zero-bias strategy backtesting, or how to use any feature on this platform — and I can also review your personal trade diagnostics.\n\nNote: Under SEBI regulations, I provide structured education and process coaching only — never stock tips or buy/sell calls.',
      providerUsed: 'local-rag',
      suggestedActions: [
        { label: 'Open Strategy Lab & Backtest', targetNav: 'strategy-lab' },
        { label: 'Explore Live Markets (DEMO)', targetNav: 'overview' },
      ],
    },
  ]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);

  // Academy state
  const [modules, setModules] = useState<
    Array<{
      id: string;
      level: 'BEGINNER' | 'INTERMEDIATE' | 'PRO';
      title: string;
      durationMin: number;
      summary: string;
      lessons: Array<{ heading: string; body: string; indianExample: string }>;
      quiz: Array<{
        id: string;
        question: string;
        options: string[];
        correctIndex: number;
        explanation: string;
      }>;
      status: string;
      quizScore: number | null;
      completedAt: string | null;
    }>
  >([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number[]>>({});
  const [quizFeedback, setQuizFeedback] = useState<
    Record<
      string,
      {
        correct: number;
        total: number;
        scorePct: number;
        passed: boolean;
        feedback: Array<{ questionId: string; isCorrect: boolean; correctIndex: number; explanation: string }>;
      }
    >
  >({});
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  // Missions state
  const [missionsData, setMissionsData] = useState<{
    completedCount: number;
    totalCount: number;
    missions: Array<{
      id: string;
      title: string;
      description: string;
      completed: boolean;
      progressText: string;
      targetNav: string;
    }>;
  } | null>(null);

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof api.coachDiagnostics>> | null>(null);
  const [loadingAux, setLoadingAux] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadCoachData = useCallback(async () => {
    setLoadingAux(true);
    setErrorMsg(null);
    try {
      const [curr, miss, diag] = await Promise.all([
        api.coachCurriculum(),
        api.coachMissions(),
        api.coachDiagnostics(mode),
      ]);
      setModules(curr.modules);
      if (!selectedModuleId && curr.modules.length > 0) {
        setSelectedModuleId(curr.modules[0].id);
      }
      setMissionsData(miss);
      setDiagnostics(diag);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load AI Coach data');
    } finally {
      setLoadingAux(false);
    }
  }, [mode, selectedModuleId]);

  useEffect(() => {
    void loadCoachData();
  }, [loadCoachData]);

  const handleSend = async (promptOverride?: string) => {
    const q = (promptOverride ?? question).trim();
    if (!q || sending) return;
    setErrorMsg(null);
    setQuestion('');

    const nextHistory = messages
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setSending(true);

    try {
      const res = await api.coachChat({
        accountMode: mode,
        question: q,
        history: nextHistory,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
          providerUsed: res.providerUsed,
          sebiGuardrailTriggered: res.sebiGuardrailTriggered,
          citations: res.citations,
          suggestedActions: res.suggestedActions,
          disclaimer: res.disclaimer,
        },
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Coach chat failed');
    } finally {
      setSending(false);
    }
  };

  const handleSelectQuizAnswer = (moduleId: string, qIndex: number, optionIndex: number, totalQuestions: number) => {
    setQuizAnswers((prev) => {
      const current = prev[moduleId] ? [...prev[moduleId]] : Array(totalQuestions).fill(-1);
      current[qIndex] = optionIndex;
      return { ...prev, [moduleId]: current };
    });
  };

  const handleSubmitQuiz = async (moduleId: string, totalQuestions: number) => {
    const answers = quizAnswers[moduleId] || [];
    if (answers.length !== totalQuestions || answers.some((a) => a < 0)) {
      setErrorMsg('Please select an answer for every quiz question before submitting.');
      return;
    }
    setErrorMsg(null);
    setSubmittingQuiz(true);
    try {
      const res = await api.submitCoachQuiz(moduleId, answers);
      setQuizFeedback((prev) => ({ ...prev, [moduleId]: res }));
      await loadCoachData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Quiz submission failed');
    } finally {
      setSubmittingQuiz(false);
    }
  };

  const completedModulesCount = modules.filter((m) => m.status === 'COMPLETED').length;
  const activeModule = modules.find((m) => m.id === selectedModuleId) || modules[0] || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header Banner */}
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <GraduationCap size={20} color="var(--active-mode-accent)" />
            <h2 style={{ margin: 0, fontSize: 18 }}>AI Trading Coach &amp; Indian Market Academy</h2>
            <span className="badge badge-warn">SEBI Educational Only</span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Learn NSE/BSE/MCX mechanics, master risk management &amp; Finance Act 2026 charges, complete hands-on DEMO missions, and diagnose your live {mode} trade discipline.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge badge-gain">
            Academy: {completedModulesCount}/{modules.length || 6}
          </span>
          <span className="badge badge-warn">
            Missions: {missionsData ? `${missionsData.completedCount}/${missionsData.totalCount}` : '0/5'}
          </span>
          <span className="badge">
            Readiness: {diagnostics ? `${diagnostics.readinessScore}/100` : '--'}
          </span>
          <button
            className="preset-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={loadCoachData}
            disabled={loadingAux}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </section>

      {/* Sub-navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className={tab === 'chat' ? 'btn-primary' : 'preset-btn'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setTab('chat')}
        >
          <MessageSquare size={14} /> AI Coach Chat
        </button>
        <button
          className={tab === 'academy' ? 'btn-primary' : 'preset-btn'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setTab('academy')}
        >
          <BookOpen size={14} /> Beginner-to-Pro Academy ({completedModulesCount}/{modules.length || 6})
        </button>
        <button
          className={tab === 'missions' ? 'btn-primary' : 'preset-btn'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setTab('missions')}
        >
          <Target size={14} /> Practice Missions ({missionsData ? `${missionsData.completedCount}/${missionsData.totalCount}` : '0/5'})
        </button>
        <button
          className={tab === 'diagnostics' ? 'btn-primary' : 'preset-btn'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setTab('diagnostics')}
        >
          <Activity size={14} /> My {mode} Diagnostics
        </button>
      </div>

      {errorMsg && <div className="alert-error">{errorMsg}</div>}

      {/* TAB 1: AI COACH CHAT */}
      {tab === 'chat' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 14,
            alignItems: 'start',
          }}
        >
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>
                <Sparkles size={15} /> Ask Your Indian Market &amp; Platform Coach
              </h3>
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Context: {mode} Account
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: 460,
                overflowY: 'auto',
                padding: 12,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
              }}
            >
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '90%',
                    padding: '10px 13px',
                    borderRadius: 10,
                    background: m.role === 'user' ? 'var(--active-mode-accent)' : 'var(--bg-surface)',
                    color: m.role === 'user' ? '#0b0f17' : 'var(--text-primary)',
                    fontWeight: m.role === 'user' ? 600 : 400,
                    border: m.role === 'assistant' ? '1px solid var(--border-strong)' : 'none',
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  {m.sebiGuardrailTriggered && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 8,
                        padding: '5px 8px',
                        borderRadius: 6,
                        background: 'rgba(245, 158, 11, 0.14)',
                        color: 'var(--warn)',
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                    >
                      <ShieldAlert size={14} /> SEBI Compliance Guardrail Active — Educational Framework Only
                    </div>
                  )}

                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>

                  {m.citations && m.citations.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {m.citations.map((c) => (
                        <span
                          key={c.id}
                          style={{
                            fontSize: 10.5,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: 'var(--bg-elevated)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          Source: {c.title}
                        </span>
                      ))}
                    </div>
                  )}

                  {m.suggestedActions && m.suggestedActions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {m.suggestedActions.map((act, aIdx) => (
                        <button
                          key={aIdx}
                          className="preset-btn"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, padding: '4px 9px' }}
                          onClick={() => onNavigate(act.targetNav)}
                        >
                          <Compass size={12} /> {act.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {m.role === 'assistant' && m.providerUsed && (
                    <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-muted)' }}>
                      Engine: <span className="mono">{m.providerUsed}</span>
                      {m.disclaimer ? ` • ${m.disclaimer}` : ''}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 8px' }}>
                  Coach is analyzing Indian market rules &amp; your {mode} history...
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Ask anything: e.g. 'Explain Option Greeks', 'Finance Act 2026 STT charges', 'Review my trades'..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={sending}
              />
              <button type="submit" className="btn-primary" disabled={sending || question.trim().length < 2}>
                <Send size={14} /> Ask Coach
              </button>
            </form>
          </section>

          {/* Starter Prompts & Custom Model Note */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <section className="card">
              <h3>Quick Beginner &amp; Platform Questions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {STARTER_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    className="preset-btn"
                    style={{ textAlign: 'left', fontSize: 12, lineHeight: 1.35, padding: '7px 10px' }}
                    onClick={() => void handleSend(p)}
                    disabled={sending}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>

            <section className="card" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <h3>SEBI Guardrail &amp; Custom Model</h3>
              <p style={{ margin: '0 0 8px' }}>
                Try asking <em>&quot;Should I buy RELIANCE today?&quot;</em> to verify the hard SEBI Investment Adviser compliance guardrail.
              </p>
              <p style={{ margin: 0 }}>
                Runs out-of-the-box with zero-cost <strong>Local RAG</strong> on CPU, or plugs directly into your custom fine-tuned QLoRA model via <strong>Ollama</strong> (<code className="mono">ai-coach-training/</code>) or Gemini via <code className="mono">AI_COACH_PROVIDER</code>.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: BEGINNER-TO-PRO ACADEMY */}
      {tab === 'academy' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
            gap: 14,
            alignItems: 'start',
          }}
        >
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3>6-Module Indian Market Curriculum</h3>
            {modules.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedModuleId(m.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: m.id === activeModule?.id ? '1.5px solid var(--active-mode-accent)' : '1px solid var(--border-subtle)',
                  background: m.id === activeModule?.id ? 'var(--bg-elevated)' : 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span
                    className={`badge ${
                      m.level === 'BEGINNER' ? 'badge-gain' : m.level === 'INTERMEDIATE' ? 'badge-warn' : ''
                    }`}
                  >
                    {m.level}
                  </span>
                  {m.status === 'COMPLETED' ? (
                    <span style={{ fontSize: 11, color: 'var(--gain)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle2 size={13} /> {m.quizScore ?? 100}%
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.durationMin} min</span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</div>
              </button>
            ))}
          </section>

          {activeModule && (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, gridColumn: 'span 2' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 16.5 }}>{activeModule.title}</h2>
                  <span className={`badge ${activeModule.status === 'COMPLETED' ? 'badge-gain' : 'badge-warn'}`}>
                    {activeModule.status === 'COMPLETED' ? `Completed (${activeModule.quizScore}%)` : 'In Progress'}
                  </span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{activeModule.summary}</p>
              </div>

              {activeModule.lessons.map((lesson, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
                    {idx + 1}. {lesson.heading}
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.55 }}>{lesson.body}</p>
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg-surface)',
                      borderLeft: '3px solid var(--active-mode-accent)',
                      fontSize: 12.5,
                    }}
                  >
                    <strong>Indian Market Example:</strong> {lesson.indianExample}
                  </div>
                </div>
              ))}

              {/* Interactive Quiz */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                <h3>
                  <Award size={15} /> Knowledge Check Quiz (Pass ≥50% to Complete Module)
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeModule.quiz.map((q, qIdx) => {
                    const selected = quizAnswers[activeModule.id]?.[qIdx] ?? -1;
                    const fb = quizFeedback[activeModule.id]?.feedback.find((f) => f.questionId === q.id);
                    return (
                      <div key={q.id} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                          Q{qIdx + 1}. {q.question}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {q.options.map((opt, optIdx) => (
                            <label
                              key={optIdx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 12.5,
                                cursor: 'pointer',
                                padding: '5px 8px',
                                borderRadius: 6,
                                background: selected === optIdx ? 'var(--bg-elevated)' : 'transparent',
                              }}
                            >
                              <input
                                type="radio"
                                name={`${activeModule.id}-${q.id}`}
                                checked={selected === optIdx}
                                onChange={() =>
                                  handleSelectQuizAnswer(activeModule.id, qIdx, optIdx, activeModule.quiz.length)
                                }
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                        {fb && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: '7px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              background: fb.isCorrect ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                              color: fb.isCorrect ? 'var(--gain)' : 'var(--loss)',
                            }}
                          >
                            <strong>{fb.isCorrect ? 'Correct!' : 'Not quite.'}</strong> {fb.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary"
                    disabled={submittingQuiz}
                    onClick={() => void handleSubmitQuiz(activeModule.id, activeModule.quiz.length)}
                  >
                    {submittingQuiz ? 'Grading...' : 'Submit Quiz & Save Progress'}
                  </button>
                  {quizFeedback[activeModule.id] && (
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: quizFeedback[activeModule.id].passed ? 'var(--gain)' : 'var(--loss)',
                      }}
                    >
                      Score: {quizFeedback[activeModule.id].correct}/{quizFeedback[activeModule.id].total} (
                      {quizFeedback[activeModule.id].scorePct}%) —{' '}
                      {quizFeedback[activeModule.id].passed ? 'Module Completed!' : 'Try Again'}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* TAB 3: PRACTICE MISSIONS */}
      {tab === 'missions' && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>
                Hands-On DEMO Practice Missions (Auto-Verified Against Your Live Database)
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Complete all 5 guided milestones in DEMO mode so you understand every Indian market workflow before touching REAL capital.
              </p>
            </div>
            <span className="badge badge-gain">
              {missionsData ? `${missionsData.completedCount} / ${missionsData.totalCount} Completed` : 'Loading...'}
            </span>
          </div>

          <div style={{ width: '100%', height: 10, borderRadius: 999, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${missionsData && missionsData.totalCount > 0 ? (missionsData.completedCount / missionsData.totalCount) * 100 : 0}%`,
                height: '100%',
                background: 'var(--gain)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(missionsData?.missions || []).map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: 14,
                  borderRadius: 8,
                  border: `1px solid ${m.completed ? 'var(--gain)' : 'var(--border-subtle)'}`,
                  background: 'var(--bg-elevated)',
                }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5 }}>
                    <CheckCircle2 size={16} color={m.completed ? 'var(--gain)' : 'var(--text-muted)'} />
                    <span>{m.title}</span>
                    <span className={`badge ${m.completed ? 'badge-gain' : 'badge-warn'}`}>
                      {m.completed ? 'DONE' : 'PENDING'}
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 4px', fontSize: 12.5, color: 'var(--text-secondary)' }}>{m.description}</p>
                  <div style={{ fontSize: 11.5, color: m.completed ? 'var(--gain)' : 'var(--text-muted)' }}>
                    {m.progressText}
                  </div>
                </div>
                {m.targetNav !== 'ai-coach' ? (
                  <button className="btn-primary" onClick={() => onNavigate(m.targetNav)}>
                    Go Practice
                  </button>
                ) : (
                  <button className="btn-primary" onClick={() => setTab('academy')}>
                    Open Academy
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 4: MY TRADING DIAGNOSTICS */}
      {tab === 'diagnostics' && diagnostics && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{diagnostics.accountMode} → REAL Readiness Score</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Objective behavioral audit of your trade sample, Reward:Risk ratio, Finance Act 2026 fee drag, Stop-Loss usage, and overtrading discipline.
                </p>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color:
                    diagnostics.readinessScore >= 75
                      ? 'var(--gain)'
                      : diagnostics.readinessScore >= 45
                        ? 'var(--warn)'
                        : 'var(--loss)',
                }}
              >
                {diagnostics.readinessScore} / 100
              </div>
            </div>

            <div style={{ width: '100%', height: 12, borderRadius: 999, background: 'var(--bg-elevated)', marginTop: 10, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${diagnostics.readinessScore}%`,
                  height: '100%',
                  background:
                    diagnostics.readinessScore >= 75
                      ? 'var(--gain)'
                      : diagnostics.readinessScore >= 45
                        ? 'var(--warn)'
                        : 'var(--loss)',
                }}
              />
            </div>

            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg-elevated)',
                fontSize: 13,
              }}
            >
              <strong>Coach Next Step:</strong> {diagnostics.nextStepAdvice}
            </div>
          </section>

          <div className="card-grid">
            <div className="card">
              <h3>Executed Trades / Round-Trips</h3>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {diagnostics.totalTrades} / {diagnostics.closedRoundTrips}
              </div>
            </div>
            <div className="card">
              <h3>Win Rate &amp; Reward:Risk</h3>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {diagnostics.winRatePct}% · {diagnostics.rewardToRiskRatio}:1
              </div>
            </div>
            <div className="card">
              <h3>Net Realized P&amp;L (After Charges)</h3>
              <div
                className="mono"
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: Number(diagnostics.netRealizedPnl) >= 0 ? 'var(--gain)' : 'var(--loss)',
                }}
              >
                {formatINR(diagnostics.netRealizedPnl)}
              </div>
            </div>
            <div className="card">
              <h3>Fee Drag % / Total Charges</h3>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--warn)' }}>
                {diagnostics.chargesDragPct}% ({formatINR(diagnostics.totalChargesPaid)})
              </div>
            </div>
            <div className="card">
              <h3>Avg Win / Avg Loss</h3>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
                {formatINR(diagnostics.avgWinINR)} / {formatINR(diagnostics.avgLossINR)}
              </div>
            </div>
            <div className="card">
              <h3>Stop-Loss Order Usage</h3>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
                {diagnostics.stopLossUsagePct}%
              </div>
            </div>
            <div className="card">
              <h3>Max Trades in Single Day</h3>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
                {diagnostics.maxTradesInSingleDay}
              </div>
            </div>
            <div className="card">
              <h3>Revenge-Trading Flags (&lt;5m re-entry)</h3>
              <div
                className="mono"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: diagnostics.revengeTradeFlags > 0 ? 'var(--loss)' : 'var(--gain)',
                }}
              >
                {diagnostics.revengeTradeFlags}
              </div>
            </div>
          </div>

          <div className="card-grid">
            <section className="card">
              <h3 style={{ color: 'var(--gain)' }}>Your Strengths</h3>
              {diagnostics.strengths.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0 }}>
                  Start practicing structured DEMO trades with Stop-Loss orders to build verified strengths.
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  {diagnostics.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h3 style={{ color: 'var(--warn)' }}>Key Focus Areas to Improve</h3>
              {diagnostics.improvements.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--gain)', margin: 0 }}>
                  No major behavioral red flags detected in your current epoch!
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  {diagnostics.improvements.map((imp, i) => (
                    <li key={i}>{imp}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
