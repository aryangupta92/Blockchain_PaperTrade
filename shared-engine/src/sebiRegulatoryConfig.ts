/**
 * Effective-Dated SEBI, Exchange & Statutory Tax Configuration.
 *
 * RULE 1.3: All regulatory parameters are effective-dated so a rule change is
 *           a config update (not a code rewrite) and historical trades preserve
 *           the exact rules in force on their execution date.
 * RULE 1.6: Unconfirmed exchange/DP figures are explicitly tagged `TO_VERIFY`.
 */

export type VerificationState = 'VERIFIED' | 'TO_VERIFY' | 'PLACEHOLDER';

export interface RegulatoryEntry<T> {
  key: string;
  effectiveFrom: string; // ISO YYYY-MM-DD (IST)
  value: T;
  verification: VerificationState;
  citation: string;
  notes?: string;
}

export interface SttRatesConfig {
  eqDeliveryBuyPct: string;
  eqDeliverySellPct: string;
  eqIntradaySellPct: string;
  fnoFuturesSellPct: string;
  fnoOptionsSellPremiumPct: string;
  fnoOptionsExerciseIntrinsicPct: string;
  mcxNonAgriFuturesSellPct: string;
  mcxNonAgriOptionsSellPremiumPct: string;
  roundToNearestRupee: boolean;
}

export interface ExchangeChargesConfig {
  nseEqPct: string;
  bseEqPct: string;
  nseFuturesPct: string;
  bseFuturesPct: string;
  nseOptionsPremiumPct: string;
  bseOptionsPremiumPct: string;
  mcxFuturesPct: string;
  mcxOptionsPremiumPct: string;
}

export interface StampDutyConfig {
  eqDeliveryBuyPct: string;
  eqIntradayBuyPct: string;
  fnoFuturesBuyPct: string;
  fnoOptionsBuyPremiumPct: string;
  mcxFuturesBuyPct: string;
  mcxOptionsBuyPremiumPct: string;
}

export interface BrokeragePlanConfig {
  planName: string;
  eqDeliveryPct: string;
  eqDeliveryMaxPerOrder: string;
  eqIntradayPct: string;
  eqIntradayMaxPerOrder: string;
  fnoFuturesPct: string;
  fnoFuturesMaxPerOrder: string;
  fnoOptionsFlatPerOrder: string;
  mcxFuturesPct: string;
  mcxFuturesMaxPerOrder: string;
  mcxOptionsFlatPerOrder: string;
}

export interface SebiFnoRulesConfig {
  weeklyExpiryIndices: {
    NSE: string[];
    BSE: string[];
  };
  minContractNotionalINR: string;
  maxContractNotionalINR: string;
  upfrontOptionPremiumPct: string;
  calendarSpreadBenefitOnExpiryDay: boolean;
  expiryDayShortOptionExtraElmPct: string;
  misAutoSquareOffIST: string;
  equitySettlementCycle: 'T+1';
}

export interface TradingHoursConfig {
  equityPreOpenStartIST: string;
  equityPreOpenEndIST: string;
  equityOpenIST: string;
  equityCloseIST: string;
  equityPostCloseEndIST: string;
  mcxOpenIST: string;
  mcxCloseIST: string; // TO_VERIFY seasonal US DST shift (23:30 vs 23:55)
}

export interface EffectiveRegulatorySnapshot {
  asOfDate: string;
  stt: RegulatoryEntry<SttRatesConfig>;
  exchangeCharges: RegulatoryEntry<ExchangeChargesConfig>;
  sebiTurnoverFeePct: RegulatoryEntry<string>;
  stampDuty: RegulatoryEntry<StampDutyConfig>;
  gstPct: RegulatoryEntry<string>;
  dpSellChargePerScripExclGst: RegulatoryEntry<string>;
  brokerage: RegulatoryEntry<BrokeragePlanConfig>;
  fnoRules: RegulatoryEntry<SebiFnoRulesConfig>;
  tradingHours: RegulatoryEntry<TradingHoursConfig>;
}

// ── Effective-Dated Schedules ─────────────────────────────────────────────────

export const STT_SCHEDULES: RegulatoryEntry<SttRatesConfig>[] = [
  {
    key: 'stt.schedule',
    effectiveFrom: '2024-10-01',
    verification: 'VERIFIED',
    citation: 'Finance (No. 2) Act, 2024 (effective Oct 1, 2024)',
    value: {
      eqDeliveryBuyPct: '0.1',
      eqDeliverySellPct: '0.1',
      eqIntradaySellPct: '0.025',
      fnoFuturesSellPct: '0.02',
      fnoOptionsSellPremiumPct: '0.1',
      fnoOptionsExerciseIntrinsicPct: '0.125',
      mcxNonAgriFuturesSellPct: '0.01',
      mcxNonAgriOptionsSellPremiumPct: '0.05',
      roundToNearestRupee: true,
    },
  },
  {
    key: 'stt.schedule',
    effectiveFrom: '2026-04-01',
    verification: 'VERIFIED',
    citation: 'Finance Act, 2026 (Union Budget 2026, effective Apr 1, 2026)',
    notes: 'MCX CTT rates marked TO_VERIFY against latest MCX/Finance Act circular.',
    value: {
      eqDeliveryBuyPct: '0.1',
      eqDeliverySellPct: '0.1',
      eqIntradaySellPct: '0.025',
      fnoFuturesSellPct: '0.05',
      fnoOptionsSellPremiumPct: '0.15',
      fnoOptionsExerciseIntrinsicPct: '0.15',
      mcxNonAgriFuturesSellPct: '0.01',
      mcxNonAgriOptionsSellPremiumPct: '0.05',
      roundToNearestRupee: true,
    },
  },
];

export const EXCHANGE_CHARGES_SCHEDULES: RegulatoryEntry<ExchangeChargesConfig>[] = [
  {
    key: 'exchange.transaction_charges',
    effectiveFrom: '2024-10-01',
    verification: 'TO_VERIFY',
    citation: 'SEBI True-to-Label Circular (2024) + NSE/BSE/MCX Segment Circulars',
    notes: 'Verify exact current bps & IPFT adjustments per exchange circular before live REAL rollout.',
    value: {
      nseEqPct: '0.00297',
      bseEqPct: '0.00375',
      nseFuturesPct: '0.00173',
      bseFuturesPct: '0.002',
      nseOptionsPremiumPct: '0.03503',
      bseOptionsPremiumPct: '0.0325',
      mcxFuturesPct: '0.0021',
      mcxOptionsPremiumPct: '0.0418',
    },
  },
];

export const SEBI_TURNOVER_SCHEDULES: RegulatoryEntry<string>[] = [
  {
    key: 'sebi.turnover_fee_pct',
    effectiveFrom: '2024-01-01',
    verification: 'VERIFIED',
    citation: 'SEBI (Payment of Fees) Regulations — ₹10 per crore (0.0001%)',
    value: '0.0001',
  },
];

export const STAMP_DUTY_SCHEDULES: RegulatoryEntry<StampDutyConfig>[] = [
  {
    key: 'stamp_duty.schedule',
    effectiveFrom: '2020-07-01',
    verification: 'VERIFIED',
    citation: 'Indian Stamp Act, 1899 (Unified Rates, Buy-Side Only)',
    value: {
      eqDeliveryBuyPct: '0.015',
      eqIntradayBuyPct: '0.003',
      fnoFuturesBuyPct: '0.002',
      fnoOptionsBuyPremiumPct: '0.003',
      mcxFuturesBuyPct: '0.002',
      mcxOptionsBuyPremiumPct: '0.003',
    },
  },
];

export const GST_SCHEDULES: RegulatoryEntry<string>[] = [
  {
    key: 'gst.rate_pct',
    effectiveFrom: '2017-07-01',
    verification: 'VERIFIED',
    citation: 'CGST / IGST Act — 18% on Brokerage + Exchange Txn + SEBI Turnover Fee',
    value: '18',
  },
];

export const DP_CHARGE_SCHEDULES: RegulatoryEntry<string>[] = [
  {
    key: 'dp.sell_charge_excl_gst',
    effectiveFrom: '2025-01-01',
    verification: 'TO_VERIFY',
    citation: 'CDSL / NSDL Depository + Partner DP Tariff (Placeholder ₹13.50 + 18% GST = ₹15.93)',
    notes: 'Applies once per scrip per day on Equity/ETF CNC sell delivery.',
    value: '13.50',
  },
];

export const BROKERAGE_SCHEDULES: RegulatoryEntry<BrokeragePlanConfig>[] = [
  {
    key: 'brokerage.default_plan',
    effectiveFrom: '2026-01-01',
    verification: 'PLACEHOLDER',
    citation: 'Approved Default Discount Plan (Configurable per plan)',
    value: {
      planName: 'Standard Discount Plan',
      eqDeliveryPct: '0',
      eqDeliveryMaxPerOrder: '0',
      eqIntradayPct: '0.03',
      eqIntradayMaxPerOrder: '20',
      fnoFuturesPct: '0.03',
      fnoFuturesMaxPerOrder: '20',
      fnoOptionsFlatPerOrder: '20',
      mcxFuturesPct: '0.03',
      mcxFuturesMaxPerOrder: '20',
      mcxOptionsFlatPerOrder: '20',
    },
  },
];

export const FNO_RULES_SCHEDULES: RegulatoryEntry<SebiFnoRulesConfig>[] = [
  {
    key: 'sebi.fno_framework',
    effectiveFrom: '2025-02-01',
    verification: 'VERIFIED',
    citation: 'SEBI/HO/MRD/TPD/P/CIR/2024/132 (Oct 1, 2024; full phase-in Feb 1, 2025)',
    value: {
      weeklyExpiryIndices: {
        NSE: ['NIFTY'],
        BSE: ['SENSEX'],
      },
      minContractNotionalINR: '1500000',
      maxContractNotionalINR: '2000000',
      upfrontOptionPremiumPct: '100',
      calendarSpreadBenefitOnExpiryDay: false,
      expiryDayShortOptionExtraElmPct: '2',
      misAutoSquareOffIST: '15:15',
      equitySettlementCycle: 'T+1',
    },
  },
];

export const TRADING_HOURS_SCHEDULES: RegulatoryEntry<TradingHoursConfig>[] = [
  {
    key: 'exchange.trading_hours',
    effectiveFrom: '2024-01-01',
    verification: 'TO_VERIFY',
    citation: 'NSE/BSE Cash & F&O Circulars; MCX Circular (DST shifts 23:30 / 23:55 IST)',
    value: {
      equityPreOpenStartIST: '09:00',
      equityPreOpenEndIST: '09:15',
      equityOpenIST: '09:15',
      equityCloseIST: '15:30',
      equityPostCloseEndIST: '16:00',
      mcxOpenIST: '09:00',
      mcxCloseIST: '23:30',
    },
  },
];

function selectEffective<T>(entries: RegulatoryEntry<T>[], asOfDate: string): RegulatoryEntry<T> {
  const sorted = [...entries].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let chosen = sorted[0];
  for (const entry of sorted) {
    if (entry.effectiveFrom <= asOfDate) {
      chosen = entry;
    }
  }
  return chosen;
}

/** Resolve all active effective-dated regulatory rules as of a given ISO date (YYYY-MM-DD). */
export function resolveRegulatoryConfig(asOf: Date | string = new Date()): EffectiveRegulatorySnapshot {
  const asOfDate = typeof asOf === 'string' ? asOf.slice(0, 10) : asOf.toISOString().slice(0, 10);
  return {
    asOfDate,
    stt: selectEffective(STT_SCHEDULES, asOfDate),
    exchangeCharges: selectEffective(EXCHANGE_CHARGES_SCHEDULES, asOfDate),
    sebiTurnoverFeePct: selectEffective(SEBI_TURNOVER_SCHEDULES, asOfDate),
    stampDuty: selectEffective(STAMP_DUTY_SCHEDULES, asOfDate),
    gstPct: selectEffective(GST_SCHEDULES, asOfDate),
    dpSellChargePerScripExclGst: selectEffective(DP_CHARGE_SCHEDULES, asOfDate),
    brokerage: selectEffective(BROKERAGE_SCHEDULES, asOfDate),
    fnoRules: selectEffective(FNO_RULES_SCHEDULES, asOfDate),
    tradingHours: selectEffective(TRADING_HOURS_SCHEDULES, asOfDate),
  };
}
