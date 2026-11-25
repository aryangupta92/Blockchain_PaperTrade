import {
  AccountMode,
  analyzeOptionStrategy,
  calculateTradeCharges,
  classifyOiBuildup,
  D,
  Decimal,
  ExchangeCode,
  NormalizedQuote,
  OiBuildupType,
  OPTION_STRATEGY_TEMPLATES,
  ProductType,
  QuantLegRule,
  resolveRegulatoryConfig,
  roundPaise,
  selectQuantModeStrike,
  StrategyLegInput,
  ZERO,
} from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { blockchainService } from './blockchainAuditService';
import { getCoreIndices, getMasterIndex, MasterInstrument } from './market-data/instrumentMaster';
import { marketDataService } from './market-data/marketDataService';
import { placeOrder } from './trading-oms/orderManagementService';

export interface EnrichedOptionStrike {
  strike: number;
  atm: boolean;
  itmCall: boolean;
  itmPut: boolean;
  strikePcr: number | null;
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
    buildup: OiBuildupType;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
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
    buildup: OiBuildupType;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
  };
}

/**
 * Dynamically discover all currently listed Index F&O and Stock F&O underlyings
 * from the live daily scrip master (never hardcoded).
 */
export async function getFnoUnderlyings() {
  const master = await getMasterIndex();
  const prisma = getPrisma();
  const cfg = resolveRegulatoryConfig();

  const indexUnderlyings = getCoreIndices()
    .filter((i) => i.symbol !== 'INDIAVIX')
    .map((idx) => ({
      symbol: idx.symbol,
      displayName: idx.displayName,
      exchange: idx.exchange,
      weeklyAllowed:
        idx.exchange === 'NSE'
          ? cfg.fnoRules.value.weeklyExpiryIndices.NSE.includes(idx.symbol)
          : cfg.fnoRules.value.weeklyExpiryIndices.BSE.includes(idx.symbol),
    }));

  // Discover unique stock F&O underlyings from NSE_FNO FUTSTK/OPTSTK contracts
  const stockSet = new Map<string, { symbol: string; exchange: ExchangeCode; lotSize: number }>();
  for (const item of master.list) {
    if (item.segment === 'FNO' && item.instrumentKind === 'FUTURES' && item.exchange === 'NSE') {
      const root = item.tradingSymbol.split('-')[0].split(' ')[0].toUpperCase();
      if (!root || indexUnderlyings.some((u) => u.symbol === root)) continue;
      if (!stockSet.has(root)) {
        stockSet.set(root, { symbol: root, exchange: 'NSE', lotSize: item.lotSize });
      }
    }
  }

  const bannedRows = await prisma.instrument.findMany({
    where: { inFnoBan: true },
    select: { symbol: true },
  });
  const banList = bannedRows.map((b) => b.symbol);

  return {
    indices: indexUnderlyings,
    stocks: [...stockSet.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    banList,
    sebiRules: cfg.fnoRules.value,
    sebiCitation: cfg.fnoRules.citation,
  };
}

/** Resolve exact option contract from the daily scrip master by (underlying, expiry, strike, CE|PE). */
export async function resolveOptionContract(params: {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  strike: number;
  optionType: 'CE' | 'PE';
}): Promise<MasterInstrument | null> {
  const master = await getMasterIndex();
  const root = params.underlying.toUpperCase();
  const expiryPrefix = params.expiry.slice(0, 10);

  for (const item of master.list) {
    if (item.segment !== 'FNO' || item.instrumentKind !== 'OPTIONS') continue;
    if (item.optionType !== params.optionType) continue;
    if (!item.expiryDate || !item.expiryDate.startsWith(expiryPrefix)) continue;
    if (!item.strikePrice || Math.abs(Number(item.strikePrice) - params.strike) > 0.01) continue;
    if (item.tradingSymbol.startsWith(`${root}-`) || item.tradingSymbol.startsWith(`${root} `) || item.displayName.toUpperCase().startsWith(`${root} `) || item.symbol === root) {
      return item;
    }
  }
  return null;
}

/**
 * Fetch live Option Chain and enrich every CE/PE leg with exact resolved contract metadata
 * (tradingSymbol, instrumentId, lotSize) for one-click trading & one-click strike charting.
 */
export async function getEnrichedOptionChain(underlying: string, expiry?: string) {
  const chain = await marketDataService.getOptionChain(underlying, expiry);
  if (!chain) return null;

  const master = await getMasterIndex();
  const root = chain.underlying.toUpperCase();
  const expPrefix = chain.expiry.slice(0, 10);

  // Pre-index all option contracts for this underlying + expiry for O(1) strike lookup
  const contractsByKey = new Map<string, MasterInstrument>();
  let defaultLotSize = 1;
  for (const item of master.list) {
    if (item.segment !== 'FNO' || item.instrumentKind !== 'OPTIONS') continue;
    if (!item.expiryDate || !item.expiryDate.startsWith(expPrefix)) continue;
    if (!(item.tradingSymbol.startsWith(`${root}-`) || item.tradingSymbol.startsWith(`${root} `) || item.displayName.toUpperCase().startsWith(`${root} `) || item.symbol === root)) continue;
    if (!item.strikePrice || !item.optionType) continue;
    const key = `${Math.round(Number(item.strikePrice))}:${item.optionType}`;
    contractsByKey.set(key, item);
    defaultLotSize = item.lotSize;
  }

  const rows: EnrichedOptionStrike[] = chain.rows.map((r) => {
    const ceMeta = contractsByKey.get(`${Math.round(r.strike)}:CE`) || null;
    const peMeta = contractsByKey.get(`${Math.round(r.strike)}:PE`) || null;
    const cePriceSignal = r.call.oiChange >= 0 ? (r.call.ltp ? 1 : 0) : -1;
    const pePriceSignal = r.put.oiChange >= 0 ? (r.put.ltp ? 1 : 0) : -1;
    return {
      strike: r.strike,
      atm: r.atm,
      itmCall: r.itmCall,
      itmPut: r.itmPut,
      strikePcr: r.call.oi > 0 ? Number((r.put.oi / r.call.oi).toFixed(2)) : null,
      call: {
        ...r.call,
        buildup: classifyOiBuildup(r.call.ltp ? (r.call.delta ?? cePriceSignal) : 0, r.call.oiChange),
        instrumentId: ceMeta?.instrumentId ?? null,
        tradingSymbol: ceMeta?.tradingSymbol ?? null,
        lotSize: ceMeta?.lotSize ?? defaultLotSize,
      },
      put: {
        ...r.put,
        buildup: classifyOiBuildup(r.put.ltp ? -(r.put.delta ?? pePriceSignal) : 0, r.put.oiChange),
        instrumentId: peMeta?.instrumentId ?? null,
        tradingSymbol: peMeta?.tradingSymbol ?? null,
        lotSize: peMeta?.lotSize ?? defaultLotSize,
      },
    };
  });

  const atmRow = rows.find((r) => r.atm) || rows[Math.floor(rows.length / 2)];
  const atmStraddlePrice = atmRow
    ? Number(((Number(atmRow.call.ltp || 0) + Number(atmRow.put.ltp || 0))).toFixed(2))
    : null;
  const spotNum = Number(chain.spotPrice);
  const atmStraddlePct = atmStraddlePrice && spotNum > 0 ? Number(((atmStraddlePrice / spotNum) * 100).toFixed(2)) : null;

  // Record periodic OptionChainSnapshot (throttled to 1/min per underlying+expiry) for Straddle & Multi-Strike OI charts
  if (atmRow && process.env.NODE_ENV !== 'test') {
    const prisma = getPrisma();
    const oneMinAgo = new Date(Date.now() - 60_000);
    prisma.optionChainSnapshot
      .findFirst({ where: { underlying: root, expiry: chain.expiry, capturedAt: { gte: oneMinAgo } } })
      .then((recent) => {
        if (recent) return;
        const center = rows.findIndex((x) => x.strike === atmRow.strike);
        const slice = rows.slice(Math.max(0, center - 8), Math.min(rows.length, center + 9)).map((s) => ({
          strike: s.strike,
          ceOi: s.call.oi,
          peOi: s.put.oi,
          ceChgOi: s.call.oiChange,
          peChgOi: s.put.oiChange,
          ceLtp: Number(s.call.ltp || 0),
          peLtp: Number(s.put.ltp || 0),
          ceIv: s.call.iv,
          peIv: s.put.iv,
        }));
        return prisma.optionChainSnapshot.create({
          data: {
            underlying: root,
            expiry: chain.expiry,
            spotPrice: chain.spotPrice,
            atmStrike: atmRow.strike,
            atmStraddle: atmStraddlePrice ?? 0,
            totalCeOi: chain.totalCallOI,
            totalPeOi: chain.totalPutOI,
            pcrOi: chain.pcr ?? 0,
            maxPain: chain.maxPain ?? atmRow.strike,
            strikesJson: JSON.stringify(slice),
          },
        });
      })
      .catch(() => {});
  }

  const cfg = resolveRegulatoryConfig();
  const weeklyAllowed =
    chain.exchange === 'NSE'
      ? cfg.fnoRules.value.weeklyExpiryIndices.NSE.includes(root)
      : cfg.fnoRules.value.weeklyExpiryIndices.BSE.includes(root);

  return {
    ...chain,
    lotSize: defaultLotSize,
    weeklyAllowed,
    atmStrike: atmRow?.strike ?? null,
    atmStraddlePrice,
    atmStraddlePct,
    rows,
  };
}

/** Analyze a multi-leg strategy: Expiry + T+0 Payoff Curve, POP%, ±1/2 SD, Net Greeks, Hedge Margin & Charges. */
export async function analyzeStrategyBasket(params: {
  spotPrice: number;
  legs: StrategyLegInput[];
  asOfDate?: string;
  targetDaysOffset?: number;
  ivShiftPct?: number;
  spotShiftPct?: number;
}) {
  const analysis = analyzeOptionStrategy(params);

  let totalCharges = ZERO;
  const legCharges = params.legs.map((leg) => {
    const cb = calculateTradeCharges({
      exchange: leg.underlying === 'SENSEX' || leg.underlying === 'BANKEX' ? 'BSE' : 'NSE',
      segment: 'FNO',
      instrumentKind: leg.optionType === 'FUT' ? 'FUTURES' : 'OPTIONS',
      product: 'NRML',
      side: leg.side,
      quantity: leg.quantity,
      price: leg.premium,
      asOfDate: params.asOfDate,
    });
    totalCharges = totalCharges.plus(D(cb.totalCharges));
    return { symbol: leg.symbol, side: leg.side, ...cb };
  });

  // Optional live exchange multi-order SPAN margin enrichment (skipped in tests/offline)
  let exchangeMultiMargin: Record<string, unknown> | null = null;
  if (process.env.NODE_ENV !== 'test' && params.legs.length > 0) {
    try {
      exchangeMultiMargin = (await marketDataService.calculateExchangeMargin(
        params.legs.map((l) => ({
          symbol: l.symbol,
          side: l.side,
          quantity: l.quantity,
          product: 'NRML',
          price: Math.max(0.05, l.premium),
        }))
      )) as Record<string, unknown>;
    } catch {
      exchangeMultiMargin = null;
    }
  }

  return {
    ...analysis,
    exchangeMultiMargin,
    charges: {
      totalCharges: roundPaise(totalCharges).toFixed(2),
      legs: legCharges,
    },
  };
}

/** Quant Mode: Automatically resolve multi-leg option strategy from rule selectors (9 rules). */
export async function buildQuantModeStrategy(params: {
  underlying: string;
  expiry?: string;
  rules: QuantLegRule[];
}) {
  const chain = await getEnrichedOptionChain(params.underlying, params.expiry);
  if (!chain) throw new Error(`Option chain unavailable for ${params.underlying}`);
  const spot = Number(chain.spotPrice);
  const quantRows = chain.rows.map((r) => ({
    strike: r.strike,
    atm: r.atm,
    call: { ltp: Number(r.call.ltp || 0), oi: r.call.oi, oiChange: r.call.oiChange, volume: r.call.volume, delta: r.call.delta, gamma: r.call.gamma, iv: r.call.iv },
    put: { ltp: Number(r.put.ltp || 0), oi: r.put.oi, oiChange: r.put.oiChange, volume: r.put.volume, delta: r.put.delta, gamma: r.put.gamma, iv: r.put.iv },
  }));

  const legs: StrategyLegInput[] = [];
  for (const rule of params.rules) {
    const chosen = selectQuantModeStrike(quantRows, spot, rule);
    if (!chosen) continue;
    const orig = chain.rows.find((r) => r.strike === chosen.strike);
    if (!orig) continue;
    const legObj = rule.optionType === 'CE' ? orig.call : orig.put;
    legs.push({
      symbol: legObj.tradingSymbol || `${chain.underlying}-${chain.expiry}-${orig.strike}-${rule.optionType}`,
      underlying: chain.underlying,
      optionType: rule.optionType,
      side: rule.side,
      strike: orig.strike,
      expiry: chain.expiry,
      quantity: Math.max(1, rule.lots) * (legObj.lotSize || chain.lotSize || 1),
      premium: Number(legObj.ltp || 0),
      iv: legObj.iv,
      delta: legObj.delta,
      gamma: legObj.gamma,
      theta: legObj.theta,
      vega: legObj.vega,
    });
  }

  const analysis = legs.length ? await analyzeStrategyBasket({ spotPrice: spot, legs }) : null;
  return { underlying: chain.underlying, expiry: chain.expiry, spotPrice: spot, legs, analysis };
}

/** Flash Trade: Curate top 3 scalping option contracts (ATM, Highest OI, Most Traded) for Bullish/Bearish view. */
export async function getFlashTradeCandidates(params: {
  underlying: string;
  view: 'BULLISH' | 'BEARISH';
  expiry?: string;
}) {
  const chain = await getEnrichedOptionChain(params.underlying, params.expiry);
  if (!chain) throw new Error(`Option chain unavailable for ${params.underlying}`);
  const optType: 'CE' | 'PE' = params.view === 'BULLISH' ? 'CE' : 'PE';
  const pick = (r: EnrichedOptionStrike) => (optType === 'CE' ? r.call : r.put);

  const atmRow = chain.rows.find((r) => r.atm) || chain.rows[Math.floor(chain.rows.length / 2)];
  const highestOiRow = chain.rows.reduce((b, c) => (pick(c).oi > pick(b).oi ? c : b), chain.rows[0]);
  const mostTradedRow = chain.rows.reduce((b, c) => (pick(c).volume > pick(b).volume ? c : b), chain.rows[0]);

  const toCard = (tag: string, badge: string, row: EnrichedOptionStrike) => {
    const d = pick(row);
    return {
      tag,
      badge,
      optionType: optType,
      strike: row.strike,
      symbol: d.tradingSymbol || `${chain.underlying}-${chain.expiry}-${row.strike}-${optType}`,
      lotSize: d.lotSize || chain.lotSize,
      ltp: d.ltp,
      bid: d.bid,
      ask: d.ask,
      oi: d.oi,
      oiChange: d.oiChange,
      volume: d.volume,
      iv: d.iv,
      delta: d.delta,
      buildup: d.buildup,
    };
  };

  return {
    underlying: chain.underlying,
    expiry: chain.expiry,
    spotPrice: chain.spotPrice,
    view: params.view,
    optionType: optType,
    cards: [
      toCard('ATM', 'At-The-Money (Balanced Delta)', atmRow),
      toCard('HIGHEST_OI', 'Highest Open Interest (Institutional)', highestOiRow),
      toCard('MOST_TRADED', 'Highest Volume (Tightest Spread)', mostTradedRow),
    ],
  };
}

/** Derivatives OI & Straddle Analytics (Strike OI profile, Trending OI, Multi-Strike OI, IV Skew, Straddle series). */
export async function getFnoAnalytics(underlying: string, expiry?: string) {
  const chain = await getEnrichedOptionChain(underlying, expiry);
  if (!chain) return null;

  const prisma = getPrisma();
  const snapshots = await prisma.optionChainSnapshot.findMany({
    where: { underlying: chain.underlying.toUpperCase(), expiry: chain.expiry },
    orderBy: { capturedAt: 'asc' },
    take: 180,
  });

  const center = chain.rows.findIndex((r) => r.atm);
  const idx = center >= 0 ? center : Math.floor(chain.rows.length / 2);
  const windowRows = chain.rows.slice(Math.max(0, idx - 10), Math.min(chain.rows.length, idx + 11));

  const oiProfile = windowRows.map((r) => ({
    strike: r.strike,
    atm: r.atm,
    ceOi: r.call.oi,
    peOi: r.put.oi,
    ceOiChange: r.call.oiChange,
    peOiChange: r.put.oiChange,
    ceIv: r.call.iv,
    peIv: r.put.iv,
    ceLtp: Number(r.call.ltp || 0),
    peLtp: Number(r.put.ltp || 0),
    straddlePrice: Number((Number(r.call.ltp || 0) + Number(r.put.ltp || 0)).toFixed(2)),
  }));

  const maxCallOiStrike = oiProfile.reduce((b, c) => (c.ceOi > b.ceOi ? c : b), oiProfile[0])?.strike ?? null;
  const maxPutOiStrike = oiProfile.reduce((b, c) => (c.peOi > b.peOi ? c : b), oiProfile[0])?.strike ?? null;

  const netCeChg = windowRows.reduce((s, r) => s + r.call.oiChange, 0);
  const netPeChg = windowRows.reduce((s, r) => s + r.put.oiChange, 0);

  return {
    underlying: chain.underlying,
    expiry: chain.expiry,
    spotPrice: chain.spotPrice,
    pcr: chain.pcr,
    maxPain: chain.maxPain,
    atmStrike: chain.atmStrike,
    atmStraddlePrice: chain.atmStraddlePrice,
    atmStraddlePct: chain.atmStraddlePct,
    resistanceStrike: maxCallOiStrike,
    supportStrike: maxPutOiStrike,
    netCallOiChange: netCeChg,
    netPutOiChange: netPeChg,
    trendingOiDiff: netPeChg - netCeChg,
    oiProfile,
    intradaySeries: snapshots.map((s) => ({
      time: s.capturedAt.toISOString(),
      spotPrice: Number(s.spotPrice),
      atmStrike: s.atmStrike,
      atmStraddle: s.atmStraddle,
      totalCeOi: s.totalCeOi,
      totalPeOi: s.totalPeOi,
      pcrOi: s.pcrOi,
      strikes: JSON.parse(s.strikesJson),
    })),
    templates: OPTION_STRATEGY_TEMPLATES,
  };
}

/**
 * Execute a Multi-Leg Strategy Basket atomically in DEMO or REAL mode.
 * Executes BUY legs first (for hedge margin benefit), followed by SELL legs.
 */
export async function executeBasketOrders(params: {
  userId: string;
  accountMode: AccountMode;
  product: ProductType;
  legs: Array<{
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price?: number;
    quoteOverride?: NormalizedQuote;
  }>;
  ipAddress?: string;
  nowOverride?: Date;
  allowAfterHoursDemo?: boolean;
}) {
  // Sort BUY legs ahead of SELL legs so hedge margin applies properly
  const ordered = [...params.legs].sort((a, b) => (a.side === 'BUY' && b.side === 'SELL' ? -1 : a.side === 'SELL' && b.side === 'BUY' ? 1 : 0));

  const results: Array<{
    symbol: string;
    side: 'BUY' | 'SELL';
    status: string;
    orderId?: string;
    fillPrice?: string | null;
    totalCharges?: string;
    blockchainHash?: string | null;
    error?: string;
  }> = [];

  for (const leg of ordered) {
    try {
      const res = await placeOrder({
        userId: params.userId,
        accountMode: params.accountMode,
        symbol: leg.symbol,
        side: leg.side,
        product: params.product,
        orderType: leg.price ? 'LIMIT' : 'MARKET',
        quantity: leg.quantity,
        price: leg.price ?? null,
        ipAddress: params.ipAddress,
        quoteOverride: leg.quoteOverride,
        nowOverride: params.nowOverride,
        allowAfterHoursDemo: params.allowAfterHoursDemo ?? true,
      });
      results.push({
        symbol: leg.symbol,
        side: leg.side,
        status: res.order.status,
        orderId: res.order.id,
        fillPrice: res.trade?.price ?? null,
        totalCharges: res.charges?.totalCharges,
        blockchainHash: res.blockchainProof?.hash ?? null,
      });
    } catch (err) {
      results.push({
        symbol: leg.symbol,
        side: leg.side,
        status: 'REJECTED',
        error: (err as Error).message,
      });
    }
  }

  return {
    accountMode: params.accountMode,
    totalLegs: ordered.length,
    succeeded: results.filter((r) => r.status === 'FILLED' || r.status === 'OPEN').length,
    failed: results.filter((r) => r.status === 'REJECTED').length,
    legs: results,
  };
}

/**
 * SEBI Expiry-Day ITM Option Auto-Exercise & Assignment Settlement.
 * - OTM options expire worthless (0 cash flow, margin released).
 * - ITM Long options auto-exercise: credits intrinsic value minus Finance Act 2026
 *   exercised-option STT (0.15% on intrinsic value!) and seals a SHA-256 Blockchain block.
 * - ITM Short options are assigned: debits intrinsic value, releases blocked margin, seals Blockchain block.
 */
export async function settleExpiredOptions(params: {
  userId: string;
  accountMode: AccountMode;
  settlementDate: string; // YYYY-MM-DD
  underlyingSpotPrices: Record<string, number>; // e.g. { NIFTY: 25950 }
}) {
  const prisma = getPrisma();
  const account = await prisma.tradingAccount.findUnique({
    where: { userId_mode: { userId: params.userId, mode: params.accountMode } },
  });
  if (!account) throw new Error('Account not found');

  const openOptionPositions = await prisma.position.findMany({
    where: {
      accountId: account.id,
      epoch: account.resetEpoch,
      netQuantity: { not: 0 },
      instrument: {
        instrumentKind: 'OPTIONS',
        expiryDate: { lte: params.settlementDate },
      },
    },
    include: { instrument: true },
  });

  const settlements: Array<{
    symbol: string;
    outcome: 'EXERCISED_ITM' | 'ASSIGNED_ITM' | 'EXPIRED_OTM';
    intrinsicPerUnit: string;
    grossSettlement: string;
    exerciseStt: string;
    netCashImpact: string;
    blockchainHash: string;
  }> = [];

  for (const pos of openOptionPositions) {
    const inst = pos.instrument;
    const strike = Number(inst.strikePrice || 0);
    const optType = inst.optionType as 'CE' | 'PE' | null;
    if (!optType || strike <= 0) continue;

    // Match underlying spot price
    const root = inst.symbol.split('-')[0].split(' ')[0].toUpperCase();
    const spot = params.underlyingSpotPrices[root] ?? params.underlyingSpotPrices[inst.symbol.toUpperCase()];
    if (!spot || spot <= 0) continue;

    const intrinsicPerUnit =
      optType === 'CE' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    const qty = Math.abs(pos.netQuantity);
    const isLong = pos.netQuantity > 0;
    const isItm = intrinsicPerUnit > 0;

    let outcome: 'EXERCISED_ITM' | 'ASSIGNED_ITM' | 'EXPIRED_OTM' = 'EXPIRED_OTM';
    let grossSettlement = ZERO;
    let exerciseStt = ZERO;
    let netCashImpact = ZERO;

    if (isItm) {
      grossSettlement = roundPaise(D(intrinsicPerUnit).mul(qty));
      if (isLong) {
        outcome = 'EXERCISED_ITM';
        // Finance Act 2026: 0.15% STT on exercised ITM option intrinsic value
        const cb = calculateTradeCharges({
          exchange: inst.exchange as ExchangeCode,
          segment: 'FNO',
          instrumentKind: 'OPTIONS',
          product: pos.product as ProductType,
          side: 'BUY',
          quantity: qty,
          price: spot,
          strikePrice: strike,
          isOptionExercise: true,
          asOfDate: params.settlementDate,
        });
        exerciseStt = D(cb.sttOrCtt);
        netCashImpact = roundPaise(grossSettlement.minus(exerciseStt));
      } else {
        outcome = 'ASSIGNED_ITM';
        netCashImpact = roundPaise(grossSettlement.neg());
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const freshAcc = await tx.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
      const newCash = roundPaise(D(freshAcc.cashBalance).plus(netCashImpact));
      const newBlocked = roundPaise(
        Decimal.max(ZERO, D(freshAcc.blockedMargin).minus(D(pos.blockedMargin)))
      );

      await tx.tradingAccount.update({
        where: { id: account.id },
        data: { cashBalance: newCash.toFixed(2), blockedMargin: newBlocked.toFixed(2) },
      });

      await tx.position.update({
        where: { id: pos.id },
        data: {
          netQuantity: 0,
          blockedMargin: '0.00',
          realizedPnl: roundPaise(D(pos.realizedPnl).plus(netCashImpact)).toFixed(2),
        },
      });

      const entry = await tx.ledgerEntry.create({
        data: {
          accountId: account.id,
          epoch: account.resetEpoch,
          entryType: 'MTM',
          debit: netCashImpact.isNegative() ? netCashImpact.abs().toFixed(2) : '0.00',
          credit: netCashImpact.isPositive() ? netCashImpact.toFixed(2) : '0.00',
          runningBalance: newCash.toFixed(2),
          description: `Expiry ${outcome} for ${qty} ${inst.symbol} (Spot ₹${spot}, Strike ₹${strike}, Exercise STT ₹${exerciseStt.toFixed(2)})`,
        },
      });
      return entry;
    });

    const block = await blockchainService.appendAndPersist({
      recordId: updated.id,
      kind: 'TRADE_EXECUTION',
      accountMode: params.accountMode,
      accountId: account.id,
      userId: params.userId,
      symbol: inst.symbol,
      side: outcome,
      quantity: qty,
      price: intrinsicPerUnit.toFixed(2),
      totalCharges: exerciseStt.toFixed(2),
      amountDelta: netCashImpact.toFixed(2),
      metadata: { settlementDate: params.settlementDate, spot, strike },
    });

    settlements.push({
      symbol: inst.symbol,
      outcome,
      intrinsicPerUnit: intrinsicPerUnit.toFixed(2),
      grossSettlement: grossSettlement.toFixed(2),
      exerciseStt: exerciseStt.toFixed(2),
      netCashImpact: netCashImpact.toFixed(2),
      blockchainHash: block.hash,
    });
  }

  return {
    settlementDate: params.settlementDate,
    settledCount: settlements.length,
    settlements,
  };
}
