import { createHash } from 'crypto';

/**
 * Consistent hashing utilities for cache key generation.
 * Produces deterministic, short hash strings for use as cache keys.
 */

/**
 * Generate a consistent hash string from input data.
 * Uses SHA-256 truncated to the desired length.
 */
export function consistentHash(
  data: string | Record<string, unknown>,
  length = 16,
): string {
  const input = typeof data === 'string' ? data : stableStringify(data);
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

/**
 * Build a cache key from a prefix and parameters.
 * Ensures consistent ordering of object keys.
 *
 * @example
 * buildCacheKey('user', { id: '123', fields: 'name,email' })
 * // => "user:a1b2c3d4e5f6"
 */
export function buildCacheKey(
  prefix: string,
  params: Record<string, unknown>,
): string {
  const hash = consistentHash(params);
  return `${prefix}:${hash}`;
}

/**
 * Deterministic JSON stringification (sorted keys).
 * Ensures the same object always produces the same string.
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  if (
    typeof obj === 'number' ||
    typeof obj === 'boolean' ||
    typeof obj === 'bigint'
  ) {
    return `${obj}`;
  }
  if (typeof obj === 'symbol') return obj.toString();
  if (typeof obj === 'function') return obj.toString();
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = sortedKeys.map(
    (key) =>
      `${JSON.stringify(key)}:${stableStringify((obj as Record<string, unknown>)[key])}`,
  );
  return '{' + parts.join(',') + '}';
}

/**
 * Generate a fingerprint for an object (useful for change detection).
 */
export function fingerprint(data: unknown): string {
  return consistentHash(stableStringify(data), 12);
}
