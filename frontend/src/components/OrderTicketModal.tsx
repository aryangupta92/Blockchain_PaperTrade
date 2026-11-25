import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bookmark, GripHorizontal, Pin, ShieldCheck, X } from 'lucide-react';
import { AccountMode, api, formatINR } from '../apiClient';

interface OrderTicketModalProps {
  mode: AccountMode;
  symbol: string;
  initialSide: 'BUY' | 'SELL';
  segment: string;
  ltp: string | null;
  initialPrice?: string | null;
  initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF';
  initialTab?: TicketTab;
  onClose: () => void;
  onOrderPlaced: () => void;
}

type TicketTab = 'TRADING' | 'INVESTING' | 'SUPER' | 'FOREVER';

export function OrderTicketModal({
  mode,
  symbol: initialSymbol,
  initialSide,
  segment,
  ltp,
  initialPrice,
  onClose,
  onOrderPlaced,
  initialProduct,
  initialTab,
}: OrderTicketModalProps) {
  const isDeriv = segment === 'FNO' || segment === 'COMM';
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol);
  const [siblingInfo, setSiblingInfo] = useState<Awaited<ReturnType<typeof api.siblingExchange>> | null>(null);
  const [pinned, setPinned] = useState(false);

  // Floating draggable position
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 235)),
    y: 72,
  }));
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);

  const defaultProduct: 'CNC' | 'MIS' | 'NRML' | 'MTF' = initialProduct ?? (isDeriv ? 'NRML' : 'CNC');
  const [tab, setTab] = useState<TicketTab>(initialTab ?? (defaultProduct === 'MIS' || isDeriv ? 'TRADING' : 'INVESTING'));
  const [side, setSide] = useState<'BUY' | 'SELL'>(initialSide);
  const [product, setProduct] = useState<'CNC' | 'MIS' | 'NRML' | 'MTF'>(defaultProduct);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'SL' | 'SL_M' | 'BO' | 'CO' | 'SUPER' | 'GTT'>(
    initialPrice ? 'LIMIT' : 'MARKET'
  );
  const [inputMode, setInputMode] = useState<'QTY' | 'AMOUNT'>('QTY');
  const [quantity, setQuantity] = useState('1');
  const [amountRupees, setAmountRupees] = useState('10000');
  const [price, setPrice] = useState(initialPrice || ltp || '');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [target, setTarget] = useState('');
  const [trailingJump, setTrailingJump] = useState('');
  const [icebergLegs, setIcebergLegs] = useState('');
  const [validity, setValidity] = useState<'DAY' | 'IOC'>('DAY');
  const [isAmo, setIsAmo] = useState(false);
  const [allowAfterHoursDemo, setAllowAfterHoursDemo] = useState(mode === 'DEMO');

  // Forever (GTT) state
  const [foreverFlag, setForeverFlag] = useState<'SINGLE' | 'OCO'>('SINGLE');
  const [foreverDir, setForeverDir] = useState<'GTE' | 'LTE'>('GTE');
  const [foreverTrig2, setForeverTrig2] = useState('');
  const [foreverLim2, setForeverLim2] = useState('');

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewOrder>> | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    setActiveSymbol(initialSymbol);
    setSide(initialSide);
    if (initialPrice) {
      setPrice(initialPrice);
      setOrderType('LIMIT');
    } else if (ltp) {
      setPrice(ltp);
    }
  }, [initialSymbol, initialSide, initialPrice, ltp]);

  // Fetch NSE <-> BSE sibling + MTF leverage + circuits
  useEffect(() => {
    api.siblingExchange(initialSymbol).then(setSiblingInfo).catch(() => setSiblingInfo(null));
  }, [initialSymbol]);

  // Switch product & orderType smoothly when changing top tab
  const selectTab = (next: TicketTab) => {
    setTab(next);
    if (next === 'TRADING') {
      setProduct(isDeriv ? 'NRML' : 'MIS');
      if (orderType === 'SUPER' || orderType === 'GTT') setOrderType('MARKET');
    } else if (next === 'INVESTING') {
      setProduct(isDeriv ? 'NRML' : 'CNC');
      if (orderType === 'SUPER' || orderType === 'GTT') setOrderType('MARKET');
    } else if (next === 'SUPER') {
      setProduct(isDeriv ? 'NRML' : 'MIS');
      setOrderType('SUPER');
      const refPx = Number(price || ltp || 0);
      if (refPx > 0 && !target && !stopLoss) {
        setTarget((side === 'BUY' ? refPx * 1.02 : refPx * 0.98).toFixed(2));
        setStopLoss((side === 'BUY' ? refPx * 0.99 : refPx * 1.01).toFixed(2));
      }
    } else if (next === 'FOREVER') {
      setProduct(isDeriv ? 'NRML' : 'CNC');
      setOrderType('GTT');
      const refPx = Number(price || ltp || 0);
      if (refPx > 0 && !triggerPrice) {
        setTriggerPrice((refPx * 1.02).toFixed(2));
        setPrice((refPx * 1.022).toFixed(2));
      }
    }
  };

  // Drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - 260, e.clientX - dragRef.current.ox)),
        y: Math.max(8, Math.min(window.innerHeight - 120, e.clientY - dragRef.current.oy)),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Compute effective quantity from Qty or Amount (₹) mode
  const lotSize = preview?.lotSize || 1;
  const refPrice = Number(price || ltp || siblingInfo?.primary.ltp || 0);
  const effectiveQty =
    inputMode === 'AMOUNT' && refPrice > 0
      ? Math.max(lotSize, Math.floor(Number(amountRupees || 0) / refPrice / lotSize) * lotSize)
      : Number(quantity);

  useEffect(() => {
    if (tab === 'FOREVER') return;
    if (!Number.isInteger(effectiveQty) || effectiveQty <= 0) return;
    const timer = setTimeout(() => {
      setPreviewErr(null);
      api
        .previewOrder({
          accountMode: mode,
          symbol: activeSymbol,
          side,
          product,
          orderType,
          quantity: effectiveQty,
          price: orderType === 'MARKET' || orderType === 'SL_M' ? null : price || null,
          triggerPrice: ['SL', 'SL_M', 'GTT'].includes(orderType) ? triggerPrice || null : null,
          stopLoss: ['BO', 'CO', 'SUPER'].includes(orderType) ? stopLoss || null : null,
          target: ['BO', 'SUPER'].includes(orderType) ? target || null : null,
          trailingJump: orderType === 'SUPER' ? trailingJump || null : null,
          validity,
          isAmo,
          allowAfterHoursDemo: mode === 'DEMO' ? allowAfterHoursDemo : false,
        })
        .then(setPreview)
        .catch((e) => {
          setPreview(null);
          setPreviewErr((e as Error).message);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [mode, activeSymbol, side, product, orderType, effectiveQty, price, triggerPrice, stopLoss, target, trailingJump, validity, isAmo, allowAfterHoursDemo, tab]);

  const applyQtyPct = (pct: number) => {
    const avail = Number(preview?.risk.availableMargin || 0);
    const lev = Number(preview?.risk.effectiveLeverage || 1);
    if (avail <= 0 || refPrice <= 0) return;
    const maxQty = Math.floor((avail * lev * pct) / refPrice / lotSize) * lotSize;
    if (maxQty >= lotSize) {
      setInputMode('QTY');
      setQuantity(String(maxQty));
    }
  };

  const handleSaveDraft = async () => {
    setSubmitErr(null);
    setResultMsg(null);
    try {
      await api.createDraftOrder({
        accountMode: mode,
        symbol: activeSymbol,
        side,
        product,
        orderType,
        quantity: Math.max(1, effectiveQty),
        price: orderType === 'MARKET' ? null : price || null,
        triggerPrice: triggerPrice || null,
        stopLoss: stopLoss || null,
        target: target || null,
        trailingJump: trailingJump || null,
      });
      setResultMsg(`Saved ${side} ${effectiveQty} ${activeSymbol} as Draft Order.`);
    } catch (e) {
      setSubmitErr((e as Error).message);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitErr(null);
    setResultMsg(null);
    try {
      if (tab === 'FOREVER') {
        await api.createForeverOrder({
          accountMode: mode,
          symbol: activeSymbol,
          orderFlag: foreverFlag,
          side,
          product: product === 'MIS' ? 'CNC' : product,
          quantity: Math.max(1, effectiveQty),
          triggerPrice: triggerPrice || refPrice,
          limitPrice: price || triggerPrice || refPrice,
          triggerDirection: foreverDir,
          triggerPrice2: foreverFlag === 'OCO' ? foreverTrig2 : null,
          limitPrice2: foreverFlag === 'OCO' ? foreverLim2 : null,
        });
        setResultMsg(`Forever Order (GTT ${foreverFlag}, 365-day) created for ${activeSymbol}.`);
        onOrderPlaced();
      } else {
        const res = await api.placeOrder({
          accountMode: mode,
          symbol: activeSymbol,
          side,
          product,
          orderType,
          quantity: effectiveQty,
          price: orderType === 'MARKET' || orderType === 'SL_M' ? null : price || null,
          triggerPrice: ['SL', 'SL_M', 'GTT'].includes(orderType) ? triggerPrice || null : null,
          stopLoss: ['BO', 'CO', 'SUPER'].includes(orderType) ? stopLoss || null : null,
          target: ['BO', 'SUPER'].includes(orderType) ? target || null : null,
          trailingJump: orderType === 'SUPER' ? trailingJump || null : null,
          icebergLegs: icebergLegs && Number(icebergLegs) >= 2 ? Number(icebergLegs) : undefined,
          validity,
          isAmo,
          idempotencyKey: `${mode}-${activeSymbol}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          allowAfterHoursDemo: mode === 'DEMO' ? allowAfterHoursDemo : false,
        });
        setResultMsg(
          res.blockchainProof
            ? `Order ${res.order.status} @ ${formatINR(res.trade?.price || 0)} • Block #${res.blockchainProof.blockIndex} (${res.blockchainProof.hash.slice(0, 10)}...)`
            : `Order ${res.order.status} queued successfully.`
        );
        onOrderPlaced();
        if (!pinned) {
          setTimeout(() => onClose(), 900);
        }
      }
    } catch (err) {
      setSubmitErr((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Live Super Order Est. Profit / Loss / Risk-Reward
  const superMetrics = (() => {
    if (orderType !== 'SUPER' || refPrice <= 0 || effectiveQty <= 0) return null;
    const t = Number(target);
    const s = Number(stopLoss);
    const estProfit = t > 0 ? (side === 'BUY' ? t - refPrice : refPrice - t) * effectiveQty : null;
    const estLoss = s > 0 ? (side === 'BUY' ? refPrice - s : s - refPrice) * effectiveQty : null;
    const rr = estProfit && estLoss && estLoss > 0 ? (estProfit / estLoss).toFixed(2) : null;
    return { estProfit, estLoss, rr };
  })();

  const chg = preview?.risk.estimatedCharges;

  const content = (
    <div
      className="floating-ticket"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Draggable Header Bar */}
      <div
        onMouseDown={(e) => {
          dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
        }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: 'grab', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <GripHorizontal size={14} color="var(--text-muted)" />
          <span className={`badge ${mode === 'DEMO' ? 'badge-warn' : 'badge-gain'}`}>{mode}</span>
          <strong style={{ fontSize: 15 }}>{activeSymbol}</strong>
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {refPrice > 0 ? formatINR(refPrice) : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            type="button"
            className={`preset-btn ${pinned ? 'active' : ''}`}
            style={{ padding: '4px 7px', fontSize: 11 }}
            title="Pin Sticky Order Window (stays open after placing orders)"
            onClick={() => setPinned((p) => !p)}
          >
            <Pin size={12} /> {pinned ? 'Pinned' : 'Pin'}
          </button>
          <button type="button" className="theme-toggle" style={{ padding: '4px 7px' }} onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* NSE <-> BSE Instant Exchange Toggle */}
      {siblingInfo && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, fontSize: 11 }}>
          <button
            type="button"
            className={`preset-btn ${activeSymbol === siblingInfo.primary.symbol ? 'active' : ''}`}
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => setActiveSymbol(siblingInfo.primary.symbol)}
          >
            {siblingInfo.primary.exchange}: {siblingInfo.primary.ltp ? formatINR(siblingInfo.primary.ltp) : '—'}
          </button>
          {siblingInfo.sibling && (
            <button
              type="button"
              className={`preset-btn ${activeSymbol === siblingInfo.sibling.instrumentId ? 'active' : ''}`}
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={() => setActiveSymbol(siblingInfo.sibling!.instrumentId)}
            >
              {siblingInfo.sibling.exchange}: {siblingInfo.sibling.ltp ? formatINR(siblingInfo.sibling.ltp) : '—'}
            </button>
          )}
          {siblingInfo.primary.asmGsmFlag && (
            <span className="badge badge-warn">{siblingInfo.primary.asmGsmFlag}</span>
          )}
        </div>
      )}

      {/* Buy / Sell Toggle */}
      <div className="account-switcher" style={{ width: '100%', marginBottom: 10 }}>
        <button
          type="button"
          className="mode-btn"
          style={{ flex: 1, background: side === 'BUY' ? 'var(--gain)' : 'transparent', color: side === 'BUY' ? '#0b0f17' : 'var(--text-secondary)' }}
          onClick={() => setSide('BUY')}
        >
          BUY
        </button>
        <button
          type="button"
          className="mode-btn"
          style={{ flex: 1, background: side === 'SELL' ? 'var(--loss)' : 'transparent', color: side === 'SELL' ? '#fff' : 'var(--text-secondary)' }}
          onClick={() => setSide('SELL')}
        >
          SELL
        </button>
      </div>

      {/* Clear separation: Normal / Overnight (CNC·NRML) vs Intraday / Scalper (MIS) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          className={`preset-btn ${product !== 'MIS' ? 'active' : ''}`}
          style={{
            padding: '5px 8px',
            fontSize: 11,
            fontWeight: 700,
            borderColor: product !== 'MIS' ? 'var(--gain)' : 'var(--border)',
            color: product !== 'MIS' ? 'var(--gain)' : 'var(--text-secondary)',
          }}
          onClick={() => {
            setProduct(isDeriv ? 'NRML' : 'CNC');
            setTab(isDeriv ? 'TRADING' : 'INVESTING');
          }}
        >
          {isDeriv ? 'Normal · Overnight (NRML)' : 'Overnight · Delivery (CNC)'}
        </button>
        <button
          type="button"
          className={`preset-btn ${product === 'MIS' ? 'active' : ''}`}
          style={{
            padding: '5px 8px',
            fontSize: 11,
            fontWeight: 700,
            borderColor: product === 'MIS' ? '#38bdf8' : 'var(--border)',
            color: product === 'MIS' ? '#38bdf8' : 'var(--text-secondary)',
          }}
          onClick={() => {
            setProduct('MIS');
            setTab('TRADING');
          }}
        >
          Intraday · Scalper (MIS)
        </button>
      </div>

      {/* 4 Order Mode Tabs: Trading | Investing | Super | Forever (GTT) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 10 }}>
        {(['TRADING', 'INVESTING', 'SUPER', 'FOREVER'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`preset-btn ${tab === t ? 'active' : ''}`}
            style={{ padding: '5px 4px', fontSize: 11 }}
            onClick={() => selectTab(t)}
          >
            {t === 'FOREVER' ? 'Forever GTT' : t[0] + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="form-stack" style={{ gap: 9 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field">
            <span>Product</span>
            <select className="input" value={product} onChange={(e) => setProduct(e.target.value as typeof product)}>
              {!isDeriv && <option value="CNC">CNC (Delivery 1x)</option>}
              {!isDeriv && <option value="MTF">MTF (Leveraged {siblingInfo?.primary.mtfLeverage || '4'}x)</option>}
              <option value="MIS">MIS (Intraday VaR+ELM)</option>
              {isDeriv && <option value="NRML">NRML (Carry Forward)</option>}
            </select>
          </label>

          {tab !== 'FOREVER' ? (
            <label className="field">
              <span>Order Type</span>
              <select className="input" value={orderType} onChange={(e) => setOrderType(e.target.value as typeof orderType)}>
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
                <option value="SL">SL (Stop-Loss Limit)</option>
                <option value="SL_M">SL-M (Stop-Loss Market)</option>
                <option value="SUPER">SUPER (3-Leg + Trailing SL)</option>
                <option value="BO">BO (Bracket Order)</option>
                <option value="CO">CO (Cover Order)</option>
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Forever Type</span>
              <select className="input" value={foreverFlag} onChange={(e) => setForeverFlag(e.target.value as 'SINGLE' | 'OCO')}>
                <option value="SINGLE">Single Trigger (365d)</option>
                <option value="OCO">OCO Target + Stop-Loss</option>
              </select>
            </label>
          )}
        </div>

        {/* Qty vs Invest Amount (₹) + Quick Chips */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.7fr', gap: 8 }}>
          <label className="field">
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{inputMode === 'QTY' ? `Qty ${lotSize > 1 ? `(Lot ${lotSize})` : ''}` : 'Amount (₹)'}</span>
              {!isDeriv && (
                <button
                  type="button"
                  style={{ border: 'none', background: 'none', color: 'var(--active-mode-accent)', fontSize: 10.5, cursor: 'pointer', padding: 0 }}
                  onClick={() => setInputMode((m) => (m === 'QTY' ? 'AMOUNT' : 'QTY'))}
                >
                  {inputMode === 'QTY' ? 'By ₹' : 'By Qty'}
                </button>
              )}
            </span>
            {inputMode === 'QTY' ? (
              <input className="input mono" type="number" min={1} step={lotSize} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            ) : (
              <input className="input mono" type="number" min={100} step={500} value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
            )}
          </label>

          <label className="field">
            <span>{tab === 'FOREVER' ? 'Limit Price (₹)' : 'Price (₹)'}</span>
            <input
              className="input mono"
              type="number"
              step={preview?.tickSize || '0.05'}
              disabled={tab !== 'FOREVER' && (orderType === 'MARKET' || orderType === 'SL_M')}
              placeholder={orderType === 'MARKET' ? 'Market' : 'Price'}
              value={tab !== 'FOREVER' && (orderType === 'MARKET' || orderType === 'SL_M') ? '' : price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>

          <label className="field">
            <span>{tab === 'FOREVER' ? 'Direction' : 'Validity'}</span>
            {tab === 'FOREVER' ? (
              <select className="input" value={foreverDir} onChange={(e) => setForeverDir(e.target.value as 'GTE' | 'LTE')}>
                <option value="GTE">LTP ≥ Trig</option>
                <option value="LTE">LTP ≤ Trig</option>
              </select>
            ) : (
              <select className="input" value={validity} onChange={(e) => setValidity(e.target.value as 'DAY' | 'IOC')}>
                <option value="DAY">DAY</option>
                <option value="IOC">IOC</option>
              </select>
            )}
          </label>
        </div>

        {/* Quick Qty & Margin-Allocation Chips */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {[1, 5, 10, 25].map((mult) => (
            <button
              key={mult}
              type="button"
              className="preset-btn"
              style={{ padding: '2px 7px', fontSize: 10.5 }}
              onClick={() => {
                setInputMode('QTY');
                setQuantity(String(Math.max(lotSize, (Number(quantity) || 0) + mult * lotSize)));
              }}
            >
              +{mult * lotSize}
            </button>
          ))}
          {[0.25, 0.5, 1].map((p) => (
            <button
              key={p}
              type="button"
              className="preset-btn"
              style={{ padding: '2px 7px', fontSize: 10.5 }}
              onClick={() => applyQtyPct(p)}
            >
              {Math.round(p * 100)}% Margin
            </button>
          ))}
          {inputMode === 'AMOUNT' && <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>≈ {effectiveQty} qty</span>}
        </div>

        {(tab === 'FOREVER' || ['SL', 'SL_M'].includes(orderType)) && (
          <div style={{ display: 'grid', gridTemplateColumns: foreverFlag === 'OCO' && tab === 'FOREVER' ? '1fr 1fr 1fr' : '1fr', gap: 8 }}>
            <label className="field">
              <span>{tab === 'FOREVER' && foreverFlag === 'OCO' ? 'Target Trigger (₹)' : 'Trigger Price (₹)'}</span>
              <input className="input mono" type="number" step="0.05" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} />
            </label>
            {tab === 'FOREVER' && foreverFlag === 'OCO' && (
              <>
                <label className="field">
                  <span>SL Trigger (₹)</span>
                  <input className="input mono" type="number" step="0.05" value={foreverTrig2} onChange={(e) => setForeverTrig2(e.target.value)} />
                </label>
                <label className="field">
                  <span>SL Limit (₹)</span>
                  <input className="input mono" type="number" step="0.05" value={foreverLim2} onChange={(e) => setForeverLim2(e.target.value)} />
                </label>
              </>
            )}
          </div>
        )}

        {tab !== 'FOREVER' && ['BO', 'CO', 'SUPER'].includes(orderType) && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label className="field">
                <span>Stop Loss (₹)</span>
                <input className="input mono" type="number" step="0.05" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
              </label>
              {(orderType === 'BO' || orderType === 'SUPER') && (
                <label className="field">
                  <span>Target (₹)</span>
                  <input className="input mono" type="number" step="0.05" value={target} onChange={(e) => setTarget(e.target.value)} />
                </label>
              )}
              {orderType === 'SUPER' && (
                <label className="field">
                  <span>Trailing Jump (₹)</span>
                  <input className="input mono" type="number" step="0.05" placeholder="e.g. 5" value={trailingJump} onChange={(e) => setTrailingJump(e.target.value)} />
                </label>
              )}
            </div>
            {superMetrics && (superMetrics.estProfit != null || superMetrics.estLoss != null) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, background: 'var(--bg-elevated)', padding: '6px 10px', borderRadius: 7 }}>
                <span>Est. Profit: <strong className="mono" style={{ color: 'var(--gain)' }}>{superMetrics.estProfit != null ? formatINR(superMetrics.estProfit) : '—'}</strong></span>
                <span>Est. Loss: <strong className="mono" style={{ color: 'var(--loss)' }}>{superMetrics.estLoss != null ? formatINR(superMetrics.estLoss) : '—'}</strong></span>
                {superMetrics.rr && <span>R:R <strong className="mono">1:{superMetrics.rr}</strong></span>}
              </div>
            )}
          </>
        )}

        {/* Iceberg Slicing & AMO / Demo Practice Options */}
        {tab !== 'FOREVER' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>Iceberg Legs:</span>
              <input
                className="input mono"
                type="number"
                min={2}
                max={20}
                placeholder="Off"
                style={{ width: 58, padding: '3px 6px', fontSize: 11.5 }}
                value={icebergLegs}
                onChange={(e) => setIcebergLegs(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input type="checkbox" checked={isAmo} onChange={(e) => setIsAmo(e.target.checked)} />
              AMO
            </label>
            {mode === 'DEMO' && !isAmo && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={allowAfterHoursDemo} onChange={(e) => setAllowAfterHoursDemo(e.target.checked)} />
                Practice after-hours
              </label>
            )}
          </div>
        )}

        {/* Margin & Statutory Charges Box */}
        {tab !== 'FOREVER' && preview && chg && (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 10, border: '1px solid var(--border-subtle)', fontSize: 11.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Margin ({preview.risk.effectiveLeverage}x)</span>
              <strong className="mono">{formatINR(preview.risk.requiredMargin)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Available ({mode})</span>
              <strong className="mono">{formatINR(preview.risk.availableMargin)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 5, marginTop: 4 }}>
              <span>Est. Statutory Charges + Brokerage</span>
              <strong className="mono" style={{ color: 'var(--warn)' }}>{formatINR(chg.totalCharges)}</strong>
            </div>
          </div>
        )}

        {preview && !preview.risk.allowed && tab !== 'FOREVER' && (
          <div className="alert-error" style={{ fontSize: 11.5 }}>
            {preview.risk.violations.map((v) => <div key={v.code}>• {v.message}</div>)}
          </div>
        )}
        {previewErr && <div className="alert-error" style={{ fontSize: 11.5 }}>{previewErr}</div>}
        {submitErr && <div className="alert-error" style={{ fontSize: 11.5 }}>{submitErr}</div>}
        {resultMsg && <div className="alert-success" style={{ fontSize: 11.5 }}>{resultMsg}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-primary"
            type="submit"
            disabled={submitting || (tab !== 'FOREVER' && preview ? !preview.risk.allowed : false)}
            style={{ flex: 1, background: side === 'BUY' ? 'var(--gain)' : 'var(--loss)', color: side === 'BUY' ? '#0b0f17' : '#fff' }}
          >
            <ShieldCheck size={14} />
            {submitting
              ? 'Submitting...'
              : tab === 'FOREVER'
                ? `Create Forever GTT (${side})`
                : `${side} ${effectiveQty} ${activeSymbol} (${product})`}
          </button>
          {tab !== 'FOREVER' && (
            <button type="button" className="theme-toggle" title="Save as Draft Order" onClick={handleSaveDraft}>
              <Bookmark size={14} /> Draft
            </button>
          )}
        </div>
      </form>
    </div>
  );

  // Non-blocking floating stage with zero backdrop blur so underlying charts/prices stay crystal clear
  if (pinned) return content;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        pointerEvents: 'none',
        background: 'transparent',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(56, 189, 248, 0.3)',
          borderRadius: 12,
        }}
      >
        {content}
      </div>
    </div>
  );
}
