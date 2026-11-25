import { getPrisma } from '../infrastructure/database';
import { getAccountByMode } from './accountService';
import { getPortfolioHoldings, getPortfolioPositions } from './trading-oms/portfolioService';
import { getRealFundingSummary } from './realFundsService';
import { cancelOrder, modifyOrder, placeOrder, PlaceOrderInput, previewOrder } from './trading-oms/orderManagementService';

export interface RealBrokerComplianceChecklist {
  adapterMode: 'MOCK_REAL_ADAPTER' | 'LIVE_SEBI_BROKER';
  goingLiveReady: boolean;
  mandatoryPrerequisites: Array<{
    requirement: string;
    status: 'PENDING_LICENSING' | 'CONFIGURED';
    details: string;
  }>;
}

/**
 * Pluggable REAL Broker Adapter Interface (Section 3).
 * Implement this interface when partnering with a SEBI-registered Stock Broker.
 */
export interface RealBrokerAdapter {
  readonly adapterName: string;
  readonly isMock: boolean;
  getComplianceStatus(): RealBrokerComplianceChecklist;
  placeOrder(input: Omit<PlaceOrderInput, 'accountMode'>): Promise<unknown>;
  modifyOrder(params: { userId: string; orderId: string; quantity?: number; price?: string | number; triggerPrice?: string | number }): Promise<unknown>;
  cancelOrder(userId: string, orderId: string): Promise<unknown>;
  getOrderBook(userId: string): Promise<unknown>;
  getTradeBook(userId: string): Promise<unknown>;
  getPositions(userId: string): Promise<unknown>;
  getHoldings(userId: string): Promise<unknown>;
  getFunds(userId: string): Promise<unknown>;
  calculateMargin(input: Omit<PlaceOrderInput, 'accountMode'>): Promise<unknown>;
}

/**
 * MockRealBrokerAdapter — runs REAL accounts through the exact same SEBI risk, margin,
 * charges, double-entry ledger, and blockchain audit pipeline locally without routing to exchanges.
 */
export class MockRealBrokerAdapter implements RealBrokerAdapter {
  public readonly adapterName = 'Pluggable Real Broker Adapter (Mock Mode)';
  public readonly isMock = true;

  public getComplianceStatus(): RealBrokerComplianceChecklist {
    return {
      adapterMode: 'MOCK_REAL_ADAPTER',
      goingLiveReady: false,
      mandatoryPrerequisites: [
        {
          requirement: 'SEBI Stock Broker Registration & Exchange Membership (NSE / BSE / MCX)',
          status: 'PENDING_LICENSING',
          details: 'Requires SEBI registration or authorized execution partnership with a SEBI-registered Stock Broker.',
        },
        {
          requirement: 'Clearing Corporation & Peak-Margin Reporting (NCL / ICCL / MCXCCL)',
          status: 'PENDING_LICENSING',
          details: 'Required for live upfront/peak margin uploads and T+1 / expiry settlement.',
        },
        {
          requirement: 'Depository Participant (CDSL / NSDL) + eDIS / DDPI',
          status: 'PENDING_LICENSING',
          details: 'Required for real CNC demat custody and delivery debits.',
        },
        {
          requirement: 'CKYC / KRA / PMLA AML Onboarding & Client-Segregated Bank Accounts',
          status: 'PENDING_LICENSING',
          details: 'Mandatory before accepting real client funds or transmitting live orders.',
        },
        {
          requirement: 'Exchange Market-Data Redistribution License',
          status: 'PENDING_LICENSING',
          details: 'Required before distributing live exchange feeds to multiple public retail users.',
        },
        {
          requirement: 'Commercial Charting Library License (TradingView Advanced Charts)',
          status: 'PENDING_LICENSING',
          details: 'Currently using open-source TradingView Lightweight Charts (Apache 2.0) behind swappable ChartProvider.',
        },
      ],
    };
  }

  public placeOrder(input: Omit<PlaceOrderInput, 'accountMode'>) {
    return placeOrder({ ...input, accountMode: 'REAL' });
  }

  public modifyOrder(params: { userId: string; orderId: string; quantity?: number; price?: string | number; triggerPrice?: string | number }) {
    return modifyOrder(params);
  }

  public cancelOrder(userId: string, orderId: string) {
    return cancelOrder(userId, orderId);
  }

  public async getOrderBook(userId: string) {
    const acc = await getAccountByMode(userId, 'REAL');
    return getPrisma().order.findMany({
      where: { accountId: acc.id, epoch: acc.resetEpoch },
      include: { instrument: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async getTradeBook(userId: string) {
    const acc = await getAccountByMode(userId, 'REAL');
    return getPrisma().trade.findMany({
      where: { accountId: acc.id, epoch: acc.resetEpoch },
      include: { instrument: true, chargeBreakdown: true },
      orderBy: { executedAt: 'desc' },
    });
  }

  public getPositions(userId: string) {
    return getPortfolioPositions(userId, 'REAL');
  }

  public getHoldings(userId: string) {
    return getPortfolioHoldings(userId, 'REAL');
  }

  public getFunds(userId: string) {
    return getRealFundingSummary(userId);
  }

  public calculateMargin(input: Omit<PlaceOrderInput, 'accountMode'>) {
    return previewOrder({ ...input, accountMode: 'REAL' });
  }
}

export const realBrokerAdapter: RealBrokerAdapter = new MockRealBrokerAdapter();
