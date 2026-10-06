import { SetMetadata } from '@nestjs/common';

export const CACHE_KEY_METADATA = 'cacheKey';
export const CACHE_TTL_METADATA = 'cacheTtl';

/**
 * @CacheKey() decorator to set a custom cache key on a route handler.
 * Used with cache interceptors to enable fine-grained cache control.
 *
 * @example
 * @CacheKey('portfolio:summary')
 * @CacheTtl(300)
 * @Get('summary')
 * getSummary() { ... }
 */
export const CacheKey = (key: string) => SetMetadata(CACHE_KEY_METADATA, key);

/**
 * @CacheTtl() decorator to set cache time-to-live in seconds.
 */
export const CacheTtl = (ttlSeconds: number) =>
  SetMetadata(CACHE_TTL_METADATA, ttlSeconds);
