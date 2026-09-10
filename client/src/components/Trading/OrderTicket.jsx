/**
 * OrderTicket.jsx — Universal Reusable Order Placement Modal
 * ─────────────────────────────────────────────────────────────────────────────
 * Matches real Indian broker UX (Zerodha/Upstox) with:
 *  - Segment tabs: EQ | F&O
 *  - F&O instrument builder (underlying → expiry → strike → CE/PE)
 *  - Product type: CNC | MIS | NRML
 *  - Order types: MARKET | LIMIT | SL | SL-M | GTT | IOC
 *  - Live real-time margin preview via GET /api/trades/margin
 *  - Cost breakdown (Brokerage, STT, Exchange, GST, Stamp Duty)
 *  - Lot size enforcement for F&O
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import './OrderTicket.css';
import { X, TrendingUp, TrendingDown, AlertCircle, CheckCircle, Info, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import api from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const LOT_SIZES = {
  NIFTY: 50, BANKNIFTY: 15, FINNIFTY: 40, MIDCPNIFTY: 75, SENSEX: 10, DEFAULT: 1,
};

const UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

// Generate nearest expiry dates (monthly + weekly Nifty pattern)
function getExpiryOptions() {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + (i * 7));
    // Find next Thursday
    while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
    const yy  = String(d.getFullYear()).slice(2);
    dates.push(`${dd}${mon}${yy}`);
  }
  return [...new Set(dates)].slice(0, 8);
}

function buildFOSymbol(underlying, expiry, strike, optionType, isFutures) {
  if (!underlying || !expiry) return '';
  if (isFutures) return `${underlying}${expiry}FUT`;
  if (!strike || !optionType) return '';
  return `${underlying}${expiry}${strike}${optionType}`;
}

function getLotSize(underlying) {
  return LOT_SIZES[underlying] || LOT_SIZES.DEFAULT;
}

function fmtINR(n) {
  if (!n && n !== 0) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function OrderTicket({
  isOpen,
  onClose,
  onTrade,
  initialSymbol = 'RELIANCE',
  initialSide   = 'buy',
  initialPrice  = 0,
  quotes        = {},
  holdings      = {},
  balance       = 0,
  // For option chain integration: pre-fill F&O params
  initialSegment    = 'EQ',    // 'EQ' | 'FO'
  initialUnderlying = 'NIFTY',
  initialExpiry     = '',
  initialStrike     = '',
  initialOptionType = 'CE',    // 'CE' | 'PE'
  initialIsFutures  = false,
}) {
  // Segment
  const [segment, setSegment] = useState(initialSegment);

  // EQ state
  const [eqSymbol, setEqSymbol] = useState(initialSymbol);

  // F&O state
  const [foUnderlying, setFoUnderlying]     = useState(initialUnderlying);
  const [foExpiry, setFoExpiry]             = useState(initialExpiry || getExpiryOptions()[0]);
  const [foStrike, setFoStrike]             = useState(initialStrike || '');
  const [foOptionType, setFoOptionType]     = useState(initialOptionType);
  const [foIsFutures, setFoIsFutures]       = useState(initialIsFutures);

  // Order params
  const [side, setSide]               = useState(initialSide);
  const [productType, setProductType] = useState(segment === 'FO' ? 'NRML' : 'CNC');
  const [orderType, setOrderType]     = useState('MARKET');
  const [limitPrice, setLimitPrice]   = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [validity, setValidity]       = useState('DAY');
  const [lots, setLots]               = useState(1);

  // UI state
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState('');
  const [marginData, setMarginData]   = useState(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);

  const marginTimerRef = useRef(null);
  const expiries = getExpiryOptions();

  // Derived values
  const symbol = segment === 'EQ'
    ? eqSymbol
    : buildFOSymbol(foUnderlying, foExpiry, foStrike, foOptionType, foIsFutures);

  const lotSize     = segment === 'FO' ? getLotSize(foUnderlying) : 1;
  const quantity    = segment === 'FO' ? lots * lotSize : lots;
  const liveQuote   = quotes[symbol] || quotes[eqSymbol] || null;
  const livePrice   = liveQuote?.price || initialPrice || 0;
  const execPrice   = orderType === 'MARKET' ? livePrice : (Number(limitPrice) || 0);
  const holding     = holdings[symbol] || null;
  const heldQty     = holding?.quantity || 0;

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setSegment(initialSegment);
      setEqSymbol(initialSymbol);
      setFoUnderlying(initialUnderlying);
      setFoExpiry(initialExpiry || getExpiryOptions()[0]);
      setFoStrike(initialStrike || '');
      setFoOptionType(initialOptionType);
      setFoIsFutures(initialIsFutures);
      setSide(initialSide);
      setLots(1);
      setLimitPrice(initialPrice > 0 ? String(initialPrice) : '');
      setTriggerPrice('');
      setOrderType('MARKET');
      setResult(null);
      setError('');
      setMarginData(null);
    }
  }, [isOpen, initialSymbol, initialSide, initialSegment]);

  // Set product type based on segment
  useEffect(() => {
    setProductType(segment === 'FO' ? 'NRML' : 'CNC');
  }, [segment]);

  // Debounced margin fetch
  const fetchMargin = useCallback(async () => {
    if (!symbol || !execPrice || !quantity) return;
    setMarginLoading(true);
    try {
      const data = await api.getMarginPreview({ symbol, quantity, price: execPrice, side, productType });
      setMarginData(data);
    } catch (e) {
      console.warn('Margin preview failed:', e.message);
    } finally {
      setMarginLoading(false);
    }
  }, [symbol, execPrice, quantity, side, productType]);

  useEffect(() => {
    if (!isOpen) return;
    clearTimeout(marginTimerRef.current);
    marginTimerRef.current = setTimeout(fetchMargin, 400);
    return () => clearTimeout(marginTimerRef.current);
  }, [fetchMargin, isOpen]);

  const handleTrade = async () => {
    setError('');
    setResult(null);

    if (!execPrice) { setError('Live price unavailable. Wait for market data.'); return; }
    if (quantity <= 0) { setError('Invalid quantity.'); return; }
    if (orderType !== 'MARKET' && !limitPrice) { setError('Enter a limit / trigger price.'); return; }
    if ((orderType === 'SL' || orderType === 'SL-M') && !triggerPrice) {
      setError('Enter a trigger price for SL order.'); return;
    }
    if (segment === 'FO' && !symbol.includes('FUT') && !foStrike) {
      setError('Select a strike price.'); return;
    }

    setLoading(true);
    try {
      const payload = {
        type: side,
        symbol,
        quantity,
        price: execPrice,
        orderType,
        productType,
        validity,
        triggerPrice: triggerPrice ? Number(triggerPrice) : undefined,
      };
      const response = await onTrade(payload);

      if (!response?.success && response?.violations?.length > 0) {
        setError(response.violations[0].message);
        return;
      }

      setResult({
        success: true,
        message: `${side.toUpperCase()} ${quantity} × ${symbol} @ ${fmtINR(execPrice)}`,
        trade: response?.trade,
        block: response?.block || response?.trade,
      });
      setLots(1);
      setLimitPrice('');
      setTriggerPrice('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const needsTrigger = orderType === 'SL' || orderType === 'SL-M';
  const needsLimit   = orderType === 'LIMIT' || orderType === 'GTT' || orderType === 'SL';
  const priceColor   = liveQuote?.changePercent >= 0 ? 'var(--gain)' : 'var(--loss)';

  return (
    <div className="order-ticket-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="order-ticket">
        {/* Header */}
        <div className="ot-header">
          <div className="ot-header-left">
            <Zap size={16} style={{ color: 'var(--accent-primary)' }} />
            <span className="ot-symbol-badge">{symbol || 'Select Instrument'}</span>
            <span className="ot-exchange-badge">NSE</span>
          </div>
          <button className="ot-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="ot-body">
          {/* BUY / SELL Toggle */}
          <div className="ot-side-toggle">
            <button className={`ot-side-btn buy ${side === 'buy' ? 'active' : ''}`} onClick={() => setSide('buy')}>
              ▲ BUY
            </button>
            <button className={`ot-side-btn sell ${side === 'sell' ? 'active' : ''}`} onClick={() => setSide('sell')}>
              ▼ SELL
            </button>
          </div>

          {/* Segment: EQ | F&O */}
          <div className="ot-tab-group">
            <div className="ot-tab-label">Segment</div>
            <div className="ot-tabs">
              {['EQ', 'FO'].map(s => (
                <button key={s} className={`ot-tab ${segment === s ? 'active' : ''}`} onClick={() => setSegment(s)}>
                  {s === 'FO' ? 'F&O' : s}
                </button>
              ))}
            </div>
          </div>

          {/* F&O Instrument Builder */}
          {segment === 'FO' && (
            <div className="ot-fo-builder">
              <div className="ot-tab-group">
                <div className="ot-tab-label">Type</div>
                <div className="ot-tabs">
                  <button className={`ot-tab ${!foIsFutures ? 'active' : ''}`} onClick={() => setFoIsFutures(false)}>Options</button>
                  <button className={`ot-tab ${foIsFutures ? 'active' : ''}`} onClick={() => setFoIsFutures(true)}>Futures</button>
                </div>
              </div>

              <div className="ot-fo-row">
                <div className="ot-form-group">
                  <div className="ot-tab-label">Underlying</div>
                  <select className="ot-select" value={foUnderlying} onChange={e => setFoUnderlying(e.target.value)}>
                    {UNDERLYINGS.map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
                <div className="ot-form-group">
                  <div className="ot-tab-label">Expiry</div>
                  <select className="ot-select" value={foExpiry} onChange={e => setFoExpiry(e.target.value)}>
                    {expiries.map(e => <option key={e}>{e}</option>)}
                  </select>
                </div>
              </div>

              {!foIsFutures && (
                <div className="ot-fo-row triple">
                  <div className="ot-form-group">
                    <div className="ot-tab-label">Strike</div>
                    <input className="ot-input" type="number" placeholder="e.g. 24700" value={foStrike}
                      onChange={e => setFoStrike(e.target.value)} />
                  </div>
                  <div className="ot-form-group" style={{ gridColumn: 'span 2' }}>
                    <div className="ot-tab-label">Option Type</div>
                    <div className="ot-tabs">
                      <button className={`ot-tab ${foOptionType === 'CE' ? 'active' : ''}`} onClick={() => setFoOptionType('CE')}>CE (Call)</button>
                      <button className={`ot-tab ${foOptionType === 'PE' ? 'active' : ''}`} onClick={() => setFoOptionType('PE')}>PE (Put)</button>
                    </div>
                  </div>
                </div>
              )}

              {symbol && (
                <div className="ot-generated-symbol">
                  📋 Symbol: {symbol}
                </div>
              )}
            </div>
          )}

          {/* EQ Symbol */}
          {segment === 'EQ' && (
            <div className="ot-form-group">
              <div className="ot-tab-label">Symbol</div>
              <input className="ot-input" value={eqSymbol} onChange={e => setEqSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. RELIANCE, TCS, INFY" />
            </div>
          )}

          {/* Live Price */}
          {liveQuote && (
            <div className="ot-live-price">
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>LTP (Last Traded Price)</div>
                <div className="ot-price-value" style={{ color: priceColor }}>{fmtINR(livePrice)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={`ot-price-change ${liveQuote.changePercent >= 0 ? 'gain' : 'loss'}`}>
                  {liveQuote.changePercent >= 0 ? '+' : ''}{liveQuote.changePercent?.toFixed(2)}%
                </div>
                {heldQty !== 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    Position: {heldQty > 0 ? `+${heldQty}` : heldQty} @ {fmtINR(holding?.avgPrice)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Product Type */}
          <div className="ot-tab-group">
            <div className="ot-tab-label">Product Type</div>
            <div className="ot-tabs">
              {segment === 'EQ' ? (
                <>
                  <button className={`ot-tab ${productType === 'CNC' ? 'active' : ''}`} onClick={() => setProductType('CNC')} title="Delivery — hold multiple days">CNC</button>
                  <button className={`ot-tab ${productType === 'MIS' ? 'active' : ''}`} onClick={() => setProductType('MIS')} title="Intraday — auto SQ-OFF at 3:15 PM">MIS</button>
                </>
              ) : (
                <>
                  <button className={`ot-tab ${productType === 'NRML' ? 'active' : ''}`} onClick={() => setProductType('NRML')} title="Overnight F&O carry">NRML</button>
                  <button className={`ot-tab ${productType === 'MIS' ? 'active' : ''}`} onClick={() => setProductType('MIS')} title="Intraday — reduced margin, SQ-OFF at 3:15">MIS</button>
                </>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              {productType === 'CNC' && 'Equity delivery — hold for multiple days. No leverage.'}
              {productType === 'MIS' && 'Intraday — 5x leverage. Auto square-off at 3:15 PM IST.'}
              {productType === 'NRML' && 'F&O overnight carry — SPAN + Exposure margin required.'}
            </div>
          </div>

          {/* Order Type + Validity */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
            <div className="ot-tab-group">
              <div className="ot-tab-label">Order Type</div>
              <select className="ot-select" value={orderType} onChange={e => setOrderType(e.target.value)}>
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
                <option value="SL">SL (Stop-Loss Limit)</option>
                <option value="SL-M">SL-M (Stop-Loss Market)</option>
                <option value="GTT">GTT (Good Till Triggered)</option>
                <option value="IOC">IOC (Immediate or Cancel)</option>
              </select>
            </div>
            <div className="ot-tab-group">
              <div className="ot-tab-label">Validity</div>
              <select className="ot-select" value={validity} onChange={e => setValidity(e.target.value)}>
                <option value="DAY">DAY</option>
                <option value="IOC">IOC</option>
              </select>
            </div>
          </div>

          {/* Limit Price */}
          {needsLimit && (
            <div className="ot-form-group">
              <div className="ot-tab-label">Limit Price (₹)</div>
              <input type="number" className="ot-input" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                placeholder={`e.g. ${livePrice ? livePrice.toFixed(2) : '0.00'}`} />
            </div>
          )}

          {/* Trigger Price for SL */}
          {needsTrigger && (
            <div className="ot-form-group">
              <div className="ot-tab-label">Trigger Price (₹) <span style={{ color: 'var(--loss)' }}>*</span></div>
              <input type="number" className="ot-input" value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)}
                placeholder="Price at which order triggers" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {side === 'sell' ? 'Below this price → order triggers (stop-loss)' : 'Above this price → order triggers (breakout buy)'}
              </div>
            </div>
          )}

          {/* Quantity / Lots */}
          <div className="ot-form-group">
            <div className="ot-tab-label">
              {segment === 'FO' ? `Lots (1 lot = ${lotSize} qty)` : 'Quantity (Shares)'}
            </div>
            <div className="ot-qty-row">
              <button className="ot-qty-btn" onClick={() => setLots(q => Math.max(1, Number(q) - 1))}>−</button>
              <input type="number" className="ot-input" value={lots}
                onChange={e => setLots(Math.max(1, Number(e.target.value)))} min={1}
                style={{ textAlign: 'center', flex: 1 }} />
              <button className="ot-qty-btn" onClick={() => setLots(q => Number(q) + 1)}>+</button>
            </div>
            {segment === 'FO' && (
              <div className="ot-qty-hint">Total qty: {quantity} × {fmtINR(execPrice || 0)} = {fmtINR(quantity * (execPrice || 0))}</div>
            )}
          </div>

          {/* Real-time Margin Preview */}
          {(execPrice > 0 && quantity > 0) && (
            <div className="ot-margin-panel">
              <div className="ot-margin-header">
                <span>Margin Required</span>
                <span className={`ot-margin-required ${marginData ? (marginData.sufficient ? 'ot-margin-sufficient' : 'ot-margin-insufficient') : ''}`}>
                  {marginLoading ? '…' : marginData ? fmtINR(marginData.margin?.required) : fmtINR(execPrice * quantity)}
                </span>
              </div>
              {marginData && (
                <>
                  <div className="ot-margin-rows">
                    {Object.entries(marginData.margin?.breakdown || {}).map(([label, val]) => (
                      <div className="ot-margin-row" key={label}>
                        <span className="ot-margin-row-label">{label}</span>
                        <span className="ot-margin-row-value">{val}</span>
                      </div>
                    ))}
                    <div className="ot-margin-row" style={{ color: marginData.sufficient ? 'var(--gain)' : 'var(--loss)' }}>
                      <span>Available Balance</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmtINR(marginData.available)}</span>
                    </div>
                  </div>
                  {marginData.margin?.note && (
                    <div className="ot-margin-note">{marginData.margin.note}</div>
                  )}
                  {marginData.margin?.leverage && marginData.margin.leverage !== '1x' && (
                    <div style={{ fontSize: 11, color: 'var(--accent-primary)', padding: '4px 12px', fontWeight: 700 }}>
                      ⚡ {marginData.margin.leverage} leverage
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Cost Breakdown (collapsible) */}
          {marginData?.costs && (
            <div className="ot-cost-panel">
              <div className="ot-cost-header" onClick={() => setShowCostBreakdown(s => !s)}>
                <span>Charges Breakdown</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {fmtINR(marginData.costs.totalCost)}
                  </span>
                  {showCostBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </div>
              {showCostBreakdown && (
                <div className="ot-cost-rows">
                  {(marginData.costs.lineItems || []).map((item, i) => (
                    <div key={i} className={`ot-cost-row ${item.label.includes('Total') || item.label.includes('Net') ? 'total' : ''}`}>
                      <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtINR(item.value)}</span>
                    </div>
                  ))}
                  {marginData.costs.breakEvenPrice > 0 && (
                    <div className="ot-cost-row" style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                      <span>Break-even Price</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtINR(marginData.costs.breakEvenPrice)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error / Result */}
          {error && (
            <div className="ot-alert error">
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}
          {result?.success && (
            <div className="ot-alert success">
              <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div>{result.message} — Submitted!</div>
                {(result.block?.blockHash || result.trade?.blockHash) && (
                  <div className="ot-block-hash">
                    ⛓ Block #{result.block?.blockIndex || result.trade?.blockIndex} · {(result.block?.blockHash || result.trade?.blockHash)?.slice(0, 24)}…
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            className={`ot-submit-btn ${side}`}
            onClick={handleTrade}
            disabled={loading || (!execPrice && orderType === 'MARKET')}
          >
            {loading ? 'Executing…' : `${side === 'buy' ? '▲ BUY' : '▼ SELL'} ${symbol || '—'} — ${productType}`}
          </button>

          {!marginData?.sufficient && marginData && !result?.success && (
            <div className="ot-alert info">
              <Info size={14} style={{ flexShrink: 0 }} />
              <span>Insufficient balance. Need {fmtINR(marginData.margin?.required)}, have {fmtINR(marginData.available)}.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
