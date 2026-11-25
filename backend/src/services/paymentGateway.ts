import crypto from 'crypto';

export type PaymentRail = 'UPI' | 'NETBANKING';

export interface DepositRequest {
  userId: string;
  amount: string; // Decimal string in INR
  rail: PaymentRail;
  upiId?: string;
  bankCode?: string;
}

export interface DepositReceipt {
  gateway: string;
  status: 'SUCCESS' | 'FAILED';
  utr: string;
  rail: PaymentRail;
  amount: string;
  processedAt: string;
  note: string;
}

export interface WithdrawalRequest {
  userId: string;
  amount: string;
  bankAccountMasked: string;
  ifsc: string;
}

export interface WithdrawalReceipt {
  gateway: string;
  status: 'INITIATED' | 'FAILED';
  payoutRef: string;
  amount: string;
  bankAccountMasked: string;
  processedAt: string;
  note: string;
}

export interface PaymentGatewayAdapter {
  readonly name: string;
  readonly isMock: boolean;
  initiateDeposit(req: DepositRequest): Promise<DepositReceipt>;
  initiateWithdrawal(req: WithdrawalRequest): Promise<WithdrawalReceipt>;
}

/**
 * Mock Payment Gateway (UPI / NetBanking) for local & staging development.
 * Live production REAL funding requires SEBI-compliant client-segregated bank accounts
 * and a regulated Indian payment aggregator (e.g., NPCI UPI / Razorpay / Cashfree / BSE StAR).
 */
export class MockPaymentGatewayAdapter implements PaymentGatewayAdapter {
  public readonly name = 'Mock Indian Payment Gateway (UPI / NetBanking)';
  public readonly isMock = true;

  public async initiateDeposit(req: DepositRequest): Promise<DepositReceipt> {
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return {
      gateway: this.name,
      status: 'SUCCESS',
      utr: `MOCK${req.rail === 'UPI' ? 'UPI' : 'NB'}${Date.now().toString().slice(-6)}${suffix}`,
      rail: req.rail,
      amount: req.amount,
      processedAt: new Date().toISOString(),
      note: 'Simulated payment receipt (Mock Gateway — no real bank debit occurred).',
    };
  }

  public async initiateWithdrawal(req: WithdrawalRequest): Promise<WithdrawalReceipt> {
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return {
      gateway: this.name,
      status: 'INITIATED',
      payoutRef: `MOCKPO${Date.now().toString().slice(-6)}${suffix}`,
      amount: req.amount,
      bankAccountMasked: req.bankAccountMasked,
      processedAt: new Date().toISOString(),
      note: 'Simulated IMPS/NEFT bank payout (Mock Gateway).',
    };
  }
}

export const paymentGateway: PaymentGatewayAdapter = new MockPaymentGatewayAdapter();
