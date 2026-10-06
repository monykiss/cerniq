import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';

/**
 * Per-user rate limiting guard using in-memory sliding window.
 * Tracks request counts per user ID with configurable window and limit.
 * For production, replace with Redis-backed implementation.
 */
@Injectable()
export class RateLimitByUserGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitByUserGuard.name);
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly store = new Map<string, number[]>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(maxRequests = 100, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Cleanup stale entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id || request.ip || 'anonymous';
    const now = Date.now();

    const timestamps = this.store.get(userId) || [];
    const windowStart = now - this.windowMs;
    const recentTimestamps = timestamps.filter((t) => t > windowStart);

    if (recentTimestamps.length >= this.maxRequests) {
      const retryAfter = Math.ceil(
        (recentTimestamps[0] + this.windowMs - now) / 1000,
      );

      this.logger.warn(`Rate limit exceeded for user ${userId}`);

      const response = context.switchToHttp().getResponse();
      response.setHeader('Retry-After', retryAfter.toString());
      response.setHeader('X-RateLimit-Limit', this.maxRequests.toString());
      response.setHeader('X-RateLimit-Remaining', '0');

      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recentTimestamps.push(now);
    this.store.set(userId, recentTimestamps);

    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', this.maxRequests.toString());
    response.setHeader(
      'X-RateLimit-Remaining',
      (this.maxRequests - recentTimestamps.length).toString(),
    );

    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.store.entries()) {
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, recent);
      }
    }
  }
}
