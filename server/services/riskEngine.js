/**
 * riskEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side, pre-trade risk validation engine.
 * All risk checks live here — never in the UI.
 *
 * Rules enforced:
 *  1. Subscription gate  — user must have a non-FREE plan
 *  2. Trade count limit  — plan trade cap check
 *  3. Margin sufficiency — checks per product type using marginService
 *  4. Inventory check    — SELL CNC cannot exceed held quantity
 *  5. Lot size check     — F&O orders must be in multiples of lot size
 *  6. Freeze qty check   — NSE max lots per order
 *  7. Circuit limit      — price must be within upper/lower circuit
 *  8. Price sanity       — ±10% band from last cached market price
 */

'use strict';

const { cacheGet } = require('./marketDataService');
const { getRequiredMargin, getLotSize, getFreezeQtyLots, parseFOSymbol } = require('./marginService');

const MAX_SINGLE_STOCK_PCT = 0.90;
const PRICE_SANITY_BAND    = 0.10;

const PLAN_LIMITS = {
  FREE:    { maxTrades: 0,    virtualMoney: 0 },
  starter: { maxTrades: 50,   virtualMoney: 50000 },
  pro:     { maxTrades: 200,  virtualMoney: 200000 },
  expert:  { maxTrades: -1,   virtualMoney: 1000000 },
};

/** Returns the IST market open status */
function isMarketOpen() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay();
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  return isWeekday &&
    (h > 9 || (h === 9 && m >= 15)) &&
    (h < 15 || (h === 15 && m <= 30));
}

function isOptionSymbol(symbol) {
  return /\b(CE|PE)\b/.test(String(symbol || ''));
}

function isFutureSymbol(symbol) {
  return /FUT$/.test(String(symbol || '').toUpperCase());
}

function getInstrumentType(symbol) {
  if (isOptionSymbol(symbol)) return 'OPTIONS';
  if (isFutureSymbol(symbol)) return 'FUTURES';
  return 'EQUITY';
}

/**
 * Normalize productType to canonical form.
 * Accepts: CNC, DELIVERY, MIS, INTRADAY, NRML
 */
function normalizeProductType(productType) {
  const pt = (productType || 'CNC').toUpperCase();
  if (pt === 'DELIVERY') return 'CNC';
  if (pt === 'INTRADAY') return 'MIS';
  return pt; // CNC, MIS, NRML already canonical
}

/**
 * Run all pre-trade risk checks.
 *
 * @param {object} params
 * @param {object} params.user        - User record from DB (balance, planId)
 * @param {number} params.tradeCount  - Trades used so far this period
 * @param {object|null} params.holding - Current holding (or null)
 * @param {string} params.side        - 'buy' | 'sell'
 * @param {string} params.symbol      - e.g. 'RELIANCE', 'NIFTY25OCT24700CE'
 * @param {number} params.quantity    - Quantity (shares for EQ, total qty for F&O)
 * @param {number} params.price       - Execution price
 * @param {string} params.productType - CNC | MIS | NRML | DELIVERY | INTRADAY
 * @param {object|null} params.instrument - Instrument DB record (with upperCircuit/lowerCircuit)
 * @returns {{ passed: boolean, violations: Array, meta: object }}
 */
function runPreTradeChecks({ user, tradeCount, holding, side, symbol, quantity, price, productType = 'CNC', instrument = null }) {
  const violations = [];
  const qty        = Number(quantity);
  const px         = Number(price);
  const tradeValue = qty * px;
  const heldQty    = holding ? holding.quantity : 0;
  const planLimits = PLAN_LIMITS[user.planId] || PLAN_LIMITS.FREE;
  const pt         = normalizeProductType(productType);
  const instrType  = getInstrumentType(symbol);

  // ── 1. Subscription Gate ────────────────────────────────────────────────────
  if (user.planId === 'FREE' || planLimits.maxTrades === 0) {
    violations.push({ code: 'NO_SUBSCRIPTION', message: 'Active subscription required to trade.' });
  }

  // ── 2. Trade Count Limit ────────────────────────────────────────────────────
  if (planLimits.maxTrades > 0 && tradeCount >= planLimits.maxTrades) {
    violations.push({
      code: 'TRADE_LIMIT_EXHAUSTED',
      message: `Trade limit of ${planLimits.maxTrades} reached for your plan. Please upgrade.`
    });
  }

  // ── 3. Product Type + Instrument Type Validation ────────────────────────────
  if (instrType === 'EQUITY' && pt === 'NRML') {
    violations.push({
      code: 'INVALID_PRODUCT_TYPE',
      message: 'NRML is only valid for F&O instruments. Use CNC for equity delivery or MIS for intraday equity.'
    });
  }
  if ((instrType === 'FUTURES' || instrType === 'OPTIONS') && pt === 'CNC') {
    violations.push({
      code: 'INVALID_PRODUCT_TYPE',
      message: 'CNC (delivery) is not valid for F&O. Use NRML for overnight carry or MIS for intraday.'
    });
  }

  // ── 4. Lot Size Validation for F&O ─────────────────────────────────────────
  const foParsed = (instrType !== 'EQUITY') ? parseFOSymbol(symbol) : null;
  if (foParsed) {
    const lotSize = foParsed.lotSize || 1;
    if (qty % lotSize !== 0) {
      violations.push({
        code: 'INVALID_LOT_SIZE',
        message: `Quantity must be a multiple of lot size (${lotSize}). Enter ${Math.ceil(qty / lotSize) * lotSize} for ${Math.ceil(qty / lotSize)} lot(s).`
      });
    }

    // ── 5. Freeze Quantity Check ──────────────────────────────────────────────
    const maxLots = getFreezeQtyLots(foParsed.underlying);
    const lots    = qty / lotSize;
    if (lots > maxLots) {
      violations.push({
        code: 'FREEZE_QUANTITY_EXCEEDED',
        message: `NSE freeze quantity exceeded. Maximum ${maxLots} lots per order for ${foParsed.underlying}. Split your order.`
      });
    }
  }

  // ── 6. Margin / Balance Check ───────────────────────────────────────────────
  const marginResult = getRequiredMargin({
    instrumentType: instrType,
    productType:    pt,
    side,
    price:          px,
    quantity:       qty,
    lotSize:        foParsed?.lotSize || 1,
    underlyingPrice: null, // We don't have spot here; falls back to premium-based calc
    underlying:     foParsed?.underlying,
  });

  // CNC sell from existing holdings needs no new margin
  const isHoldingsSell = side === 'sell' && instrType === 'EQUITY' && pt === 'CNC' && heldQty >= qty;
  const requiredMargin = isHoldingsSell ? 0 : marginResult.required;

  if (user.balance < requiredMargin) {
    violations.push({
      code: 'MARGIN_SHORTFALL',
      message: `Margin shortfall. Required: ₹${requiredMargin.toLocaleString('en-IN')}, Available: ₹${user.balance.toLocaleString('en-IN')}. (${pt}: ${marginResult.note})`
    });
  }

  // ── 7. Max Single-Stock Position (Equity CNC only) ──────────────────────────
  if (side === 'buy' && instrType === 'EQUITY' && pt === 'CNC') {
    const currentPosValue = heldQty * px;
    const newPosValue = currentPosValue + tradeValue;
    const portfolioValue = user.balance + currentPosValue;
    if (portfolioValue > 0 && newPosValue / portfolioValue > MAX_SINGLE_STOCK_PCT) {
      violations.push({
        code: 'POSITION_LIMIT_EXCEEDED',
        message: `Single CNC delivery position cannot exceed ${MAX_SINGLE_STOCK_PCT * 100}% of portfolio value.`
      });
    }
  }

  // ── 8. Inventory Check (SELL CNC only, not F&O) ─────────────────────────────
  if (side === 'sell' && instrType === 'EQUITY' && pt === 'CNC') {
    if (heldQty < qty) {
      violations.push({
        code: 'INSUFFICIENT_INVENTORY',
        message: `Insufficient CNC shares. Holding: ${heldQty}, Requested: ${qty}. Use MIS to short sell intraday.`
      });
    }
  }

  // ── 9. Circuit Limit Check ──────────────────────────────────────────────────
  if (instrument) {
    if (instrument.upperCircuit && px > instrument.upperCircuit) {
      violations.push({
        code: 'UPPER_CIRCUIT',
        message: `Order price ₹${px} exceeds upper circuit limit ₹${instrument.upperCircuit} for ${symbol}.`
      });
    }
    if (instrument.lowerCircuit && px < instrument.lowerCircuit) {
      violations.push({
        code: 'LOWER_CIRCUIT',
        message: `Order price ₹${px} is below lower circuit limit ₹${instrument.lowerCircuit} for ${symbol}.`
      });
    }
  }

  // ── 10. Price Sanity Check ──────────────────────────────────────────────────
  const cachedQuote = cacheGet(`quote:${symbol}`);
  if (cachedQuote && cachedQuote.price) {
    const cachedPrice = cachedQuote.price;
    const pctDeviation = Math.abs(px - cachedPrice) / cachedPrice;
    if (pctDeviation > PRICE_SANITY_BAND) {
      violations.push({
        code: 'PRICE_MANIPULATION',
        message: `Submitted price ₹${px} deviates more than ${PRICE_SANITY_BAND * 100}% from last known market price ₹${cachedPrice.toFixed(2)}.`
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    meta: {
      marketOpen:   isMarketOpen(),
      tradeValue,
      planMaxTrades: planLimits.maxTrades,
      tradesUsed:   tradeCount,
      marginRequired: requiredMargin,
      marginDetail:  marginResult,
      productType:   pt,
      instrumentType: instrType,
    }
  };
}

module.exports = { runPreTradeChecks, isMarketOpen, isOptionSymbol, isFutureSymbol, getInstrumentType, normalizeProductType };
