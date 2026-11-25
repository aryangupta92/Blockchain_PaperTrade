import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AccountMode } from '@broker/shared';
import { requireAuth } from '../infrastructure/authMiddleware';
import {
  exportReportCsv,
  getDailyContractNotes,
  getTaxPnlReport,
} from '../services/taxAndContractReportsService';

const ModeParam = z.object({ mode: z.enum(['DEMO', 'REAL', 'demo', 'real']) });

function parseMode(params: unknown): AccountMode {
  return ModeParam.parse(params).mode.toUpperCase() as AccountMode;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get<{ Params: { mode: string }; Querystring: { date?: string } }>(
    '/:mode/contract-notes',
    { preHandler: [requireAuth] },
    async (req) => {
      return getDailyContractNotes(req.authUser!.id, parseMode(req.params), req.query.date);
    }
  );

  app.get<{ Params: { mode: string } }>(
    '/:mode/tax-pnl',
    { preHandler: [requireAuth] },
    async (req) => {
      return getTaxPnlReport(req.authUser!.id, parseMode(req.params));
    }
  );

  app.get<{ Params: { mode: string }; Querystring: { type?: string } }>(
    '/:mode/export',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const mode = parseMode(req.params);
      const rawType = (req.query.type || 'trades').toLowerCase();
      const type = rawType === 'ledger' ? 'ledger' : rawType === 'tax-pnl' ? 'tax-pnl' : 'trades';
      const csv = await exportReportCsv(req.authUser!.id, mode, type);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${mode.toLowerCase()}-${type}-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv);
    }
  );
}
