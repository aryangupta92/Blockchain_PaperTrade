import { useState } from 'react';
import './Trading.css';
import { Zap, AlertCircle, CheckCircle } from 'lucide-react';

// Removed hardcoded STOCKS array so the UI never defaults to a limited list again.

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

export default function TradePage({ quotes, holdings, balance, onTrade, watchlist, onAddWatch }) {
  const [symbol, setSymbol] = useState(watchlist?.[0] || 'RELIANCE');
  const [quantity, setQuantity] = useState(1);
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [side, setSide] = useState('buy');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { success, message, trade }
  const [error, setError] = useState('');

  const liveQuote = quotes[symbol] || null;
  const livePrice = liveQuote?.price || 0;
  const execPrice = orderType === 'market' ? livePrice : (Number(limitPrice) || 0);
  const totalValue = execPrice * Number(quantity);
  const held = holdings[symbol]?.quantity || 0;
  const avgBuy = holdings[symbol]?.avgPrice || 0;
  const unrealizedPL = held > 0 ? (livePrice - avgBuy) * held : 0;

  const handleTrade = async () => {
    setError('');
    setResult(null);
    if (!execPrice) { setError('Price not available'); return; }
    if (Number(quantity) <= 0) { setError('Invalid quantity'); return; }
    setLoading(true);
    try {
      const trade = await onTrade({ type: side, symbol, quantity: Number(quantity), price: execPrice, orderType });
      setResult({ success: true, message: `${side.toUpperCase()} order for ${quantity} x ${symbol} @ ₹${fmtPrice(execPrice)} executed!`, trade });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="trade-page">
      {/* Left: Order Panel */}
      <div className="card trade-panel">
        <div className="trade-panel-header">
          <Zap size={16} style={{ color: 'var(--accent-primary)' }} />
          <span>Place Order</span>
        </div>

        {/* Symbol Display */}
        <div className="form-group">
          <label className="form-label">Selected Symbol</label>
          <div className="input" style={{ background: 'var(--bg-layer)', border: 'none', fontWeight: 'bold' }}>
            {symbol}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Search from TopBar or click Watchlist to change.
          </div>
        </div>

        {/* Live Price */}
        {liveQuote && (
          <div className="live-price-box">
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Market Price</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: liveQuote.changePercent >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                ₹{fmtPrice(livePrice)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={`mover-change-pill ${liveQuote.changePercent >= 0 ? 'gain' : 'loss'}`}>
                {liveQuote.changePercent >= 0 ? '+' : ''}{liveQuote.changePercent?.toFixed(2)}%
              </div>
              {held > 0 && (
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-muted)' }}>
                  Holding: {held} @ ₹{fmtPrice(avgBuy)}
                  <span className={unrealizedPL >= 0 ? 'gain' : 'loss'} style={{ marginLeft: 4 }}>
                    ({unrealizedPL >= 0 ? '+' : ''}₹{Math.abs(unrealizedPL).toFixed(0)})
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Buy / Sell Tabs */}
        <div className="trade-side-toggle">
          <button className={`side-btn buy-btn ${side === 'buy' ? 'active' : ''}`} onClick={() => setSide('buy')}>BUY</button>
          <button className={`side-btn sell-btn ${side === 'sell' ? 'active' : ''}`} onClick={() => setSide('sell')}>SELL</button>
        </div>

        {/* Order Type */}
        <div className="form-group">
          <label className="form-label">Order Type</label>
          <div className="tabs">
            <button className={`tab ${orderType === 'market' ? 'active' : ''}`} onClick={() => setOrderType('market')}>Market</button>
            <button className={`tab ${orderType === 'limit' ? 'active' : ''}`} onClick={() => setOrderType('limit')}>Limit</button>
          </div>
        </div>

        {/* Limit Price */}
        {orderType === 'limit' && (
          <div className="form-group">
            <label className="form-label">Limit Price (₹)</label>
            <input type="number" className="input" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} placeholder="Enter limit price" />
          </div>
        )}

        {/* Quantity */}
        <div className="form-group">
          <label className="form-label">Quantity</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" style={{ padding: '7px 12px' }} onClick={() => setQuantity(q => Math.max(1, Number(q) - 1))}>−</button>
            <input type="number" className="input" value={quantity} onChange={e => setQuantity(e.target.value)} min={1} style={{ textAlign: 'center' }} />
            <button className="btn btn-ghost" style={{ padding: '7px 12px' }} onClick={() => setQuantity(q => Number(q) + 1)}>+</button>
          </div>
        </div>

        {/* Order Summary */}
        <div className="order-summary">
          <div className="summary-row"><span>Price</span><span>₹{fmtPrice(execPrice)}</span></div>
          <div className="summary-row"><span>Quantity</span><span>{quantity}</span></div>
          <div className="summary-row total"><span>Total Value</span><span>₹{fmtPrice(totalValue)}</span></div>
          {side === 'buy' && (
            <div className="summary-row"><span>Available Balance</span><span className={balance < totalValue ? 'loss' : 'gain'}>₹{fmtPrice(balance)}</span></div>
          )}
        </div>

        {/* Error / Result */}
        {error && (
          <div className="trade-alert error">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        {result?.success && (
          <div className="trade-alert success">
            <CheckCircle size={14} />
            {result.message}
            {result.trade?.blockHash && (
              <div style={{ fontSize: 10, marginTop: 4, fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
                Block #{result.trade.blockIndex} · {result.trade.blockHash?.slice(0, 20)}…
              </div>
            )}
          </div>
        )}

        {/* Execute Button */}
        <button
          className={side === 'buy' ? 'btn-gain' : 'btn-loss'}
          onClick={handleTrade}
          disabled={loading || !execPrice}
          style={{ marginTop: 8 }}
        >
          {loading ? 'Executing…' : `${side === 'buy' ? '▲ BUY' : '▼ SELL'} ${symbol}`}
        </button>
      </div>

      {/* Right: Holdings for this stock + Watchlist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        {/* Quick Stats */}
        <div className="card">
          <div className="section-header">
            <span className="section-title">Your {symbol} Position</span>
          </div>
          {held > 0 ? (
            <div className="position-stats">
              <div className="stat-box">
                <div className="stat-label">Quantity</div>
                <div className="stat-value">{held}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Avg Price</div>
                <div className="stat-value">₹{fmtPrice(avgBuy)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Invested</div>
                <div className="stat-value">₹{fmtPrice(held * avgBuy)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Current Value</div>
                <div className="stat-value">₹{fmtPrice(held * livePrice)}</div>
              </div>
              <div className="stat-box" style={{ gridColumn: '1/-1' }}>
                <div className="stat-label">Unrealized P&L</div>
                <div className={`stat-value big ${unrealizedPL >= 0 ? 'gain' : 'loss'}`}>
                  {unrealizedPL >= 0 ? '+' : ''}₹{Math.abs(unrealizedPL).toFixed(2)}
                  <span style={{ fontSize: 13, marginLeft: 6 }}>
                    ({((unrealizedPL / (held * avgBuy)) * 100).toFixed(2)}%)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              No position in {symbol}. Place a BUY order to start.
            </div>
          )}
        </div>

        {/* Watchlist quick view */}
        <div className="card">
          <div className="section-title" style={{ marginBottom: 10 }}>Watchlist</div>
          {watchlist.slice(0, 8).map(s => {
            const q = quotes[s];
            return (
              <div key={s} className="watchlist-row" onClick={() => setSymbol(s)}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s}</span>
                <div style={{ display: 'flex', align: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {q ? '₹' + fmtPrice(q.price) : '—'}
                  </span>
                  {q && (
                    <span className={q.changePercent >= 0 ? 'gain' : 'loss'} style={{ fontSize: 11, fontWeight: 600 }}>
                      {q.changePercent >= 0 ? '+' : ''}{q.changePercent?.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
