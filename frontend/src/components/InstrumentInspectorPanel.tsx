import { useEffect, useState } from 'react';
import { Activity, BarChart3, Layers, LineChart, RefreshCw, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { api, formatINR, getMarketWsUrl, mergeNormalizedQuote } from '../apiClient';

export interface InspectorQuoteSnapshot {
  instrumentId?: string;
  symbol: string;
  tradingSymbol?: string;
  displayName?: string;
  exchange?: string;
  segment?: string;
  ltp?: string | null;
  prevClose?: string | null;
  open?: string | null;
  high?: string | null;
  low?: string | null;
  change?: string | null;
  changePercent?: string | null;
  volume?: number | null;
  vwap?: string | null;
  openInterest?: number | null;
  upperCircuit?: string | null;
  lowerCircuit?: string | null;
  week52High?: string | null;
  week52Low?: string | null;
  totalBuyQty?: number | null;
  totalSellQty?: number | null;
  bidDepth?: Array<{ price: string; quantity: number; orders?: number }>;
  askDepth?: Array<{ price: string; quantity: number; orders?: number }>;
}

interface InstrumentInspectorPanelProps {
  symbol: string | null;
  segment?: string;
  initialQuote?: InspectorQuoteSnapshot | null;
  onTradeClick: (
    symbol: string,
    side: 'BUY' | 'SELL',
    segment: string,
    ltp: string | null,
    priceOverride?: string | null,
    initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF'
  ) => void;
  onChartClick: (symbol: string, segment: string) => void;
  onOptionChainClick?: (underlying: string) => void;
  onSelectSymbol?: (symbol: string, segment: string) => void;
  title?: string;
}

type FundamentalsData = Awaited<ReturnType<typeof api.marketFundamentals>>;
type SiblingData = Awaited<ReturnType<typeof api.siblingExchange>>;

export function InstrumentInspectorPanel({
  symbol,
  segment = 'EQ',
  initialQuote = null,
  onTradeClick,
  onChartClick,
  onOptionChainClick,
  onSelectSymbol,
  title = 'Instrument Details & Depth',
}: InstrumentInspectorPanelProps) {
  const [liveQuote, setLiveQuote] = useState<InspectorQuoteSnapshot | null>(initialQuote);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [siblingInfo, setSiblingInfo] = useState<SiblingData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const symUp = symbol?.toUpperCase();
    const matchesTarget = (q: InspectorQuoteSnapshot | null | undefined) =>
      Boolean(q && symUp && (q.symbol?.toUpperCase() === symUp || q.instrumentId?.toUpperCase() === symUp));

    setLiveQuote((prev) => {
      if (!initialQuote) return matchesTarget(prev) ? prev : null;
      if (
        prev &&
        matchesTarget(prev) &&
        (prev.symbol?.toUpperCase() === initialQuote.symbol?.toUpperCase() ||
          (prev.instrumentId && prev.instrumentId === initialQuote.instrumentId))
      ) {
        return mergeNormalizedQuote(prev, initialQuote);
      }
      return initialQuote;
    });
  }, [symbol, initialQuote]);

  const loadDetails = async (sym: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [qRes, fRes, sRes] = await Promise.allSettled([
        api.quotes([sym]),
        api.marketFundamentals(sym),
        api.siblingExchange(sym),
      ]);
      if (qRes.status === 'fulfilled' && qRes.value.quotes[0]) {
        setLiveQuote((prev) => mergeNormalizedQuote(prev, qRes.value.quotes[0]));
      } else if (fRes.status === 'fulfilled' && fRes.value.quote) {
        const fq = fRes.value.quote;
        setLiveQuote((prev) => mergeNormalizedQuote(prev, { symbol: sym, ...fq }));
      }
      if (fRes.status === 'fulfilled') {
        setFundamentals(fRes.value);
      }
      if (sRes.status === 'fulfilled') {
        setSiblingInfo(sRes.value);
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    if (!symbol) {
      setFundamentals(null);
      setSiblingInfo(null);
      return;
    }
    loadDetails(symbol, true);
    const id = setInterval(() => {
      loadDetails(symbol, false);
    }, 4500);

    const ws = new WebSocket(getMarketWsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', symbols: [symbol] }));
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as { type: string; data?: InspectorQuoteSnapshot };
        const symUp = symbol.toUpperCase();
        if (
          msg.type === 'quote' &&
          msg.data &&
          (msg.data.symbol?.toUpperCase() === symUp || msg.data.instrumentId?.toUpperCase() === symUp)
        ) {
          setLiveQuote((prev) => mergeNormalizedQuote(prev, msg.data!));
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      clearInterval(id);
      ws.close();
    };
  }, [symbol]);

  if (!symbol) {
    return (
      <section className="panel" style={{ position: 'sticky', top: 68 }}>
        <div className="panel-head">
          <h2><Layers size={15} /> {title}</h2>
        </div>
        <div className="panel-body" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
          Select any stock, ETF, futures, option, or commodity row to inspect full contract fundamentals, circuit limits, live 5-level DOM depth, and one-click order actions.
        </div>
      </section>
    );
  }

  const q: InspectorQuoteSnapshot | null =
    liveQuote ||
    initialQuote ||
    (fundamentals?.quote ? { symbol, ...fundamentals.quote } : null);
  const resolvedSegment = (fundamentals?.segment || q?.segment || segment || 'EQ').toUpperCase();
  const isDeriv = resolvedSegment === 'FNO' || resolvedSegment === 'COMM';
  const normalProduct: 'CNC' | 'NRML' = isDeriv ? 'NRML' : 'CNC';
  const ltp = q?.ltp ?? null;
  const ltpNum = Number(ltp || 0);
  const lowNum = Number(q?.low || 0);
  const highNum = Number(q?.high || 0);
  const dayPct = highNum > lowNum && ltpNum > 0
    ? Math.max(0, Math.min(100, ((ltpNum - lowNum) / (highNum - lowNum)) * 100))
    : 50;

  const w52Low = Number(fundamentals?.week52Low || q?.week52Low || 0);
  const w52High = Number(fundamentals?.week52High || q?.week52High || 0);
  const w52Pct = w52High > w52Low && ltpNum > 0
    ? Math.max(0, Math.min(100, ((ltpNum - w52Low) / (w52High - w52Low)) * 100))
    : null;

  const chg = Number(q?.change || 0);
  const chgPct = Number(q?.changePercent || 0);
  const positive = chg >= 0;
  const bids = q?.bidDepth || [];
  const asks = q?.askDepth || [];
  const maxBidQty = Math.max(1, ...bids.map((b) => b.quantity || 0));
  const maxAskQty = Math.max(1, ...asks.map((a) => a.quantity || 0));
  const totBuy = q?.totalBuyQty ?? bids.reduce((s, b) => s + (b.quantity || 0), 0);
  const totSell = q?.totalSellQty ?? asks.reduce((s, a) => s + (a.quantity || 0), 0);
  const buyPressurePct = totBuy + totSell > 0 ? (totBuy / (totBuy + totSell)) * 100 : 50;

  // Option Chain shortcut underlying root
  const baseUnderlying = symbol.replace(/-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC).*/i, '').split(' ')[0];
  const supportsOptionChain = resolvedSegment === 'FNO' || resolvedSegment === 'IDX' || resolvedSegment === 'EQ';

  const companyEntries: Array<[string, string]> = [];
  if (fundamentals?.companyInfo && typeof fundamentals.companyInfo === 'object') {
    const info = fundamentals.companyInfo as Record<string, unknown>;
    const candidateKeys: Array<[string, string]> = [
      ['sector', 'Sector'],
      ['industry', 'Industry'],
      ['marketCap', 'Market Cap'],
      ['peRatio', 'P/E Ratio'],
      ['pbRatio', 'P/B Ratio'],
      ['roe', 'ROE'],
      ['eps', 'EPS'],
      ['dividendYield', 'Div Yield'],
      ['faceValue', 'Face Value'],
      ['bookValue', 'Book Value'],
    ];
    for (const [k, label] of candidateKeys) {
      const val = info[k];
      if (val !== undefined && val !== null && val !== '') {
        companyEntries.push([label, String(val)]);
      }
    }
  }

  return (
    <section className="panel" style={{ position: 'sticky', top: 68 }}>
      <div className="panel-head" style={{ gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14, letterSpacing: '0.01em' }}>
              {fundamentals?.tradingSymbol || q?.tradingSymbol || symbol}
            </strong>
            <span className="pill">{fundamentals?.exchange || q?.exchange || 'NSE'}</span>
            <span className="pill" style={{ background: 'rgba(56, 189, 248, 0.14)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)' }}>
              {resolvedSegment}
            </span>
            {fundamentals?.asmGsmFlag && fundamentals.asmGsmFlag !== 'NONE' && (
              <span className="pill" style={{ background: 'rgba(245, 158, 11, 0.16)', color: 'var(--warn)' }}>
                {fundamentals.asmGsmFlag}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fundamentals?.displayName || q?.displayName || symbol}
          </div>
        </div>
        <button
          type="button"
          className="theme-toggle"
          style={{ padding: '4px 6px' }}
          title="Refresh live quote & depth"
          onClick={() => loadDetails(symbol, true)}
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Live LTP & Change */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
              {ltpNum > 0 ? formatINR(ltpNum) : '—'}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: chg > 0 ? 'var(--gain)' : chg < 0 ? 'var(--loss)' : 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 3,
              }}
            >
              {chg >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {q?.change != null && q?.changePercent != null
                ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)} (${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%)`
                : '—'}
            </div>
          </div>

          {siblingInfo?.sibling && onSelectSymbol && (
            <button
              type="button"
              className="preset-btn"
              style={{ fontSize: 10.5, padding: '4px 8px' }}
              onClick={() => onSelectSymbol(siblingInfo.sibling!.symbol, resolvedSegment)}
              title={`Switch to ${siblingInfo.sibling.exchange}`}
            >
              {siblingInfo.sibling.exchange}: {siblingInfo.sibling.ltp ? formatINR(siblingInfo.sibling.ltp) : 'Switch'}
            </button>
          )}
        </div>

        {/* Action Grid: Normal/Overnight vs Intraday Scalper clearly separated */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button
              type="button"
              className="btn-primary"
              style={{ background: 'var(--gain)', borderColor: 'var(--gain)', justifyContent: 'center', fontSize: 12, padding: '7px 8px' }}
              onClick={() => onTradeClick(symbol, 'BUY', resolvedSegment, ltp, null, normalProduct)}
            >
              Buy {normalProduct}
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: 'var(--loss)', borderColor: 'var(--loss)', justifyContent: 'center', fontSize: 12, padding: '7px 8px' }}
              onClick={() => onTradeClick(symbol, 'SELL', resolvedSegment, ltp, null, normalProduct)}
            >
              Sell {normalProduct}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button
              type="button"
              className="preset-btn"
              style={{ justifyContent: 'center', fontSize: 11, color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.45)', fontWeight: 700 }}
              onClick={() => onTradeClick(symbol, 'BUY', resolvedSegment, ltp, null, 'MIS')}
            >
              <Zap size={11} /> Scalper Buy MIS
            </button>
            <button
              type="button"
              className="preset-btn"
              style={{ justifyContent: 'center', fontSize: 11, color: '#f97316', borderColor: 'rgba(249, 115, 22, 0.45)', fontWeight: 700 }}
              onClick={() => onTradeClick(symbol, 'SELL', resolvedSegment, ltp, null, 'MIS')}
            >
              <Zap size={11} /> Scalper Sell MIS
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: supportsOptionChain && onOptionChainClick ? '1fr 1fr' : '1fr', gap: 6 }}>
            <button
              type="button"
              className="theme-toggle"
              style={{ justifyContent: 'center', fontSize: 11.5, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={() => onChartClick(symbol, resolvedSegment)}
            >
              <LineChart size={13} /> Open Chart
            </button>
            {supportsOptionChain && onOptionChainClick && (
              <button
                type="button"
                className="theme-toggle"
                style={{ justifyContent: 'center', fontSize: 11.5, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 5 }}
                onClick={() => onOptionChainClick(baseUnderlying)}
              >
                <BarChart3 size={13} /> Option Chain
              </button>
            )}
          </div>
        </div>

        {/* Day Range Bar */}
        <div style={{ background: 'var(--bg-elevated)', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
            <span>Day Low <strong className="mono" style={{ color: 'var(--text-primary)' }}>{lowNum > 0 ? formatINR(lowNum) : '—'}</strong></span>
            <span>Day High <strong className="mono" style={{ color: 'var(--text-primary)' }}>{highNum > 0 ? formatINR(highNum) : '—'}</strong></span>
          </div>
          <div style={{ height: 5, background: 'rgba(148, 163, 184, 0.2)', borderRadius: 99, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${dayPct}%`, background: positive ? 'var(--gain)' : 'var(--loss)' }} />
          </div>
          {w52Pct !== null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, marginBottom: 4 }}>
                <span>52W L <strong className="mono" style={{ color: 'var(--text-primary)' }}>{formatINR(w52Low)}</strong></span>
                <span>52W H <strong className="mono" style={{ color: 'var(--text-primary)' }}>{formatINR(w52High)}</strong></span>
              </div>
              <div style={{ height: 5, background: 'rgba(148, 163, 184, 0.2)', borderRadius: 99, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${w52Pct}%`, background: '#38bdf8' }} />
              </div>
            </>
          )}
        </div>

        {/* OHLC, Volume, VWAP & Circuit Specs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 11.5 }}>
          <div className="metric-box">
            <span className="m-label">Open / Prev Close</span>
            <span className="mono m-val">
              {q?.open ? Number(q.open).toFixed(2) : '—'} / {q?.prevClose ? Number(q.prevClose).toFixed(2) : '—'}
            </span>
          </div>
          <div className="metric-box">
            <span className="m-label">ATP / VWAP</span>
            <span className="mono m-val">{q?.vwap ? formatINR(q.vwap) : '—'}</span>
          </div>
          <div className="metric-box">
            <span className="m-label">Volume</span>
            <span className="mono m-val">{q?.volume ? Number(q.volume).toLocaleString('en-IN') : '—'}</span>
          </div>
          <div className="metric-box">
            <span className="m-label">Open Interest</span>
            <span className="mono m-val">{q?.openInterest ? Number(q.openInterest).toLocaleString('en-IN') : '—'}</span>
          </div>
          <div className="metric-box">
            <span className="m-label">Lower / Upper Ckt</span>
            <span className="mono m-val">
              {fundamentals?.lowerCircuit || q?.lowerCircuit || '—'} / {fundamentals?.upperCircuit || q?.upperCircuit || '—'}
            </span>
          </div>
          <div className="metric-box">
            <span className="m-label">Lot / Tick · MTF</span>
            <span className="mono m-val">
              {fundamentals?.lotSize ?? 1} / {fundamentals?.tickSize ?? '0.05'} · {fundamentals?.mtfLeverage || '—'}x
            </span>
          </div>
          {fundamentals?.isin && (
            <div className="metric-box" style={{ gridColumn: 'span 2' }}>
              <span className="m-label">ISIN · Exchange ID</span>
              <span className="mono m-val" style={{ fontSize: 11 }}>
                {fundamentals.isin} · {fundamentals.instrumentId}
              </span>
            </div>
          )}
        </div>

        {/* Live Level-5 Market Depth (Click any level to stage Limit Order) */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Activity size={12} /> Market Depth (Click price for Limit)
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
              {totBuy.toLocaleString('en-IN')} B · {totSell.toLocaleString('en-IN')} S
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 99, background: 'var(--loss)', overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', width: `${buyPressurePct}%`, background: 'var(--gain)' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>BID</span><span>QTY</span>
              </div>
              {bids.length > 0 ? bids.slice(0, 5).map((lvl, idx) => (
                <div
                  key={idx}
                  onClick={() => onTradeClick(symbol, 'BUY', resolvedSegment, ltp, lvl.price, normalProduct)}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '3px 5px',
                    borderRadius: 4,
                    marginBottom: 2,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    fontSize: 11.5,
                  }}
                >
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${((lvl.quantity || 0) / maxBidQty) * 100}%`, background: 'rgba(16, 185, 129, 0.14)' }} />
                  <span className="mono" style={{ color: 'var(--gain)', position: 'relative' }}>{Number(lvl.price).toFixed(2)}</span>
                  <span className="mono" style={{ position: 'relative' }}>{lvl.quantity}</span>
                </div>
              )) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No live bids</div>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>ASK</span><span>QTY</span>
              </div>
              {asks.length > 0 ? asks.slice(0, 5).map((lvl, idx) => (
                <div
                  key={idx}
                  onClick={() => onTradeClick(symbol, 'SELL', resolvedSegment, ltp, lvl.price, normalProduct)}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '3px 5px',
                    borderRadius: 4,
                    marginBottom: 2,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    fontSize: 11.5,
                  }}
                >
                  <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${((lvl.quantity || 0) / maxAskQty) * 100}%`, background: 'rgba(239, 68, 68, 0.14)' }} />
                  <span className="mono" style={{ color: 'var(--loss)', position: 'relative' }}>{Number(lvl.price).toFixed(2)}</span>
                  <span className="mono" style={{ position: 'relative' }}>{lvl.quantity}</span>
                </div>
              )) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No live asks</div>
              )}
            </div>
          </div>
        </div>

        {/* Company Fundamentals if present */}
        {companyEntries.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Fundamentals & Ratios</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 11 }}>
              {companyEntries.map(([label, val]) => (
                <div key={label} className="metric-box">
                  <span className="m-label">{label}</span>
                  <span className="mono m-val">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
