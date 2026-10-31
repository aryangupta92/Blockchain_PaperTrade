'use strict';
/**
 * services/data/dhanClient.js
 *  
 * Typed REST client for DhanHQ v2 — the REAL data backend.
 *
 * Enforced rate limits (per Dhan docs):
 * Data APIs (history) 5 req/sec, 7,000/day
 * Market Quote (LTP/OHLC) 1 req/sec, 1,000 instruments/request
 * Option Chain 1 req/3s, 10 unique scrips/8s
 * Order APIs 10 req/sec, 100,000/day
 *
 * Every failure returns a structured error with `code` so callers can show an
 * actionable message instead of a silent fallback.
 */

const axios = require('axios');
const { requireToken, DhanAuthError } = require('./dhanAuth');

const API = 'https://api.dhan.co/v2';

// Rate limiter: token bucket  
class RateLimiter {
  constructor(perSecond, dailyLimit) {
    this.perSecond = perSecond;
    this.dailyLimit = dailyLimit;
    this.usedToday = 0;
    this.dayStamp = new Date().toISOString().slice(0, 10);
    this.queue = Promise.resolve();
  }
  _roll() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dayStamp) { this.dayStamp = today; this.usedToday = 0; }
  }
  acquire() {
    this.queue = this.queue.then(async () => {
      this._roll();
      if (this.usedToday >= this.dailyLimit) {
        const e = new Error(`Dhan daily limit reached (${this.dailyLimit}/day) for this API class`);
        e.code = 'DAILY_LIMIT'; throw e;
      }
      // enforce minimum spacing
      const minGap = 1000 / this.perSecond;
      const wait = this.nextAt ? Math.max(0, this.nextAt - Date.now()) : 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      this.nextAt = Date.now() + minGap;
      this.usedToday++;
    });
    return this.queue;
  }
  stats() { this._roll(); return { usedToday: this.usedToday, dailyLimit: this.dailyLimit, remaining: Math.max(0, this.dailyLimit - this.usedToday) }; }
}

const limiters = {
  data: new RateLimiter(5, 7000),
  quote: new RateLimiter(1, 100000),
  oi: new RateLimiter(1 / 3, 100000), // 3s spacing
};

// =============================================================================
//  Circuit breaker
// =============================================================================
// Dhan blocks at IP level with: "Too many requests from this IP hence client id
// is blocked". A block lasts minutes, so the correct response to a 429 is to
// STOP calling (and stop retrying upgrades), not to retry harder - which only
// extends the ban.
const circuit = {
  state: 'CLOSED',        // CLOSED | OPEN
  openedAt: null,
  cooldownUntil: null,
  consecutive429: 0,
  totalRequests: 0,
  totalBlocked: 0,
  rateLimited429: 0,
  lastReason: null,
};

const COOLDOWN_MS = parseInt(process.env.DHAN_COOLDOWN_MS || '600000', 10); // 10 min
const MAX_429_BEFORE_OPEN = parseInt(process.env.DHAN_MAX_429 || '2', 10);

function record429(detail) {
  circuit.consecutive429++;
  circuit.rateLimited429++;
  circuit.lastReason = detail || 'rate limited';
  if (circuit.consecutive429 >= MAX_429_BEFORE_OPEN && circuit.state === 'CLOSED') {
    circuit.state = 'OPEN';
    circuit.openedAt = Date.now();
    circuit.cooldownUntil = Date.now() + COOLDOWN_MS;
    console.warn(`[DhanClient] CIRCUIT OPEN - Dhan is rate-limiting us. Pausing ALL Dhan calls for ${Math.round(COOLDOWN_MS / 60000)} min. Reason: ${circuit.lastReason}`);
  }
}

function recordSuccess() {
  circuit.consecutive429 = 0;
  circuit.totalRequests++;
}

function circuitOpen() {
  if (circuit.state === 'CLOSED') return false;
  if (circuit.cooldownUntil && Date.now() < circuit.cooldownUntil) return true;
  circuit.state = 'CLOSED';
  circuit.consecutive429 = 0;
  console.log('[DhanClient] Circuit closed after cooldown - resuming Dhan calls');
  return false;
}

function circuitRemainingMs() {
  return circuit.state === 'OPEN' && circuit.cooldownUntil ? Math.max(0, circuit.cooldownUntil - Date.now()) : 0;
}

function circuitSnapshot() {
  return {
    state: circuit.state,
    cooldownMinutesLeft: Math.round(circuitRemainingMs() / 60000),
    consecutive429: circuit.consecutive429,
    totalRateLimited: circuit.rateLimited429,
    lastReason: circuit.lastReason,
  };
}

// Core request  
async function request(method, url, body, limiter, retries = 2) {
  // Circuit open: fail fast instead of adding to the block
  if (circuitOpen()) {
    circuit.totalBlocked++;
    const e = new Error(`Dhan is rate-limiting this IP. Cooling down for ${Math.round(circuitRemainingMs() / 60000)} more minutes - data resumes automatically.`);
    e.code = 'CIRCUIT_OPEN';
    throw e;
  }
  const t = requireToken();
  try {
    await limiter.acquire();
  } catch (e) { throw new DhanAuthError(e.message, e.code); }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await axios({
        method, url: API + url, data: body,
        headers: {
          'access-token': t.token,
          'client-id': t.clientId || process.env.DHAN_CLIENT_ID,
          'Content-Type': 'application/json', Accept: 'application/json',
        },
        timeout: 30000,
      });
      recordSuccess();
      return r.data;
    } catch (e) {
      const status = e.response?.status;
      const data = e.response?.data;
      const code = data?.errorCode || data?.errorType;

      if (status === 401 || code === 'DH-901' || code === 'DH-807' || code === 'DH-902') {
        throw new DhanAuthError(data?.errorMessage || 'Dhan token invalid/expired', 'AUTH_REQUIRED');
      }

      // 429 / DH-904: open the circuit, NEVER retry harder.
      if (code === 'DH-904' || status === 429) {
        const msg = (data && data.errorMessage) || (status === 429 ? 'Too many requests from this IP - Dhan has temporarily blocked this client' : 'rate limited');
        record429(msg);
        const err = new Error(msg);
        err.code = 'CIRCUIT_OPEN';
        err.data = data;
        throw err;
      }

      const err = new Error(data?.errorMessage || e.message);
      err.code = code || 'HTTP_' + status;
      err.data = data;
      throw err;
    }
  }
  throw new Error('Dhan request failed after retries');
}

// Market Quote APIs (1/sec, 1000 instruments per call)  
/** instruments: [{ exchangeSegment, securityId }] — max 1000 */
async function getLTP(instruments) {
  const groups = {};
  instruments.forEach(({ exchangeSegment, securityId }) => {
    (groups[exchangeSegment] = groups[exchangeSegment] || []).push(String(securityId));
  });
  return request('POST', '/marketfeed/ltp', groups, limiters.quote);
}
async function getOHLC(instruments) {
  const groups = {};
  instruments.forEach(({ exchangeSegment, securityId }) => {
    (groups[exchangeSegment] = groups[exchangeSegment] || []).push(String(securityId));
  });
  return request('POST', '/marketfeed/ohlc', groups, limiters.quote);
}

/**
 * Full quote with 5-level market depth — the money endpoint.
 * Body: { NSE_EQ: [1333, 11536], NSE_FNO: [...], IDX_I: [13] }
 */
async function getFullQuotes(bySegment) {
  return request('POST', '/marketfeed/quote', bySegment, limiters.quote);
}

// Historical Data APIs (5/sec, 7000/day)  
/** Daily candles. 90-day windows recommended for intraday. */
async function getDailyHistory({ securityId, exchangeSegment = 'NSE_EQ', instrument = 'EQUITY', fromDate, toDate, oi = false }) {
  return request('POST', '/charts/historical', {
    securityId, exchangeSegment, instrument, oi,
    fromDate: day(fromDate), toDate: day(toDate),
  }, limiters.data);
}

/** Intraday minute candles: interval ∈ 1,5,15,25,60 */
async function getIntradayHistory({ securityId, exchangeSegment = 'NSE_EQ', instrument = 'EQUITY', interval = 1, fromDate, toDate, oi = false }) {
  return request('POST', '/charts/intraday', {
    securityId, exchangeSegment, instrument, interval, oi,
    fromDate: dt(fromDate), toDate: dt(toDate),
  }, limiters.data);
}

// Option Chain (1 req / 3s)
async function getExpiryList({ exchangeSegment = 'NSE_FNO', underlyingScrip }) {
  return request('POST', '/optionchain/expirylist', {
    UnderlyingScrip: Number(underlyingScrip),
    UnderlyingSeg: exchangeSegment,
  }, limiters.oi);
}
async function getOptionChain({ underlyingScrip, exchangeSegment = 'NSE_FNO', expiry }) {
  return request('POST', '/optionchain', {
    UnderlyingScrip: Number(underlyingScrip),
    UnderlyingSeg: exchangeSegment,
    Expiry: expiry,
  }, limiters.oi);
}

// Market status / misc  
async function getMarketStatus() { return request('GET', '/marketstatus', null, limiters.quote); }

function day(d) {
  const x = typeof d === 'string' ? new Date(d) : (d || new Date());
  return x.toISOString().slice(0, 10);
}
function dt(d) {
  const x = typeof d === 'string' ? new Date(d) : (d || new Date());
  return x.toISOString().slice(0, 19).replace('T', ' ');
}

function stats() {
  return { data: limiters.data.stats(), quote: limiters.quote.stats(), optionChain: limiters.oi.stats() };
}

module.exports = {
  getLTP, getOHLC, getFullQuotes,
  getDailyHistory, getIntradayHistory,
  getOptionChain, getExpiryList, getMarketStatus, stats,
  circuitSnapshot,
};
