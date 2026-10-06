import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for per-endpoint cache TTL.
 */
export const CACHE_TTL_KEY = 'cache_ttl';

/**
 * Set a custom cache TTL (in seconds) on a specific endpoint.
 * Used by cache interceptors to determine expiration.
 *
 * @example
 * @CacheTTL(300) // 5 minutes
 * @Get('dashboard')
 * getDashboard() { ... }
 */
export const CacheTTL = (seconds: number) =>
  SetMetadata(CACHE_TTL_KEY, seconds);

/**
 * Mark an endpoint as uncacheable.
 */
export const NoCache = () => SetMetadata(CACHE_TTL_KEY, 0);
