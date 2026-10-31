import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, ArrowRight, X } from 'lucide-react';
import api from '../../services/api';
import './TopSearchBar.css';

export default function TopSearchBar({ onOpenChart }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close dropdown / collapse when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search logic
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setLoading(true);
      setShowDropdown(true);
      try {
        const res = await api.searchStocks(query);
        setResults(res || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const close = () => {
    setOpen(false);
    setShowDropdown(false);
    setQuery('');
    setResults([]);
  };

  const handleSelect = (stock) => {
    let sym = stock.symbol;
    if (!sym.endsWith('.BO') && !sym.endsWith('.NS') && stock.exchange === 'NSE') sym = `${sym}.NS`;
    close();
    onOpenChart(sym, { name: stock.shortname, price: 0, change: 0, changePercent: 0, volume: 0 });
  };

  return (
    <div className={`top-search-wrapper ${open ? 'is-open' : ''}`} ref={wrapperRef}>
      {!open ? (
        <button className="top-search-toggle" onClick={() => setOpen(true)} title="Search stocks (Ctrl+K)">
          <Search size={16} />
          <span>Search</span>
        </button>
      ) : (
        <div className="top-search-box">
          <Search size={16} className="top-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="top-search-input"
            placeholder="Search stocks, ETFs or indices…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (query.length > 0) setShowDropdown(true); }}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
            spellCheck="false"
            autoComplete="off"
          />
          {loading && <Loader2 size={15} className="top-search-spinner" />}
          <button className="top-search-close" onClick={close} title="Close search">
            <X size={14} />
          </button>
        </div>
      )}

      {open && showDropdown && query.trim().length > 0 && (
        <div className="top-search-dropdown">
          <div className="top-search-header">
            Results for "{query}"
          </div>

          {loading ? (
            <div className="top-search-msg">Searching Indian markets…</div>
          ) : results.length > 0 ? (
            <div className="top-search-list">
              {results.map((stock) => (
                <div key={stock.symbol} className="top-search-item" onClick={() => handleSelect(stock)}>
                  <div className="top-search-info">
                    <div className="top-search-sym">{stock.symbol.replace('.NS', '').replace('.BO', '')}
                      <span className="top-search-exch">{stock.exchange}</span>
                    </div>
                    <div className="top-search-name">{stock.shortname}</div>
                  </div>
                  <div className="top-search-action">
                    <div className="top-search-type">{stock.type}</div>
                    <button className="top-search-btn">
                      Chart &amp; Trade <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="top-search-msg">No results found for "{query}".</div>
          )}
        </div>
      )}
    </div>
  );
}
