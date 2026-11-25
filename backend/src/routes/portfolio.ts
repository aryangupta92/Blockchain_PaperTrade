import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode, ProductType } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import {
  convertMtfToCnc,
  exitAllOpenPositions,
  getMtfPositions,
  getPortfolioAnalyzer,
  getPortfolioHoldings,
  getPortfolioPositions,
  getPositionInsights,
  pledgeHoldingForMargin,
  unpledgeHoldingMargin,
  updateAccountRiskControls,
} from '../services/trading-oms/portfolioService';
import { convertPositionProduct, placeOrder, reversePosition, runMisAutoSquareOff } from '../services/trading-oms/orderManagementService';
import { getPrisma } from '../infrastructure/database';
import { getAccountByMode } from '../services/accountService';

const ModeParam = z.object({ mode: z.enum(['DEMO', 'REAL', 'demo', 'real']) });

const ConvertBody = z.object({
  symbol: z.string().min(1),
  fromProduct: z.enum(['MIS', 'CNC', 'NRML']),
  toProduct: z.enum(['MIS', 'CNC', 'NRML']),
});

const ReverseBody = z.object({
  symbol: z.string().min(1),
  product: z.enum(['MIS', 'NRML']),
  allowAfterHoursDemo: z.boolean().optional().default(true),
});

const PledgeBody = z.object({
  symbol: z.string().min(1),
  quantity: z.number().int().positive(),
});

const SquareOffBody = z.object({
  symbol: z.string().min(1),
  product: z.enum(['MIS', 'CNC', 'NRML', 'MTF']),
  quantity: z.number().int().positive(),
  currentNetQuantity: z.number().int(),
  allowAfterHoursDemo: z.boolean().optional().default(true),
});

const RiskControlsBody = z.object({
  killSwitchOn: z.boolean().optional(),
  lockedSegments: z.array(z.enum(['EQ', 'FNO', 'ETF', 'COMM'])).optional(),
  maxDailyLoss: z.union([z.string(), z.number()]).nullable().optional(),
  dailyProfitTarget: z.union([z.string(), z.number()]).nullable().optional(),
  enableAutoPnlExit: z.boolean().optional(),
  pnlExitKillSwitch: z.boolean().optional(),
  maxOrderValue: z.union([z.string(), z.number()]).nullable().optional(),
  maxOpenOrders: z.number().int().min(1).max(500).optional(),
  maxTradesPerDay: z.number().int().min(1).max(500).nullable().optional(),
  lossStreakLimit: z.number().int().min(1).max(50).nullable().optional(),
  cooldownMinutes: z.number().int().min(1).max(240).optional(),
  clearCooldown: z.boolean().optional(),
});

function parseMode(params: unknown): AccountMode {
  const p = ModeParam.parse(params);
  return p.mode.toUpperCase() as AccountMode;
}

export async function portfolioRoutes(app: FastifyInstance) {
  app.get('/:mode/positions', { preHandler: [requireAuth] }, async (req) => {
    return getPortfolioPositions(req.authUser!.id, parseMode(req.params));
  });

  app.get('/:mode/holdings', { preHandler: [requireAuth] }, async (req) => {
    return getPortfolioHoldings(req.authUser!.id, parseMode(req.params));
  });

  app.post('/:mode/positions/square-off', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = SquareOffBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid square-off payload', details: parsed.error.issues });
    }
    const mode = parseMode(req.params);
    const side = parsed.data.currentNetQuantity > 0 ? 'SELL' : 'BUY';
    return placeOrder({
      userId: req.authUser!.id,
      accountMode: mode,
      symbol: parsed.data.symbol,
      side,
      product: parsed.data.product as ProductType,
      orderType: 'MARKET',
      quantity: parsed.data.quantity,
      allowAfterHoursDemo: parsed.data.allowAfterHoursDemo,
    });
  });

  app.post('/:mode/positions/convert', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ConvertBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid conversion payload' });
    }
    return convertPositionProduct({
      userId: req.authUser!.id,
      accountMode: parseMode(req.params),
      symbol: parsed.data.symbol,
      fromProduct: parsed.data.fromProduct as ProductType,
      toProduct: parsed.data.toProduct as ProductType,
    });
  });

  app.post('/:mode/positions/exit-all', { preHandler: [requireAuth] }, async (req) => {
    return exitAllOpenPositions(req.authUser!.id, parseMode(req.params), true);
  });

  app.post('/:mode/mis-auto-square-off', { preHandler: [requireAuth] }, async (req) => {
    return runMisAutoSquareOff({
      userId: req.authUser!.id,
      accountMode: parseMode(req.params),
    });
  });

  app.put('/:mode/risk-controls', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = RiskControlsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid risk control settings', details: parsed.error.issues });
    }
    return updateAccountRiskControls({
      userId: req.authUser!.id,
      mode: parseMode(req.params),
      ...parsed.data,
    });
  });

  // One-click Reverse Position (2x opposite market order)
  app.post('/:mode/positions/reverse', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ReverseBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid reverse payload' });
    return reversePosition({
      userId: req.authUser!.id,
      accountMode: parseMode(req.params),
      symbol: parsed.data.symbol,
      product: parsed.data.product as ProductType,
      allowAfterHoursDemo: parsed.data.allowAfterHoursDemo,
    });
  });

  // Position Insights (Live F&O combined payoff & net Greeks by underlying)
  app.get('/:mode/positions/insights', { preHandler: [requireAuth] }, async (req) => {
    return getPositionInsights(req.authUser!.id, parseMode(req.params));
  });

  // Portfolio Analyzer (XIRR, Sector/Segment allocation, Concentration & Tax Loss Harvesting)
  app.get('/:mode/analyzer', { preHandler: [requireAuth] }, async (req) => {
    return getPortfolioAnalyzer(req.authUser!.id, parseMode(req.params));
  });

  // Holdings Instant Margin Pledge & Unpledge
  app.get('/:mode/pledges', { preHandler: [requireAuth] }, async (req) => {
    const mode = parseMode(req.params);
    const account = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();
    const pledges = await prisma.pledgeRecord.findMany({
      where: { accountId: account.id },
      include: { instrument: { select: { symbol: true, displayName: true, segment: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { mode, collateralMargin: account.collateralMargin, pledges };
  });

  app.post('/:mode/pledge', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = PledgeBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid pledge request' });
    try {
      return await pledgeHoldingForMargin({
        userId: req.authUser!.id,
        mode: parseMode(req.params),
        symbol: parsed.data.symbol,
        quantity: parsed.data.quantity,
      });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { mode: string; id: string } }>('/:mode/unpledge/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      return await unpledgeHoldingMargin({
        userId: req.authUser!.id,
        mode: parseMode(req.params),
        pledgeId: req.params.id,
      });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  // MTF (4x Leveraged Delivery) positions & Convert MTF -> CNC
  app.get('/:mode/mtf', { preHandler: [requireAuth] }, async (req) => {
    return getMtfPositions(req.authUser!.id, parseMode(req.params));
  });

  app.post<{ Params: { mode: string; id: string } }>('/:mode/mtf/:id/convert', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      return await convertMtfToCnc({
        userId: req.authUser!.id,
        mode: parseMode(req.params),
        mtfId: req.params.id,
      });
    } catch (e) {
      return reply.status(422).send({ error: (e as Error).message });
    }
  });
}
