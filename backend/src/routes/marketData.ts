import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ExchangeCode, InstrumentKind, MarketSegment } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import { marketDataService } from '../services/market-data/marketDataService';
import {
  getCoreIndices,
  MasterInstrument,
  searchInstruments,
} from '../services/market-data/instrumentMaster';
import {
  finishConsentSession,
  getTokenStatus,
  refreshViaTotp,
  setDirectSessionToken,
  startConsentSession,
} from '../services/market-data/providerTokenManager';

/** Strip all internal wire fields before returning instrument metadata to clients (RULE 1.2). */
function publicInstrument(inst: MasterInstrument) {
  return {
    instrumentId: inst.instrumentId,
    exchange: inst.exchange,
    segment: inst.segment,
    instrumentKind: inst.instrumentKind,
    symbol: inst.symbol,
    tradingSymbol: inst.tradingSymbol,
    displayName: inst.displayName,
    lotSize: inst.lotSize,
    tickSize: inst.tickSize,
    expiryDate: inst.expiryDate,
    strikePrice: inst.strikePrice,
    optionType: inst.optionType,
  };
}

const SearchQuery = z.object({
  q: z.string().optional().default(''),
  segment: z.enum(['EQ', 'FNO', 'ETF', 'COMM']).optional(),
  exchange: z.enum(['NSE', 'BSE', 'MCX']).optional(),
  kind: z.enum(['EQUITY', 'INDEX', 'ETF', 'FUTURES', 'OPTIONS']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

const CandlesQuery = z.object({
  symbol: z.string().min(1),
  interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '1D', '1W']).default('1D'),
  from: z.string().min(10),
  to: z.string().min(10),
});

const RollingOptionBody = z.object({
  underlying: z.string().min(1),
  interval: z.enum(['1', '5', '15', '25', '60']).default('5'),
  expiryFlag: z.enum(['WEEK', 'MONTH']).default('WEEK'),
  expiryCode: z.number().int().min(1).max(3).default(1),
  strike: z.string().default('ATM'),
  optionType: z.enum(['CALL', 'PUT']),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const MarginPreviewBody = z.object({
  legs: z
    .array(
      z.object({
        symbol: z.string().min(1),
        side: z.enum(['BUY', 'SELL']),
        quantity: z.number().int().positive(),
        product: z.enum(['CNC', 'MIS', 'NRML', 'MTF']),
        price: z.number().positive(),
        triggerPrice: z.number().positive().optional(),
      })
    )
    .min(1)
    .max(20),
});

export async function marketRoutes(app: FastifyInstance) {
  // Neutral market data & session status
  app.get('/status', async () => {
    const health = await marketDataService.getHealth();
    return {
      ...health,
      indices: getCoreIndices().map(publicInstrument),
    };
  });

  // Search instruments across NSE, BSE, MCX (EQ, FNO, ETF, COMM)
  app.get('/instruments/search', async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid search query parameters' });
    }
    const items = await searchInstruments({
      query: parsed.data.q,
      segment: parsed.data.segment as MarketSegment | undefined,
      exchange: parsed.data.exchange as ExchangeCode | undefined,
      instrumentKind: parsed.data.kind as InstrumentKind | undefined,
      limit: parsed.data.limit,
    });
    return {
      count: items.length,
      instruments: items.map(publicInstrument),
    };
  });

  // Trigger daily instrument master refresh
  app.post('/instruments/refresh', { preHandler: [requireAuth] }, async () => {
    return marketDataService.refreshInstrumentMaster();
  });

  // Batch live quotes (LTP, OHLC, 5-level depth, OI, volume, freshness)
  app.get<{ Querystring: { symbols?: string } }>('/quotes', async (req, reply) => {
    const raw = (req.query.symbols || '').trim();
    if (!raw) {
      return reply.status(400).send({ error: 'Query parameter "symbols" is required (comma-separated).' });
    }
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    const quotes = await marketDataService.getQuotes(list);
    return {
      count: quotes.length,
      quotes,
      timestamp: new Date().toISOString(),
    };
  });

  // Historical daily & intraday candles
  app.get('/candles', async (req, reply) => {
    const parsed = CandlesQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid candle query parameters', details: parsed.error.issues });
    }
    const candles = await marketDataService.getCandles({
      instrumentId: parsed.data.symbol,
      interval: parsed.data.interval,
      from: parsed.data.from,
      to: parsed.data.to,
    });
    return {
      symbol: parsed.data.symbol,
      interval: parsed.data.interval,
      count: candles.length,
      candles,
    };
  });

  // Live option expiry list
  app.get<{ Querystring: { underlying?: string } }>('/options/expiries', async (req, reply) => {
    const underlying = (req.query.underlying || 'NIFTY').trim();
    if (!underlying) return reply.status(400).send({ error: 'underlying is required' });
    const expiries = await marketDataService.getExpiryList(underlying);
    return { underlying: underlying.toUpperCase(), expiries };
  });

  // Full live option chain with Greeks, IV, OI, PCR, Max Pain
  app.get<{ Querystring: { underlying?: string; expiry?: string } }>('/options/chain', async (req, reply) => {
    const underlying = (req.query.underlying || 'NIFTY').trim();
    const chain = await marketDataService.getOptionChain(underlying, req.query.expiry);
    if (!chain) {
      return reply.status(503).send({
        error: 'Option chain data is currently unavailable for the requested underlying/expiry.',
      });
    }
    return chain;
  });

  // Expired / rolling options historical data
  app.post('/options/rolling', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = RollingOptionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid rolling option query', details: parsed.error.issues });
    }
    const data = await marketDataService.getRollingOptionHistory(parsed.data);
    return { data };
  });

  // Company Fundamentals Snapshot (live upstream companyinfo + detailed scrip metadata)
  app.get<{ Params: { symbol: string } }>('/fundamentals/:symbol', async (req, reply) => {
    const data = await marketDataService.getCompanyFundamentals(req.params.symbol);
    if (!data) return reply.status(404).send({ error: `Instrument not found: ${req.params.symbol}` });
    return data;
  });

  // Live exchange SPAN + Exposure Margin Calculator (single or multi-leg basket)
  app.post('/margin-preview', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = MarginPreviewBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid margin preview request', details: parsed.error.issues });
    }
    const margin = await marketDataService.calculateExchangeMargin(parsed.data.legs);
    return { margin };
  });

  // ── Neutral Market Data Session Management (Authenticated) ──────────────────
  app.get('/session/status', { preHandler: [requireAuth] }, async () => {
    return getTokenStatus();
  });

  app.post('/session/consent/start', { preHandler: [requireAuth] }, async () => {
    return startConsentSession();
  });

  app.post<{ Body: { tokenId?: string } }>('/session/consent/finish', { preHandler: [requireAuth] }, async (req, reply) => {
    const tokenId = req.body?.tokenId?.trim();
    if (!tokenId) return reply.status(400).send({ error: 'tokenId is required' });
    return finishConsentSession(tokenId);
  });

  app.post<{ Body: { token?: string } }>('/session/token', { preHandler: [requireAuth] }, async (req, reply) => {
    const token = req.body?.token?.trim();
    if (!token) return reply.status(400).send({ error: 'token is required' });
    return setDirectSessionToken(token);
  });

  app.post('/session/totp-refresh', { preHandler: [requireAuth] }, async () => {
    return refreshViaTotp();
  });
}
