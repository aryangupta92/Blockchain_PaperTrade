import { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, XCircle, Pencil } from 'lucide-react';
import api from '../../services/api';
import OrderTicket from '../Trading/OrderTicket';
import '../Broker/Kite.css';

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

const STATUS_COLORS = {
  FILLED:    { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
  OPEN:      { bg: 'rgba(56,126,209,0.15)',  color: '#5b9bd5' },
  PENDING:   { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  TRIGGER_PENDING: { bg: 'rgba(245,158,11,0.18)', color: '#f59e0b' },
  CANCELLED: { bg: 'rgba(100,116,139,0.15)', color: '#64748b' },
  REJECTED:  { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444' },
};

const isOpenStatus = (s) => ['PENDING', 'OPEN', 'TRIGGER_PENDING'].includes(s);
const isGtt = (o) => o.orderType === 'GTT' || o.validity === 'GTT';
// AMO heuristic: order created outside 09:15–15:30 IST on a weekday
function isAmoOrder(createdAt) {
  try {
    const ist = new Date(new Date(createdAt).getTime() + 5.5 * 60 * 60 * 1000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const weekday = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5;
    return !weekday || mins < 555 || mins > 930;
  } catch { return false; }
}

// Kite parity order book: Open / Completed / Rejected+Cancelled tabs, Modify, GTT section, AMO badges
export default function OrdersPage({ embedded }) {
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [tab, setTab] = useState('open'); // open | completed | cancelled | gtt | trades
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);
  const [modifyTarget, setModifyTarget] = useState(null);

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
    if (!window.confirm('Cancel this order?')) return;
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

  const openOrders = orders.filter(o => isOpenStatus(o.status));
  const completed = orders.filter(o => o.status === 'FILLED');
  const cancelled = orders.filter(o => ['CANCELLED', 'REJECTED'].includes(o.status));
  const gttOrders = orders.filter(isGtt);

  const list = tab === 'open' ? openOrders : tab === 'completed' ? completed : tab === 'cancelled' ? cancelled : tab === 'gtt' ? gttOrders : [];

  const OrderRow = (order) => {
    const isBuy = order.side === 'BUY';
    const statusStyle = STATUS_COLORS[order.status] || {};
    const canModify = isOpenStatus(order.status);
    const amo = isAmoOrder(order.createdAt);
    return (
      <tr key={order.id}>
        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
          {order.id.slice(0, 8)}…
          <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
            {amo && <span className="kite-amo-badge">AMO</span>}
            {isGtt(order) && <span className="kite-chip nrml">GTT</span>}
          </div>
        </td>
        <td>
          <span className={`mover-change-pill ${isBuy ? 'gain' : 'loss'}`}>{order.side}</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            {order.productType} · {order.orderType}{order.triggerPrice ? ` · Trig ₹${fmtPrice(order.triggerPrice)}` : ''}
          </div>
        </td>
        <td style={{ fontWeight: 700 }}>
          {order.instrument?.tradingSymbol || '—'}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
            {order.instrument?.exchange || 'NSE'} · {order.validity || 'DAY'}{order.disclosedQuantity ? ` · Disc ${order.disclosedQuantity}` : ''}
          </div>
        </td>
        <td style={{ textAlign: 'right' }}>{order.quantity}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(order.price)}</td>
        <td>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: statusStyle.bg, color: statusStyle.color }}>
            {order.status.replace('_', ' ')}
          </span>
          {order.rejectionReason && <div style={{ fontSize: 10, color: 'var(--loss)', marginTop: 3, maxWidth: 220 }}>{order.rejectionReason}</div>}
        </td>
        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {canModify && (
            <>
              <button className="kite-action-link" title="Modify price/qty/trigger (Kite parity)" onClick={() => setModifyTarget(order)}>
                <Pencil size={14} style={{ verticalAlign: -2 }} /> Modify
              </button>
              <button
                onClick={() => handleCancel(order.id)}
                disabled={cancelling === order.id}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--loss)', padding: 4 }}
                title="Cancel order"
              >
                <XCircle size={15} />
              </button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Order Book</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>DAY expires 15:30 · MIS SQ-OFF 15:15 · AMO queued for 09:15</span>
          </div>
          <button className="btn btn-ghost" onClick={loadData} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 12, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>Open ({openOrders.length})</button>
        <button className={`tab ${tab === 'completed' ? 'active' : ''}`} onClick={() => setTab('completed')}>Completed ({completed.length})</button>
        <button className={`tab ${tab === 'cancelled' ? 'active' : ''}`} onClick={() => setTab('cancelled')}>Cancelled / Rejected ({cancelled.length})</button>
        <button className={`tab ${tab === 'gtt' ? 'active' : ''}`} onClick={() => setTab('gtt')}>GTT ({gttOrders.length})</button>
        <button className={`tab ${tab === 'trades' ? 'active' : ''}`} onClick={() => setTab('trades')}>Executions ({trades.length})</button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>
        ) : tab === 'trades' ? (
          trades.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No trade executions yet.</div>
          ) : (
            <div className="scroll-x">
              <table className="data-table">
                <thead><tr><th>Side</th><th>Symbol</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Charges</th><th>Block #</th><th>Time</th></tr></thead>
                <tbody>
                  {trades.map((trade) => {
                    const isBuy = trade.side === 'BUY';
                    return (
                      <tr key={trade.id}>
                        <td><span className={`mover-change-pill ${isBuy ? 'gain' : 'loss'}`}>{trade.side}</span></td>
                        <td style={{ fontWeight: 700 }}>{trade.instrument?.tradingSymbol || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{trade.quantity}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(trade.price)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{fmtPrice(trade.totalValue)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>₹{fmtPrice(trade.totalCost)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>#{trade.blockIndex ?? '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(trade.executedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            {tab === 'open' && 'No open orders. LIMIT / SL / GTT orders rest here until triggered — MARKET fills instantly.'}
            {tab === 'completed' && 'No completed orders yet.'}
            {tab === 'cancelled' && 'No cancelled or rejected orders.'}
            {tab === 'gtt' && 'No GTT orders. Place a GTT from the order ticket — it stays TRIGGER_PENDING until LTP hits.'}
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead><tr><th>Order ID</th><th>Side / Product</th><th>Instrument</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Price</th><th>Status</th><th>Time (IST)</th><th>Action</th></tr></thead>
              <tbody>{list.map(OrderRow)}</tbody>
            </table>
          </div>
        )}
      </div>

      <OrderTicket
        isOpen={!!modifyTarget}
        onClose={() => setModifyTarget(null)}
        onTrade={async () => ({})}
        mode="modify"
        modifyOrder={modifyTarget}
        onModified={(updated) => {
          setOrders(prev => prev.map(o => (o.id === updated.id ? { ...o, ...updated } : o)));
          setModifyTarget(null);
        }}
        quotes={{}}
        holdings={{}}
        balance={0}
      />
    </div>
  );
}
