import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BookOpen, Calendar, Eye, EyeOff, Plus, RefreshCw, Share2, Trash2 } from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface TradersDiaryPageProps {
  mode: AccountMode;
}

export function TradersDiaryPage({ mode }: TradersDiaryPageProps) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.diarySummary>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [hideRupees, setHideRupees] = useState(false);
  const [copiedCard, setCopiedCard] = useState(false);

  // Add Journal Note Form
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10));
  const [symbol, setSymbol] = useState('');
  const [setupTag, setSetupTag] = useState('VWAP Breakout');
  const [emotionTag, setEmotionTag] = useState('Calm & Disciplined');
  const [mistakeTag, setMistakeTag] = useState('');
  const [rating, setRating] = useState(4);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.diarySummary(mode);
      setData(res);
    } finally {
      setBusy(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) return;
    await api.addDiaryNote({
      tradeDate,
      symbol: symbol.trim() || undefined,
      setupTag: setupTag.trim() || undefined,
      emotionTag: emotionTag.trim() || undefined,
      mistakeTag: mistakeTag.trim() || undefined,
      rating,
      notes: notes.trim(),
    });
    setNotes('');
    setSymbol('');
    await load();
  };

  const mask = (v: string | number) => (hideRupees ? '••••' : formatINR(v));

  const handleShareText = () => {
    if (!data) return;
    const k = data.kpis;
    const summary = `BlockTrade ${mode} Trader's Diary | Net P&L: ${hideRupees ? 'Hidden' : formatINR(k.netRealizedPnl)} | Win Rate: ${k.winRatePct}% | Profit Factor: ${k.profitFactor} | Trades: ${k.closedRoundTrips}`;
    navigator.clipboard?.writeText(summary).catch(() => {});
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2000);
  };

  const k = data?.kpis;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header + Shareable P&L Privacy Controls */}
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={18} color="var(--active-mode-accent)" />
          <strong style={{ fontSize: 16 }}>Trader&apos;s Diary &amp; Performance Analytics ({mode})</strong>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="preset-btn" onClick={() => setHideRupees((v) => !v)}>
            {hideRupees ? <Eye size={13} /> : <EyeOff size={13} />} {hideRupees ? 'Show ₹' : 'Privacy Hide ₹'}
          </button>
          <button className="preset-btn" onClick={handleShareText}>
            <Share2 size={13} /> {copiedCard ? 'Copied Card!' : 'Copy Shareable P&L'}
          </button>
          <button className="theme-toggle" onClick={load} disabled={busy}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </section>

      {/* KPI Strip */}
      {k && (
        <div className="card-grid">
          <div className="card">
            <h3>Net Realized P&amp;L</h3>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: Number(k.netRealizedPnl) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {mask(k.netRealizedPnl)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
              Gross: {mask(k.grossRealizedPnl)} · Charges: {mask(k.totalCharges)}
            </div>
          </div>
          <div className="card">
            <h3>Win Rate &amp; Profit Factor</h3>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: '#38bdf8' }}>
              {k.winRatePct}% · PF {k.profitFactor}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
              {k.closedRoundTrips} closed round-trips ({k.totalExecutions} fills)
            </div>
          </div>
          <div className="card">
            <h3>Expectancy / Trade</h3>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: Number(k.expectancy) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {mask(k.expectancy)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
              Avg Win: {mask(k.avgWin)} · Avg Loss: {mask(k.avgLoss)}
            </div>
          </div>
          <div className="card">
            <h3>Max Drawdown &amp; Streaks</h3>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--loss)' }}>
              -{mask(k.maxDrawdown)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
              Max Win Streak: {k.maxWinStreak} · Max Loss Streak: {k.maxLossStreak}
            </div>
          </div>
        </div>
      )}

      {/* Calendar P&L Heatmap + Cumulative Equity Curve */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <section className="card">
          <h3><Calendar size={15} /> Daily P&amp;L Calendar Heatmap</h3>
          {!data || data.calendar.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Complete a trade to populate your daily P&amp;L calendar heatmap.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: 7 }}>
              {data.calendar.map((day) => {
                const pos = day.netPnl >= 0;
                return (
                  <div
                    key={day.date}
                    style={{
                      padding: 9,
                      borderRadius: 8,
                      background: pos ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)',
                      border: `1px solid ${pos ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
                    }}
                  >
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{day.date}</div>
                    <div className="mono" style={{ fontSize: 13.5, fontWeight: 800, color: pos ? 'var(--gain)' : 'var(--loss)', marginTop: 2 }}>
                      {mask(day.netPnl)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{day.tradesCount} round-trip(s)</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Cumulative Net P&amp;L Equity Curve &amp; Hourly Edge</h3>
          {!data || data.equityCurve.length < 2 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>At least 2 closed trades needed to plot equity curve.</div>
          ) : (
            (() => {
              const pts = data.equityCurve;
              const W = 420, H = 140, pad = 16;
              const ys = pts.map((p) => p.cumulativeNetPnl);
              const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
              const spanY = Math.max(1, maxY - minY);
              const sx = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
              const sy = (v: number) => H - pad - ((v - minY) / spanY) * (H - pad * 2);
              const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.cumulativeNetPnl).toFixed(1)}`).join(' ');
              return (
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 150, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} stroke="#64748b" strokeDasharray="3 3" />
                  <path d={d} fill="none" stroke={ys[ys.length - 1] >= 0 ? '#10b981' : '#ef4444'} strokeWidth={2.2} />
                </svg>
              );
            })()
          )}
          {data && data.hourlyBreakdown.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {data.hourlyBreakdown.map((h) => (
                <span key={h.hour} className={`badge ${h.netPnl >= 0 ? 'badge-gain' : 'badge-warn'}`}>
                  {String(h.hour).padStart(2, '0')}:00 IST · {mask(h.netPnl)} ({h.count})
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Trade Psychology & Setup Journal */}
      <section className="card">
        <h3>Trade Journal Notes (Setup, Emotion &amp; Mistake Tagging)</h3>
        <form onSubmit={handleAddNote} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
          <input className="input" type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
          <input className="input" placeholder="Symbol (optional)" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <input className="input" placeholder="Setup tag" value={setupTag} onChange={(e) => setSetupTag(e.target.value)} />
          <input className="input" placeholder="Emotion tag" value={emotionTag} onChange={(e) => setEmotionTag(e.target.value)} />
          <input className="input" placeholder="Mistake tag (if any)" value={mistakeTag} onChange={(e) => setMistakeTag(e.target.value)} />
          <select className="input" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>Discipline {r}/5 ★</option>)}
          </select>
          <input className="input" style={{ gridColumn: '1 / -2' }} placeholder="Write lesson learned, execution review, or psychology reflection..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn-primary" type="submit"><Plus size={14} /> Log Note</button>
        </form>

        {!data || data.notes.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No journal entries yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.notes.map((n) => (
              <div key={n.id} style={{ padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    <strong className="mono">{n.tradeDate}</strong>
                    {n.symbol && <span className="badge">{n.symbol}</span>}
                    {n.setupTag && <span className="badge badge-gain">{n.setupTag}</span>}
                    {n.emotionTag && <span className="badge">{n.emotionTag}</span>}
                    {n.mistakeTag && <span className="badge badge-warn">{n.mistakeTag}</span>}
                    {n.rating && <span style={{ fontSize: 11.5, color: 'var(--warn)' }}>{'★'.repeat(n.rating)}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{n.notes}</div>
                </div>
                <button className="preset-btn" style={{ color: 'var(--loss)', alignSelf: 'flex-start' }} onClick={async () => { await api.deleteDiaryNote(n.id); load(); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
