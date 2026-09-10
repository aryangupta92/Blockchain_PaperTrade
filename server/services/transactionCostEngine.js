/**
 * transactionCostEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Calculates Indian brokerage transaction costs for all trade types.
 *
 * Covers:
 *  - Flat ₹20 brokerage (Zerodha/Dhan-style discount broker model)
 *  - STT (Securities Transaction Tax) — SEBI 2024 revised rates
 *  - Exchange transaction charges (NSE/BSE)
 *  - GST on (brokerage + exchange charges + SEBI fee)
 *  - SEBI charges
 *  - Stamp duty (buyer only, union rates post-2020)
 *  - Break-even price calculation
 *
 * Key fix v2: Options STT is computed on PREMIUM turnover, not notional value.
 * Futures STT is on the SELL side only at 0.02% of turnover.
 */

'use strict';

// ─── Rate Constants ────────────────────────────────────────────────────────────
const RATES = {
  BROKERAGE_FLAT:    20,        // ₹20 per executed order (discount broker)
  BROKERAGE_MAX_PCT: 0.0025,    // 0.25% cap (whichever is lower applies)

  STT: {
    EQUITY_DELIVERY:  0.001,    // 0.1% on both buy & sell
    EQUITY_INTRADAY:  0.00025,  // 0.025% on sell side only
    FUTURES_SELL:     0.0002,   // 0.02% on sell side (on futures turnover)
    OPTIONS_BUY:      0.001,    // 0.1% on premium on buy side
    OPTIONS_SELL:     0.001,    // 0.1% on premium on sell side
  },

  NSE_CHARGES: {
    EQUITY:   0.0000322,        // ₹3.22 per lakh
    FUTURES:  0.0000019,        // ₹1.9 per lakh (corrected from old value)
    OPTIONS:  0.000053,         // ₹53 per lakh on premium turnover
  },

  BSE_CHARGES: {
    EQUITY:   0.0000375,
    FUTURES:  0.0000019,
    OPTIONS:  0.000053,
  },

  GST:      0.18,               // 18% GST on (brokerage + exchange + SEBI)
  SEBI_FEE: 0.000001,           // ₹1 per crore = 0.000001 of turnover

  STAMP_DUTY: {
    EQUITY_DELIVERY:  0.00015,  // 0.015% on buy side
    EQUITY_INTRADAY:  0.00003,  // 0.003% on buy side
    FUTURES:          0.00002,  // 0.002% on buy side
    OPTIONS:          0.00003,  // 0.003% on buy side
  },
};

/**
 * Calculate complete transaction costs for a trade.
 *
 * @param {object} params
 * @param {number}  params.price          Execution price per unit (premium for options)
 * @param {number}  params.quantity       Number of units
 * @param {'buy'|'sell'} params.side      Trade direction
 * @param {'CNC'|'MIS'|'NRML'|'DELIVERY'|'INTRADAY'} params.productType
 * @param {'EQUITY'|'FUTURES'|'OPTIONS'} params.instrumentType
 * @param {'NSE'|'BSE'} params.exchange
 * @param {number}  [params.lotSize=1]    For F&O contracts
 * @returns {CostBreakdown}
 */
function calculate({ price, quantity, side, productType = 'CNC', instrumentType = 'EQUITY', exchange = 'NSE', lotSize = 1 }) {
  const qty      = Number(quantity);
  const px       = Number(price);
  const turnover = qty * px; // For options this is premium turnover (correct for STT/exchange)

  // Normalize product type
  const pt = (productType || 'CNC').toUpperCase().replace('DELIVERY', 'CNC').replace('INTRADAY', 'MIS');

  // ── Brokerage ────────────────────────────────────────────────────────────────
  const brokerageCap = turnover * RATES.BROKERAGE_MAX_PCT;
  const brokerage    = Math.min(RATES.BROKERAGE_FLAT, brokerageCap);

  // ── STT ──────────────────────────────────────────────────────────────────────
  let stt = 0;
  if (instrumentType === 'EQUITY') {
    if (pt === 'CNC') {
      stt = turnover * RATES.STT.EQUITY_DELIVERY; // both sides
    } else {
      // MIS — only on sell
      if (side === 'sell') stt = turnover * RATES.STT.EQUITY_INTRADAY;
    }
  } else if (instrumentType === 'FUTURES') {
    // Futures STT on sell side only, on futures turnover
    if (side === 'sell') stt = turnover * RATES.STT.FUTURES_SELL;
  } else if (instrumentType === 'OPTIONS') {
    // Options STT is on PREMIUM turnover (not notional), both sides
    stt = turnover * (side === 'buy' ? RATES.STT.OPTIONS_BUY : RATES.STT.OPTIONS_SELL);
  }

  // ── Exchange transaction charges ─────────────────────────────────────────────
  const exchangeRates = exchange === 'BSE' ? RATES.BSE_CHARGES : RATES.NSE_CHARGES;
  let exchangeFee = 0;
  if (instrumentType === 'EQUITY')   exchangeFee = turnover * exchangeRates.EQUITY;
  if (instrumentType === 'FUTURES')  exchangeFee = turnover * exchangeRates.FUTURES;
  if (instrumentType === 'OPTIONS')  exchangeFee = turnover * exchangeRates.OPTIONS;

  // ── SEBI fee ─────────────────────────────────────────────────────────────────
  const sebiFee = turnover * RATES.SEBI_FEE;

  // ── GST on (brokerage + exchange fee + SEBI fee) ─────────────────────────────
  const gst = (brokerage + exchangeFee + sebiFee) * RATES.GST;

  // ── Stamp duty (buyer only) ───────────────────────────────────────────────────
  let stampDuty = 0;
  if (side === 'buy') {
    if (instrumentType === 'EQUITY' && pt === 'CNC') stampDuty = turnover * RATES.STAMP_DUTY.EQUITY_DELIVERY;
    if (instrumentType === 'EQUITY' && pt === 'MIS') stampDuty = turnover * RATES.STAMP_DUTY.EQUITY_INTRADAY;
    if (instrumentType === 'FUTURES')  stampDuty = turnover * RATES.STAMP_DUTY.FUTURES;
    if (instrumentType === 'OPTIONS')  stampDuty = turnover * RATES.STAMP_DUTY.OPTIONS;
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  const totalCost  = brokerage + stt + exchangeFee + gst + stampDuty + sebiFee;
  const netAmount  = side === 'buy' ? turnover + totalCost : turnover - totalCost;

  // ── Break-even price ──────────────────────────────────────────────────────────
  const totalBuyCost   = side === 'buy' ? turnover + totalCost : turnover;
  const breakEvenPrice = qty > 0 ? totalBuyCost / qty : 0;

  return {
    turnover:       round(turnover),
    brokerage:      round(brokerage),
    stt:            round(stt),
    exchangeFee:    round(exchangeFee),
    sebiFee:        round(sebiFee),
    gst:            round(gst),
    stampDuty:      round(stampDuty),
    totalCost:      round(totalCost),
    netAmount:      round(netAmount),
    breakEvenPrice: round(breakEvenPrice),
    costAsPercent:  round(turnover > 0 ? (totalCost / turnover) * 100 : 0),
    // Human-readable line items for UI display
    lineItems: [
      { label: 'Turnover',           value: round(turnover) },
      { label: 'Brokerage',          value: round(brokerage) },
      { label: 'STT',                value: round(stt) },
      { label: 'Exchange Charges',   value: round(exchangeFee) },
      { label: 'SEBI Charges',       value: round(sebiFee) },
      { label: 'GST (18%)',          value: round(gst) },
      { label: 'Stamp Duty',         value: round(stampDuty) },
      { label: 'Total Charges',      value: round(totalCost) },
      { label: 'Net Amount',         value: round(netAmount) },
    ],
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Quick cost estimate for UI display before submit.
 */
function quickEstimate(price, quantity, side, productType = 'CNC', instrumentType = 'EQUITY') {
  const costs = calculate({ price, quantity, side, productType, instrumentType });
  return {
    totalCost:      costs.totalCost,
    breakEvenPrice: costs.breakEvenPrice,
    costAsPercent:  costs.costAsPercent,
    lineItems:      costs.lineItems,
    summary:        `₹${costs.brokerage} brokerage + ₹${costs.stt} STT + ₹${costs.gst} GST + others = ₹${costs.totalCost} total charges`,
  };
}

module.exports = { calculate, quickEstimate, RATES };
