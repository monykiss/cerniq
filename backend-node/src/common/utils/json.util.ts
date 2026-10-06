/**
 * Safe JSON utilities — parse with fallback, BigInt support.
 * Handles edge cases that native JSON methods do not.
 */

/**
 * Safely parse a JSON string, returning a fallback value on failure.
 */
export function safeParse<T = unknown>(
  input: string,
  fallback: T | null = null,
): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

/**
 * JSON.stringify with BigInt support.
 * Converts BigInt values to strings with a "n" suffix for round-tripping.
 */
export function stringifyWithBigInt(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, val) => (typeof val === 'bigint' ? `${val.toString()}n` : val),
    space,
  );
}

/**
 * JSON.parse with BigInt restoration.
 * Restores strings ending with "n" back to BigInt values.
 */
export function parseWithBigInt<T = unknown>(input: string): T {
  return JSON.parse(input, (_key, val) => {
    if (typeof val === 'string' && /^\d+n$/.test(val)) {
      return BigInt(val.slice(0, -1));
    }
    return val;
  }) as T;
}

/**
 * Deep clone an object via JSON serialization.
 * Does not support functions, Dates (become strings), or circular references.
 */
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Check if a string is valid JSON.
 */
export function isValidJson(input: string): boolean {
  try {
    JSON.parse(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pretty-print JSON with configurable indentation.
 */
export function prettyJson(value: unknown, indent = 2): string {
  return JSON.stringify(value, null, indent);
}
