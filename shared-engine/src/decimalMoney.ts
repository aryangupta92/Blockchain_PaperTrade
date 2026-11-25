import Decimal from 'decimal.js';

// Financial precision configuration: 20 significant digits, banker's/half-up rounding helpers
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal | string | number;

export function D(value: DecimalInput): Decimal {
  return new Decimal(value);
}

export const ZERO = new Decimal(0);

/** Round monetary amount to 2 decimal places (paise precision) using ROUND_HALF_UP. */
export function roundPaise(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round tax component (e.g., STT per Income Tax Act Sec 288B) to nearest rupee. */
export function roundNearestRupee(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/** Convert a percentage (e.g., 0.1 for 0.1%) into a rate multiplier (0.001). */
export function pctToRate(percent: DecimalInput): Decimal {
  return D(percent).div(100);
}

/** Format a Decimal amount in Indian numbering system: ₹1,00,000.00 */
export function formatINR(value: DecimalInput, includeSymbol = true): string {
  const num = roundPaise(value);
  const neg = num.isNegative();
  const absStr = num.abs().toFixed(2);
  const [intPart, decPart] = absStr.split('.');

  let formattedInt = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    formattedInt = `${grouped},${last3}`;
  }

  const prefix = `${neg ? '-' : ''}${includeSymbol ? '₹' : ''}`;
  return `${prefix}${formattedInt}.${decPart}`;
}

export const DEMO_MIN_BALANCE = D('1000');
export const DEMO_MAX_BALANCE = D('10000000'); // ₹1,00,00,000 (1 Crore)

export function validateDemoBalanceRange(amount: DecimalInput): {
  valid: boolean;
  value?: Decimal;
  error?: string;
} {
  try {
    const d = roundPaise(amount);
    if (!d.isFinite()) return { valid: false, error: 'Balance must be a valid finite amount.' };
    if (d.lt(DEMO_MIN_BALANCE) || d.gt(DEMO_MAX_BALANCE)) {
      return {
        valid: false,
        error: `DEMO balance must be between ${formatINR(DEMO_MIN_BALANCE)} and ${formatINR(DEMO_MAX_BALANCE)}.`,
      };
    }
    return { valid: true, value: d };
  } catch {
    return { valid: false, error: 'Invalid monetary value.' };
  }
}

export { Decimal };
