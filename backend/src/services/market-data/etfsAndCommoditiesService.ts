import { getMasterIndex, MasterInstrument } from './instrumentMaster';
import { marketDataService } from './marketDataService';
import { getMarketSession } from './marketSessionClock';

export type EtfCategory = 'GOLD' | 'SILVER' | 'INDEX' | 'SECTORAL' | 'LIQUID_DEBT' | 'OTHER';
export type CommodityGroup = 'BULLION' | 'ENERGY' | 'BASE_METALS' | 'OTHER';

const SECTOR_BASKETS: Record<string, string[]> = {
  Banking: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK'],
  IT: ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM'],
  Energy: ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'COALINDIA'],
  Auto: ['MARUTI', 'M&M', 'TATAMOTORS', 'BAJAJ-AUTO', 'EICHERMOT'],
  FMCG: ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM'],
  Pharma: ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'APOLLOHOSP'],
  InfraMetals: ['LT', 'JSWSTEEL', 'TATASTEEL', 'HINDALCO', 'ULTRACEMCO'],
  Financials: ['BAJFINANCE', 'BAJAJFINSV', 'SBILIFE', 'HDFCLIFE'],
};

function classifyEtf(inst: MasterInstrument): EtfCategory {
  const s = `${inst.tradingSymbol} ${inst.displayName}`.toUpperCase();
  if (s.includes('GOLD')) return 'GOLD';
  if (s.includes('SILVER')) return 'SILVER';
  if (s.includes('LIQUID') || s.includes('GILT') || s.includes('BOND') || s.includes('SDL')) return 'LIQUID_DEBT';
  if (
    s.includes('ITBEES') || s.includes('PHARMA') || s.includes('PSUBNK') ||
    s.includes('AUTO') || s.includes('INFRA') || s.includes('CONSUM') || s.includes('FMCG')
  ) return 'SECTORAL';
  if (
    s.includes('NIFTY') || s.includes('SENSEX') || s.includes('BANKBEES') ||
    s.includes('JUNIOR') || s.includes('MID150') || s.includes('NEXT50')
  ) return 'INDEX';
  return 'OTHER';
}

function classifyCommodity(inst: MasterInstrument): CommodityGroup {
  const s = inst.tradingSymbol.toUpperCase();
  if (s.startsWith('GOLD') || s.startsWith('SILVER')) return 'BULLION';
  if (s.startsWith('CRUDEOIL') || s.startsWith('NATURALGAS') || s.startsWith('NATGAS')) return 'ENERGY';
  if (
    s.startsWith('COPPER') || s.startsWith('ZINC') ||
    s.startsWith('ALUMINIUM') || s.startsWith('ALUMINI') || s.startsWith('LEAD')
  ) return 'BASE_METALS';
  return 'OTHER';
}

const FEATURED_ETF_SYMBOLS = [
  'GOLDBEES', 'HDFCGOLD', 'SETFGOLD',
  'SILVERBEES', 'HDFCSILVER',
  'NIFTYBEES', 'BANKBEES', 'JUNIORBEES', 'MID150BEES', 'SETFNIF50',
  'ITBEES', 'PHARMABEES', 'PSUBNKBEES', 'AUTOBEES',
  'LIQUIDBEES', 'LIQUIDCASE', 'LTGILTBEES',
];

export async function getEtfCatalog(category?: string, includeQuotes = true) {
  const master = await getMasterIndex();
  const catFilter = category && category !== 'ALL' ? (category.toUpperCase() as EtfCategory) : null;

  const allEtfs = master.list
    .filter((i) => i.segment === 'ETF' && (i.exchange === 'NSE' || i.exchange === 'BSE'))
    .map((i) => ({
      instrumentId: i.instrumentId,
      symbol: i.tradingSymbol,
      displayName: i.displayName,
      exchange: i.exchange,
      segment: i.segment,
      lotSize: i.lotSize,
      tickSize: i.tickSize,
      category: classifyEtf(i),
      featured: FEATURED_ETF_SYMBOLS.includes(i.tradingSymbol.toUpperCase()),
    }));

  // Prioritize NSE featured ETFs first, then remaining ETFs
  const filtered = allEtfs
    .filter((e) => (!catFilter ? true : e.category === catFilter))
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.exchange !== b.exchange) return a.exchange === 'NSE' ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });

  const top = filtered.slice(0, 40);
  const quotes =
    includeQuotes && top.length > 0
      ? await marketDataService.getQuotes(top.slice(0, 25).map((e) => e.instrumentId)).catch(() => [])
      : [];
  const qMap = new Map(quotes.map((q) => [q.instrumentId, q]));

  const countsByCategory: Record<EtfCategory, number> = {
    GOLD: 0,
    SILVER: 0,
    INDEX: 0,
    SECTORAL: 0,
    LIQUID_DEBT: 0,
    OTHER: 0,
  };
  for (const e of allEtfs) countsByCategory[e.category]++;

  return {
    totalCatalogCount: allEtfs.length,
    countsByCategory,
    etfs: top.map((e) => {
      const q = qMap.get(e.instrumentId);
      return {
        ...e,
        ltp: q?.ltp ?? null,
        change: q?.change ?? null,
        changePercent: q?.changePercent ?? null,
        volume: q?.volume ?? null,
        freshness: q?.freshness ?? 'UNAVAILABLE',
      };
    }),
  };
}

export async function getCommodityContracts(params: {
  group?: string;
  kind?: string;
  includeQuotes?: boolean;
}) {
  const master = await getMasterIndex();
  const groupFilter = params.group && params.group !== 'ALL' ? (params.group.toUpperCase() as CommodityGroup) : null;
  const kindFilter = params.kind && params.kind !== 'ALL' ? params.kind.toUpperCase() : null;

  const today = new Date().toISOString().slice(0, 10);

  const allMcx = master.list
    .filter((i) => i.exchange === 'MCX' && i.segment === 'COMM')
    .filter((i) => !i.expiryDate || i.expiryDate.slice(0, 10) >= today)
    .map((i) => ({
      instrumentId: i.instrumentId,
      symbol: i.tradingSymbol,
      underlying: i.symbol,
      displayName: i.displayName,
      exchange: i.exchange,
      segment: i.segment,
      instrumentKind: i.instrumentKind,
      group: classifyCommodity(i),
      lotSize: i.lotSize,
      tickSize: i.tickSize,
      expiryDate: i.expiryDate,
      strikePrice: i.strikePrice,
      optionType: i.optionType,
    }));

  const filtered = allMcx
    .filter((c) => (!groupFilter ? true : c.group === groupFilter))
    .filter((c) => (!kindFilter ? true : c.instrumentKind === kindFilter))
    .sort((a, b) => {
      // Near-month futures first
      if (a.instrumentKind !== b.instrumentKind) return a.instrumentKind === 'FUTURES' ? -1 : 1;
      const expA = a.expiryDate || '9999-12-31';
      const expB = b.expiryDate || '9999-12-31';
      if (expA !== expB) return expA.localeCompare(expB);
      return a.symbol.localeCompare(b.symbol);
    });

  // Deduplicate top liquid near-month contracts for quick terminal view (up to 40)
  const top = filtered.slice(0, 40);
  const quotes =
    params.includeQuotes !== false && top.length > 0
      ? await marketDataService.getQuotes(top.slice(0, 20).map((c) => c.instrumentId)).catch(() => [])
      : [];
  const qMap = new Map(quotes.map((q) => [q.instrumentId, q]));

  const session = getMarketSession();

  return {
    exchange: 'MCX',
    session: session.commoditiesMcx,
    regulatoryNote:
      'In India, Gold, Silver, Crude Oil, Natural Gas, and Base Metals trade as regulated MCX Commodity Derivatives (Futures & Options) with dedicated trading hours (09:00–23:30 IST), MCX lot sizes, and CTT (Commodities Transaction Tax).',
    totalActiveContracts: allMcx.length,
    contracts: top.map((c) => {
      const q = qMap.get(c.instrumentId);
      return {
        ...c,
        ltp: q?.ltp ?? null,
        change: q?.change ?? null,
        changePercent: q?.changePercent ?? null,
        volume: q?.volume ?? null,
        openInterest: q?.openInterest ?? null,
        freshness: q?.freshness ?? 'UNAVAILABLE',
      };
    }),
  };
}

/**
 * Live Market Overview Analytics computed strictly from our primary Market Data feed:
 * Top Gainers, Top Losers, Most Active by Volume, and 8-Sector Heatmap.
 */
export async function getMarketAnalytics() {
  const allSymbols = [...new Set(Object.values(SECTOR_BASKETS).flat())];
  const quotes = await marketDataService.getQuotes(allSymbols).catch(() => []);
  const liveQuotes = quotes.filter((q) => q.ltp != null && Number(q.ltp) > 0);
  const bySymbol = new Map(liveQuotes.map((q) => [q.symbol.toUpperCase(), q]));

  const withChange = liveQuotes
    .filter((q) => q.changePercent != null)
    .map((q) => ({
      symbol: q.symbol,
      exchange: q.exchange,
      segment: q.segment,
      ltp: q.ltp!,
      change: q.change || '0.00',
      changePercent: Number(q.changePercent),
      volume: q.volume ?? 0,
      freshness: q.freshness,
    }));

  const gainers = [...withChange]
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 6);

  const losers = [...withChange]
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, 6);

  const mostActive = [...withChange]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 6);

  const sectors = Object.entries(SECTOR_BASKETS).map(([sector, syms]) => {
    const members = syms
      .map((s) => bySymbol.get(s))
      .filter((q): q is NonNullable<typeof q> => Boolean(q && q.changePercent != null));
    const avgPct =
      members.length > 0
        ? Number((members.reduce((sum, q) => sum + Number(q.changePercent || 0), 0) / members.length).toFixed(2))
        : 0;
    const advancers = members.filter((q) => Number(q.changePercent || 0) > 0).length;
    const decliners = members.filter((q) => Number(q.changePercent || 0) < 0).length;
    return {
      sector,
      avgChangePercent: avgPct,
      advancers,
      decliners,
      tracked: members.length,
    };
  });

  const session = getMarketSession();

  return {
    session,
    gainers,
    losers,
    mostActive,
    sectors,
    trackedCount: liveQuotes.length,
    timestamp: new Date().toISOString(),
  };
}
