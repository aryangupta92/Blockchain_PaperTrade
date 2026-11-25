import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Scale } from 'lucide-react';
import { api, formatINR } from '../apiClient';
import { InstrumentInspectorPanel } from './InstrumentInspectorPanel';

interface EtfsPageProps {
  onTradeClick: (
    symbol: string,
    side: 'BUY' | 'SELL',
    segment: string,
    ltp: string | null,
    priceOverride?: string | null,
    initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF'
  ) => void;
  onChartClick: (symbol: string, segment: string) => void;
}

const CATEGORIES = [
  { id: 'ALL', label: 'All ETFs' },
  { id: 'GOLD', label: 'Gold ETFs' },
  { id: 'SILVER', label: 'Silver ETFs' },
  { id: 'INDEX', label: 'Index ETFs' },
  { id: 'SECTORAL', label: 'Sectoral ETFs' },
  { id: 'LIQUID_DEBT', label: 'Liquid & Debt' },
];

export function EtfsPage({ onTradeClick, onChartClick }: EtfsPageProps) {
  const [category, setCategory] = useState('ALL');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.etfCatalog>> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.etfCatalog(category);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ marginBottom: 4 }}><Scale size={15} /> NSE &amp; BSE Exchange-Traded Funds (ETFs)</h3>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Trade Gold, Silver, Nifty/Bank Nifty, Sectoral &amp; Liquid ETFs in Delivery (CNC, T+1) or Intraday (MIS). Total catalog: <strong className="mono">{data?.totalCatalogCount ?? '—'}</strong> ETFs.
          </div>
        </div>
        <button className="theme-toggle" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> Refresh
        </button>
      </section>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`preset-btn ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label} {c.id !== 'ALL' && data?.countsByCategory?.[c.id] != null ? `(${data.countsByCategory[c.id]})` : ''}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.85fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
        <section className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Exchange</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Change</th>
                  <th style={{ textAlign: 'right' }}>Volume</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.etfs || []).map((e) => {
                  const chg = e.change ? Number(e.change) : 0;
                  const color = chg > 0 ? 'var(--gain)' : chg < 0 ? 'var(--loss)' : 'var(--text-secondary)';
                  const selected = (selectedId || data?.etfs[0]?.instrumentId) === e.instrumentId;
                  return (
                    <tr
                      key={e.instrumentId}
                      onClick={() => setSelectedId(e.instrumentId)}
                      style={{
                        cursor: 'pointer',
                        background: selected ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td><strong>{e.symbol}</strong></td>
                      <td style={{ color: 'var(--text-secondary)' }}>{e.displayName}</td>
                      <td><span className="badge">{e.category}</span></td>
                      <td className="mono">{e.exchange}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{e.ltp ? formatINR(e.ltp) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color }}>{e.changePercent ? `${chg >= 0 ? '+' : ''}${e.changePercent}%` : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{e.volume != null ? e.volume.toLocaleString('en-IN') : '—'}</td>
                      <td onClick={(ev) => ev.stopPropagation()} style={{ display: 'flex', gap: 5 }}>
                        <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => onChartClick(e.symbol, 'ETF')}>Chart</button>
                        <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--gain)', borderColor: 'var(--gain)' }} onClick={() => onTradeClick(e.symbol, 'BUY', 'ETF', e.ltp)}>B</button>
                        <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={() => onTradeClick(e.symbol, 'SELL', 'ETF', e.ltp)}>S</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {(() => {
          const selectedEtf = data?.etfs.find((e) => e.instrumentId === selectedId) || data?.etfs[0] || null;
          return (
            <InstrumentInspectorPanel
              symbol={selectedEtf?.symbol ?? null}
              segment="ETF"
              initialQuote={
                selectedEtf
                  ? {
                      instrumentId: selectedEtf.instrumentId,
                      symbol: selectedEtf.symbol,
                      displayName: selectedEtf.displayName,
                      exchange: selectedEtf.exchange,
                      segment: 'ETF',
                      ltp: selectedEtf.ltp,
                      change: selectedEtf.change,
                      changePercent: selectedEtf.changePercent,
                      volume: selectedEtf.volume,
                    }
                  : null
              }
              onTradeClick={onTradeClick}
              onChartClick={onChartClick}
              title="Selected ETF Details"
            />
          );
        })()}
      </div>
    </div>
  );
}
