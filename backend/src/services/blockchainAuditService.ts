import {
  calculateBlockHash,
  ChainVerificationReport,
  LedgerBlockPayload,
  LedgerChain,
  SerializedBlock,
} from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { getEnv } from '../infrastructure/envConfig';

class BlockchainService {
  private getDifficulty(): number {
    return getEnv().BLOCKCHAIN_POW_DIFFICULTY;
  }

  private mineBlock(
    index: number,
    previousHash: string,
    timestamp: string,
    payload: LedgerBlockPayload
  ): SerializedBlock {
    const prefix = '0'.repeat(this.getDifficulty());
    let nonce = 0;
    let hash = calculateBlockHash(index, previousHash, timestamp, payload, nonce);
    while (!hash.startsWith(prefix)) {
      nonce++;
      hash = calculateBlockHash(index, previousHash, timestamp, payload, nonce);
    }
    return { index, timestamp, previousHash, payload, nonce, hash };
  }

  public async ensureGenesis(): Promise<void> {
    const prisma = getPrisma();
    const existing = await prisma.blockchainBlock.findUnique({ where: { index: 0 } });
    if (existing) return;

    const chain = new LedgerChain(this.getDifficulty());
    const genesis = chain.getBlocks()[0];
    try {
      await prisma.blockchainBlock.create({
        data: {
          index: genesis.index,
          timestamp: genesis.timestamp,
          previousHash: genesis.previousHash,
          payloadJson: JSON.stringify(genesis.payload),
          nonce: genesis.nonce,
          hash: genesis.hash,
          recordId: genesis.payload.recordId,
          kind: genesis.payload.kind,
          accountMode: genesis.payload.accountMode,
          accountId: genesis.payload.accountId,
          userId: genesis.payload.userId,
        },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'P2002') throw err; // Another worker already created Genesis #0
    }
  }

  public async initialize(): Promise<ChainVerificationReport> {
    await this.ensureGenesis();
    return this.verifyFromDatabase();
  }

  /**
   * Concurrency-safe block append: reads latest persisted tip from DB, mines PoW,
   * and retries automatically on unique-index race (P2002) across workers/replicas.
   */
  public async appendAndPersist(payload: LedgerBlockPayload): Promise<SerializedBlock> {
    await this.ensureGenesis();
    const prisma = getPrisma();
    const maxAttempts = 12;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tip = await prisma.blockchainBlock.findFirst({
        orderBy: { index: 'desc' },
      });
      if (!tip) {
        await this.ensureGenesis();
        continue;
      }

      const timestamp = new Date().toISOString();
      const block = this.mineBlock(tip.index + 1, tip.hash, timestamp, payload);

      try {
        await prisma.blockchainBlock.create({
          data: {
            index: block.index,
            timestamp: block.timestamp,
            previousHash: block.previousHash,
            payloadJson: JSON.stringify(block.payload),
            nonce: block.nonce,
            hash: block.hash,
            recordId: block.payload.recordId,
            kind: block.payload.kind,
            accountMode: block.payload.accountMode,
            accountId: block.payload.accountId,
            userId: block.payload.userId,
          },
        });
        return block;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        const msg = (err as Error)?.message || '';
        const retryable = code === 'P2002' || msg.includes('SQLITE_BUSY') || msg.includes('database is locked');
        if (retryable && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 25 * attempt));
          continue;
        }
        throw err;
      }
    }

    throw new Error('Could not append blockchain record due to concurrent write contention.');
  }

  public async verifyFromDatabase(): Promise<ChainVerificationReport> {
    await this.ensureGenesis();
    const prisma = getPrisma();
    const persisted = await prisma.blockchainBlock.findMany({
      orderBy: { index: 'asc' },
    });
    const verifier = new LedgerChain(this.getDifficulty());
    const serialized: SerializedBlock[] = persisted.map((row) => ({
      index: row.index,
      timestamp: row.timestamp,
      previousHash: row.previousHash,
      payload: JSON.parse(row.payloadJson) as LedgerBlockPayload,
      nonce: row.nonce,
      hash: row.hash,
    }));
    return verifier.loadPersistedBlocks(serialized);
  }
}

export const blockchainService = new BlockchainService();
