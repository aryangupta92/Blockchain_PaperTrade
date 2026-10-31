'use strict';
/**
 * optionChainService.js - normalized real option-chain adapters.
 *
 * Order of preference:
 *   1. DhanHQ option chain (live OI / volume / IV / Greeks, credentials required)
 *   2. NSE public option chain (real OI / volume / LTP for NSE indices)
 *   3. Caller-provided model fallback (explicitly marked estimated)
 *
 * Every response carries `source` and `estimated` so the UI can never present
 * model output as an exchange quote.
 */

const dhanClient = require('./data/dhanClient');
const dhanAuth = require('./data/dhanAuth');
const nseProxy = require('./nseProxy');
const { calculateGreeks } = require('./optionsEngine');

const RISK_FREE_RATE = 0.065;

const DHAN_UNDERLYINGS = {
  NIFTY:      { scrip: 13,  segment: 'IDX_I', exchange: 'NSE' },
  BANKNIFTY:  { scrip: 25,  segment: 'IDX_I', exchange: 'NSE' },
  FINNIFTY:   { scrip: 27,  segment: 'IDX_I', exchange: 'NSE' },
  MIDCPNIFTY: { scrip: 442, segment: 'IDX_I', exchange: 'NSE' },
  NIFTYNXT50: { scrip: 38,  segment: 'IDX_I', exchange: 'NSE' },
  SENSEX:     { scrip: 51,  segment: 'IDX_I', exchange: 'BSE' },
  BANKEX:     { scrip: 53,  segment: 'IDX_I', exchange: 'BSE' },
};

const NSE_SYMBOLS = {
  NIFTY: 'NIFTY',
  BANKNIFTY: 'BANKNIFTY',
  FINNIFTY: 'FINNIFTY',
  MIDCPNIFTY: 'MIDCPNIFTY',
  NIFTYNXT50: 'NIFTYNXT50',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  const n = num(value);
  return n == null ? null : Number(n.toFixed(digits));
}

function isoExpiry(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (dmy) {
    const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const month = MON[dmy[2].toUpperCase()];
    if (month != null) {
      const d = new Date(Date.UTC(Number(dmy[3]), month, Number(dmy[1])));
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function timeToExpiry(iso) {
  if (!iso) return 0.02;
  const expiry = new Date(`${iso}T15:30:00+05:30`).getTime();
  if (!Number.isFinite(expiry)) return 0.02;
  return Math.max(0.001, (expiry - Date.now()) / (365 * 24 * 60 * 60 * 1000));
}

function calculateTotals(chain) {
  let totalCallOI = 0;
  let totalPutOI = 0;
  let totalVolume = 0;
  let maxPain = null;
  let minPainLoss = Infinity;

  for (const row of chain) {
    totalCallOI += row.call.oi || 0;
    totalPutOI += row.put.oi || 0;
    totalVolume += (row.call.volume || 0) + (row.put.volume || 0);
  }

  for (const row of chain) {
    let pain = 0;
    for (const item of chain) {
      if (item.strike < row.strike) pain += (item.call.oi || 0) * (row.strike - item.strike);
      if (item.strike > row.strike) pain += (item.put.oi || 0) * (item.strike - row.strike);
    }
    if (pain < minPainLoss) {
      minPainLoss = pain;
      maxPain = row.strike;
    }
  }

  return {
    totalCallOI,
    totalPutOI,
    totalVolume,
    pcr: totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : null,
    maxPain,
  };
}

function withGreeks(leg, spot, strike, T, fallbackIv) {
  const iv = num(leg.iv) / 100;
  const safeIv = Number.isFinite(iv) && iv > 0 ? iv : fallbackIv;
  const greeks = leg.delta != null && leg.gamma != null
    ? { delta: leg.delta, gamma: leg.gamma, theta: leg.theta, vega: leg.vega, rho: leg.rho }
    : calculateGreeks(spot, strike, T, RISK_FREE_RATE, safeIv, leg.type);
  return { ...leg, ...greeks, iv: num(leg.iv) ?? round(safeIv * 100, 2) };
}

function strikeRowsFromNse(records, expiry) {
  const wanted = isoExpiry(expiry);
  const all = Array.isArray(records?.data) ? records.data : [];
  const filtered = wanted
    ? all.filter((row) => isoExpiry(row.expiryDate) === wanted)
    : all.filter((row) => isoExpiry(row.expiryDate) === isoExpiry(records?.expiryDates?.[0]));
  const rows = filtered.length ? filtered : all;
  const byStrike = new Map();

  for (const row of rows) {
    const strike = num(row.strikePrice);
    if (strike == null || !row.CE || !row.PE) continue;
    const current = byStrike.get(strike) || { strike, CE: row.CE, PE: row.PE };
    byStrike.set(strike, current);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

function legFromNse(raw, type, spot, strike, T, fallbackIv) {
  const ltp = num(raw.lastPrice);
  const change = num(raw.change);
  return withGreeks({
    type,
    ltp,
    bid: num(raw.bidprice ?? raw.buyPrice1),
    ask: num(raw.askPrice ?? raw.sellPrice1),
    change,
    changePct: num(raw.pChange),
    volume: num(raw.totalTradedVolume) || 0,
    oi: num(raw.openInterest) || 0,
    oiChange: num(raw.changeinOpenInterest) || 0,
    iv: num(raw.impliedVolatility),
  }, spot, strike, T, fallbackIv);
}

async function fetchNseChain(underlying, expiry) {
  const nseSymbol = NSE_SYMBOLS[underlying];
  if (!nseSymbol) return null;

  const contractInfo = await nseProxy.getOptionChainContractInfo(nseSymbol).catch(() => []);
  const requested = isoExpiry(expiry);
  const data = await nseProxy.getOptionChain(nseSymbol, requested || contractInfo[0] || '');
  const records = data?.records;
  if (!records || !Array.isArray(records.data) || records.data.length === 0) return null;

  const expiries = (contractInfo.length ? contractInfo : records.expiryDates || [])
    .map(isoExpiry)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
  const selected = requested || expiries[0];
  const rows = strikeRowsFromNse(records, selected);
  if (!rows.length) return null;

  const spot = num(records.underlyingValue) ?? num(data?.filtered?.data?.[0]?.CE?.underlyingValue);
  if (spot == null || spot <= 0) return null;

  const T = timeToExpiry(selected);
  const chain = rows.map((row) => {
    const atm = Math.abs(row.strike - spot) <= Math.max(1, (rows[1]?.strike - rows[0]?.strike || 50) / 2);
    const call = legFromNse(row.CE, 'CE', spot, row.strike, T, 0.14);
    const put = legFromNse(row.PE, 'PE', spot, row.strike, T, 0.14);
    return {
      strike: row.strike,
      call,
      put,
      atm,
      itm: { call: row.strike < spot, put: row.strike > spot },
    };
  });

  return {
    source: 'NSE',
    estimated: false,
    spotPrice: spot,
    expiry: selected,
    expiries,
    chain,
    exchange: 'NSE',
    timestamp: data?.records?.timestamp || new Date().toISOString(),
    ...calculateTotals(chain),
  };
}

function legFromDhan(raw, type, spot, strike, T) {
  const greeks = raw?.greeks || {};
  return withGreeks({
    type,
    ltp: num(raw?.last_price),
    bid: num(raw?.top_bid_price),
    ask: num(raw?.top_ask_price),
    change: num(raw?.change),
    changePct: num(raw?.change_percentage),
    volume: num(raw?.volume) || 0,
    oi: num(raw?.oi) || 0,
    oiChange: num(raw?.previous_oi) != null ? (num(raw.oi) || 0) - num(raw.previous_oi) : 0,
    iv: num(raw?.implied_volatility),
    delta: num(greeks.delta),
    gamma: num(greeks.gamma),
    theta: num(greeks.theta),
    vega: num(greeks.vega),
    rho: num(greeks.rho),
  }, spot, strike, T, 0.14);
}

async function fetchDhanChain(underlying, expiry) {
  const meta = DHAN_UNDERLYINGS[underlying];
  if (!meta || !dhanAuth.getToken()) return null;

  const data = await dhanClient.getOptionChain({
    underlyingScrip: meta.scrip,
    exchangeSegment: meta.segment,
    expiry,
  });
  const oc = data?.data?.oc || data?.oc;
  if (!oc || typeof oc !== 'object') return null;

  const parsed = Object.entries(oc)
    .map(([strikeKey, value]) => ({ strike: Number(strikeKey), value }))
    .filter((row) => Number.isFinite(row.strike) && row.value?.ce && row.value?.pe)
    .sort((a, b) => a.strike - b.strike);
  if (!parsed.length) return null;

  const spot = num(data?.data?.last_price) ?? num(data?.last_price);
  if (spot == null || spot <= 0) return null;

  const selected = isoExpiry(data?.data?.expiry || expiry) || expiry;
  const T = timeToExpiry(selected);
  const step = parsed.length > 1 ? Math.abs(parsed[1].strike - parsed[0].strike) : 50;
  const chain = parsed.map(({ strike, value }) => ({
    strike,
    call: legFromDhan(value.ce, 'CE', spot, strike, T),
    put: legFromDhan(value.pe, 'PE', spot, strike, T),
    atm: Math.abs(strike - spot) <= step / 2,
    itm: { call: strike < spot, put: strike > spot },
  }));

  let expiries = [selected].filter(Boolean);
  try {
    const list = await dhanClient.getExpiryList({
      underlyingScrip: meta.scrip,
      exchangeSegment: meta.segment,
    });
    const dates = (Array.isArray(list?.data) ? list.data : []).map(isoExpiry).filter(Boolean);
    if (dates.length) expiries = dates;
  } catch {
    // Rate limit / expiry endpoint failure must not discard a valid chain.
  }

  return {
    source: 'DHAN',
    estimated: false,
    spotPrice: spot,
    expiry: selected,
    expiries,
    chain,
    exchange: meta.exchange,
    timestamp: new Date().toISOString(),
    ...calculateTotals(chain),
  };
}

/**
 * Fetch a real chain. Returns null when no exchange source is available.
 * Throws only on unexpected programmer errors.
 */
async function fetchRealChain(underlying, expiry) {
  try {
    const dhan = await fetchDhanChain(underlying, expiry);
    if (dhan) return dhan;
  } catch (err) {
    console.warn('[optionChain] Dhan chain unavailable:', err.message);
  }

  try {
    const nse = await fetchNseChain(underlying, expiry);
    if (nse) return nse;
  } catch (err) {
    console.warn('[optionChain] NSE chain unavailable:', err.message);
  }

  return null;
}

module.exports = {
  fetchRealChain,
  calculateTotals,
  isoExpiry,
  timeToExpiry,
  DHAN_UNDERLYINGS,
  NSE_SYMBOLS,
};
