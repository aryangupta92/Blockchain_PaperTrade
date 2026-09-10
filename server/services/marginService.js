/**
 * marginService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Simulates Indian broker margin calculations for all product types.
 * Based on NSE SPAN + Exposure margin methodology.
 *
 * Product Types:
 *   CNC   — Equity Delivery (100% upfront)
 *   MIS   — Intraday Equity (5x leverage → 20% margin)
 *   NRML  — F&O Overnight (SPAN + Exposure, ~8–15% of contract value)
 *
 * Lot Sizes (NSE effective 2024):
 *   NIFTY=50, BANKNIFTY=15, FINNIFTY=40, MIDCPNIFTY=75, SENSEX=10
 */

'use strict';

// ─── NSE Lot Sizes ─────────────────────────────────────────────────────────────
const LOT_SIZES = {
  NIFTY:       50,
  BANKNIFTY:   15,
  FINNIFTY:    40,
  MIDCPNIFTY:  75,
  SENSEX:      10,
  BANKEX:      15,
  // Default for stock options/futures
  DEFAULT:     1,
};

// ─── NSE Freeze Quantities (max lots per single order) ────────────────────────
const FREEZE_QUANTITY_LOTS = {
  NIFTY:       1800,
  BANKNIFTY:   900,
  FINNIFTY:    1800,
  MIDCPNIFTY:  1200,
  SENSEX:      2400,
  DEFAULT:     5000,
};

// ─── SPAN + Exposure Margin Rates (approximate) ───────────────────────────────
// NSE SPAN is computed in real-time; these are representative static values
const FO_MARGIN_RATES = {
  FUTURES: {
    SPAN:     0.06,  // ~6% of contract value
    EXPOSURE: 0.03,  // ~3% of contract value
  },
  OPTIONS_SELL: {
    SPAN:     0.08,  // ~8% of contract value (underlying notional)
    EXPOSURE: 0.04,  // ~4%
  },
};

// MIS margin benefit for intraday (most brokers give 40–60% reduction)
const MIS_MARGIN_REDUCTION = 0.40; // 40% lower than NRML for intraday F&O

/**
 * Get canonical underlying name from a symbol.
 * e.g. "NIFTY25OCT24700CE" → "NIFTY"
 */
function getUnderlying(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  const known = ['BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'BANKEX', 'NIFTY'];
  for (const k of known) {
    if (upper.startsWith(k)) return k;
  }
  // Stock F&O — extract leading alphabetic part
  const match = upper.match(/^([A-Z]+)/);
  return match ? match[1] : upper;
}

/**
 * Get lot size for a symbol.
 * @param {string} underlying - e.g. 'NIFTY', 'BANKNIFTY', 'RELIANCE'
 */
function getLotSize(underlying) {
  return LOT_SIZES[underlying] || LOT_SIZES.DEFAULT;
}

/**
 * Get freeze quantity (max lots per order) for a symbol.
 */
function getFreezeQtyLots(underlying) {
  return FREEZE_QUANTITY_LOTS[underlying] || FREEZE_QUANTITY_LOTS.DEFAULT;
}

/**
 * Calculate required margin for an order.
 *
 * @param {object} params
 * @param {'EQUITY'|'FUTURES'|'OPTIONS'} params.instrumentType
 * @param {'CNC'|'MIS'|'NRML'|'DELIVERY'|'INTRADAY'} params.productType
 * @param {'buy'|'sell'} params.side
 * @param {number} params.price          - Premium for options, futures price for futures, LTP for equity
 * @param {number} params.quantity       - Number of units (shares for equity, total qty = lots × lotSize for F&O)
 * @param {number} [params.lotSize=1]    - Lot size (auto-calculated if underlying provided)
 * @param {number} [params.underlyingPrice] - Spot price of underlying (for F&O contract value calc)
 * @param {string} [params.underlying]   - e.g. 'NIFTY'
 *
 * @returns {{
 *   required: number,
 *   span: number,
 *   exposure: number,
 *   premium: number,
 *   breakdown: object,
 *   leverage: string,
 *   note: string
 * }}
 */
function getRequiredMargin({
  instrumentType = 'EQUITY',
  productType = 'CNC',
  side = 'buy',
  price,
  quantity,
  lotSize = 1,
  underlyingPrice = null,
  underlying = null,
}) {
  const px  = Number(price)   || 0;
  const qty = Number(quantity) || 0;
  const tradeValue = px * qty;

  // Normalize product type names
  const pt = (productType || 'CNC').toUpperCase().replace('DELIVERY', 'CNC').replace('INTRADAY', 'MIS');

  let span = 0, exposure = 0, premium = 0, required = 0, leverage = '1x', note = '';

  if (instrumentType === 'EQUITY') {
    if (pt === 'MIS') {
      required = tradeValue * 0.20; // 5x leverage
      leverage = '5x';
      note = 'Intraday MIS: 20% of trade value. Auto square-off at 3:15 PM.';
    } else {
      // CNC: full amount
      required = tradeValue;
      leverage = '1x';
      note = 'CNC Delivery: Full trade value required.';
    }
    span     = required;
    premium  = tradeValue;

  } else if (instrumentType === 'FUTURES') {
    // Contract value = underlyingPrice × lotSize × lots; if unknown use price × qty
    const contractValue = underlyingPrice
      ? underlyingPrice * lotSize * (qty / lotSize)
      : tradeValue;

    const rates = FO_MARGIN_RATES.FUTURES;
    span     = contractValue * rates.SPAN;
    exposure = contractValue * rates.EXPOSURE;
    required = span + exposure;
    premium  = tradeValue;

    if (pt === 'MIS') {
      required = required * (1 - MIS_MARGIN_REDUCTION);
      note = 'Intraday MIS F&O: Reduced margin. Must square off by 3:15 PM.';
    } else {
      note = 'NRML: SPAN + Exposure margin for overnight F&O carry.';
    }
    leverage = `${(contractValue / required).toFixed(1)}x`;

  } else if (instrumentType === 'OPTIONS') {
    if (side === 'buy') {
      // Buying options: 100% of total premium
      required = tradeValue;
      premium  = tradeValue;
      span     = required;
      leverage = '1x';
      note = 'Option Buy: Full premium × quantity required upfront.';
    } else {
      // Writing/selling options: SPAN + Exposure on notional contract value
      const contractValue = underlyingPrice
        ? underlyingPrice * lotSize * (qty / lotSize)
        : px * qty * 10; // rough fallback if spot unknown

      const rates = FO_MARGIN_RATES.OPTIONS_SELL;
      span     = contractValue * rates.SPAN;
      exposure = contractValue * rates.EXPOSURE;
      required = span + exposure;
      premium  = tradeValue; // premium received (credit)

      if (pt === 'MIS') {
        required = required * (1 - MIS_MARGIN_REDUCTION);
        note = 'Option Sell MIS: Reduced SPAN+Exp margin. Must cover by 3:15 PM.';
      } else {
        note = 'Option Sell NRML: Full SPAN + Exposure margin required.';
      }
      leverage = `${(contractValue / required).toFixed(1)}x`;
    }
  }

  return {
    required: Math.round(required * 100) / 100,
    span:     Math.round(span * 100) / 100,
    exposure: Math.round(exposure * 100) / 100,
    premium:  Math.round(premium * 100) / 100,
    breakdown: {
      'Trade Value':      `₹${tradeValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      'SPAN Margin':      `₹${span.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      'Exposure Margin':  `₹${exposure.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      'Total Required':   `₹${required.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    leverage,
    note,
  };
}

/**
 * Parse an F&O symbol into its components.
 * e.g. "NIFTY25OCT24700CE" → { underlying:'NIFTY', expiry:'25OCT24', strike:700, optionType:'CE' }
 */
function parseFOSymbol(symbol) {
  if (!symbol) return null;
  const s = symbol.toUpperCase().trim();

  // Options pattern: UNDERLYING + DDMMMYY + STRIKE + CE|PE
  const optRegex = /^([A-Z&]+?)(\d{2}[A-Z]{3}\d{2})(\d+(?:\.\d+)?)(CE|PE)$/;
  const optMatch = s.match(optRegex);
  if (optMatch) {
    return {
      underlying:  optMatch[1],
      expiry:      optMatch[2],
      strike:      parseFloat(optMatch[3]),
      optionType:  optMatch[4],
      type:        'OPTION',
      lotSize:     getLotSize(optMatch[1]),
    };
  }

  // Futures pattern: UNDERLYING + DDMMMYY + FUT
  const futRegex = /^([A-Z&]+?)(\d{2}[A-Z]{3}\d{2})FUT$/;
  const futMatch = s.match(futRegex);
  if (futMatch) {
    return {
      underlying: futMatch[1],
      expiry:     futMatch[2],
      type:       'FUTURE',
      lotSize:    getLotSize(futMatch[1]),
    };
  }

  return null; // plain equity
}

module.exports = {
  getRequiredMargin,
  getLotSize,
  getFreezeQtyLots,
  getUnderlying,
  parseFOSymbol,
  LOT_SIZES,
};
