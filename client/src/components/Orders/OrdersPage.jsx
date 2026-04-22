import { ClipboardList } from 'lucide-react';

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

export default function OrdersPage({ trades }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <ClipboardList size={18} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Order History</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({trades.length} total)</span>
      </div>

      <div className="card">
        {trades.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            No orders placed yet. Go to Trade Now to place your first order.
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Trade ID</th>
                  <th>Type</th>
                  <th>Symbol</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Block</th>
                  <th>Block Hash</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade, i) => {
                  const isBuy = trade.type === 'buy';
                  return (
                    <tr key={trade.tradeId || i}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
                        {trade.tradeId?.slice(0, 16) || '—'}…
                      </td>
                      <td>
                        <span className={`mover-change-pill ${isBuy ? 'gain' : 'loss'}`}>
                          {trade.type?.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{trade.symbol}</td>
                      <td style={{ textAlign: 'right' }}>{trade.quantity}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(trade.price)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{fmtPrice(trade.totalValue)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-secondary)' }}>
                        #{trade.blockIndex}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                        {trade.blockHash?.slice(0, 16)}…
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {trade.executedAt ? new Date(trade.executedAt).toLocaleString('en-IN') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
