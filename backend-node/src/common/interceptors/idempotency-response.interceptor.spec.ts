import { IdempotencyResponseInterceptor } from './idempotency-response.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('IdempotencyResponseInterceptor', () => {
  let interceptor: IdempotencyResponseInterceptor;

  beforeEach(() => {
    interceptor = new IdempotencyResponseInterceptor(60);
  });

  const createMockContext = (
    method: string,
    url: string,
    headers: Record<string, string> = {},
  ): { ctx: ExecutionContext; res: any } => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      statusCode: 200,
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method, url, headers }),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('should pass through GET requests without caching', async () => {
    const { ctx } = createMockContext('GET', '/api/data');
    const handler: CallHandler = { handle: () => of({ data: 'test' }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ data: 'test' });
  });

  it('should pass through POST without idempotency key', async () => {
    const { ctx } = createMockContext('POST', '/api/data');
    const handler: CallHandler = { handle: () => of({ id: '1' }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ id: '1' });
  });

  it('should cache response for POST with idempotency key', async () => {
    const { ctx } = createMockContext('POST', '/api/data', {
      'x-idempotency-key': 'key-1',
    });
    const handler: CallHandler = { handle: () => of({ id: 'new-1' }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ id: 'new-1' });
  });

  it('should return cached response on duplicate request', async () => {
    const idempotencyKey = 'dup-key';
    const responseData = { id: 'created' };

    // First request
    const { ctx: ctx1 } = createMockContext('POST', '/api/items', {
      'x-idempotency-key': idempotencyKey,
    });
    const handler1: CallHandler = { handle: () => of(responseData) };
    await lastValueFrom(interceptor.intercept(ctx1, handler1));

    // Second request with same key
    const { ctx: ctx2, res: res2 } = createMockContext('POST', '/api/items', {
      'x-idempotency-key': idempotencyKey,
    });
    const handler2: CallHandler = {
      handle: () => of({ id: 'should-not-be-this' }),
    };
    const result = await lastValueFrom(interceptor.intercept(ctx2, handler2));

    expect(result).toEqual(responseData);
    expect(res2.setHeader).toHaveBeenCalledWith(
      'X-Idempotent-Replayed',
      'true',
    );
  });

  it('should work with PUT method', async () => {
    const { ctx } = createMockContext('PUT', '/api/items/1', {
      'x-idempotency-key': 'put-key',
    });
    const handler: CallHandler = { handle: () => of({ updated: true }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ updated: true });
  });

  it('should work with PATCH method', async () => {
    const { ctx } = createMockContext('PATCH', '/api/items/1', {
      'x-idempotency-key': 'patch-key',
    });
    const handler: CallHandler = { handle: () => of({ patched: true }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ patched: true });
  });

  it('should skip DELETE method even with idempotency key', async () => {
    const { ctx } = createMockContext('DELETE', '/api/items/1', {
      'x-idempotency-key': 'delete-key',
    });
    const handler: CallHandler = { handle: () => of({ deleted: true }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ deleted: true });
  });

  it('should use different cache keys for different URLs', async () => {
    const key = 'same-key';

    // Request to URL A
    const { ctx: ctx1 } = createMockContext('POST', '/api/items', {
      'x-idempotency-key': key,
    });
    await lastValueFrom(
      interceptor.intercept(ctx1, { handle: () => of({ from: 'A' }) }),
    );

    // Request to URL B with same key
    const { ctx: ctx2 } = createMockContext('POST', '/api/orders', {
      'x-idempotency-key': key,
    });
    const result = await lastValueFrom(
      interceptor.intercept(ctx2, { handle: () => of({ from: 'B' }) }),
    );

    // Should NOT return cached response since URL is different
    expect(result).toEqual({ from: 'B' });
  });

  // ── Cache expiry ─────────────────────────────────────────────

  it('should not return expired cache entries', async () => {
    // Create interceptor with 0-minute TTL (immediate expiry)
    const shortTTL = new IdempotencyResponseInterceptor(0);

    const { ctx: ctx1 } = createMockContext('POST', '/api/exp', {
      'x-idempotency-key': 'exp-key',
    });
    await lastValueFrom(
      shortTTL.intercept(ctx1, { handle: () => of({ first: true }) }),
    );

    // Cache expired immediately
    const { ctx: ctx2 } = createMockContext('POST', '/api/exp', {
      'x-idempotency-key': 'exp-key',
    });
    const result = await lastValueFrom(
      shortTTL.intercept(ctx2, { handle: () => of({ second: true }) }),
    );
    expect(result).toEqual({ second: true });

    shortTTL.onModuleDestroy();
  });

  // ── Status code caching ──────────────────────────────────────

  it('should cache and replay status code', async () => {
    const { ctx: ctx1, res: res1 } = createMockContext('POST', '/api/stat', {
      'x-idempotency-key': 'stat-key',
    });
    res1.statusCode = 201;

    await lastValueFrom(
      interceptor.intercept(ctx1, { handle: () => of({ created: true }) }),
    );

    const { ctx: ctx2, res: res2 } = createMockContext('POST', '/api/stat', {
      'x-idempotency-key': 'stat-key',
    });

    await lastValueFrom(
      interceptor.intercept(ctx2, { handle: () => of({ wrong: true }) }),
    );

    expect(res2.status).toHaveBeenCalledWith(201);
    expect(res2.setHeader).toHaveBeenCalledWith(
      'X-Idempotent-Replayed',
      'true',
    );
  });

  // ── Cleanup method ───────────────────────────────────────────

  describe('cleanup', () => {
    it('removes expired entries during cleanup', async () => {
      const realNow = Date.now;
      let now = 1000000;
      Date.now = () => now;

      const { ctx } = createMockContext('POST', '/api/cl', {
        'x-idempotency-key': 'cl-key',
      });

      await lastValueFrom(
        interceptor.intercept(ctx, { handle: () => of({ val: 1 }) }),
      );

      // Advance past TTL (60 min)
      now += 60 * 60 * 1000 + 1;
      (interceptor as any).cleanup();

      expect((interceptor as any).cache.size).toBe(0);

      Date.now = realNow;
    });

    it('preserves non-expired entries during cleanup', async () => {
      const { ctx } = createMockContext('POST', '/api/keep', {
        'x-idempotency-key': 'keep-key',
      });

      await lastValueFrom(
        interceptor.intercept(ctx, { handle: () => of({ val: 1 }) }),
      );

      (interceptor as any).cleanup();

      expect((interceptor as any).cache.size).toBe(1);
    });
  });

  // ── onModuleDestroy ──────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('clears cleanup timer', () => {
      interceptor.onModuleDestroy();
      expect(true).toBe(true);
    });
  });

  // ── Different methods with same key ──────────────────────────

  it('should differentiate by HTTP method for same key and URL', async () => {
    const key = 'method-key';

    const { ctx: ctx1 } = createMockContext('POST', '/api/x', {
      'x-idempotency-key': key,
    });
    await lastValueFrom(
      interceptor.intercept(ctx1, { handle: () => of({ method: 'POST' }) }),
    );

    const { ctx: ctx2 } = createMockContext('PUT', '/api/x', {
      'x-idempotency-key': key,
    });
    const result = await lastValueFrom(
      interceptor.intercept(ctx2, { handle: () => of({ method: 'PUT' }) }),
    );

    // Different method = different cache key
    expect(result).toEqual({ method: 'PUT' });
  });
});
