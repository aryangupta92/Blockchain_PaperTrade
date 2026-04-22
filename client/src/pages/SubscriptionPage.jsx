import { useState, useEffect } from 'react';
import './SubscriptionPage.css';
import api from '../services/api';
import { Shield, Zap, Star, CheckCircle, TrendingUp, Link, AlertTriangle, LogOut } from 'lucide-react';

export default function SubscriptionPage({ user, onSubscribed, onLogout, reason }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [purchasing, setPurchasing] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPlans().then(setPlans).catch(console.error);
  }, []);

  const handlePurchase = async (planId) => {
    setPurchasing(planId); setError('');
    try {
      // 1. Dual-Chain Execution: Attempt Ethereum/Sepolia transaction
      try {
        const { purchaseSubscriptionOnChain } = await import('../services/web3');
        const ethTxHash = await purchaseSubscriptionOnChain(planId);
        console.log("Subscription recorded on Ethereum. TxHash:", ethTxHash);
      } catch (err) {
        console.warn("MetaMask subscription sync failed or skipped:", err.message);
      }

      // 2. Execute via API (Local Blockchain to unlock platform)
      const { subscription } = await api.purchasePlan(planId);
      onSubscribed(subscription);
    } catch (err) { setError(err.message); }
    finally { setPurchasing(''); }
  };

  const ICONS = { starter: Zap, pro: TrendingUp, expert: Star };
  const REASON_MESSAGES = {
    no_subscription: 'Choose a plan to start your paper trading journey',
    expired: '⚠️ Your subscription has expired. Renew to continue trading.',
    trades_exhausted: '⚠️ You have used all your trades. Upgrade to get more.',
    balance_zero: '⚠️ Your virtual balance is zero. Subscribe again to get fresh capital.',
  };

  return (
    <div className="sub-page">
      {/* Header */}
      <div className="sub-header">
        <div className="sub-brand">
          <div className="auth-logo">B</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>BlockTrade</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.1em' }}>PAPER TRADING PLATFORM</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Logged in as <strong style={{ color: 'var(--text-primary)' }}>{user?.name}</strong></div>
          <button className="btn btn-ghost" onClick={onLogout} style={{ padding: '6px 10px', fontSize: 11 }}>
            <LogOut size={13} /> Logout
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="sub-hero">
        <div className="sub-tag"><Shield size={12} /> SEBI Compliant Paper Trading</div>
        <h1 className="sub-title">Choose Your Trading Plan</h1>
        <p className="sub-desc">Get virtual money to practice NSE & BSE trading. Every trade is recorded on blockchain.</p>
        {reason && reason !== 'no_subscription' && (
          <div className="sub-alert">
            <AlertTriangle size={14} />
            {REASON_MESSAGES[reason] || 'Subscribe to continue trading'}
          </div>
        )}
      </div>

      {/* Plans Grid */}
      <div className="sub-plans">
        {plans.map((plan) => {
          const Icon = ICONS[plan.id] || Zap;
          const isPopular = plan.id === 'pro';
          return (
            <div key={plan.id} className={`sub-plan-card ${isPopular ? 'popular' : ''}`} style={{ '--plan-color': plan.color }}>
              {isPopular && <div className="popular-badge">MOST POPULAR</div>}
              <div className="plan-header">
                <div className="plan-icon" style={{ background: plan.color + '20', color: plan.color }}>
                  <Icon size={22} />
                </div>
                <div className="plan-badge" style={{ background: plan.color + '20', color: plan.color }}>{plan.badge}</div>
              </div>
              <div className="plan-name">{plan.name}</div>
              <div className="plan-price">{plan.priceLabel}</div>
              <div className="plan-desc">{plan.description}</div>

              <div className="plan-stats">
                <div className="plan-stat">
                  <div className="plan-stat-label">Virtual Capital</div>
                  <div className="plan-stat-val" style={{ color: plan.color }}>
                    ₹{plan.virtualMoney.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="plan-stat">
                  <div className="plan-stat-label">Paper Trades</div>
                  <div className="plan-stat-val" style={{ color: plan.color }}>
                    {plan.maxTrades < 0 ? '∞ Unlimited' : plan.maxTrades}
                  </div>
                </div>
              </div>

              <div className="plan-features">
                {plan.features.map(f => (
                  <div key={f} className="plan-feature">
                    <CheckCircle size={13} style={{ color: plan.color, flexShrink: 0 }} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              <button
                className="plan-cta"
                style={{ background: isPopular ? plan.color : 'transparent', borderColor: plan.color, color: isPopular ? '#fff' : plan.color }}
                onClick={() => handlePurchase(plan.id)}
                disabled={!!purchasing}
              >
                {purchasing === plan.id ? 'Processing…' : `Get ${plan.name} — ${plan.priceLabel}`}
              </button>
            </div>
          );
        })}
      </div>

      {error && <div className="sub-error"><AlertTriangle size={14} /> {error}</div>}

      {/* SEBI Footer */}
      <div className="sub-sebi-footer">
        <div className="sub-sebi-row">
          <Shield size={12} />
          <span><strong>SEBI Notice:</strong> Paper trading platform for educational purposes only. Virtual funds have no real monetary value. Read the risk disclosure before trading.</span>
        </div>
        <div className="sub-sebi-row">
          <Link size={12} />
          <span>All trades are immutably recorded on a SHA-256 blockchain ledger for audit and learning purposes.</span>
        </div>
      </div>
    </div>
  );
}
