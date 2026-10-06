/**
 * Type-safe URL search parameter utilities for Next.js pages.
 */

/** Parse a search param as string with fallback */
export function paramString(
  params: Record<string, string | string[] | undefined>,
  key: string,
  fallback = '',
): string {
  const val = params[key];
  if (Array.isArray(val)) return val[0] ?? fallback;
  return val ?? fallback;
}

/** Parse a search param as integer with fallback */
export function paramInt(
  params: Record<string, string | string[] | undefined>,
  key: string,
  fallback = 0,
): number {
  const str = paramString(params, key);
  const parsed = parseInt(str, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a search param as boolean (accepts "true", "1", "yes") */
export function paramBool(
  params: Record<string, string | string[] | undefined>,
  key: string,
  fallback = false,
): boolean {
  const str = paramString(params, key).toLowerCase();
  if (['true', '1', 'yes'].includes(str)) return true;
  if (['false', '0', 'no'].includes(str)) return false;
  return fallback;
}
