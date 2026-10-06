/**
 * OrderTicket.jsx — Kite-parity docked order window
 * ─────────────────────────────────────────────────────────────────────────────
 * Zerodha/Upstox/Dhan behaviour:
 *  - Bottom-docked ticket (not centered modal), BUY = blue, SELL = red
 *  - Exchange toggle NSE/BSE, Product CNC/MIS/NRML, Validity DAY/IOC
 *  - Disclosed quantity, trigger price for SL/SL-M, AMO badge when market closed
 *  - Modify mode for OPEN/PENDING/TRIGGER_PENDING orders (PUT /api/trades/orders/:id)
 *  - Live margin + full Zerodha-style charges breakdown before submit
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import '../Broker/Kite.css';
import './OrderTicket.css';
import { X, AlertCircle, CheckCircle, Info, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import api from '../../services/api';
import { UNDERLYINGS, getSpec, getLotSize, expiriesFor, expiryLabel, buildFOSymbol, SEBI_FO_WARNING } from '../../utils/fo';

function fmtINR(n) {
  if (n == null || n === '') return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OrderTicket({
  isOpen,
  onClose,
  onTrade,
  onModified,
  initialSymbol = 'RELIANCE',
  initialSide = 'buy',
  initialPrice = 0,
  quotes = {},
  holdings = {},
  balance = 0,
  initialSegment = 'EQ',
  initialUnderlying = 'NIFTY',
  initialExpiry = '',
  initialStrike = '',
  initialOptionType = 'CE',
  initialIsFutures = false,
  // Kite-parity additions
  mode = 'place', // 'place' | 'modify'
  modifyOrder = null, // order object when mode === 'modify'
  initialExchange = 'NSE',
}) {
  const [segment, setSegment] = useState(initialSegment);
  const [eqSymbol, setEqSymbol] = useState(initialSymbol);
  const [exchange, setExchange] = useState(initialExchange);
  const [foUnderlying, setFoUnderlying] = useState(initialUnderlying);
  const [foExpiry, setFoExpiry] = useState(initialExpiry || expiriesFor(initialUnderlying)[0]?.code || '');
  const [foStrike, setFoStrike] = useState(initialStrike || '');
  const [foOptionType, setFoOptionType] = useState(initialOptionType);
  const [foIsFutures, setFoIsFutures] = useState(initialIsFutures);

  const [side, setSide] = useState(initialSide);
  const [productType, setProductType] = useState(segment === 'FO' ? 'NRML' : 'CNC');
  const [orderType, setOrderType] = useState('MARKET');
  const [limitPrice, setLimitPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [disclosedQty, setDisclosedQty] = useState('');
  const [validity, setValidity] = useState('DAY');
  const [lots, setLots] = useState(1);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [marginData, setMarginData] = useState(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  const [session, setSession] = useState(null);

  const marginTimerRef = useRef(null);
  // SEBI Tue/Thu expiries per underlying (NSE Tue, BSE Thu; weeklies NIFTY/SENSEX only)
  const expiries = expiriesFor(foUnderlying);
  const foSpec = getSpec(foUnderlying);
  const isModify = mode === 'modify' && modifyOrder;

  const symbol = segment === 'EQ'
    ? eqSymbol
    : buildFOSymbol(foUnderlying, foExpiry, foStrike, foOptionType, foIsFutures);

  // F&O is punched in LOTS on every Indian broker: qty = lots × lotSize (NSE FAOP/70616)
  const lotSize = segment === 'FO' ? getLotSize(foUnderlying) : 1;
  const quantity = segment === 'FO' ? lots * lotSize : lots;
  const freezeLots = foSpec?.freezeLots || 0;
  const liveQuote = quotes[symbol] || quotes[eqSymbol] || null;
  const livePrice = liveQuote?.price || initialPrice || Number(modifyOrder?.price) || 0;
  const execPrice = orderType === 'MARKET' ? livePrice : (Number(limitPrice) || 0);
  const holding = holdings[symbol] || null;
  const heldQty = holding?.quantity || 0;

  const isAmo = session && session.session !== 'OPEN';

  // Session for AMO badge (Kite shows AMO whenever market is closed)
  useEffect(() => {
    if (!isOpen) return;
    api.getSession().then(setSession).catch(() => {});
  }, [isOpen]);

  // Reset / prefill on open
  useEffect(() => {
    if (!isOpen) return;
    if (isModify) {
      const o = modifyOrder;
      const sym = o.instrument?.tradingSymbol?.replace('.NS', '').replace('.BO', '') || initialSymbol;
      setEqSymbol(sym);
      setSide((o.side || 'BUY').toLowerCase());
      setOrderType(o.orderType || 'LIMIT');
      setProductType(o.productType || 'CNC');
      setValidity(o.validity || 'DAY');
      setLimitPrice(o.price ? String(o.price) : '');
      setTriggerPrice(o.triggerPrice ? String(o.triggerPrice) : '');
      setDisclosedQty(o.disclosedQuantity ? String(o.disclosedQuantity) : '');
      setLots(Number(o.quantity) || 1);
      setSegment('EQ');
    } else {
      setSegment(initialSegment);
      setEqSymbol(initialSymbol);
      setFoUnderlying(initialUnderlying);
      setFoExpiry(initialExpiry || expiriesFor(initialUnderlying)[0]?.code || '');
      setFoStrike(initialStrike || '');
      setFoOptionType(initialOptionType);
      setFoIsFutures(initialIsFutures);
      setSide(initialSide);
      setLots(1);
      setLimitPrice(initialPrice > 0 ? String(initialPrice) : '');
      setTriggerPrice('');
      setDisclosedQty('');
      setOrderType('MARKET');
    }
    setResult(null);
    setError('');
    setMarginData(null);
  }, [isOpen]); // eslint-disable-line

  useEffect(() => {
    if (!isModify) setProductType(segment === 'FO' ? 'NRML' : 'CNC');
  }, [segment]); // eslint-disable-line

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

    // ── Modify path (Kite: modify pending order) ──
    if (isModify) {
      if (orderType !== 'MARKET' && !limitPrice) { setError('Enter a limit price.'); return; }
      if ((orderType === 'SL' || orderType === 'SL-M') && !triggerPrice) { setError('Enter a trigger price for SL order.'); return; }
      setLoading(true);
      try {
        const patch = {
          price: orderType === 'MARKET' ? modifyOrder.price : Number(limitPrice),
          quantity,
          triggerPrice: triggerPrice ? Number(triggerPrice) : null,
          validity,
          disclosedQuantity: disclosedQty ? Number(disclosedQty) : null,
          orderType,
        };
        const res = await api.modifyOrder(modifyOrder.id, patch);
        setResult({ success: true, message: `Order modified — ${symbol} · Qty ${quantity} @ ${fmtINR(patch.price)}`, trade: res.order });
        onModified?.(res.order);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Place path ──
    if (!execPrice) { setError('Live price unavailable. Wait for market data or enter a limit price.'); return; }
    if (quantity <= 0) { setError('Invalid quantity.'); return; }
    if (orderType !== 'MARKET' && !limitPrice) { setError('Enter a limit / trigger price.'); return; }
    if ((orderType === 'SL' || orderType === 'SL-M') && !triggerPrice) { setError('Enter a trigger price for SL order.'); return; }
    if (segment === 'FO' && !symbol.includes('FUT') && !foStrike) { setError('Select a strike price.'); return; }
    if (segment === 'FO' && freezeLots > 0 && lots > freezeLots) { setError(`NSE freeze quantity exceeded: max ${freezeLots} lots (${freezeLots * lotSize} qty) per order. Split your order.`); return; }
    if (disclosedQty && Number(disclosedQty) > quantity) { setError('Disclosed quantity cannot exceed total quantity (max 10% rule on real exchanges).'); return; }

    setLoading(true);
    try {
      const payload = {
        type: side,
        symbol: exchange === 'BSE' && segment === 'EQ' && !symbol.endsWith('.BO') ? `${symbol}.BO` : symbol,
        quantity,
        price: execPrice,
        orderType,
        productType,
        validity,
        triggerPrice: triggerPrice ? Number(triggerPrice) : undefined,
        disclosedQuantity: disclosedQty ? Number(disclosedQty) : undefined,
      };
      const response = await onTrade(payload);
      if (!response?.success && response?.violations?.length > 0) {
        setError(response.violations[0].message);
        return;
      }
      const filledNow = response?.order?.status === 'FILLED';
      setResult({
        success: true,
        message: isAmo
          ? `AMO ${side.toUpperCase()} ${quantity} × ${symbol} @ ${fmtINR(execPrice)} — queued for next open (09:15 IST)`
          : filledNow
            ? `${side.toUpperCase()} ${quantity} × ${symbol} @ ${fmtINR(execPrice)} — Complete`
            : `${side.toUpperCase()} ${quantity} × ${symbol} @ ${fmtINR(execPrice)} — ${response?.order?.status || 'Open'}`,
        trade: response?.trade,
        block: response?.block || response?.trade,
      });
      setLots(1);
      setLimitPrice('');
      setTriggerPrice('');
      setDisclosedQty('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const needsTrigger = orderType === 'SL' || orderType === 'SL-M';
  const needsLimit = orderType === 'LIMIT' || orderType === 'GTT' || orderType === 'SL';
  const priceColor = liveQuote?.changePercent >= 0 ? 'var(--gain)' : 'var(--loss)';

  return (
    <div className="kite-dock-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="kite-dock">
        <div className={`kite-dock-head ${side}`}>
          <span style={{ fontWeight: 800, fontSize: 14, color: side === 'buy' ? '#5b9bd5' : '#eb5a47' }}>
            {isModify ? 'MODIFY ORDER' : side === 'buy' ? 'BUY' : 'SELL'}
          </span>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{symbol || 'Select Instrument'}</span>
          <span className="kite-exch">{exchange}</span>
          <span className="kite-chip" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>{segment}</span>
          {isAmo && <span className="kite-amo-badge">AMO — market {session?.session?.toLowerCase().replace(/_/g, ' ')}, executes at next open</span>}
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div className="kite-dock-body">
          {/* Col 1: side + segment + instrument */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!isModify && (
              <div className="kite-seg">
                <button className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>Buy</button>
                <button className={side === 'sell' ? 'active sell-active' : ''} onClick={() => setSide('sell')}>Sell</button>
                <div className="kite-exch-toggle" style={{ marginLeft: 'auto' }}>
                  {['NSE', 'BSE'].map(e => (
                    <button key={e} className={exchange === e ? 'active' : ''} onClick={() => setExchange(e)}>{e}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="kite-seg">
              {['EQ', 'FO'].map(s => (
                <button key={s} className={segment === s ? 'active' : ''} onClick={() => setSegment(s)} disabled={isModify}>{s === 'FO' ? 'F&O' : 'EQ'}</button>
              ))}
            </div>
            {segment === 'EQ' ? (
              <div className="kite-field">
                <label>Symbol</label>
                <input value={eqSymbol} onChange={e => setEqSymbol(e.target.value.toUpperCase())} placeholder="RELIANCE, TCS, INFY" disabled={isModify} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div className="kite-seg">
                  <button className={!foIsFutures ? 'active' : ''} onClick={() => setFoIsFutures(false)}>Options</button>
                  <button className={foIsFutures ? 'active' : ''} onClick={() => setFoIsFutures(true)}>Futures</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="kite-field">
                    <label>Underlying (lot · exch)</label>
                    <select value={foUnderlying} onChange={e => {
                      const u = e.target.value;
                      setFoUnderlying(u);
                      const first = expiriesFor(u)[0]?.code || '';
                      setFoExpiry(first);
                      const spec = getSpec(u);
                      if (spec) setExchange(spec.exchange);
                    }}>
                      {Object.entries(UNDERLYINGS).map(([u, s]) => (
                        <option key={u} value={u}>{u} · {s.lot} · {s.exchange}</option>
                      ))}
                    </select>
                  </div>
                  <div className="kite-field">
                    <label>Expiry (W=weekly M=monthly)</label>
                    <select value={foExpiry} onChange={e => setFoExpiry(e.target.value)}>
                      {expiries.map(e => <option key={e.code} value={e.code}>{expiryLabel(e)}</option>)}
                    </select>
                  </div>
                </div>
                {!foIsFutures && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div className="kite-field">
                      <label>Strike</label>
                      <input type="number" placeholder="24700" value={foStrike} onChange={e => setFoStrike(e.target.value)} />
                    </div>
                    <div className="kite-field">
                      <label>CE / PE</label>
                      <select value={foOptionType} onChange={e => setFoOptionType(e.target.value)}>
                        <option>CE</option><option>PE</option>
                      </select>
                    </div>
                  </div>
                )}
                {symbol && <div style={{ fontSize: 11, color: 'var(--accent-secondary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>📋 {symbol} · 1 lot = {lotSize} qty</div>}
                {foSpec && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {foSpec.label} · {foSpec.exchange} · {foSpec.weeklies ? 'Weekly + Monthly expiries' : 'Monthly expiries only (SEBI)'} · Max {foSpec.freezeLots} lots/order (freeze qty)
                </div>}
                {freezeLots > 0 && lots > freezeLots && (
                  <div style={{ fontSize: 11, color: 'var(--loss)', fontWeight: 700 }}>
                    Exceeds NSE freeze quantity ({freezeLots} lots). Split into multiple orders.
                  </div>
                )}
              </div>
            )}
            {segment === 'FO' && !isModify && (
              <div className="ot-alert" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b', display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11 }}>
                <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{SEBI_FO_WARNING}</span>
              </div>
            )}
            {liveQuote && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>LTP · {exchange}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: priceColor }}>{fmtINR(livePrice)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: priceColor }}>
                    {(liveQuote.changePercent ?? 0) >= 0 ? '+' : ''}{Number(liveQuote.changePercent ?? 0).toFixed(2)}%
                  </div>
                  {heldQty !== 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Pos: {heldQty > 0 ? `+${heldQty}` : heldQty} @ {fmtINR(holding?.avgPrice)}</div>}
                </div>
              </div>
            )}
          </div>

          {/* Col 2: product + type + prices */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="kite-field">
              <label>Product {productType === 'MIS' ? '· 5x leverage, SQ-OFF 15:15' : productType === 'CNC' ? '· delivery, hold days' : '· F&O overnight'}</label>
              <div className="kite-seg">
                {(segment === 'EQ' ? ['CNC', 'MIS'] : ['NRML', 'MIS']).map(p => (
                  <button key={p} className={productType === p ? 'active' : ''} onClick={() => setProductType(p)}>{p}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="kite-field">
                <label>Order type</label>
                <select value={orderType} onChange={e => setOrderType(e.target.value)}>
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                  <option value="SL">SL</option>
                  <option value="SL-M">SL-M</option>
                  <option value="GTT">GTT</option>
                  <option value="IOC">IOC</option>
                </select>
              </div>
              <div className="kite-field">
                <label>Validity</label>
                <select value={validity} onChange={e => setValidity(e.target.value)}>
                  <option value="DAY">DAY</option>
                  <option value="IOC">IOC</option>
                </select>
              </div>
            </div>
            {needsLimit && (
              <div className="kite-field">
                <label>Limit price (₹)</label>
                <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} placeholder={livePrice ? Number(livePrice).toFixed(2) : '0.00'} />
              </div>
            )}
            {needsTrigger && (
              <div className="kite-field">
                <label>Trigger price (₹) *</label>
                <input type="number" value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)} placeholder="Trigger level" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {side === 'sell' ? 'Below LTP → sell stop triggers' : 'Above LTP → buy stop triggers'}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="kite-field">
                <label>{segment === 'FO' ? `Lots (1 = ${lotSize})` : 'Qty (shares)'}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setLots(q => Math.max(1, Number(q) - 1))} style={{ width: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }}>−</button>
                  <input type="number" value={lots} onChange={e => setLots(Math.max(1, Number(e.target.value)))} min={1} style={{ textAlign: 'center' }} />
                  <button onClick={() => setLots(q => Number(q) + 1)} style={{ width: 32, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }}>+</button>
                </div>
                {segment === 'FO' && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Total {quantity} × {fmtINR(execPrice || 0)} = {fmtINR(quantity * (execPrice || 0))}</div>}
              </div>
              <div className="kite-field">
                <label>Disclosed qty (optional)</label>
                <input type="number" value={disclosedQty} onChange={e => setDisclosedQty(e.target.value)} placeholder="≤ 10% visible" />
              </div>
            </div>
          </div>

          {/* Col 3: margin + charges + submit */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>MARGIN REQUIRED</span>
                <span style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-mono)', color: marginData && !marginData.sufficient ? 'var(--loss)' : 'var(--text-primary)' }}>
                  {marginLoading ? '…' : marginData ? fmtINR(marginData.margin?.required) : fmtINR((execPrice || 0) * (quantity || 0))}
                </span>
              </div>
              {marginData && (
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Available</span>
                    <b style={{ fontFamily: 'var(--font-mono)', color: marginData.sufficient ? 'var(--gain)' : 'var(--loss)' }}>{fmtINR(marginData.available)}</b>
                  </div>
                  {marginData.margin?.leverage && marginData.margin.leverage !== '1x' && (
                    <div style={{ color: '#387ed1', fontWeight: 800, marginTop: 2 }}>⚡ {marginData.margin.leverage} leverage · {productType}</div>
                  )}
                  {marginData.margin?.note && <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>{marginData.margin.note}</div>}
                </div>
              )}
            </div>

            {marginData?.costs && (
              <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div onClick={() => setShowCostBreakdown(s => !s)} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-surface)', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <span>CHARGES (Zerodha-style)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmtINR(marginData.costs.totalCost)} {showCostBreakdown ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
                </div>
                {showCostBreakdown && (
                  <div style={{ padding: '4px 0' }}>
                    {(marginData.costs.lineItems || []).map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 12px', fontSize: 11.5 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtINR(item.value)}</span>
                      </div>
                    ))}
                    {marginData.costs.breakEvenPrice > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 12px', fontSize: 11.5, fontWeight: 800, color: '#387ed1' }}>
                        <span>Break-even</span><span style={{ fontFamily: 'var(--font-mono)' }}>{fmtINR(marginData.costs.breakEvenPrice)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && <div className="ot-alert error"><AlertCircle size={14} /><span>{error}</span></div>}
            {result?.success && (
              <div className="ot-alert success"><CheckCircle size={14} /><div><div>{result.message}</div>
                {(result.block?.blockHash || result.trade?.blockHash) && (
                  <div className="ot-block-hash">⛓ Block #{result.block?.blockIndex || result.trade?.blockIndex} · {(result.block?.blockHash || result.trade?.blockHash)?.slice(0, 24)}…</div>
                )}</div></div>
            )}

            <button className={`kite-submit ${side}`} onClick={handleTrade} disabled={loading || (!execPrice && orderType === 'MARKET' && !isModify)}>
              {loading ? 'Working…' : isModify ? `MODIFY → ${symbol}` : `${side === 'buy' ? 'BUY' : 'SELL'} ${symbol || '—'} · ${productType}${isAmo ? ' · AMO' : ''}`}
            </button>
            {!marginData?.sufficient && marginData && !result?.success && (
              <div className="ot-alert info"><Info size={14} /><span>Insufficient balance. Need {fmtINR(marginData.margin?.required)}, have {fmtINR(marginData.available)}.</span></div>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {isAmo ? 'AMO: order is queued and will execute at the next 09:15 IST open — like Zerodha/Upstox.' : 'DAY orders expire at 15:30 IST · MIS auto squared-off at 15:15 IST.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
