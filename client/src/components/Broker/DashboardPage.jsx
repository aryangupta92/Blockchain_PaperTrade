import { useState } from 'react';
import KiteWatchlist from './KiteWatchlist';
import QuoteHeader from './QuoteHeader';
import MarketDepth from './MarketDepth';
import AdvancedChart from '../Chart/AdvancedChart';
import PositionsBook from './PositionsBook';
import OrdersPage from '../Orders/OrdersPage';
import SessionBanner from './SessionBanner';
import OrderTicket from '../Trading/OrderTicket';
import './Kite.css';

// Kite home: left watchlist · center chart + positions/orders dock · right depth + ticket triggers
export default function DashboardPage({
  quotes, marketDepth, watchlist, onAddWatch, onRemoveWatch,
  holdings, balance, onTrade, onOpenChart,
}) {
  const [selected, setSelected] = useState(watchlist?.[0] || 'RELIANCE');
  const [exchange, setExchange] = useState('NSE');
  const [ticket, setTicket] = useState(null); // { side }
  const [dockTab, setDockTab] = useState('positions'); // positions | orders

  const symKey = selected;
  const quote = quotes[symKey] || quotes[`${symKey}.NS`] || null;
  const depth = marketDepth?.[symKey] || marketDepth?.[`${symKey}.NS`] || null;

  const exitPosition = (sym, ltp, qty) => {
    setSelected(sym);
    setTicket({ side: Number(qty) < 0 ? 'buy' : 'sell', price: ltp });
  };

  return (
    <div>
      <SessionBanner />
      <div className="kite-dashboard">
        {/* Left: Kite watchlist */}
        <KiteWatchlist
          quotes={quotes}
          watchlist={watchlist}
          onAdd={onAddWatch}
          onRemove={onRemoveWatch}
          selected={selected}
          onSelect={setSelected}
          onBuy={(s) => { setSelected(s); setTicket({ side: 'buy' }); }}
          onSell={(s) => { setSelected(s); setTicket({ side: 'sell' }); }}
          onChart={(s) => onOpenChart?.(s, null)}
        />

        {/* Center: quote + chart + dock */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <QuoteHeader
            symbol={selected}
            quote={quote}
            exchange={exchange}
            onExchangeChange={setExchange}
            onBuy={() => setTicket({ side: 'buy' })}
            onSell={() => setTicket({ side: 'sell' })}
          />
          <div className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 420 }}>
            <AdvancedChart
              symbol={exchange === 'BSE' ? `${selected}.BO` : selected}
              onSymbolChange={setSelected}
              quote={quote}
            />
          </div>
          <div className="card">
            <div className="kite-dock-tabs">
              <button className={dockTab === 'positions' ? 'active' : ''} onClick={() => setDockTab('positions')}>Positions</button>
              <button className={dockTab === 'orders' ? 'active' : ''} onClick={() => setDockTab('orders')}>Orders</button>
            </div>
            <div style={{ paddingTop: 10 }}>
              {dockTab === 'positions'
                ? <PositionsBook quotes={quotes} onExit={exitPosition} compact />
                : <OrdersPage embedded />}
            </div>
          </div>
        </div>

        {/* Right rail: depth + order shortcuts + holdings snapshot */}
        <div className="kite-right-rail" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MarketDepth symbol={selected} depth={depth} ltp={quote?.price} />
          <div className="card" style={{ padding: 14 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>Order</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="kite-submit buy" style={{ flex: 1 }} onClick={() => setTicket({ side: 'buy' })}>BUY</button>
              <button className="kite-submit sell" style={{ flex: 1 }} onClick={() => setTicket({ side: 'sell' })}>SELL</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              CNC delivery · MIS intraday 5x (SQ-OFF 15:15) · NRML F&O overnight.<br />
              MARKET / LIMIT / SL / SL-M / GTT / IOC · Validity DAY/IOC · Disclosed qty.
            </div>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>Margin</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Available</div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--gain)' }}>
              ₹{Number(balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {(Object.keys(holdings || {}).length)} open holdings · valued live in Positions
            </div>
          </div>
        </div>
      </div>

      <OrderTicket
        isOpen={!!ticket}
        onClose={() => setTicket(null)}
        onTrade={async (p) => {
          const r = await onTrade(p);
          return r;
        }}
        initialSymbol={selected}
        initialSide={ticket?.side || 'buy'}
        initialPrice={ticket?.price || quote?.price || 0}
        initialExchange={exchange}
        quotes={quotes}
        holdings={holdings}
        balance={balance}
      />
    </div>
  );
}
