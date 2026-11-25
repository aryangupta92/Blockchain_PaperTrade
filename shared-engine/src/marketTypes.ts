export type AccountMode = 'DEMO' | 'REAL';

export type ExchangeCode = 'NSE' | 'BSE' | 'MCX';

export type MarketSegment =
  | 'EQ'      // Cash equity (NSE/BSE)
  | 'FNO'     // Equity & Index Futures & Options
  | 'ETF'     // Exchange-Traded Funds
  | 'COMM';   // Commodity Futures & Options (MCX)

export type InstrumentKind =
  | 'EQUITY'
  | 'INDEX'
  | 'ETF'
  | 'FUTURES'
  | 'OPTIONS';

export type ProductType = 'CNC' | 'MIS' | 'NRML' | 'MTF';

export type OrderSide = 'BUY' | 'SELL';

export type OrderType =
  | 'MARKET'
  | 'LIMIT'
  | 'SL'
  | 'SL_M'
  | 'BO'
  | 'CO'
  | 'SUPER'   // Bracket with trailing stop-loss
  | 'GTT';    // Forever / Good-Till-Triggered (Single or OCO)

export type OrderValidity = 'DAY' | 'IOC' | 'GTT';

export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'TRIGGER_PENDING'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export type DataFreshness = 'LIVE' | 'CACHED' | 'STALE' | 'UNAVAILABLE';

export interface DepthLevel {
  price: string;
  quantity: number;
  orders: number;
}

export interface NormalizedQuote {
  instrumentId: string;
  symbol: string;
  exchange: ExchangeCode;
  segment: MarketSegment;
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
  bidDepth: DepthLevel[];
  askDepth: DepthLevel[];
  upperCircuit?: string | null;
  lowerCircuit?: string | null;
  week52High?: string | null;
  week52Low?: string | null;
  totalBuyQty?: number | null;
  totalSellQty?: number | null;
  ltq?: number | null;
  ltt?: string | null;
  oiDayHigh?: number | null;
  oiDayLow?: number | null;
  freshness: DataFreshness;
  timestamp: string;
}

export interface CandleBar {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

/**
 * Provider-agnostic market data contract.
 * Implementations MUST never leak vendor branding, URLs, or error strings.
 */
export interface MarketDataProvider {
  getHealth(): Promise<{
    connected: boolean;
    authenticated: boolean;
    dataSubscriptionActive: boolean | null;
    dataSubscriptionExpiry: string | null;
    instrumentCount: number;
    freshness: DataFreshness;
  }>;
  getQuotes(instrumentIds: string[]): Promise<NormalizedQuote[]>;
  getCandles(params: {
    instrumentId: string;
    interval: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W';
    from: string;
    to: string;
  }): Promise<CandleBar[]>;
  getExpiryList(underlying: string): Promise<string[]>;
  getOptionChain(underlying: string, expiry: string): Promise<unknown>;
  refreshInstrumentMaster(): Promise<{ count: number; updatedAt: string }>;
}

/**
 * Provider-agnostic charting contract (Lightweight Charts -> Advanced Charts).
 */
export interface ChartProvider {
  readonly engine: 'LIGHTWEIGHT_CHARTS' | 'ADVANCED_CHARTS';
  mount(container: HTMLElement): void;
  setSymbol(symbol: string, interval: string): Promise<void>;
  updateTick(quote: NormalizedQuote): void;
  destroy(): void;
}
