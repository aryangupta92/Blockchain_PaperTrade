import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, BarChart2 } from 'lucide-react';
import api from '../../services/api';
import './Kite.css';

const DEFAULT_LISTS = ['Watchlist 1', 'Watchlist 2', 'Watchlist 3'];

function fmtINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Kite-style watchlist: numbered lists, live search, hover B/S/C, exchange badges ──
export default function KiteWatchlist({ quotes, watchlist, onAdd, onRemove, onSelect, selected, onBuy, onSell, onChart }) {
  const [lists, setLists] = useState(() => {
    try {
      const raw = localStorage.getItem('kite_lists');
      if (raw) return JSON.parse(raw);
    } catch {}
    return DEFAULT_LISTS;
  });
  const [activeList, setActiveList] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [serverLists, setServerLists] = useState(null);

  // Persist tab names
  useEffect(() => {
    try { localStorage.setItem('kite_lists', JSON.stringify(lists)); } catch {}
  }, [lists]);

  // Load server watchlists once (non-blocking; local list stays source of truth for speed)
  useEffect(() => {
    api.getWatchlists().then(d => setServerLists(d)).catch(() => {});
  }, []);

  // Debounced instrument search (Kite-style: type → add)
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

  const rows = useMemo(() => watchlist || [], [watchlist]);

  const baseSymbol = (s) => String(s || '').replace('.NS', '').replace('.BO', '');
  const exchOf = (s) => String(s || '').endsWith('.BO') ? 'BSE' : 'NSE';

  const addSymbol = (rawSym) => {
    const s = String(rawSym || '').toUpperCase().replace('.NS', '').replace('.BO', '');
    if (!s) return;
    onAdd?.(s);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="kite-watch">
      <div className="kite-watch-tabs">
        {lists.map((name, i) => (
          <button
            key={i}
            className={`kite-watch-tab ${i === activeList ? 'active' : ''}`}
            onClick={() => setActiveList(i)}
            onDoubleClick={() => {
              const next = prompt('Rename watchlist', name);
              if (next?.trim()) setLists(prev => prev.map((l, j) => (j === i ? next.trim().slice(0, 24) : l)));
            }}
            title="Double-click to rename"
          >
            {i + 1} · {name}
          </button>
        ))}
      </div>

      <div className="kite-watch-search">
        <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search eg: reliance, tcs, nifty, bank"
          spellCheck={false}
          autoComplete="off"
        />
        {query && <X size={14} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setQuery('')} />}
      </div>

      {query.trim() && (
        <div className="kite-search-results">
          {searching && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Searching NSE / BSE…</div>}
          {!searching && results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No matches — press Enter to add “{query.trim().toUpperCase()}” anyway
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

      <div style={{ padding: '6px 10px', fontSize: 10.5, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{rows.length} / 50 instruments</span>
        <span>Double-click tab to rename</span>
      </div>

      <div className="kite-watch-list">
        {rows.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <BarChart2 size={26} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Watchlist empty</div>
            <div style={{ marginTop: 4 }}>Search above and press ADD — just like Kite.</div>
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

      {serverLists?.watchlists?.length > 0 && (
        <div style={{ padding: '6px 10px', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          Synced {serverLists.watchlists.length} cloud watchlist(s)
        </div>
      )}
    </div>
  );
}
