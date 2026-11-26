export type AccountMode = 'DEMO' | 'REAL';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: string;
  totpEnabled: boolean;
  kycStatus: string;
  sebiRiskAckAt: string | null;
  createdAt: string;
}

export interface TradingAccountDTO {
  id: string;
  mode: AccountMode;
  cashBalance: string;
  blockedMargin: string;
  collateralMargin?: string;
  availableMargin: string;
  resetEpoch: number;
  killSwitchOn: boolean;
  lockedSegments?: string[];
  maxDailyLoss: string | null;
  dailyProfitTarget?: string | null;
  enableAutoPnlExit?: boolean;
  pnlExitKillSwitch?: boolean;
  maxOrderValue: string | null;
  maxOpenOrders: number;
  maxTradesPerDay?: number | null;
  lossStreakLimit?: number | null;
  cooldownMinutes?: number;
  cooldownUntil?: string | null;
  updatedAt: string;
}

export interface LedgerEntryDTO {
  id: string;
  accountId: string;
  epoch: number;
  entryType: string;
  debit: string;
  credit: string;
  runningBalance: string;
  description: string;
  createdAt: string;
}

export interface DemoArchiveDTO {
  id: string;
  epoch: number;
  startingBalance: string;
  endingCashBalance: string;
  realizedPnl: string;
  totalTrades: number;
  archivedAt: string;
}

export interface BlockchainBlockDTO {
  index: number;
  timestamp: string;
  previousHash: string;
  hash: string;
  nonce: number;
  kind: string;
  accountMode: string;
  recordId: string;
  evmTxHash: string | null;
  payload: Record<string, unknown>;
}

export interface ChainVerificationDTO {
  valid: boolean;
  totalBlocks: number;
  invalidAtIndex: number | null;
  reason: string;
  genesisHash: string;
  latestHash: string;
  merkleRoot: string;
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function formatINR(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '₹0.00';
  const neg = num < 0;
  const absStr = Math.abs(num).toFixed(2);
  const [intPart, decPart] = absStr.split('.');
  let formattedInt = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    formattedInt = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}₹${formattedInt}.${decPart}`;
}

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export const API_V1_BASE = RAW_API_BASE
  ? RAW_API_BASE.endsWith('/api/v1')
    ? RAW_API_BASE
    : `${RAW_API_BASE}/api/v1`
  : '/api/v1';

/**
 * Resolves the multiplexed market-data WebSocket endpoint from VITE_WS_URL,
 * VITE_API_BASE_URL, or the active window origin in local dev.
 */
export function getMarketWsUrl(): string {
  const explicitWs = (import.meta.env.VITE_WS_URL ?? '').trim().replace(/\/+$/, '');
  if (explicitWs) {
    return explicitWs.endsWith('/ws/market') ? explicitWs : `${explicitWs}/ws/market`;
  }
  if (RAW_API_BASE) {
    try {
      const parsed = new URL(RAW_API_BASE);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}/ws/market`;
    } catch {
      // Fall through to current host
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/market`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${API_V1_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & { code?: string };
    err.code = data.code;
    throw err;
  }
  if (!isJson) {
    throw new Error('Backend API is not configured or unreachable. Set VITE_API_BASE_URL in Vercel Environment Variables.');
  }
  return data as T;
}

export const api = {
  health: () => request<{
    status: string;
    phase: number;
    database: string;
    cache: string;
    marketData: {
      source: string;
      credentialsConfigured: boolean;
      sessionActive: boolean;
      fallbackSourcesRemoved: boolean;
    };
    blockchain: { valid: boolean; totalBlocks: number; merkleRoot: string };
  }>('/health'),

  regulatoryConfig: () => request<Record<string, unknown>>('/config/regulatory'),

  register: (payload: {
    email: string;
    fullName: string;
    password: string;
    acceptSebiRiskDisclosure: boolean;
  }) =>
    request<{ user: UserProfile; accounts: TradingAccountDTO[]; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string; totpCode?: string }) =>
    request<{ user: UserProfile; accounts: TradingAccountDTO[]; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  refresh: () =>
    request<{ user: UserProfile; accounts: TradingAccountDTO[]; accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),

  me: () => request<{ user: UserProfile; accounts: TradingAccountDTO[] }>('/auth/me'),

  totpSetup: () =>
    request<{ secret: string; otpauthUri: string; message: string }>('/auth/totp/setup', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  totpEnable: (code: string) =>
    request<{ totpEnabled: boolean }>('/auth/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  accounts: () => request<{ accounts: TradingAccountDTO[] }>('/accounts'),

  setDemoBalance: (amount: string | number) =>
    request<{
      account: TradingAccountDTO;
      ledgerEntry: LedgerEntryDTO;
      archivedEpoch: DemoArchiveDTO | null;
      blockchainProof: { blockIndex: number; hash: string; previousHash: string; nonce: number; timestamp: string };
    }>('/accounts/demo/balance', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),

  demoArchives: () =>
    request<{ accountId: string; currentEpoch: number; archives: DemoArchiveDTO[] }>('/accounts/demo/archives'),

  ledger: (mode: AccountMode) =>
    request<{ account: TradingAccountDTO; entries: LedgerEntryDTO[]; total: number }>(`/accounts/${mode}/ledger`),

  blockchainBlocks: (mode: 'ALL' | 'DEMO' | 'REAL' = 'ALL') =>
    request<{ verification: ChainVerificationDTO; blocks: BlockchainBlockDTO[] }>(
      `/blockchain/blocks?mode=${mode}&limit=100`
    ),

  verifyBlockHash: (hash: string) =>
    request<{
      verified: boolean;
      hashMatches: boolean;
      previousLinkValid: boolean;
      block: BlockchainBlockDTO & { recalculatedHash: string };
    }>(`/blockchain/blocks/${encodeURIComponent(hash)}`),

  marketStatus: () =>
    request<{
      connected: boolean;
      authenticated: boolean;
      dataSubscriptionActive: boolean | null;
      dataSubscriptionExpiry: string | null;
      instrumentCount: number;
      freshness: string;
      session: {
        istTime: string;
        equityAndFno: { phase: string; isTradable: boolean; hoursIST: string };
        commoditiesMcx: { phase: string; isTradable: boolean; hoursIST: string };
        holidayName: string | null;
      };
    }>('/market/status'),

  searchInstruments: (params: { q?: string; segment?: string; exchange?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.segment) qs.set('segment', params.segment);
    if (params.exchange) qs.set('exchange', params.exchange);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      count: number;
      instruments: Array<{
        instrumentId: string;
        exchange: string;
        segment: string;
        instrumentKind: string;
        symbol: string;
        tradingSymbol: string;
        displayName: string;
        lotSize: number;
        tickSize: string;
        expiryDate: string | null;
        strikePrice: string | null;
        optionType: string | null;
      }>;
    }>(`/market/instruments/search?${qs.toString()}`);
  },

  quotes: (symbols: string[]) =>
    request<{
      count: number;
      quotes: Array<{
        instrumentId: string;
        symbol: string;
        exchange: string;
        segment: string;
        ltp: string | null;
        prevClose: string | null;
        open: string | null;
        high: string | null;
        low: string | null;
        change: string | null;
        changePercent: string | null;
        volume: number | null;
        vwap: string | null;
        openInterest: number | null;
        upperCircuit?: string | null;
        lowerCircuit?: string | null;
        week52High?: string | null;
        week52Low?: string | null;
        totalBuyQty?: number | null;
        totalSellQty?: number | null;
        bidDepth: Array<{ price: string; quantity: number; orders: number }>;
        askDepth: Array<{ price: string; quantity: number; orders: number }>;
        freshness: string;
        timestamp: string;
      }>;
    }>(`/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),

  refreshInstruments: () =>
    request<{ count: number; updatedAt: string }>('/market/instruments/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  previewOrder: (payload: Record<string, unknown>) =>
    request<{
      symbol: string;
      exchange: string;
      segment: string;
      ltp: string | null;
      lotSize: number;
      tickSize: string;
      risk: {
        allowed: boolean;
        violations: Array<{ code: string; message: string }>;
        warnings: string[];
        requiredMargin: string;
        totalCashNeeded: string;
        availableMargin: string;
        effectiveLeverage: string;
        varElmPctUsed: string;
        estimatedCharges: {
          turnover: string;
          brokerage: string;
          sttOrCtt: string;
          exchangeTransactionCharge: string;
          sebiTurnoverFee: string;
          stampDuty: string;
          dpChargeExclGst: string;
          gst: string;
          totalCharges: string;
          educationalNote: string;
        };
      };
    }>('/orders/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  placeOrder: (payload: Record<string, unknown>) =>
    request<{
      order: { id: string; status: string };
      trade: { id: string; price: string; blockchainHash: string | null } | null;
      blockchainProof: { blockIndex: number; hash: string } | null;
      warnings?: string[];
    }>('/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  orders: (mode: AccountMode) =>
    request<{
      orders: Array<{
        id: string;
        side: string;
        product: string;
        orderType: string;
        validity: string;
        isAmo: boolean;
        quantity: number;
        filledQuantity: number;
        price: string | null;
        triggerPrice: string | null;
        stopLoss?: string | null;
        target?: string | null;
        trailingJump?: string | null;
        parentOrderId?: string | null;
        legRole?: string | null;
        ocoGroupId?: string | null;
        status: string;
        rejectionReason: string | null;
        createdAt: string;
        instrument: { symbol: string; displayName: string; exchange: string; segment: string };
      }>;
    }>(`/orders?mode=${mode}`),

  modifyOrder: (
    orderId: string,
    payload: {
      quantity?: number;
      price?: string | number | null;
      triggerPrice?: string | number | null;
      stopLoss?: string | number | null;
      target?: string | number | null;
      trailingJump?: string | number | null;
    }
  ) =>
    request<{ id: string; status: string; price: string | null; triggerPrice: string | null }>(
      `/orders/${encodeURIComponent(orderId)}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),

  cancelOrder: (orderId: string) =>
    request<unknown>(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }),

  trades: (mode: AccountMode) =>
    request<{
      trades: Array<{
        id: string;
        side: string;
        product: string;
        quantity: number;
        price: string;
        turnover: string;
        executedAt: string;
        blockchainHash: string | null;
        instrument: { symbol: string; exchange: string; segment: string };
        chargeBreakdown: {
          brokerage: string;
          sttOrCtt: string;
          exchangeTransactionCharge: string;
          sebiTurnoverFee: string;
          stampDuty: string;
          dpChargeExclGst: string;
          gst: string;
          totalCharges: string;
        } | null;
      }>;
    }>(`/orders/trades?mode=${mode}`),

  positions: (mode: AccountMode) =>
    request<{
      account: TradingAccountDTO;
      positions: Array<{
        id: string;
        symbol: string;
        displayName: string;
        exchange: string;
        segment: string;
        product: string;
        netQuantity: number;
        avgBuyPrice: string;
        avgSellPrice: string;
        ltp: string;
        unrealizedPnl: string;
        realizedPnl: string;
        netPnl: string;
        blockedMargin: string;
      }>;
      summary: {
        openCount: number;
        totalUnrealizedPnl: string;
        totalRealizedPnl: string;
        totalNetPnl: string;
      };
    }>(`/portfolio/${mode}/positions`),

  holdings: (mode: AccountMode) =>
    request<{
      account: TradingAccountDTO;
      holdings: Array<{
        id: string;
        symbol: string;
        displayName: string;
        exchange: string;
        segment: string;
        settledQty: number;
        t1Qty: number;
        pledgedQty?: number;
        totalQty: number;
        avgCost: string;
        ltp: string;
        investedValue: string;
        currentValue: string;
        unrealizedPnl: string;
        unrealizedPnlPct: string;
      }>;
      summary: {
        count: number;
        totalInvested: string;
        totalCurrentValue: string;
        totalUnrealizedPnl: string;
        totalUnrealizedPnlPct: string;
      };
    }>(`/portfolio/${mode}/holdings`),

  squareOffPosition: (mode: AccountMode, payload: { symbol: string; product: string; quantity: number; currentNetQuantity: number }) =>
    request<unknown>(`/portfolio/${mode}/positions/square-off`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  convertPosition: (mode: AccountMode, payload: { symbol: string; fromProduct: string; toProduct: string }) =>
    request<unknown>(`/portfolio/${mode}/positions/convert`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exitAllPositions: (mode: AccountMode) =>
    request<{ cancelledOrders: number; exitedPositions: Array<{ symbol: string }> }>(`/portfolio/${mode}/positions/exit-all`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  updateRiskControls: (mode: AccountMode, payload: { killSwitchOn?: boolean; maxDailyLoss?: string | null; maxOrderValue?: string | null }) =>
    request<{ account: TradingAccountDTO; cancelledOrders: number }>(`/portfolio/${mode}/risk-controls`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  candles: (params: { symbol: string; interval: string; from: string; to: string }) => {
    const qs = new URLSearchParams(params);
    return request<{
      symbol: string;
      interval: string;
      count: number;
      candles: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        oi?: number;
      }>;
    }>(`/market/candles?${qs.toString()}`);
  },

  chartLayouts: () =>
    request<{
      layouts: Array<{
        id: string;
        name: string;
        layout: Record<string, unknown>;
        updatedAt: string;
      }>;
    }>('/charts/layouts'),

  saveChartLayout: (payload: { id?: string; name: string; layout: Record<string, unknown> }) =>
    request<{ id: string; name: string; layout: Record<string, unknown>; updatedAt: string }>('/charts/layouts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteChartLayout: (id: string) =>
    request<{ deleted: boolean }>(`/charts/layouts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  fnoUnderlyings: () =>
    request<{
      indices: Array<{ symbol: string; displayName: string; exchange: string; weeklyAllowed: boolean }>;
      stocks: Array<{ symbol: string; exchange: string; lotSize: number }>;
      banList: string[];
      sebiRules: {
        weeklyExpiryIndices: { NSE: string[]; BSE: string[] };
        upfrontOptionPremiumPct: string;
        expiryDayShortOptionExtraElmPct: string;
        calendarSpreadBenefitOnExpiryDay: boolean;
      };
    }>('/fno/underlyings'),

  fnoOptionChain: (underlying: string, expiry?: string) => {
    const qs = new URLSearchParams({ underlying });
    if (expiry) qs.set('expiry', expiry);
    return request<{
      underlying: string;
      exchange: string;
      spotPrice: string;
      expiry: string;
      expiries: string[];
      lotSize: number;
      weeklyAllowed: boolean;
      totalCallOI: number;
      totalPutOI: number;
      pcr: number | null;
      maxPain: number | null;
      atmStrike?: number | null;
      atmStraddlePrice?: number | null;
      atmStraddlePct?: number | null;
      rows: Array<{
        strike: number;
        atm: boolean;
        itmCall: boolean;
        itmPut: boolean;
        strikePcr?: number | null;
        call: {
          instrumentId: string | null;
          tradingSymbol: string | null;
          lotSize: number;
          ltp: string | null;
          bid: string | null;
          ask: string | null;
          volume: number;
          oi: number;
          oiChange: number;
          iv: number | null;
          delta: number | null;
          gamma: number | null;
          theta: number | null;
          vega: number | null;
          buildup?: string;
        };
        put: {
          instrumentId: string | null;
          tradingSymbol: string | null;
          lotSize: number;
          ltp: string | null;
          bid: string | null;
          ask: string | null;
          volume: number;
          oi: number;
          oiChange: number;
          iv: number | null;
          delta: number | null;
          gamma: number | null;
          theta: number | null;
          vega: number | null;
          buildup?: string;
        };
      }>;
    }>(`/fno/chain?${qs.toString()}`);
  },

  analyzeStrategy: (payload: {
    spotPrice: number;
    targetDaysOffset?: number;
    ivShiftPct?: number;
    spotShiftPct?: number;
    legs: Array<{
      symbol: string;
      underlying: string;
      optionType: 'CE' | 'PE' | 'FUT';
      side: 'BUY' | 'SELL';
      strike: number;
      expiry: string;
      quantity: number;
      premium: number;
      iv?: number | null;
      delta?: number | null;
      gamma?: number | null;
      theta?: number | null;
      vega?: number | null;
    }>;
  }) =>
    request<{
      spotPrice: number;
      simulatedSpot?: number;
      daysToExpiry?: number;
      targetDaysRemaining?: number;
      avgIvPct?: number;
      netPremiumFlow: string;
      maxProfit: string;
      maxLoss: string;
      riskRewardRatio?: string | null;
      probabilityOfProfitPct?: number;
      expectedMove1SD?: { low: number; high: number; points: number };
      expectedMove2SD?: { low: number; high: number; points: number };
      breakevens: number[];
      netGreeks: { delta: number; gamma: number; theta: number; vega: number };
      marginEstimate: {
        unhedgedMargin: string;
        hedgedMargin: string;
        hedgeBenefit: string;
        warnings: string[];
      };
      charges: { totalCharges: string };
      payoffCurve: Array<{ spot: number; pnl: number; targetPnl?: number }>;
    }>('/fno/strategy/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeBasket: (payload: {
    accountMode: AccountMode;
    product: 'NRML' | 'MIS';
    legs: Array<{ symbol: string; side: 'BUY' | 'SELL'; quantity: number }>;
  }) =>
    request<{
      totalLegs: number;
      succeeded: number;
      failed: number;
      legs: Array<{ symbol: string; side: string; status: string; fillPrice?: string | null; error?: string; blockchainHash?: string | null }>;
    }>('/fno/basket', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  etfCatalog: (category = 'ALL') =>
    request<{
      totalCatalogCount: number;
      countsByCategory: Record<string, number>;
      etfs: Array<{
        instrumentId: string;
        symbol: string;
        displayName: string;
        exchange: string;
        segment: string;
        category: string;
        ltp: string | null;
        change: string | null;
        changePercent: string | null;
        volume: number | null;
        freshness: string;
      }>;
    }>(`/segments/etfs?category=${encodeURIComponent(category)}`),

  commodityContracts: (group = 'ALL', kind = 'ALL') =>
    request<{
      exchange: string;
      session: { phase: string; isTradable: boolean; hoursIST: string };
      regulatoryNote: string;
      totalActiveContracts: number;
      contracts: Array<{
        instrumentId: string;
        symbol: string;
        displayName: string;
        exchange: string;
        segment: string;
        instrumentKind: string;
        group: string;
        lotSize: number;
        tickSize: string;
        expiryDate: string | null;
        ltp: string | null;
        change: string | null;
        changePercent: string | null;
        volume: number | null;
        openInterest: number | null;
        freshness: string;
      }>;
    }>(`/segments/commodities?group=${encodeURIComponent(group)}&kind=${encodeURIComponent(kind)}`),

  marketAnalytics: () =>
    request<{
      gainers: Array<{ symbol: string; ltp: string; change: string; changePercent: number; volume: number }>;
      losers: Array<{ symbol: string; ltp: string; change: string; changePercent: number; volume: number }>;
      mostActive: Array<{ symbol: string; ltp: string; change: string; changePercent: number; volume: number }>;
      sectors: Array<{ sector: string; avgChangePercent: number; advancers: number; decliners: number; tracked: number }>;
      trackedCount: number;
    }>('/segments/analytics'),

  realFundingSummary: () =>
    request<{
      cashBalance: string;
      blockedMargin: string;
      unsettledT1Proceeds: string;
      withdrawableBalance: string;
      settlementNote: string;
      gateway: { name: string; isMock: boolean; supportedRails: string[] };
      brokerCompliance: {
        adapterMode: string;
        goingLiveReady: boolean;
        mandatoryPrerequisites: Array<{ requirement: string; status: string; details: string }>;
      };
    }>('/accounts/real/funding-summary'),

  depositRealFunds: (payload: { amount: string | number; rail: 'UPI' | 'NETBANKING'; upiId?: string; bankCode?: string }) =>
    request<{
      account: TradingAccountDTO;
      receipt: { utr: string; rail: string; amount: string; note: string };
      blockchainProof: { blockIndex: number; hash: string };
    }>('/accounts/real/deposit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  withdrawRealFunds: (payload: { amount: string | number; bankAccountMasked: string; ifsc: string }) =>
    request<{
      account: TradingAccountDTO;
      receipt: { payoutRef: string; amount: string; note: string };
      blockchainProof: { blockIndex: number; hash: string };
    }>('/accounts/real/withdraw', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  contractNotes: (mode: AccountMode) =>
    request<{
      count: number;
      contractNotes: Array<{
        contractNoteNumber: string;
        tradeDate: string;
        accountMode: string;
        tradeCount: number;
        totals: {
          grossBuyValue: string;
          grossSellValue: string;
          brokerage: string;
          sttOrCtt: string;
          exchangeTransactionCharge: string;
          sebiTurnoverFee: string;
          stampDuty: string;
          dpChargeExclGst: string;
          gst: string;
          totalCharges: string;
          netObligation: string;
        };
        trades: Array<{
          id: string;
          executedAt: string;
          symbol: string;
          exchange: string;
          product: string;
          side: string;
          quantity: number;
          price: string;
          turnover: string;
          totalCharges: string;
          blockchainHash: string | null;
        }>;
      }>;
    }>(`/reports/${mode}/contract-notes`),

  taxPnlReport: (mode: AccountMode) =>
    request<{
      accountMode: string;
      totalTrades: number;
      summary: { grossRealizedPnl: string; totalCharges: string; netRealizedPnl: string };
      taxBuckets: {
        equityDeliverySTCG: string;
        equityDeliveryLTCG: string;
        intradaySpeculativeBusinessIncome: string;
        derivativesNonSpeculativeIncome: string;
        derivativesIcaiTurnover: string;
      };
      chargesBreakdown: {
        brokerage: string;
        sttOrCtt: string;
        exchangeTransactionCharge: string;
        sebiTurnoverFee: string;
        stampDuty: string;
        dpChargeExclGst: string;
        gst: string;
        totalCharges: string;
      };
      realizedLegs: Array<{
        symbol: string;
        segment: string;
        product: string;
        taxHead: string;
        closedQty: number;
        buyPrice: string;
        sellPrice: string;
        grossPnl: string;
        closedAt: string;
      }>;
    }>(`/reports/${mode}/tax-pnl`),

  downloadCsvReport: async (mode: AccountMode, type: 'trades' | 'ledger' | 'tax-pnl') => {
    const res = await fetch(`${API_V1_BASE}/reports/${mode}/export?type=${type}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
    });
    if (!res.ok) throw new Error('CSV export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mode.toLowerCase()}-${type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  regulatoryNotices: () =>
    request<{
      count: number;
      notices: Array<{
        id: string;
        configKey: string;
        effectiveFrom: string;
        verification: string;
        citation: string;
        approvedBy: string | null;
        approvedAt: string | null;
      }>;
    }>('/regulatory/notices'),

  dpdpExport: () => request<Record<string, unknown>>('/regulatory/dpdp-export'),

  devPromoteAdmin: () =>
    request<{ promoted: boolean; note: string }>('/regulatory/dev-promote-admin', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  adminRegulatoryConfigs: () =>
    request<{
      count: number;
      configs: Array<{
        id: string;
        configKey: string;
        effectiveFrom: string;
        verification: string;
        citation: string;
        status: string;
        approvedBy: string | null;
        payload: unknown;
      }>;
    }>('/regulatory/configs'),

  adminRunWatchScan: () =>
    request<{ scannedAt: string; sourcesMonitored: number; findings: Array<{ configKey: string; summary: string; draftCreated: boolean }> }>(
      '/regulatory/watch/run',
      { method: 'POST', body: JSON.stringify({}) }
    ),

  adminApproveDraft: (id: string) =>
    request<{ config: { status: string }; blockchainProof: { blockIndex: number; hash: string } }>(
      `/regulatory/drafts/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  adminRejectDraft: (id: string) =>
    request<unknown>(`/regulatory/drafts/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Rejected via Admin Panel' }),
    }),

  marketSessionStatus: () =>
    request<{
      credentialsConfigured: boolean;
      totpAutoRefreshConfigured: boolean;
      authenticated: boolean;
      expiresAt: string | null;
      minutesRemaining: number | null;
    }>('/market/session/status'),

  setMarketSessionToken: (token: string) =>
    request<{ authenticated: boolean; expiresAt: string | null }>('/market/session/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  strategyPresets: () =>
    request<{ presets: Array<Record<string, unknown>> }>('/strategies/presets'),

  strategies: () =>
    request<{
      count: number;
      strategies: Array<{
        id: string;
        name: string;
        description: string | null;
        exchange: string;
        segment: string;
        product: string;
        definition: Record<string, unknown>;
        updatedAt: string;
      }>;
    }>('/strategies'),

  saveStrategy: (payload: { id?: string; definition: Record<string, unknown> }) =>
    request<{ id: string; name: string; definition: Record<string, unknown> }>('/strategies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteStrategy: (id: string) =>
    request<{ deleted: boolean }>(`/strategies/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  runBacktest: (payload: {
    strategyId?: string;
    strategy: Record<string, unknown>;
    symbol: string;
    interval: string;
    fromDate: string;
    toDate: string;
    initialCapital: number;
    saveRun?: boolean;
  }) =>
    request<{
      runId: string | null;
      symbol: string;
      interval: string;
      barsAnalyzed: number;
      fromDate: string;
      toDate: string;
      warnings: string[];
      metrics: {
        initialCapital: string;
        finalEquity: string;
        netProfit: string;
        netReturnPct: number;
        grossProfitTotal: string;
        totalChargesPaid: string;
        totalSlippageCost: string;
        feeDragPctOfGross: number;
        buyAndHoldReturnPct: number;
        cagrPct: number;
        maxDrawdownINR: string;
        maxDrawdownPct: number;
        maxDrawdownDurationBars: number;
        sharpeRatio: number;
        sortinoRatio: number;
        calmarRatio: number;
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        winRatePct: number;
        profitFactor: number;
        expectancyINR: string;
        avgWinINR: string;
        avgLossINR: string;
        maxConsecutiveWins: number;
        maxConsecutiveLosses: number;
        exposurePct: number;
        skippedSignals: number;
      };
      equityCurve: Array<{
        time: number;
        date: string;
        equity: number;
        grossEquity: number;
        buyAndHoldEquity: number;
        drawdownPct: number;
      }>;
      trades: Array<{
        tradeNo: number;
        direction: string;
        entryDate: string;
        entryPrice: string;
        exitDate: string;
        exitPrice: string;
        quantity: number;
        barsHeld: number;
        exitReason: string;
        grossPnl: string;
        totalCharges: string;
        netPnl: string;
        returnPct: string;
      }>;
    }>('/strategies/backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  backtestRuns: () =>
    request<{
      count: number;
      runs: Array<{
        id: string;
        strategyName: string;
        symbol: string;
        interval: string;
        fromDate: string;
        toDate: string;
        initialCapital: string;
        finalEquity: string;
        netReturnPct: string;
        maxDrawdownPct: string;
        sharpeRatio: string;
        totalTrades: number;
        totalCharges: string;
        createdAt: string;
      }>;
    }>('/strategies/backtests'),

  scanStrategySignal: (payload: { strategy: Record<string, unknown>; symbol: string; interval: string }) =>
    request<{
      symbol: string;
      interval: string;
      barsChecked: number;
      signal: 'ENTER_LONG' | 'ENTER_SHORT' | 'EXIT' | 'HOLD';
      evaluatedBarClose: number | null;
      details: string[];
    }>('/strategies/scan-signal', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  coachChat: (payload: {
    accountMode: AccountMode;
    question: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) =>
    request<{
      answer: string;
      providerUsed: 'local-rag' | 'ollama' | 'gemini';
      sebiGuardrailTriggered: boolean;
      citations: Array<{ id: string; title: string; category: string }>;
      suggestedActions: Array<{ label: string; targetNav: string }>;
      disclaimer: string;
    }>('/coach/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  coachDiagnostics: (mode: AccountMode) =>
    request<{
      accountMode: AccountMode;
      totalTrades: number;
      closedRoundTrips: number;
      winRatePct: number;
      avgWinINR: string;
      avgLossINR: string;
      rewardToRiskRatio: number;
      grossRealizedPnl: string;
      totalChargesPaid: string;
      netRealizedPnl: string;
      chargesDragPct: number;
      stopLossUsagePct: number;
      maxTradesInSingleDay: number;
      revengeTradeFlags: number;
      readinessScore: number;
      strengths: string[];
      improvements: string[];
      nextStepAdvice: string;
    }>(`/coach/diagnostics?mode=${mode}`),

  coachMissions: () =>
    request<{
      completedCount: number;
      totalCount: number;
      missions: Array<{
        id: string;
        title: string;
        description: string;
        completed: boolean;
        progressText: string;
        targetNav: string;
      }>;
    }>('/coach/missions'),

  coachCurriculum: () =>
    request<{
      modules: Array<{
        id: string;
        level: 'BEGINNER' | 'INTERMEDIATE' | 'PRO';
        title: string;
        durationMin: number;
        summary: string;
        lessons: Array<{ heading: string; body: string; indianExample: string }>;
        quiz: Array<{
          id: string;
          question: string;
          options: string[];
          correctIndex: number;
          explanation: string;
        }>;
        status: string;
        quizScore: number | null;
        completedAt: string | null;
      }>;
    }>('/coach/curriculum'),

  submitCoachQuiz: (moduleId: string, answers: number[]) =>
    request<{
      moduleId: string;
      correct: number;
      total: number;
      scorePct: number;
      passed: boolean;
      feedback: Array<{
        questionId: string;
        isCorrect: boolean;
        correctIndex: number;
        explanation: string;
      }>;
    }>(`/coach/curriculum/${encodeURIComponent(moduleId)}/quiz`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  // ── Sprint 1: Multi-Watchlists, Sections, 6-Color Tags & Sibling Exchange ──
  watchlists: () =>
    request<{
      count: number;
      maxWatchlists: number;
      watchlists: Array<{
        id: string;
        name: string;
        segment: string;
        sortOrder: number;
        items: Array<{
          id: string;
          symbol: string;
          exchange: string;
          segment: string;
          sectionName: string;
          colorTag: 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN' | 'BLUE' | 'PURPLE' | null;
          sortOrder: number;
        }>;
      }>;
    }>('/watchlists'),

  createWatchlist: (name: string, segment = 'ALL') =>
    request<{ id: string; name: string; segment: string; items: unknown[] }>('/watchlists', {
      method: 'POST',
      body: JSON.stringify({ name, segment }),
    }),

  renameWatchlist: (id: string, name: string) =>
    request<unknown>(`/watchlists/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  deleteWatchlist: (id: string) =>
    request<{ deleted: boolean }>(`/watchlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  addWatchlistItem: (wlId: string, payload: { symbol: string; sectionName?: string; colorTag?: string | null }) =>
    request<unknown>(`/watchlists/${encodeURIComponent(wlId)}/items`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateWatchlistItem: (wlId: string, itemId: string, payload: { sectionName?: string; colorTag?: string | null }) =>
    request<unknown>(`/watchlists/${encodeURIComponent(wlId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteWatchlistItem: (wlId: string, itemId: string) =>
    request<{ deleted: boolean }>(`/watchlists/${encodeURIComponent(wlId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    }),

  bulkWatchlistAction: (
    wlId: string,
    payload: {
      itemIds: string[];
      action: 'DELETE' | 'TAG' | 'MOVE_SECTION' | 'MOVE_WATCHLIST';
      colorTag?: string | null;
      sectionName?: string;
      targetWatchlistId?: string;
    }
  ) =>
    request<{ action: string; affected: number }>(`/watchlists/${encodeURIComponent(wlId)}/bulk`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  siblingExchange: (symbol: string) =>
    request<{
      primary: {
        exchange: string;
        instrumentId: string;
        symbol: string;
        mtfLeverage: string;
        upperCircuit: string | null;
        lowerCircuit: string | null;
        asmGsmFlag: string | null;
        ltp: string | null;
      };
      sibling: { exchange: string; instrumentId: string; symbol: string; ltp: string | null } | null;
    }>(`/watchlists/sibling-exchange?symbol=${encodeURIComponent(symbol)}`),

  // ── Sprint 2: Advanced Orders (Forever GTT, Conditional, Baskets, Drafts, SIPs) ──
  foreverOrders: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      count: number;
      foreverOrders: Array<{
        id: string;
        orderFlag: 'SINGLE' | 'OCO';
        side: 'BUY' | 'SELL';
        product: string;
        quantity: number;
        triggerPrice: string;
        limitPrice: string;
        triggerDirection: 'GTE' | 'LTE';
        triggerPrice2: string | null;
        limitPrice2: string | null;
        status: string;
        expiresAt: string;
        createdAt: string;
        instrument: { symbol: string; displayName: string; exchange: string; segment: string };
      }>;
    }>(`/advanced-orders/forever?mode=${mode}`),

  createForeverOrder: (payload: Record<string, unknown>) =>
    request<unknown>('/advanced-orders/forever', { method: 'POST', body: JSON.stringify(payload) }),

  cancelForeverOrder: (id: string) =>
    request<unknown>(`/advanced-orders/forever/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  conditionalTriggers: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      count: number;
      triggers: Array<{
        id: string;
        symbol: string;
        condition: { indicator: string; timeframe: string; operator: string; value: number };
        orders: Array<{ symbol: string; side: string; product: string; orderType: string; quantity: number }>;
        frequency: string;
        status: string;
        note: string | null;
        createdAt: string;
      }>;
    }>(`/advanced-orders/conditional?mode=${mode}`),

  createConditionalTrigger: (payload: Record<string, unknown>) =>
    request<unknown>('/advanced-orders/conditional', { method: 'POST', body: JSON.stringify(payload) }),

  cancelConditionalTrigger: (id: string) =>
    request<unknown>(`/advanced-orders/conditional/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  savedBaskets: () =>
    request<{
      count: number;
      baskets: Array<{
        id: string;
        name: string;
        legs: Array<{ symbol: string; side: 'BUY' | 'SELL'; product: string; orderType: string; quantity: number; price?: number }>;
        updatedAt: string;
      }>;
    }>('/advanced-orders/baskets'),

  createSavedBasket: (payload: { name: string; legs: Array<Record<string, unknown>> }) =>
    request<unknown>('/advanced-orders/baskets', { method: 'POST', body: JSON.stringify(payload) }),

  deleteSavedBasket: (id: string) =>
    request<unknown>(`/advanced-orders/baskets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  executeSavedBasket: (id: string, accountMode: AccountMode, reverse = false) =>
    request<{ totalLegs: number; succeeded: number; failed: number }>(`/advanced-orders/baskets/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ accountMode, reverse }),
    }),

  draftOrders: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      count: number;
      drafts: Array<{
        id: string;
        symbol: string;
        side: string;
        product: string;
        orderType: string;
        quantity: number;
        note: string | null;
        payload: Record<string, unknown>;
        createdAt: string;
      }>;
    }>(`/advanced-orders/drafts?mode=${mode}`),

  createDraftOrder: (payload: Record<string, unknown>) =>
    request<unknown>('/advanced-orders/drafts', { method: 'POST', body: JSON.stringify(payload) }),

  executeDraftOrder: (id: string) =>
    request<unknown>(`/advanced-orders/drafts/${encodeURIComponent(id)}/execute`, { method: 'POST', body: JSON.stringify({}) }),

  deleteDraftOrder: (id: string) =>
    request<unknown>(`/advanced-orders/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  stockSips: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      count: number;
      sips: Array<{
        id: string;
        symbol: string;
        mode: 'AMOUNT' | 'QTY';
        value: string;
        frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
        active: boolean;
        runsCount: number;
        nextRunAt: string;
        lastRunAt: string | null;
      }>;
    }>(`/advanced-orders/sips?mode=${mode}`),

  createStockSip: (payload: Record<string, unknown>) =>
    request<unknown>('/advanced-orders/sips', { method: 'POST', body: JSON.stringify(payload) }),

  toggleStockSip: (id: string, active?: boolean) =>
    request<unknown>(`/advanced-orders/sips/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),

  runStockSipNow: (id: string) =>
    request<{ executedQty: number }>(`/advanced-orders/sips/${encodeURIComponent(id)}/run-now`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteStockSip: (id: string) =>
    request<unknown>(`/advanced-orders/sips/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ── Sprint 4: F&O Templates, Quant Mode, Flash Trade, Analytics ────────────
  fnoTemplates: () =>
    request<{
      count: number;
      templates: Array<{
        id: string;
        name: string;
        outlook: 'BULLISH' | 'BEARISH' | 'NON_DIRECTIONAL' | 'VOLATILITY';
        description: string;
        legs: Array<{ optionType: 'CE' | 'PE'; side: 'BUY' | 'SELL'; strikeOffsetSteps: number; lots: number; expiryIndex?: number }>;
      }>;
    }>('/fno/templates'),

  fnoQuantBuild: (payload: {
    underlying: string;
    expiry?: string;
    rules: Array<{ optionType: 'CE' | 'PE'; side: 'BUY' | 'SELL'; lots: number; rule: string; value?: number }>;
  }) =>
    request<{
      underlying: string;
      expiry: string;
      spotPrice: number;
      legs: Array<{
        symbol: string;
        underlying: string;
        optionType: 'CE' | 'PE';
        side: 'BUY' | 'SELL';
        strike: number;
        expiry: string;
        quantity: number;
        premium: number;
        iv?: number | null;
        delta?: number | null;
        gamma?: number | null;
        theta?: number | null;
        vega?: number | null;
      }>;
      analysis: Awaited<ReturnType<typeof api.analyzeStrategy>> | null;
    }>('/fno/quant-build', { method: 'POST', body: JSON.stringify(payload) }),

  fnoFlash: (underlying: string, view: 'BULLISH' | 'BEARISH', expiry?: string) => {
    const qs = new URLSearchParams({ underlying, view });
    if (expiry) qs.set('expiry', expiry);
    return request<{
      underlying: string;
      expiry: string;
      spotPrice: string;
      view: 'BULLISH' | 'BEARISH';
      optionType: 'CE' | 'PE';
      cards: Array<{
        tag: string;
        badge: string;
        optionType: 'CE' | 'PE';
        strike: number;
        symbol: string;
        lotSize: number;
        ltp: string | null;
        bid: string | null;
        ask: string | null;
        oi: number;
        oiChange: number;
        volume: number;
        iv: number | null;
        delta: number | null;
        buildup: string;
      }>;
    }>(`/fno/flash?${qs.toString()}`);
  },

  fnoAnalytics: (underlying: string, expiry?: string) => {
    const qs = new URLSearchParams({ underlying });
    if (expiry) qs.set('expiry', expiry);
    return request<{
      underlying: string;
      expiry: string;
      spotPrice: string;
      pcr: number | null;
      maxPain: number | null;
      atmStrike: number | null;
      atmStraddlePrice: number | null;
      atmStraddlePct: number | null;
      resistanceStrike: number | null;
      supportStrike: number | null;
      netCallOiChange: number;
      netPutOiChange: number;
      trendingOiDiff: number;
      oiProfile: Array<{
        strike: number;
        atm: boolean;
        ceOi: number;
        peOi: number;
        ceOiChange: number;
        peOiChange: number;
        ceIv: number | null;
        peIv: number | null;
        ceLtp: number;
        peLtp: number;
        straddlePrice: number;
      }>;
      intradaySeries: Array<{
        time: string;
        spotPrice: number;
        atmStrike: number;
        atmStraddle: number;
        totalCeOi: number;
        totalPeOi: number;
        pcrOi: number;
      }>;
    }>(`/fno/analytics?${qs.toString()}`);
  },

  // ── Sprint 5: Screener, Treemap Heatmap & Fundamentals ──────────────────────
  screenerPresets: () =>
    request<{
      count: number;
      presets: Array<{
        id: string;
        name: string;
        category: string;
        description: string;
        logic: 'AND' | 'OR';
        rules: Array<{ field: string; op: string; value: number | [number, number] }>;
      }>;
    }>('/screener/presets'),

  runScreener: (payload: Record<string, unknown>) =>
    request<{
      presetId: string | null;
      matchedCount: number;
      universeCount: number;
      results: Array<{
        symbol: string;
        sector: string;
        exchange: string;
        segment: string;
        ltp: number | null;
        open: number | null;
        high: number | null;
        low: number | null;
        vwap: number | null;
        changePercent: number;
        volume: number;
        vwapDiffPct: number;
        dayRangePosPct: number;
        openGapPct: number;
      }>;
      timestamp: string;
    }>('/screener/run', { method: 'POST', body: JSON.stringify(payload) }),

  screenerHeatmap: () =>
    request<{
      breadth: { advancers: number; decliners: number; unchanged: number; adRatio: number };
      sectors: Array<{
        sector: string;
        avgChangePercent: number;
        totalWeight: number;
        advancers: number;
        decliners: number;
        stocks: Array<{ symbol: string; mcapWeight: number; ltp: string | null; changePercent: number; volume: number }>;
      }>;
      timestamp: string;
    }>('/screener/heatmap'),

  screenerTemplates: () =>
    request<{
      count: number;
      templates: Array<{ id: string; name: string; category: string; ast: Record<string, unknown>; createdAt: string }>;
    }>('/screener/templates'),

  saveScreenerTemplate: (payload: { name: string; category: string; ast: Record<string, unknown> }) =>
    request<unknown>('/screener/templates', { method: 'POST', body: JSON.stringify(payload) }),

  deleteScreenerTemplate: (id: string) =>
    request<unknown>(`/screener/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  marketFundamentals: (symbol: string) =>
    request<{
      instrumentId: string;
      symbol: string;
      tradingSymbol: string;
      displayName: string;
      exchange: string;
      segment: string;
      isin: string | null;
      lotSize: number;
      tickSize: string;
      mtfLeverage: string;
      upperCircuit: string | null;
      lowerCircuit: string | null;
      week52High: string | null;
      week52Low: string | null;
      asmGsmFlag: string | null;
      quote: {
        ltp: string | null;
        prevClose: string | null;
        open: string | null;
        high: string | null;
        low: string | null;
        change: string | null;
        changePercent: string | null;
        volume: number | null;
        vwap: string | null;
      } | null;
      companyInfo: Record<string, unknown> | null;
      updatedAt: string;
    }>(`/market/fundamentals/${encodeURIComponent(symbol)}`),

  // ── Sprint 6: Portfolio Power Tools, Diary, Controls, Alerts & Webhooks ────
  reversePosition: (mode: AccountMode, payload: { symbol: string; product: 'MIS' | 'NRML' }) =>
    request<unknown>(`/portfolio/${mode}/positions/reverse`, { method: 'POST', body: JSON.stringify(payload) }),

  positionInsights: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      groupCount: number;
      groups: Array<{
        underlying: string;
        spotPrice: number;
        legCount: number;
        analysis: Awaited<ReturnType<typeof api.analyzeStrategy>>;
      }>;
    }>(`/portfolio/${mode}/positions/insights`),

  portfolioAnalyzer: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      summary: { totalInvested: string; totalCurrentValue: string; totalUnrealizedPnl: string; totalUnrealizedPnlPct: string };
      xirrPct: number | null;
      top3ConcentrationPct: number;
      segmentBreakdown: Array<{ segment: string; value: string; weightPct: number }>;
      allocations: Array<{ symbol: string; segment: string; currentValue: string; weightPct: number; unrealizedPnl: string; unrealizedPnlPct: string }>;
      taxLossHarvesting: Array<{ symbol: string; totalQty: number; avgCost: string; ltp: string; harvestableLoss: string; estimatedTaxSaved20Pct: string }>;
    }>(`/portfolio/${mode}/analyzer`),

  pledges: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      collateralMargin: string;
      pledges: Array<{
        id: string;
        pledgedQty: number;
        referencePrice: string;
        haircutPct: string;
        collateralValue: string;
        status: string;
        createdAt: string;
        instrument: { symbol: string; displayName: string; segment: string };
      }>;
    }>(`/portfolio/${mode}/pledges`),

  pledgeHolding: (mode: AccountMode, symbol: string, quantity: number) =>
    request<{ account: TradingAccountDTO }>(`/portfolio/${mode}/pledge`, {
      method: 'POST',
      body: JSON.stringify({ symbol, quantity }),
    }),

  unpledgeHolding: (mode: AccountMode, pledgeId: string) =>
    request<{ account: TradingAccountDTO }>(`/portfolio/${mode}/unpledge/${encodeURIComponent(pledgeId)}`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  mtfPositions: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      count: number;
      positions: Array<{
        id: string;
        symbol: string;
        displayName: string;
        quantity: number;
        avgPrice: string;
        ltp: string;
        leverage: string;
        clientMargin: string;
        fundedAmount: string;
        interestRatePct: string;
        estimatedInterest: string;
        unrealizedPnl: string;
        createdAt: string;
      }>;
    }>(`/portfolio/${mode}/mtf`),

  convertMtfToCnc: (mode: AccountMode, mtfId: string) =>
    request<{ converted: boolean; account: TradingAccountDTO }>(`/portfolio/${mode}/mtf/${encodeURIComponent(mtfId)}/convert`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  diarySummary: (mode: AccountMode) =>
    request<{
      mode: AccountMode;
      kpis: {
        totalExecutions: number;
        closedRoundTrips: number;
        grossRealizedPnl: string;
        totalCharges: string;
        netRealizedPnl: string;
        winRatePct: number;
        profitFactor: number;
        expectancy: string;
        avgWin: string;
        avgLoss: string;
        maxDrawdown: string;
        maxWinStreak: number;
        maxLossStreak: number;
        bestDay: { date: string; netPnl: number } | null;
        worstDay: { date: string; netPnl: number } | null;
      };
      calendar: Array<{ date: string; grossPnl: number; charges: number; netPnl: number; tradesCount: number }>;
      hourlyBreakdown: Array<{ hour: number; netPnl: number; count: number }>;
      equityCurve: Array<{ index: number; date: string; cumulativeNetPnl: number }>;
      closedTrades: Array<{ date: string; symbol: string; segment: string; product: string; grossPnl: number; charges: number; netPnl: number }>;
      notes: Array<{
        id: string;
        tradeDate: string;
        symbol: string | null;
        setupTag: string | null;
        emotionTag: string | null;
        mistakeTag: string | null;
        rating: number | null;
        notes: string;
        createdAt: string;
      }>;
    }>(`/diary/${mode}/summary`),

  addDiaryNote: (payload: {
    tradeDate: string;
    symbol?: string;
    setupTag?: string;
    emotionTag?: string;
    mistakeTag?: string;
    rating?: number;
    notes: string;
  }) => request<unknown>('/diary/notes', { method: 'POST', body: JSON.stringify(payload) }),

  deleteDiaryNote: (id: string) =>
    request<unknown>(`/diary/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  controlsGet: (mode: AccountMode) =>
    request<{ account: TradingAccountDTO; todayTrades: number }>(`/controls/${mode}`),

  controlsUpdate: (mode: AccountMode, payload: Record<string, unknown>) =>
    request<{ account: TradingAccountDTO; cancelledOrders: number }>(`/controls/${mode}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  alertsList: () =>
    request<{
      count: number;
      alerts: Array<{
        id: string;
        symbol: string;
        condition: string;
        targetValue: string;
        timeframe: string | null;
        note: string | null;
        status: string;
        triggeredAt: string | null;
        createdAt: string;
      }>;
    }>('/alerts'),

  createAlert: (payload: { symbol: string; condition: string; targetValue: string | number; timeframe?: string; note?: string }) =>
    request<unknown>('/alerts', { method: 'POST', body: JSON.stringify(payload) }),

  toggleAlert: (id: string) =>
    request<unknown>(`/alerts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({}) }),

  deleteAlert: (id: string) =>
    request<unknown>(`/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  webhookConfig: () =>
    request<{
      webhookPath: string;
      urlToken: string;
      secret: string;
      active: boolean;
      expiresAt: string;
      logs: Array<{
        id: string;
        status: string;
        payloadPreview: string;
        responseText: string | null;
        latencyMs: number;
        createdAt: string;
      }>;
    }>('/webhooks/config'),

  rotateWebhook: () =>
    request<{ webhookPath: string; urlToken: string; secret: string; active: boolean; expiresAt: string }>('/webhooks/rotate', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  toggleWebhook: (active: boolean) =>
    request<{ active: boolean }>('/webhooks/toggle', {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
};
