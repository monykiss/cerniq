import { SetMetadata } from '@nestjs/common';

/**
 * @RateLimitTier decorator — assign per-endpoint rate limit tiers.
 *
 * Tiers:
 * - 'free': 10 req/min (demo users, trial)
 * - 'standard': 60 req/min (paid users)
 * - 'compute': 5 req/min (Monte Carlo, stress testing)
 * - 'unlimited': no per-endpoint limit (admin, health)
 */
export const RATE_LIMIT_TIER_KEY = 'rate_limit_tier';
export type RateLimitTier = 'free' | 'standard' | 'compute' | 'unlimited';
export const RateLimitTier = (tier: RateLimitTier) =>
  SetMetadata(RATE_LIMIT_TIER_KEY, tier);
