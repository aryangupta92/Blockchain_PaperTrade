import { useState, useEffect } from 'react';
import './Trading.css';
import { Zap, AlertCircle, CheckCircle, TrendingUp, Calendar, Clock } from 'lucide-react';
import api from '../../services/api';
import { checkPositionLimit, getMarketStatus } from '../../utils/sebi';

// Removed hardcoded STOCKS array so the UI never defaults to a limited list again.

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

function fmtPercent(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

export default function TradePage({ quotes, holdings, balance, onTrade, watchlist, onAddWatch }) {
  const [symbol, setSymbol] = useState(watchlist?.[0] || 'RELIANCE');
  const [quantity, setQuantity] = useState(1);
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [side, setSide] = useState('buy');
  const [tradeType, setTradeType] = useState('intraday'); // 'intraday' | 'delivery'
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { success, message, trade }
  const [error, setError] = useState('');
  const [chartData, setChartData] = useState([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [trades, setTrades] = useState([]);


  const liveQuote = quotes[symbol] || null;
  const livePrice = liveQuote?.price || 0;
  const execPrice = orderType === 'market' ? livePrice : (Number(limitPrice) || 0);
  const totalValue = execPrice * Number(quantity);
  const held = holdings[symbol]?.quantity || 0;
  const avgBuy = holdings[symbol]?.avgPrice || 0;
  const unrealizedPL =
    held === 0
      ? 0
      : held > 0
        ? (livePrice - avgBuy) * held
        : (avgBuy - livePrice) * Math.abs(held);

  // Load chart data for display
  useEffect(() => {
    if (!symbol) return;
    const loadChart = async () => {
      setLoadingChart(true);
      try {
        const data = await api.getCandles(symbol, '1d', '1m');
        setChartData(data || []);
      } catch (e) {
        console.error('Chart load error:', e);
      } finally {
        setLoadingChart(false);
      }
    };
    loadChart();
  }, [symbol]);

  // Get all trades for this symbol
  useEffect(() => {
    const loadTrades = async () => {
      try {
        const response = await api.executeTrade({ method: 'GET' }).catch(() => ({ trades: [] }));
        const symbolTrades = (response.trades || []).filter(t => t.symbol === symbol);
        setTrades(symbolTrades);
      } catch (e) {
        console.error('Trades load error:', e);
      }
    };
    loadTrades();
  }, [symbol]);

  // SEBI validations
  const validateTrade = () => {
    const errors = [];
    
    if (!execPrice) { errors.push('Price not available'); }
    if (Number(quantity) <= 0) { errors.push('Invalid quantity'); }
    
    // Check position limit
    if (side === 'buy') {
      const posLimit = checkPositionLimit(symbol, totalValue, Math.abs(held) * avgBuy, balance);
      if (!posLimit.allowed) { errors.push(posLimit.reason); }
    }
    
    // Check balance for buy orders
    if (side === 'buy' && balance < totalValue) {
      errors.push('Insufficient balance for this trade');
    }
    
    // Check quantity for sell
    if (side === 'sell' && held < quantity) {
      errors.push(`Cannot sell ${quantity} shares. You hold only ${held} shares.`);
    }
    
    // Intraday settlement rule: must close before market close
    if (tradeType === 'intraday') {
      const status = getMarketStatus();
      if (!status.open) {
        errors.push('Intraday trades can only be placed during market hours (9:15 AM - 3:30 PM)');
      }
    }
    
    return errors;
  };

  const handleTrade = async () => {
    setError('');
    setResult(null);
    
    const validationErrors = validateTrade();
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }
    
    setLoading(true);
    try {
      const trade = await onTrade({ 
        type: side, 
        symbol, 
        quantity: Number(quantity), 
        price: execPrice, 
        orderType,
        tradeType 
      });
      setResult({ 
        success: true, 
        message: `${side.toUpperCase()} order for ${quantity} x ${symbol} @ ₹${fmtPrice(execPrice)} (${tradeType}) executed!`, 
        trade 
      });
      setQuantity(1);
      setLimitPrice('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Get entry price for current position
  const entryPrice = held !== 0 ? avgBuy : null;
  const pnlPercent = held !== 0 ? ((livePrice - avgBuy) / avgBuy) * 100 : 0;

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
              {held !== 0 && (
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-muted)' }}>
                  Position: {held > 0 ? held : `-${Math.abs(held)} (SHORT)`} @ ₹{fmtPrice(avgBuy)}
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

        {/* Trade Type Selector - INTRADAY vs DELIVERY */}
        <div className="form-group">
          <label className="form-label">Trade Type</label>
          <div className="tabs">
            <button 
              className={`tab ${tradeType === 'intraday' ? 'active' : ''}`} 
              onClick={() => setTradeType('intraday')}
              title="Position must be squared off same day"
            >
              <Clock size={13} style={{ marginRight: 4 }} />
              Intraday
            </button>
            <button 
              className={`tab ${tradeType === 'delivery' ? 'active' : ''}`} 
              onClick={() => setTradeType('delivery')}
              title="Hold position for multiple days"
            >
              <Calendar size={13} style={{ marginRight: 4 }} />
              Delivery
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            {tradeType === 'intraday' 
              ? 'Must close before market close (3:30 PM)' 
              : 'Can hold for multiple days'}
          </div>
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

      {/* Right: Holdings + Chart + Watchlist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        {/* Chart Display with Entry Price and PnL */}
        <div className="card chart-container" style={{ minHeight: 300 }}>
          <div className="section-header">
            <TrendingUp size={16} style={{ color: 'var(--accent-primary)' }} />
            <span className="section-title">{symbol} Price Action</span>
          </div>
          
          {held !== 0 && (
            <div style={{ padding: '8px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid var(--gain)', borderRadius: 6, marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Entry Price</div>
                  <div style={{ fontWeight: 800, fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(entryPrice)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Current P&L</div>
                  <div style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', color: pnlPercent >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                    {fmtPercent(pnlPercent)} (₹{fmtPrice(unrealizedPL)})
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {loadingChart ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            </div>
          ) : chartData.length > 0 ? (
            <div style={{ height: 240, background: 'var(--bg-layer)', borderRadius: 6, padding: 8, position: 'relative' }}>
              {/* Simplified Candle View */}
              <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', gap: 1 }}>
                {(() => {
                  const recentData = chartData.slice(-50);
                  const high = Math.max(...recentData.map(c => c.high));
                  const low = Math.min(...recentData.map(c => c.low));
                  const range = high - low || 1;
                  
                  return (
                    <>
                      {recentData.map((candle, idx) => {
                        const candleHigh = ((candle.high - low) / range) * 220;
                        const candleLow = ((candle.low - low) / range) * 220;
                        const isUp = candle.close >= candle.open;
                        return (
                          <div
                            key={idx}
                            style={{
                              flex: 1,
                              position: 'relative',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'flex-end',
                              justifyContent: 'center',
                            }}
                          >
                            {/* Wick */}
                            <div style={{
                              position: 'absolute',
                              bottom: `calc(${candleLow}px)`,
                              width: 1,
                              height: `${candleHigh - candleLow}px`,
                              background: isUp ? 'var(--gain)' : 'var(--loss)',
                              opacity: 0.5,
                            }} />
                            {/* Body */}
                            <div style={{
                              width: '60%',
                              height: `${Math.abs(candle.close - candle.open) / range * 220 || 2}px`,
                              background: isUp ? 'var(--gain)' : 'var(--loss)',
                              borderRadius: 1,
                              marginBottom: `${(Math.min(candle.open, candle.close) - low) / range * 220}px`,
                            }} />
                          </div>
                        );
                      })}
                      
                      {/* Entry Line with PnL */}
                      {held !== 0 && entryPrice !== null && (
                        <div style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: `calc(${Math.max(0, Math.min(220, ((entryPrice - low) / range) * 220))}px + 8px)`,
                          borderTop: `1px dashed ${pnlPercent >= 0 ? 'var(--gain)' : 'var(--loss)'}`,
                          opacity: 0.8,
                          zIndex: 10,
                          pointerEvents: 'none'
                        }}>
                          <div style={{
                            position: 'absolute',
                            right: 4,
                            top: -20,
                            background: pnlPercent >= 0 ? 'var(--gain)' : 'var(--loss)',
                            color: '#000',
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontFamily: 'var(--font-mono)'
                          }}>
                            Entry: ₹{fmtPrice(entryPrice)} | P&L: {fmtPercent(pnlPercent)}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No chart data available
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="card">
          <div className="section-header">
            <span className="section-title">Your {symbol} Position</span>
          </div>
          {held !== 0 ? (
            <div className="position-stats">
              <div className="stat-box">
                <div className="stat-label">Quantity</div>
                <div className="stat-value">{held > 0 ? held : `-${Math.abs(held)} (SHORT)`}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Avg Price</div>
                <div className="stat-value">₹{fmtPrice(avgBuy)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Invested</div>
                <div className="stat-value">₹{fmtPrice(Math.abs(held) * avgBuy)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Current Value</div>
                <div className="stat-value">₹{fmtPrice(Math.abs(held) * livePrice)}</div>
              </div>
              <div className="stat-box" style={{ gridColumn: '1/-1' }}>
                <div className="stat-label">Unrealized P&L</div>
                <div className={`stat-value big ${unrealizedPL >= 0 ? 'gain' : 'loss'}`}>
                  {unrealizedPL >= 0 ? '+' : ''}₹{Math.abs(unrealizedPL).toFixed(2)}
                  <span style={{ fontSize: 13, marginLeft: 6 }}>
                    ({fmtPercent(pnlPercent)})
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
