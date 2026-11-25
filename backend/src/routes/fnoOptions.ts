import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode, OPTION_STRATEGY_TEMPLATES, ProductType, QuantLegRule } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import {
  analyzeStrategyBasket,
  buildQuantModeStrategy,
  executeBasketOrders,
  getEnrichedOptionChain,
  getFlashTradeCandidates,
  getFnoAnalytics,
  getFnoUnderlyings,
  settleExpiredOptions,
} from '../services/fnoOptionsService';

const StrategyAnalyzeBody = z.object({
  spotPrice: z.number().positive(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  targetDaysOffset: z.number().min(0).max(90).optional(),
  ivShiftPct: z.number().min(-50).max(100).optional(),
  spotShiftPct: z.number().min(-30).max(30).optional(),
  legs: z
    .array(
      z.object({
        symbol: z.string().min(1),
        underlying: z.string().min(1),
        optionType: z.enum(['CE', 'PE', 'FUT']),
        side: z.enum(['BUY', 'SELL']),
        strike: z.number().min(0),
        expiry: z.string().min(8),
        quantity: z.number().int().positive(),
        premium: z.number().min(0),
        iv: z.number().nullable().optional(),
        delta: z.number().nullable().optional(),
        gamma: z.number().nullable().optional(),
        theta: z.number().nullable().optional(),
        vega: z.number().nullable().optional(),
      })
    )
    .min(1)
    .max(12),
});

const QuantBuildBody = z.object({
  underlying: z.string().min(1).default('NIFTY'),
  expiry: z.string().optional(),
  rules: z
    .array(
      z.object({
        optionType: z.enum(['CE', 'PE']),
        side: z.enum(['BUY', 'SELL']),
        lots: z.number().int().min(1).max(100).default(1),
        rule: z.enum([
          'ATM_POINTS',
          'ATM_PERCENT',
          'CLOSEST_PREMIUM',
          'CLOSEST_DELTA',
          'HIGHEST_OI',
          'HIGHEST_OI_CHG',
          'HIGHEST_VOLUME',
          'STRADDLE_WIDTH',
          'HIGHEST_GAMMA',
        ]),
        value: z.number().optional(),
      })
    )
    .min(1)
    .max(8),
});

const BasketExecuteBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  product: z.enum(['NRML', 'MIS']).default('NRML'),
  allowAfterHoursDemo: z.boolean().optional().default(true),
  legs: z
    .array(
      z.object({
        symbol: z.string().min(1),
        side: z.enum(['BUY', 'SELL']),
        quantity: z.number().int().positive(),
        price: z.number().positive().optional(),
      })
    )
    .min(1)
    .max(12),
});

const SettleExpiryBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  underlyingSpotPrices: z.record(z.number().positive()),
});

export async function fnoRoutes(app: FastifyInstance) {
  // Dynamic live list of NSE/BSE Index & Stock F&O underlyings + F&O ban list + SEBI rules
  app.get('/underlyings', async () => {
    return getFnoUnderlyings();
  });

  // Live enriched Option Chain with resolved strike contract symbols, lot sizes, Greeks, PCR, Max Pain
  app.get<{ Querystring: { underlying?: string; expiry?: string } }>('/chain', async (req, reply) => {
    const underlying = (req.query.underlying || 'NIFTY').trim();
    const chain = await getEnrichedOptionChain(underlying, req.query.expiry);
    if (!chain) {
      return reply.status(503).send({
        error: `Live option chain is currently unavailable for ${underlying}.`,
      });
    }
    return chain;
  });

  // Multi-leg strategy payoff curve, Net Greeks, SEBI hedge margin & combined charges
  app.post('/strategy/analyze', async (req, reply) => {
    const parsed = StrategyAnalyzeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid strategy legs', details: parsed.error.issues });
    }
    return analyzeStrategyBasket(parsed.data);
  });

  // Multi-leg Strategy Basket execution (BUY legs first -> SELL legs)
  app.post('/basket', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = BasketExecuteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid basket order payload', details: parsed.error.issues });
    }
    return executeBasketOrders({
      userId: req.authUser!.id,
      accountMode: parsed.data.accountMode as AccountMode,
      product: parsed.data.product as ProductType,
      legs: parsed.data.legs,
      ipAddress: req.ip,
      allowAfterHoursDemo: parsed.data.allowAfterHoursDemo,
    });
  });

  // Expiry settlement & ITM option auto-exercise / assignment (with Finance Act 2026 0.15% exercise STT)
  app.post('/expiry/settle', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = SettleExpiryBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid expiry settlement payload', details: parsed.error.issues });
    }
    return settleExpiredOptions({
      userId: req.authUser!.id,
      accountMode: parsed.data.accountMode as AccountMode,
      settlementDate: parsed.data.settlementDate,
      underlyingSpotPrices: parsed.data.underlyingSpotPrices,
    });
  });

  // All 17 Pre-Built Option Strategy Templates (Bullish / Bearish / Neutral / Volatility)
  app.get('/templates', async () => {
    return { count: OPTION_STRATEGY_TEMPLATES.length, templates: OPTION_STRATEGY_TEMPLATES };
  });

  // Quant Mode: Automated rule-based multi-leg option builder (9 rules)
  app.post('/quant-build', async (req, reply) => {
    const parsed = QuantBuildBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid Quant Mode rules', details: parsed.error.issues });
    }
    try {
      return await buildQuantModeStrategy({
        underlying: parsed.data.underlying,
        expiry: parsed.data.expiry,
        rules: parsed.data.rules as QuantLegRule[],
      });
    } catch (e) {
      return reply.status(503).send({ error: (e as Error).message });
    }
  });

  // Flash Trade: 1-click scalper picks (ATM, Highest OI, Most Traded) for Bullish / Bearish outlook
  app.get<{ Querystring: { underlying?: string; view?: string; expiry?: string } }>('/flash', async (req, reply) => {
    const underlying = (req.query.underlying || 'NIFTY').trim();
    const view = req.query.view?.toUpperCase() === 'BEARISH' ? 'BEARISH' : 'BULLISH';
    try {
      return await getFlashTradeCandidates({ underlying, view, expiry: req.query.expiry });
    } catch (e) {
      return reply.status(503).send({ error: (e as Error).message });
    }
  });

  // Derivatives OI Profile, ATM Straddle, Multi-Strike OI, Trending OI & IV Skew Analytics
  app.get<{ Querystring: { underlying?: string; expiry?: string } }>('/analytics', async (req, reply) => {
    const underlying = (req.query.underlying || 'NIFTY').trim();
    const data = await getFnoAnalytics(underlying, req.query.expiry);
    if (!data) return reply.status(503).send({ error: `Analytics unavailable for ${underlying}` });
    return data;
  });
}
