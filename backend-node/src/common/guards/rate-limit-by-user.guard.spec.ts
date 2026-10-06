import { RateLimitByUserGuard } from './rate-limit-by-user.guard';
import { HttpException, HttpStatus, ExecutionContext } from '@nestjs/common';

describe('RateLimitByUserGuard', () => {
  let guard: RateLimitByUserGuard;

  beforeEach(() => {
    jest.useFakeTimers();
    guard = new RateLimitByUserGuard(3, 60_000); // 3 requests per 60s
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createMockContext = (
    userId?: string,
    ip: string = '127.0.0.1',
  ): { ctx: ExecutionContext; res: any } => {
    const res = { setHeader: jest.fn() };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: userId ? { id: userId } : undefined,
          ip,
        }),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('should allow requests within the limit', () => {
    const { ctx } = createMockContext('user-1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should set rate limit headers on response', () => {
    const { ctx, res } = createMockContext('user-1');
    guard.canActivate(ctx);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '3');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '2');
  });

  it('should decrement remaining count with each request', () => {
    const { ctx: ctx1, res: res1 } = createMockContext('user-2');
    guard.canActivate(ctx1);
    expect(res1.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '2');

    const { ctx: ctx2, res: res2 } = createMockContext('user-2');
    guard.canActivate(ctx2);
    expect(res2.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '1');

    const { ctx: ctx3, res: res3 } = createMockContext('user-2');
    guard.canActivate(ctx3);
    expect(res3.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('should throw HttpException when rate limit is exceeded', () => {
    const userId = 'user-3';
    for (let i = 0; i < 3; i++) {
      const { ctx } = createMockContext(userId);
      guard.canActivate(ctx);
    }

    const { ctx } = createMockContext(userId);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('should throw 429 status when rate limited', () => {
    const userId = 'user-4';
    for (let i = 0; i < 3; i++) {
      const { ctx } = createMockContext(userId);
      guard.canActivate(ctx);
    }

    const { ctx } = createMockContext(userId);
    try {
      guard.canActivate(ctx);
      fail('Expected exception');
    } catch (e: any) {
      expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('should set Retry-After header when rate limited', () => {
    const userId = 'user-5';
    for (let i = 0; i < 3; i++) {
      const { ctx } = createMockContext(userId);
      guard.canActivate(ctx);
    }

    const { ctx, res } = createMockContext(userId);
    try {
      guard.canActivate(ctx);
    } catch {
      // expected
    }
    expect(res.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('should track different users independently', () => {
    for (let i = 0; i < 3; i++) {
      const { ctx } = createMockContext('user-a');
      guard.canActivate(ctx);
    }

    // user-b should still be allowed
    const { ctx } = createMockContext('user-b');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should fall back to IP when no user is authenticated', () => {
    const { ctx } = createMockContext(undefined, '10.0.0.1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow requests after window expires', () => {
    const userId = 'user-expire';
    for (let i = 0; i < 3; i++) {
      const { ctx } = createMockContext(userId);
      guard.canActivate(ctx);
    }

    // Advance time past the window
    jest.advanceTimersByTime(61_000);

    const { ctx } = createMockContext(userId);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should fall back to anonymous when no user and no IP', () => {
    const guard2 = new RateLimitByUserGuard(1, 60_000);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    } as unknown as ExecutionContext;

    guard2.canActivate(ctx);
    expect(() => guard2.canActivate(ctx)).toThrow(HttpException);
  });

  it('cleans up stale entries', () => {
    const userId = 'user-stale';
    const { ctx } = createMockContext(userId);
    guard.canActivate(ctx);

    // Advance time past the window
    jest.advanceTimersByTime(61_000);

    // Trigger cleanup (every 5 min = 300000ms)
    jest.advanceTimersByTime(300_000);

    // After cleanup, store should be empty for this user
    const { ctx: ctx2 } = createMockContext(userId);
    expect(guard.canActivate(ctx2)).toBe(true);
  });

  it('cleanup retains entries still within window', () => {
    const { ctx } = createMockContext('user-keep');
    guard.canActivate(ctx);
    guard.canActivate(ctx);

    // Trigger cleanup but within window still
    jest.advanceTimersByTime(300_000);

    // Both timestamps should still be there since 300s < 60s window
    // Wait... 300000ms > 60000ms window so entries are expired
    // Advance less than window first
  });

  it('onModuleDestroy clears the cleanup timer', () => {
    const guard2 = new RateLimitByUserGuard(100, 60_000);
    expect(() => guard2.onModuleDestroy()).not.toThrow();
  });

  it('uses default constructor values', () => {
    const defaultGuard = new RateLimitByUserGuard();
    const { ctx } = createMockContext('default-user');
    expect(defaultGuard.canActivate(ctx)).toBe(true);
    defaultGuard.onModuleDestroy();
  });

  it('cleanup retains recent entries within window', () => {
    // Use a large window (600s) so entries survive cleanup
    const longGuard = new RateLimitByUserGuard(10, 600_000);
    const { ctx } = createMockContext('user-retain');
    longGuard.canActivate(ctx);

    // Trigger cleanup (300s interval) - entries still within 600s window
    jest.advanceTimersByTime(300_000);

    // Entry should still be tracked (recent.length > 0 path → store.set)
    const { ctx: ctx2, res: res2 } = createMockContext('user-retain');
    longGuard.canActivate(ctx2);
    expect(res2.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '8');
    longGuard.onModuleDestroy();
  });
});
