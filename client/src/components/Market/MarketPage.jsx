import { useState, useEffect } from 'react';
import './Market.css';
import IndexHeroCard from './IndexHeroCard';
import StockMovers from './StockMovers';
import SectorIndices from './SectorIndices';
import AdvancedChart from '../Chart/AdvancedChart';
import api from '../../services/api';
import { Maximize2, Clock, Info } from 'lucide-react';
import { getMarketStatus, formatIST } from '../../utils/sebi';

const HERO_INDICES = [
  { symbol: '^NSEI',   label: 'NIFTY 50'  },
  { symbol: '^BSESN',  label: 'BSE SENSEX' },
  { symbol: '^NSEBANK',label: 'BANK NIFTY' },
];

export default function MarketPage({ quotes, marketStatus, marketLoading, onOpenChart }) {
  const [chartSymbol, setChartSymbol] = useState('^NSEI');
  const [chartRange, setChartRange]   = useState('5d');
  const [movers, setMovers]           = useState({ gainers: [], losers: [], active: [] });
  const [moversLoading, setMoversLoading] = useState(true);
  const [fiiDii, setFiiDii]           = useState(null);
  const [istTime, setIstTime]         = useState(formatIST());

  useEffect(() => {
    api.getMovers()
      .then(d => setMovers(d))
      .catch(console.error)
      .finally(() => setMoversLoading(false));

    fetch('/api/market/fii-dii')
      .then(r => r.json())
      .then((d) => {
        // Backend returns 503 with { error } when no reliable source is available.
        // Treat that as "no data" so dashboard doesn't crash on `fiiDii.fii.net`.
        if (d && d.fii && d.dii) setFiiDii(d);
        else setFiiDii(null);
      })
      .catch(() => setFiiDii(null));
  }, []);

  // Live clock
  useEffect(() => {
    const iv = setInterval(() => setIstTime(formatIST()), 1000);
    return () => clearInterval(iv);
  }, []);

  const selectedMeta = marketStatus || getMarketStatus();
  const chartLabel = HERO_INDICES.find(i => i.symbol === chartSymbol)?.label || chartSymbol;

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
      <div className="index-hero-row">
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

      {/* ── Market Stats Row ────────────────────────────────────────────────── */}
      {fiiDii && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {/* Advances & Declines */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Advances & Declines <Info size={12} style={{ color: 'var(--text-muted)' }} /></span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(in Nifty 500)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: 80, padding: '0 20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span className="gain" style={{ fontSize: 12, fontWeight: 700 }}>{fiiDii.advances}</span>
                <div style={{ width: 24, height: Math.min(60, (fiiDii.advances/300)*60), background: 'var(--gain)', borderRadius: '2px 2px 0 0' }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Adv</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{fiiDii.unchanged}</span>
                <div style={{ width: 24, height: Math.min(60, (fiiDii.unchanged/300)*60), background: 'var(--border)', borderRadius: '2px 2px 0 0' }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Unch</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span className="loss" style={{ fontSize: 12, fontWeight: 700 }}>{fiiDii.declines}</span>
                <div style={{ width: 24, height: Math.min(60, (fiiDii.declines/300)*60), background: 'var(--loss)', borderRadius: '2px 2px 0 0' }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Dec</span>
              </div>
            </div>
            <div style={{ width: '100%', height: 3, background: 'var(--bg-surface)', marginTop: 8, display: 'flex' }}>
               <div style={{ width: `${(fiiDii.advances / (fiiDii.advances+fiiDii.declines+fiiDii.unchanged))*100}%`, background: 'var(--gain)' }} />
               <div style={{ width: `${(fiiDii.unchanged / (fiiDii.advances+fiiDii.declines+fiiDii.unchanged))*100}%`, background: 'var(--border)' }} />
               <div style={{ width: `${(fiiDii.declines / (fiiDii.advances+fiiDii.declines+fiiDii.unchanged))*100}%`, background: 'var(--loss)' }} />
            </div>
          </div>

          {/* FII & DII */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>FII & DII (Cash Segment) <Info size={12} style={{ color: 'var(--text-muted)' }} /></span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, width: 24 }}>FII</span>
                  <div style={{ width: 10, height: 16, background: fiiDii.fii.net >= 0 ? 'var(--gain)' : 'var(--loss)' }} />
                  <span className={fiiDii.fii.net >= 0 ? 'gain' : 'loss'} style={{ fontSize: 13, fontWeight: 700 }}>
                    {fiiDii.fii.net >= 0 ? '+' : ''}₹{Math.abs(fiiDii.fii.net).toLocaleString()}Cr
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 44, marginTop: 4 }}>FII were {(fiiDii.fii.label || 'active').toLowerCase()} on {fiiDii.date || 'today'}</div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, width: 24 }}>DII</span>
                  <div style={{ width: 10, height: 16, background: fiiDii.dii.net >= 0 ? 'var(--gain)' : 'var(--loss)' }} />
                  <span className={fiiDii.dii.net >= 0 ? 'gain' : 'loss'} style={{ fontSize: 13, fontWeight: 700 }}>
                    {fiiDii.dii.net >= 0 ? '+' : ''}₹{Math.abs(fiiDii.dii.net).toLocaleString()}Cr
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 44, marginTop: 4 }}>DII were {(fiiDii.dii.label || 'active').toLowerCase()} on {fiiDii.date || 'today'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Inline Chart ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 2, padding: 0, overflow: 'hidden', position: 'relative' }}>
        <button
          className="chart-fullscreen-btn"
          onClick={() => onOpenChart && onOpenChart(chartSymbol, { shortName: chartLabel, ...quotes[chartSymbol] })}
          title="Open full-screen chart"
        >
          <Maximize2 size={13} /> Full Screen
        </button>
        <AdvancedChart
          symbol={chartSymbol}
          label={chartLabel}
          range={chartRange}
          onRangeChange={setChartRange}
          onSymbolChange={setChartSymbol}
        />
      </div>

      {/* ── Movers + Sectors Row ──────────────────────────────────────────── */}
      <div className="market-bottom-row">
        <div className="card" style={{ flex: '1 1 60%' }}>
          <StockMovers
            data={movers}
            loading={moversLoading}
            quotes={quotes}
            onOpenChart={(sym, data) => onOpenChart && onOpenChart(sym, data)}
          />
        </div>
        <div className="card" style={{ flex: '1 1 38%' }}>
          <SectorIndices quotes={quotes} onSelect={(sym) => onOpenChart && onOpenChart(sym, null)} />
        </div>
      </div>
    </div>
  );
}
