const TICKER_SYMBOLS = [
  { yahoo: '^NSEI', label: 'NIFTY 50' },
  { yahoo: '^BSESN', label: 'SENSEX' },
  { yahoo: '^NSEBANK', label: 'BANK NIFTY' },
  { yahoo: '^CNXIT', label: 'NIFTY IT' },
  { yahoo: '^NSEMDCP50', label: 'NIFTY MID' },
];

function TickerItem({ name, quote }) {
  const price = quote?.price;
  const pct = quote?.changePercent;
  if (!price) return null;
  return (
    <div className="ticker-item">
      <span className="ticker-name">{name}</span>
      <span className="ticker-price">
        {price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`ticker-change ${pct >= 0 ? 'gain' : 'loss'}`}>
        {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)?.toFixed(2)}%
      </span>
    </div>
  );
}

export default function TickerStrip({ quotes, loading }) {
  const items = TICKER_SYMBOLS.map((s) => ({
    ...s,
    quote: quotes[s.yahoo] || quotes[s.label] || null,
  })).filter(i => i.quote);

  if (loading || items.length === 0) {
    return (
      <div className="ticker-strip">
        <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 11 }}>
          Loading market data…
        </div>
      </div>
    );
  }

  const doubled = [...items, ...items]; // duplicate for seamless loop

  return (
    <div className="ticker-strip">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <TickerItem key={`${item.yahoo}-${i}`} name={item.label} quote={item.quote} />
        ))}
      </div>
    </div>
  );
}
