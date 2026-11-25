import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode, OrderSide, OrderType, OrderValidity, ProductType } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { getAccountByMode } from '../services/accountService';
import {
  cancelOrder,
  modifyOrder,
  OmsError,
  placeOrder,
  previewOrder,
} from '../services/trading-oms/orderManagementService';

const OrderPayloadSchema = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  product: z.enum(['CNC', 'MIS', 'NRML', 'MTF']),
  orderType: z.enum(['MARKET', 'LIMIT', 'SL', 'SL_M', 'BO', 'CO', 'SUPER', 'GTT']).default('MARKET'),
  quantity: z.number().int().positive(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  triggerPrice: z.union([z.string(), z.number()]).nullable().optional(),
  stopLoss: z.union([z.string(), z.number()]).nullable().optional(),
  target: z.union([z.string(), z.number()]).nullable().optional(),
  trailingJump: z.union([z.string(), z.number()]).nullable().optional(),
  validity: z.enum(['DAY', 'IOC', 'GTT']).optional(),
  isAmo: z.boolean().optional().default(false),
  icebergLegs: z.number().int().min(1).max(20).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  allowAfterHoursDemo: z.boolean().optional().default(false),
});

const ModifyOrderSchema = z.object({
  quantity: z.number().int().positive().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  triggerPrice: z.union([z.string(), z.number()]).optional(),
  stopLoss: z.union([z.string(), z.number()]).optional(),
  target: z.union([z.string(), z.number()]).optional(),
  trailingJump: z.union([z.string(), z.number()]).optional(),
});

export async function orderRoutes(app: FastifyInstance) {
  // Pre-trade margin + itemized statutory charges + compliance preview
  app.post('/preview', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = OrderPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid order preview request', details: parsed.error.issues });
    }
    const d = parsed.data;
    return previewOrder({
      userId: req.authUser!.id,
      accountMode: d.accountMode as AccountMode,
      symbol: d.symbol,
      side: d.side as OrderSide,
      product: d.product as ProductType,
      orderType: d.orderType as OrderType,
      quantity: d.quantity,
      price: d.price,
      triggerPrice: d.triggerPrice,
      stopLoss: d.stopLoss,
      target: d.target,
      trailingJump: d.trailingJump,
      validity: d.validity as OrderValidity | undefined,
      isAmo: d.isAmo,
      allowAfterHoursDemo: d.allowAfterHoursDemo,
    });
  });

  // Place idempotent order across DEMO or REAL account
  app.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = OrderPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid order payload', details: parsed.error.issues });
    }
    const d = parsed.data;
    try {
      const result = await placeOrder({
        userId: req.authUser!.id,
        accountMode: d.accountMode as AccountMode,
        symbol: d.symbol,
        side: d.side as OrderSide,
        product: d.product as ProductType,
        orderType: d.orderType as OrderType,
        quantity: d.quantity,
        price: d.price,
        triggerPrice: d.triggerPrice,
        stopLoss: d.stopLoss,
        target: d.target,
        trailingJump: d.trailingJump,
        validity: d.validity as OrderValidity | undefined,
        isAmo: d.isAmo,
        icebergLegs: d.icebergLegs,
        idempotencyKey: d.idempotencyKey,
        ipAddress: req.ip,
        allowAfterHoursDemo: d.allowAfterHoursDemo,
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof OmsError) {
        return reply.status(err.statusCode).send({
          error: err.message,
          code: err.code,
          ...(err.violations ? { violations: err.violations } : {}),
        });
      }
      throw err;
    }
  });

  // Order book (strictly isolated per account mode)
  app.get<{ Querystring: { mode?: string; status?: string; limit?: string } }>(
    '/',
    { preHandler: [requireAuth] },
    async (req) => {
      const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
      const account = await getAccountByMode(req.authUser!.id, mode);
      const prisma = getPrisma();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

      const orders = await prisma.order.findMany({
        where: {
          accountId: account.id,
          epoch: account.resetEpoch,
          ...(req.query.status ? { status: req.query.status.toUpperCase() } : {}),
        },
        include: {
          instrument: {
            select: { symbol: true, displayName: true, exchange: true, segment: true, lotSize: true },
          },
          events: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return { mode, epoch: account.resetEpoch, count: orders.length, orders };
    }
  );

  // Executed Trade book with itemized statutory charges + blockchain proof hash
  app.get<{ Querystring: { mode?: string; limit?: string } }>(
    '/trades',
    { preHandler: [requireAuth] },
    async (req) => {
      const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
      const account = await getAccountByMode(req.authUser!.id, mode);
      const prisma = getPrisma();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

      const trades = await prisma.trade.findMany({
        where: { accountId: account.id, epoch: account.resetEpoch },
        include: {
          instrument: { select: { symbol: true, displayName: true, exchange: true, segment: true } },
          chargeBreakdown: true,
        },
        orderBy: { executedAt: 'desc' },
        take: limit,
      });

      return { mode, epoch: account.resetEpoch, count: trades.length, trades };
    }
  );

  // Modify pending/open order
  app.put<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ModifyOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid modify request', details: parsed.error.issues });
    }
    return modifyOrder({
      userId: req.authUser!.id,
      orderId: req.params.id,
      ...parsed.data,
    });
  });

  // Cancel pending/open order
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (req) => {
    return cancelOrder(req.authUser!.id, req.params.id);
  });
}
