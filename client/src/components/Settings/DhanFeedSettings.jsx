import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Radio, ExternalLink, CheckCircle2, XCircle, RefreshCw, KeyRound } from 'lucide-react';

/**
 * DhanFeedSettings - real-data login + live feed health.
 * Replaces the old "it just works (or shows fake prices)" situation with an
 * explicit, actionable panel:
 *   live tick count, last-tick age, rate-limit budget, instrument master state.
 */
export default function DhanFeedSettings({ pushToast }) {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginUrl, setLoginUrl] = useState(null);
  const [tokenId, setTokenId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.dhanAuthStatus().catch(() => null),
        api.dhanFeedHealth().catch(() => null),
      ]);
      setStatus(s);
      setHealth(h);
    } catch {
      pushToast?.('Could not reach the data-feed API', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startLogin = async () => {
    setBusy(true);
    try {
      const res = await api.dhanAuthStart();
      setLoginUrl(res.loginUrl);
      window.open(res.loginUrl, '_blank', 'noopener,noreferrer');
      pushToast?.('Dhan login opened in a new tab', 'success');
    } catch (e) {
      pushToast?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const finishLogin = async (rawValue) => {
    const value = (rawValue ?? tokenId).trim();
    if (!value) return;
    setBusy(true);
    try {
      // A JWT is already an access token, not a consent tokenId - the backend
      // recognises this, but we branch here so the UI states which happened.
      if (value.startsWith('eyJ')) {
        const res = await api.dhanSetToken(value);
        setStatus(res);
        setTokenId('');
        pushToast?.(res.verified ? 'Dhan feed is live' : 'Token saved', 'success');
      } else {
        const res = await api.dhanAuthFinish(value);
        setStatus(res);
        setTokenId('');
        pushToast?.('Dhan feed is live', 'success');
      }
      setLoginUrl(null);
      load();
    } catch (e) {
      pushToast?.(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { await api.dhanAuthLogout(); pushToast?.('Token cleared', 'success'); load(); } catch (e) { pushToast?.(e.message, 'error'); }
  };

  const auth = Boolean(status?.authenticated);
  const dh = health?.DHAN || null;
  const circuit = health?.circuit || null;
  const reg = health?.registry || null;
  const sync = health?.sync || null;
  const mins = status?.minutesRemaining;
  const usingYahoo = reg?.active === 'YAHOO' || reg?.order?.[0] === 'YAHOO';

  // One actionable sentence straight from the backend
  const explain = health?.explanation
    || (circuit?.state === 'OPEN'
      ? `Dhan is rate-limiting this IP. Cooling down for ${circuit.cooldownMinutesLeft} min, then it reconnects automatically.`
      : !auth
        ? 'Free Yahoo Finance feed is active. Add a Dhan account for sub-second ticks and market depth.'
        : 'Live tick stream active.');

  const pill = (on, text, warn = false) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
      background: on ? 'rgba(16,185,129,0.12)' : warn ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.12)',
      color: on ? 'var(--gain)' : warn ? '#f59e0b' : 'var(--loss)',
      border: `1px solid ${on ? 'rgba(16,185,129,0.4)' : warn ? 'rgba(245,158,11,0.45)' : 'rgba(239,68,68,0.35)'}`,
    }}>
      {on ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {text}
    </span>
  );

  return (
    <div className="card" style={{ padding: 22, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={18} style={{ color: 'var(--accent-primary)' }} /> Real Market Data Feed
        </h3>
        <button className="btn btn-ghost" onClick={load} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
        All prices come from <strong>DhanHQ (real NSE/BSE ticks)</strong>. No simulated prices are ever shown -
        a symbol without real data is badged <strong>NO DATA</strong> instead.
      </p>

      {/* ✅ exact reason */}
      <div style={{
        background: dh?.connected || usingYahoo ? 'rgba(16,185,129,0.08)' : circuit?.state === 'OPEN' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.07)',
        border: `1px solid ${dh?.connected || usingYahoo ? 'rgba(16,185,129,0.35)' : circuit?.state === 'OPEN' ? 'rgba(245,158,11,0.45)' : 'rgba(239,68,68,0.3)'}`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 16,
        fontSize: 12.5, lineHeight: 1.6,
        color: dh?.connected || usingYahoo ? 'var(--gain)' : circuit?.state === 'OPEN' ? '#f59e0b' : 'var(--text-secondary)',
      }}>
        {explain}
      </div>

      {/* ── Status grid ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-layer)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Data source</div>
          <div style={{ marginTop: 5 }}>{pill(usingYahoo || dh?.connected, usingYahoo ? 'Yahoo (free)' : dh?.connected ? 'DhanHQ live' : 'None', false)}</div>
        </div>
        <div style={{ background: 'var(--bg-layer)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Dhan token</div>
          <div style={{ marginTop: 5 }}>{pill(auth, auth ? `Valid${mins != null ? ` - ${mins}m left` : ''}` : 'Not added', false)}</div>
        </div>
        <div style={{ background: 'var(--bg-layer)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Live stream</div>
          <div style={{ marginTop: 5 }}>{pill(dh?.connected, dh?.connected ? 'Dhan WS ticks' : usingYahoo ? 'Continuous sync' : 'Not connected', circuit?.state === 'OPEN' || dh?.wsBlocked)}</div>
        </div>
        <div style={{ background: 'var(--bg-layer)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Instruments</div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-mono)', marginTop: 3 }}>
            {health?.instruments?.count ? health.instruments.count.toLocaleString('en-IN') : '0'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-layer)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Live now</div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-mono)', marginTop: 3 }}>
            {sync?.symbolsTracked ?? dh?.tracked ?? 0}
          </div>
        </div>
        <div style={{ background: 'var(--bg-layer)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Refreshed</div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-mono)', marginTop: 3 }}>
            {sync?.lastQuoteCycle ? new Date(sync.lastQuoteCycle).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
          </div>
        </div>
      </div>

      {/* ── Dhan optional upgrade ───────────────────────────────────────────── */}
      {!auth ? (
        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px dashed rgba(99,102,241,0.45)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, marginBottom: 4 }}>
            <KeyRound size={15} /> Optional upgrade - add a Dhan account
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px 0', lineHeight: 1.6 }}>
            The app already has real prices. A Dhan account adds <strong>tick-by-tick streaming</strong>,
            <strong> 5-level market depth</strong> and <strong>open interest</strong>. Leave it empty to
            stay on the free Yahoo feed.
          </p>

          {/* Method A — paste an access token (simplest, recommended) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4, color: 'var(--text-secondary)' }}>
              Option 1 — paste an access token <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(easiest)</span>
            </div>
            <ol style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 18, margin: '0 0 8px 0', lineHeight: 1.65 }}>
              <li>Log in at <strong>web.dhan.co</strong></li>
              <li>Profile → <strong>Access DhanHQ APIs</strong> → Generate token (valid 24h)</li>
              <li>Paste it below — it starts with <code>eyJ...</code></li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                className="input" placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9..." value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') finishLogin(); }}
                style={{ flex: 1, minWidth: 240, fontSize: 12.5, fontFamily: 'var(--font-mono)' }}
              />
              <button className="btn btn-primary" onClick={() => finishLogin()} disabled={busy || !tokenId.trim()}>Connect</button>
            </div>
          </div>

          {/* Method B — consent login */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4, color: 'var(--text-secondary)' }}>
              Option 2 — API key / secret consent login
            </div>
            <ol style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 18, margin: '0 0 8px 0', lineHeight: 1.65 }}>
              <li>Click <strong>Open Dhan login</strong> — a new tab opens Dhan's consent page.</li>
              <li>Log in with your Dhan credentials + 2FA.</li>
              <li>Dhan redirects to your app URL with <code>?tokenId=xxxx</code> — paste <strong>that</strong> value (not a JWT).</li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-outline" onClick={startLogin} disabled={busy} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <ExternalLink size={14} /> Open Dhan login
              </button>
            </div>
            {loginUrl ? (
              <div style={{ marginTop: 10, fontSize: 11.5, wordBreak: 'break-all', color: 'var(--text-muted)' }}>
                If the tab did not open: <a href={loginUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>click here</a>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {status?.clientName ? `Connected as <strong>${status.clientName}</strong>. ` : ''}
            Live ticks are flowing through the WebSocket stream.
          </div>
          <button className="btn btn-ghost" onClick={logout} style={{ fontSize: 12 }}>Clear token</button>
        </div>
      )}

      {/* ── Quota detail ────────────────────────────────────────────────────── */}
      {dh?.rateLimits ? (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 11 }}>
          {[
            { k: 'Quote API', v: dh.rateLimits.quote },
            { k: 'History API', v: dh.rateLimits.data },
            { k: 'Option chain', v: dh.rateLimits.optionChain },
          ].map((r) => (
            <div key={r.k} style={{ background: 'var(--bg-layer)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>{r.k}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                {r.v ? `${r.v.usedToday.toLocaleString('en-IN')} / ${r.v.dailyLimit.toLocaleString('en-IN')}` : '-'}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
