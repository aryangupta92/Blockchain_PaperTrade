import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode, D, ProductType, roundPaise } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { getAccountByMode } from '../services/accountService';
import { ensureDbInstrument } from '../services/trading-oms/instrumentDbSync';
import { placeOrder } from '../services/trading-oms/orderManagementService';
import { executeBasketOrders } from '../services/fnoOptionsService';
import { marketDataService } from '../services/market-data/marketDataService';

const ForeverOrderBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  symbol: z.string().min(1),
  orderFlag: z.enum(['SINGLE', 'OCO']).default('SINGLE'),
  side: z.enum(['BUY', 'SELL']),
  product: z.enum(['CNC', 'NRML', 'MTF']).default('CNC'),
  quantity: z.number().int().positive(),
  triggerPrice: z.union([z.string(), z.number()]),
  limitPrice: z.union([z.string(), z.number()]),
  triggerDirection: z.enum(['GTE', 'LTE']).optional().default('GTE'),
  triggerPrice2: z.union([z.string(), z.number()]).nullable().optional(),
  limitPrice2: z.union([z.string(), z.number()]).nullable().optional(),
});

const ConditionalTriggerBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  symbol: z.string().min(1),
  condition: z.object({
    indicator: z.enum(['LTP', 'RSI_14', 'EMA_20', 'VWAP', 'SUPERTREND', 'VOLUME']).default('LTP'),
    timeframe: z.enum(['1m', '5m', '15m', '1D']).default('5m'),
    operator: z.enum(['GT', 'LT', 'GTE', 'LTE', 'CROSSES_ABOVE', 'CROSSES_BELOW']),
    value: z.number(),
  }),
  orders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        side: z.enum(['BUY', 'SELL']),
        product: z.enum(['CNC', 'MIS', 'NRML', 'MTF']).default('MIS'),
        orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
        quantity: z.number().int().positive(),
        price: z.number().positive().optional(),
      })
    )
    .min(1)
    .max(5),
  frequency: z.enum(['ONCE', 'RECURRING']).optional().default('ONCE'),
  note: z.string().max(200).optional(),
});

const BasketTemplateBody = z.object({
  name: z.string().trim().min(1).max(60),
  legs: z
    .array(
      z.object({
        symbol: z.string().min(1),
        side: z.enum(['BUY', 'SELL']),
        product: z.enum(['CNC', 'MIS', 'NRML', 'MTF']).default('NRML'),
        orderType: z.enum(['MARKET', 'LIMIT']).default('MARKET'),
        quantity: z.number().int().positive(),
        price: z.number().positive().optional(),
      })
    )
    .min(1)
    .max(20),
});

const DraftOrderBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  product: z.enum(['CNC', 'MIS', 'NRML', 'MTF']).default('CNC'),
  orderType: z.enum(['MARKET', 'LIMIT', 'SL', 'SL_M', 'BO', 'CO', 'SUPER', 'GTT']).default('LIMIT'),
  quantity: z.number().int().positive(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  triggerPrice: z.union([z.string(), z.number()]).nullable().optional(),
  stopLoss: z.union([z.string(), z.number()]).nullable().optional(),
  target: z.union([z.string(), z.number()]).nullable().optional(),
  trailingJump: z.union([z.string(), z.number()]).nullable().optional(),
  note: z.string().max(200).optional(),
});

const StockSipBody = z.object({
  accountMode: z.enum(['DEMO', 'REAL']),
  symbol: z.string().min(1),
  mode: z.enum(['AMOUNT', 'QTY']).default('AMOUNT'),
  value: z.union([z.string(), z.number()]),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).default('MONTHLY'),
});

function nextSipDate(freq: string, from = new Date()): Date {
  const d = new Date(from);
  if (freq === 'DAILY') d.setDate(d.getDate() + 1);
  else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export async function advancedOrderRoutes(app: FastifyInstance) {
  // ── 1. Forever Orders (GTT Single & OCO — 365-day validity) ─────────────────
  app.get<{ Querystring: { mode?: string } }>('/forever', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    const account = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();
    const orders = await prisma.foreverOrder.findMany({
      where: { accountId: account.id },
      include: { instrument: { select: { symbol: true, displayName: true, exchange: true, segment: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { mode, count: orders.length, foreverOrders: orders };
  });

  app.post('/forever', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ForeverOrderBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid Forever Order payload', details: parsed.error.issues });
    }
    const d = parsed.data;
    if (d.orderFlag === 'OCO' && (!d.triggerPrice2 || !d.limitPrice2)) {
      return reply.status(400).send({ error: 'OCO Forever Order requires both primary and stop-loss triggers/limits.' });
    }
    const account = await getAccountByMode(req.authUser!.id, d.accountMode as AccountMode);
    const { dbInstrument } = await ensureDbInstrument(d.symbol);
    const prisma = getPrisma();
    const expiresAt = new Date(Date.now() + 365 * 86_400_000);

    const created = await prisma.foreverOrder.create({
      data: {
        accountId: account.id,
        instrumentId: dbInstrument.id,
        orderFlag: d.orderFlag,
        side: d.side,
        product: d.product,
        quantity: d.quantity,
        triggerPrice: roundPaise(d.triggerPrice).toFixed(2),
        limitPrice: roundPaise(d.limitPrice).toFixed(2),
        triggerDirection: d.triggerDirection,
        triggerPrice2: d.triggerPrice2 != null ? roundPaise(d.triggerPrice2).toFixed(2) : null,
        limitPrice2: d.limitPrice2 != null ? roundPaise(d.limitPrice2).toFixed(2) : null,
        expiresAt,
      },
      include: { instrument: { select: { symbol: true, displayName: true, exchange: true, segment: true } } },
    });
    return reply.status(201).send(created);
  });

  app.delete<{ Params: { id: string } }>('/forever/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const row = await prisma.foreverOrder.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!row || row.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Forever Order not found' });
    }
    const updated = await prisma.foreverOrder.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
    return updated;
  });

  // ── 2. Conditional Price / Technical Indicator Triggers ─────────────────────
  app.get<{ Querystring: { mode?: string } }>('/conditional', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    const account = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();
    const rows = await prisma.conditionalTrigger.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      mode,
      count: rows.length,
      triggers: rows.map((r) => ({
        ...r,
        condition: JSON.parse(r.conditionJson),
        orders: JSON.parse(r.ordersJson),
      })),
    };
  });

  app.post('/conditional', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ConditionalTriggerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid conditional trigger payload', details: parsed.error.issues });
    }
    const d = parsed.data;
    const account = await getAccountByMode(req.authUser!.id, d.accountMode as AccountMode);
    const prisma = getPrisma();
    const created = await prisma.conditionalTrigger.create({
      data: {
        accountId: account.id,
        symbol: d.symbol.toUpperCase(),
        conditionJson: JSON.stringify(d.condition),
        ordersJson: JSON.stringify(d.orders),
        frequency: d.frequency,
        note: d.note ?? null,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    return reply.status(201).send({
      ...created,
      condition: d.condition,
      orders: d.orders,
    });
  });

  app.delete<{ Params: { id: string } }>('/conditional/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const row = await prisma.conditionalTrigger.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!row || row.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Conditional trigger not found' });
    }
    return prisma.conditionalTrigger.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
  });

  // ── 3. Saved Basket Templates (CRUD + Margin Preview + Execute All) ─────────
  app.get('/baskets', { preHandler: [requireAuth] }, async (req) => {
    const prisma = getPrisma();
    const rows = await prisma.basketTemplate.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      count: rows.length,
      baskets: rows.map((r) => ({ id: r.id, name: r.name, legs: JSON.parse(r.legsJson), updatedAt: r.updatedAt })),
    };
  });

  app.post('/baskets', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = BasketTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid basket payload', details: parsed.error.issues });
    }
    const prisma = getPrisma();
    const created = await prisma.basketTemplate.create({
      data: {
        userId: req.authUser!.id,
        name: parsed.data.name,
        legsJson: JSON.stringify(parsed.data.legs),
      },
    });
    return reply.status(201).send({ id: created.id, name: created.name, legs: parsed.data.legs, updatedAt: created.updatedAt });
  });

  app.delete<{ Params: { id: string } }>('/baskets/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const del = await prisma.basketTemplate.deleteMany({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (del.count === 0) return reply.status(404).send({ error: 'Basket not found' });
    return { deleted: true };
  });

  app.post<{ Params: { id: string }; Body: { accountMode?: 'DEMO' | 'REAL'; reverse?: boolean } }>(
    '/baskets/:id/execute',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const prisma = getPrisma();
      const row = await prisma.basketTemplate.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
      if (!row) return reply.status(404).send({ error: 'Basket not found' });
      const legs = JSON.parse(row.legsJson) as Array<{
        symbol: string;
        side: 'BUY' | 'SELL';
        product?: ProductType;
        quantity: number;
        price?: number;
      }>;
      const mode: AccountMode = req.body?.accountMode === 'REAL' ? 'REAL' : 'DEMO';
      const reverse = Boolean(req.body?.reverse);
      return executeBasketOrders({
        userId: req.authUser!.id,
        accountMode: mode,
        product: (legs[0]?.product as ProductType) || 'NRML',
        legs: legs.map((l) => ({
          symbol: l.symbol,
          side: reverse ? (l.side === 'BUY' ? 'SELL' : 'BUY') : l.side,
          quantity: l.quantity,
          price: l.price,
        })),
        ipAddress: req.ip,
      });
    }
  );

  // ── 4. Draft Orders (Save for Later + 1-Click Deploy) ───────────────────────
  app.get<{ Querystring: { mode?: string } }>('/drafts', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    const account = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();
    const rows = await prisma.draftOrder.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      mode,
      count: rows.length,
      drafts: rows.map((r) => ({ ...r, payload: JSON.parse(r.payloadJson) })),
    };
  });

  app.post('/drafts', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = DraftOrderBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid draft order payload', details: parsed.error.issues });
    }
    const d = parsed.data;
    const account = await getAccountByMode(req.authUser!.id, d.accountMode as AccountMode);
    const prisma = getPrisma();
    const created = await prisma.draftOrder.create({
      data: {
        accountId: account.id,
        symbol: d.symbol.toUpperCase(),
        side: d.side,
        product: d.product,
        orderType: d.orderType,
        quantity: d.quantity,
        payloadJson: JSON.stringify(d),
        note: d.note ?? null,
      },
    });
    return reply.status(201).send({ ...created, payload: d });
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/execute', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const draft = await prisma.draftOrder.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!draft || draft.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Draft order not found' });
    }
    const p = JSON.parse(draft.payloadJson);
    const result = await placeOrder({
      userId: req.authUser!.id,
      accountMode: draft.account.mode as AccountMode,
      symbol: p.symbol,
      side: p.side,
      product: p.product,
      orderType: p.orderType,
      quantity: p.quantity,
      price: p.price ?? null,
      triggerPrice: p.triggerPrice ?? null,
      stopLoss: p.stopLoss ?? null,
      target: p.target ?? null,
      trailingJump: p.trailingJump ?? null,
      ipAddress: req.ip,
      allowAfterHoursDemo: draft.account.mode === 'DEMO',
    });
    await prisma.draftOrder.delete({ where: { id: draft.id } });
    return result;
  });

  app.delete<{ Params: { id: string } }>('/drafts/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const draft = await prisma.draftOrder.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!draft || draft.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Draft order not found' });
    }
    await prisma.draftOrder.delete({ where: { id: draft.id } });
    return { deleted: true };
  });

  // ── 5. Stock & ETF SIPs (Automated Periodic Investing) ──────────────────────
  app.get<{ Querystring: { mode?: string } }>('/sips', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.query.mode?.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    const account = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();
    const sips = await prisma.stockSip.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
    });
    return { mode, count: sips.length, sips };
  });

  app.post('/sips', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = StockSipBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid SIP payload', details: parsed.error.issues });
    }
    const d = parsed.data;
    const account = await getAccountByMode(req.authUser!.id, d.accountMode as AccountMode);
    const prisma = getPrisma();
    const created = await prisma.stockSip.create({
      data: {
        accountId: account.id,
        symbol: d.symbol.toUpperCase(),
        mode: d.mode,
        value: roundPaise(d.value).toFixed(2),
        frequency: d.frequency,
        nextRunAt: nextSipDate(d.frequency),
      },
    });
    return reply.status(201).send(created);
  });

  app.put<{ Params: { id: string }; Body: { active?: boolean } }>('/sips/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const row = await prisma.stockSip.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!row || row.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'SIP not found' });
    }
    return prisma.stockSip.update({
      where: { id: row.id },
      data: { active: req.body?.active ?? !row.active },
    });
  });

  app.post<{ Params: { id: string } }>('/sips/:id/run-now', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const sip = await prisma.stockSip.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!sip || sip.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'SIP not found' });
    }
    let qty = Math.max(1, Math.floor(Number(sip.value)));
    if (sip.mode === 'AMOUNT') {
      const [q] = await marketDataService.getQuotes([sip.symbol]).catch(() => [null]);
      const px = q?.ltp ? Number(q.ltp) : 0;
      if (px <= 0) return reply.status(503).send({ error: `Live price unavailable for ${sip.symbol} to compute SIP quantity.` });
      qty = Math.max(1, Math.floor(D(sip.value).div(px).toNumber()));
    }
    const res = await placeOrder({
      userId: req.authUser!.id,
      accountMode: sip.account.mode as AccountMode,
      symbol: sip.symbol,
      side: 'BUY',
      product: 'CNC',
      orderType: 'MARKET',
      quantity: qty,
      ipAddress: req.ip,
      allowAfterHoursDemo: sip.account.mode === 'DEMO',
    });
    await prisma.stockSip.update({
      where: { id: sip.id },
      data: { runsCount: sip.runsCount + 1, lastRunAt: new Date(), nextRunAt: nextSipDate(sip.frequency) },
    });
    return { sipId: sip.id, executedQty: qty, order: res.order, trade: res.trade };
  });

  app.delete<{ Params: { id: string } }>('/sips/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const row = await prisma.stockSip.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!row || row.account.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'SIP not found' });
    }
    await prisma.stockSip.delete({ where: { id: row.id } });
    return { deleted: true };
  });
}
