import { SetMetadata, applyDecorators } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle';

export interface ThrottleConfig {
  /** Throttle key identifier */
  key: string;
  /** Maximum requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSec: number;
  /** Optional: throttle by user, IP, or a custom key */
  by?: 'user' | 'ip' | 'apiKey';
}

/**
 * Fine-grained throttle decorator for individual endpoints.
 * Unlike global rate limits, this allows per-endpoint configuration.
 *
 * @example
 * @ThrottleBy({ key: 'report-export', limit: 5, windowSec: 3600, by: 'user' })
 * @Post('export')
 * exportReport() { ... }
 */
export const ThrottleBy = (config: ThrottleConfig) =>
  applyDecorators(SetMetadata(THROTTLE_KEY, config));

/**
 * Preset: strict throttle for expensive operations (5 req / hour).
 */
export const ThrottleStrict = (key: string) =>
  ThrottleBy({ key, limit: 5, windowSec: 3600, by: 'user' });

/**
 * Preset: moderate throttle for standard write operations (30 req / minute).
 */
export const ThrottleModerate = (key: string) =>
  ThrottleBy({ key, limit: 30, windowSec: 60, by: 'user' });

/**
 * Preset: relaxed throttle for read-heavy endpoints (200 req / minute).
 */
export const ThrottleRelaxed = (key: string) =>
  ThrottleBy({ key, limit: 200, windowSec: 60, by: 'ip' });
