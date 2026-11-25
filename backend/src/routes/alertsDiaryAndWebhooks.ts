import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode, D, ProductType, roundPaise, ZERO } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { getEnv } from '../infrastructure/envConfig';
import { decryptSecret, encryptSecret } from '../infrastructure/encryptionAndJwt';
import { formatAccount, getAccountByMode } from '../services/accountService';
import { updateAccountRiskControls } from '../services/trading-oms/portfolioService';
import { placeOrder } from '../services/trading-oms/orderManagementService';
import { executeBasketOrders } from '../services/fnoOptionsService';

const JournalNoteBody = z.object({
  tradeId: z.string().optional(),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().max(40).optional(),
  setupTag: z.string().max(40).optional(),
  emotionTag: z.string().max(40).optional(),
  mistakeTag: z.string().max(40).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().min(1).max(2000),
});

const AlertBody = z.object({
  symbol: z.string().trim().min(1).max(60),
  condition: z.enum(['PRICE_ABOVE', 'PRICE_BELOW', 'PCT_MOVE', 'RSI_LT', 'RSI_GT', 'VWAP_CROSS']),
  targetValue: z.union([z.string(), z.number()]),
  timeframe: z.string().max(10).optional(),
  note: z.string().max(200).optional(),
});

const ControlsUpdateBody = z.object({
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

const WebhookIncomingSchema = z.object({
  secret: z.string().min(8),
  accountMode: z.enum(['DEMO', 'REAL']).optional().default('DEMO'),
  // Single Order fields
  symbol: z.string().min(1).optional(),
  transactionType: z.string().optional(), // BUY | SELL | buy | sell | B | S
  quantity: z.union([z.number(), z.string()]).optional(),
  orderType: z.enum(['MARKET', 'LIMIT', 'SUPER', 'BO', 'CO']).optional().default('MARKET'),
  productType: z.enum(['CNC', 'MIS', 'NRML', 'MTF', 'INTRADAY', 'DELIVERY', 'MARGIN']).optional().default('MIS'),
  price: z.union([z.number(), z.string()]).optional(),
  targetPrice: z.union([z.number(), z.string()]).optional(),
  stopLossPrice: z.union([z.number(), z.string()]).optional(),
  trailingJump: z.union([z.number(), z.string()]).optional(),
  // Multi-Leg Basket fields
  basket: z
    .array(
      z.object({
        symbol: z.string().min(1),
        transactionType: z.string(),
        quantity: z.union([z.number(), z.string()]),
        productType: z.string().optional(),
        price: z.union([z.number(), z.string()]).optional(),
      })
    )
    .optional(),
});

function normalizeSide(raw?: string): 'BUY' | 'SELL' {
  const s = String(raw || '').trim().toUpperCase();
  return s === 'SELL' || s === 'S' || s === 'SHORT' ? 'SELL' : 'BUY';
}

function normalizeProduct(raw?: string): ProductType {
  const p = String(raw || 'MIS').trim().toUpperCase();
  if (p === 'CNC' || p === 'DELIVERY') return 'CNC';
  if (p === 'NRML' || p === 'MARGIN' || p === 'CARRYFORWARD') return 'NRML';
  if (p === 'MTF') return 'MTF';
  return 'MIS';
}

// ── 1. Trader's Diary & Journal Routes (/api/v1/diary) ────────────────────────
export async function diaryRoutes(app: FastifyInstance) {
  app.get<{ Params: { mode: string } }>('/:mode/summary', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.params.mode.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    const account = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();

    const [trades, notes] = await Promise.all([
      prisma.trade.findMany({
        where: { accountId: account.id, epoch: account.resetEpoch },
        include: { instrument: true, chargeBreakdown: true },
        orderBy: { executedAt: 'asc' },
      }),
      prisma.tradeJournalNote.findMany({
        where: { userId: req.authUser!.id },
        orderBy: { tradeDate: 'desc' },
        take: 100,
      }),
    ]);

    // FIFO closed-trade matching per (instrumentId, product) to derive real per-trade & daily P&L
    const openLots = new Map<string, Array<{ side: 'BUY' | 'SELL'; qty: number; price: number }>>();
    const closedTrades: Array<{
      date: string;
      hourIst: number;
      symbol: string;
      segment: string;
      product: string;
      grossPnl: number;
      charges: number;
      netPnl: number;
      executedAt: string;
    }> = [];

    let totalCharges = ZERO;
    const chargesByDate = new Map<string, number>();

    for (const t of trades) {
      const chg = t.chargeBreakdown ? Number(t.chargeBreakdown.totalCharges) : 0;
      totalCharges = totalCharges.plus(D(chg));
      const istMs = t.executedAt.getTime() + 5.5 * 3600 * 1000;
      const istIso = new Date(istMs).toISOString();
      const dateKey = istIso.slice(0, 10);
      const hourIst = Number(istIso.slice(11, 13));
      chargesByDate.set(dateKey, (chargesByDate.get(dateKey) || 0) + chg);

      const key = `${t.instrumentId}:${t.product}`;
      const queue = openLots.get(key) || [];
      let remQty = t.quantity;
      const fillPx = Number(t.price);
      const side = t.side as 'BUY' | 'SELL';
      let matchedGross = 0;
      let matchedQty = 0;

      while (remQty > 0 && queue.length > 0 && queue[0].side !== side) {
        const front = queue[0];
        const take = Math.min(remQty, front.qty);
        const legPnl = front.side === 'BUY' ? (fillPx - front.price) * take : (front.price - fillPx) * take;
        matchedGross += legPnl;
        matchedQty += take;
        front.qty -= take;
        remQty -= take;
        if (front.qty === 0) queue.shift();
      }
      if (remQty > 0) queue.push({ side, qty: remQty, price: fillPx });
      openLots.set(key, queue);

      if (matchedQty > 0) {
        closedTrades.push({
          date: dateKey,
          hourIst,
          symbol: t.instrument.symbol,
          segment: t.instrument.segment,
          product: t.product,
          grossPnl: Number(matchedGross.toFixed(2)),
          charges: Number(chg.toFixed(2)),
          netPnl: Number((matchedGross - chg).toFixed(2)),
          executedAt: t.executedAt.toISOString(),
        });
      }
    }

    // Calendar heatmap & hourly histogram
    const byDate = new Map<string, { date: string; grossPnl: number; charges: number; netPnl: number; tradesCount: number }>();
    const byHour = new Map<number, { hour: number; netPnl: number; count: number }>();

    for (const [d, ch] of chargesByDate.entries()) {
      byDate.set(d, { date: d, grossPnl: 0, charges: Number(ch.toFixed(2)), netPnl: Number((-ch).toFixed(2)), tradesCount: 0 });
    }
    for (const ct of closedTrades) {
      const cur = byDate.get(ct.date) || { date: ct.date, grossPnl: 0, charges: 0, netPnl: 0, tradesCount: 0 };
      cur.grossPnl = Number((cur.grossPnl + ct.grossPnl).toFixed(2));
      cur.netPnl = Number((cur.grossPnl - cur.charges).toFixed(2));
      cur.tradesCount += 1;
      byDate.set(ct.date, cur);

      const hCur = byHour.get(ct.hourIst) || { hour: ct.hourIst, netPnl: 0, count: 0 };
      hCur.netPnl = Number((hCur.netPnl + ct.netPnl).toFixed(2));
      hCur.count += 1;
      byHour.set(ct.hourIst, hCur);
    }

    const wins = closedTrades.filter((c) => c.netPnl > 0);
    const losses = closedTrades.filter((c) => c.netPnl < 0);
    const grossRealized = closedTrades.reduce((s, c) => s + c.grossPnl, 0);
    const totalChgNum = totalCharges.toNumber();
    const netRealized = grossRealized - totalChgNum;
    const sumWins = wins.reduce((s, c) => s + c.netPnl, 0);
    const sumLossesAbs = Math.abs(losses.reduce((s, c) => s + c.netPnl, 0));
    const winRatePct = closedTrades.length > 0 ? Number(((wins.length / closedTrades.length) * 100).toFixed(1)) : 0;
    const avgWin = wins.length > 0 ? sumWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? sumLossesAbs / losses.length : 0;
    const profitFactor = sumLossesAbs > 0 ? Number((sumWins / sumLossesAbs).toFixed(2)) : sumWins > 0 ? 99 : 0;
    const expectancy =
      closedTrades.length > 0
        ? Number(((winRatePct / 100) * avgWin - (1 - winRatePct / 100) * avgLoss).toFixed(2))
        : 0;

    // Equity curve, max drawdown & streaks
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    let curWinS = 0;
    let maxWinS = 0;
    let curLossS = 0;
    let maxLossS = 0;
    const equityCurve: Array<{ index: number; date: string; cumulativeNetPnl: number }> = [];

    closedTrades.forEach((ct, i) => {
      cum = Number((cum + ct.netPnl).toFixed(2));
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDd) maxDd = dd;
      if (ct.netPnl >= 0) {
        curWinS++;
        curLossS = 0;
        if (curWinS > maxWinS) maxWinS = curWinS;
      } else {
        curLossS++;
        curWinS = 0;
        if (curLossS > maxLossS) maxLossS = curLossS;
      }
      equityCurve.push({ index: i + 1, date: ct.date, cumulativeNetPnl: cum });
    });

    const calendar = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const bestDay = calendar.length ? calendar.reduce((b, c) => (c.netPnl > b.netPnl ? c : b), calendar[0]) : null;
    const worstDay = calendar.length ? calendar.reduce((b, c) => (c.netPnl < b.netPnl ? c : b), calendar[0]) : null;

    return {
      mode,
      kpis: {
        totalExecutions: trades.length,
        closedRoundTrips: closedTrades.length,
        grossRealizedPnl: grossRealized.toFixed(2),
        totalCharges: totalChgNum.toFixed(2),
        netRealizedPnl: netRealized.toFixed(2),
        winRatePct,
        profitFactor,
        expectancy: expectancy.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        maxDrawdown: maxDd.toFixed(2),
        maxWinStreak: maxWinS,
        maxLossStreak: maxLossS,
        bestDay,
        worstDay,
      },
      calendar,
      hourlyBreakdown: [...byHour.values()].sort((a, b) => a.hour - b.hour),
      equityCurve,
      closedTrades: [...closedTrades].reverse().slice(0, 100),
      notes,
    };
  });

  app.post('/notes', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = JournalNoteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid journal note payload', details: parsed.error.issues });
    }
    const prisma = getPrisma();
    const created = await prisma.tradeJournalNote.create({
      data: {
        userId: req.authUser!.id,
        tradeId: parsed.data.tradeId ?? null,
        tradeDate: parsed.data.tradeDate,
        symbol: parsed.data.symbol?.toUpperCase() ?? null,
        setupTag: parsed.data.setupTag ?? null,
        emotionTag: parsed.data.emotionTag ?? null,
        mistakeTag: parsed.data.mistakeTag ?? null,
        rating: parsed.data.rating ?? null,
        notes: parsed.data.notes,
      },
    });
    return reply.status(201).send(created);
  });

  app.delete<{ Params: { id: string } }>('/notes/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const del = await prisma.tradeJournalNote.deleteMany({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (del.count === 0) return reply.status(404).send({ error: 'Journal note not found' });
    return { deleted: true };
  });
}

// ── 2. Trader's Controls Routes (/api/v1/controls) ────────────────────────────
export async function controlsRoutes(app: FastifyInstance) {
  app.get<{ Params: { mode: string } }>('/:mode', { preHandler: [requireAuth] }, async (req) => {
    const mode = (req.params.mode.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    const acc = await getAccountByMode(req.authUser!.id, mode);
    const prisma = getPrisma();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todayTrades = await prisma.trade.count({
      where: { accountId: acc.id, epoch: acc.resetEpoch, executedAt: { gte: startOfDay } },
    });
    return { account: formatAccount(acc), todayTrades };
  });

  app.put<{ Params: { mode: string } }>('/:mode', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ControlsUpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid Trader Controls payload', details: parsed.error.issues });
    }
    const mode = (req.params.mode.toUpperCase() === 'REAL' ? 'REAL' : 'DEMO') as AccountMode;
    return updateAccountRiskControls({ userId: req.authUser!.id, mode, ...parsed.data });
  });
}

// ── 3. Price & Technical Alerts Routes (/api/v1/alerts) ───────────────────────
export async function alertRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requireAuth] }, async (req) => {
    const prisma = getPrisma();
    const alerts = await prisma.priceAlert.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { createdAt: 'desc' },
    });
    return { count: alerts.length, alerts };
  });

  app.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = AlertBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid alert payload', details: parsed.error.issues });
    }
    const prisma = getPrisma();
    const created = await prisma.priceAlert.create({
      data: {
        userId: req.authUser!.id,
        symbol: parsed.data.symbol.toUpperCase(),
        condition: parsed.data.condition,
        targetValue: roundPaise(parsed.data.targetValue).toFixed(2),
        timeframe: parsed.data.timeframe ?? null,
        note: parsed.data.note ?? null,
      },
    });
    return reply.status(201).send(created);
  });

  app.put<{ Params: { id: string }; Body: { status?: 'ACTIVE' | 'PAUSED' } }>(
    '/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const prisma = getPrisma();
      const row = await prisma.priceAlert.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
      if (!row) return reply.status(404).send({ error: 'Alert not found' });
      const nextStatus = req.body?.status ?? (row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
      return prisma.priceAlert.update({ where: { id: row.id }, data: { status: nextStatus } });
    }
  );

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const del = await prisma.priceAlert.deleteMany({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (del.count === 0) return reply.status(404).send({ error: 'Alert not found' });
    return { deleted: true };
  });
}

// ── 4. TradingView Webhooks & JSON Generator (/api/v1/webhooks) ───────────────
async function ensureWebhookConfig(userId: string) {
  const prisma = getPrisma();
  const env = getEnv();
  const existing = await prisma.webhookEndpoint.findUnique({ where: { userId } });
  if (existing) {
    return {
      ...existing,
      secret: decryptSecret(existing.secretEncrypted, env.ENCRYPTION_KEY),
    };
  }
  const urlToken = crypto.randomBytes(16).toString('hex');
  const plainSecret = `whsec_${crypto.randomBytes(18).toString('hex')}`;
  const created = await prisma.webhookEndpoint.create({
    data: {
      userId,
      urlToken,
      secretEncrypted: encryptSecret(plainSecret, env.ENCRYPTION_KEY),
      active: true,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  return { ...created, secret: plainSecret };
}

export async function webhookRoutes(app: FastifyInstance) {
  app.get('/config', { preHandler: [requireAuth] }, async (req) => {
    const cfg = await ensureWebhookConfig(req.authUser!.id);
    const prisma = getPrisma();
    const logs = await prisma.webhookLog.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      webhookPath: `/api/v1/webhooks/tv/${cfg.urlToken}`,
      urlToken: cfg.urlToken,
      secret: cfg.secret,
      active: cfg.active,
      expiresAt: cfg.expiresAt.toISOString(),
      logs,
    };
  });

  app.post('/rotate', { preHandler: [requireAuth] }, async (req) => {
    const prisma = getPrisma();
    const env = getEnv();
    const urlToken = crypto.randomBytes(16).toString('hex');
    const plainSecret = `whsec_${crypto.randomBytes(18).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    await prisma.webhookEndpoint.upsert({
      where: { userId: req.authUser!.id },
      create: {
        userId: req.authUser!.id,
        urlToken,
        secretEncrypted: encryptSecret(plainSecret, env.ENCRYPTION_KEY),
        active: true,
        expiresAt,
      },
      update: {
        urlToken,
        secretEncrypted: encryptSecret(plainSecret, env.ENCRYPTION_KEY),
        active: true,
        expiresAt,
      },
    });
    return { webhookPath: `/api/v1/webhooks/tv/${urlToken}`, urlToken, secret: plainSecret, active: true, expiresAt: expiresAt.toISOString() };
  });

  app.put<{ Body: { active: boolean } }>('/toggle', { preHandler: [requireAuth] }, async (req) => {
    const cfg = await ensureWebhookConfig(req.authUser!.id);
    const prisma = getPrisma();
    const updated = await prisma.webhookEndpoint.update({
      where: { id: cfg.id },
      data: { active: Boolean(req.body?.active) },
    });
    return { active: updated.active };
  });

  // Public TradingView Alert Receiver — Authenticated strictly by urlToken + timing-safe secret match
  app.post<{ Params: { urlToken: string } }>('/tv/:urlToken', async (req, reply) => {
    const start = Date.now();
    const prisma = getPrisma();
    const env = getEnv();
    const ep = await prisma.webhookEndpoint.findUnique({ where: { urlToken: req.params.urlToken } });
    if (!ep || !ep.active || ep.expiresAt.getTime() < Date.now()) {
      return reply.status(401).send({ error: 'Webhook endpoint is invalid, disabled, or expired.' });
    }

    const parsed = WebhookIncomingSchema.safeParse(req.body);
    if (!parsed.success) {
      await prisma.webhookLog.create({
        data: {
          userId: ep.userId,
          payloadJson: JSON.stringify(req.body || {}),
          status: 'REJECTED',
          error: 'Invalid JSON payload schema',
          latencyMs: Date.now() - start,
        },
      });
      return reply.status(400).send({ error: 'Invalid webhook JSON payload', details: parsed.error.issues });
    }

    const expectedSecret = decryptSecret(ep.secretEncrypted, env.ENCRYPTION_KEY);
    const a = Buffer.from(parsed.data.secret);
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await prisma.webhookLog.create({
        data: {
          userId: ep.userId,
          payloadJson: JSON.stringify({ ...parsed.data, secret: '***REDACTED***' }),
          status: 'REJECTED',
          error: 'Secret mismatch',
          latencyMs: Date.now() - start,
        },
      });
      return reply.status(401).send({ error: 'Invalid webhook secret.' });
    }

    const mode = parsed.data.accountMode as AccountMode;
    try {
      // Multi-leg Basket execution
      if (parsed.data.basket && parsed.data.basket.length > 0) {
        const res = await executeBasketOrders({
          userId: ep.userId,
          accountMode: mode,
          product: normalizeProduct(parsed.data.basket[0].productType),
          legs: parsed.data.basket.map((l) => ({
            symbol: l.symbol,
            side: normalizeSide(l.transactionType),
            quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
            price: l.price ? Number(l.price) : undefined,
          })),
          ipAddress: req.ip,
          allowAfterHoursDemo: mode === 'DEMO',
        });
        const orderIds = res.legs.map((l) => l.orderId).filter(Boolean).join(',');
        await prisma.webhookLog.create({
          data: {
            userId: ep.userId,
            payloadJson: JSON.stringify({ ...parsed.data, secret: '***REDACTED***' }),
            status: res.succeeded > 0 ? 'EXECUTED' : 'REJECTED',
            orderIds,
            error: res.failed > 0 ? `${res.failed}/${res.totalLegs} legs failed` : null,
            latencyMs: Date.now() - start,
          },
        });
        return { ok: true, mode, type: 'BASKET', ...res };
      }

      // Single / Super Order execution
      if (!parsed.data.symbol) {
        return reply.status(400).send({ error: 'symbol or basket[] is required in webhook payload.' });
      }
      const hasSuper = Boolean(parsed.data.targetPrice && parsed.data.stopLossPrice);
      const res = await placeOrder({
        userId: ep.userId,
        accountMode: mode,
        symbol: parsed.data.symbol,
        side: normalizeSide(parsed.data.transactionType),
        product: normalizeProduct(parsed.data.productType),
        orderType: hasSuper ? 'SUPER' : parsed.data.orderType,
        quantity: Math.max(1, Math.round(Number(parsed.data.quantity) || 1)),
        price: parsed.data.price && Number(parsed.data.price) > 0 ? Number(parsed.data.price) : null,
        target: parsed.data.targetPrice && Number(parsed.data.targetPrice) > 0 ? Number(parsed.data.targetPrice) : null,
        stopLoss: parsed.data.stopLossPrice && Number(parsed.data.stopLossPrice) > 0 ? Number(parsed.data.stopLossPrice) : null,
        trailingJump: parsed.data.trailingJump && Number(parsed.data.trailingJump) > 0 ? Number(parsed.data.trailingJump) : null,
        ipAddress: req.ip,
        allowAfterHoursDemo: mode === 'DEMO',
      });
      await prisma.webhookLog.create({
        data: {
          userId: ep.userId,
          payloadJson: JSON.stringify({ ...parsed.data, secret: '***REDACTED***' }),
          status: 'EXECUTED',
          orderIds: res.order.id,
          latencyMs: Date.now() - start,
        },
      });
      return { ok: true, mode, type: 'SINGLE', orderId: res.order.id, status: res.order.status };
    } catch (e) {
      const msg = (e as Error).message;
      await prisma.webhookLog.create({
        data: {
          userId: ep.userId,
          payloadJson: JSON.stringify({ ...parsed.data, secret: '***REDACTED***' }),
          status: 'REJECTED',
          error: msg,
          latencyMs: Date.now() - start,
        },
      });
      return reply.status(422).send({ error: msg });
    }
  });
}
