import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, Download, KeyRound, Radio, RefreshCw, Scale, ShieldCheck, XCircle } from 'lucide-react';
import { api, setAccessToken, UserProfile } from '../apiClient';

interface SettingsPageProps {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
}

export function SettingsPage({ user, onUserUpdated }: SettingsPageProps) {
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [otpUri, setOtpUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [notices, setNotices] = useState<Awaited<ReturnType<typeof api.regulatoryNotices>>['notices']>([]);
  const [feedSession, setFeedSession] = useState<Awaited<ReturnType<typeof api.marketSessionStatus>> | null>(null);
  const [feedTokenInput, setFeedTokenInput] = useState('');

  const [adminConfigs, setAdminConfigs] = useState<Awaited<ReturnType<typeof api.adminRegulatoryConfigs>>['configs']>([]);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    api.regulatoryNotices().then((r) => setNotices(r.notices)).catch(() => {});
    api.marketSessionStatus().then(setFeedSession).catch(() => {});
    if (user.role === 'ADMIN') {
      api.adminRegulatoryConfigs().then((r) => setAdminConfigs(r.configs)).catch(() => {});
    }
  }, [user.role]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const startTotp = async () => {
    setErr(null);
    setMsg(null);
    try {
      const res = await api.totpSetup();
      setTotpSecret(res.secret);
      setOtpUri(res.otpauthUri);
      setMsg(res.message);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const confirmTotp = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.totpEnable(code);
      onUserUpdated({ ...user, totpEnabled: true });
      setTotpSecret(null);
      setOtpUri(null);
      setCode('');
      setMsg('Two-factor authentication (TOTP) is now enabled for your account.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleDpdpExport = async () => {
    const data = await api.dpdpExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dpdp-personal-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveFeedToken = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const res = await api.setMarketSessionToken(feedTokenInput);
      setFeedTokenInput('');
      setMsg(`Market data session token updated (expires ${res.expiresAt ? new Date(res.expiresAt).toLocaleString('en-IN') : 'in 24h'}).`);
      loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleEnableDevAdmin = async () => {
    setErr(null);
    try {
      await api.devPromoteAdmin();
      const refreshed = await api.refresh();
      setAccessToken(refreshed.accessToken);
      onUserUpdated(refreshed.user);
      setMsg('Admin role enabled for local development.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleRunWatch = async () => {
    setScanResult(null);
    const res = await api.adminRunWatchScan();
    setScanResult(`Scanned ${res.sourcesMonitored} official regulatory sources • ${res.findings.length} item(s) flagged for review.`);
    loadAll();
  };

  const handleApprove = async (id: string) => {
    const res = await api.adminApproveDraft(id);
    setMsg(`Approved regulatory rule & sealed on Blockchain Block #${res.blockchainProof.blockIndex} (${res.blockchainProof.hash.slice(0, 14)}...).`);
    loadAll();
  };

  const handleReject = async (id: string) => {
    await api.adminRejectDraft(id);
    loadAll();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {msg && <div className="alert-success">{msg}</div>}
      {err && <div className="alert-error">{err}</div>}

      {/* Profile, 2FA & DPDP Rights */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3><KeyRound size={15} /> Profile, 2FA &amp; DPDP Act Privacy Rights</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="preset-btn" onClick={handleDpdpExport}>
              <Download size={12} /> Export Personal Data (DPDP Act)
            </button>
            {user.role !== 'ADMIN' && (
              <button className="preset-btn" onClick={handleEnableDevAdmin}>
                Enable Dev Admin Panel
              </button>
            )}
          </div>
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
          <div><strong>Name:</strong> {user.fullName} · <strong>Role:</strong> <span className="badge">{user.role}</span></div>
          <div><strong>Email:</strong> {user.email} · <strong>KYC:</strong> <span className="badge">{user.kycStatus}</span></div>
          <div>
            <strong>2FA (TOTP):</strong>{' '}
            <span className={`badge ${user.totpEnabled ? 'badge-gain' : 'badge-warn'}`}>
              {user.totpEnabled ? 'ENABLED' : 'NOT ENABLED'}
            </span>
          </div>
        </div>

        {!user.totpEnabled && !totpSecret && (
          <button className="btn-primary" onClick={startTotp}>
            <ShieldCheck size={15} /> Set Up Authenticator App (2FA)
          </button>
        )}

        {totpSecret && (
          <form onSubmit={confirmTotp} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="mono" style={{ fontSize: 12, background: 'var(--bg-elevated)', padding: 12, borderRadius: 8 }}>
              <div><strong>Secret Key:</strong> {totpSecret}</div>
              <div style={{ wordBreak: 'break-all', marginTop: 6, color: 'var(--text-muted)' }}>{otpUri}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input mono" style={{ maxWidth: 180 }} placeholder="6-digit code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn-primary" type="submit">Verify &amp; Enable 2FA</button>
            </div>
          </form>
        )}
      </section>

      {/* Neutral Market Data Session Panel (Zero Provider Branding) */}
      <section className="card">
        <h3><Radio size={15} /> Market Data Feed Session</h3>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Status:{' '}
          <span className={`badge ${feedSession?.authenticated ? 'badge-gain' : 'badge-warn'}`}>
            {feedSession?.authenticated
              ? `Active (${feedSession.minutesRemaining ?? '—'} min remaining)`
              : 'Session Token Required'}
          </span>
        </div>
        <form onSubmit={handleSaveFeedToken} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input mono"
            style={{ flex: 1, minWidth: 240 }}
            placeholder="Paste refreshed 24h market data session token..."
            value={feedTokenInput}
            onChange={(e) => setFeedTokenInput(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={!feedTokenInput.trim()}>
            Update Session Token
          </button>
        </form>
      </section>

      {/* Admin Regulatory Watch Panel */}
      {user.role === 'ADMIN' && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}><Scale size={15} /> Admin Regulatory Watch &amp; Config Approval Gate</h3>
            <button className="btn-primary" onClick={handleRunWatch}>
              <RefreshCw size={13} /> Run Regulatory Watch Scan
            </button>
          </div>
          {scanResult && <div className="alert-success" style={{ marginBottom: 10 }}>{scanResult}</div>}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rule Key</th>
                  <th>Effective From</th>
                  <th>Status</th>
                  <th>Verification</th>
                  <th>Citation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {adminConfigs.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.configKey}</td>
                    <td className="mono">{c.effectiveFrom}</td>
                    <td><span className={`badge ${c.status === 'APPROVED' ? 'badge-gain' : 'badge-warn'}`}>{c.status}</span></td>
                    <td><span className={`badge ${c.verification === 'VERIFIED' ? 'badge-gain' : 'badge-warn'}`}>{c.verification}</span></td>
                    <td>{c.citation}</td>
                    <td style={{ display: 'flex', gap: 5 }}>
                      {c.status === 'DRAFT' ? (
                        <>
                          <button className="preset-btn" style={{ color: 'var(--gain)', borderColor: 'var(--gain)' }} onClick={() => handleApprove(c.id)}>
                            <CheckCircle2 size={11} /> Approve &amp; Seal
                          </button>
                          <button className="preset-btn" style={{ color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={() => handleReject(c.id)}>
                            <XCircle size={11} /> Reject
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.approvedBy || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* User-Facing "What's Changed" Approved Regulatory Feed */}
      <section className="card">
        <h3><Bell size={15} /> What&apos;s Changed — Approved SEBI &amp; Exchange Rules</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rule Module</th>
                <th>Effective From</th>
                <th>Verification</th>
                <th>Official Citation</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id}>
                  <td className="mono">{n.configKey}</td>
                  <td className="mono">{n.effectiveFrom}</td>
                  <td>
                    <span className={`badge ${n.verification === 'VERIFIED' ? 'badge-gain' : 'badge-warn'}`}>
                      {n.verification}
                    </span>
                  </td>
                  <td>{n.citation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
