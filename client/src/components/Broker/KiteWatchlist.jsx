import { useEffect, useMemo, useState, useRef } from 'react';
import { Search, Plus, X, BarChart2, Trash2 } from 'lucide-react';
import api from '../../services/api';
import './Kite.css';

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Kite-style watchlist: independent lists, "+" to add, live search, hover B/S/C ──
export default function KiteWatchlist({
  quotes, watchlists = [], activeListId, onSelectList, onAddList, onRenameList, onDeleteList,
  onAdd, onRemove, onSelect, selected, onBuy, onSell, onChart,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const renameRef = useRef(null);

  const activeList = watchlists.find(l => l.id === activeListId) || watchlists[0];
  const rows = useMemo(() => activeList?.symbols || [], [activeList]);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  // Debounced instrument search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.searchStocks(query.trim());
        setResults((r || []).slice(0, 12));
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const baseSymbol = (s) => String(s || '').replace('.NS', '').replace('.BO', '');
  const exchOf = (s) => String(s || '').endsWith('.BO') ? 'BSE' : 'NSE';

  const addSymbol = (rawSym) => {
    const s = String(rawSym || '').toUpperCase().replace('.NS', '').replace('.BO', '');
    if (!s) return;
    onAdd?.(s);
    setQuery('');
    setResults([]);
  };

  const addNewList = () => {
    onAddList?.();
  };

  const deleteList = (list) => {
    if (watchlists.length === 1) return;
    if (!window.confirm(`Delete "${list.name}" and its ${list.symbols.length} instrument(s)?`)) return;
    onDeleteList?.(list.id);
  };

  const commitRename = () => {
    if (renamingId && renameVal.trim()) onRenameList?.(renamingId, renameVal.trim());
    setRenamingId(null);
    setRenameVal('');
  };

  return (
    <div className="kite-watch">
      {/* Tabs row */}
      <div className="kite-watch-tabs">
        {watchlists.map((list) => {
          const isActive = list.id === activeList?.id;
          return (
            <div
              key={list.id}
              className={`kite-watch-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelectList?.(list.id)}
              title={isActive ? 'Double-click to rename' : list.name}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {renamingId === list.id ? (
                <input
                  ref={renameRef}
                  value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                  style={{ width: 80, fontSize: 11, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent-primary)', color: 'var(--text-primary)', outline: 'none', padding: '0 2px' }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(list.id); setRenameVal(list.name); }}>
                  {list.name}
                </span>
              )}
              {isActive && watchlists.length > 1 && renamingId !== list.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteList(list); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                  title={`Delete ${list.name}`}
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          );
        })}
        <button className="kite-watch-tab" onClick={addNewList} title="Add new watchlist" style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>
          <Plus size={13} />
        </button>
      </div>

      {/* Search bar */}
      <div className="kite-watch-search">
        <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search eg: reliance, nifty, hdfc"
          spellCheck={false}
          autoComplete="off"
        />
        {query && <X size={14} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setQuery('')} />}
      </div>

      {/* Search results dropdown */}
      {query.trim() && (
        <div className="kite-search-results">
          {searching && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Searching NSE / BSE…</div>}
          {!searching && results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No matches — press Enter to add "{query.trim().toUpperCase()}" anyway
            </div>
          )}
          {results.map(r => {
            const sym = baseSymbol(r.symbol || r.tradingSymbol);
            const added = rows.includes(sym);
            return (
              <div key={r.symbol || sym} className="kite-search-row">
                <div>
                  <div style={{ fontWeight: 800 }}>{sym} <span className="kite-exch">{r.exchange || 'NSE'}</span></div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{r.shortname || r.name || ''}</div>
                </div>
                {added
                  ? <span style={{ fontSize: 11, color: 'var(--gain)', fontWeight: 700 }}>✓ Added</span>
                  : <button className="kite-add-btn" onClick={() => addSymbol(sym)}><Plus size={11} style={{ verticalAlign: -1 }} /> ADD</button>}
              </div>
            );
          })}
          {!searching && query.trim().length >= 2 && (
            <div className="kite-search-row">
              <div style={{ fontWeight: 700 }}>{query.trim().toUpperCase()}</div>
              <button className="kite-add-btn" onClick={() => addSymbol(query.trim())}>ADD CUSTOM</button>
            </div>
          )}
        </div>
      )}

      {/* Instruments count */}
      <div style={{ padding: '5px 10px', fontSize: 10.5, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span className="kite-watch-listname">{activeList?.name} · {rows.length}/50</span>
        <span style={{ opacity: 0.6 }}>Double-click tab to rename</span>
      </div>

      {/* Watchlist rows */}
      <div className="kite-watch-list">
        {rows.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <BarChart2 size={26} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Watchlist empty</div>
            <div style={{ marginTop: 4 }}>Search above and press ADD to get started.</div>
          </div>
        )}
        {rows.map(sym => {
          const q = quotes[sym] || quotes[`${sym}.NS`] || null;
          const gain = (q?.changePercent ?? 0) >= 0;
          const isSel = sym === selected;
          return (
            <div key={sym} className={`kite-wrow ${isSel ? 'selected' : ''}`} onClick={() => onSelect?.(sym)}>
              <div>
                <div className="sym">
                  {sym} <span className="kite-exch">{exchOf(sym)}</span>
                </div>
                <div className="lname">{q?.name || q?.shortName || 'NSE Equity'}</div>
              </div>
              <div className="kite-hide-hover">
                <div className="px" style={{ color: gain ? 'var(--gain)' : 'var(--loss)' }}>
                  {q ? fmtINR(q.price) : <span className="skeleton" style={{ display: 'inline-block', width: 56, height: 12 }} />}
                </div>
                <div className="chg" style={{ color: gain ? 'var(--gain)' : 'var(--loss)' }}>
                  {q ? `${gain ? '+' : ''}${Number(q.changePercent ?? 0).toFixed(2)}%` : '—'}
                </div>
              </div>
              <div className="kite-wrow-hover" onClick={e => e.stopPropagation()}>
                <button className="kite-mini-btn b" onClick={() => onBuy?.(sym)}>B</button>
                <button className="kite-mini-btn s" onClick={() => onSell?.(sym)}>S</button>
                <button className="kite-mini-btn c" title="Chart" onClick={() => onChart?.(sym)}>⌁</button>
                <button className="kite-mini-btn c" title="Remove" onClick={() => onRemove?.(sym)}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
