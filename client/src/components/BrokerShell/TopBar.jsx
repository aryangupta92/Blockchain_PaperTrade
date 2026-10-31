import { useState, useRef, useEffect } from 'react';
import {
  Bell, LogOut, AlertTriangle, Info, Eye, EyeOff, ChevronDown,
  User, Wallet, Briefcase, Settings, PieChart, LifeBuoy, Clock, Radio,
  TrendingUp, Activity, Sliders, Search, Terminal, Code, BookOpen, Keyboard, Headphones,
} from 'lucide-react';
import WalletConnect from '../Wallet/WalletConnect';
import TopSearchBar from './TopSearchBar';
import api from '../../services/api';

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function TopBar({ balance, marketStatus, user, onLogout, onOpenChart, onNav }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [hideFunds, setHideFunds] = useState(() => localStorage.getItem('bt_hide_funds') === '1');
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState('');

  const loadNotifs = async () => {
    setNotifLoading(true);
    setNotifError('');
    try {
      const d = await api.getNotifications(50);
      setNotifications(d.notifications || []);
      setUnreadCount(d.unreadCount ?? (d.notifications || []).filter((n) => !n.isRead).length);
    } catch (e) {
      setNotifError(e.message || 'Failed to load notifications');
    } finally {
      setNotifLoading(false);
    }
  };

  useEffect(() => { loadNotifs().catch(() => {}); }, []);

  const markAllRead = async () => {
    try {
      const d = await api.markNotificationsRead();
      setUnreadCount(d.unreadCount ?? 0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch { /* notification inbox is optional */ }
  };

  // Click outside closes whichever popover is open
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) setShowNotifs(false);
      if (profileRef.current && !profileRef.current.contains(event.target)) setShowProfile(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleFunds = (e) => {
    e.stopPropagation();
    const next = !hideFunds;
    setHideFunds(next);
    try { localStorage.setItem('bt_hide_funds', next ? '1' : '0'); } catch { /* storage may be blocked */ }
  };

  const go = (page) => {
    setShowProfile(false);
    onNav?.(page);
  };

  const statusText = marketStatus?.open ? 'Market open' : 'Market closed';
  const statusColor = marketStatus?.open ? 'var(--gain)' : '#f59e0b';

  return (
    <header className="topbar">
      {/* Left: market session (index quotes live in the ticker strip) */}
      <div className="topbar-left">
        <div
          className="topbar-market-status"
          title={marketStatus?.reason || statusText}
          style={{ background: `${statusColor}1f`, color: statusColor, border: `1px solid ${statusColor}44` }}
        >
          {marketStatus?.open ? <Radio size={11} /> : <Clock size={11} />}
          {statusText}
          {marketStatus?.nextEvent ? <span className="topbar-status-sub">· {marketStatus.nextEvent}</span> : null}
        </div>
      </div>

      {/* Center: global search */}
      <TopSearchBar onOpenChart={onOpenChart} />

      {/* Right: Balance + Notifications + Profile */}
      <div className="topbar-right" style={{ gap: 10 }}>
        <WalletConnect onConnect={(addr) => console.log('Wallet:', addr)} />

        <div
          className="topbar-balance"
          title="Funds · available margin — click for the full statement"
          onClick={() => onNav?.('funds')}
          style={{ cursor: onNav ? 'pointer' : 'default' }}
        >
          <div className="topbar-balance-label">Funds · Available</div>
          <div className="topbar-balance-row">
            <span className="topbar-balance-val">
              {hideFunds ? '••••••' : `₹${balance?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}`}
            </span>
            <button className="topbar-eye" onClick={toggleFunds} title={hideFunds ? 'Show funds' : 'Hide funds'}>
              {hideFunds ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </div>

        <div style={{ position: 'relative' }} ref={notifRef}>
          <button className="topbar-icon-btn" onClick={() => { setShowNotifs(!showNotifs); if (!showNotifs) loadNotifs(); }} title="Notifications">
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="topbar-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>

          {showNotifs && (
            <div className="card topbar-popover" style={{ width: 320, padding: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Notifications{unreadCount > 0 ? ` (${unreadCount} unread)` : ''}</span>
                {notifications.length > 0 && <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: 11, cursor: 'pointer' }}>Mark all read</button>}
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {notifLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
                ) : notifError ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--loss)', fontSize: 12 }}>{notifError}</div>
                ) : notifications.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No new notifications</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--bg-layer)', display: 'flex', gap: 12, alignItems: 'flex-start', opacity: n.isRead ? 0.65 : 1 }}>
                      <div style={{ padding: 6, borderRadius: '50%', background: n.type === 'RISK_WARNING' || n.type === 'ALERT' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(99, 102, 241, 0.1)', color: n.type === 'RISK_WARNING' || n.type === 'ALERT' ? 'var(--loss)' : 'var(--accent-primary)' }}>
                        {n.type === 'RISK_WARNING' || n.type === 'ALERT' ? <AlertTriangle size={14} /> : <Info size={14} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{n.body}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }} ref={profileRef}>
          <button className="topbar-profile" onClick={() => setShowProfile(v => !v)} title="Account menu">
            <span className="topbar-avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</span>
            <ChevronDown size={13} className={showProfile ? 'rotated' : ''} />
          </button>

          {showProfile && (
            <div className="card topbar-popover topbar-profile-menu">
              <div className="topbar-profile-head">
                <span className="topbar-avatar large">{user?.name?.[0]?.toUpperCase() || 'U'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || 'Trader'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email || ''}</div>
                </div>
              </div>
              <button className="topbar-menu-item" onClick={() => go('settings')}><User size={14} /> My Profile on BlockTrade</button>
              <button className="topbar-menu-item highlighted" onClick={() => go('alerts')} style={{ background: 'rgba(0,179,134,0.08)', color: 'var(--accent-primary)', fontWeight: 700 }}>
                <Bell size={14} /> Set 250+ Market Alerts
              </button>
              <button className="topbar-menu-item" onClick={() => { setShowProfile(false); onOpenChart?.({ symbol: 'NIFTY 50', symbolData: null }); }}>
                <TrendingUp size={14} /> Trade on TradingCharts
              </button>
              <button className="topbar-menu-item" onClick={() => { setShowProfile(false); onOpenChart?.({ symbol: 'NIFTY 50', symbolData: null }); }}>
                <Activity size={14} /> Trade Directly on Charts
              </button>
              <button className="topbar-menu-item" onClick={() => go('strategy-builder')}><Sliders size={14} /> Build Strategies on Options</button>
              <button className="topbar-menu-item" onClick={() => go('market')}><Search size={14} /> Analyse Stocks on ScanX</button>
              <button className="topbar-menu-item" onClick={() => go('trade')}><Terminal size={14} /> Trade on Terminal (Advanced)</button>
              <button className="topbar-menu-item" onClick={() => go('settings')}><Code size={14} /> Get Trading &amp; Data APIs</button>
              <button className="topbar-menu-item" onClick={() => go('journal')}><BookOpen size={14} /> Get Reports on Journal</button>
              <button className="topbar-menu-item" onClick={() => go('settings')}><Keyboard size={14} /> Keyboard Shortcuts</button>
              <button className="topbar-menu-item" onClick={() => go('settings')}><Headphones size={14} /> 24 × 7 Customer Service</button>
              <button className="topbar-menu-item" onClick={() => go('funds')}><Wallet size={14} /> Funds &amp; margin</button>
              <button className="topbar-menu-item" onClick={() => go('portfolio')}><Briefcase size={14} /> Holdings</button>
              <button className="topbar-menu-item" onClick={() => go('pnl')}><PieChart size={14} /> Reports &amp; P&amp;L</button>
              <button className="topbar-menu-item" onClick={() => go('journal')}><User size={14} /> Trade journal</button>
              <button className="topbar-menu-item" onClick={() => go('settings')}><Settings size={14} /> Settings</button>
              <button className="topbar-menu-item" onClick={() => go('legal-disclaimer')}><Info size={14} /> SEBI Disclaimer</button>
              <button className="topbar-menu-item" onClick={() => go('legal-privacy')}><BookOpen size={14} /> Privacy Policy</button>
              <button className="topbar-menu-item" onClick={() => go('legal-terms')}><BookOpen size={14} /> Terms of Service</button>
              <button className="topbar-menu-item" onClick={() => go('legal-dpdp')}><Info size={14} /> DPDP Notice</button>
              <button className="topbar-menu-item" onClick={() => go('settings')}><LifeBuoy size={14} /> Data feed help</button>
              <div className="topbar-menu-sep" />
              <button className="topbar-menu-item danger" onClick={onLogout}><LogOut size={14} /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
