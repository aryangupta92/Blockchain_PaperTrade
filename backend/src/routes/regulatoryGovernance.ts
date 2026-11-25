import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../infrastructure/authMiddleware';
import { getPrisma } from '../infrastructure/database';
import { getEnv } from '../infrastructure/envConfig';
import {
  approveRegulatoryDraft,
  createRegulatoryDraft,
  getWhatsChangedNotices,
  OFFICIAL_REGULATORY_SOURCES,
  rejectRegulatoryDraft,
  runRegulatoryWatchScan,
  seedBaselineRegulatoryConfigs,
} from '../services/regulatoryWatchService';

const DraftBody = z.object({
  configKey: z.string().min(2).max(100),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payload: z.unknown(),
  verification: z.enum(['VERIFIED', 'TO_VERIFY', 'PLACEHOLDER']).default('VERIFIED'),
  citation: z.string().min(3).max(300),
});

const ApproveBody = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const RejectBody = z.object({
  reason: z.string().max(300).optional(),
});

export async function regulatoryRoutes(app: FastifyInstance) {
  // Public user-facing "What's Changed" regulatory updates feed (APPROVED only)
  app.get('/notices', async () => {
    const notices = await getWhatsChangedNotices();
    return { count: notices.length, notices };
  });

  app.get('/sources', async () => {
    return { sources: OFFICIAL_REGULATORY_SOURCES };
  });

  // DPDP Act (India) personal data & consent export for authenticated user
  app.get('/dpdp-export', { preHandler: [requireAuth] }, async (req) => {
    const prisma = getPrisma();
    const userId = req.authUser!.id;
    const [user, accounts, auditLogs] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          totpEnabled: true,
          kycStatus: true,
          sebiRiskAckAt: true,
          createdAt: true,
        },
      }),
      prisma.tradingAccount.findMany({ where: { userId } }),
      prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      act: 'Digital Personal Data Protection Act (India)',
      exportedAt: new Date().toISOString(),
      user,
      accounts,
      recentAuditLogs: auditLogs,
    };
  });

  // Local dev/test helper ONLY — strictly blocked in production (403)
  app.post('/dev-promote-admin', { preHandler: [requireAuth] }, async (req, reply) => {
    if (getEnv().NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Disabled in production.', code: 'FORBIDDEN' });
    }
    const prisma = getPrisma();
    const updated = await prisma.user.update({
      where: { id: req.authUser!.id },
      data: { role: 'ADMIN' },
      select: { id: true, email: true, role: true },
    });
    return { promoted: true, user: updated, note: 'Refresh session or re-login to activate ADMIN JWT claims.' };
  });

  // ── ADMIN-ONLY Regulatory Watch & Approval Endpoints ────────────────────────
  app.get('/configs', { preHandler: [requireRole('ADMIN')] }, async () => {
    await seedBaselineRegulatoryConfigs();
    const rows = await getPrisma().regulatoryConfig.findMany({
      orderBy: [{ status: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return {
      count: rows.length,
      configs: rows.map((r) => ({ ...r, payload: JSON.parse(r.payloadJson) })),
    };
  });

  app.post('/drafts', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const parsed = DraftBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid draft config payload', details: parsed.error.issues });
    }
    const draft = await createRegulatoryDraft({
      configKey: parsed.data.configKey,
      effectiveFrom: parsed.data.effectiveFrom,
      payload: parsed.data.payload ?? {},
      verification: parsed.data.verification,
      citation: parsed.data.citation,
      proposedBy: req.authUser!.id,
      ipAddress: req.ip,
    });
    return reply.status(201).send(draft);
  });

  app.post<{ Params: { id: string } }>(
    '/drafts/:id/approve',
    { preHandler: [requireRole('ADMIN')] },
    async (req, reply) => {
      const parsed = ApproveBody.safeParse(req.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid effectiveFrom date' });
      }
      return approveRegulatoryDraft({
        configId: req.params.id,
        adminUserId: req.authUser!.id,
        adminEmail: req.authUser!.email,
        effectiveFrom: parsed.data.effectiveFrom,
        ipAddress: req.ip,
      });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/drafts/:id/reject',
    { preHandler: [requireRole('ADMIN')] },
    async (req, reply) => {
      const parsed = RejectBody.safeParse(req.body || {});
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid reject payload' });
      return rejectRegulatoryDraft({
        configId: req.params.id,
        adminUserId: req.authUser!.id,
        reason: parsed.data.reason,
        ipAddress: req.ip,
      });
    }
  );

  app.post('/watch/run', { preHandler: [requireRole('ADMIN')] }, async (req) => {
    return runRegulatoryWatchScan(req.authUser!.id);
  });

  app.get('/audit-logs', { preHandler: [requireRole('ADMIN')] }, async () => {
    const logs = await getPrisma().auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
    return { count: logs.length, logs };
  });
}
