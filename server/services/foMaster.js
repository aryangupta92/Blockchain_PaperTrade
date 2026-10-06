'use strict';
/**
 * foMaster.js — Single source of truth for Indian F&O contract specs.
 * ─────────────────────────────────────────────────────────────────────────────
 * Sources:
 *  - Lot sizes : NSE circular FAOP/70616 (03-Oct-2025), effective Jan-2026 series.
 *  - Expiry    : SEBI mandate (May-2025 circular) — one weekly benchmark per
 *                exchange. NSE = Tuesday, BSE = Thursday (w.e.f. 01-Sep-2025).
 *                NSE weeklies: NIFTY only. BSE weeklies: SENSEX only.
 *                All other index derivatives: monthly (last Tue NSE / last Thu BSE).
 *  - STT       : Finance Act 2026 (w.e.f. 01-Apr-2026) — options sell 0.15% of
 *                premium, futures sell 0.05% of turnover.
 *
 * Expiry code format DDMMMYY (e.g. 06JAN26) matches parseFOSymbol + OMS builder.
 */

// JS getUTCDay: Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6
const UNDERLYINGS = {
  NIFTY:      { exchange: 'NSE', lot: 65,  step: 50,  weeklies: true,  expiryDay: 2, freezeLots: 1800, label: 'Nifty 50' },
  BANKNIFTY:  { exchange: 'NSE', lot: 30,  step: 100, weeklies: false, expiryDay: 2, freezeLots: 900,  label: 'Nifty Bank' },
  FINNIFTY:   { exchange: 'NSE', lot: 60,  step: 50,  weeklies: false, expiryDay: 2, freezeLots: 1800, label: 'Nifty Financial Services' },
  MIDCPNIFTY: { exchange: 'NSE', lot: 120, step: 25,  weeklies: false, expiryDay: 2, freezeLots: 1200, label: 'Nifty Mid Select' },
  NIFTYNXT50: { exchange: 'NSE', lot: 25,  step: 50,  weeklies: false, expiryDay: 2, freezeLots: 1500, label: 'Nifty Next 50' },
  SENSEX:     { exchange: 'BSE', lot: 20,  step: 100, weeklies: true,  expiryDay: 4, freezeLots: 2400, label: 'BSE Sensex' },
  BANKEX:     { exchange: 'BSE', lot: 30,  step: 100, weeklies: false, expiryDay: 4, freezeLots: 1000, label: 'BSE Bankex' },
  SENSEX50:   { exchange: 'BSE', lot: 70,  step: 100, weeklies: false, expiryDay: 4, freezeLots: 1000, label: 'BSE Sensex 50' },
};

const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function getSpec(underlying) {
  const u = String(underlying || '').toUpperCase();
  return UNDERLYINGS[u] || null;
}

function codeOf(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd}${MON[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
}

// Next `count` occurrences of weekday `day` (UTC), skipping today's if market closed (>15:30 IST)
function nextWeekdays(day, count) {
  const out = [];
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST wall-clock
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // if today is expiry day and market already closed, start from tomorrow
  if (!(d.getUTCDay() === day && mins <= 930)) d.setUTCDate(d.getUTCDate() + 1);
  while (out.length < count) {
    if (d.getUTCDay() === day) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Last `weekday` of each of the next `count` calendar months
function monthEnds(weekday, count) {
  const out = [];
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  while (out.length < count) {
    const last = new Date(Date.UTC(y, m + 1, 0)); // last day of month
    while (last.getUTCDay() !== weekday) last.setUTCDate(last.getUTCDate() - 1);
    // skip month-end already past (before today)
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (last >= todayUTC) out.push(new Date(last));
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

/**
 * Expiry list for an underlying: weeklies (if any) + month-ends, deduped, sorted.
 * @returns [{ code:'06JAN26', iso:'2026-01-06', kind:'W'|'M' }]
 */
function expiriesFor(underlying, max = 8) {
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
  return [...seen.values()]
    .sort((a, b) => (a.iso < b.iso ? -1 : 1))
    .slice(0, max);
}

/** Map chain-request symbols (^NSEI, BANKNIFTY, …) to canonical underlying codes. */
function underlyingOf(sym) {
  const s = String(sym || '').toUpperCase().replace('.NS', '').replace('.BO', '');
  if (s === '^NSEI' || s === 'NIFTY') return 'NIFTY';
  if (s === '^NSEBANK' || s === 'BANKNIFTY') return 'BANKNIFTY';
  if (s === '^BSESN' || s === 'SENSEX') return 'SENSEX';
  if (s === 'FINNIFTY' || s === '^CNXFIN') return 'FINNIFTY';
  if (s === 'MIDCPNIFTY') return 'MIDCPNIFTY';
  if (s === 'BANKEX') return 'BANKEX';
  if (UNDERLYINGS[s]) return s;
  return null;
}

module.exports = { UNDERLYINGS, getSpec, expiriesFor, underlyingOf };
