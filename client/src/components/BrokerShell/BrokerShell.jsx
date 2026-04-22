import './BrokerShell.css';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TickerStrip from './TickerStrip';

export default function BrokerShell({ children, activePage, onNav, balance, quotes, marketLoading, marketStatus, user, subscription, onLogout, onOpenChart }) {
  return (
    <div className="broker-shell">
      <Sidebar activePage={activePage} onNav={onNav} subscription={subscription} user={user} />
      <div className="shell-main">
        <TopBar balance={balance} quotes={quotes} marketStatus={marketStatus} user={user} onLogout={onLogout} onOpenChart={onOpenChart} />
        <TickerStrip quotes={quotes} loading={marketLoading} />
        <main className="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
}
