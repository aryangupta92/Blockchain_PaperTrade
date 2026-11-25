import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calculateBlockHash, LedgerBlockPayload } from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { blockchainService } from '../services/blockchainAuditService';
import { requireAuth } from '../infrastructure/authMiddleware';

const BlocksQuery = z.object({
  mode: z.enum(['DEMO', 'REAL', 'ALL']).optional().default('ALL'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export async function blockchainRoutes(app: FastifyInstance) {
  // Public/system cryptographic integrity verification across the entire chain
  app.get('/verify', async () => {
    return blockchainService.verifyFromDatabase();
  });

  // User-scoped blockchain explorer (shows Genesis + authenticated user's DEMO/REAL blocks)
  app.get('/blocks', { preHandler: [requireAuth] }, async (req, reply) => {
    const q = BlocksQuery.safeParse(req.query);
    if (!q.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const prisma = getPrisma();
    const userId = req.authUser!.id;
    const modeFilter = q.data.mode;

    const where =
      modeFilter === 'ALL'
        ? { OR: [{ userId }, { index: 0 }] }
        : { OR: [{ userId, accountMode: modeFilter }, { index: 0 }] };

    const [blocks, report] = await Promise.all([
      prisma.blockchainBlock.findMany({
        where,
        orderBy: { index: 'desc' },
        take: q.data.limit,
      }),
      blockchainService.verifyFromDatabase(),
    ]);

    return {
      verification: report,
      blocks: blocks.map((b) => ({
        index: b.index,
        timestamp: b.timestamp,
        previousHash: b.previousHash,
        hash: b.hash,
        nonce: b.nonce,
        kind: b.kind,
        accountMode: b.accountMode,
        recordId: b.recordId,
        evmTxHash: b.evmTxHash,
        payload: JSON.parse(b.payloadJson) as LedgerBlockPayload,
      })),
    };
  });

  // Cryptographic verification proof for an individual block hash
  app.get<{ Params: { hash: string } }>('/blocks/:hash', { preHandler: [requireAuth] }, async (req, reply) => {
    const prisma = getPrisma();
    const block = await prisma.blockchainBlock.findUnique({
      where: { hash: req.params.hash },
    });

    if (!block || (block.index !== 0 && block.userId !== req.authUser!.id && req.authUser!.role !== 'ADMIN')) {
      return reply.status(404).send({ error: 'Block not found', code: 'BLOCK_NOT_FOUND' });
    }

    const payload = JSON.parse(block.payloadJson) as LedgerBlockPayload;
    const recalculatedHash = calculateBlockHash(
      block.index,
      block.previousHash,
      block.timestamp,
      payload,
      block.nonce
    );

    const prevBlock =
      block.index > 0
        ? await prisma.blockchainBlock.findUnique({ where: { index: block.index - 1 } })
        : null;

    const hashMatches = recalculatedHash === block.hash;
    const previousLinkValid = block.index === 0 || prevBlock?.hash === block.previousHash;

    return {
      verified: hashMatches && previousLinkValid,
      hashMatches,
      previousLinkValid,
      block: {
        index: block.index,
        timestamp: block.timestamp,
        previousHash: block.previousHash,
        hash: block.hash,
        recalculatedHash,
        nonce: block.nonce,
        kind: block.kind,
        accountMode: block.accountMode,
        recordId: block.recordId,
        evmTxHash: block.evmTxHash,
        payload,
      },
    };
  });
}
