import axios, { Method } from 'axios';
import { requireSessionToken, MarketDataAuthError } from './providerTokenManager';
import { sanitizeUserMessage } from '../../infrastructure/providerAnonymizer';

// Internal server-only upstream REST origin (NEVER exposed to UI or client APIs)
const UPSTREAM_API_BASE = 'https://api.dhan.co/v2';

class TokenBucketLimiter {
  private usedToday = 0;
  private dayStamp = new Date().toISOString().slice(0, 10);
  private nextAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly perSecond: number,
    private readonly dailyLimit: number
  ) {}

  private rollDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dayStamp) {
      this.dayStamp = today;
      this.usedToday = 0;
    }
  }

  public acquire(): Promise<void> {
    this.queue = this.queue.then(async () => {
      this.rollDay();
      if (this.usedToday >= this.dailyLimit) {
        throw new MarketDataAuthError('Daily market data quota reached. Please try again tomorrow.', 'QUOTA_EXCEEDED');
      }
      const gap = 1000 / this.perSecond;
      const wait = Math.max(0, this.nextAt - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.nextAt = Date.now() + gap;
      this.usedToday++;
    });
    return this.queue;
  }

  public stats() {
    this.rollDay();
    return {
      usedToday: this.usedToday,
      dailyLimit: this.dailyLimit,
      remaining: Math.max(0, this.dailyLimit - this.usedToday),
    };
  }
}

const limiters = {
  quote: new TokenBucketLimiter(1, 100_000),
  data: new TokenBucketLimiter(5, 7_000),
  optionChain: new TokenBucketLimiter(1 / 3, 100_000),
  account: new TokenBucketLimiter(8, 100_000),
};

// ── Circuit Breaker (prevents IP bans on 429) ─────────────────────────────────
const circuit = {
  state: 'CLOSED' as 'CLOSED' | 'OPEN',
  cooldownUntil: 0,
  consecutive429: 0,
  total429: 0,
  totalRequests: 0,
};

const COOLDOWN_MS = 15 * 1000; // 15 seconds brief cooldown
const MAX_429 = 8;

function isCircuitOpen(): boolean {
  if (circuit.state === 'CLOSED') return false;
  if (Date.now() < circuit.cooldownUntil) return true;
  circuit.state = 'CLOSED';
  circuit.consecutive429 = 0;
  return false;
}

export function getCircuitStatus() {
  const remainingMs = circuit.state === 'OPEN' ? Math.max(0, circuit.cooldownUntil - Date.now()) : 0;
  return {
    state: circuit.state,
    cooldownMinutesLeft: Math.ceil(remainingMs / 60_000),
    totalRequests: circuit.totalRequests,
    totalRateLimited: circuit.total429,
    quotas: {
      quote: limiters.quote.stats(),
      data: limiters.data.stats(),
      optionChain: limiters.optionChain.stats(),
    },
  };
}

async function apiRequest<T>(
  method: Method,
  endpoint: string,
  body: unknown,
  limiter: TokenBucketLimiter,
  retryCount = 0
): Promise<T> {
  if (isCircuitOpen()) {
    throw new MarketDataAuthError(
      'Market data feed is cooling down briefly after rate limiting. It will resume automatically.',
      'RATE_LIMIT_COOLDOWN'
    );
  }

  const session = requireSessionToken();
  await limiter.acquire();

  try {
    const resp = await axios.request<T>({
      method,
      url: `${UPSTREAM_API_BASE}${endpoint}`,
      data: body,
      headers: {
        'access-token': session.token,
        'client-id': session.clientId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 25_000,
    });
    circuit.consecutive429 = 0;
    circuit.totalRequests++;
    return resp.data;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { errorCode?: string; errorMessage?: string } }; message?: string };
    const status = e.response?.status;
    const errCode = e.response?.data?.errorCode;

    if (status === 401 || status === 403 || errCode === 'DH-901' || errCode === 'DH-902' || errCode === 'DH-807') {
      throw new MarketDataAuthError('Market data session token is invalid or expired.', 'MARKET_DATA_AUTH_REQUIRED');
    }

    if (status === 429 || errCode === 'DH-904') {
      if (retryCount < 1) {
        await new Promise((r) => setTimeout(r, 1200));
        return apiRequest<T>(method, endpoint, body, limiter, retryCount + 1);
      }
      circuit.consecutive429++;
      circuit.total429++;
      if (circuit.consecutive429 >= MAX_429) {
        circuit.state = 'OPEN';
        circuit.cooldownUntil = Date.now() + COOLDOWN_MS;
      }
      throw new MarketDataAuthError('Market data rate limit reached; cooling down temporarily.', 'RATE_LIMIT_COOLDOWN');
    }

    const safe = sanitizeUserMessage(e.response?.data?.errorMessage || e.message || 'Market data request failed');
    const outErr = new Error(safe) as Error & { statusCode?: number; code?: string };
    outErr.statusCode = status && status >= 400 && status < 500 ? status : 502;
    outErr.code = 'MARKET_DATA_ERROR';
    throw outErr;
  }
}

export interface UpstreamProfile {
  tokenValidity?: string;
  activeSegment?: string;
  ddpi?: string;
  mtf?: string;
  dataPlan?: string;
  dataValidity?: string;
}

export const providerClient = {
  getProfile: () => apiRequest<UpstreamProfile>('GET', '/profile', undefined, limiters.account),

  getLTP: (bySegment: Record<string, number[]>) =>
    apiRequest<{ data?: Record<string, Record<string, { last_price?: number }>> }>(
      'POST',
      '/marketfeed/ltp',
      bySegment,
      limiters.quote
    ),

  getOHLC: (bySegment: Record<string, number[]>) =>
    apiRequest<{ data?: Record<string, Record<string, { last_price?: number; ohlc?: Record<string, number> }>> }>(
      'POST',
      '/marketfeed/ohlc',
      bySegment,
      limiters.quote
    ),

  getFullQuotes: (bySegment: Record<string, number[]>) =>
    apiRequest<{ data?: Record<string, Record<string, Record<string, unknown>>> }>(
      'POST',
      '/marketfeed/quote',
      bySegment,
      limiters.quote
    ),

  getDailyHistory: (payload: {
    securityId: string;
    exchangeSegment: string;
    instrument: string;
    fromDate: string;
    toDate: string;
    oi?: boolean;
  }) =>
    apiRequest<{
      open?: number[];
      high?: number[];
      low?: number[];
      close?: number[];
      volume?: number[];
      timestamp?: number[];
      open_interest?: number[];
    }>('POST', '/charts/historical', payload, limiters.data),

  getIntradayHistory: (payload: {
    securityId: string;
    exchangeSegment: string;
    instrument: string;
    interval: '1' | '5' | '15' | '25' | '60';
    fromDate: string;
    toDate: string;
    oi?: boolean;
  }) =>
    apiRequest<{
      open?: number[];
      high?: number[];
      low?: number[];
      close?: number[];
      volume?: number[];
      timestamp?: number[];
      open_interest?: number[];
    }>('POST', '/charts/intraday', payload, limiters.data),

  /** Expired & rolling options historical data (Data API ₹499 plan). */
  getRollingOptionHistory: (payload: {
    exchangeSegment: string;
    interval: '1' | '5' | '15' | '25' | '60';
    securityId: number;
    instrument: string;
    expiryFlag: 'WEEK' | 'MONTH';
    expiryCode: number;
    strike: string; // e.g. "ATM", "ATM+1", "ATM-2"
    drvOptionType: 'CALL' | 'PUT';
    requiredData: string[];
    fromDate: string;
    toDate: string;
  }) => apiRequest<unknown>('POST', '/charts/rollingoption', payload, limiters.data),

  getExpiryList: (payload: { UnderlyingScrip: number; UnderlyingSeg: string }) =>
    apiRequest<{ data?: string[] }>('POST', '/optionchain/expirylist', payload, limiters.optionChain),

  getOptionChain: (payload: { UnderlyingScrip: number; UnderlyingSeg: string; Expiry: string }) =>
    apiRequest<{ data?: { last_price?: number; oc?: Record<string, { ce?: Record<string, unknown>; pe?: Record<string, unknown> }> } }>(
      'POST',
      '/optionchain',
      payload,
      limiters.optionChain
    ),

  /** Company fundamentals snapshot (overview, valuation ratios, shareholding) — available on Standard Data Plan. */
  getCompanyInfo: (payload: {
    securityId: string;
    exchangeSegment: 'NSE_EQ' | 'BSE_EQ';
    instrument?: 'EQUITY';
    metrics?: string[];
  }) =>
    apiRequest<{ securityId?: string; data?: Record<string, unknown> }>(
      'POST',
      '/data/companyinfo',
      {
        securityId: payload.securityId,
        exchangeSegment: payload.exchangeSegment,
        instrument: payload.instrument ?? 'EQUITY',
        metrics: payload.metrics ?? ['CO'],
      },
      limiters.data
    ),

  /** Real exchange SPAN + Exposure Margin Calculator (single order). */
  calculateMargin: (payload: {
    dhanClientId: string;
    exchangeSegment: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    productType: 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
    securityId: string;
    price: number;
    triggerPrice?: number;
  }) => apiRequest<Record<string, unknown>>('POST', '/margincalculator', payload, limiters.account),

  /** Real exchange SPAN + Exposure + Hedge Benefit Multi-Order Margin Calculator. */
  calculateMultiMargin: (payload: {
    dhanClientId: string;
    includePosition?: boolean;
    includeOrder?: boolean;
    scripList: Array<{
      exchangeSegment: string;
      transactionType: 'BUY' | 'SELL';
      quantity: number;
      productType: 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
      securityId: string;
      price: number;
      triggerPrice?: number;
    }>;
  }) => apiRequest<Record<string, unknown>>('POST', '/margincalculator/multi', payload, limiters.account),
};
