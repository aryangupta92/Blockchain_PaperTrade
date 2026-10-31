/**
 * utils/price.js - single source of truth for "is this price real?"
 *
 * The Dhan-backed feed now returns `price: null` (freshness UNAVAILABLE) when a
 * symbol has no real data. These helpers keep every component crash-free and
 * make the substituted "NO DATA" badge the only thing the user ever sees.
 */

export const NO_DATA = null;

/** Any usable number (null/undefined/NaN/'' all mean "no real price"). */
export function hasPrice(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

/** Format a real price; returns null when there is none (caller shows a badge). */
export function fmtPrice(v, min = 2) {
  if (!hasPrice(v)) return null;
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: min, maximumFractionDigits: min });
}

/** Price or an explicit em-dash for "no real data" (never 0, never a fake). */
export function priceOrDash(v, min = 2) {
  return fmtPrice(v, min) ?? '--.--';
}

/** Percent change with sign. */
export function fmtPct(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Gap/change in rupees. */
export function fmtGap(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Short volume: 12.4k / 4.6Cr like real brokers. */
export function fmtVol(v) {
  if (!hasPrice(v)) return '--';
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

/** Next movement worth at least `tick` (NSE tick size), so fake precision is gone. */
export function tickRound(v, tick = 0.05) {
  if (!hasPrice(v)) return null;
  return Math.round(v / tick) * tick;
}

/**
 * The pill every component should render instead of a price when the feed has
 * no real data. Keeps the UI honest and prevents "0.00" looking like a crash.
 */
export function NoDataBadge({ compact = false, label = 'NO DATA' }) {
  if (compact) {
    return <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 99, padding: '1px 6px' }}>{label}</span>;
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 700, color: '#94a3b8',
      background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.35)',
      borderRadius: 99, padding: '3px 9px',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#94a3b8' }} />
      {label}
    </span>
  );
}

/** Color class for a change value. */
export function changeClass(v) {
  if (typeof v !== 'number' || !isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'gain' : 'loss';
}
