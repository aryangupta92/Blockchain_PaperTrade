import { describe, it, expect } from 'vitest';
import { LedgerChain, computeMerkleRoot } from '../blockchainLedger';

describe('Blockchain Trade & Ledger Verification Chain', () => {
  it('mines deterministic genesis and verifies appended DEMO & REAL records', () => {
    const chain = new LedgerChain(2);

    const b1 = chain.appendRecord(
      {
        recordId: 'demo-reset-1',
        kind: 'DEMO_BALANCE_RESET',
        accountMode: 'DEMO',
        accountId: 'acc-demo-1',
        userId: 'usr-1',
        amountDelta: '200000.00',
      },
      '2026-05-01T09:00:00.000Z'
    );

    const b2 = chain.appendRecord(
      {
        recordId: 'trade-1',
        kind: 'TRADE_EXECUTION',
        accountMode: 'DEMO',
        accountId: 'acc-demo-1',
        userId: 'usr-1',
        symbol: 'RELIANCE',
        side: 'BUY',
        quantity: 10,
        price: '2850.00',
        totalCharges: '33.80',
      },
      '2026-05-01T09:16:00.000Z'
    );

    expect(b1.hash.startsWith('00')).toBe(true);
    expect(b2.previousHash).toBe(b1.hash);

    const report = chain.verify();
    expect(report.valid).toBe(true);
    expect(report.totalBlocks).toBe(3);
    expect(report.merkleRoot).toBe(computeMerkleRoot(chain.getBlocks().map((b) => b.hash)));
  });

  it('detects tampering when persisted payload or hash is altered', () => {
    const chain = new LedgerChain(2);
    chain.appendRecord(
      {
        recordId: 'trade-real-1',
        kind: 'TRADE_EXECUTION',
        accountMode: 'REAL',
        accountId: 'acc-real-1',
        userId: 'usr-1',
        symbol: 'TCS',
        side: 'SELL',
        quantity: 5,
        price: '4100.00',
      },
      '2026-05-01T10:00:00.000Z'
    );

    const blocks = chain.getBlocks();
    // Tamper with price on block #1
    blocks[1].payload.price = '4999.00';

    const verifier = new LedgerChain(2);
    const report = verifier.loadPersistedBlocks(blocks);

    expect(report.valid).toBe(false);
    expect(report.invalidAtIndex).toBe(1);
    expect(report.reason).toContain('Hash mismatch');
  });
});
