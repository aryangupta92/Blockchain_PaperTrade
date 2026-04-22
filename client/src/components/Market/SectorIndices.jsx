const SECTORS = [
  { label: 'Bank Nifty', yahoo: '^NSEBANK' },
  { label: 'Nifty IT', yahoo: '^CNXIT' },
  { label: 'Nifty Pharma', yahoo: '^CNXPHARMA' },
  { label: 'Nifty FMCG', yahoo: '^CNXFMCG' },
  { label: 'Nifty Auto', yahoo: '^CNXAUTO' },
  { label: 'Nifty Metal', yahoo: '^CNXMETAL' },
  { label: 'Nifty Realty', yahoo: '^CNXREALTY' },
  { label: 'Nifty Energy', yahoo: '^CNXENERGY' },
];

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '—';
}

export default function SectorIndices({ quotes, onSelect }) {
  return (
    <div>
      <div className="section-header" style={{ marginBottom: 10 }}>
        <span className="section-title">Sectoral Indices</span>
        <div className="tabs">
          <button className="tab active">1 Day</button>
          <button className="tab">1 Week</button>
          <button className="tab">1 Month</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 10, color: 'var(--text-muted)' }}>
        <span style={{ flex: 1 }}>Name</span>
        <span style={{ width: 60, textAlign: 'right' }}>Change</span>
        <span style={{ width: 50, textAlign: 'right' }}>% Chg</span>
        <span style={{ width: 70, textAlign: 'right' }}>Price</span>
      </div>

      {SECTORS.map((sec) => {
        const q = quotes[sec.yahoo] || null;
        const isGain = (q?.changePercent || 0) >= 0;
        return (
          <div key={sec.yahoo} className="sector-row" onClick={() => onSelect?.(sec.yahoo)}>
            <span className="sector-name">{sec.label}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 60, textAlign: 'right', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: isGain ? 'var(--gain)' : 'var(--loss)' }}>
                {q ? (isGain ? '+' : '') + (q.change?.toFixed(2) || '0.00') : '—'}
              </span>
              <span style={{ width: 50, textAlign: 'right', fontSize: 11 }}>
                {q ? (
                  <span className={isGain ? 'gain' : 'loss'}>
                    {isGain ? '+' : ''}{q.changePercent?.toFixed(2)}%
                  </span>
                ) : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
              </span>
              <span className="sector-price" style={{ width: 70, textAlign: 'right' }}>
                {q ? fmtPrice(q.price) : <span className="skeleton" style={{ height: 13, width: 60, display: 'inline-block' }} />}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
