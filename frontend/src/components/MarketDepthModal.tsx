import { useEffect, useState } from 'react';
import { BarChart2, Layers, X } from 'lucide-react';
import { api, formatINR, getMarketWsUrl } from '../apiClient';

interface DepthLevel {
  price: string;
  quantity: number;
  orders: number;
}

interface MarketDepthModalProps {
  symbol: string;
  segment: string;
  onClose: () => void;
  onSelectPrice: (symbol: string, side: 'BUY' | 'SELL', segment: string, price: string) => void;
}

export function MarketDepthModal({ symbol, segment, onClose, onSelectPrice }: MarketDepthModalProps) {
  const [depthMode, setDepthMode] = useState<'5' | '20'>('5');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof api.quotes>>['quotes'][number] | null>(null);
  const [depth20, setDepth20] = useState<{ bids: DepthLevel[]; asks: DepthLevel[] } | null>(null);
  const [wsLive, setWsLive] = useState(false);

  useEffect(() => {
    api.quotes([symbol]).then((res) => {
      if (res.quotes[0]) setQuote(res.quotes[0]);
    }).catch(() => {});
  }, [symbol]);

  useEffect(() => {
    const ws = new WebSocket(getMarketWsUrl());
    ws.onopen = () => {
      setWsLive(true);
      ws.send(JSON.stringify({ action: 'subscribe', symbols: [symbol] }));
      if (depthMode === '20') {
        ws.send(JSON.stringify({ action: 'subscribe_depth20', symbol }));
      }
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'quote' && msg.data?.symbol?.toUpperCase() === symbol.toUpperCase()) {
          setQuote(msg.data);
        } else if (msg.type === 'depth20' && msg.data) {
          setDepth20({
            bids: (msg.data.bids || []).map((b: { price: number | string; quantity: number; orders: number }) => ({
              price: String(b.price),
              quantity: b.quantity,
              orders: b.orders,
            })),
            asks: (msg.data.asks || []).map((a: { price: number | string; quantity: number; orders: number }) => ({
              price: String(a.price),
              quantity: a.quantity,
              orders: a.orders,
            })),
          });
        }
      } catch {
        // ignore
      }
    };
    ws.onclose = () => setWsLive(false);
    return () => {
      if (depthMode === '20' && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'unsubscribe_depth20', symbol }));
      }
      ws.close();
    };
  }, [symbol, depthMode]);

  const bids: DepthLevel[] = depthMode === '20' && depth20?.bids.length ? depth20.bids.slice(0, 20) : (quote?.bidDepth || []).slice(0, 5);
  const asks: DepthLevel[] = depthMode === '20' && depth20?.asks.length ? depth20.asks.slice(0, 20) : (quote?.askDepth || []).slice(0, 5);

  const totalBidQty = quote?.totalBuyQty || bids.reduce((s, b) => s + (b.quantity || 0), 0);
  const totalAskQty = quote?.totalSellQty || asks.reduce((s, a) => s + (a.quantity || 0), 0);
  const maxRowQty = Math.max(1, ...bids.map((b) => b.quantity), ...asks.map((a) => a.quantity));
  const buyPct = totalBidQty + totalAskQty > 0 ? Math.round((totalBidQty / (totalBidQty + totalAskQty)) * 100) : 50;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={16} color="var(--active-mode-accent)" />
            <strong style={{ fontSize: 16 }}>{symbol}</strong>
            <span className="mono" style={{ fontSize: 15, fontWeight: 800 }}>
              {quote?.ltp ? formatINR(quote.ltp) : '—'}
            </span>
            {quote?.changePercent && (
              <span className="mono" style={{ fontSize: 12, color: Number(quote.changePercent) >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                {Number(quote.changePercent) >= 0 ? '+' : ''}{quote.changePercent}%
              </span>
            )}
            <span className={`badge ${wsLive ? 'badge-gain' : 'badge-warn'}`}>{wsLive ? 'LIVE' : 'SNAPSHOT'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`preset-btn ${depthMode === '5' ? 'active' : ''}`} onClick={() => setDepthMode('5')}>5-Level</button>
            <button className={`preset-btn ${depthMode === '20' ? 'active' : ''}`} onClick={() => setDepthMode('20')}>20-Level L3</button>
            <button className="theme-toggle" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        {/* Buy vs Sell Pressure Gauge */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--gain)', fontWeight: 700 }}>Buy Qty: {totalBidQty.toLocaleString('en-IN')} ({buyPct}%)</span>
            <span style={{ color: 'var(--loss)', fontWeight: 700 }}>Sell Qty: {totalAskQty.toLocaleString('en-IN')} ({100 - buyPct}%)</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--loss)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${buyPct}%`, background: 'var(--gain)', transition: 'width 0.3s ease' }} />
          </div>
        </div>

        {/* Depth Ladder Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1fr', padding: '5px 6px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
              <span>BID</span>
              <span style={{ textAlign: 'center' }}>ORD</span>
              <span style={{ textAlign: 'right' }}>QTY</span>
            </div>
            {bids.length === 0 ? (
              <div style={{ padding: 12, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>Awaiting bid depth...</div>
            ) : (
              bids.map((b, i) => (
                <div
                  key={i}
                  className="depth-row mono"
                  title="Click to open BUY limit at this price"
                  onClick={() => onSelectPrice(symbol, 'BUY', segment, b.price)}
                >
                  <div className="depth-bar-bid" style={{ width: `${Math.min(100, (b.quantity / maxRowQty) * 100)}%` }} />
                  <span style={{ color: 'var(--gain)', fontWeight: 700, position: 'relative' }}>{b.price}</span>
                  <span style={{ textAlign: 'center', color: 'var(--text-muted)', position: 'relative' }}>{b.orders}</span>
                  <span style={{ textAlign: 'right', position: 'relative' }}>{b.quantity.toLocaleString('en-IN')}</span>
                </div>
              ))
            )}
          </div>

          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1fr', padding: '5px 6px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
              <span>ASK</span>
              <span style={{ textAlign: 'center' }}>ORD</span>
              <span style={{ textAlign: 'right' }}>QTY</span>
            </div>
            {asks.length === 0 ? (
              <div style={{ padding: 12, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>Awaiting ask depth...</div>
            ) : (
              asks.map((a, i) => (
                <div
                  key={i}
                  className="depth-row mono"
                  title="Click to open SELL limit at this price"
                  onClick={() => onSelectPrice(symbol, 'SELL', segment, a.price)}
                >
                  <div className="depth-bar-ask" style={{ width: `${Math.min(100, (a.quantity / maxRowQty) * 100)}%` }} />
                  <span style={{ color: 'var(--loss)', fontWeight: 700, position: 'relative' }}>{a.price}</span>
                  <span style={{ textAlign: 'center', color: 'var(--text-muted)', position: 'relative' }}>{a.orders}</span>
                  <span style={{ textAlign: 'right', position: 'relative' }}>{a.quantity.toLocaleString('en-IN')}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* OHLC, ATP, Circuits & 52W Range */}
        {quote && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11.5, background: 'var(--bg-elevated)', padding: 10, borderRadius: 8 }}>
            <div>Open: <strong className="mono">{quote.open ?? '—'}</strong></div>
            <div>High: <strong className="mono">{quote.high ?? '—'}</strong></div>
            <div>Low: <strong className="mono">{quote.low ?? '—'}</strong></div>
            <div>Prev Close: <strong className="mono">{quote.prevClose ?? '—'}</strong></div>
            <div>ATP/VWAP: <strong className="mono">{quote.vwap ?? '—'}</strong></div>
            <div>Volume: <strong className="mono">{quote.volume?.toLocaleString('en-IN') ?? '—'}</strong></div>
            <div>Upper Ckt: <strong className="mono" style={{ color: 'var(--gain)' }}>{quote.upperCircuit ?? '—'}</strong></div>
            <div>Lower Ckt: <strong className="mono" style={{ color: 'var(--loss)' }}>{quote.lowerCircuit ?? '—'}</strong></div>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><BarChart2 size={12} style={{ verticalAlign: 'middle' }} /> Click any Bid/Ask price row to prefill Limit Order Ticket.</span>
          {depthMode === '20' && !depth20?.bids.length && <span>20-Level live stream populates during active exchange ticks.</span>}
        </div>
      </div>
    </div>
  );
}
