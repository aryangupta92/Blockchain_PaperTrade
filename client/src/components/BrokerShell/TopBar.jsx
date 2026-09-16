import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, X, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import WalletConnect from '../Wallet/WalletConnect';
import TopSearchBar from './TopSearchBar';

export default function TopBar({ balance, quotes, marketStatus, user, onLogout, onOpenChart }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef(null);

  // Mock notifications for now to complete the UI
  const [notifications, setNotifications] = useState([
    { id: 1, type: 'ALERT', title: 'Risk Warning', body: 'High exposure to IT sector detected (>40%).', time: '10m ago' },
    { id: 2, type: 'SYSTEM', title: 'Backtest Complete', body: 'Nifty Momentum Play strategy validation finished.', time: '1h ago' },
  ]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifs(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifRef]);

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
        
        <div style={{ position: 'relative' }} ref={notifRef}>
          <button className="topbar-icon-btn" onClick={() => setShowNotifs(!showNotifs)}>
            <Bell size={16} />
            {notifications.length > 0 && (
              <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: 'var(--loss)', borderRadius: '50%' }} />
            )}
          </button>
          
          {showNotifs && (
            <div className="card" style={{ position: 'absolute', top: 32, right: 0, width: 320, padding: 0, zIndex: 50, boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Notifications</span>
                {notifications.length > 0 && <button onClick={() => setNotifications([])} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: 11, cursor: 'pointer' }}>Clear all</button>}
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No new notifications</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--bg-layer)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ padding: 6, borderRadius: '50%', background: n.type === 'ALERT' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(99, 102, 241, 0.1)', color: n.type === 'ALERT' ? 'var(--loss)' : 'var(--accent-primary)' }}>
                        {n.type === 'ALERT' ? <AlertTriangle size={14} /> : <Info size={14} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{n.body}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{n.time}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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
