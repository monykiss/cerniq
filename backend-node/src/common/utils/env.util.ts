/**
 * Type-safe environment variable reader with defaults.
 * Complements environment.util.ts with additional type coercion helpers.
 */

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function envBool(key: string, defaultValue = false): boolean {
  const val = (process.env[key] || '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(val)) return true;
  if (['0', 'false', 'no', 'off'].includes(val)) return false;
  return defaultValue;
}

export function envInt(key: string, defaultValue: number): number {
  const val = parseInt(process.env[key] || '', 10);
  return Number.isFinite(val) ? val : defaultValue;
}

export function envFloat(key: string, defaultValue: number): number {
  const val = parseFloat(process.env[key] || '');
  return Number.isFinite(val) ? val : defaultValue;
}

export function envEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const val = process.env[key] as T;
  return allowed.includes(val) ? val : defaultValue;
}
