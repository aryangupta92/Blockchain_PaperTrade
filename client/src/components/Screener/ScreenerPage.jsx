import React, { useState, useEffect } from 'react';
import api from '../../services/api';

export default function ScreenerPage({ openChart, executeTrade }) {
  const [preset, setPreset] = useState('TOP_GAINERS');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData(preset);
  }, [preset]);

  const fetchData = async (p) => {
    setLoading(true);
    try {
      const data = await api.getScreenerResults(p);
      setResults(data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Market Screener</h2>
          <p className="text-muted">Real-time dynamic stock discovery</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['TOP_GAINERS', 'TOP_LOSERS', 'VOLUME_BREAKOUT'].map(p => (
            <button
              key={p}
              className={`btn ${preset === p ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setPreset(p)}
            >
              {p.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        {loading ? (
          <div className="spinner" style={{ margin: '40px auto' }} />
        ) : results.length === 0 ? (
          <div className="text-muted" style={{ textAlign: 'center', padding: 40 }}>No results found for this scan.</div>
        ) : (
          <table className="data-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Symbol</th>
                <th style={{ padding: '12px 8px' }}>LTP</th>
                <th style={{ padding: '12px 8px' }}>Change %</th>
                <th style={{ padding: '12px 8px' }}>Volume</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.tradingSymbol} style={{ borderBottom: '1px solid var(--border-color)', animation: `fadeIn 0.3s ease ${(i+1)*0.05}s both` }}>
                  <td style={{ padding: '12px 8px', fontWeight: 600 }}>{r.tradingSymbol}</td>
                  <td style={{ padding: '12px 8px' }}>₹{r.price?.toFixed(2)}</td>
                  <td style={{ padding: '12px 8px', color: r.changePercent >= 0 ? 'var(--color-profit)' : 'var(--color-loss)' }}>
                    {r.changePercent >= 0 ? '+' : ''}{(r.changePercent || 0).toFixed(2)}%
                  </td>
                  <td style={{ padding: '12px 8px' }}>{(r.volume || 0).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12, marginRight: 8 }} onClick={() => openChart(r.tradingSymbol, r)}>Chart</button>
                    <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => executeTrade({ symbol: r.tradingSymbol, type: 'BUY', quantity: 1, price: r.price })}>Trade</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
