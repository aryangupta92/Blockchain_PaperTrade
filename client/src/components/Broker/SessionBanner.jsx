import { useEffect, useState } from 'react';
import api from '../../services/api';
import './Kite.css';

function fmtCountdown(sec) {
  if (sec == null || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// MIS auto square-off at 15:15 IST — show live countdown like Zerodha/Upstox
function misCountdown() {
  try {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const day = ist.getUTCDay();
    if (day < 1 || day > 5) return null;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const target = 15 * 60 + 15;
    if (mins >= target) return 'MIS square-off due — intraday positions will auto-exit';
    const diffMin = target - mins;
    const hh = Math.floor(diffMin / 60);
    const mm = diffMin % 60;
    return `MIS auto square-off in ${hh > 0 ? hh + 'h ' : ''}${mm}m (15:15 IST)`;
  } catch { return null; }
}

export default function SessionBanner() {
  const [session, setSession] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.getSession().then(s => { if (alive) setSession(s); }).catch(() => {});
    const iv = setInterval(() => {
      api.getSession().then(s => { if (alive) setSession(s); }).catch(() => {});
      setTick(t => t + 1);
    }, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const label = session?.session || '—';
  const color = label === 'OPEN' ? '#10b981' : label === 'PRE_OPEN' ? '#f59e0b' : '#64748b';
  const mis = misCountdown();

  return (
    <div className="kite-session">
      <span className="dot" style={{ background: color }} />
      <span>
        {label === 'OPEN' && 'Market Open · Live trading (09:15–15:30 IST)'}
        {label === 'PRE_OPEN' && 'Pre-open (09:00–09:15 IST) · AMO accepted, queued for 09:15'}
        {label === 'POST_CLOSE' && 'Post-close (15:30–16:00 IST) · AMO accepted for next session'}
        {label === 'WEEKEND' && 'Market Closed · Weekend — AMO accepted for Monday 09:15'}
        {label === 'PRE_MARKET_CLOSED' && 'Market Closed · Opens 09:00 IST — AMO accepted'}
        {label === 'CLOSED' && 'Market Closed · AMO accepted, queued for next 09:15 open'}
        {label === '—' && 'Checking market session…'}
      </span>
      {session?.countdownSec != null && label === 'OPEN' && (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          · Closes in {fmtCountdown(session.countdownSec)}
        </span>
      )}
      {session?.countdownSec != null && label !== 'OPEN' && label !== '—' && (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          · Opens in {fmtCountdown(session.countdownSec)}
        </span>
      )}
      {mis && label === 'OPEN' && (
        <span className="kite-amo-badge" title="MIS positions auto-squared-off at 15:15 IST like real brokers">⚠ {mis}</span>
      )}
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
        NSE · BSE · AMO anytime · MIS SQ-OFF 15:15
      </span>
    </div>
  );
}
