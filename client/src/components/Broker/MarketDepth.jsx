import { useMemo, useState } from 'react';

const C = {
  bg: '#131722',
  surface: '#1e222d',
  surface2: '#2a2e39',
  text: '#d1d4dc',
  muted: '#787b86',
  accent: '#2962ff',
  gain: '#089981',
  loss: '#f23645',
};

const EXCHANGES = ['NSE', 'BSE'];

function fmtPrice(n, tickSize) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const decimals = tickSize != null ? Math.max(2, String(tickSize).split('.')[1]?.length || 2) : 2;
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtQty(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return '—';
  if (v >= 100000) return (v / 100000).toFixed(1) + 'L';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.surface, borderRadius: 6, padding: '10px 12px', flex: 1, minWidth: 0, border: `1px solid ${C.surface2}` }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function MarketDepth({ symbol, depth, tickSize, ltp: quoteLtp, onOpenSettings }) {
  const [exchange, setExchange] = useState('NSE');

  const bids = useMemo(() => (depth?.bids || []).slice(0, 5), [depth]);
  const asks = useMemo(() => (depth?.asks || []).slice(0, 5), [depth]);
  const hasDepth = bids.length > 0 || asks.length > 0;

  const metrics = useMemo(() => {
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const spreadPct = spread != null && bestAsk ? (spread / bestAsk) * 100 : null;

    const totalBid = bids.reduce((s, b) => s + (b.quantity || 0), 0);
    const totalAsk = asks.reduce((s, a) => s + (a.quantity || 0), 0);
    const total = totalBid + totalAsk;
    const bidRatio = total > 0 ? (totalBid / total) * 100 : 50;
    const askRatio = total > 0 ? (totalAsk / total) * 100 : 50;
    const imbalance = total > 0 ? ((totalBid - totalAsk) / total) * 100 : 0;

    const maxQ = Math.max(1, ...bids.map(b => b.quantity || 0), ...asks.map(a => a.quantity || 0));
    const maxCumulative = Math.max(
      bids.reduce((s, b) => s + (b.quantity || 0), 0),
      asks.reduce((s, a) => s + (a.quantity || 0), 0),
      1
    );

    const bidCum = [];
    let run = 0;
    bids.forEach(b => { run += b.quantity || 0; bidCum.push(run); });
    const askCum = [];
    run = 0;
    asks.forEach(a => { run += a.quantity || 0; askCum.push(run); });

    return { bestBid, bestAsk, spread, spreadPct, totalBid, totalAsk, bidRatio, askRatio, imbalance, maxQ, maxCumulative, bidCum, askCum };
  }, [bids, asks]);

  const ltp = depth?.ltp ?? quoteLtp ?? null;
  const ltpUp = (depth?.ltpChange ?? 0) >= 0;

  const chartWidth = 100;
  const chartHeight = 140;
  const halfW = chartWidth / 2;
  const buildPath = (cum, side) => {
    const pts = cum.map((c, i) => {
      const x = side === 'bid' ? halfW - (c / metrics.maxCumulative) * halfW : halfW + (c / metrics.maxCumulative) * halfW;
      const y = (i / Math.max(1, cum.length - 1)) * chartHeight;
      return { x, y };
    });
    if (pts.length === 0) return { line: '', area: '' };
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${halfW},${chartHeight} Z`;
    return { line: pts.length > 1 ? line : '', area };
  };
  const bidPath = buildPath(metrics.bidCum, 'bid');
  const askPath = buildPath(metrics.askCum, 'ask');

  const Row = ({ level, side }) => {
    const data = side === 'bid' ? bids[level] : asks[level];
    if (!data) return null;
    const qty = data.quantity || 0;
    const barW = Math.max(3, (qty / metrics.maxQ) * 100);
    const color = side === 'bid' ? C.gain : C.loss;
    const cum = side === 'bid' ? metrics.bidCum[level] : metrics.askCum[level];
    const cumPct = metrics.maxCumulative > 0 ? (cum / metrics.maxCumulative) * 100 : 0;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 64px 44px', alignItems: 'center', gap: 8, padding: '5px 12px', background: `linear-gradient(to ${side === 'bid' ? 'left' : 'right'}, ${side === 'bid' ? 'rgba(8,153,129,0.18)' : 'rgba(242,54,69,0.18)'}, transparent ${barW}%)`, borderBottom: `1px solid ${C.surface}` }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color }}>{fmtPrice(data.price, tickSize)}</span>
        <div style={{ position: 'relative', height: 22 }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, [side === 'bid' ? 'left' : 'right']: 0, width: `${barW}%`, background: side === 'bid' ? 'rgba(8,153,129,0.25)' : 'rgba(242,54,69,0.25)', borderRadius: 2 }} />
          <span style={{ position: 'relative', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: C.text }}>{fmtNum(qty)}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.muted }}>{cumPct.toFixed(0)}%</span>
        </div>
        <span style={{ textAlign: 'right', fontSize: 11, color: C.muted, fontFamily: 'var(--font-mono)' }}>{data.orders ?? '—'}</span>
      </div>
    );
  };

  return (
    <div style={{ background: C.bg, borderRadius: 10, border: `1px solid ${C.surface2}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.surface2}`, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Market Depth · {symbol || '—'}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
            {hasDepth ? <span style={{ color: C.gain, fontWeight: 700 }}>● LIVE · DhanHQ</span> : 'Real Level-2 book'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {ltp != null && (
            <div style={{ textAlign: 'right', marginRight: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: ltpUp ? C.gain : C.loss }}>{fmtPrice(ltp, tickSize)}</div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: ltpUp ? C.gain : C.loss }}>
                {ltpUp ? '+' : ''}{depth?.ltpChange?.toFixed(2)} ({ltpUp ? '+' : ''}{depth?.ltpChangePercent?.toFixed(2)}%)
              </div>
            </div>
          )}
          <div style={{ display: 'flex', background: C.surface, borderRadius: 6, padding: 3, gap: 3 }}>
            {EXCHANGES.map(ex => (
              <button
                key={ex}
                onClick={() => setExchange(ex)}
                style={{ background: exchange === ex ? C.accent : 'transparent', color: exchange === ex ? '#fff' : C.muted, border: 'none', borderRadius: 4, padding: '5px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hasDepth ? (
        <div style={{ padding: '28px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 6 }}>Live depth not connected</div>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
            Level-2 bid/ask data requires a DhanHQ account. Free quotes are still real-time
            for the price and chart, but NSE does not expose a public market-depth API.
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Connect real feed in Settings
            </button>
          )}
        </div>
      ) : (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: C.surface2 }}>
        <div>
          <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: C.gain, textTransform: 'uppercase', letterSpacing: 0.6, background: C.surface, borderBottom: `1px solid ${C.surface2}` }}>
            Bids · Buy Pressure
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 64px 44px', padding: '4px 12px', fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Price</span><span>Qty</span><span style={{ textAlign: 'right' }}>Cum%</span><span style={{ textAlign: 'right' }}>Orders</span>
          </div>
          {bids.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No bid data</div>
          ) : (
            bids.map((_, i) => <Row key={`b${i}`} level={i} side="bid" />)
          )}
        </div>
        <div style={{ borderLeft: `1px solid ${C.surface2}` }}>
          <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: C.loss, textTransform: 'uppercase', letterSpacing: 0.6, background: C.surface, borderBottom: `1px solid ${C.surface2}` }}>
            Asks · Sell Pressure
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 64px 44px', padding: '4px 12px', fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <span>Price</span><span>Qty</span><span style={{ textAlign: 'right' }}>Cum%</span><span style={{ textAlign: 'right' }}>Orders</span>
          </div>
          {asks.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No ask data</div>
          ) : (
            asks.map((_, i) => <Row key={`a${i}`} level={i} side="ask" />)
          )}
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.surface2}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Cumulative Depth</div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: chartHeight, display: 'block' }}>
          <line x1={halfW} y1={0} x2={halfW} y2={chartHeight} stroke={C.surface2} strokeWidth={0.5} strokeDasharray="2 2" />
          <path d={bidPath.area} fill="rgba(8,153,129,0.15)" />
          <path d={askPath.area} fill="rgba(242,54,69,0.15)" />
          {bidPath.line && <path d={bidPath.line} fill="none" stroke={C.gain} strokeWidth={1.5} />}
          {askPath.line && <path d={askPath.line} fill="none" stroke={C.loss} strokeWidth={1.5} />}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginTop: 4 }}>
          <span style={{ color: C.gain }}>◄ Bids {fmtQty(metrics.totalBid)}</span>
          <span>Spread {metrics.spread != null ? fmtPrice(metrics.spread, tickSize) : '—'}</span>
          <span style={{ color: C.loss }}>Asks {fmtQty(metrics.totalAsk)} ►</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: `1px solid ${C.surface2}`, flexWrap: 'wrap' }}>
        <MetricCard
          label="Spread"
          value={metrics.spread != null ? fmtPrice(metrics.spread, tickSize) : '—'}
          sub={metrics.spreadPct != null ? `${metrics.spreadPct.toFixed(3)}% of ask` : ''}
          color={C.accent}
        />
        <MetricCard
          label="Bid/Ask Ratio"
          value={`${metrics.bidRatio.toFixed(1)} / ${metrics.askRatio.toFixed(1)}`}
          sub={`${fmtQty(metrics.totalBid)} vs ${fmtQty(metrics.totalAsk)}`}
        />
        <MetricCard
          label="Depth Imbalance"
          value={`${metrics.imbalance >= 0 ? '+' : ''}${metrics.imbalance.toFixed(1)}%`}
          sub={metrics.imbalance > 5 ? 'Buyers in control' : metrics.imbalance < -5 ? 'Sellers in control' : 'Balanced'}
          color={metrics.imbalance > 5 ? C.gain : metrics.imbalance < -5 ? C.loss : C.text}
        />
      </div>

      <div style={{ padding: '8px 16px', borderTop: `1px solid ${C.surface2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', height: 6, flex: 1, borderRadius: 99, overflow: 'hidden', background: C.surface, maxWidth: 240 }}>
          <div style={{ width: `${metrics.bidRatio}%`, background: C.gain, transition: 'width 0.3s' }} />
          <div style={{ width: `${metrics.askRatio}%`, background: C.loss, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginLeft: 12, fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: C.gain }}>{metrics.bidRatio.toFixed(0)}%</span>
          {' / '}
          <span style={{ color: C.loss }}>{metrics.askRatio.toFixed(0)}%</span>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
