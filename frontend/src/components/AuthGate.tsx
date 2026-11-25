import { FormEvent, useState } from 'react';
import { Lock, UserPlus } from 'lucide-react';
import { api, setAccessToken, TradingAccountDTO, UserProfile } from '../apiClient';
import { BlockTradeLogo } from './BlockTradeLogo';

interface AuthGateProps {
  onAuthenticated: (user: UserProfile, accounts: TradingAccountDTO[]) => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === 'register') {
        const res = await api.register({
          email,
          fullName,
          password,
          acceptSebiRiskDisclosure: acceptRisk,
        });
        setAccessToken(res.accessToken);
        onAuthenticated(res.user, res.accounts);
      } else {
        const res = await api.login({
          email,
          password,
          totpCode: totpCode.trim() || undefined,
        });
        setAccessToken(res.accessToken);
        onAuthenticated(res.user, res.accounts);
      }
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
      }
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 16 }}>
          <BlockTradeLogo size={46} showWordmark showTagline />
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.55 }}>
          One profile owns <strong>two isolated trading accounts</strong>: <strong>DEMO</strong> (virtual ₹1,000 –
          ₹1 Crore) and <strong>REAL</strong> (deposited funds). Both start at <strong>₹0.00</strong> with identical
          SEBI rules, statutory charges, and SHA-256 blockchain trade verification.
        </p>

        <div className="account-switcher" style={{ width: '100%', marginBottom: 16 }}>
          <button
            type="button"
            className={`mode-btn ${tab === 'login' ? 'active-demo' : ''}`}
            style={{ flex: 1 }}
            onClick={() => { setTab('login'); setError(null); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`mode-btn ${tab === 'register' ? 'active-demo' : ''}`}
            style={{ flex: 1 }}
            onClick={() => { setTab('register'); setError(null); }}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form-stack">
          {tab === 'register' && (
            <label className="field">
              <span>Full Name</span>
              <input
                className="input"
                type="text"
                required
                placeholder="Aarav Sharma"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span>Email Address</span>
            <input
              className="input"
              type="email"
              required
              placeholder="trader@example.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              required
              placeholder={tab === 'register' ? 'Min 8 chars, Uppercase + Lowercase + Number' : 'Enter password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {tab === 'login' && needsTotp && (
            <label className="field">
              <span>6-Digit Authenticator Code (2FA)</span>
              <input
                className="input mono"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
              />
            </label>
          )}

          {tab === 'register' && (
            <label className="checkbox-box">
              <input
                type="checkbox"
                checked={acceptRisk}
                onChange={(e) => setAcceptRisk(e.target.checked)}
              />
              <span>
                I acknowledge the <strong>SEBI Derivatives Risk Disclosure</strong> (9 out of 10 individual F&amp;O
                traders incur net losses plus ~28% transaction costs) and understand that{' '}
                <strong>DEMO trading results do not guarantee real trading outcomes</strong>.
              </span>
            </label>
          )}

          {error && <div className="alert-error">{error}</div>}

          <button className="btn-primary" type="submit" disabled={busy}>
            {tab === 'register' ? <UserPlus size={15} /> : <Lock size={15} />}
            {busy ? 'Processing...' : tab === 'register' ? 'Create Profile (DEMO + REAL at ₹0.00)' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
