import {
  AccountMode,
  D,
  roundPaise,
  validateDemoBalanceRange,
  formatINR,
} from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { blockchainService } from './blockchainAuditService';

export class AccountError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(message: string, statusCode = 400, code = 'ACCOUNT_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function formatAccount(acc: {
  id: string;
  userId: string;
  mode: string;
  cashBalance: string;
  blockedMargin: string;
  collateralMargin?: string;
  resetEpoch: number;
  killSwitchOn: boolean;
  lockedSegmentsJson?: string;
  maxDailyLoss: string | null;
  dailyProfitTarget?: string | null;
  enableAutoPnlExit?: boolean;
  pnlExitKillSwitch?: boolean;
  maxOrderValue: string | null;
  maxOpenOrders: number;
  maxTradesPerDay?: number | null;
  lossStreakLimit?: number | null;
  cooldownMinutes?: number;
  cooldownUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const cash = D(acc.cashBalance);
  const blocked = D(acc.blockedMargin);
  const collateral = D(acc.collateralMargin || '0.00');
  // SEBI 50:50 Cash-to-Collateral rule: usable collateral is capped at available cash when trading derivatives
  const effectiveCollateral = cash.gt(0) ? (collateral.lte(cash) ? collateral : cash) : D(0);
  const available = roundPaise(cash.plus(effectiveCollateral).minus(blocked));
  let lockedSegments: string[] = [];
  try {
    const parsed = JSON.parse(acc.lockedSegmentsJson || '[]');
    if (Array.isArray(parsed)) lockedSegments = parsed;
  } catch {
    lockedSegments = [];
  }
  return {
    id: acc.id,
    mode: acc.mode as AccountMode,
    cashBalance: roundPaise(cash).toFixed(2),
    blockedMargin: roundPaise(blocked).toFixed(2),
    collateralMargin: roundPaise(collateral).toFixed(2),
    availableMargin: available.toFixed(2),
    resetEpoch: acc.resetEpoch,
    killSwitchOn: acc.killSwitchOn,
    lockedSegments,
    maxDailyLoss: acc.maxDailyLoss,
    dailyProfitTarget: acc.dailyProfitTarget ?? null,
    enableAutoPnlExit: Boolean(acc.enableAutoPnlExit),
    pnlExitKillSwitch: Boolean(acc.pnlExitKillSwitch),
    maxOrderValue: acc.maxOrderValue,
    maxOpenOrders: acc.maxOpenOrders,
    maxTradesPerDay: acc.maxTradesPerDay ?? null,
    lossStreakLimit: acc.lossStreakLimit ?? null,
    cooldownMinutes: acc.cooldownMinutes ?? 30,
    cooldownUntil: acc.cooldownUntil ? acc.cooldownUntil.toISOString() : null,
    updatedAt: acc.updatedAt.toISOString(),
  };
}

export async function getUserAccounts(userId: string) {
  const prisma = getPrisma();
  const accounts = await prisma.tradingAccount.findMany({
    where: { userId },
    orderBy: { mode: 'asc' },
  });
  return accounts.map(formatAccount);
}

export async function getAccountByMode(userId: string, mode: AccountMode) {
  const prisma = getPrisma();
  const acc = await prisma.tradingAccount.findUnique({
    where: { userId_mode: { userId, mode } },
  });
  if (!acc) throw new AccountError(`${mode} account not found.`, 404, 'ACCOUNT_NOT_FOUND');
  return acc;
}

/**
 * Set or reset DEMO virtual balance (strictly ₹1,000 to ₹1,00,00,000).
 * - Preserves archived epoch history on reset.
 * - Clears active positions/holdings & cancels pending orders in the outgoing epoch.
 * - Records double-entry LedgerEntry AND cryptographically seals a BlockchainBlock.
 */
export async function setOrResetDemoBalance(input: {
  userId: string;
  amount: string | number;
  ipAddress?: string;
}) {
  const validation = validateDemoBalanceRange(input.amount);
  if (!validation.valid || !validation.value) {
    throw new AccountError(validation.error || 'Invalid DEMO balance amount.', 400, 'DEMO_BALANCE_OUT_OF_RANGE');
  }
  const targetAmountStr = validation.value.toFixed(2);
  const prisma = getPrisma();

  const demo = await getAccountByMode(input.userId, 'DEMO');

  // Determine whether this is an initial set (zero balance & no activity in current epoch) or a full reset
  const [tradeCount, openOrderCount, ledgerCount] = await Promise.all([
    prisma.trade.count({ where: { accountId: demo.id, epoch: demo.resetEpoch } }),
    prisma.order.count({
      where: {
        accountId: demo.id,
        epoch: demo.resetEpoch,
        status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING', 'PARTIALLY_FILLED'] },
      },
    }),
    prisma.ledgerEntry.count({ where: { accountId: demo.id, epoch: demo.resetEpoch } }),
  ]);

  const isFirstInit = D(demo.cashBalance).isZero() && tradeCount === 0 && openOrderCount === 0 && ledgerCount === 0;

  const result = await prisma.$transaction(async (tx) => {
    let newEpoch = demo.resetEpoch;
    let archivedRecord = null;

    if (!isFirstInit) {
      // Compute starting balance of outgoing epoch from its first ledger entry
      const firstEntry = await tx.ledgerEntry.findFirst({
        where: { accountId: demo.id, epoch: demo.resetEpoch },
        orderBy: { createdAt: 'asc' },
      });
      const startingBal = firstEntry ? firstEntry.runningBalance : demo.cashBalance;

      // Aggregate realized PnL from positions in outgoing epoch
      const positions = await tx.position.findMany({
        where: { accountId: demo.id, epoch: demo.resetEpoch },
      });
      const totalRealized = positions.reduce((acc, p) => acc.plus(D(p.realizedPnl)), D(0));

      archivedRecord = await tx.demoResetArchive.create({
        data: {
          accountId: demo.id,
          epoch: demo.resetEpoch,
          startingBalance: roundPaise(startingBal).toFixed(2),
          endingCashBalance: roundPaise(demo.cashBalance).toFixed(2),
          realizedPnl: roundPaise(totalRealized).toFixed(2),
          totalTrades: tradeCount,
        },
      });

      // Cancel any open/pending DEMO orders in outgoing epoch
      await tx.order.updateMany({
        where: {
          accountId: demo.id,
          epoch: demo.resetEpoch,
          status: { in: ['PENDING', 'OPEN', 'TRIGGER_PENDING', 'PARTIALLY_FILLED'] },
        },
        data: {
          status: 'CANCELLED',
          rejectionReason: 'Cancelled due to DEMO account reset',
        },
      });

      newEpoch = demo.resetEpoch + 1;
    }

    const updatedAccount = await tx.tradingAccount.update({
      where: { id: demo.id },
      data: {
        cashBalance: targetAmountStr,
        blockedMargin: '0.00',
        resetEpoch: newEpoch,
      },
    });

    const entryType = isFirstInit ? 'DEMO_SET' : 'DEMO_RESET';
    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        accountId: demo.id,
        epoch: newEpoch,
        entryType,
        debit: '0.00',
        credit: targetAmountStr,
        runningBalance: targetAmountStr,
        description: isFirstInit
          ? `Initial DEMO virtual balance set to ${formatINR(targetAmountStr)}`
          : `DEMO account reset (Epoch #${newEpoch}) with virtual balance ${formatINR(targetAmountStr)}`,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: entryType,
        entity: 'TradingAccount',
        entityId: demo.id,
        details: JSON.stringify({
          previousBalance: demo.cashBalance,
          newBalance: targetAmountStr,
          epoch: newEpoch,
          archivedEpoch: archivedRecord?.epoch ?? null,
        }),
        ipAddress: input.ipAddress,
      },
    });

    return { updatedAccount, ledgerEntry, archivedRecord };
  });

  // Cryptographically seal the DEMO balance set/reset into the SHA-256 Blockchain Audit Chain
  const block = await blockchainService.appendAndPersist({
    recordId: result.ledgerEntry.id,
    kind: 'DEMO_BALANCE_RESET',
    accountMode: 'DEMO',
    accountId: demo.id,
    userId: input.userId,
    amountDelta: targetAmountStr,
    metadata: {
      entryType: result.ledgerEntry.entryType,
      epoch: result.updatedAccount.resetEpoch,
      archivedEpoch: result.archivedRecord?.epoch ?? null,
    },
  });

  return {
    account: formatAccount(result.updatedAccount),
    ledgerEntry: result.ledgerEntry,
    archivedEpoch: result.archivedRecord,
    blockchainProof: {
      blockIndex: block.index,
      hash: block.hash,
      previousHash: block.previousHash,
      nonce: block.nonce,
      timestamp: block.timestamp,
    },
  };
}

export async function getAccountLedger(input: {
  userId: string;
  mode: AccountMode;
  epoch?: number;
  limit?: number;
  offset?: number;
}) {
  const acc = await getAccountByMode(input.userId, input.mode);
  const prisma = getPrisma();
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
  const offset = Math.max(0, input.offset ?? 0);

  const where = {
    accountId: acc.id,
    ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.ledgerEntry.count({ where }),
  ]);

  return {
    account: formatAccount(acc),
    entries,
    total,
    limit,
    offset,
  };
}

export async function getDemoResetArchives(userId: string) {
  const demo = await getAccountByMode(userId, 'DEMO');
  const prisma = getPrisma();
  const archives = await prisma.demoResetArchive.findMany({
    where: { accountId: demo.id },
    orderBy: { epoch: 'desc' },
  });
  return {
    accountId: demo.id,
    currentEpoch: demo.resetEpoch,
    archives,
  };
}
