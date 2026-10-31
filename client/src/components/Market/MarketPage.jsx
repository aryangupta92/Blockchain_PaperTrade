import { useState, useEffect } from 'react';
import './Market.css';
import IndexHeroCard from './IndexHeroCard';
import StockMovers from './StockMovers';
import SectorIndices from './SectorIndices';
import AdvancedChart from '../Chart/AdvancedChart';
import api from '../../services/api';
import { Maximize2, Clock, Info, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { getMarketStatus, formatIST } from '../../utils/sebi';

const HERO_INDICES = [
  { symbol: '^NSEI',       label: 'NIFTY 50'   },
  { symbol: '^BSESN',      label: 'BSE SENSEX' },
  { symbol: '^NSEBANK',    label: 'BANK NIFTY' },
  { symbol: '^CNXFINANCE', label: 'FIN NIFTY'  },
];

export default function MarketPage({ quotes, marketStatus, marketLoading, onOpenChart }) {
  const [chartSymbol, setChartSymbol]     = useState('^NSEI');
  const [chartRange, setChartRange]       = useState('1d');
  const [movers, setMovers]               = useState({ gainers: [], losers: [], active: [] });
  const [moversLoading, setMoversLoading] = useState(true);
  const [breadth, setBreadth]             = useState(null);
  const [breadthLoading, setBreadthLoading] = useState(true);
  const [istTime, setIstTime]             = useState(formatIST());

  // Load Movers and Market Breadth
  useEffect(() => {
    let alive = true;

    api.getMovers()
      .then(d => { if (alive && d) setMovers(d); })
      .catch(console.error)
      .finally(() => { if (alive) setMoversLoading(false); });

    api.getMarketBreadth()
      .then(d => { if (alive && d) setBreadth(d); })
      .catch(() => {})
      .finally(() => { if (alive) setBreadthLoading(false); });

    return () => { alive = false; };
  }, []);

  // Refresh movers + breadth every 30s for live feel
  useEffect(() => {
    const iv = setInterval(() => {
      api.getMovers().then(d => { if (d) setMovers(d); }).catch(() => {});
      api.getMarketBreadth().then(d => { if (d) setBreadth(d); }).catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  // Live IST Clock
  useEffect(() => {
    const iv = setInterval(() => setIstTime(formatIST()), 1000);
    return () => clearInterval(iv);
  }, []);

  const selectedMeta = marketStatus || getMarketStatus();
  const chartLabel   = HERO_INDICES.find(i => i.symbol === chartSymbol)?.label || chartSymbol;

  const totalBreadth = (breadth?.advances || 0) + (breadth?.declines || 0) + (breadth?.unchanged || 0) || 50;
  const advPct = ((breadth?.advances || 25) / totalBreadth) * 100;
  const decPct = ((breadth?.declines || 25) / totalBreadth) * 100;
  const unchPct = ((breadth?.unchanged || 0) / totalBreadth) * 100;
  const adRatio = breadth?.declines > 0 ? (breadth.advances / breadth.declines).toFixed(2) : '1.00';

  return (
    <div className="market-page">
      {/* ── Market Status Bar ─────────────────────────────────────────────── */}
      <div className="market-status-bar">
        <div className="market-status-left">
          <div className="market-status-indicator" style={{ background: selectedMeta.color }}>
            <span className="status-dot" style={{ background: selectedMeta.color }} />
            {selectedMeta.status}
          </div>
          <span className="market-status-reason">{selectedMeta.reason}</span>
        </div>
        <div className="market-status-right">
          <Clock size={12} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{istTime}</span>
        </div>
      </div>

      {/* ── Index Hero Row ─────────────────────────────────────────────────── */}
      <div className="index-hero-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {HERO_INDICES.map((idx) => (
          <IndexHeroCard
            key={idx.symbol}
            label={idx.label}
            symbol={idx.symbol}
            quote={quotes[idx.symbol] || null}
            loading={marketLoading}
            onClick={() => setChartSymbol(idx.symbol)}
            active={chartSymbol === idx.symbol}
            onFullScreen={() => onOpenChart && onOpenChart(idx.symbol, { shortName: idx.label, ...quotes[idx.symbol] })}
          />
        ))}
      </div>

      {/* ── Main Interactive Broker Chart ──────────────────────────────────── */}
      <div className="card" style={{ marginTop: 2, padding: 0, overflow: 'hidden', position: 'relative' }}>
        <button
          className="chart-fullscreen-btn"
          onClick={() => onOpenChart && onOpenChart(chartSymbol, { shortName: chartLabel, ...quotes[chartSymbol] })}
          title="Open full-screen Dhan-style broker chart"
        >
          <Maximize2 size={13} /> Full Screen
        </button>
        <AdvancedChart
          symbol={chartSymbol}
          label={chartLabel}
          range={chartRange}
          onRangeChange={setChartRange}
          onSymbolChange={setChartSymbol}
          quote={quotes[chartSymbol] || null}
        />
      </div>

      {/* ── Bottom Section: Breadth + FII/DII Institutional Flow ───────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
        {/* Advances & Declines */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              Market Breadth (Nifty 50)
              <Info size={12} style={{ color: 'var(--text-muted)' }} />
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background: Number(adRatio) >= 1 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                color: Number(adRatio) >= 1 ? 'var(--gain)' : 'var(--loss)',
              }}
            >
              A/D Ratio: {adRatio}
            </span>
          </div>

          {breadthLoading && !breadth ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 20, borderRadius: 6 }} />)}
            </div>
          ) : (
            <>
              {/* Counts */}
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--gain)', fontFamily: 'var(--font-mono)' }}>
                    {breadth?.advances ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Advances</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {breadth?.unchanged ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unchanged</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--loss)', fontFamily: 'var(--font-mono)' }}>
                    {breadth?.declines ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Declines</div>
                </div>
              </div>

              {/* Visual Dual-Color Breadth Bar */}
              <div style={{ width: '100%', height: 7, borderRadius: 99, background: 'var(--border)', display: 'flex', overflow: 'hidden' }}>
                <div style={{ width: `${advPct}%`, background: 'var(--gain)', transition: 'width 0.3s ease' }} />
                <div style={{ width: `${unchPct}%`, background: 'var(--text-muted)', transition: 'width 0.3s ease' }} />
                <div style={{ width: `${decPct}%`, background: 'var(--loss)', transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                <span>{advPct.toFixed(0)}% Advancing</span>
                <span>{decPct.toFixed(0)}% Declining</span>
              </div>
            </>
          )}
        </div>

        {/* FII & DII Cash Segment Activity */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              FII & DII Cash Segment Activity
              <Info size={12} style={{ color: 'var(--text-muted)' }} />
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
              {breadth?.date || 'Today'} {breadth?.fii?.estimated ? '· Estimated' : ''}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* FII Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>FII (Foreign Institutional)</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  Buy: ₹{Math.round(breadth?.fii?.buy || 0).toLocaleString()}Cr · Sell: ₹{Math.round(breadth?.fii?.sell || 0).toLocaleString()}Cr
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  className={breadth?.fii?.net >= 0 ? 'gain' : 'loss'}
                  style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)' }}
                >
                  {breadth?.fii?.net >= 0 ? '+' : ''}₹{Math.round(Math.abs(breadth?.fii?.net || 0)).toLocaleString()}Cr
                </span>
                <div style={{ fontSize: 10, color: breadth?.fii?.net >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 600 }}>
                  {breadth?.fii?.label || (breadth?.fii?.net >= 0 ? 'Net Buyers' : 'Net Sellers')}
                </div>
              </div>
            </div>

            {/* DII Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>DII (Domestic Institutional)</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  Buy: ₹{Math.round(breadth?.dii?.buy || 0).toLocaleString()}Cr · Sell: ₹{Math.round(breadth?.dii?.sell || 0).toLocaleString()}Cr
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  className={breadth?.dii?.net >= 0 ? 'gain' : 'loss'}
                  style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)' }}
                >
                  {breadth?.dii?.net >= 0 ? '+' : ''}₹{Math.round(Math.abs(breadth?.dii?.net || 0)).toLocaleString()}Cr
                </span>
                <div style={{ fontSize: 10, color: breadth?.dii?.net >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 600 }}>
                  {breadth?.dii?.label || (breadth?.dii?.net >= 0 ? 'Net Buyers' : 'Net Sellers')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Row: Movers + Sectoral Indices ──────────────────────────── */}
      <div className="market-bottom-row" style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 58%', minWidth: 320 }}>
          <StockMovers
            data={movers}
            loading={moversLoading}
            quotes={quotes}
            onOpenChart={(sym, data) => onOpenChart && onOpenChart(sym, data)}
          />
        </div>
        <div className="card" style={{ flex: '1 1 40%', minWidth: 300 }}>
          <SectorIndices
            quotes={quotes}
            onSelect={(sym) => onOpenChart && onOpenChart(sym, null)}
          />
        </div>
      </div>
    </div>
  );
}
