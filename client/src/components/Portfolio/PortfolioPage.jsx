import './Portfolio.css';
import { TrendingUp, TrendingDown, Wallet, BarChart2 } from 'lucide-react';

function fmtPrice(n) {
  return n?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00';
}

export default function PortfolioPage({ holdings, quotes, balance, initialBalance }) {
  const stockList = Object.entries(holdings).filter(([, h]) => h.quantity > 0);

  const totalInvested = stockList.reduce((sum, [, h]) => sum + h.quantity * h.avgPrice, 0);
  const currentValue = stockList.reduce((sum, [symbol, h]) => {
    const ltp = quotes[symbol]?.price || h.avgPrice;
    return sum + h.quantity * ltp;
  }, 0);
  const totalPL = currentValue - totalInvested;
  const totalPLPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
  const portfolioValue = balance + currentValue;
  const overallReturn = portfolioValue - initialBalance;
  const overallReturnPct = (overallReturn / initialBalance) * 100;

  return (
    <div className="portfolio-page">
      {/* Summary Cards */}
      <div className="portfolio-summary-row">
        <div className="card pf-summary-card">
          <div className="pf-card-label"><Wallet size={13} /> Total Portfolio Value</div>
          <div className="pf-card-value">₹{fmtPrice(portfolioValue)}</div>
          <div className={`pf-card-sub ${overallReturn >= 0 ? 'gain' : 'loss'}`}>
            {overallReturn >= 0 ? '+' : ''}₹{fmtPrice(Math.abs(overallReturn))} ({overallReturnPct.toFixed(2)}%) overall
          </div>
        </div>
        <div className="card pf-summary-card">
          <div className="pf-card-label"><Wallet size={13} /> Cash Balance</div>
          <div className="pf-card-value gain">₹{fmtPrice(balance)}</div>
          <div className="pf-card-sub">Available for trading</div>
        </div>
        <div className="card pf-summary-card">
          <div className="pf-card-label"><BarChart2 size={13} /> Invested Value</div>
          <div className="pf-card-value">₹{fmtPrice(totalInvested)}</div>
          <div className="pf-card-sub">in {stockList.length} stocks</div>
        </div>
        <div className="card pf-summary-card">
          <div className={`pf-card-label`}>
            {totalPL >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            Unrealized P&L
          </div>
          <div className={`pf-card-value ${totalPL >= 0 ? 'gain' : 'loss'}`}>
            {totalPL >= 0 ? '+' : '-'}₹{fmtPrice(Math.abs(totalPL))}
          </div>
          <div className={`pf-card-sub ${totalPLPct >= 0 ? 'gain' : 'loss'}`}>
            {totalPLPct >= 0 ? '+' : ''}{totalPLPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Holdings Table */}
      <div className="card">
        <div className="section-header">
          <span className="section-title">Holdings</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stockList.length} positions</span>
        </div>

        {stockList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <BarChart2 size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div>No holdings yet. Place your first trade!</div>
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table holdings-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Avg Price</th>
                  <th style={{ textAlign: 'right' }}>LTP</th>
                  <th style={{ textAlign: 'right' }}>Cur. Value</th>
                  <th style={{ textAlign: 'right' }}>P&L</th>
                  <th style={{ textAlign: 'right' }}>% Chg</th>
                </tr>
              </thead>
              <tbody>
                {stockList.map(([symbol, h]) => {
                  const ltp = quotes[symbol]?.price || h.avgPrice;
                  const curValue = h.quantity * ltp;
                  const invested = h.quantity * h.avgPrice;
                  const pl = curValue - invested;
                  const plPct = (pl / invested) * 100;
                  const isGain = pl >= 0;
                  return (
                    <tr key={symbol}>
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>NSE</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{h.quantity}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(h.avgPrice)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: quotes[symbol]?.changePercent >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                        ₹{fmtPrice(ltp)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>₹{fmtPrice(curValue)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: isGain ? 'var(--gain)' : 'var(--loss)', fontWeight: 600 }}>
                        {isGain ? '+' : '-'}₹{fmtPrice(Math.abs(pl))}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`mover-change-pill ${isGain ? 'gain' : 'loss'}`}>
                          {isGain ? '+' : ''}{plPct.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
