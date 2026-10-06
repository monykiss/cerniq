/**
 * Math utilities — clamp, lerp, percentile, safe division.
 * Numeric helpers for analytics and calculations.
 */

/**
 * Clamp a value between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values.
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * clamp(t, 0, 1);
}

/**
 * Calculate the nth percentile of a sorted numeric array.
 * @param values - Pre-sorted array of numbers
 * @param p - Percentile (0-100)
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (p <= 0) return values[0];
  if (p >= 100) return values[values.length - 1];

  const index = (p / 100) * (values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

/**
 * Safe division that returns a default value instead of Infinity or NaN.
 */
export function safeDiv(
  numerator: number,
  denominator: number,
  defaultValue = 0,
): number {
  if (denominator === 0 || !Number.isFinite(denominator)) return defaultValue;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : defaultValue;
}

/**
 * Round a number to a specified number of decimal places.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Calculate the sum of an array of numbers.
 */
export function sum(values: number[]): number {
  return values.reduce((acc, val) => acc + val, 0);
}

/**
 * Calculate the arithmetic mean of an array of numbers.
 */
export function mean(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}
