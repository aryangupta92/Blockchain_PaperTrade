import './BrokerShell.css';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TickerStrip from './TickerStrip';

export default function BrokerShell({ children, activePage, onNav, balance, quotes, marketLoading, marketStatus, user, subscription, onLogout, onOpenChart }) {
  return (
    <div className="broker-shell">
      <Sidebar activePage={activePage} onNav={onNav} subscription={subscription} user={user} />
      <div className="shell-main">
        <TopBar balance={balance} quotes={quotes} marketStatus={marketStatus} user={user} onLogout={onLogout} onOpenChart={onOpenChart} onNav={onNav} activePage={activePage} />
        <TickerStrip quotes={quotes} loading={marketLoading} />
        <main className="shell-content">
          {children}
          <footer style={{ marginTop: 28, padding: '12px 4px 4px', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Paper-trading simulation for education only — not a SEBI-registered broker. No real money involved; virtual funds have no monetary value.
            Market data may be delayed (~15 min, Yahoo fallback) — delayed ticks are never shown as live.
            F&amp;O is high-risk: 9/10 retail traders lose money (SEBI study). Charges per Finance Act 2026 (STT options 0.15% / futures 0.05% on sell) + CDSL DP ₹15.34 on CNC sell.
            Read all risk disclosures before trading.
          </footer>
        </main>
      </div>
    </div>
  );
}
