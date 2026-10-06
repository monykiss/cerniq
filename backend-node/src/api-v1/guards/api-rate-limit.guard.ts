import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import type { ApiKeyUser } from './api-key-auth.guard';
import { CacheService } from '../../cache/cache.service';

/**
 * Per-API-key rate limiter backed by Redis.
 * Standard tier: 100 requests / hour
 * Partner tier:  1,000 requests / hour
 *
 * Uses Redis INCR + EXPIRE for atomic sliding-window counting.
 * Falls back to in-memory if Redis is unavailable.
 */

const WINDOW_SEC = 3600; // 1 hour
const STANDARD_LIMIT = 100;
const PARTNER_LIMIT = 1000;

interface MemoryBucket {
  count: number;
  windowStart: number;
}

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  // In-memory fallback when Redis is unavailable
  private memoryBuckets = new Map<string, MemoryBucket>();

  constructor(
    @Optional() @Inject(CacheService) private readonly cache?: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiUser: ApiKeyUser | undefined = request.apiUser;

    if (!apiUser) return true;

    const limit = apiUser.tier === 'partner' ? PARTNER_LIMIT : STANDARD_LIMIT;
    const key = `rate:api:${apiUser.apiKeyId}`;

    let count: number;
    let ttlRemaining: number;

    try {
      // Try Redis first
      const result = await this.incrementRedis(key, WINDOW_SEC);
      if (result) {
        count = result.count;
        ttlRemaining = result.ttl;
      } else {
        // Fallback to in-memory
        const mem = this.incrementMemory(apiUser.apiKeyId);
        count = mem.count;
        ttlRemaining = mem.ttl;
      }
    } catch {
      // Redis error — use in-memory fallback
      const mem = this.incrementMemory(apiUser.apiKeyId);
      count = mem.count;
      ttlRemaining = mem.ttl;
    }

    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, limit - count)),
    );
    response.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil(Date.now() / 1000) + ttlRemaining),
    );

    if (count > limit) {
      response.setHeader('Retry-After', String(ttlRemaining));

      throw new HttpException(
        {
          success: false,
          error: 'Rate limit exceeded',
          message: `API key rate limit of ${limit} requests/hour exceeded. Upgrade to Partner tier for higher limits.`,
          retryAfterSeconds: ttlRemaining,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private async incrementRedis(
    key: string,
    windowSec: number,
  ): Promise<{ count: number; ttl: number } | null> {
    if (!this.cache) return null;
    const redis = (this.cache as any).redis;
    if (!redis) return null;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    const ttl = await redis.ttl(key);
    return { count, ttl: ttl > 0 ? ttl : windowSec };
  }

  private incrementMemory(apiKeyId: string): { count: number; ttl: number } {
    const now = Date.now();
    const windowMs = WINDOW_SEC * 1000;
    let bucket = this.memoryBuckets.get(apiKeyId);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      this.memoryBuckets.set(apiKeyId, bucket);
    }

    bucket.count++;
    const ttl = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
    return { count: bucket.count, ttl };
  }
}
