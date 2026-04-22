import { Bell, LogOut } from 'lucide-react';
import WalletConnect from '../Wallet/WalletConnect';
import TopSearchBar from './TopSearchBar';

export default function TopBar({ balance, quotes, marketStatus, user, onLogout, onOpenChart }) {
  const nifty = quotes?.['^NSEI'];
  const isGain = (nifty?.changePercent || 0) >= 0;

  return (
    <header className="topbar">
      {/* Search */}
      <TopSearchBar onOpenChart={onOpenChart} />

      {/* Center: NIFTY + Market Status */}
      <div className="topbar-center">
        <div className="topbar-index">
          <span className="topbar-index-name">NIFTY 50</span>
          <span className={`topbar-index-price ${isGain ? 'gain' : 'loss'}`}>
            {nifty ? nifty.price.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
          </span>
          {nifty && (
            <span className={isGain ? 'gain' : 'loss'} style={{ fontSize: 11, fontWeight: 600 }}>
              {isGain ? '+' : ''}{nifty.changePercent.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="topbar-market-status" style={{ background: (marketStatus?.color || '#64748b') + '20', color: marketStatus?.color || '#64748b', border: `1px solid ${marketStatus?.color || '#64748b'}40` }}>
          <span className="market-dot" style={{ background: marketStatus?.color || '#64748b' }} />
          {marketStatus?.status || 'CLOSED'}
        </div>
      </div>

      {/* Right: Balance + User */}
      <div className="topbar-right" style={{ gap: 16 }}>
        <WalletConnect onConnect={(addr) => console.log('Wallet:', addr)} />
        
        <div className="topbar-balance">
          <div className="topbar-balance-label">Virtual Balance</div>
          <div className="topbar-balance-val">
            ₹{balance?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>
        <button className="topbar-icon-btn"><Bell size={16} /></button>
        <div className="topbar-avatar">
          {user?.name?.[0]?.toUpperCase() || 'U'}
        </div>
        <button className="topbar-icon-btn" onClick={onLogout} title="Logout">
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}
