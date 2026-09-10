import { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, XCircle } from 'lucide-react';
import api from '../../services/api';

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

const STATUS_COLORS = {
  FILLED:    { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  OPEN:      { bg: 'rgba(99,102,241,0.15)',  color: '#6366f1' },
  PENDING:   { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  CANCELLED: { bg: 'rgba(100,116,139,0.15)', color: '#64748b' },
  REJECTED:  { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444' },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [tab, setTab] = useState('orders'); // 'orders' | 'trades'
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordRes, tradeRes] = await Promise.all([
        api.getOrders(),
        api.getTrades(50, 0),
      ]);
      setOrders(ordRes.orders || []);
      setTrades(tradeRes.trades || []);
    } catch (e) {
      console.error('Orders load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCancel = async (orderId) => {
    setCancelling(orderId);
    try {
      await api.cancelOrder(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'CANCELLED' } : o));
    } catch (e) {
      alert(e.message);
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClipboardList size={18} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Order Book</h2>
        </div>
        <button
          className="btn btn-ghost"
          onClick={loadData}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
          Orders ({orders.length})
        </button>
        <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>
          Executions ({trades.length})
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }} />
          </div>
        ) : tab === 'orders' ? (
          orders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              No orders yet. Place a trade to see your order book.
            </div>
          ) : (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Side</th>
                    <th>Symbol</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Price</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const isBuy = order.side === 'BUY';
                    const statusStyle = STATUS_COLORS[order.status] || {};
                    const canCancel = ['PENDING', 'OPEN'].includes(order.status);
                    return (
                      <tr key={order.id}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {order.id.slice(0, 8)}…
                        </td>
                        <td>
                          <span className={`mover-change-pill ${isBuy ? 'gain' : 'loss'}`}>
                            {order.side}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{order.instrument?.tradingSymbol || '—'}</td>
                        <td style={{ fontSize: 11 }}>{order.orderType}</td>
                        <td style={{ textAlign: 'right' }}>{order.quantity}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(order.price)}</td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: statusStyle.bg, color: statusStyle.color }}>
                            {order.status}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(order.createdAt).toLocaleString('en-IN')}
                        </td>
                        <td>
                          {canCancel && (
                            <button
                              onClick={() => handleCancel(order.id)}
                              disabled={cancelling === order.id}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--loss)', padding: 4 }}
                              title="Cancel order"
                            >
                              <XCircle size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          trades.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              No trade executions yet.
            </div>
          ) : (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Symbol</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Price</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Block #</th>
                    <th>Block Hash</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => {
                    const isBuy = trade.side === 'BUY';
                    return (
                      <tr key={trade.id}>
                        <td>
                          <span className={`mover-change-pill ${isBuy ? 'gain' : 'loss'}`}>
                            {trade.side}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{trade.instrument?.tradingSymbol || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{trade.quantity}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(trade.price)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{fmtPrice(trade.totalValue)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>
                          #{trade.blockIndex ?? '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                          {trade.blockHash ? trade.blockHash.slice(0, 14) + '…' : '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(trade.executedAt).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
