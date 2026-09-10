/**
 * TradePage.jsx — Rebuilt Broker-Style Trading Interface
 * ─────────────────────────────────────────────────────────────────────────────
 * Now uses the universal OrderTicket component for all order placements.
 * This page becomes a "trading desk" overview showing:
 *  - Quick order entry (top bar)
 *  - Live positions and P&L
 *  - Recent trade history for the selected symbol
 *  - Candlestick chart
 *  - Watchlist quick-trade
 */

import { useState, useEffect } from 'react';
import './Trading.css';
import OrderTicket from './OrderTicket';
import { Zap, TrendingUp, TrendingDown, BarChart2, RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';
import api from '../../services/api';

function fmtINR(n) {
  if (!n && n !== 0) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}

export default function TradePage({ quotes, holdings, balance, onTrade, watchlist, onAddWatch }) {
  const [selectedSymbol, setSelectedSymbol]   = useState(watchlist?.[0] || 'RELIANCE');
  const [ticketOpen, setTicketOpen]           = useState(false);
  const [ticketSide, setTicketSide]           = useState('buy');
  const [ticketSegment, setTicketSegment]     = useState('EQ');
  const [ticketInitPrice, setTicketInitPrice] = useState(0);
  const [trades, setTrades]                   = useState([]);
  const [chartData, setChartData]             = useState([]);
  const [loadingChart, setLoadingChart]       = useState(false);
  const [refreshing, setRefreshing]           = useState(false);

  const liveQuote  = quotes[selectedSymbol] || null;
  const livePrice  = liveQuote?.price || 0;
  const holding    = holdings[selectedSymbol] || null;
  const heldQty    = holding?.quantity || 0;
  const avgPrice   = holding?.avgPrice || 0;
  const unrealizedPL = heldQty !== 0 ? (livePrice - avgPrice) * heldQty : 0;
  const pnlPct     = heldQty !== 0 && avgPrice ? ((livePrice - avgPrice) / avgPrice) * 100 : 0;

  // Load chart data
  useEffect(() => {
    if (!selectedSymbol) return;
    setLoadingChart(true);
    api.getCandles(selectedSymbol, '1d', '1m')
      .then(data => setChartData(data || []))
      .catch(() => setChartData([]))
      .finally(() => setLoadingChart(false));
  }, [selectedSymbol]);

  // Load recent trades
  const loadTrades = async () => {
    try {
      setRefreshing(true);
      const response = await api.getTrades(30, 0);
      setTrades(response.trades || []);
    } catch (e) { console.error(e); }
    finally { setRefreshing(false); }
  };

  useEffect(() => { loadTrades(); }, [selectedSymbol]);

  const openTicket = (side, segment = 'EQ', price = livePrice) => {
    setTicketSide(side);
    setTicketSegment(segment);
    setTicketInitPrice(price);
    setTicketOpen(true);
  };

  // All holdings for positions panel
  const allHoldings = Object.entries(holdings).map(([sym, h]) => {
    const q = quotes[sym];
    const ltp = q?.price || h.avgPrice;
    const upl = (ltp - h.avgPrice) * h.quantity;
    const uplPct = ((ltp - h.avgPrice) / h.avgPrice) * 100;
    return { symbol: sym, ...h, ltp, upl, uplPct };
  });

  const symbolTrades = trades.filter(t =>
    (t.instrument?.tradingSymbol || '').replace('.NS', '') === selectedSymbol ||
    t.instrument?.tradingSymbol === selectedSymbol
  ).slice(0, 6);

  return (
    <div className="trade-page">
      {/* ── Left Panel: Order Actions ───────────────────────────────────────────── */}
      <div className="card trade-panel">
        <div className="trade-panel-header">
          <Zap size={16} style={{ color: 'var(--accent-primary)' }} />
          <span>Quick Trade</span>
        </div>

        {/* Symbol Selector from Watchlist */}
        <div className="form-group">
          <label className="form-label">Selected Symbol</label>
          <div className="tabs" style={{ flexWrap: 'wrap', gap: 4 }}>
            {watchlist.slice(0, 8).map(s => (
              <button
                key={s}
                className={`tab ${selectedSymbol === s ? 'active' : ''}`}
                onClick={() => setSelectedSymbol(s)}
                style={{ fontSize: 11, padding: '5px 9px' }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Live Price */}
        {liveQuote && (
          <div className="live-price-box">
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>LTP</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', color: liveQuote.changePercent >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                {fmtINR(livePrice)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={`mover-change-pill ${liveQuote.changePercent >= 0 ? 'gain' : 'loss'}`}>
                {liveQuote.changePercent >= 0 ? '+' : ''}{liveQuote.changePercent?.toFixed(2)}%
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Vol: {liveQuote.volume ? (liveQuote.volume / 1e6).toFixed(2) + 'M' : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Current Position Summary */}
        {heldQty !== 0 && (
          <div style={{ padding: '10px 12px', background: unrealizedPL >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', borderRadius: 10, border: `1px solid ${unrealizedPL >= 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Open Position</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Qty / Avg</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{heldQty > 0 ? '+' : ''}{heldQty} @ {fmtINR(avgPrice)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Unrealized P&L</div>
                <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', color: unrealizedPL >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                  {unrealizedPL >= 0 ? '+' : ''}{fmtINR(unrealizedPL)} ({fmtPct(pnlPct)})
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-gain" style={{ flex: 1, fontSize: 13 }} onClick={() => openTicket('buy', 'EQ')}>
            ▲ BUY EQ
          </button>
          <button className="btn-loss" style={{ flex: 1, fontSize: 13 }} onClick={() => openTicket('sell', 'EQ')}>
            ▼ SELL EQ
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => openTicket('buy', 'FO')}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--accent-primary)', background: 'rgba(16,185,129,0.08)', color: 'var(--accent-primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            ▲ BUY F&O
          </button>
          <button
            onClick={() => openTicket('sell', 'FO')}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--loss)', background: 'rgba(239,68,68,0.08)', color: 'var(--loss)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            ▼ SELL F&O
          </button>
        </div>

        {/* Watchlist Quick-Trade rows */}
        <div className="card" style={{ padding: '10px 0' }}>
          <div className="section-title" style={{ padding: '0 12px', marginBottom: 8 }}>Watchlist</div>
          {watchlist.slice(0, 8).map(s => {
            const q = quotes[s];
            const isSelected = s === selectedSymbol;
            return (
              <div
                key={s}
                className="watchlist-row"
                style={{ cursor: 'pointer', background: isSelected ? 'rgba(16,185,129,0.06)' : 'transparent' }}
                onClick={() => setSelectedSymbol(s)}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>{s}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{q ? fmtINR(q.price) : '—'}</span>
                  {q && <span className={q.changePercent >= 0 ? 'gain' : 'loss'} style={{ fontSize: 11, fontWeight: 700 }}>{fmtPct(q.changePercent)}</span>}
                  <button
                    onClick={e => { e.stopPropagation(); setSelectedSymbol(s); openTicket('buy', 'EQ', q?.price || 0); }}
                    style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid var(--gain)', background: 'transparent', color: 'var(--gain)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                  >B</button>
                  <button
                    onClick={e => { e.stopPropagation(); setSelectedSymbol(s); openTicket('sell', 'EQ', q?.price || 0); }}
                    style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid var(--loss)', background: 'transparent', color: 'var(--loss)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                  >S</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right Panel: Chart + Positions + History ────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minWidth: 0 }}>
        {/* Chart */}
        <div className="card chart-container" style={{ minHeight: 280 }}>
          <div className="section-header">
            <BarChart2 size={16} style={{ color: 'var(--accent-primary)' }} />
            <span className="section-title">{selectedSymbol} — 1D Chart</span>
            {liveQuote && (
              <span className={liveQuote.changePercent >= 0 ? 'gain' : 'loss'} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700 }}>
                {fmtINR(livePrice)} {fmtPct(liveQuote.changePercent)}
              </span>
            )}
          </div>
          {loadingChart ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
              <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            </div>
          ) : chartData.length > 0 ? (
            <div style={{ height: 220, position: 'relative', padding: '0 8px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', gap: 1 }}>
                {(() => {
                  const data = chartData.slice(-80);
                  const high = Math.max(...data.map(c => c.high));
                  const low  = Math.min(...data.map(c => c.low));
                  const rng  = high - low || 1;
                  return data.map((c, i) => {
                    const bodyH = Math.abs(c.close - c.open) / rng * 210 || 2;
                    const bodyB = (Math.min(c.open, c.close) - low) / rng * 210;
                    const isUp  = c.close >= c.open;
                    const col   = isUp ? 'var(--gain)' : 'var(--loss)';
                    return (
                      <div key={i} style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <div style={{ position: 'absolute', bottom: `${(c.low - low) / rng * 210}px`, width: 1, height: `${(c.high - c.low) / rng * 210}px`, background: col, opacity: 0.5 }} />
                        <div style={{ width: '60%', height: `${bodyH}px`, background: col, borderRadius: 1, marginBottom: `${bodyB}px` }} />
                      </div>
                    );
                  });
                })()}
                {/* Entry price line */}
                {heldQty !== 0 && (() => {
                  const data = chartData.slice(-80);
                  const high = Math.max(...data.map(c => c.high));
                  const low  = Math.min(...data.map(c => c.low));
                  const rng  = high - low || 1;
                  const pct  = Math.max(0, Math.min(210, ((avgPrice - low) / rng) * 210));
                  return (
                    <div style={{ position: 'absolute', left: 8, right: 8, bottom: `${pct + 8}px`, borderTop: `1.5px dashed ${pnlPct >= 0 ? 'var(--gain)' : 'var(--loss)'}`, pointerEvents: 'none', zIndex: 5 }}>
                      <div style={{ position: 'absolute', right: 4, top: -18, background: pnlPct >= 0 ? 'var(--gain)' : 'var(--loss)', color: '#000', fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>
                        Avg: {fmtINR(avgPrice)} · {fmtPct(pnlPct)}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No chart data available for {selectedSymbol}
            </div>
          )}
        </div>

        {/* All Positions */}
        {allHoldings.length > 0 && (
          <div className="card">
            <div className="section-header">
              <TrendingUp size={15} style={{ color: 'var(--accent-primary)' }} />
              <span className="section-title">Open Positions ({allHoldings.length})</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Symbol', 'Qty', 'Avg Price', 'LTP', 'Invested', 'Current', 'P&L', ''].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allHoldings.map(h => (
                    <tr key={h.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }} onClick={() => setSelectedSymbol(h.symbol)}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{h.symbol}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: h.quantity > 0 ? 'var(--gain)' : 'var(--loss)' }}>{h.quantity > 0 ? '+' : ''}{h.quantity}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{fmtINR(h.avgPrice)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: h.upl >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(h.ltp)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{fmtINR(Math.abs(h.quantity) * h.avgPrice)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{fmtINR(Math.abs(h.quantity) * h.ltp)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', color: h.upl >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
                        {h.upl >= 0 ? '+' : ''}{fmtINR(h.upl)} ({fmtPct(h.uplPct)})
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedSymbol(h.symbol); openTicket('sell', 'EQ', h.ltp); }}
                          style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--loss)', background: 'rgba(239,68,68,0.1)', color: 'var(--loss)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                        >Exit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent Trade History */}
        <div className="card">
          <div className="section-header">
            <RefreshCw size={14} style={{ color: 'var(--accent-primary)', cursor: 'pointer' }} onClick={loadTrades} />
            <span className="section-title">Recent Trades — {selectedSymbol}</span>
            {refreshing && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginLeft: 'auto' }} />}
          </div>
          {symbolTrades.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Side', 'Qty', 'Price', 'Total', 'Charges', 'Time', 'Block'].map(h => (
                      <th key={h} style={{ padding: '5px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symbolTrades.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 800, color: t.side === 'BUY' ? 'var(--gain)' : 'var(--loss)' }}>{t.side}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)' }}>{t.quantity}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)' }}>{fmtINR(t.price)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)' }}>{fmtINR(t.totalValue)}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtINR(t.totalCost)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text-muted)', fontSize: 11 }}>
                        {new Date(t.executedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                        {t.blockIndex ? `#${t.blockIndex}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No recent trades for {selectedSymbol}. Click BUY / SELL to place an order.
            </div>
          )}
        </div>
      </div>

      {/* Universal Order Ticket Modal */}
      <OrderTicket
        isOpen={ticketOpen}
        onClose={() => setTicketOpen(false)}
        onTrade={onTrade}
        initialSymbol={selectedSymbol}
        initialSide={ticketSide}
        initialSegment={ticketSegment}
        initialPrice={ticketInitPrice}
        quotes={quotes}
        holdings={holdings}
        balance={balance}
      />
    </div>
  );
}
