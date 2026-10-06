import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiRateLimitGuard } from './api-rate-limit.guard';

function createMockContext(apiUser?: any) {
  const responseHeaders: Record<string, string> = {};
  const request: any = { apiUser };
  const response: any = {
    setHeader: jest.fn((key: string, value: string) => {
      responseHeaders[key] = value;
    }),
  };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any,
    request,
    response,
    responseHeaders,
  };
}

describe('ApiRateLimitGuard', () => {
  let guard: ApiRateLimitGuard;

  beforeEach(() => {
    guard = new ApiRateLimitGuard(undefined);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('allows request when no apiUser is present (non-API key auth)', async () => {
    const { context } = createMockContext(undefined);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('allows first request for standard tier user', async () => {
    const apiUser = { apiKeyId: 'key-1', tier: 'standard' };
    const { context, response } = createMockContext(apiUser);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      '99',
    );
  });

  it('allows first request for partner tier user with higher limit', async () => {
    const apiUser = { apiKeyId: 'key-2', tier: 'partner' };
    const { context, response } = createMockContext(apiUser);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Limit',
      '1000',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      '999',
    );
  });

  it('tracks request count across multiple calls (in-memory fallback)', async () => {
    const apiUser = { apiKeyId: 'key-3', tier: 'standard' };

    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      const { context } = createMockContext(apiUser);
      await guard.canActivate(context);
    }

    // 6th request should still be allowed (under 100 limit)
    const { context, response } = createMockContext(apiUser);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      '94',
    );
  });

  it('throws 429 when standard tier exceeds 100 requests', async () => {
    const apiUser = { apiKeyId: 'key-exceed', tier: 'standard' };

    // Simulate 101 requests
    for (let i = 0; i < 101; i++) {
      const { context } = createMockContext(apiUser);
      try {
        await guard.canActivate(context);
      } catch {
        // Expected on request 101
      }
    }

    // The 102nd request should throw
    const { context, response } = createMockContext(apiUser);
    try {
      await guard.canActivate(context);
      fail('Should have thrown HttpException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = err.getResponse();
      expect(body.error).toBe('Rate limit exceeded');
      expect(body.message).toContain('100 requests/hour');
    }
    expect(response.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
  });

  it('sets rate limit headers on every response', async () => {
    const apiUser = { apiKeyId: 'key-headers', tier: 'standard' };
    const { context, response } = createMockContext(apiUser);
    await guard.canActivate(context);

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Limit',
      expect.any(String),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      expect.any(String),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(String),
    );
  });

  it('resets count after window expires', async () => {
    const apiUser = { apiKeyId: 'key-reset', tier: 'standard' };

    // Make a request to create the bucket
    const { context } = createMockContext(apiUser);
    await guard.canActivate(context);

    // Manually expire the bucket by modifying windowStart
    const memoryBuckets = (guard as any).memoryBuckets;
    const bucket = memoryBuckets.get('key-reset');
    if (bucket) {
      bucket.windowStart = Date.now() - 3601 * 1000; // 1 hour + 1 second ago
    }

    // Next request should reset the counter
    const { context: ctx2, response } = createMockContext(apiUser);
    await guard.canActivate(ctx2);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      '99',
    );
  });

  it('different API keys have independent counters', async () => {
    const user1 = { apiKeyId: 'key-a', tier: 'standard' };
    const user2 = { apiKeyId: 'key-b', tier: 'standard' };

    // 3 requests for user1
    for (let i = 0; i < 3; i++) {
      const { context } = createMockContext(user1);
      await guard.canActivate(context);
    }

    // user2's first request should show full remaining
    const { context, response } = createMockContext(user2);
    await guard.canActivate(context);
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      '99',
    );
  });

  // ── With Redis (CacheService mock) ─────────────────────────
  describe('with Redis CacheService', () => {
    let guardWithRedis: ApiRateLimitGuard;
    let mockRedis: any;

    beforeEach(() => {
      mockRedis = {
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        ttl: jest.fn().mockResolvedValue(3600),
      };
      const mockCache = { redis: mockRedis } as any;
      guardWithRedis = new ApiRateLimitGuard(mockCache);
    });

    it('uses Redis for counting when available', async () => {
      const apiUser = { apiKeyId: 'key-redis', tier: 'standard' };
      const { context } = createMockContext(apiUser);
      await guardWithRedis.canActivate(context);
      expect(mockRedis.incr).toHaveBeenCalledWith('rate:api:key-redis');
    });

    it('sets expire on first request (count === 1)', async () => {
      mockRedis.incr.mockResolvedValue(1);
      const apiUser = { apiKeyId: 'key-redis-exp', tier: 'standard' };
      const { context } = createMockContext(apiUser);
      await guardWithRedis.canActivate(context);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'rate:api:key-redis-exp',
        3600,
      );
    });

    it('does not set expire on subsequent requests (count > 1)', async () => {
      mockRedis.incr.mockResolvedValue(5);
      const apiUser = { apiKeyId: 'key-redis-sub', tier: 'standard' };
      const { context } = createMockContext(apiUser);
      await guardWithRedis.canActivate(context);
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('falls back to in-memory when Redis throws', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis down'));
      const apiUser = { apiKeyId: 'key-fallback', tier: 'standard' };
      const { context, response } = createMockContext(apiUser);
      const result = await guardWithRedis.canActivate(context);
      expect(result).toBe(true);
      // Should still set headers from in-memory fallback
      expect(response.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Limit',
        '100',
      );
    });

    it('returns correct remaining count from Redis', async () => {
      mockRedis.incr.mockResolvedValue(50);
      const apiUser = { apiKeyId: 'key-redis-rem', tier: 'standard' };
      const { context, response } = createMockContext(apiUser);
      await guardWithRedis.canActivate(context);
      expect(response.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Remaining',
        '50',
      );
    });
  });

  // ── No CacheService (null injection) ───────────────────────
  it('works without CacheService using in-memory only', async () => {
    const guardNoCache = new ApiRateLimitGuard(undefined);
    const apiUser = { apiKeyId: 'key-nocache', tier: 'standard' };
    const { context } = createMockContext(apiUser);
    const result = await guardNoCache.canActivate(context);
    expect(result).toBe(true);
  });
});
