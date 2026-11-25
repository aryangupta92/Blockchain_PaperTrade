import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infrastructure/authMiddleware';
import {
  depositRealFunds,
  getRealFundingSummary,
  withdrawRealFunds,
} from '../services/realFundsService';
import { realBrokerAdapter } from '../services/realBrokerAdapter';

const DepositBody = z.object({
  amount: z.union([z.string(), z.number()]),
  rail: z.enum(['UPI', 'NETBANKING']),
  upiId: z.string().optional(),
  bankCode: z.string().optional(),
});

const WithdrawBody = z.object({
  amount: z.union([z.string(), z.number()]),
  bankAccountMasked: z.string().min(4).max(32),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character Indian IFSC code'),
});

export async function realFundsRoutes(app: FastifyInstance) {
  app.get('/funding-summary', { preHandler: [requireAuth] }, async (req) => {
    const summary = await getRealFundingSummary(req.authUser!.id);
    return {
      ...summary,
      brokerCompliance: realBrokerAdapter.getComplianceStatus(),
    };
  });

  app.post('/deposit', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = DepositBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid deposit payload', details: parsed.error.issues });
    }
    return depositRealFunds({
      userId: req.authUser!.id,
      amount: parsed.data.amount,
      rail: parsed.data.rail,
      upiId: parsed.data.upiId,
      bankCode: parsed.data.bankCode,
      ipAddress: req.ip,
    });
  });

  app.post('/withdraw', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = WithdrawBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid withdrawal payload',
        details: parsed.error.issues,
      });
    }
    return withdrawRealFunds({
      userId: req.authUser!.id,
      amount: parsed.data.amount,
      bankAccountMasked: parsed.data.bankAccountMasked,
      ifsc: parsed.data.ifsc,
      ipAddress: req.ip,
    });
  });

  app.get('/broker-status', { preHandler: [requireAuth] }, async () => {
    return {
      adapterName: realBrokerAdapter.adapterName,
      isMock: realBrokerAdapter.isMock,
      compliance: realBrokerAdapter.getComplianceStatus(),
    };
  });
}
