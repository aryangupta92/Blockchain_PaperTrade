// SEBI Compliance Utilities for BlockTrade Paper Trading Platform

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function getMarketStatus() {
  const ist = nowIST();
  const day  = ist.getUTCDay();   // 0=Sun, 6=Sat
  const h    = ist.getUTCHours();
  const m    = ist.getUTCMinutes();
  const mins = h * 60 + m;

  if (day === 0 || day === 6) {
    return { status: 'CLOSED', reason: 'Weekend', color: '#ef5350', open: false };
  }

  const PRE_OPEN_START  = 9 * 60;          // 9:00 AM
  const MARKET_OPEN     = 9 * 60 + 15;     // 9:15 AM
  const MARKET_CLOSE    = 15 * 60 + 30;    // 3:30 PM
  const POST_OPEN       = 15 * 60 + 40;    // 3:40 PM
  const POST_CLOSE      = 16 * 60;         // 4:00 PM

  if (mins < PRE_OPEN_START)  return { status: 'CLOSED',   reason: 'Pre-open at 9:00 AM', color: '#ef5350', open: false };
  if (mins < MARKET_OPEN)     return { status: 'PRE-OPEN',  reason: 'Pre-open session',    color: '#f59e0b', open: false };
  if (mins <= MARKET_CLOSE)   return { status: 'OPEN',      reason: 'Market is live',       color: '#26a69a', open: true  };
  if (mins < POST_OPEN)       return { status: 'CLOSING',   reason: 'Market closing',       color: '#f59e0b', open: false };
  if (mins <= POST_CLOSE)     return { status: 'POST-OPEN', reason: 'Post-market session',  color: '#f59e0b', open: false };
  return { status: 'CLOSED', reason: 'Market closed for today', color: '#ef5350', open: false };
}

// Returns IST time string like "12:34:56 UTC+5:30"
export function formatIST(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.toISOString().replace('T', ' ').slice(0, 19) + ' UTC+5:30';
}

// Circuit breaker check
export function checkCircuitBreaker(currentPrice, prevClose) {
  if (!prevClose || prevClose === 0) return null;
  const changePct = ((currentPrice - prevClose) / prevClose) * 100;
  if (Math.abs(changePct) >= 20) return { level: '20%', action: 'Trading halted for rest of day', severity: 'critical' };
  if (Math.abs(changePct) >= 10) return { level: '10%', action: 'Trading halt for 45 minutes',   severity: 'high' };
  if (Math.abs(changePct) >= 5)  return { level: '5%',  action: 'Trading halt for 15 minutes',   severity: 'medium' };
  return null;
}

// Position limit check (max 90% of balance in one stock — SEBI sim)
export function checkPositionLimit(symbol, newTradeValue, currentHoldingValue, totalBalance) {
  const totalExposure = (currentHoldingValue || 0) + newTradeValue;
  const portfolioValue = totalBalance + currentHoldingValue;
  const concentration = totalExposure / portfolioValue;
  if (concentration > 0.9) {
    return { allowed: false, reason: 'SEBI position limit: Max 90% of portfolio in single stock' };
  }
  return { allowed: true };
}

// Subscription trade logic: in ₹1000 how many trades
export function tradesFromBudget(budget, avgTradeSize = 5000) {
  // Starter plan ₹99 → ₹50,000 → 50 trades (50k / 1k per trade)
  // Pro ₹299 → ₹2L → 200 trades
  // Expert ₹999 → ₹10L → unlimited
  return Math.floor(budget / avgTradeSize);
}

// Virtual money warning thresholds
export function getBalanceWarning(balance, initialBalance) {
  const pct = (balance / initialBalance) * 100;
  if (pct <= 0)   return { level: 'critical', message: 'Account balance is zero. Please renew subscription.' };
  if (pct <= 10)  return { level: 'danger',   message: `Critical: Only ${pct.toFixed(1)}% of initial capital remaining.` };
  if (pct <= 25)  return { level: 'warning',  message: `Warning: ${pct.toFixed(1)}% of initial capital remaining.` };
  return null;
}

// SEBI Risk categories
export const RISK_LEVELS = {
  equity:  { label: 'Equity',      risk: 'MODERATE', color: '#f59e0b' },
  fo:      { label: 'F&O',         risk: 'HIGH',      color: '#ef5350' },
  options: { label: 'Options',      risk: 'VERY HIGH', color: '#dc2626' },
  index:   { label: 'Index Funds',  risk: 'LOW-MOD',   color: '#26a69a' },
  etf:     { label: 'ETF',          risk: 'LOW-MOD',   color: '#26a69a' },
};

export function getAssetRisk(symbol) {
  if (symbol?.startsWith('^')) return RISK_LEVELS.index;
  if (symbol?.includes('CALL') || symbol?.includes('PUT')) return RISK_LEVELS.options;
  if (symbol?.includes('FUT')) return RISK_LEVELS.fo;
  return RISK_LEVELS.equity;
}
