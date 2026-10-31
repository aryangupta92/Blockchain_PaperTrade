import { NoDataBadge, fmtPct } from '../../utils/price';
const TICKER_SYMBOLS = [
  { symbol: '^NSEI', label: 'NIFTY 50' },
  { symbol: '^BSESN', label: 'SENSEX' },
  { symbol: '^NSEBANK', label: 'BANK NIFTY' },
  { symbol: '^CNXIT', label: 'NIFTY IT' },
  { symbol: '^NSMIDCP150', label: 'NIFTY MIDCAP' },
];

function TickerItem({ name, quote }) {
  const price = quote?.price;
  const pct = quote?.changePercent;
  const real = typeof price === 'number' && isFinite(price) && price > 0;

  return (
    <div className="ticker-item">
      <span className="ticker-name">{name}</span>
      {real ? (
        <>
          <span className="ticker-price">
            {price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className={`ticker-change ${(pct || 0) >= 0 ? 'gain' : 'loss'}`}>
            {(pct || 0) >= 0 ? '▲' : '▼'} {Math.abs(pct || 0).toFixed(2)}%
          </span>
        </>
      ) : (
        <NoDataBadge compact />
      )}
    </div>
  );
}

export default function TickerStrip({ quotes, loading }) {
  const items = TICKER_SYMBOLS
    .map((s) => ({ ...s, quote: quotes?.[s.symbol] || quotes?.[s.label] || null }))
    .filter((i) => i.quote);

  const liveCount = items.filter((i) => typeof i.quote?.price === 'number' && i.quote.price > 0).length;

  if (loading || items.length === 0) {
    return (
      <div className="ticker-strip">
        <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 11 }}>
          Loading market data...
        </div>
      </div>
    );
  }

  if (liveCount === 0) {
    return (
      <div className="ticker-strip" style={{ alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
          Live feed offline - complete the Dhan consent login in <strong>Data Feed</strong> settings
        </span>
        <NoDataBadge label="NO REAL DATA" />
      </div>
    );
  }

  const doubled = [...items, ...items]; // duplicate for seamless loop

  return (
    <div className="ticker-strip">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <TickerItem key={`${item.symbol}-${i}`} name={item.label} quote={item.quote} />
        ))}
      </div>
    </div>
  );
}
