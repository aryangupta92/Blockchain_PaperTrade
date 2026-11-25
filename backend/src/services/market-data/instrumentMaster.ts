import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ExchangeCode, InstrumentKind, MarketSegment } from '@broker/shared';

// Internal upstream detailed scrip master CSV URL (32 cols: ISIN, MTF leverage, freeze qty, circuits, ASM/GSM; never exposed to users)
const SCRIP_MASTER_CSV_URL = 'https://images.dhan.co/api-data/api-scrip-master-detailed.csv';
const CACHE_PATH = path.resolve(__dirname, '../../../data/instrument_master.json');
const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000; // 12h

export interface MasterInstrument {
  instrumentId: string;        // Canonical neutral ID, e.g. "NSE:EQ:1333" or "NSE:IDX:13"
  providerSegment: string;     // Internal wire segment: IDX_I | NSE_EQ | BSE_EQ | NSE_FNO | BSE_FNO | MCX_COMM
  providerSecId: string;       // Internal security ID
  exchange: ExchangeCode;
  segment: MarketSegment;
  instrumentKind: InstrumentKind;
  symbol: string;
  tradingSymbol: string;
  displayName: string;
  lotSize: number;
  tickSize: string;
  expiryDate: string | null;
  strikePrice: string | null;
  optionType: 'CE' | 'PE' | null;
  series: string | null;
  isin?: string | null;
  mtfLeverage?: string | null;
  freezeQty?: number | null;
  upperCircuit?: string | null;
  lowerCircuit?: string | null;
  asmGsmFlag?: string | null;
  bracketEligible?: boolean;
  coverEligible?: boolean;
}

// Well-known Indian benchmark indices & popular ETFs/Equities baseline (ensures instant resolution even before full CSV downloads)
const CORE_INDICES: MasterInstrument[] = [
  { instrumentId: 'NSE:IDX:13', providerSegment: 'IDX_I', providerSecId: '13', exchange: 'NSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'NIFTY', tradingSymbol: 'NIFTY 50', displayName: 'Nifty 50', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'NSE:IDX:25', providerSegment: 'IDX_I', providerSecId: '25', exchange: 'NSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'BANKNIFTY', tradingSymbol: 'NIFTY BANK', displayName: 'Nifty Bank', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'NSE:IDX:27', providerSegment: 'IDX_I', providerSecId: '27', exchange: 'NSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'FINNIFTY', tradingSymbol: 'NIFTY FIN SERVICE', displayName: 'Nifty Fin Service', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'NSE:IDX:442', providerSegment: 'IDX_I', providerSecId: '442', exchange: 'NSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'MIDCPNIFTY', tradingSymbol: 'NIFTY MID SELECT', displayName: 'Nifty Midcap Select', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'NSE:IDX:29', providerSegment: 'IDX_I', providerSecId: '29', exchange: 'NSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'NIFTYIT', tradingSymbol: 'NIFTY IT', displayName: 'Nifty IT', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'NSE:IDX:21', providerSegment: 'IDX_I', providerSecId: '21', exchange: 'NSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'INDIAVIX', tradingSymbol: 'INDIA VIX', displayName: 'India VIX', lotSize: 1, tickSize: '0.01', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'BSE:IDX:51', providerSegment: 'IDX_I', providerSecId: '51', exchange: 'BSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'SENSEX', tradingSymbol: 'SENSEX', displayName: 'BSE Sensex', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
  { instrumentId: 'BSE:IDX:53', providerSegment: 'IDX_I', providerSecId: '53', exchange: 'BSE', segment: 'FNO', instrumentKind: 'INDEX', symbol: 'BANKEX', tradingSymbol: 'BANKEX', displayName: 'BSE Bankex', lotSize: 1, tickSize: '0.05', expiryDate: null, strikePrice: null, optionType: null, series: 'IDX' },
];

const SYMBOL_ALIASES: Record<string, string> = {
  '^NSEI': 'NIFTY',
  'NIFTY 50': 'NIFTY',
  'NIFTY50': 'NIFTY',
  '^NSEBANK': 'BANKNIFTY',
  'NIFTY BANK': 'BANKNIFTY',
  '^BSESN': 'SENSEX',
  '^INDIAVIX': 'INDIAVIX',
  'INDIA VIX': 'INDIAVIX',
  'TATAMOTORS': 'TMPV',
  'TATA MOTORS': 'TMPV',
};

interface MasterIndex {
  updatedAt: string;
  list: MasterInstrument[];
  byId: Map<string, MasterInstrument>;
  bySymbol: Map<string, MasterInstrument>;
  byWireKey: Map<string, MasterInstrument>;
}

let memoryIndex: MasterIndex | null = null;
let refreshInFlight: Promise<MasterIndex> | null = null;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function isEtfSymbol(tradingSymbol: string, displayName: string): boolean {
  const u = `${tradingSymbol} ${displayName}`.toUpperCase();
  return (
    u.includes('BEES') ||
    u.includes(' ETF') ||
    u.endsWith('ETF') ||
    u.includes('GOLDETF') ||
    u.includes('SILVERETF') ||
    u.includes('LIQUIDCASE') ||
    u.includes('NIFTYIETF')
  );
}

function preferenceRank(rec: MasterInstrument): number {
  let score = 0;
  if (rec.instrumentKind === 'INDEX') score += 100;
  if (rec.exchange === 'NSE') score += 30;
  else if (rec.exchange === 'MCX') score += 20;
  else if (rec.exchange === 'BSE') score += 10;
  if (rec.segment === 'EQ' || rec.segment === 'ETF') score += 25;
  if (rec.series === 'EQ') score += 10;
  return score;
}

function normalizeTickSizeRupees(raw: string | number | undefined): string {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0.05'));
  if (!Number.isFinite(n) || n <= 0) return '0.05';
  const rupees = n >= 1 ? n / 100 : n;
  return rupees.toFixed(2);
}

const CANONICAL_TICKER_BY_ID: Record<string, string> = {
  'NSE:EQ:2885': 'RELIANCE',
  'NSE:EQ:11536': 'TCS',
  'NSE:EQ:1333': 'HDFCBANK',
  'NSE:EQ:1594': 'INFY',
  'NSE:EQ:3045': 'SBIN',
  'NSE:EQ:4963': 'ICICIBANK',
  'NSE:EQ:1660': 'ITC',
  'NSE:EQ:10604': 'BHARTIARTL',
  'NSE:EQ:1922': 'KOTAKBANK',
  'NSE:EQ:11483': 'LT',
  'NSE:EQ:5900': 'AXISBANK',
  'NSE:EQ:3456': 'TATAMOTORS',
  'NSE:EQ:3351': 'SUNPHARMA',
  'NSE:EQ:10999': 'MARUTI',
  'NSE:EQ:3787': 'WIPRO',
  'NSE:EQ:317': 'BAJFINANCE',
  'NSE:ETF:10576': 'NIFTYBEES',
  'NSE:ETF:14428': 'GOLDBEES',
  'NSE:ETF:11439': 'BANKBEES',
  'NSE:ETF:8080': 'SILVERBEES',
};

function buildIndex(list: MasterInstrument[], updatedAt: string): MasterIndex {
  const byId = new Map<string, MasterInstrument>();
  const bySymbol = new Map<string, MasterInstrument>();
  const byWireKey = new Map<string, MasterInstrument>();

  const combined = [...CORE_INDICES, ...list];
  for (const rec of combined) {
    rec.tickSize = normalizeTickSizeRupees(rec.tickSize);

    const canonical = CANONICAL_TICKER_BY_ID[rec.instrumentId];
    if (canonical && rec.symbol.includes(' ')) {
      rec.symbol = canonical;
      rec.tradingSymbol = canonical;
    }

    const keys = [
      rec.symbol.toUpperCase(),
      rec.tradingSymbol.toUpperCase(),
    ];

    if (rec.instrumentKind === 'OPTIONS' && rec.displayName && (rec.exchange === 'NSE' || rec.exchange === 'BSE')) {
      const dispUpper = rec.displayName.trim().toUpperCase();
      rec.tradingSymbol = dispUpper;
      keys.push(dispUpper);
    } else if (rec.displayName) {
      keys.push(rec.displayName.trim().toUpperCase());
    }

    if (rec.segment === 'ETF') {
      const m = /\(([A-Z0-9&-]{2,20})\)/.exec((rec.displayName || '').toUpperCase());
      if (m) {
        const etfTicker = m[1];
        keys.push(etfTicker);
        if (rec.symbol.includes(' ')) {
          rec.symbol = etfTicker;
          rec.tradingSymbol = etfTicker;
        }
      }
    }

    byId.set(rec.instrumentId, rec);
    byWireKey.set(`${rec.providerSegment}:${rec.providerSecId}`, rec);

    for (const k of keys) {
      if (!k) continue;
      const cur = bySymbol.get(k);
      if (!cur || preferenceRank(rec) > preferenceRank(cur)) {
        bySymbol.set(k, rec);
      }
    }
  }

  return { updatedAt, list: combined, byId, bySymbol, byWireKey };
}

function parseMasterCsv(csvText: string): MasterInstrument[] {
  const lines = csvText.split(/\r?\n/);
  const list: MasterInstrument[] = [];
  if (lines.length < 2) return list;

  // Auto-detect Detailed (32 cols: EXCH_ID,SEGMENT,SECURITY_ID,ISIN,...) vs Compact (16 cols: SEM_EXM_EXCH_ID,...)
  const header = (lines[0] || '').toUpperCase();
  const isDetailed = header.startsWith('EXCH_ID,') || header.includes(',MTF_LEVERAGE,');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = parseCsvLine(line);

    const exchRaw = (f[0] || '').trim().toUpperCase();
    const segRaw = (f[1] || '').trim().toUpperCase();
    const secId = (f[2] || '').trim();

    let isin: string | null = null;
    let instrRaw = '';
    let tradingSymbol = '';
    let displayName = '';
    let lotUnits = 1;
    let expiryDate: string | null = null;
    let strikeRaw = '';
    let optRaw = '';
    let tickSize = '0.05';
    let series: string | null = null;
    let symbolName = '';
    let bracketEligible = true;
    let coverEligible = true;
    let asmGsmFlag: string | null = null;
    let mtfLeverage: string | null = null;
    let upperCircuit: string | null = null;
    let lowerCircuit: string | null = null;
    let freezeQty: number | null = null;

    if (isDetailed) {
      // Detailed CSV layout:
      // 0:EXCH_ID 1:SEGMENT 2:SECURITY_ID 3:ISIN 4:INSTRUMENT 5:UNDERLYING_SECURITY_ID
      // 6:UNDERLYING_SYMBOL 7:SYMBOL_NAME 8:DISPLAY_NAME 9:INSTRUMENT_TYPE 10:SERIES
      // 11:LOT_SIZE 12:SM_EXPIRY_DATE 13:STRIKE_PRICE 14:OPTION_TYPE 15:TICK_SIZE
      // 16:EXPIRY_FLAG 17:BRACKET_FLAG 18:COVER_FLAG 19:ASM_GSM_FLAG 20:ASM_GSM_CATEGORY
      // 28:MTF_LEVERAGE 29:SM_UPPER_LIMIT 30:SM_LOWER_LIMIT 31:SM_FREEZE_QTY
      const isinRaw = (f[3] || '').trim();
      isin = isinRaw && isinRaw !== 'NA' ? isinRaw : null;
      instrRaw = (f[4] || '').trim().toUpperCase();
      const underlyingSym = (f[6] || '').trim();
      const symName = (f[7] || '').trim();
      displayName = (f[8] || symName || underlyingSym).trim();
      const preOpt = (f[14] || '').trim().toUpperCase();
      if (segRaw === 'E' && (exchRaw === 'NSE' || exchRaw === 'BSE')) {
        symbolName = underlyingSym || symName;
        tradingSymbol = underlyingSym || symName;
      } else if (segRaw === 'D' && (preOpt === 'CE' || preOpt === 'PE') && displayName) {
        symbolName = symName || underlyingSym;
        tradingSymbol = displayName.toUpperCase();
      } else {
        symbolName = symName || underlyingSym;
        tradingSymbol = symbolName || displayName;
      }
      series = (f[10] || '').trim().toUpperCase() || null;
      lotUnits = Math.max(1, Math.round(parseFloat(f[11] || '1') || 1));
      const expRaw = (f[12] || '').trim();
      expiryDate = expRaw && expRaw !== 'NA' ? expRaw : null;
      strikeRaw = (f[13] || '').trim();
      optRaw = (f[14] || '').trim().toUpperCase();
      tickSize = normalizeTickSizeRupees(f[15]);
      bracketEligible = (f[17] || 'Y').trim().toUpperCase() !== 'N';
      coverEligible = (f[18] || 'Y').trim().toUpperCase() !== 'N';
      const asmFlag = (f[19] || '').trim().toUpperCase();
      const asmCat = (f[20] || '').trim();
      asmGsmFlag = asmFlag === 'Y' ? (asmCat && asmCat !== 'NA' ? asmCat : 'ASM/GSM') : null;
      const mtfNum = parseFloat(f[28] || '0');
      mtfLeverage = Number.isFinite(mtfNum) && mtfNum > 1 ? mtfNum.toFixed(2) : null;
      const upNum = parseFloat(f[29] || '0');
      const loNum = parseFloat(f[30] || '0');
      upperCircuit = Number.isFinite(upNum) && upNum > 0 ? upNum.toFixed(2) : null;
      lowerCircuit = Number.isFinite(loNum) && loNum > 0 ? loNum.toFixed(2) : null;
      const frzNum = Math.round(parseFloat(f[31] || '0'));
      freezeQty = Number.isFinite(frzNum) && frzNum > 0 ? frzNum : null;
    } else {
      instrRaw = (f[3] || '').trim().toUpperCase();
      tradingSymbol = (f[5] || '').trim();
      lotUnits = Math.max(1, Math.round(parseFloat(f[6] || '1') || 1));
      displayName = (f[7] || tradingSymbol).trim();
      expiryDate = (f[8] || '').trim() || null;
      strikeRaw = (f[9] || '').trim();
      optRaw = (f[10] || '').trim().toUpperCase();
      tickSize = normalizeTickSizeRupees(f[11]);
      series = (f[14] || '').trim().toUpperCase() || null;
      symbolName = (f[15] || tradingSymbol).trim();
    }

    if (!secId || !tradingSymbol) continue;

    // Map strictly to our supported Indian market segments (NSE/BSE/MCX)
    let exchange: ExchangeCode;
    let providerSegment: string;
    let segment: MarketSegment;
    let instrumentKind: InstrumentKind;

    if (instrRaw === 'INDEX') {
      exchange = exchRaw === 'BSE' ? 'BSE' : 'NSE';
      providerSegment = 'IDX_I';
      segment = 'FNO';
      instrumentKind = 'INDEX';
    } else if (exchRaw === 'MCX') {
      exchange = 'MCX';
      providerSegment = 'MCX_COMM';
      segment = 'COMM';
      instrumentKind = optRaw === 'CE' || optRaw === 'PE' ? 'OPTIONS' : 'FUTURES';
    } else if (exchRaw === 'NSE' || exchRaw === 'BSE') {
      exchange = exchRaw;
      if (segRaw === 'D') {
        providerSegment = exchange === 'NSE' ? 'NSE_FNO' : 'BSE_FNO';
        segment = 'FNO';
        instrumentKind = optRaw === 'CE' || optRaw === 'PE' ? 'OPTIONS' : 'FUTURES';
      } else if (segRaw === 'E') {
        providerSegment = exchange === 'NSE' ? 'NSE_EQ' : 'BSE_EQ';
        const etf = isEtfSymbol(tradingSymbol, displayName);
        segment = etf ? 'ETF' : 'EQ';
        instrumentKind = etf ? 'ETF' : 'EQUITY';
      } else {
        continue;
      }
    } else {
      continue;
    }

    const strikePrice =
      strikeRaw && strikeRaw !== '-0.01000' && Number(strikeRaw) > 0
        ? Number(strikeRaw).toFixed(2)
        : null;
    const optionType = optRaw === 'CE' || optRaw === 'PE' ? optRaw : null;

    list.push({
      instrumentId: `${exchange}:${segment}:${secId}`,
      providerSegment,
      providerSecId: secId,
      exchange,
      segment,
      instrumentKind,
      symbol: symbolName.toUpperCase(),
      tradingSymbol: tradingSymbol.toUpperCase(),
      displayName,
      lotSize: lotUnits,
      tickSize,
      expiryDate,
      strikePrice,
      optionType,
      series,
      isin,
      mtfLeverage,
      freezeQty,
      upperCircuit,
      lowerCircuit,
      asmGsmFlag,
      bracketEligible,
      coverEligible,
    });
  }

  return list;
}

function loadFromDiskCache(): MasterIndex | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const stat = fs.statSync(CACHE_PATH);
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as {
      updatedAt: string;
      list: MasterInstrument[];
    };
    if (!Array.isArray(raw.list) || raw.list.length === 0) return null;
    const idx = buildIndex(raw.list, raw.updatedAt || stat.mtime.toISOString());
    return idx;
  } catch {
    return null;
  }
}

export async function refreshInstrumentMaster(): Promise<{ count: number; updatedAt: string }> {
  if (refreshInFlight) {
    const idx = await refreshInFlight;
    return { count: idx.list.length, updatedAt: idx.updatedAt };
  }

  refreshInFlight = (async () => {
    const resp = await axios.get<string>(SCRIP_MASTER_CSV_URL, {
      responseType: 'text',
      timeout: 45_000,
    });
    const parsed = parseMasterCsv(resp.data);
    const updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ updatedAt, list: parsed }));
    const idx = buildIndex(parsed, updatedAt);
    memoryIndex = idx;
    return idx;
  })();

  try {
    const idx = await refreshInFlight;
    return { count: idx.list.length, updatedAt: idx.updatedAt };
  } finally {
    refreshInFlight = null;
  }
}

export async function getMasterIndex(): Promise<MasterIndex> {
  if (memoryIndex) return memoryIndex;

  const disk = loadFromDiskCache();
  if (disk) {
    memoryIndex = disk;
    const ageMs = Date.now() - new Date(disk.updatedAt).getTime();
    if (ageMs > MAX_CACHE_AGE_MS && process.env.NODE_ENV !== 'test') {
      // Refresh in background without blocking caller
      refreshInstrumentMaster().catch(() => {});
    }
    return disk;
  }

  try {
    await refreshInstrumentMaster();
    if (memoryIndex) return memoryIndex;
  } catch {
    // Offline / sandbox fallback: serve core indices so unit tests work cleanly
  }
  memoryIndex = buildIndex([], new Date().toISOString());
  return memoryIndex;
}

export async function resolveInstrument(symbolOrId: string): Promise<MasterInstrument | null> {
  const idx = await getMasterIndex();
  const raw = String(symbolOrId || '').trim().toUpperCase();
  if (!raw) return null;

  const byId = idx.byId.get(raw);
  if (byId) return byId;

  const stripped = raw.replace(/\.(NS|BO)$/, '');
  const aliased = SYMBOL_ALIASES[raw] || SYMBOL_ALIASES[stripped] || stripped;

  return idx.bySymbol.get(aliased) || idx.bySymbol.get(raw) || null;
}

export async function resolveByWireKey(providerSegment: string, providerSecId: string): Promise<MasterInstrument | null> {
  const idx = await getMasterIndex();
  return idx.byWireKey.get(`${providerSegment}:${providerSecId}`) || null;
}

export async function searchInstruments(params: {
  query?: string;
  segment?: MarketSegment;
  exchange?: ExchangeCode;
  instrumentKind?: InstrumentKind;
  limit?: number;
}): Promise<MasterInstrument[]> {
  const idx = await getMasterIndex();
  const q = (params.query || '').trim().toUpperCase();
  const limit = Math.min(Math.max(1, params.limit ?? 30), 100);

  const exact: MasterInstrument[] = [];
  const starts: MasterInstrument[] = [];
  const contains: MasterInstrument[] = [];

  for (const item of idx.list) {
    if (params.segment && item.segment !== params.segment) continue;
    if (params.exchange && item.exchange !== params.exchange) continue;
    if (params.instrumentKind && item.instrumentKind !== params.instrumentKind) continue;

    if (!q) {
      contains.push(item);
      if (contains.length >= limit) break;
      continue;
    }

    const sym = item.symbol;
    const tsym = item.tradingSymbol;
    const name = item.displayName.toUpperCase();

    if (sym === q || tsym === q) exact.push(item);
    else if (sym.startsWith(q) || tsym.startsWith(q) || name.startsWith(q)) starts.push(item);
    else if (sym.includes(q) || tsym.includes(q) || name.includes(q)) contains.push(item);

    if (exact.length + starts.length >= limit * 2) break;
  }

  return [...exact, ...starts, ...contains].slice(0, limit);
}

export function getCoreIndices(): MasterInstrument[] {
  return CORE_INDICES;
}

/** Find matching BSE/NSE sibling instrument by ISIN or symbol for instant NSE↔BSE toggle. */
export async function findSiblingExchangeInstrument(symbolOrId: string): Promise<MasterInstrument | null> {
  const base = await resolveInstrument(symbolOrId);
  if (!base || (base.exchange !== 'NSE' && base.exchange !== 'BSE')) return null;
  const targetExch = base.exchange === 'NSE' ? 'BSE' : 'NSE';
  const idx = await getMasterIndex();
  for (const item of idx.list) {
    if (item.exchange !== targetExch || item.segment !== base.segment) continue;
    if (base.isin && item.isin && base.isin === item.isin) return item;
    if (item.symbol === base.symbol || item.tradingSymbol === base.tradingSymbol) return item;
  }
  return null;
}
