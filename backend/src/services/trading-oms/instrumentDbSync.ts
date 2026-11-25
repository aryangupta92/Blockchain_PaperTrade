import { getPrisma } from '../../infrastructure/database';
import { MasterInstrument, resolveInstrument } from '../market-data/instrumentMaster';

// Dynamic per-stock VaR + ELM upfront margin % (SEBI Peak Margin framework — never a flat 5x).
// Group 1 high-liquidity NIFTY 50 stocks carry ~20% VaR+ELM (up to 5x MIS); other equities carry 25%–33%.
const GROUP1_LIQUID_SYMBOLS = new Set([
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'BHARTIARTL', 'ITC',
  'LT', 'AXISBANK', 'KOTAKBANK', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'SUNPHARMA',
  'TITAN', 'NTPC', 'TATAMOTORS', 'M&M', 'ULTRACEMCO', 'WIPRO', 'HCLTECH', 'POWERGRID',
  'ADANIPORTS', 'ASIANPAINT', 'ONGC', 'JSWSTEEL', 'COALINDIA', 'BAJAJFINSV', 'GRASIM',
]);

// Exchange freeze quantities for major index F&O (configurable via Regulatory Watch in Phase 8)
const FREEZE_QTY_BY_UNDERLYING: Record<string, number> = {
  NIFTY: 1800,
  BANKNIFTY: 900,
  FINNIFTY: 1800,
  MIDCPNIFTY: 2800,
  SENSEX: 1000,
  BANKEX: 900,
};

function computeDefaultVarElmPct(inst: MasterInstrument): string {
  if (inst.segment === 'ETF') return '20.00';
  if (inst.segment === 'EQ') {
    const bare = inst.tradingSymbol.toUpperCase().replace(/-EQ$/, '');
    return GROUP1_LIQUID_SYMBOLS.has(bare) ? '20.00' : '25.00';
  }
  if (inst.segment === 'FNO') {
    return inst.instrumentKind === 'OPTIONS' ? '100.00' : '15.00';
  }
  if (inst.segment === 'COMM') return '12.00';
  return '25.00';
}

function inferFreezeQty(inst: MasterInstrument): number | null {
  if (inst.segment !== 'FNO') return null;
  for (const [prefix, qty] of Object.entries(FREEZE_QTY_BY_UNDERLYING)) {
    if (inst.tradingSymbol.toUpperCase().startsWith(prefix)) return qty;
  }
  return null;
}

/**
 * Resolve any symbol or neutral instrumentId from the live scrip master
 * and upsert its Prisma `Instrument` row for ACID foreign-key integrity.
 */
export async function ensureDbInstrument(symbolOrId: string) {
  const master = await resolveInstrument(symbolOrId);
  if (!master) {
    const err = new Error(`Instrument "${symbolOrId}" was not found in the exchange master.`) as Error & {
      statusCode?: number;
      code?: string;
    };
    err.statusCode = 404;
    err.code = 'INSTRUMENT_NOT_FOUND';
    throw err;
  }

  const prisma = getPrisma();
  const rawTick = parseFloat(master.tickSize || '0.05');
  const tickSize = (Number.isFinite(rawTick) && rawTick > 0 ? (rawTick >= 1 ? rawTick / 100 : rawTick) : 0.05).toFixed(2);
  const varElmMarginPct = computeDefaultVarElmPct(master);
  const freezeQty = master.freezeQty ?? inferFreezeQty(master);
  const mtfLeverage =
    master.mtfLeverage ??
    (master.segment === 'EQ' && GROUP1_LIQUID_SYMBOLS.has(master.tradingSymbol.toUpperCase().replace(/-EQ$/, ''))
      ? '4.00'
      : master.segment === 'EQ' || master.segment === 'ETF'
        ? '3.00'
        : '1.00');

  const row = await prisma.instrument.upsert({
    where: {
      exchange_segment_providerSecId: {
        exchange: master.exchange,
        segment: master.segment,
        providerSecId: master.providerSecId,
      },
    },
    create: {
      providerSecId: master.providerSecId,
      exchange: master.exchange,
      segment: master.segment,
      symbol: master.instrumentKind === 'INDEX' ? master.symbol : master.tradingSymbol,
      displayName: master.displayName,
      instrumentKind: master.instrumentKind,
      isin: master.isin ?? null,
      lotSize: master.lotSize,
      tickSize,
      freezeQty,
      expiryDate: master.expiryDate,
      strikePrice: master.strikePrice,
      optionType: master.optionType,
      varElmMarginPct,
      mtfLeverage,
      upperCircuit: master.upperCircuit ?? null,
      lowerCircuit: master.lowerCircuit ?? null,
      asmGsmFlag: master.asmGsmFlag ?? null,
      bracketEligible: master.bracketEligible ?? true,
      coverEligible: master.coverEligible ?? true,
    },
    update: {
      symbol: master.instrumentKind === 'INDEX' ? master.symbol : master.tradingSymbol,
      displayName: master.displayName,
      isin: master.isin ?? undefined,
      lotSize: master.lotSize,
      tickSize,
      freezeQty,
      expiryDate: master.expiryDate,
      strikePrice: master.strikePrice,
      optionType: master.optionType,
      mtfLeverage,
      upperCircuit: master.upperCircuit ?? undefined,
      lowerCircuit: master.lowerCircuit ?? undefined,
      asmGsmFlag: master.asmGsmFlag ?? undefined,
    },
  });

  return { dbInstrument: row, master };
}
