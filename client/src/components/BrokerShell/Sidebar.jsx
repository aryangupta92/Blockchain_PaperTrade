import { TrendingUp, BarChart2, Briefcase, Link, ClipboardList,
         Newspaper, Target, HelpCircle, Settings, Zap, ShieldAlert, FlaskConical,
         LayoutDashboard, Wallet, BookText, PieChart, ShoppingBasket, Activity } from 'lucide-react';


const NAV = [
  { section: 'TRADE', items: [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard',     badge: 'KITE' },
    { id: 'orders',    icon: ClipboardList, label: 'Orders',        badge: null },
    { id: 'portfolio', icon: Briefcase,     label: 'Holdings',      badge: null },
    { id: 'positions', icon: Activity,      label: 'Positions',     badge: null },
    { id: 'funds',     icon: Wallet,        label: 'Funds',         badge: null },
  ]},
  { section: 'MARKET', items: [
    { id: 'market',    icon: TrendingUp,    label: 'Market',        badge: null },
    { id: 'options',   icon: Target,        label: 'Option Chain',  badge: null },
    { id: 'screener',  icon: Target,        label: 'Screener',      badge: 'NEW' },
    { id: 'basket',    icon: ShoppingBasket, label: 'Baskets',      badge: 'NEW' },
    { id: 'news',      icon: Newspaper,     label: 'News & Events', badge: null },
  ]},
  { section: 'REPORTS', items: [
    { id: 'ledger',    icon: BookText,      label: 'Ledger',        badge: null },
    { id: 'pnl',       icon: PieChart,      label: 'P&L / Tax',     badge: null },
    { id: 'trade',     icon: Target,        label: 'Trade Desk',    badge: null },
    { id: 'terminal',  icon: Zap,           label: 'Pro Terminal',  badge: 'LIVE' },
  ]},
  { section: 'TOOLS', items: [
    { id: 'risk',      icon: ShieldAlert,   label: 'Risk Advisor',  badge: 'AI' },
    { id: 'journal',   icon: BarChart2,     label: 'Trade Journal', badge: 'AI' },
    { id: 'backtest',  icon: FlaskConical,  label: 'Backtester',    badge: 'AI' },
    { id: 'blockchain', icon: Link,         label: 'Block Explorer', badge: null },
  ]},
];

export default function Sidebar({ activePage, onNav, subscription, user }) {
  const tradesLeft = subscription
    ? subscription.maxTrades < 0 ? '∞' : subscription.maxTrades - subscription.tradesUsed
    : 0;

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">B</div>
        <div>
          <div className="sidebar-brand-name">BlockTrade</div>
          <div className="sidebar-brand-sub">PAPER TRADING</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV.map(({ section, items }) => (
          <div key={section} className="sidebar-section">
            <div className="sidebar-section-label">{section}</div>
            {items.map(({ id, icon: Icon, label, badge }) => (
              <button
                key={id}
                className={`sidebar-item ${activePage === id ? 'active' : ''}`}
                onClick={() => onNav(id)}
              >
                <Icon size={16} className="sidebar-item-icon" />
                <span className="sidebar-item-label">{label}</span>
                {badge && (
                  <span className="sidebar-badge">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Subscription Info */}
      {subscription && (
        <div className="sidebar-sub-info">
          <div className="sidebar-sub-tier">
            <Zap size={11} /> {subscription.planName} Plan
          </div>
          <div className="sidebar-sub-trades">
            <span>Trades left</span>
            <strong style={{ color: tradesLeft === '∞' ? 'var(--gain)' : Number(tradesLeft) < 10 ? 'var(--loss)' : 'var(--text-primary)' }}>
              {tradesLeft}
            </strong>
          </div>
          <div className="sidebar-sub-progress-bar">
            {subscription.maxTrades > 0 && (
              <div
                className="sidebar-sub-progress-fill"
                style={{ width: `${Math.min(100, (subscription.tradesUsed / subscription.maxTrades) * 100)}%` }}
              />
            )}
          </div>
        </div>
      )}

      {/* User + Actions */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name || 'Trader'}</div>
            <div className="sidebar-user-email">{user?.email || ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="sidebar-icon-btn" title="Help"><HelpCircle size={14} /></button>
          <button className="sidebar-icon-btn" title="Settings"><Settings size={14} /></button>
        </div>
      </div>
    </aside>
  );
}
