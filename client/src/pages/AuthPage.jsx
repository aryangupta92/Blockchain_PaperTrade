import { useState } from 'react';
import './AuthPage.css';
import api from '../services/api';
import { Shield, TrendingUp, Lock, Mail, User, Phone, CreditCard, Calendar, Eye, EyeOff, AlertTriangle } from 'lucide-react';

const SEBI_DISCLAIMER = `This is a paper trading simulation platform regulated under SEBI guidelines for educational purposes. No real money is involved. Virtual funds are provided for practice only. Past performance does not guarantee future results. Trading in securities market is subject to market risk. Please read all risk disclosure documents carefully before participating.`;

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'risk'
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', pan: '', dob: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingUser, setPendingUser] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { token, user } = await api.login({ email: form.email, password: form.password });
      localStorage.setItem('bt_token', token);
      onAuth(user, token);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      // 1. Dual-Chain Execution: Register on Ethereum/Sepolia via MetaMask
      try {
        const { registerOnChain } = await import('../services/web3');
        await registerOnChain(form.name, form.email);
        console.log("User registered on Ethereum");
      } catch (err) {
        console.warn("MetaMask user sync failed or skipped:", err.message);
      }

      // 2. Register via API (Local Blockchain)
      const { token, user } = await api.register(form);
      localStorage.setItem('bt_token', token);
      setPendingUser({ user, token });
      setMode('risk');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleAcceptRisk = async () => {
    setLoading(true);
    try {
      await api.acceptRisk();
      onAuth(pendingUser.user, pendingUser.token);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      {/* Left Panel */}
      <div className="auth-left">
        <div className="auth-brand">
          <div className="auth-logo">B</div>
          <div>
            <div className="auth-logo-name">BlockTrade</div>
            <div className="auth-logo-sub">PAPER TRADING · SEBI COMPLIANT</div>
          </div>
        </div>

        <div className="auth-hero">
          <h1 className="auth-headline">Master the Markets<br /><span>Without the Risk</span></h1>
          <p className="auth-subline">Trade NSE & BSE stocks, F&O, and indices with virtual money. Every trade immutably recorded on blockchain.</p>
        </div>

        <div className="auth-features">
          {[
            { icon: TrendingUp, label: 'Live Market Data', desc: 'Real NSE/BSE prices, NIFTY 50, SENSEX, BANK NIFTY' },
            { icon: Shield, label: 'Blockchain Secured', desc: 'SHA-256 immutable ledger for every trade you place' },
            { icon: Lock, label: 'SEBI Guidelines', desc: 'Fully compliant with SEBI paper trading regulations' },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="auth-feature-item">
              <div className="auth-feature-icon"><Icon size={18} /></div>
              <div>
                <div className="auth-feature-label">{label}</div>
                <div className="auth-feature-desc">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="auth-ticker">
          <div className="auth-ticker-inner">
            {['NIFTY 50 24,264.85 ▲0.28%', 'SENSEX 78,233.18 ▲0.31%', 'BANK NIFTY 56,174.80 ▲0.18%', 'NIFTY IT 31,817.50 ▲0.45%', 'NIFTY MID 16,884.80 ▲0.80%'].map(t => (
              <span key={t}>{t}&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;</span>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="auth-right">
        <div className="auth-card">
          {mode === 'risk' ? (
            <>
              <div className="auth-card-title">
                <AlertTriangle size={20} style={{ color: 'var(--accent-secondary)' }} />
                Risk Disclosure (SEBI Mandatory)
              </div>
              <div className="risk-disclosure-box">
                <div className="risk-text">{SEBI_DISCLAIMER}</div>
                <div className="risk-points">
                  {[
                    'This platform is for educational purposes only',
                    'No real money is involved in any transaction',
                    'Virtual funds cannot be withdrawn or transferred',
                    'Market data may be delayed by a few seconds',
                    'SEBI registration: Simulated — INZ000XXXXX',
                    'Trading is subject to circuit breaker rules',
                  ].map(p => <div key={p} className="risk-point">✓ {p}</div>)}
                </div>
              </div>
              {error && <div className="auth-error">{error}</div>}
              <button className="auth-submit-btn" onClick={handleAcceptRisk} disabled={loading}>
                {loading ? 'Processing…' : 'I Accept — Start Trading'}
              </button>
            </>
          ) : (
            <>
              <div className="auth-tabs">
                <button className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>Login</button>
                <button className={`auth-tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>Create Account</button>
              </div>

              <form onSubmit={mode === 'login' ? handleLogin : handleSignup}>
                {mode === 'signup' && (
                  <>
                    <div className="auth-input-group">
                      <User size={15} className="auth-input-icon" />
                      <input className="auth-input" type="text" placeholder="Full Name (as per PAN)" value={form.name} onChange={set('name')} required />
                    </div>
                    <div className="auth-input-group">
                      <Phone size={15} className="auth-input-icon" />
                      <input className="auth-input" type="tel" placeholder="Mobile Number" value={form.phone} onChange={set('phone')} required pattern="[0-9]{10}" />
                    </div>
                    <div className="auth-input-row">
                      <div className="auth-input-group">
                        <CreditCard size={15} className="auth-input-icon" />
                        <input className="auth-input" type="text" placeholder="PAN Number (optional)" value={form.pan} onChange={set('pan')} maxLength={10} style={{ textTransform: 'uppercase' }} />
                      </div>
                      <div className="auth-input-group">
                        <Calendar size={15} className="auth-input-icon" />
                        <input className="auth-input" type="date" placeholder="Date of Birth" value={form.dob} onChange={set('dob')} />
                      </div>
                    </div>
                  </>
                )}

                <div className="auth-input-group">
                  <Mail size={15} className="auth-input-icon" />
                  <input className="auth-input" type="email" placeholder="Email Address" value={form.email} onChange={set('email')} required />
                </div>

                <div className="auth-input-group">
                  <Lock size={15} className="auth-input-icon" />
                  <input className="auth-input" type={showPwd ? 'text' : 'password'} placeholder={mode === 'signup' ? 'Password (min 8 chars)' : 'Password'} value={form.password} onChange={set('password')} required minLength={mode === 'signup' ? 8 : 1} />
                  <button type="button" className="auth-pwd-toggle" onClick={() => setShowPwd(s => !s)}>
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {error && <div className="auth-error"><AlertTriangle size={13} /> {error}</div>}

                {mode === 'signup' && (
                  <p className="auth-sebi-note">
                    By creating an account, you agree to our Terms & Conditions and SEBI's risk disclosure norms for paper trading platforms.
                  </p>
                )}

                <button type="submit" className="auth-submit-btn" disabled={loading}>
                  {loading ? 'Please wait…' : mode === 'login' ? '🔐 Login to BlockTrade' : '🚀 Create Free Account'}
                </button>

                {mode === 'login' && (
                  <div style={{ textAlign: 'center', marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                    Demo: <strong style={{ color: 'var(--accent-secondary)' }}>demo@blocktrade.in</strong> / <strong style={{ color: 'var(--accent-secondary)' }}>demo1234</strong>
                  </div>
                )}
              </form>
            </>
          )}

          <div className="auth-footer">
            <Shield size={11} /> SEBI Regulated Paper Trading · NSE & BSE Simulated · Blockchain Secured
          </div>
        </div>
      </div>
    </div>
  );
}
