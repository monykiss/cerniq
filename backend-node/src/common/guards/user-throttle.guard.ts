import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * User-aware rate limiting guard.
 * Uses authenticated userId as the throttle key instead of IP.
 * Falls back to IP for unauthenticated requests.
 *
 * This prevents a single authenticated user from monopolizing
 * expensive ALM calculations while still rate-limiting anonymous traffic by IP.
 */
@Injectable()
export class UserThrottleGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Prefer user ID (set by AuthGuard) over IP
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    // Fall back to IP for unauthenticated requests
    return req.ip || req.connection?.remoteAddress || 'unknown';
  }
}
