import React, { useState, useEffect } from 'react';
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './Terminal.css';

import AdvancedChart from '../Chart/AdvancedChart';
import OptionChainPage from '../OptionChain/OptionChainPage';
import OrdersPage from '../Orders/OrdersPage';
import api from '../../services/api';

// Keyboard hooks
function useKeyboardShortcut(key, callback, modifier = null) {
  useEffect(() => {
    const handler = (e) => {
      // Don't trigger if typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      
      const modMatch = modifier ? e[modifier] : true;
      if (e.key.toLowerCase() === key.toLowerCase() && modMatch) {
        e.preventDefault();
        callback(e);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [key, callback, modifier]);
}

export default function TerminalPage({ quotes, onTrade, balance, user }) {
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  
  // Layout state
  const [layout, setLayout] = useState([
    { i: 'chart', x: 0, y: 0, w: 8, h: 12 },
    { i: 'order_entry', x: 8, y: 0, w: 4, h: 5 },
    { i: 'market_depth', x: 8, y: 5, w: 4, h: 7 },
    { i: 'orders', x: 0, y: 12, w: 6, h: 8 },
    { i: 'options', x: 6, y: 12, w: 6, h: 8 },
    { i: 'risk_manager', x: 0, y: 20, w: 12, h: 4 }
  ]);

  // Order Entry State
  const [orderSide, setOrderSide] = useState('BUY');
  const [orderType, setOrderType] = useState('MARKET');
  const [productType, setProductType] = useState('INTRADAY'); // MIS
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState('');
  
  // Shortcuts
  useKeyboardShortcut('b', () => setOrderSide('BUY'));
  useKeyboardShortcut('s', () => setOrderSide('SELL'));
  useKeyboardShortcut('Escape', () => { setQty(1); setPrice(''); });

  const quote = quotes?.[symbol] || {};
  const currentPrice = quote.price || 0;

  const handlePlaceOrder = async () => {
    if (!onTrade) return;
    try {
      await onTrade({
        symbol,
        type: orderSide,
        quantity: Number(qty),
        price: orderType === 'MARKET' ? currentPrice : Number(price),
        orderType: orderType,
        productType: productType
      });
      // Reset
      setQty(1);
      setPrice('');
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  };

// ── Extract Market Depth ──
  const depth = marketDepth?.[symbol] || { bids: [], asks: [] };

// ── Risk Manager State & Logic ──
  const [killSwitch, setKillSwitch] = useState('DEACTIVATED');
  const [pnlProfit, setPnlProfit] = useState('');
  const [pnlLoss, setPnlLoss] = useState('');

  useEffect(() => {
    // Fetch initial status
    api.getKillSwitchStatus().then(res => setKillSwitch(res.data?.killSwitchStatus || 'DEACTIVATED')).catch(() => {});
    api.getPnlExit().then(res => {
      if (res.data) {
        setPnlProfit(res.data.profitValue || '');
        setPnlLoss(res.data.lossValue || '');
      }
    }).catch(() => {});
  }, []);

  const handleToggleKillSwitch = async () => {
    const nextStatus = killSwitch === 'ACTIVATE' ? 'DEACTIVATE' : 'ACTIVATE';
    if (nextStatus === 'ACTIVATE' && !window.confirm('Are you sure you want to ACTIVATE the Kill Switch? This will block all trades for the rest of the day and cannot be reversed!')) return;
    try {
      await api.setKillSwitch(nextStatus);
      setKillSwitch(nextStatus);
      alert('Kill Switch ' + nextStatus + 'D');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSetPnlExit = async () => {
    if (!pnlProfit || !pnlLoss) return alert('Enter both profit and loss targets');
    try {
      await api.setPnlExit({ profitValue: Number(pnlProfit), lossValue: Math.abs(Number(pnlLoss)), enableKillSwitch: true });
      alert('PnL Auto-Exit Configured Successfully!');
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2>Pro Terminal</h2>
          <input 
            className="terminal-symbol-input"
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            placeholder="Symbol (e.g. RELIANCE.NS)"
          />
          <span className={`terminal-price ${quote.change >= 0 ? 'profit' : 'loss'}`}>
            ₹{currentPrice.toFixed(2)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Shortcuts: <kbd>B</kbd> Buy <kbd>S</kbd> Sell <kbd>Esc</kbd> Reset
        </div>
      </div>

      <GridLayout 
        className="layout" 
        layout={layout} 
        cols={12} 
        rowHeight={30} 
        width={1200}
        draggableHandle=".panel-header"
        onLayoutChange={(l) => setLayout(l)}
      >
        {/* CHART PANEL */}
        <div key="chart" className="terminal-panel">
          <div className="panel-header">Chart : {symbol}</div>
          <div className="panel-content" style={{ padding: 0 }}>
             <AdvancedChart symbol={symbol} />
          </div>
        </div>

        {/* ORDER ENTRY PANEL */}
        <div key="order_entry" className="terminal-panel">
          <div className="panel-header" style={{ background: orderSide === 'BUY' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)' }}>
            Order Entry : {symbol}
          </div>
          <div className="panel-content terminal-form">
            <div className="form-row">
              <button className={`btn flex-1 ${orderSide === 'BUY' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setOrderSide('BUY')}>BUY</button>
              <button className={`btn flex-1 ${orderSide === 'SELL' ? 'btn-danger' : 'btn-outline'}`} onClick={() => setOrderSide('SELL')}>SELL</button>
            </div>
            
            <div className="form-row">
              <label>Product</label>
              <select value={productType} onChange={e => setProductType(e.target.value)} className="input-field">
                <option value="INTRADAY">MIS (Intraday 5x)</option>
                <option value="DELIVERY">CNC (Delivery 1x)</option>
                <option value="NRML">NRML (Overnight F&O)</option>
              </select>
            </div>

            <div className="form-row">
              <label>Type</label>
              <select value={orderType} onChange={e => setOrderType(e.target.value)} className="input-field">
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
                <option value="SL">Stop Loss</option>
              </select>
            </div>

            <div className="form-row">
              <label>Qty</label>
              <input type="number" className="input-field" value={qty} onChange={e => setQty(e.target.value)} min="1" />
            </div>

            {orderType !== 'MARKET' && (
              <div className="form-row">
                <label>Price</label>
                <input type="number" className="input-field" value={price} onChange={e => setPrice(e.target.value)} />
              </div>
            )}

            <button 
              className={`btn w-full ${orderSide === 'BUY' ? 'btn-primary' : 'btn-danger'}`} 
              style={{ marginTop: 12 }}
              onClick={handlePlaceOrder}
            >
              {orderSide} {symbol}
            </button>
          </div>
        </div>

        {/* L2 MARKET DEPTH */}
        <div key="market_depth" className="terminal-panel">
          <div className="panel-header">Market Depth (L2)</div>
          <div className="panel-content" style={{ display: 'flex' }}>
            <div style={{ flex: 1, borderRight: '1px solid var(--border-color)', paddingRight: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>BID</span><span>QTY</span>
              </div>
              {depth.bids.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-profit)' }}>
                  <span>{b.price.toFixed(2)}</span>
                  <span>{b.quantity}</span>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, paddingLeft: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>ASK</span><span>QTY</span>
              </div>
              {depth.asks.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-loss)' }}>
                  <span>{a.price.toFixed(2)}</span>
                  <span>{a.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ORDERS TRAY */}
        <div key="orders" className="terminal-panel">
          <div className="panel-header">Order Book</div>
          <div className="panel-content" style={{ overflowY: 'auto', padding: 0 }}>
            <OrdersPage inModal={true} />
          </div>
        </div>

        {/* OPTIONS CHAIN */}
        <div key="options" className="terminal-panel">
          <div className="panel-header">Options Chain</div>
          <div className="panel-content" style={{ overflowY: 'auto', padding: 0 }}>
            <OptionChainPage symbol={symbol} inModal={true} onTrade={onTrade} balance={balance} />
          </div>
        </div>

        {/* RISK MANAGER */}
        <div key="risk_manager" className="terminal-panel" style={{ border: '1px solid var(--color-danger)' }}>
          <div className="panel-header" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)' }}>
            ⚠️ Risk Manager (Dhan Trader Controls)
          </div>
          <div className="panel-content" style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: 14 }}>Kill Switch</h4>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Block all trading on your account for the remainder of the day to prevent overtrading.
              </p>
              <button 
                className={`btn ${killSwitch === 'ACTIVATE' ? 'btn-danger' : 'btn-outline'}`}
                onClick={handleToggleKillSwitch}
              >
                {killSwitch === 'ACTIVATE' ? 'KILL SWITCH ACTIVE (BLOCKED)' : 'ACTIVATE KILL SWITCH'}
              </button>
            </div>

            <div style={{ width: '1px', background: 'var(--border-color)', height: '100%' }}></div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>PnL Auto-Exit</h4>
              <div style={{ display: 'flex', gap: 10 }}>
                <input 
                  type="number" 
                  className="input-field" 
                  placeholder="Target Profit (₹)" 
                  value={pnlProfit}
                  onChange={e => setPnlProfit(e.target.value)}
                />
                <input 
                  type="number" 
                  className="input-field" 
                  placeholder="Max Loss (₹)" 
                  value={pnlLoss}
                  onChange={e => setPnlLoss(e.target.value)}
                />
                <button className="btn btn-primary" onClick={handleSetPnlExit}>Set Auto-Exit</button>
              </div>
            </div>

          </div>
        </div>

      </GridLayout>
    </div>
  );
}
