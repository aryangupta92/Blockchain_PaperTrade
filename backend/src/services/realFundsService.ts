import { D, Decimal, formatINR, roundPaise, ZERO } from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { blockchainService } from './blockchainAuditService';
import { formatAccount, getAccountByMode } from './accountService';
import { paymentGateway, PaymentRail } from './paymentGateway';

export class RealFundsError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(message: string, statusCode = 400, code = 'REAL_FUNDS_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function startOfIstDayUtc(now = new Date()): Date {
  const istMs = now.getTime() + 5.5 * 3600 * 1000;
  const istDate = new Date(istMs).toISOString().slice(0, 10);
  return new Date(`${istDate}T00:00:00.000+05:30`);
}

/**
 * Compute SEBI T+1 settlement-aware withdrawable balance for a REAL account:
 * - Free Cash = cashBalance - blockedMargin
 * - Same-day CNC delivery SELL proceeds are still in T+1 settlement and are NOT withdrawable today.
 */
export async function getRealFundingSummary(userId: string, now = new Date()) {
  const realAcc = await getAccountByMode(userId, 'REAL');
  const prisma = getPrisma();
  const dayStart = startOfIstDayUtc(now);

  const sameDayCncSells = await prisma.trade.findMany({
    where: {
      accountId: realAcc.id,
      epoch: realAcc.resetEpoch,
      product: 'CNC',
      side: 'SELL',
      executedAt: { gte: dayStart },
    },
    select: { turnover: true },
  });

  const unsettledT1Proceeds = sameDayCncSells.reduce((sum, t) => sum.plus(D(t.turnover)), ZERO);
  const cash = D(realAcc.cashBalance);
  const blocked = D(realAcc.blockedMargin);
  const freeCash = Decimal.max(ZERO, cash.minus(blocked));
  const withdrawable = Decimal.max(ZERO, freeCash.minus(unsettledT1Proceeds));

  return {
    account: formatAccount(realAcc),
    gateway: {
      name: paymentGateway.name,
      isMock: paymentGateway.isMock,
      supportedRails: ['UPI', 'NETBANKING'],
    },
    cashBalance: roundPaise(cash).toFixed(2),
    blockedMargin: roundPaise(blocked).toFixed(2),
    unsettledT1Proceeds: roundPaise(unsettledT1Proceeds).toFixed(2),
    withdrawableBalance: roundPaise(withdrawable).toFixed(2),
    settlementNote:
      'Under SEBI T+1 rolling settlement, same-day CNC delivery sale proceeds become withdrawable on T+1 after clearing settlement.',
  };
}

export async function depositRealFunds(input: {
  userId: string;
  amount: string | number;
  rail: PaymentRail;
  upiId?: string;
  bankCode?: string;
  ipAddress?: string;
}) {
  const amt = roundPaise(input.amount);
  if (!amt.isFinite() || amt.lt(100)) {
    throw new RealFundsError('Minimum REAL deposit is ₹100.00.', 400, 'MIN_DEPOSIT_100');
  }
  if (amt.gt(50_000_000)) {
    throw new RealFundsError('Single deposit exceeds configured gateway limit (₹5,00,00,000).', 400, 'MAX_DEPOSIT_EXCEEDED');
  }

  const realAcc = await getAccountByMode(input.userId, 'REAL');
  const receipt = await paymentGateway.initiateDeposit({
    userId: input.userId,
    amount: amt.toFixed(2),
    rail: input.rail,
    upiId: input.upiId,
    bankCode: input.bankCode,
  });

  if (receipt.status !== 'SUCCESS') {
    throw new RealFundsError('Payment gateway declined the deposit.', 402, 'PAYMENT_FAILED');
  }

  const prisma = getPrisma();
  const res = await prisma.$transaction(async (tx) => {
    const fresh = await tx.tradingAccount.findUniqueOrThrow({ where: { id: realAcc.id } });
    const nextCash = roundPaise(D(fresh.cashBalance).plus(amt));

    const updatedAccount = await tx.tradingAccount.update({
      where: { id: realAcc.id },
      data: { cashBalance: nextCash.toFixed(2) },
    });

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        accountId: realAcc.id,
        epoch: realAcc.resetEpoch,
        entryType: 'DEPOSIT',
        debit: '0.00',
        credit: amt.toFixed(2),
        runningBalance: nextCash.toFixed(2),
        referenceId: receipt.utr,
        description: `REAL funds deposit via ${input.rail} (${formatINR(amt)}) • Ref ${receipt.utr}`,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'REAL_FUND_DEPOSIT',
        entity: 'TradingAccount',
        entityId: realAcc.id,
        details: JSON.stringify({ amount: amt.toFixed(2), rail: input.rail, utr: receipt.utr }),
        ipAddress: input.ipAddress,
      },
    });

    return { updatedAccount, ledgerEntry };
  });

  const block = await blockchainService.appendAndPersist({
    recordId: res.ledgerEntry.id,
    kind: 'FUND_DEPOSIT',
    accountMode: 'REAL',
    accountId: realAcc.id,
    userId: input.userId,
    amountDelta: amt.toFixed(2),
    metadata: { rail: input.rail, utr: receipt.utr, mockGateway: paymentGateway.isMock },
  });

  return {
    account: formatAccount(res.updatedAccount),
    receipt,
    ledgerEntry: res.ledgerEntry,
    blockchainProof: {
      blockIndex: block.index,
      hash: block.hash,
      previousHash: block.previousHash,
      nonce: block.nonce,
    },
  };
}

export async function withdrawRealFunds(input: {
  userId: string;
  amount: string | number;
  bankAccountMasked: string;
  ifsc: string;
  ipAddress?: string;
  now?: Date;
}) {
  const amt = roundPaise(input.amount);
  if (!amt.isFinite() || amt.lt(100)) {
    throw new RealFundsError('Minimum withdrawal is ₹100.00.', 400, 'MIN_WITHDRAWAL_100');
  }

  const summary = await getRealFundingSummary(input.userId, input.now);
  const withdrawable = D(summary.withdrawableBalance);

  if (amt.gt(withdrawable)) {
    throw new RealFundsError(
      `Withdrawal ${formatINR(amt)} exceeds settled withdrawable balance ${formatINR(withdrawable)} (Blocked margin: ${formatINR(summary.blockedMargin)}, Unsettled T+1 sell proceeds: ${formatINR(summary.unsettledT1Proceeds)}).`,
      422,
      'WITHDRAWAL_EXCEEDS_SETTLED_BALANCE'
    );
  }

  const realAcc = await getAccountByMode(input.userId, 'REAL');
  const receipt = await paymentGateway.initiateWithdrawal({
    userId: input.userId,
    amount: amt.toFixed(2),
    bankAccountMasked: input.bankAccountMasked,
    ifsc: input.ifsc,
  });

  const prisma = getPrisma();
  const res = await prisma.$transaction(async (tx) => {
    const fresh = await tx.tradingAccount.findUniqueOrThrow({ where: { id: realAcc.id } });
    const nextCash = roundPaise(D(fresh.cashBalance).minus(amt));
    if (nextCash.lt(0)) {
      throw new RealFundsError('Insufficient balance.', 422, 'INSUFFICIENT_BALANCE');
    }

    const updatedAccount = await tx.tradingAccount.update({
      where: { id: realAcc.id },
      data: { cashBalance: nextCash.toFixed(2) },
    });

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        accountId: realAcc.id,
        epoch: realAcc.resetEpoch,
        entryType: 'WITHDRAWAL',
        debit: amt.toFixed(2),
        credit: '0.00',
        runningBalance: nextCash.toFixed(2),
        referenceId: receipt.payoutRef,
        description: `REAL funds withdrawal (${formatINR(amt)}) to ${input.bankAccountMasked} • Ref ${receipt.payoutRef}`,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'REAL_FUND_WITHDRAWAL',
        entity: 'TradingAccount',
        entityId: realAcc.id,
        details: JSON.stringify({ amount: amt.toFixed(2), payoutRef: receipt.payoutRef }),
        ipAddress: input.ipAddress,
      },
    });

    return { updatedAccount, ledgerEntry };
  });

  const block = await blockchainService.appendAndPersist({
    recordId: res.ledgerEntry.id,
    kind: 'FUND_WITHDRAWAL',
    accountMode: 'REAL',
    accountId: realAcc.id,
    userId: input.userId,
    amountDelta: amt.neg().toFixed(2),
    metadata: { payoutRef: receipt.payoutRef, bankAccountMasked: input.bankAccountMasked },
  });

  return {
    account: formatAccount(res.updatedAccount),
    receipt,
    ledgerEntry: res.ledgerEntry,
    blockchainProof: {
      blockIndex: block.index,
      hash: block.hash,
      previousHash: block.previousHash,
      nonce: block.nonce,
    },
  };
}
