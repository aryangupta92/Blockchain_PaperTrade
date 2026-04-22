import { useState, useEffect, useRef } from 'react';
import './OptionChain.css';
import api from '../../services/api';
import { RefreshCw, ChevronDown, Target } from 'lucide-react';

function fmt(n, d = 2) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtLakhs(n) {
  if (!n) return '—';
  return (n / 100000).toFixed(2);
}

export default function OptionChainPage({ symbol = '^NSEI', inModal = false, onTrade, balance }) {
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expiry, setExpiry] = useState('');
  const [bottomTab, setBottomTab] = useState('ltp-oi'); // 'ltp-oi' | 'greeks' | 'perlot'
  const [highlight, setHighlight] = useState(null); // highlighted strike
  const [tradeModal, setTradeModal] = useState(null); // { type: 'call'|'put', strike, side: 'buy'|'sell', price }
  const atmRowRef = useRef(null);

  const fetchChain = async (exp) => {
    setLoading(true);
    try {
      const data = await api.getOptionChain(symbol, exp);
      setChain(data);
      if (!expiry && data.expiry) setExpiry(data.expiry);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchChain(expiry); }, [symbol, expiry]);

  // Auto-scroll to ATM row
  useEffect(() => {
    if (atmRowRef.current) {
      atmRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [chain]);

  const handleOptionTrade = async (side) => {
    if (!tradeModal || !onTrade) return;
    const { type, strike, price } = tradeModal;
    const optSym = `${symbol.replace('^', '')} ${expiry} ${strike} ${type.toUpperCase()}`;
    try {
      await onTrade({ type: side, symbol: optSym, quantity: 1, price, orderType: 'market' });
    } catch (e) { console.error(e); }
    setTradeModal(null);
  };

  if (loading) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6 }} />
        ))}
      </div>
    );
  }

  if (!chain) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Option chain unavailable.</div>;

  const { spotPrice, syntheticFutures, lotSize, pcr, maxPain, totalVolume, exchange, expiries, chain: rows } = chain;

  return (
    <div className={`oc-page ${inModal ? 'in-modal' : ''}`}>
      {/* ── Header ── */}
      {!inModal && (
        <div className="oc-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Option Chain</h2>
          </div>
        </div>
      )}

      {/* ── Meta Bar ── */}
      <div className="oc-meta-bar">
        <div className="oc-meta-select-wrap">
          <span className="oc-meta-label">Option:</span>
          <div className="oc-meta-select">
            {symbol.replace('^', 'NIFTY ').replace('NSE', '')} <ChevronDown size={13} />
          </div>
          <span className="oc-meta-label">Expiry:</span>
          <select
            className="oc-expiry-select"
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
          >
            {(expiries || []).map(ex => (
              <option key={ex} value={ex}>{new Date(ex).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</option>
            ))}
          </select>
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => fetchChain(expiry)}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div className="oc-summary">
        <div className="oc-stat">
          <div className="oc-stat-label">Spot Price (LTP)</div>
          <div className="oc-stat-val gain">{fmt(spotPrice)} <span className="oc-stat-chg gain">+{fmt(spotPrice - (chain.prevClose || spotPrice), 2)} ({fmt(((spotPrice - (chain.prevClose || spotPrice)) / (chain.prevClose || spotPrice)) * 100, 2)}%)</span></div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">Synthetic Fut ⓘ</div>
          <div className="oc-stat-val">{fmt(syntheticFutures)}</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">Lot size</div>
          <div className="oc-stat-val">{lotSize}</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">PCR</div>
          <div className="oc-stat-val" style={{ color: pcr > 1 ? 'var(--gain)' : 'var(--loss)' }}>{fmt(pcr)}</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">MaxPain</div>
          <div className="oc-stat-val">{maxPain?.toLocaleString('en-IN')}</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">Volume – Lakhs</div>
          <div className="oc-stat-val">{fmtLakhs(totalVolume)}</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">Stock Exchange</div>
          <div className="oc-stat-val">{exchange}</div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              {/* CALLS */}
              <th className="oc-calls-col">VOLUME – LAKHS</th>
              <th className="oc-calls-col">ASK</th>
              <th className="oc-calls-col">BID</th>
              <th className="oc-calls-col">OI – LAKHS</th>
              <th className="oc-calls-col">LTP</th>
              {/* STRIKE */}
              <th className="oc-strike-col">STRIKE</th>
              {/* PUTS */}
              <th className="oc-puts-col">LTP</th>
              <th className="oc-puts-col">OI – LAKHS</th>
              <th className="oc-puts-col">BID</th>
              <th className="oc-puts-col">ASK</th>
              <th className="oc-puts-col">VOLUME – LAKHS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { strike, call, put, itm, atm } = row;
              const isAtm = atm;

              return (
                <tr
                  key={strike}
                  ref={isAtm ? atmRowRef : null}
                  className={`oc-row ${itm.call ? 'oc-itm-call' : ''} ${itm.put ? 'oc-itm-put' : ''} ${isAtm ? 'oc-atm' : ''} ${highlight === strike ? 'oc-highlight' : ''}`}
                  onMouseEnter={() => setHighlight(strike)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  {/* ── CALLS ── */}
                  {bottomTab === 'greeks' ? (
                    <>
                      <td className="oc-calls-col mono">{fmt(call.delta, 4)}</td>
                      <td className="oc-calls-col mono">{fmt(call.gamma, 5)}</td>
                      <td className="oc-calls-col mono">{fmt(call.theta, 2)}</td>
                      <td className="oc-calls-col mono">{fmt(call.vega, 2)}</td>
                      <td className="oc-calls-col mono">{fmt(call.iv, 1)}%</td>
                    </>
                  ) : bottomTab === 'perlot' ? (
                    <>
                      <td className="oc-calls-col mono">{fmtLakhs(call.volume * lotSize)}</td>
                      <td className="oc-calls-col mono">{fmt(call.ask * lotSize, 0)}</td>
                      <td className="oc-calls-col mono">{fmt(call.bid * lotSize, 0)}</td>
                      <td className="oc-calls-col mono">{fmtLakhs(call.oi * lotSize)}</td>
                      <td className="oc-calls-col mono">{fmt(call.ltp * lotSize, 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="oc-calls-col oc-vol">{fmtLakhs(call.volume)}</td>
                      <td className="oc-calls-col mono">{fmt(call.ask)}</td>
                      <td className="oc-calls-col mono">{fmt(call.bid)}</td>
                      <td className="oc-calls-col">
                        <div className="oc-oi-wrap">
                          <span className="mono">{fmtLakhs(call.oi)}</span>
                          <span className={call.oiChange >= 0 ? 'oc-oi-chg gain' : 'oc-oi-chg loss'}>
                            {call.oiChange >= 0 ? '+' : ''}{fmt(call.oiChange / 100000, 2)}
                          </span>
                          <div className="oc-oi-bar-wrap">
                            <div className="oc-oi-bar-call" style={{ width: `${Math.min(100, call.oi / 1000)}%` }} />
                          </div>
                        </div>
                      </td>
                      <td
                        className="oc-calls-col oc-ltp-cell"
                        onClick={() => setTradeModal({ type: 'call', strike, side: 'buy', price: call.ltp })}
                      >
                        <span className="mono oc-ltp">{fmt(call.ltp)}</span>
                        <span className={call.changePct >= 0 ? 'oc-chg gain' : 'oc-chg loss'}>
                          {call.changePct >= 0 ? '+' : ''}{fmt(call.changePct, 2)}%
                        </span>
                      </td>
                    </>
                  )}

                  {/* ── STRIKE ── */}
                  <td className={`oc-strike-col ${isAtm ? 'oc-strike-atm' : ''}`}>
                    {strike.toLocaleString('en-IN')}
                  </td>

                  {/* ── PUTS ── */}
                  {bottomTab === 'greeks' ? (
                    <>
                      <td className="oc-puts-col mono">{fmt(put.iv, 1)}%</td>
                      <td className="oc-puts-col mono">{fmt(put.vega, 2)}</td>
                      <td className="oc-puts-col mono">{fmt(put.theta, 2)}</td>
                      <td className="oc-puts-col mono">{fmt(put.gamma, 5)}</td>
                      <td className="oc-puts-col mono">{fmt(put.delta, 4)}</td>
                    </>
                  ) : bottomTab === 'perlot' ? (
                    <>
                      <td className="oc-puts-col mono">{fmt(put.ltp * lotSize, 0)}</td>
                      <td className="oc-puts-col mono">{fmtLakhs(put.oi * lotSize)}</td>
                      <td className="oc-puts-col mono">{fmt(put.bid * lotSize, 0)}</td>
                      <td className="oc-puts-col mono">{fmt(put.ask * lotSize, 0)}</td>
                      <td className="oc-puts-col mono">{fmtLakhs(put.volume * lotSize)}</td>
                    </>
                  ) : (
                    <>
                      <td
                        className="oc-puts-col oc-ltp-cell"
                        onClick={() => setTradeModal({ type: 'put', strike, side: 'buy', price: put.ltp })}
                      >
                        <span className="mono oc-ltp">{fmt(put.ltp)}</span>
                        <span className={put.changePct >= 0 ? 'oc-chg gain' : 'oc-chg loss'}>
                          {put.changePct >= 0 ? '+' : ''}{fmt(put.changePct, 2)}%
                        </span>
                      </td>
                      <td className="oc-puts-col">
                        <div className="oc-oi-wrap">
                          <span className={put.oiChange >= 0 ? 'oc-oi-chg gain' : 'oc-oi-chg loss'}>
                            {put.oiChange >= 0 ? '+' : ''}{fmt(put.oiChange / 100000, 2)}
                          </span>
                          <span className="mono">{fmtLakhs(put.oi)}</span>
                          <div className="oc-oi-bar-wrap">
                            <div className="oc-oi-bar-put" style={{ width: `${Math.min(100, put.oi / 1000)}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="oc-puts-col mono">{fmt(put.bid)}</td>
                      <td className="oc-puts-col mono">{fmt(put.ask)}</td>
                      <td className="oc-puts-col oc-vol">{fmtLakhs(put.volume)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Bottom Tabs ── */}
      <div className="oc-bottom-tabs">
        {['ltp-oi', 'greeks', 'perlot'].map(tab => (
          <button
            key={tab}
            className={`oc-bottom-tab ${bottomTab === tab ? 'active' : ''}`}
            onClick={() => setBottomTab(tab)}
          >
            {tab === 'ltp-oi' ? 'LTP & OI' : tab === 'greeks' ? 'Greeks' : 'Per Lot 🔴'}
          </button>
        ))}
        {bottomTab === 'greeks' && (
          <div className="oc-greeks-legend">
            <span>Δ Delta</span><span>Γ Gamma</span><span>Θ Theta</span><span>ν Vega</span><span>σ IV</span>
          </div>
        )}
      </div>

      {/* ── Trade Modal ── */}
      {tradeModal && (
        <div className="oc-trade-overlay">
          <div className="oc-trade-modal">
            <div className="oc-trade-modal-title">
              {symbol.replace('^','NIFTY')} {expiry} {tradeModal.strike} {tradeModal.type.toUpperCase()}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '8px 0' }}>
              ₹{fmt(tradeModal.price)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
              Lot size: {lotSize} shares · Value: ₹{fmt(tradeModal.price * lotSize)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-gain" style={{ flex: 1 }} onClick={() => handleOptionTrade('buy')}>BUY</button>
              <button className="btn-loss" style={{ flex: 1 }} onClick={() => handleOptionTrade('sell')}>SELL</button>
              <button className="btn btn-ghost" onClick={() => setTradeModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
