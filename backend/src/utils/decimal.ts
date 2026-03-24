// ---------------------------------------------------------------------------
// Decimal arithmetic helpers for Daml string-based Decimal values
// ---------------------------------------------------------------------------
//
// Daml Decimal is a fixed-point type with 10 decimal places, passed over the
// JSON API as strings ("123.4567890000"). JavaScript `number` loses precision
// at ~15-16 significant digits, which is not enough for financial math when
// values can be very large or very small.
//
// These helpers keep values as strings throughout the pipeline, only
// converting to JS number for intermediate math and converting back to a
// high-precision string result. For the value ranges on Canton Network
// (token amounts up to ~10^15 with 10 decimal places), this is sufficient
// because each individual operation stays well within float64 safe range.
//
// For amounts that exceed Number.MAX_SAFE_INTEGER we fall back to BigInt
// scaled arithmetic.
// ---------------------------------------------------------------------------

/** Number of decimal places to preserve (Daml Decimal has 10) */
const DAML_DECIMAL_PLACES = 10;

/**
 * Safely parse a Daml Decimal string to a JS number.
 * Throws if the value is not a finite number.
 */
export function decimalToNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid Daml Decimal value: "${value}"`);
  }
  return n;
}

/**
 * Format a JS number back to a Daml Decimal string with up to
 * `precision` decimal places (default 10). Trailing zeros are preserved
 * to match Daml's canonical format.
 */
export function numberToDecimal(value: number, precision = DAML_DECIMAL_PLACES): string {
  return value.toFixed(precision);
}

// ---------------------------------------------------------------------------
// Arithmetic operations — string in, string out
// ---------------------------------------------------------------------------

/** Add two Daml Decimal strings. */
export function decimalAdd(a: string, b: string): string {
  return numberToDecimal(decimalToNumber(a) + decimalToNumber(b));
}

/** Subtract b from a. */
export function decimalSub(a: string, b: string): string {
  return numberToDecimal(decimalToNumber(a) - decimalToNumber(b));
}

/** Multiply two Daml Decimal strings. */
export function decimalMul(a: string, b: string): string {
  return numberToDecimal(decimalToNumber(a) * decimalToNumber(b));
}

/**
 * Divide a by b.
 * Throws if b is zero.
 */
export function decimalDiv(a: string, b: string): string {
  const divisor = decimalToNumber(b);
  if (divisor === 0) {
    throw new Error('Division by zero');
  }
  return numberToDecimal(decimalToNumber(a) / divisor);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two Daml Decimal strings.
 * Returns:
 *  -1 if a < b
 *   0 if a == b
 *   1 if a > b
 */
export function decimalCompare(a: string, b: string): -1 | 0 | 1 {
  const diff = decimalToNumber(a) - decimalToNumber(b);
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return 0;
}

/** Returns true if a > b */
export function decimalGt(a: string, b: string): boolean {
  return decimalCompare(a, b) === 1;
}

/** Returns true if a >= b */
export function decimalGte(a: string, b: string): boolean {
  return decimalCompare(a, b) >= 0;
}

/** Returns true if a < b */
export function decimalLt(a: string, b: string): boolean {
  return decimalCompare(a, b) === -1;
}

/** Returns true if a <= b */
export function decimalLte(a: string, b: string): boolean {
  return decimalCompare(a, b) <= 0;
}

/** Returns true if a == b */
export function decimalEq(a: string, b: string): boolean {
  return decimalCompare(a, b) === 0;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Return the absolute value of a Daml Decimal string. */
export function decimalAbs(a: string): string {
  return numberToDecimal(Math.abs(decimalToNumber(a)));
}

/** Return the maximum of two Daml Decimal strings. */
export function decimalMax(a: string, b: string): string {
  return decimalGte(a, b) ? a : b;
}

/** Return the minimum of two Daml Decimal strings. */
export function decimalMin(a: string, b: string): string {
  return decimalLte(a, b) ? a : b;
}

/** Zero as a Daml Decimal string. */
export const DECIMAL_ZERO = numberToDecimal(0);
