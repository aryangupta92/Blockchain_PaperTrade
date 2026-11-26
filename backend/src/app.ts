import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  calculateTradeCharges,
  resolveRegulatoryConfig,
  ExchangeCode,
  MarketSegment,
  InstrumentKind,
  ProductType,
  OrderSide,
} from '@broker/shared';
import { getAllowedWebOrigins, getEnv } from './infrastructure/envConfig';
import { sanitizeUserMessage } from './infrastructure/providerAnonymizer';
import { blockchainService } from './services/blockchainAuditService';
import { authRoutes } from './routes/auth';
import { accountRoutes } from './routes/accounts';
import { blockchainRoutes } from './routes/blockchainAudit';
import { marketRoutes } from './routes/marketData';
import { orderRoutes } from './routes/orders';
import { portfolioRoutes } from './routes/portfolio';
import { chartRoutes } from './routes/chartLayouts';
import { fnoRoutes } from './routes/fnoOptions';
import { segmentRoutes } from './routes/etfsCommoditiesAnalytics';
import { realFundsRoutes } from './routes/realAccountFunding';
import { reportRoutes } from './routes/taxAndContractReports';
import { regulatoryRoutes } from './routes/regulatoryGovernance';
import { strategyRoutes } from './routes/strategiesAndBacktest';
import { watchlistRoutes } from './routes/watchlists';
import { advancedOrderRoutes } from './routes/gttBasketsAndSips';
import { screenerRoutes } from './routes/screener';
import { diaryRoutes, controlsRoutes, alertRoutes, webhookRoutes } from './routes/alertsDiaryAndWebhooks';
import { coachRoutes } from './routes/aiCoach';
import { getTokenStatus } from './services/market-data/providerTokenManager';

const ChargeEstimateBody = z.object({
  exchange: z.enum(['NSE', 'BSE', 'MCX']),
  segment: z.enum(['EQ', 'FNO', 'ETF', 'COMM']),
  instrumentKind: z.enum(['EQUITY', 'INDEX', 'ETF', 'FUTURES', 'OPTIONS']),
  product: z.enum(['CNC', 'MIS', 'NRML', 'MTF']),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().int().positive(),
  price: z.union([z.string(), z.number()]),
  isOptionExercise: z.boolean().optional(),
  strikePrice: z.union([z.string(), z.number()]).optional(),
  applyDpCharge: z.boolean().optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function isSameHostOrigin(origin: string, hostHeader?: string): boolean {
  if (!hostHeader) return false;
  const expectedHost = hostHeader.split(',')[0].trim().toLowerCase();
  if (!expectedHost) return false;
  try {
    return new URL(origin).host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();
  const app = Fastify({
    logger: env.NODE_ENV === 'development',
    bodyLimit: 1_048_576, // 1 MB strict payload cap
  });

  const allowedOrigins = getAllowedWebOrigins(env);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const normalized = origin.replace(/\/+$/, '');
      cb(null, allowedOrigins.includes(normalized));
    },
    credentials: true,
  });
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 1000 : 180,
    timeWindow: '1 minute',
  });

  // CSRF Origin validation on mutating cookie-authenticated requests in production
  app.addHook('onRequest', async (req, reply) => {
    if (
      env.NODE_ENV === 'production' &&
      ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) &&
      req.headers.cookie
    ) {
      const origin = req.headers.origin?.replace(/\/+$/, '');
      const requestHost =
        (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
      if (origin && !allowedOrigins.includes(origin) && !isSameHostOrigin(origin, requestHost)) {
        return reply.status(403).send({ error: 'Cross-site request origin rejected.', code: 'CSRF_ORIGIN_MISMATCH' });
      }
    }
  });

  // Global error handler — enforces RULE 1.2 (zero provider leakage)
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    const status = err.statusCode ?? 500;
    const safeMessage = sanitizeUserMessage(err.message || 'Internal server error');
    reply.status(status).send({
      error: safeMessage,
      code: err.code || 'INTERNAL_ERROR',
    });
  });

  // ── Route Modules ───────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(accountRoutes, { prefix: '/api/v1/accounts' });
  await app.register(blockchainRoutes, { prefix: '/api/v1/blockchain' });
  await app.register(marketRoutes, { prefix: '/api/v1/market' });
  await app.register(orderRoutes, { prefix: '/api/v1/orders' });
  await app.register(portfolioRoutes, { prefix: '/api/v1/portfolio' });
  await app.register(chartRoutes, { prefix: '/api/v1/charts' });
  await app.register(fnoRoutes, { prefix: '/api/v1/fno' });
  await app.register(segmentRoutes, { prefix: '/api/v1/segments' });
  await app.register(realFundsRoutes, { prefix: '/api/v1/accounts/real' });
  await app.register(reportRoutes, { prefix: '/api/v1/reports' });
  await app.register(regulatoryRoutes, { prefix: '/api/v1/regulatory' });
  await app.register(strategyRoutes, { prefix: '/api/v1/strategies' });
  await app.register(watchlistRoutes, { prefix: '/api/v1/watchlists' });
  await app.register(advancedOrderRoutes, { prefix: '/api/v1/advanced-orders' });
  await app.register(screenerRoutes, { prefix: '/api/v1/screener' });
  await app.register(diaryRoutes, { prefix: '/api/v1/diary' });
  await app.register(controlsRoutes, { prefix: '/api/v1/controls' });
  await app.register(alertRoutes, { prefix: '/api/v1/alerts' });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(coachRoutes, { prefix: '/api/v1/coach' });

  // ── GET /api/v1/health ──────────────────────────────────────────────────────
  app.get('/api/v1/health', async () => {
    const tokenStatus = getTokenStatus();
    const chainReport = await blockchainService.verifyFromDatabase();

    return {
      status: 'ok',
      service: 'blocktrade-api',
      version: '1.1.0',
      phase: 8,
      database: env.DATABASE_URL.startsWith('postgres')
        ? 'postgresql'
        : process.env.VERCEL
          ? 'sqlite-ephemeral'
          : 'sqlite-dev',
      cache: env.REDIS_URL ? 'redis' : 'in-memory',
      marketData: {
        source: 'Primary Market Data Adapter',
        credentialsConfigured: tokenStatus.credentialsConfigured,
        sessionActive: tokenStatus.authenticated,
        tokenExpiresAt: tokenStatus.expiresAt,
        fallbackSourcesRemoved: true,
      },
      blockchain: {
        valid: chainReport.valid,
        totalBlocks: chainReport.totalBlocks,
        merkleRoot: chainReport.merkleRoot,
      },
      timestamp: new Date().toISOString(),
    };
  });

  // ── GET /api/v1/config/regulatory ───────────────────────────────────────────
  app.get<{ Querystring: { asOf?: string } }>('/api/v1/config/regulatory', async (req) => {
    const asOf = req.query.asOf;
    return resolveRegulatoryConfig(asOf);
  });

  // ── POST /api/v1/charges/estimate ───────────────────────────────────────────
  app.post('/api/v1/charges/estimate', async (req, reply) => {
    const parsed = ChargeEstimateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid charge estimation parameters',
        details: parsed.error.issues,
      });
    }
    const d = parsed.data;
    return calculateTradeCharges({
      exchange: d.exchange as ExchangeCode,
      segment: d.segment as MarketSegment,
      instrumentKind: d.instrumentKind as InstrumentKind,
      product: d.product as ProductType,
      side: d.side as OrderSide,
      quantity: d.quantity,
      price: d.price,
      isOptionExercise: d.isOptionExercise,
      strikePrice: d.strikePrice,
      applyDpCharge: d.applyDpCharge,
      asOfDate: d.asOfDate,
    });
  });

  return app;
}
