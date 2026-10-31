'use strict';
/**
 * services/data/instrumentMaster.js
 *  
 * DhanHQ instrument master (symbol ↔ securityId). Built from the official
 * scrip-master CSV published by Dhan:
 * https://images.dhan.co/api-data/api-scrip-master.csv
 *
 * Gives us the exact securityId needed for every REST quote / history /
 * option-chain call, plus lot size, tick size and expiry for F&O.
 *
 * Cache: server/data/instruments.json — refreshed automatically when stale
 * (>12h old) or on demand via refreshMaster().
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';
const CACHE_FILE = process.env.DHAN_INSTRUMENT_CACHE
  || path.join(__dirname, '..', '..', 'data', 'instruments.json');
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

// symbol key examples: "RELIANCE", "^NSEI"/"NIFTY", "NIFTY25APR202524600CE"
const SEG_BY_INSTRUMENT = ['EQUITY', 'INDEX', 'FUTIDX', 'OPTIDX', 'FUTSTK', 'OPTSTK', 'FUTCOM', 'OPTFUT'];

let inMemory = null; // { raw: Map, byKey: Map }
let loading = null; // dedupe concurrent loads

function parseCsvLine(line) {
  // CSV uses quotes rarely; simple split is fine for this file but handle quotes
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Compact CSV columns - 16 fields, verified against the live file:
 * 0 SEM_EXM_EXCH_ID  1 SEM_SEGMENT  2 SEM_SMST_SECURITY_ID  3 SEM_INSTRUMENT_NAME
 * 4 SEM_EXPIRY_CODE  5 SEM_TRADING_SYMBOL  6 SEM_LOT_UNITS  7 SEM_CUSTOM_SYMBOL
 * 8 SEM_EXPIRY_DATE  9 SEM_STRIKE_PRICE 10 SEM_OPTION_TYPE 11 SEM_TICK_SIZE
 * 12 SEM_EXPIRY_FLAG 13 SEM_EXCH_INSTRUMENT_TYPE 14 SEM_SERIES 15 SM_SYMBOL_NAME
 */
const COL = {
  exchId: 0, segment: 1, securityId: 2, instrument: 3, expiryCode: 4,
  tradingSymbol: 5, lotSize: 6, displayName: 7, expiryDate: 8,
  strike: 9, optionType: 10, tickSize: 11, expiryFlag: 12,
  instrumentType: 13, series: 14, symbol: 15,
};

function buildMap(csvText) {
  const lines = csvText.split(/\r?\n/);
  const byKey = new Map(); // lookup key → instrument record
  const raw = [];

  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i];
    if (!line) continue;
    const f = parseCsvLine(line);
    const securityId = (f[COL.securityId] || '').trim();
    const tradingSymbol = (f[COL.tradingSymbol] || '').trim();
    const symbol = (f[COL.symbol] || '').trim();
    if (!securityId || !tradingSymbol) continue;

    const rec = {
      securityId,
      tradingSymbol,
      symbol: symbol || tradingSymbol,
      exchange: (f[COL.exchId] || '').trim(),
      segment: (f[COL.segment] || '').trim(),
      instrument: (f[COL.instrument] || '').trim(),
      displayName: (f[COL.displayName] || '').trim(),
      lotSize: parseFloat(f[COL.lotSize] || '1') || 1,
      tickSize: parseFloat(f[COL.tickSize] || '0.05') || 0.05,
      strike: f[COL.strike] && f[COL.strike] !== '-0.01000' ? parseFloat(f[COL.strike]) : null,
      optionType: (f[COL.optionType] || '').trim() || null,
      expiryDate: (f[COL.expiryDate] || '').trim() || null,
      expiryCode: (f[COL.expiryCode] || '').trim() || null,
      series: (f[COL.series] || '').trim() || null,
      isIndex: (f[COL.instrument] || '').trim() === 'INDEX',
    };
    rec.exchangeSegment =
      rec.exchange === 'NSE' ? (rec.segment === 'D' ? 'NSE_FNO' : 'NSE_EQ')
      : rec.exchange === 'BSE' ? (rec.segment === 'D' ? 'BSE_FNO' : 'BSE_EQ')
      : rec.exchange === 'MCX' ? 'MCX_COMM'
      : rec.exchange === 'IDX' ? 'IDX_I' : null;

    raw.push(rec);

    // Multiple aliases so callers can pass any symbol they use
    const keys = new Set();
    if (tradingSymbol) keys.add(tradingSymbol.toUpperCase());
    if (symbol) keys.add(symbol.toUpperCase());
    if (rec.displayName) keys.add(rec.displayName.toUpperCase());
    const bareT = tradingSymbol.split('.')[0];
    if (bareT) keys.add(bareT.toUpperCase());

    keys.forEach((k) => {
      const cur = byKey.get(k);
      if (!cur || keyPreference(rec) > keyPreference(cur)) byKey.set(k, rec);
    });
  }
  return { raw, byKey };
}

/**
 * Preference for duplicate symbol keys: the platform is NSE-centric, so NSE cash
 * equity must win over BSE and over derivatives. Shared by the fresh-download
 * path AND the cache-rebuild path so both resolve identically.
 */
function keyPreference(r) {
  if (!r) return -1;
  let s = 0;
  if (r.exchange === 'NSE') s += 100;
  if (r.exchange === 'BSE') s += 50;
  if (r.segment === 'E') s += 20;
  if (r.segment === 'D') s -= 20;
  if (r.instrument === 'EQUITY') s += 10;
  if (r.instrument === 'INDEX') s += 8;
  if (/^FUT/.test(r.instrument || '')) s -= 5;
  return s;
}

/** Build the alias index from a raw record list. */
function buildAliasIndex(raw) {
  const byKey = new Map();
  raw.forEach((r) => {
    const keys = new Set([r.tradingSymbol, r.symbol, r.displayName].filter(Boolean).map((k) => k.toUpperCase()));
    keys.forEach((k) => {
      const cur = byKey.get(k);
      if (!cur || keyPreference(r) > keyPreference(cur)) byKey.set(k, r);
    });
  });
  return byKey;
}

async function downloadMaster() {
  const r = await axios.get(MASTER_URL, {
    responseType: 'text', timeout: 90000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36' },
  });
  if (!r.data || r.data.length < 100000) throw new Error('Scrip master CSV looks too small — download failed');
  return buildMap(r.data);
}

async function loadMaster() {
  if (inMemory) return inMemory;
  if (loading) return loading;

  loading = (async () => {
    // 1. try cache
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (Date.now() - cache.cachedAt < MAX_AGE_MS && cache.raw?.length) {
          // Rebuild the alias index with the SAME precedence rules as a fresh
          // download - otherwise NSE/BSE duplicates resolve differently between
          // a cold start and a warm one.
          inMemory = { raw: cache.raw, byKey: buildAliasIndex(cache.raw) };
          console.log(` instruments: [cache hit] (${cache.raw.length} scrips)`);
          return inMemory;
        }
      }
    } catch (e) { /* fall through to download */ }

    // 2. download fresh
    try {
      const fresh = await downloadMaster();
      try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify({
          cachedAt: Date.now(), count: fresh.raw.length, raw: fresh.raw,
        }));
      } catch (e) {}
      inMemory = fresh;
      console.log(` instruments: [downloaded] (${fresh.raw.length} scrips)`);
      return inMemory;
    } catch (e) {
      console.warn(` instruments: [FAILED] ${e.message} — Dhan live feed disabled, using cached/fallback data`);
      inMemory = { raw: [], byKey: new Map() };
      return inMemory;
    }
  })();

  return loading;
}

async function refreshMaster() {
  inMemory = null; loading = null;
  try { fs.rmSync(CACHE_FILE, { force: true }); } catch {}
  return loadMaster();
}

/** Resolve any symbol form to a Dhan instrument record. */
async function resolve(symbol) {
  const m = await loadMaster();
  const raw = String(symbol || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // An explicit .NS / .BO suffix is a hard requirement about the exchange, so
  // fall back to scanning the full master rather than the alias index (which
  // dedupes BSE and NSE rows into one entry and may pick the wrong one).
  if (/\.(NS|BO)$/.test(upper)) {
    const wantExch = upper.endsWith('.NS') ? 'NSE' : 'BSE';
    const bare = upper.replace(/\.(NS|BO)$/, '');
    const hit = m.raw.find((r) =>
      (r.tradingSymbol === bare || r.symbol === bare || r.displayName === bare) &&
      r.exchange === wantExch && r.segment === 'E'
    ) || m.raw.find((r) =>
      (r.tradingSymbol === bare || r.symbol === bare || r.displayName === bare) && r.exchange === wantExch
    );
    if (hit) return hit;
  }

  return m.byKey.get(upper)
      || m.byKey.get(upper.replace('.NS', ''))
      || m.byKey.get(upper.replace('.BO', ''))
      || null;
}

/** Resolve to the { exchangeSegment, securityId } pair needed by the API. */
async function resolvePair(symbol) {
  const rec = await resolve(symbol);
  if (!rec) return null;
  return { exchangeSegment: rec.exchangeSegment, securityId: rec.securityId, record: rec };
}

/** Dhan index symbols are exposed via an index segment id map. */
const INDEX_IDS = {
  '^NSEI': { exchangeSegment: 'IDX_I', securityId: '13', display: 'NIFTY 50', lot: 75, tick: 0.05 },
  '^BSESN': { exchangeSegment: 'IDX_I', securityId: '51', display: 'SENSEX', lot: 1, tick: 0.01 },
  '^NSEBANK': { exchangeSegment: 'IDX_I', securityId: '25', display: 'BANK NIFTY', lot: 35, tick: 0.05 },
  '^CNXIT': { exchangeSegment: 'IDX_I', securityId: '31', display: 'NIFTY IT', lot: 1, tick: 0.05 },
  '^CNXAUTO': { exchangeSegment: 'IDX_I', securityId: '36', display: 'NIFTY AUTO', lot: 1, tick: 0.05 },
  '^CNXPHARMA': { exchangeSegment: 'IDX_I', securityId: '23', display: 'NIFTY PHARMA', lot: 1, tick: 0.05 },
  '^CNXFMCG': { exchangeSegment: 'IDX_I', securityId: '27', display: 'NIFTY FMCG', lot: 1, tick: 0.05 },
  '^CNXMETAL': { exchangeSegment: 'IDX_I', securityId: '30', display: 'NIFTY METAL', lot: 1, tick: 0.05 },
  '^CNXREALTY': { exchangeSegment: 'IDX_I', securityId: '33', display: 'NIFTY REALTY', lot: 1, tick: 0.05 },
  '^CNXENERGY': { exchangeSegment: 'IDX_I', securityId: '29', display: 'NIFTY ENERGY', lot: 1, tick: 0.05 },
  '^CNXINFRA': { exchangeSegment: 'IDX_I', securityId: '34', display: 'NIFTY INFRA', lot: 1, tick: 0.05 },
  '^CNXFINANCE': { exchangeSegment: 'IDX_I', securityId: '35', display: 'NIFTY FIN SERVICE', lot: 1, tick: 0.05 },
  '^NSMIDCP150': { exchangeSegment: 'IDX_I', securityId: '39', display: 'NIFTY MIDCAP 150', lot: 1, tick: 0.05 },
};

/** Bare index names used everywhere in the app -> caret index symbols. */
const INDEX_ALIAS = {
  NIFTY: '^NSEI', NIFTY50: '^NSEI', NIFTY_50: '^NSEI',
  BANKNIFTY: '^NSEBANK', NIFTYBANK: '^NSEBANK', NIFTY_BANK: '^NSEBANK',
  NIFTYIT: '^CNXIT', NIFTY_IT: '^CNXIT', CNXIT: '^CNXIT',
  NIFTYAUTO: '^CNXAUTO', NIFTY_AUTO: '^CNXAUTO',
  NIFTYPHARMA: '^CNXPHARMA', NIFTY_PHARMA: '^CNXPHARMA',
  NIFTYFMCG: '^CNXFMCG', NIFTY_FMCG: '^CNXFMCG',
  NIFTYMETAL: '^CNXMETAL', NIFTY_METAL: '^CNXMETAL',
  NIFTYREALTY: '^CNXREALTY', NIFTY_REALTY: '^CNXREALTY',
  NIFTYENERGY: '^CNXENERGY', NIFTY_ENERGY: '^CNXENERGY',
  NIFTYINFRA: '^CNXINFRA', NIFTY_INFRA: '^CNXINFRA',
  NIFTYFIN: '^CNXFINANCE', FINNIFTY: '^CNXFINANCE', NIFTYFINANCE: '^CNXFINANCE',
  MIDCPNIFTY: '^NSMIDCP150', NIFTYMIDCAP150: '^NSMIDCP150',
  SENSEX: '^BSESN', BSE30: '^BSESN', BANKEX: '^BSEBANK',
  INDIAVIX: '^INDIAVIX', VIX: '^INDIAVIX',
};

async function resolvePairSmart(symbol) {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return null;

  if (INDEX_IDS[raw]) {
    return { exchangeSegment: 'IDX_I', securityId: INDEX_IDS[raw].securityId, record: { ...INDEX_IDS[raw], tradingSymbol: raw.replace('^', '') } };
  }
  // alias (NIFTY / BANKNIFTY / FINNIFTY ...)
  const aliased = INDEX_ALIAS[raw];
  if (aliased && INDEX_IDS[aliased]) {
    return { exchangeSegment: 'IDX_I', securityId: INDEX_IDS[aliased].securityId, record: { ...INDEX_IDS[aliased], tradingSymbol: raw } };
  }
  return resolvePair(symbol);
}

function getIndexIds() { return INDEX_IDS; }

module.exports = { loadMaster, refreshMaster, resolve, resolvePair, resolvePairSmart, getIndexIds, INDEX_IDS };
