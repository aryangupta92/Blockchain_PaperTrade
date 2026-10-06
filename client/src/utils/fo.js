// fo.js — Client mirror of server/services/foMaster.js (keep in sync).
// NSE FAOP/70616 lots (Jan-2026 series) · SEBI Tue/Thu expiry mandate (Sep-2025).

export const UNDERLYINGS = {
  NIFTY:      { exchange: 'NSE', lot: 65,  step: 50,  weeklies: true,  expiryDay: 2, freezeLots: 1800, label: 'Nifty 50' },
  BANKNIFTY:  { exchange: 'NSE', lot: 30,  step: 100, weeklies: false, expiryDay: 2, freezeLots: 900,  label: 'Nifty Bank' },
  FINNIFTY:   { exchange: 'NSE', lot: 60,  step: 50,  weeklies: false, expiryDay: 2, freezeLots: 1800, label: 'Nifty Fin Services' },
  MIDCPNIFTY: { exchange: 'NSE', lot: 120, step: 25,  weeklies: false, expiryDay: 2, freezeLots: 1200, label: 'Nifty Mid Select' },
  NIFTYNXT50: { exchange: 'NSE', lot: 25,  step: 50,  weeklies: false, expiryDay: 2, freezeLots: 1500, label: 'Nifty Next 50' },
  SENSEX:     { exchange: 'BSE', lot: 20,  step: 100, weeklies: true,  expiryDay: 4, freezeLots: 2400, label: 'BSE Sensex' },
  BANKEX:     { exchange: 'BSE', lot: 30,  step: 100, weeklies: false, expiryDay: 4, freezeLots: 1000, label: 'BSE Bankex' },
};

const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export const getSpec = (u) => UNDERLYINGS[String(u || '').toUpperCase()] || null;
export const getLotSize = (u) => getSpec(u)?.lot || 1;
export const getStep = (u) => getSpec(u)?.step || 50;

const codeOf = (d) => `${String(d.getUTCDate()).padStart(2, '0')}${MON[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;

function nextWeekdays(day, count) {
  const out = [];
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!(d.getUTCDay() === day && mins <= 930)) d.setUTCDate(d.getUTCDate() + 1);
  while (out.length < count) {
    if (d.getUTCDay() === day) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function monthEnds(weekday, count) {
  const out = [];
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  while (out.length < count) {
    const last = new Date(Date.UTC(y, m + 1, 0));
    while (last.getUTCDay() !== weekday) last.setUTCDate(last.getUTCDate() - 1);
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (last >= todayUTC) out.push(new Date(last));
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

export function expiriesFor(underlying, max = 8) {
  const spec = getSpec(underlying);
  if (!spec) return [];
  const seen = new Map();
  if (spec.weeklies) {
    nextWeekdays(spec.expiryDay, 6).forEach(d => {
      const c = codeOf(d);
      if (!seen.has(c)) seen.set(c, { code: c, iso: d.toISOString().slice(0, 10), kind: 'W' });
    });
  }
  monthEnds(spec.expiryDay, 4).forEach(d => {
    const c = codeOf(d);
    if (!seen.has(c)) seen.set(c, { code: c, iso: d.toISOString().slice(0, 10), kind: 'M' });
  });
  return [...seen.values()].sort((a, b) => (a.iso < b.iso ? -1 : 1)).slice(0, max);
}

export const expiryLabel = (e) => {
  if (!e) return '—';
  const d = new Date(e.iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}${e.kind === 'W' ? ' · W' : ' · M'}`;
};

export const buildFOSymbol = (underlying, expiryCode, strike, optionType, isFutures) => {
  if (!underlying || !expiryCode) return '';
  if (isFutures) return `${underlying}${expiryCode}FUT`;
  if (strike == null || strike === '' || !optionType) return '';
  return `${underlying}${expiryCode}${strike}${optionType}`;
};

// Chain-request symbol → canonical underlying
export function underlyingOf(sym) {
  const s = String(sym || '').toUpperCase().replace('.NS', '').replace('.BO', '');
  if (s === '^NSEI' || s === 'NIFTY') return 'NIFTY';
  if (s === '^NSEBANK' || s === 'BANKNIFTY') return 'BANKNIFTY';
  if (s === '^BSESN' || s === 'SENSEX') return 'SENSEX';
  if (s === 'FINNIFTY') return 'FINNIFTY';
  if (s === 'MIDCPNIFTY') return 'MIDCPNIFTY';
  if (s === 'BANKEX') return 'BANKEX';
  return UNDERLYINGS[s] ? s : null;
}

// ── SEBI-mandated F&O risk disclosure (Oct-2024 framework: 9/10 lose money) ──
export const SEBI_FO_WARNING =
  'SEBI study: 9 out of 10 individual F&O traders lose money. Option buyers pay full premium upfront and can lose 100%. Option sellers block SPAN + exposure margin with theoretically unlimited loss. Trade only with capital you can afford to lose.';

// ── Payoff at expiry for a single leg (for the pre-trade chart) ──
export function legPayoff(leg, spotAtExpiry) {
  // leg: { optionType:'CE'|'PE'|'FUT', strike, premium (paid + / received -), qty, side:'buy'|'sell' }
  const { optionType, strike, premium = 0, qty = 0, side = 'buy' } = leg;
  const dir = side === 'buy' ? 1 : -1;
  let intrinsic = 0;
  if (optionType === 'CE') intrinsic = Math.max(0, spotAtExpiry - strike);
  else if (optionType === 'PE') intrinsic = Math.max(0, strike - spotAtExpiry);
  else intrinsic = spotAtExpiry - strike; // futures: strike = entry price
  return dir * (intrinsic - (side === 'buy' ? premium : -premium)) * qty;
}

export function payoffRange(spot, step) {
  const width = Math.max(step * 10, spot * 0.06);
  const out = [];
  for (let i = -20; i <= 20; i++) out.push(spot + (width * i) / 20);
  return out;
}
