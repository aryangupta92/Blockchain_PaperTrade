import { useState } from 'react';
import KiteWatchlist from './KiteWatchlist';
import QuoteHeader from './QuoteHeader';
import MarketDepth from './MarketDepth';
import SessionBanner from './SessionBanner';
import OrderTicket from '../Trading/OrderTicket';
import './Kite.css';

// Kite home: left watchlist · centre quote + market depth + quick trade
export default function DashboardPage({
  quotes, marketDepth, watchlists, activeListId, onAddWatch, onRemoveWatch,
  onAddList, onRenameList, onDeleteList, onSelectList,
  holdings, balance, onTrade, onOpenChart, onNav,
}) {
  const activeList = (watchlists || []).find(l => l.id === activeListId) || watchlists?.[0];
  const activeSymbols = activeList?.symbols || [];
  const [selected, setSelected] = useState(activeSymbols[0] || 'RELIANCE');
  const [exchange, setExchange] = useState('NSE');
  const [ticket, setTicket] = useState(null); // { side, price }

  // Switching watchlist tabs should fall back to a symbol that belongs to it.
  const activeSymbol = activeSymbols.includes(selected) ? selected : (activeSymbols[0] || 'RELIANCE');
  const quote = quotes[activeSymbol] || quotes[`${activeSymbol}.NS`] || null;
  const depth = marketDepth?.[activeSymbol] || marketDepth?.[`${activeSymbol}.NS`] || null;

  return (
    <div>
      <SessionBanner />
      <div className="kite-dashboard">
        {/* Left: Kite watchlist */}
        <KiteWatchlist
          quotes={quotes}
          watchlists={watchlists}
          activeListId={activeList?.id}
          onSelectList={onSelectList}
          onAddList={onAddList}
          onRenameList={onRenameList}
          onDeleteList={onDeleteList}
          onAdd={onAddWatch}
          onRemove={onRemoveWatch}
          selected={activeSymbol}
          onSelect={setSelected}
          onBuy={(s) => { setSelected(s); setTicket({ side: 'buy' }); }}
          onSell={(s) => { setSelected(s); setTicket({ side: 'sell' }); }}
          onChart={(s) => onOpenChart?.(s, null)}
        />

        {/* Center: quote + depth + quick trade */}
        <div className="kite-main">
          <QuoteHeader
            symbol={activeSymbol}
            quote={quote}
            exchange={exchange}
            onExchangeChange={setExchange}
            onBuy={() => setTicket({ side: 'buy' })}
            onSell={() => setTicket({ side: 'sell' })}
            onOpenChart={() => onOpenChart?.(activeSymbol, quote)}
          />

          <div className="kite-main-grid">
            <MarketDepth
              symbol={activeSymbol}
              depth={depth}
              ltp={quote?.price}
              onOpenSettings={() => onNav?.('settings')}
            />

            <div className="card kite-quick-trade">
              <div className="section-title" style={{ marginBottom: 8 }}>Quick Trade</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="kite-submit buy" style={{ flex: 1 }} onClick={() => setTicket({ side: 'buy' })}>BUY</button>
                <button className="kite-submit sell" style={{ flex: 1 }} onClick={() => setTicket({ side: 'sell' })}>SELL</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                CNC delivery · MIS intraday · NRML F&amp;O overnight.<br />
                MARKET / LIMIT / SL / SL-M · Validity DAY/IOC.
              </div>
              <button className="kite-chart-link" style={{ marginTop: 12 }} onClick={() => onOpenChart?.(activeSymbol, quote)}>
                Open full chart
              </button>
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
        initialSymbol={activeSymbol}
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
