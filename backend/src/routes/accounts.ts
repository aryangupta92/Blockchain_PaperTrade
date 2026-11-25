import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import {
  getAccountLedger,
  getDemoResetArchives,
  getUserAccounts,
  setOrResetDemoBalance,
} from '../services/accountService';

const DemoBalanceBody = z.object({
  amount: z.union([z.string(), z.number()]),
});

const ModeParams = z.object({
  mode: z.enum(['DEMO', 'REAL', 'demo', 'real']),
});

const LedgerQuery = z.object({
  epoch: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function accountRoutes(app: FastifyInstance) {
  // List both DEMO and REAL accounts for authenticated user
  app.get('/', { preHandler: [requireAuth] }, async (req) => {
    const accounts = await getUserAccounts(req.authUser!.id);
    return { accounts };
  });

  // Strict DEMO-only virtual balance set/reset (₹1,000 to ₹1,00,00,000)
  app.post('/demo/balance', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = DemoBalanceBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'A valid numeric amount is required.' });
    }
    return setOrResetDemoBalance({
      userId: req.authUser!.id,
      amount: parsed.data.amount,
      ipAddress: req.ip,
    });
  });

  // Explicitly block virtual balance resets on REAL accounts
  app.post('/real/balance', { preHandler: [requireAuth] }, async (_req, reply) => {
    return reply.status(403).send({
      error: 'REAL account balance can only change via verified deposits, withdrawals, or settled trades.',
      code: 'REAL_VIRTUAL_RESET_FORBIDDEN',
    });
  });

  // View archived DEMO epochs after resets
  app.get('/demo/archives', { preHandler: [requireAuth] }, async (req) => {
    return getDemoResetArchives(req.authUser!.id);
  });

  // Isolated double-entry ledger per account mode (DEMO or REAL)
  app.get('/:mode/ledger', { preHandler: [requireAuth] }, async (req, reply) => {
    const p = ModeParams.safeParse(req.params);
    if (!p.success) {
      return reply.status(400).send({ error: 'Account mode must be DEMO or REAL.' });
    }
    const q = LedgerQuery.safeParse(req.query);
    if (!q.success) {
      return reply.status(400).send({ error: 'Invalid pagination query parameters.' });
    }
    const mode = p.data.mode.toUpperCase() as AccountMode;
    return getAccountLedger({
      userId: req.authUser!.id,
      mode,
      epoch: q.data.epoch,
      limit: q.data.limit,
      offset: q.data.offset,
    });
  });
}
