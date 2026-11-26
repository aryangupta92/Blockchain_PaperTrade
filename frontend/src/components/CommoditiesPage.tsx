import { useCallback, useEffect, useState } from 'react';
import { Coins, RefreshCw } from 'lucide-react';
import { api, formatINR } from '../apiClient';
import { InstrumentInspectorPanel } from './InstrumentInspectorPanel';

interface CommoditiesPageProps {
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

const GROUPS = [
  { id: 'ALL', label: 'All Commodities' },
  { id: 'BULLION', label: 'Bullion (Gold / Silver)' },
  { id: 'ENERGY', label: 'Energy (Crude / NatGas)' },
  { id: 'BASE_METALS', label: 'Base Metals (Copper / Zinc / Alum)' },
];

export function CommoditiesPage({ onTradeClick, onChartClick }: CommoditiesPageProps) {
  const [group, setGroup] = useState('ALL');
  const [kind, setKind] = useState<'ALL' | 'FUTURES' | 'OPTIONS'>('FUTURES');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.commodityContracts>> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.commodityContracts(group, kind);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [group, kind]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ marginBottom: 4 }}><Coins size={15} /> MCX Commodities Derivatives (Futures &amp; Options)</h3>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Session: <strong>{data?.session.phase ?? '—'}</strong> ({data?.session.hoursIST ?? '09:00–23:30 IST'}) • Active MCX contracts:{' '}
            <strong className="mono">{data?.totalActiveContracts?.toLocaleString('en-IN') ?? '—'}</strong>
          </div>
        </div>
        <button className="theme-toggle" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> Refresh
        </button>
      </section>

      {data?.regulatoryNote && (
        <div className="sebi-banner">
          <strong>Indian Commodity Regulation:</strong> {data.regulatoryNote}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {GROUPS.map((g) => (
            <button key={g.id} className={`preset-btn ${group === g.id ? 'active' : ''}`} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['FUTURES', 'OPTIONS', 'ALL'] as const).map((k) => (
            <button key={k} className={`preset-btn ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.85fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
        <section className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Group / Type</th>
                  <th>Expiry</th>
                  <th style={{ textAlign: 'right' }}>Lot / Tick</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Change</th>
                  <th style={{ textAlign: 'right' }}>OI</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.contracts || []).map((c) => {
                  const chg = c.change ? Number(c.change) : 0;
                  const chgPct = c.changePercent ? Number(c.changePercent) : 0;
                  const color = chg > 0 ? 'var(--gain)' : chg < 0 ? 'var(--loss)' : 'var(--text-secondary)';
                  const selected = (selectedId || data?.contracts[0]?.instrumentId) === c.instrumentId;
                  return (
                    <tr
                      key={c.instrumentId}
                      onClick={() => setSelectedId(c.instrumentId)}
                      style={{
                        cursor: 'pointer',
                        background: selected ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td>
                        <strong>{c.symbol}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.displayName}</div>
                      </td>
                      <td><span className="badge">{c.group} · {c.instrumentKind}</span></td>
                      <td className="mono">{c.expiryDate ? c.expiryDate.slice(0, 10) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.lotSize} / ₹{c.tickSize}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{c.ltp ? formatINR(c.ltp) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color }}>
                        {c.changePercent != null
                          ? `${c.change != null ? `${chg >= 0 ? '+' : ''}${c.change} (` : ''}${chgPct >= 0 ? '+' : ''}${c.changePercent}%${c.change != null ? ')' : ''}`
                          : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c.openInterest != null ? c.openInterest.toLocaleString('en-IN') : '—'}</td>
                      <td onClick={(ev) => ev.stopPropagation()} style={{ display: 'flex', gap: 5 }}>
                        <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11 }} onClick={() => onChartClick(c.symbol, 'COMM')}>Chart</button>
                        <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--gain)', borderColor: 'var(--gain)' }} onClick={() => onTradeClick(c.instrumentId, 'BUY', 'COMM', c.ltp)}>B</button>
                        <button className="preset-btn" style={{ padding: '2px 7px', fontSize: 11, color: 'var(--loss)', borderColor: 'var(--loss)' }} onClick={() => onTradeClick(c.instrumentId, 'SELL', 'COMM', c.ltp)}>S</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {(() => {
          const selectedContract = data?.contracts.find((c) => c.instrumentId === selectedId) || data?.contracts[0] || null;
          return (
            <InstrumentInspectorPanel
              symbol={selectedContract?.instrumentId ?? selectedContract?.symbol ?? null}
              segment="COMM"
              initialQuote={
                selectedContract
                  ? {
                      instrumentId: selectedContract.instrumentId,
                      symbol: selectedContract.symbol,
                      displayName: selectedContract.displayName,
                      exchange: 'MCX',
                      segment: 'COMM',
                      ltp: selectedContract.ltp,
                      change: selectedContract.change,
                      changePercent: selectedContract.changePercent,
                      openInterest: selectedContract.openInterest,
                    }
                  : null
              }
              onTradeClick={onTradeClick}
              onChartClick={onChartClick}
              title="Selected Commodity Contract"
            />
          );
        })()}
      </div>
    </div>
  );
}
