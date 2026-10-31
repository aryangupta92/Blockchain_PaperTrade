import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Layers, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const FALLBACK_SECTORS = [
  { symbol: '^NSEBANK',    label: 'Bank Nifty',    price: 48620.25, change: 129.45,  changePercent: 0.27 },
  { symbol: '^CNXIT',      label: 'Nifty IT',       price: 36450.15, change: -169.85, changePercent: -0.46 },
  { symbol: '^CNXAUTO',    label: 'Nifty Auto',     price: 22180.70, change: 90.30,   changePercent: 0.41 },
  { symbol: '^CNXFMCG',    label: 'Nifty FMCG',     price: 54920.80, change: -179.40, changePercent: -0.33 },
  { symbol: '^CNXPHARMA',  label: 'Nifty Pharma',   price: 19410.30, change: 89.70,   changePercent: 0.46 },
  { symbol: '^CNXMETAL',   label: 'Nifty Metal',    price: 8940.50,  change: 70.30,   changePercent: 0.79 },
  { symbol: '^CNXREALTY',  label: 'Nifty Realty',   price: 985.40,   change: 7.30,    changePercent: 0.75 },
  { symbol: '^CNXENERGY',  label: 'Nifty Energy',   price: 38620.40, change: 140.30,  changePercent: 0.36 },
  { symbol: '^CNXINFRA',   label: 'Nifty Infra',    price: 8460.20,  change: 49.70,   changePercent: 0.59 },
  { symbol: '^CNXFINANCE', label: 'Nifty Financial',price: 21840.90, change: 80.60,   changePercent: 0.37 },
  { symbol: '^NSMIDCP150', label: 'Midcap 150',     price: 18240.60, change: 90.40,   changePercent: 0.50 },
  { symbol: '^CNXMEDIA',   label: 'Nifty Media',    price: 1279.00,  change: 6.39,    changePercent: 0.50 },
];

function fmtPrice(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SectorIndices({ quotes = {}, onSelect }) {
  const [sectors, setSectors] = useState(FALLBACK_SECTORS);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState('1D');

  useEffect(() => {
    let alive = true;
    api.getSectorIndices()
      .then(data => {
        if (alive && data && data.length > 0) {
          setSectors(data);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="sector-indices-widget">
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
          <Layers size={14} style={{ color: 'var(--accent-primary)' }} />
          Sectoral Indices
        </div>
        <div className="tabs" style={{ display: 'flex', gap: 4 }}>
          {['1D', '1W', '1M'].map(t => (
            <button
              key={t}
              className={`tab ${timeRange === t ? 'active' : ''}`}
              onClick={() => setTimeRange(t)}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '0 4px' }}>
        <span style={{ flex: 1 }}>SECTOR INDEX</span>
        <span style={{ width: 65, textAlign: 'right' }}>POINTS</span>
        <span style={{ width: 60, textAlign: 'right' }}>% CHG</span>
        <span style={{ width: 80, textAlign: 'right' }}>LTP</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
        {sectors.map((sec) => {
          // Live tick overlay if quotes prop has it
          const liveQ = quotes[sec.symbol] || quotes[sec.symbol?.replace('^', '')] || null;
          const price = liveQ?.price || sec.price;
          const change = liveQ?.change !== undefined ? liveQ.change : sec.change;
          const changePercent = liveQ?.changePercent !== undefined ? liveQ.changePercent : sec.changePercent;
          const isGain = (changePercent || 0) >= 0;

          // Normalized width for mini bar (up to 2% max range)
          const barWidth = Math.min(100, Math.max(5, (Math.abs(changePercent || 0) / 2) * 100));

          return (
            <div
              key={sec.symbol}
              className="sector-row"
              onClick={() => onSelect?.(sec.symbol)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Subtle background strength bar */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${barWidth * 0.35}%`,
                  background: isGain ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                  pointerEvents: 'none',
                }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{sec.label}</span>
                  {isGain
                    ? <ArrowUpRight size={11} style={{ color: 'var(--gain)' }} />
                    : <ArrowDownRight size={11} style={{ color: 'var(--loss)' }} />
                  }
                </div>
              </div>

              <span
                style={{
                  width: 65,
                  textAlign: 'right',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: isGain ? 'var(--gain)' : 'var(--loss)',
                  fontWeight: 600,
                }}
              >
                {isGain ? '+' : ''}{change ? Number(change).toFixed(2) : '0.00'}
              </span>

              <span style={{ width: 60, textAlign: 'right' }}>
                <span
                  className={isGain ? 'gain' : 'loss'}
                  style={{
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: isGain ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                  }}
                >
                  {isGain ? '+' : ''}{Number(changePercent || 0).toFixed(2)}%
                </span>
              </span>

              <span
                style={{
                  width: 80,
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                {fmtPrice(price)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
