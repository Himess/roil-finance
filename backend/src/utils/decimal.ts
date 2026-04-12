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
// BigInt-scaled arithmetic — for values exceeding Number.MAX_SAFE_INTEGER
// ---------------------------------------------------------------------------

/** Scale factor for BigInt arithmetic: 10^DAML_DECIMAL_PLACES */
const BIGINT_SCALE = 10n ** BigInt(DAML_DECIMAL_PLACES);

/**
 * Returns true if the integer part of a decimal string has more than 15
 * significant digits, meaning Number (float64) would lose precision.
 */
function needsBigInt(value: string): boolean {
  const intPart = value.split('.')[0].replace(/^-/, '');
  return intPart.length > 15;
}

/**
 * Parse a Daml Decimal string into a BigInt scaled by BIGINT_SCALE.
 * E.g. "123.45" with 10 decimal places -> 1234500000000n
 */
function toBigIntScaled(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPartRaw] = abs.split('.');
  const fracPart = (fracPartRaw || '').padEnd(DAML_DECIMAL_PLACES, '0').slice(0, DAML_DECIMAL_PLACES);
  const combined = BigInt(intPart + fracPart);
  return negative ? -combined : combined;
}

/**
 * Convert a scaled BigInt back to a Daml Decimal string with DAML_DECIMAL_PLACES.
 */
function fromBigIntScaled(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const str = abs.toString().padStart(DAML_DECIMAL_PLACES + 1, '0');
  const intPart = str.slice(0, str.length - DAML_DECIMAL_PLACES) || '0';
  const fracPart = str.slice(str.length - DAML_DECIMAL_PLACES);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

// ---------------------------------------------------------------------------
// Arithmetic operations — string in, string out
// ---------------------------------------------------------------------------

/** Add two Daml Decimal strings. Uses BigInt if either value is large. */
export function decimalAdd(a: string, b: string): string {
  if (needsBigInt(a) || needsBigInt(b)) {
    return fromBigIntScaled(toBigIntScaled(a) + toBigIntScaled(b));
  }
  return numberToDecimal(decimalToNumber(a) + decimalToNumber(b));
}

/** Subtract b from a. Uses BigInt if either value is large. */
export function decimalSub(a: string, b: string): string {
  if (needsBigInt(a) || needsBigInt(b)) {
    return fromBigIntScaled(toBigIntScaled(a) - toBigIntScaled(b));
  }
  return numberToDecimal(decimalToNumber(a) - decimalToNumber(b));
}

/** Multiply two Daml Decimal strings. Uses BigInt if either value is large. */
export function decimalMul(a: string, b: string): string {
  if (needsBigInt(a) || needsBigInt(b)) {
    // Multiply two scaled values: (a * SCALE) * (b * SCALE) / SCALE = a * b * SCALE
    const product = toBigIntScaled(a) * toBigIntScaled(b);
    return fromBigIntScaled(product / BIGINT_SCALE);
  }
  return numberToDecimal(decimalToNumber(a) * decimalToNumber(b));
}

/**
 * Divide a by b. Uses BigInt if either value is large.
 * Throws if b is zero.
 */
export function decimalDiv(a: string, b: string): string {
  if (needsBigInt(a) || needsBigInt(b)) {
    const bScaled = toBigIntScaled(b);
    if (bScaled === 0n) {
      throw new Error('Division by zero');
    }
    // (a * SCALE) * SCALE / (b * SCALE) = (a / b) * SCALE
    const dividend = toBigIntScaled(a) * BIGINT_SCALE;
    return fromBigIntScaled(dividend / bScaled);
  }
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

/** Zero as a Daml Decimal string. */
export const DECIMAL_ZERO = numberToDecimal(0);
