import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight, Layers, LineChart, Plus, Search, Trash2 } from 'lucide-react';
import { api, getMarketWsUrl, mergeNormalizedQuote } from '../apiClient';

const COLOR_MAP: Record<string, string> = {
  RED: '#ef4444',
  ORANGE: '#f97316',
  YELLOW: '#eab308',
  GREEN: '#10b981',
  BLUE: '#38bdf8',
  PURPLE: '#a855f7',
};
const COLOR_KEYS = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'] as const;

interface QuoteSnap {
  symbol: string;
  ltp: string | null;
  prevClose?: string | null;
  change: string | null;
  changePercent: string | null;
  volume: number | null;
}

interface WatchlistDrawerProps {
  activeSymbol: string;
  onSelectSymbol: (symbol: string, segment: string, ltp: string | null) => void;
  onTradeClick: (symbol: string, side: 'BUY' | 'SELL', segment: string, ltp: string | null) => void;
  onChartClick: (symbol: string, segment: string) => void;
  onDepthClick: (symbol: string, segment: string) => void;
  onOptionChainClick: (symbol: string) => void;
}

export function WatchlistDrawer({
  activeSymbol,
  onSelectSymbol,
  onTradeClick,
  onChartClick,
  onDepthClick,
  onOptionChainClick,
}: WatchlistDrawerProps) {
  const [watchlists, setWatchlists] = useState<Awaited<ReturnType<typeof api.watchlists>>['watchlists']>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [quotes, setQuotes] = useState<Record<string, QuoteSnap>>({});
  const [flashDir, setFlashDir] = useState<Record<string, 'up' | 'down' | null>>({});
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(false);

  const [addSearch, setAddSearch] = useState('');
  const [searchHits, setSearchHits] = useState<Array<{ symbol: string; tradingSymbol: string; exchange: string; segment: string }>>([]);
  const [newSection, setNewSection] = useState('General');
  const prevLtpRef = useRef<Record<string, number>>({});

  const loadWatchlists = useCallback(async () => {
    try {
      const res = await api.watchlists();
      setWatchlists(res.watchlists);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadWatchlists();
  }, [loadWatchlists]);

  const currentWl = watchlists[activeIdx] || watchlists[0] || null;
  const symbols = useMemo(() => (currentWl?.items || []).map((i) => i.symbol), [currentWl]);

  // Initial REST snapshot + periodic 10s REST refresh + live WS streaming for active watchlist
  useEffect(() => {
    if (symbols.length === 0) return;
    let alive = true;
    const fetchSnapshot = () => {
      api.quotes(symbols).then((res) => {
        if (!alive) return;
        setQuotes((prev) => {
          const next = { ...prev };
          for (const q of res.quotes) {
            const sym = q.symbol.toUpperCase();
            next[sym] = mergeNormalizedQuote(prev[sym], q);
            if (next[sym].ltp) prevLtpRef.current[sym] = Number(next[sym].ltp);
          }
          return next;
        });
      }).catch(() => {});
    };
    fetchSnapshot();
    const pollId = window.setInterval(fetchSnapshot, 10_000);

    const ws = new WebSocket(getMarketWsUrl());
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'subscribe', symbols }));
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'quote' && msg.data?.symbol) {
          const sym = String(msg.data.symbol).toUpperCase();
          const newPx = msg.data.ltp ? Number(msg.data.ltp) : null;
          const oldPx = prevLtpRef.current[sym];
          if (newPx != null && oldPx != null && newPx !== oldPx) {
            const dir = newPx > oldPx ? 'up' : 'down';
            setFlashDir((f) => ({ ...f, [sym]: dir }));
            setTimeout(() => setFlashDir((f) => ({ ...f, [sym]: null })), 650);
          }
          if (newPx != null) prevLtpRef.current[sym] = newPx;
          setQuotes((prev) => ({ ...prev, [sym]: mergeNormalizedQuote(prev[sym], msg.data) }));
        }
      } catch {
        // ignore
      }
    };
    return () => {
      alive = false;
      window.clearInterval(pollId);
      ws.close();
    };
  }, [symbols.join(',')]);

  // Debounced symbol search inside drawer
  useEffect(() => {
    const q = addSearch.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchInstruments({ q, limit: 8 }).then((r) => setSearchHits(r.instruments)).catch(() => setSearchHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [addSearch]);

  const handleAddWatchlist = async () => {
    if (watchlists.length >= 10) return;
    const name = `WL ${watchlists.length + 1}`;
    await api.createWatchlist(name);
    await loadWatchlists();
    setActiveIdx(watchlists.length);
  };

  const handleAddSymbol = async (sym: string) => {
    if (!currentWl) return;
    await api.addWatchlistItem(currentWl.id, { symbol: sym, sectionName: newSection.trim() || 'General' });
    setAddSearch('');
    setSearchHits([]);
    await loadWatchlists();
  };

  const handleCycleColor = async (itemId: string, cur: string | null) => {
    if (!currentWl) return;
    const idx = cur ? COLOR_KEYS.indexOf(cur as (typeof COLOR_KEYS)[number]) : -1;
    const next = idx >= COLOR_KEYS.length - 1 ? null : COLOR_KEYS[idx + 1];
    await api.updateWatchlistItem(currentWl.id, itemId, { colorTag: next });
    await loadWatchlists();
  };

  const handleBulk = async (action: 'DELETE' | 'TAG' | 'MOVE_SECTION', extra?: { colorTag?: string | null; sectionName?: string }) => {
    if (!currentWl || selectedIds.length === 0) return;
    await api.bulkWatchlistAction(currentWl.id, { itemIds: selectedIds, action, ...extra });
    setSelectedIds([]);
    await loadWatchlists();
  };

  const filteredItems = useMemo(() => {
    const items = currentWl?.items || [];
    if (!colorFilter) return items;
    return items.filter((i) => i.colorTag === colorFilter);
  }, [currentWl, colorFilter]);

  const groupedBySection = useMemo(() => {
    const map = new Map<string, typeof filteredItems>();
    for (const item of filteredItems) {
      const sec = item.sectionName || 'General';
      const arr = map.get(sec) || [];
      arr.push(item);
      map.set(sec, arr);
    }
    return [...map.entries()];
  }, [filteredItems]);

  return (
    <aside className="watchlist-drawer">
      {/* Header + Quick Search */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={13} color="var(--text-muted)" />
          <input
            className="input"
            style={{ padding: '5px 8px', fontSize: 11.5 }}
            placeholder="Add symbol to watchlist..."
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
          />
          <button
            className={`preset-btn ${bulkMode ? 'active' : ''}`}
            style={{ padding: '4px 6px', fontSize: 10.5 }}
            title="Multi-Select Bulk Mode"
            onClick={() => { setBulkMode((b) => !b); setSelectedIds([]); }}
          >
            Edit
          </button>
        </div>

        {searchHits.length > 0 && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 7, maxHeight: 170, overflowY: 'auto' }}>
            <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Section:</span>
              <input
                className="input"
                style={{ padding: '2px 6px', fontSize: 10.5 }}
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
              />
            </div>
            {searchHits.map((h) => (
              <button
                key={`${h.exchange}-${h.tradingSymbol}`}
                className="nav-item"
                style={{ width: '100%', padding: '5px 8px', fontSize: 11.5, justifyContent: 'space-between' }}
                onClick={() => handleAddSymbol(h.tradingSymbol)}
              >
                <span><strong>{h.tradingSymbol}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{h.exchange}</span></span>
                <Plus size={12} color="var(--gain)" />
              </button>
            ))}
          </div>
        )}

        {/* 6-Color Tag Filter Strip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <button
              type="button"
              onClick={() => setColorFilter(null)}
              style={{
                border: 'none',
                background: colorFilter === null ? 'var(--bg-elevated)' : 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 10,
                padding: '2px 5px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              All ({currentWl?.items.length || 0})
            </button>
            {COLOR_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                title={`Filter ${c}`}
                onClick={() => setColorFilter((prev) => (prev === c ? null : c))}
                style={{
                  border: colorFilter === c ? '1.5px solid var(--text-primary)' : '1px solid transparent',
                  background: 'transparent',
                  padding: 2,
                  borderRadius: 99,
                  cursor: 'pointer',
                  display: 'flex',
                }}
              >
                <span className="color-dot" style={{ background: COLOR_MAP[c] }} />
              </button>
            ))}
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{currentWl?.name}</span>
        </div>

        {/* Bulk Action Toolbar */}
        {bulkMode && selectedIds.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 6px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: 10.5 }}>
            <span>{selectedIds.length} sel:</span>
            <button className="preset-btn" style={{ padding: '1px 5px', fontSize: 10 }} onClick={() => handleBulk('TAG', { colorTag: 'GREEN' })}>Green</button>
            <button className="preset-btn" style={{ padding: '1px 5px', fontSize: 10 }} onClick={() => handleBulk('TAG', { colorTag: 'RED' })}>Red</button>
            <button className="preset-btn" style={{ padding: '1px 5px', fontSize: 10 }} onClick={() => handleBulk('MOVE_SECTION', { sectionName: 'Focus' })}>→Focus</button>
            <button className="preset-btn" style={{ padding: '1px 5px', fontSize: 10, color: 'var(--loss)' }} onClick={() => handleBulk('DELETE')}>
              <Trash2 size={10} />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Sections & Live Symbol Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groupedBySection.map(([secName, items]) => {
          const isCollapsed = Boolean(collapsedSections[secName]);
          return (
            <div key={secName}>
              <button
                type="button"
                onClick={() => setCollapsedSections((p) => ({ ...p, [secName]: !p[secName] }))}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '5px 10px',
                  background: 'var(--bg-elevated)',
                  border: 'none',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  {secName}
                </span>
                <span>{items.length}</span>
              </button>

              {!isCollapsed &&
                items.map((item) => {
                  const symUp = item.symbol.toUpperCase();
                  const q = quotes[symUp];
                  const flash = flashDir[symUp];
                  const isActive = activeSymbol.toUpperCase() === symUp;

                  return (
                    <div
                      key={item.id}
                      className={`wl-row ${flash === 'up' ? 'tick-up' : flash === 'down' ? 'tick-down' : ''}`}
                      style={{ background: isActive ? 'var(--bg-elevated)' : undefined }}
                      onClick={() => onSelectSymbol(item.symbol, item.segment, q?.ltp ?? null)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        {bulkMode ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked ? [...prev, item.id] : prev.filter((x) => x !== item.id)
                              )
                            }
                          />
                        ) : (
                          <span
                            className="color-dot"
                            title="Click to cycle color tag"
                            onClick={(e) => { e.stopPropagation(); handleCycleColor(item.id, item.colorTag); }}
                            style={{
                              background: item.colorTag ? COLOR_MAP[item.colorTag] : 'transparent',
                              border: item.colorTag ? 'none' : '1px solid var(--border-strong)',
                            }}
                          />
                        )}
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <div style={{ fontWeight: 700, fontSize: 12 }}>{item.symbol}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.exchange} · {item.segment}</div>
                        </div>
                      </div>

                      <div className="mono" style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{q?.ltp ? Number(q.ltp).toFixed(2) : '—'}</div>
                        {(() => {
                          const chgNum = q?.change != null ? Number(q.change) : null;
                          const pctNum = q?.changePercent != null ? Number(q.changePercent) : null;
                          const color =
                            pctNum != null && pctNum > 0
                              ? 'var(--gain)'
                              : pctNum != null && pctNum < 0
                                ? 'var(--loss)'
                                : 'var(--text-secondary)';
                          if (pctNum == null) {
                            return <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>—</div>;
                          }
                          return (
                            <div style={{ fontSize: 10.5, color }}>
                              {chgNum != null ? `${chgNum >= 0 ? '+' : ''}${chgNum.toFixed(2)} (` : ''}
                              {pctNum >= 0 ? '+' : ''}{pctNum.toFixed(2)}%
                              {chgNum != null ? ')' : ''}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Hover Quick-Actions: [B][S][Chart][Depth][Chain] */}
                      {!bulkMode && (
                        <div className="wl-hover-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="preset-btn"
                            style={{ padding: '2px 5px', fontSize: 10, color: 'var(--gain)', borderColor: 'var(--gain)' }}
                            title="Buy (Ctrl+B)"
                            onClick={() => onTradeClick(item.symbol, 'BUY', item.segment, q?.ltp ?? null)}
                          >
                            B
                          </button>
                          <button
                            className="preset-btn"
                            style={{ padding: '2px 5px', fontSize: 10, color: 'var(--loss)', borderColor: 'var(--loss)' }}
                            title="Sell (Ctrl+S)"
                            onClick={() => onTradeClick(item.symbol, 'SELL', item.segment, q?.ltp ?? null)}
                          >
                            S
                          </button>
                          <button
                            className="preset-btn"
                            style={{ padding: '2px 5px', fontSize: 10 }}
                            title="Open Chart"
                            onClick={() => onChartClick(item.symbol, item.segment)}
                          >
                            <LineChart size={11} />
                          </button>
                          <button
                            className="preset-btn"
                            style={{ padding: '2px 5px', fontSize: 10 }}
                            title="5 / 20-Level Market Depth"
                            onClick={() => onDepthClick(item.symbol, item.segment)}
                          >
                            <Layers size={11} />
                          </button>
                          <button
                            className="preset-btn"
                            style={{ padding: '2px 5px', fontSize: 10 }}
                            title="Option Chain"
                            onClick={() => onOptionChainClick(item.symbol)}
                          >
                            <BarChart3 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* Bottom 10-Watchlist Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '6px 8px', borderTop: '1px solid var(--border-subtle)', overflowX: 'auto', background: 'var(--bg-elevated)' }}>
        {watchlists.map((wl, i) => (
          <button
            key={wl.id}
            className={`preset-btn ${i === activeIdx ? 'active' : ''}`}
            style={{ padding: '3px 7px', fontSize: 10.5 }}
            title={wl.name}
            onClick={() => { setActiveIdx(i); setSelectedIds([]); }}
          >
            {i + 1}
          </button>
        ))}
        {watchlists.length < 10 && (
          <button
            className="preset-btn"
            style={{ padding: '3px 6px', fontSize: 10.5 }}
            title="Add Watchlist (max 10)"
            onClick={handleAddWatchlist}
          >
            <Plus size={11} />
          </button>
        )}
      </div>
    </aside>
  );
}
