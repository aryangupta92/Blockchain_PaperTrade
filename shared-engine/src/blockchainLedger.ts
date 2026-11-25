import crypto from 'crypto';
import { AccountMode } from './marketTypes';

export type LedgerBlockKind =
  | 'GENESIS'
  | 'TRADE_EXECUTION'
  | 'DEMO_BALANCE_RESET'
  | 'FUND_DEPOSIT'
  | 'FUND_WITHDRAWAL'
  | 'REGULATORY_CONFIG_APPROVAL';

export interface LedgerBlockPayload {
  recordId: string;
  kind: LedgerBlockKind;
  accountMode: AccountMode | 'SYSTEM';
  accountId: string;
  userId: string;
  symbol?: string;
  side?: string;
  quantity?: number;
  price?: string;
  totalCharges?: string;
  amountDelta?: string;
  metadata?: Record<string, unknown>;
}

export interface SerializedBlock {
  index: number;
  timestamp: string;
  previousHash: string;
  payload: LedgerBlockPayload;
  nonce: number;
  hash: string;
}

export interface ChainVerificationReport {
  valid: boolean;
  totalBlocks: number;
  invalidAtIndex: number | null;
  reason: string;
  genesisHash: string;
  latestHash: string;
  merkleRoot: string;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Deterministic key-sorted JSON serialization so hashes are 100% reproducible across restarts. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function calculateBlockHash(
  index: number,
  previousHash: string,
  timestamp: string,
  payload: LedgerBlockPayload,
  nonce: number
): string {
  const raw = `${index}|${previousHash}|${timestamp}|${canonicalJson(payload)}|${nonce}`;
  return sha256(raw);
}

/** Compute a SHA-256 Merkle Root over an ordered array of hex block hashes. */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return '0'.repeat(64);
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256(`${left}:${right}`));
    }
    level = next;
  }
  return level[0];
}

export class LedgerChain {
  private readonly difficulty: number;
  private blocks: SerializedBlock[];

  constructor(difficulty = 2) {
    this.difficulty = Math.max(1, Math.min(4, difficulty));
    this.blocks = [this.createGenesis()];
  }

  private createGenesis(): SerializedBlock {
    const payload: LedgerBlockPayload = {
      recordId: 'GENESIS-0',
      kind: 'GENESIS',
      accountMode: 'SYSTEM',
      accountId: 'SYSTEM',
      userId: 'SYSTEM',
      metadata: { message: 'Indian Broker Platform Immutable Audit Chain Genesis' },
    };
    return this.mineBlock(0, '0'.repeat(64), '2026-01-01T00:00:00.000Z', payload);
  }

  private mineBlock(
    index: number,
    previousHash: string,
    timestamp: string,
    payload: LedgerBlockPayload
  ): SerializedBlock {
    const prefix = '0'.repeat(this.difficulty);
    let nonce = 0;
    let hash = calculateBlockHash(index, previousHash, timestamp, payload, nonce);
    while (!hash.startsWith(prefix)) {
      nonce++;
      hash = calculateBlockHash(index, previousHash, timestamp, payload, nonce);
    }
    return { index, timestamp, previousHash, payload, nonce, hash };
  }

  public getBlocks(): SerializedBlock[] {
    return this.blocks.map((b) => ({ ...b, payload: { ...b.payload } }));
  }

  public getLatestBlock(): SerializedBlock {
    return this.blocks[this.blocks.length - 1];
  }

  public appendRecord(payload: LedgerBlockPayload, timestampIso = new Date().toISOString()): SerializedBlock {
    const prev = this.getLatestBlock();
    const block = this.mineBlock(this.blocks.length, prev.hash, timestampIso, payload);
    this.blocks.push(block);
    return block;
  }

  /** Rebuild chain deterministically from persisted DB blocks and validate every link. */
  public loadPersistedBlocks(persisted: SerializedBlock[]): ChainVerificationReport {
    const sorted = [...persisted].sort((a, b) => a.index - b.index);
    if (sorted.length === 0) {
      this.blocks = [this.createGenesis()];
      return this.verify();
    }
    if (sorted[0].index === 0) {
      this.blocks = sorted;
    } else {
      this.blocks = [this.createGenesis(), ...sorted];
    }
    return this.verify();
  }

  public verify(): ChainVerificationReport {
    const prefix = '0'.repeat(this.difficulty);
    const merkleRoot = computeMerkleRoot(this.blocks.map((b) => b.hash));
    const genesisHash = this.blocks[0]?.hash ?? '';
    const latestHash = this.getLatestBlock()?.hash ?? '';

    for (let i = 0; i < this.blocks.length; i++) {
      const cur = this.blocks[i];
      const expectedHash = calculateBlockHash(cur.index, cur.previousHash, cur.timestamp, cur.payload, cur.nonce);
      if (cur.hash !== expectedHash) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          invalidAtIndex: i,
          reason: `Hash mismatch at block #${i}`,
          genesisHash,
          latestHash,
          merkleRoot,
        };
      }
      if (!cur.hash.startsWith(prefix)) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          invalidAtIndex: i,
          reason: `Proof-of-work prefix invalid at block #${i}`,
          genesisHash,
          latestHash,
          merkleRoot,
        };
      }
      if (i > 0 && cur.previousHash !== this.blocks[i - 1].hash) {
        return {
          valid: false,
          totalBlocks: this.blocks.length,
          invalidAtIndex: i,
          reason: `Previous hash chain link broken at block #${i}`,
          genesisHash,
          latestHash,
          merkleRoot,
        };
      }
    }

    return {
      valid: true,
      totalBlocks: this.blocks.length,
      invalidAtIndex: null,
      reason: 'All blocks cryptographically verified and chain intact.',
      genesisHash,
      latestHash,
      merkleRoot,
    };
  }
}
