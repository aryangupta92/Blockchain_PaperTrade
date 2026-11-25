import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Layers, Radio, RefreshCw, Search } from 'lucide-react';
import { api, formatINR } from '../apiClient';
import { InstrumentInspectorPanel } from './InstrumentInspectorPanel';

interface QuoteItem {
  instrumentId: string;
  symbol: string;
  exchange: string;
  segment: string;
  ltp: string | null;
  prevClose: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  change: string | null;
  changePercent: string | null;
  volume: number | null;
  vwap: string | null;
  openInterest: number | null;
  bidDepth: Array<{ price: string; quantity: number; orders: number }>;
  askDepth: Array<{ price: string; quantity: number; orders: number }>;
  freshness: string;
  timestamp: string;
}

interface SearchHit {
  instrumentId: string;
  exchange: string;
  segment: string;
  instrumentKind: string;
  symbol: string;
  tradingSymbol: string;
  displayName: string;
  lotSize: number;
  tickSize: string;
  expiryDate: string | null;
  strikePrice: string | null;
  optionType: string | null;
}

interface MarketPageProps {
  view: 'overview' | 'equity' | 'fno' | 'etfs' | 'commodities';
  onTradeClick?: (
    symbol: string,
    side: 'BUY' | 'SELL',
    segment: string,
    ltp: string | null,
    priceOverride?: string | null,
    initialProduct?: 'CNC' | 'MIS' | 'NRML' | 'MTF'
  ) => void;
  onChartClick?: (symbol: string, segment: string) => void;
  onOptionChainClick?: (underlying: string) => void;
}

const DEFAULT_SYMBOLS: Record<MarketPageProps['view'], string[]> = {
  overview: ['NIFTY', 'SENSEX', 'BANKNIFTY', 'FINNIFTY', 'INDIAVIX', 'RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'NIFTYBEES'],
  equity: ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'LT', 'ITC', 'BHARTIARTL', 'AXISBANK'],
  fno: ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYIT', 'BANKEX'],
  etfs: ['NIFTYBEES', 'GOLDBEES', 'SILVERBEES', 'BANKBEES', 'JUNIORBEES', 'LIQUIDBEES'],
  commodities: ['GOLD', 'SILVER', 'CRUDEOIL', 'NATURALGAS', 'COPPER'],
};

const VIEW_SEGMENT_FILTER: Record<MarketPageProps['view'], string | undefined> = {
  overview: undefined,
  equity: 'EQ',
  fno: 'FNO',
  etfs: 'ETF',
  commodities: 'COMM',
};

const VIEW_TITLE: Record<MarketPageProps['view'], string> = {
  overview: 'Market Overview & Live Watchlist',
  equity: 'Equity Cash Market (NSE & BSE)',
  fno: 'Indices & Futures / Options (F&O)',
  etfs: 'Exchange-Traded Funds (Gold, Silver, Index & Sector ETFs)',
  commodities: 'Commodities Derivatives (MCX)',
};

export function MarketPage({ view, onTradeClick, onChartClick, onOptionChainClick }: MarketPageProps) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.marketStatus>> | null>(null);
  const [quotesById, setQuotesById] = useState<Record<string, QuoteItem>>({});
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_SYMBOLS[view]);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.marketAnalytics>> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setWatchlist(DEFAULT_SYMBOLS[view]);
    setSelectedQuoteId(null);
    setSearchQuery('');
    setSearchHits([]);
    if (view === 'overview') {
      api.marketAnalytics().then(setAnalytics).catch(() => setAnalytics(null));
    }
  }, [view]);

  useEffect(() => {
    api.marketStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  // Load REST snapshot whenever watchlist changes
  useEffect(() => {
    let active = true;
    api
      .quotes(watchlist)
      .then((res) => {
        if (!active) return;
        setQuotesById((prev) => {
          const next = { ...prev };
          for (const q of res.quotes) next[q.instrumentId] = q;
          return next;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [watchlist]);

  // Multiplexed WebSocket fan-out (/ws/market)
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/market`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ action: 'subscribe', symbols: watchlist }));
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as { type: string; data: QuoteItem };
        if (msg.type === 'quote' && msg.data?.instrumentId) {
          setQuotesById((prev) => ({ ...prev, [msg.data.instrumentId]: msg.data }));
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => setWsConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [watchlist]);

  // Debounced global instrument search across NSE/BSE/MCX scrip master
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchInstruments({ q, segment: VIEW_SEGMENT_FILTER[view], limit: 15 })
        .then((res) => setSearchHits(res.instruments))
        .catch(() => setSearchHits([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery, view]);

  const rows = useMemo(() => {
    return Object.values(quotesById).filter((q) =>
      watchlist.some(
        (w) =>
          w.toUpperCase() === q.symbol.toUpperCase() ||
          w.toUpperCase() === q.instrumentId.toUpperCase()
      )
    );
  }, [quotesById, watchlist]);

  const selectedQuote = selectedQuoteId ? quotesById[selectedQuoteId] : rows[0] || null;

  const handleAddSymbol = (instrumentId: string) => {
    if (!watchlist.includes(instrumentId)) {
      setWatchlist((prev) => [instrumentId, ...prev]);
    }
    setSearchQuery('');
    setSearchHits([]);
  };

  const handleRefreshMaster = async () => {
    setRefreshing(true);
    try {
      await api.refreshInstruments();
      const st = await api.marketStatus();
      setStatus(st);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Live Market Status Strip */}
      <section className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ marginBottom: 4 }}>
            <Activity size={15} /> {VIEW_TITLE[view]}
          </h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
            <span>
              Equity/F&amp;O: <strong>{status?.session.equityAndFno.phase ?? '—'}</strong> ({status?.session.equityAndFno.hoursIST ?? '09:15–15:30 IST'})
            </span>
            <span>
              MCX: <strong>{status?.session.commoditiesMcx.phase ?? '—'}</strong> ({status?.session.commoditiesMcx.hoursIST ?? '09:00–23:30 IST'})
            </span>
            <span>
              Instruments Loaded: <strong className="mono">{status?.instrumentCount?.toLocaleString('en-IN') ?? '—'}</strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${wsConnected ? 'badge-gain' : 'badge-warn'}`}>
            <Radio size={12} /> {wsConnected ? 'Live Stream Connected' : 'Connecting...'}
          </span>
          <span className={`badge ${status?.dataSubscriptionActive ? 'badge-gain' : 'badge-warn'}`}>
            {status?.dataSubscriptionActive ? 'Market Data Plan Active' : 'Feed Status Pending'}
          </span>
          <button className="theme-toggle" onClick={handleRefreshMaster} disabled={refreshing}>
            <RefreshCw size={13} /> {refreshing ? 'Syncing Master...' : 'Sync Instruments'}
          </button>
        </div>
      </section>

      {/* Instrument Search Bar */}
      <section className="card" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            className="input"
            placeholder="Search NSE/BSE equities, index/stock F&O contracts, ETFs, or MCX commodities (e.g. RELIANCE, NIFTY, GOLDBEES, CRUDEOIL)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {searchHits.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, maxHeight: 260, overflowY: 'auto' }}>
            {searchHits.map((hit) => (
              <div
                key={hit.instrumentId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '7px 8px',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 12.5,
                }}
              >
                <div>
                  <strong>{hit.tradingSymbol}</strong>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>({hit.displayName})</span>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {hit.exchange} • {hit.segment} • {hit.instrumentKind} • Lot {hit.lotSize}
                    {hit.expiryDate ? ` • Exp ${hit.expiryDate}` : ''}
                  </div>
                </div>
                <button className="preset-btn" onClick={() => handleAddSymbol(hit.instrumentId)}>
                  + Watch
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sector Heatmap & Market Movers on Overview */}
      {view === 'overview' && analytics && analytics.sectors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="card">
            <h3>NSE Sector Heatmap (Live Primary Feed)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8 }}>
              {analytics.sectors.map((sec) => {
                const pos = sec.avgChangePercent >= 0;
                return (
                  <div
                    key={sec.sector}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: pos ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                      border: `1px solid ${pos ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{sec.sector}</div>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: pos ? 'var(--gain)' : 'var(--loss)', marginTop: 2 }}>
                      {pos ? '+' : ''}{sec.avgChangePercent}%
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {sec.advancers}↑ / {sec.decliners}↓
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="card-grid">
            <section className="card">
              <h3>Top Gainers</h3>
              {analytics.gainers.map((g) => (
                <div key={g.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <strong>{g.symbol}</strong>
                  <span className="mono" style={{ color: 'var(--gain)' }}>{formatINR(g.ltp)} (+{g.changePercent}%)</span>
                </div>
              ))}
            </section>
            <section className="card">
              <h3>Top Losers</h3>
              {analytics.losers.map((l) => (
                <div key={l.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <strong>{l.symbol}</strong>
                  <span className="mono" style={{ color: 'var(--loss)' }}>{formatINR(l.ltp)} ({l.changePercent}%)</span>
                </div>
              ))}
            </section>
            <section className="card">
              <h3>Most Active (Volume)</h3>
              {analytics.mostActive.map((a) => (
                <div key={a.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <strong>{a.symbol}</strong>
                  <span className="mono">{formatINR(a.ltp)} · {(a.volume / 1000).toFixed(0)}K</span>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}

      {/* Watchlist Grid + 5-Level Depth Side Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16 }}>
        <section className="card">
          <h3>Live Quotes ({rows.length})</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Exch / Seg</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Change</th>
                  <th style={{ textAlign: 'right' }}>Day Range</th>
                  <th style={{ textAlign: 'right' }}>Volume / OI</th>
                  <th>Feed</th>
                  <th>Trade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => {
                  const chg = q.change ? Number(q.change) : 0;
                  const chgColor = chg > 0 ? 'var(--gain)' : chg < 0 ? 'var(--loss)' : 'var(--text-secondary)';
                  const isIndex = q.instrumentId.includes(':IDX:');
                  return (
                    <tr
                      key={q.instrumentId}
                      onClick={() => setSelectedQuoteId(q.instrumentId)}
                      style={{
                        cursor: 'pointer',
                        background: selectedQuote?.instrumentId === q.instrumentId ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td><strong>{q.symbol}</strong></td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{q.exchange} · {q.segment}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {q.ltp ? formatINR(q.ltp) : 'NO DATA'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: chgColor }}>
                        {q.change && q.changePercent ? `${chg >= 0 ? '+' : ''}${q.change} (${q.changePercent}%)` : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {q.low && q.high ? `${q.low} – ${q.high}` : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 11.5 }}>
                        {q.volume != null ? q.volume.toLocaleString('en-IN') : '—'}
                        {q.openInterest ? ` / OI ${q.openInterest.toLocaleString('en-IN')}` : ''}
                      </td>
                      <td>
                        <span className={`badge ${q.freshness === 'LIVE' ? 'badge-gain' : 'badge-warn'}`}>
                          {q.freshness}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 5 }}>
                        {onChartClick && (
                          <button
                            className="preset-btn"
                            style={{ padding: '3px 7px', fontSize: 11 }}
                            onClick={() => onChartClick(q.symbol, q.segment)}
                          >
                            Chart
                          </button>
                        )}
                        {!isIndex && onTradeClick ? (
                          <>
                            <button
                              className="preset-btn"
                              style={{ borderColor: 'var(--gain)', color: 'var(--gain)', padding: '3px 8px' }}
                              onClick={() => onTradeClick(q.symbol, 'BUY', q.segment, q.ltp)}
                            >
                              B
                            </button>
                            <button
                              className="preset-btn"
                              style={{ borderColor: 'var(--loss)', color: 'var(--loss)', padding: '3px 8px' }}
                              onClick={() => onTradeClick(q.symbol, 'SELL', q.segment, q.ltp)}
                            >
                              S
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right-Hand Selected Instrument Details & Live Depth Inspector */}
        <InstrumentInspectorPanel
          symbol={selectedQuote?.symbol ?? rows[0]?.symbol ?? null}
          segment={selectedQuote?.segment ?? rows[0]?.segment ?? 'EQ'}
          initialQuote={selectedQuote ?? rows[0] ?? null}
          onTradeClick={(sym, side, seg, ltp, px, prod) => onTradeClick?.(sym, side, seg, ltp, px, prod)}
          onChartClick={(sym, seg) => onChartClick?.(sym, seg)}
          onOptionChainClick={onOptionChainClick}
          onSelectSymbol={(sym) => handleAddSymbol(sym)}
          title="Selected Instrument Details"
        />
      </div>
    </div>
  );
}
