import { TrendingUp, ShieldCheck, Link2, Bot, ArrowRight, Activity } from 'lucide-react';
import './LandingPage.css';

const FEATURES = [
  { icon: TrendingUp, title: 'Real Market Data', body: 'Live NSE/BSE quotes via DhanHQ WebSocket + Yahoo Finance fallback — zero synthetic prices.' },
  { icon: ShieldCheck, title: 'SEBI-Compliant Simulation', body: 'Circuit breakers, position limits, lot sizes, F&O SPAN margin — modelled like a real broker.' },
  { icon: Link2, title: 'Blockchain Proof of Trade', body: 'Every fill is SHA-256 hashed into an immutable ledger for tamper-evident practice records.' },
  { icon: Bot, title: 'AI Coaching Layer', body: 'Bias detection, direction forecasting, portfolio recommendations — your edge, amplified.' },
];

const TIERS = [
  { name: 'Free', price: '₹0', body: '1 watchlist · Delayed data · Basic chart', cta: 'Start Free' },
  { name: 'Pro', price: '₹299', body: 'Live data · Unlimited watchlists · AI dashboard · Journal exports', cta: 'Go Pro' },
  { name: 'Expert', price: '₹799', body: 'Backtesting · Strategy builder · Blockchain certificates · API access', cta: 'Go Expert' },
];

export default function LandingPage({ onGetStarted }) {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-logo"><Activity size={18} /> BlockTrade</div>
        <div className="lp-nav-links">
          <span>Product</span><span>Markets</span><span>AI</span><span>Blockchain</span>
        </div>
        <button className="lp-btn-ghost" onClick={onGetStarted}>Sign in</button>
        <button className="lp-btn-primary" onClick={onGetStarted}>Launch App <ArrowRight size={14} /></button>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-badge">Paper trading · Real data · Zero risk</div>
        <h1>Practice Indian markets with <em>real live data</em>.<br />Zero financial risk.</h1>
        <p>
          BlockTrade is the TradingView × Dhan paper-trading platform for NSE/BSE —
          real market data, SEBI-accurate simulation, blockchain-verified trades, and AI coaching.
        </p>
        <div className="lp-hero-cta">
          <button className="lp-btn-primary lg" onClick={onGetStarted}>Start Paper Trading <ArrowRight size={16} /></button>
          <button className="lp-btn-ghost lg">View Markets</button>
        </div>
        <div className="lp-hero-stats">
          <div><b>LIVE</b><span>Real NSE/BSE feeds</span></div>
          <div><b>0</b><span>Real money at risk</span></div>
          <div><b>24×7</b><span>AI coaching</span></div>
          <div><b>100%</b><span>Tamper-proof ledger</span></div>
        </div>
      </section>

      <section className="lp-section">
        <h2>Why traders choose BlockTrade</h2>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="lp-card">
              <f.icon size={20} />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <h2>Simple pricing</h2>
        <div className="lp-grid three">
          {TIERS.map((t) => (
            <div key={t.name} className="lp-card tier">
              <h3>{t.name}</h3>
              <div className="lp-price">{t.price}<span>/mo</span></div>
              <p>{t.body}</p>
              <button className="lp-btn-primary" onClick={onGetStarted}>{t.cta}</button>
            </div>
          ))}
        </div>
      </section>

      <footer className="lp-footer">
        <p>BlockTrade is a simulated trading environment. No real money is involved. Market data provided for educational purposes.</p>
      </footer>
    </div>
  );
}
