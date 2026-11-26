import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { findSiblingExchangeInstrument, resolveInstrument } from '../services/market-data/instrumentMaster';
import { marketDataService } from '../services/market-data/marketDataService';

const MAX_WATCHLISTS = 10;
const MAX_ITEMS_PER_WATCHLIST = 250;

const CreateWatchlistBody = z.object({
  name: z.string().trim().min(1).max(40),
  segment: z.enum(['ALL', 'EQ', 'FNO', 'ETF', 'COMM']).optional().default('ALL'),
});

const RenameWatchlistBody = z.object({
  name: z.string().trim().min(1).max(40),
});

const AddItemBody = z.object({
  symbol: z.string().trim().min(1).max(60),
  sectionName: z.string().trim().min(1).max(40).optional().default('General'),
  colorTag: z.enum(['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE']).nullable().optional(),
});

const UpdateItemBody = z.object({
  sectionName: z.string().trim().min(1).max(40).optional(),
  colorTag: z.enum(['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE']).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const BulkActionBody = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(['DELETE', 'TAG', 'MOVE_SECTION', 'MOVE_WATCHLIST']),
  colorTag: z.enum(['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE']).nullable().optional(),
  sectionName: z.string().trim().min(1).max(40).optional(),
  targetWatchlistId: z.string().min(1).optional(),
});

const DEFAULT_STARTER_ITEMS = [
  { symbol: 'NIFTY', sectionName: 'Indices', exchange: 'NSE', segment: 'FNO', colorTag: 'BLUE' },
  { symbol: 'BANKNIFTY', sectionName: 'Indices', exchange: 'NSE', segment: 'FNO', colorTag: 'BLUE' },
  { symbol: 'SENSEX', sectionName: 'Indices', exchange: 'BSE', segment: 'FNO', colorTag: 'BLUE' },
  { symbol: 'INDIAVIX', sectionName: 'Indices', exchange: 'NSE', segment: 'FNO', colorTag: 'PURPLE' },
  { symbol: 'RELIANCE', sectionName: 'Large Cap Core', exchange: 'NSE', segment: 'EQ', colorTag: 'GREEN' },
  { symbol: 'HDFCBANK', sectionName: 'Large Cap Core', exchange: 'NSE', segment: 'EQ', colorTag: 'GREEN' },
  { symbol: 'TCS', sectionName: 'Large Cap Core', exchange: 'NSE', segment: 'EQ', colorTag: 'GREEN' },
  { symbol: 'INFY', sectionName: 'Large Cap Core', exchange: 'NSE', segment: 'EQ', colorTag: null },
  { symbol: 'ICICIBANK', sectionName: 'Large Cap Core', exchange: 'NSE', segment: 'EQ', colorTag: null },
  { symbol: 'NIFTYBEES', sectionName: 'ETFs', exchange: 'NSE', segment: 'ETF', colorTag: 'YELLOW' },
];

async function ensureDefaultWatchlists(userId: string) {
  const prisma = getPrisma();
  const existing = await prisma.watchlist.findMany({
    where: { userId },
    include: { items: true },
  });

  if (existing.length === 0) {
    await prisma.watchlist.create({
      data: {
        userId,
        name: 'Watchlist 1',
        segment: 'ALL',
        sortOrder: 0,
        items: {
          create: DEFAULT_STARTER_ITEMS.map((item, idx) => ({
            ...item,
            sortOrder: idx,
          })),
        },
      },
    });
    return;
  }

  for (const wl of existing) {
    if (wl.items.length > 0) continue;
    let symbols: string[] = [];
    try {
      const parsed = JSON.parse(wl.symbolsJson || '[]');
      if (Array.isArray(parsed)) symbols = parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch { /* ignore */ }
    if (symbols.length === 0) continue;
    const seg = wl.segment === 'ALL' ? 'EQ' : wl.segment;
    for (let idx = 0; idx < symbols.length; idx++) {
      const sym = symbols[idx].toUpperCase();
      await prisma.watchlistItem.create({
        data: {
          watchlistId: wl.id,
          symbol: sym,
          sectionName: wl.name || 'General',
          exchange: seg === 'COMM' ? 'MCX' : sym === 'SENSEX' || sym === 'BANKEX' ? 'BSE' : 'NSE',
          segment: seg,
          sortOrder: idx,
        },
      }).catch(() => {});
    }
  }
}

export async function watchlistRoutes(app: FastifyInstance) {
  // List all watchlists (with nested sections & items)
  app.get('/', { preHandler: [requireAuth] }, async (req) => {
    const userId = req.authUser!.id;
    await ensureDefaultWatchlists(userId);
    const prisma = getPrisma();
    const watchlists = await prisma.watchlist.findMany({
      where: { userId },
      include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { count: watchlists.length, maxWatchlists: MAX_WATCHLISTS, watchlists };
  });

  // Create new watchlist (up to 10)
  app.post('/', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = CreateWatchlistBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid watchlist payload', details: parsed.error.issues });
    }
    const prisma = getPrisma();
    const userId = req.authUser!.id;
    const existingCount = await prisma.watchlist.count({ where: { userId } });
    if (existingCount >= MAX_WATCHLISTS) {
      return reply.status(400).send({ error: `Maximum ${MAX_WATCHLISTS} watchlists allowed.` });
    }
    const created = await prisma.watchlist.create({
      data: {
        userId,
        name: parsed.data.name,
        segment: parsed.data.segment,
        sortOrder: existingCount,
      },
      include: { items: true },
    });
    return reply.status(201).send(created);
  });

  // Rename watchlist
  app.put<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = RenameWatchlistBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid watchlist name' });
    const prisma = getPrisma();
    const wl = await prisma.watchlist.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!wl) return reply.status(404).send({ error: 'Watchlist not found' });
    return prisma.watchlist.update({
      where: { id: wl.id },
      data: { name: parsed.data.name },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  });

  // Delete watchlist
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const wl = await prisma.watchlist.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!wl) return reply.status(404).send({ error: 'Watchlist not found' });
    await prisma.watchlist.delete({ where: { id: wl.id } });
    return { deleted: true, id: wl.id };
  });

  // Add symbol to watchlist (under optional Section & Color Tag)
  app.post<{ Params: { id: string } }>('/:id/items', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = AddItemBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid watchlist item payload', details: parsed.error.issues });
    }
    const prisma = getPrisma();
    const wl = await prisma.watchlist.findFirst({
      where: { id: req.params.id, userId: req.authUser!.id },
      include: { items: true },
    });
    if (!wl) return reply.status(404).send({ error: 'Watchlist not found' });
    if (wl.items.length >= MAX_ITEMS_PER_WATCHLIST) {
      return reply.status(400).send({ error: `Watchlist capacity (${MAX_ITEMS_PER_WATCHLIST}) reached.` });
    }

    const inst = await resolveInstrument(parsed.data.symbol);
    const symbol = (inst ? (inst.instrumentKind === 'INDEX' ? inst.symbol : inst.tradingSymbol) : parsed.data.symbol).toUpperCase();
    const exchange = inst?.exchange ?? 'NSE';
    const segment = inst?.segment ?? 'EQ';

    const item = await prisma.watchlistItem.upsert({
      where: { watchlistId_symbol: { watchlistId: wl.id, symbol } },
      create: {
        watchlistId: wl.id,
        symbol,
        exchange,
        segment,
        sectionName: parsed.data.sectionName,
        colorTag: parsed.data.colorTag ?? null,
        sortOrder: wl.items.length,
      },
      update: {
        sectionName: parsed.data.sectionName,
        ...(parsed.data.colorTag !== undefined ? { colorTag: parsed.data.colorTag } : {}),
      },
    });
    return reply.status(201).send(item);
  });

  // Update single item (section, colorTag, sortOrder)
  app.put<{ Params: { id: string; itemId: string } }>('/:id/items/:itemId', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = UpdateItemBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid item update' });
    const prisma = getPrisma();
    const wl = await prisma.watchlist.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!wl) return reply.status(404).send({ error: 'Watchlist not found' });
    return prisma.watchlistItem.update({
      where: { id: req.params.itemId },
      data: {
        ...(parsed.data.sectionName !== undefined ? { sectionName: parsed.data.sectionName } : {}),
        ...(parsed.data.colorTag !== undefined ? { colorTag: parsed.data.colorTag } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      },
    });
  });

  // Remove item from watchlist
  app.delete<{ Params: { id: string; itemId: string } }>('/:id/items/:itemId', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const wl = await prisma.watchlist.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!wl) return reply.status(404).send({ error: 'Watchlist not found' });
    await prisma.watchlistItem.deleteMany({ where: { id: req.params.itemId, watchlistId: wl.id } });
    return { deleted: true };
  });

  // Multi-Select Bulk Actions (Delete, Color Tag, Move Section, Move Watchlist)
  app.post<{ Params: { id: string } }>('/:id/bulk', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = BulkActionBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid bulk action payload' });
    const prisma = getPrisma();
    const wl = await prisma.watchlist.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!wl) return reply.status(404).send({ error: 'Watchlist not found' });

    const { action, itemIds } = parsed.data;
    if (action === 'DELETE') {
      const res = await prisma.watchlistItem.deleteMany({ where: { id: { in: itemIds }, watchlistId: wl.id } });
      return { action, affected: res.count };
    }
    if (action === 'TAG') {
      const res = await prisma.watchlistItem.updateMany({
        where: { id: { in: itemIds }, watchlistId: wl.id },
        data: { colorTag: parsed.data.colorTag ?? null },
      });
      return { action, affected: res.count };
    }
    if (action === 'MOVE_SECTION' && parsed.data.sectionName) {
      const res = await prisma.watchlistItem.updateMany({
        where: { id: { in: itemIds }, watchlistId: wl.id },
        data: { sectionName: parsed.data.sectionName },
      });
      return { action, affected: res.count };
    }
    if (action === 'MOVE_WATCHLIST' && parsed.data.targetWatchlistId) {
      const target = await prisma.watchlist.findFirst({
        where: { id: parsed.data.targetWatchlistId, userId: req.authUser!.id },
      });
      if (!target) return reply.status(404).send({ error: 'Target watchlist not found' });
      const items = await prisma.watchlistItem.findMany({ where: { id: { in: itemIds }, watchlistId: wl.id } });
      let moved = 0;
      for (const it of items) {
        await prisma.watchlistItem.upsert({
          where: { watchlistId_symbol: { watchlistId: target.id, symbol: it.symbol } },
          create: {
            watchlistId: target.id,
            symbol: it.symbol,
            exchange: it.exchange,
            segment: it.segment,
            sectionName: it.sectionName,
            colorTag: it.colorTag,
            sortOrder: moved,
          },
          update: {},
        });
        moved++;
      }
      await prisma.watchlistItem.deleteMany({ where: { id: { in: itemIds }, watchlistId: wl.id } });
      return { action, affected: moved };
    }
    return reply.status(400).send({ error: 'Incomplete bulk action parameters' });
  });

  // Sibling Exchange Lookup (NSE <-> BSE comparison for Order Window toggle)
  app.get<{ Querystring: { symbol?: string } }>('/sibling-exchange', async (req, reply) => {
    const sym = (req.query.symbol || '').trim();
    if (!sym) return reply.status(400).send({ error: 'symbol is required' });
    const base = await resolveInstrument(sym);
    if (!base) return reply.status(404).send({ error: 'Instrument not found' });
    const sibling = await findSiblingExchangeInstrument(sym);
    const ids = sibling ? [base.instrumentId, sibling.instrumentId] : [base.instrumentId];
    const quotes = await marketDataService.getQuotes(ids).catch(() => []);
    return {
      primary: {
        exchange: base.exchange,
        instrumentId: base.instrumentId,
        symbol: base.tradingSymbol,
        mtfLeverage: base.mtfLeverage ?? '4.00',
        upperCircuit: base.upperCircuit ?? null,
        lowerCircuit: base.lowerCircuit ?? null,
        asmGsmFlag: base.asmGsmFlag ?? null,
        ltp: quotes[0]?.ltp ?? null,
      },
      sibling: sibling
        ? {
            exchange: sibling.exchange,
            instrumentId: sibling.instrumentId,
            symbol: sibling.tradingSymbol,
            ltp: quotes[1]?.ltp ?? null,
          }
        : null,
    };
  });
}
