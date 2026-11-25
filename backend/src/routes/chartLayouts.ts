import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';

const SaveLayoutBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  layout: z.object({
    symbol: z.string().min(1),
    secondarySymbol: z.string().optional(),
    splitView: z.boolean().default(false),
    interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '1D', '1W']).default('15m'),
    chartType: z.enum(['candles', 'heikin_ashi', 'bars', 'line', 'area']).default('candles'),
    scaleMode: z.enum(['normal', 'log', 'percent']).default('normal'),
    compareSymbol: z.string().optional(),
    indicators: z.array(z.string()).default([]),
    drawings: z.array(z.record(z.unknown())).default([]),
  }),
});

export async function chartRoutes(app: FastifyInstance) {
  app.get('/layouts', { preHandler: [requireAuth] }, async (req) => {
    const prisma = getPrisma();
    const rows = await prisma.chartLayout.findMany({
      where: { userId: req.authUser!.id },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      layouts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        layout: JSON.parse(r.layoutJson),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  app.post('/layouts', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = SaveLayoutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid chart layout payload', details: parsed.error.issues });
    }
    const prisma = getPrisma();
    const userId = req.authUser!.id;
    const { id, name, layout } = parsed.data;

    if (id) {
      const existing = await prisma.chartLayout.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        return reply.status(404).send({ error: 'Chart layout not found' });
      }
      const updated = await prisma.chartLayout.update({
        where: { id },
        data: { name, layoutJson: JSON.stringify(layout) },
      });
      return {
        id: updated.id,
        name: updated.name,
        layout: JSON.parse(updated.layoutJson),
        updatedAt: updated.updatedAt.toISOString(),
      };
    }

    const created = await prisma.chartLayout.create({
      data: {
        userId,
        name,
        layoutJson: JSON.stringify(layout),
      },
    });
    return reply.status(201).send({
      id: created.id,
      name: created.name,
      layout: JSON.parse(created.layoutJson),
      updatedAt: created.updatedAt.toISOString(),
    });
  });

  app.delete<{ Params: { id: string } }>('/layouts/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const existing = await prisma.chartLayout.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.authUser!.id) {
      return reply.status(404).send({ error: 'Chart layout not found' });
    }
    await prisma.chartLayout.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });
}
