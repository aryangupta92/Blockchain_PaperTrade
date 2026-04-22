import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, ArrowRight } from 'lucide-react';
import api from '../../services/api';
import './TopSearchBar.css';

export default function TopSearchBar({ onOpenChart }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

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
      } catch (err) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const handleSelect = (stock) => {
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    
    // Convert symbol format if needed to standard format for our backend
    let sym = stock.symbol;
    if (sym.endsWith('.BO')) sym = sym; // Keep BSE
    else if (sym.endsWith('.NS')) sym = sym; // Keep NSE
    else if (stock.exchange === 'NSE') sym = `${sym}.NS`;
    
    onOpenChart(sym, { name: stock.shortname, price: 0, change: 0, changePercent: 0, volume: 0 });
  };

  return (
    <div className="top-search-wrapper" ref={wrapperRef}>
      <div className="top-search-box">
        <Search size={16} className="top-search-icon" />
        <input 
          type="text" 
          className="top-search-input" 
          placeholder="Search for any company, ETF, or Index (e.g. Reliance, Zomato, ^NSEI)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if(query.length > 0) setShowDropdown(true); }}
          spellCheck="false"
          autoComplete="off"
        />
        {loading && <Loader2 size={16} className="top-search-spinner" />}
      </div>

      {showDropdown && (query.trim().length > 0) && (
        <div className="top-search-dropdown">
          <div className="top-search-header">
            Search Results for "{query}"
          </div>
          
          {loading ? (
            <div className="top-search-msg">Searching Indian Markets...</div>
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
                      Chart & Trade <ArrowRight size={14} />
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
