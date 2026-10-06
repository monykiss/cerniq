/**
 * Environment utilities for safe configuration access.
 * Provides type-safe environment variable reading with defaults,
 * validation, and clear error messages for missing required vars.
 */

/**
 * Get a required environment variable or throw.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Check your .env file or deployment configuration.`,
    );
  }
  return value;
}

/**
 * Get an optional environment variable with a default.
 */
export function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Get an environment variable as an integer.
 */
export function getEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get an environment variable as a boolean.
 * Treats 'true', '1', 'yes' as true; everything else as false.
 */
export function getEnvBool(key: string, defaultValue = false): boolean {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return ['true', '1', 'yes'].includes(raw.toLowerCase());
}

/**
 * Get an environment variable as a comma-separated list.
 */
export function getEnvList(key: string, defaultValue: string[] = []): string[] {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check if the current environment is production.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if the current environment is development.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Check if the current environment is test.
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}
