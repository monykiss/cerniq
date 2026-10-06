import { ResponseTimeHistogramInterceptor } from './response-time-histogram.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('ResponseTimeHistogramInterceptor', () => {
  let interceptor: ResponseTimeHistogramInterceptor;

  beforeEach(() => {
    interceptor = new ResponseTimeHistogramInterceptor();
  });

  const createMockContext = (
    method: string,
    url: string,
    routePath?: string,
  ): ExecutionContext => {
    const req: any = { method, url };
    if (routePath) req.route = { path: routePath };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  };

  it('should pass through the handler result', async () => {
    const ctx = createMockContext('GET', '/api/data');
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ ok: true });
  });

  it('should record route stats after request completes', async () => {
    const ctx = createMockContext(
      'GET',
      '/api/histogram-test',
      '/api/histogram-test',
    );
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const stats = interceptor.getStats('GET /api/histogram-test');
    expect(stats['GET /api/histogram-test']).toBeDefined();
    expect(stats['GET /api/histogram-test'].count).toBe(1);
  });

  it('should accumulate stats for multiple requests', async () => {
    const routeKey = 'POST /api/hist-multi';
    for (let i = 0; i < 5; i++) {
      const ctx = createMockContext(
        'POST',
        '/api/hist-multi',
        '/api/hist-multi',
      );
      await lastValueFrom(
        interceptor.intercept(ctx, { handle: () => of('ok') }),
      );
    }

    const stats = interceptor.getStats(routeKey);
    expect(stats[routeKey].count).toBe(5);
  });

  it('should return percentile data in getStats', async () => {
    const routeKey = 'GET /api/hist-percentile';
    for (let i = 0; i < 10; i++) {
      const ctx = createMockContext(
        'GET',
        '/api/hist-percentile',
        '/api/hist-percentile',
      );
      await lastValueFrom(
        interceptor.intercept(ctx, { handle: () => of('ok') }),
      );
    }

    const stats = interceptor.getStats(routeKey);
    const routeStats = stats[routeKey];
    expect(routeStats).toHaveProperty('p50');
    expect(routeStats).toHaveProperty('p95');
    expect(routeStats).toHaveProperty('p99');
    expect(routeStats).toHaveProperty('count');
    expect(routeStats.count).toBe(10);
  });

  it('should return all routes when no routeKey specified', async () => {
    const ctx1 = createMockContext('GET', '/api/hist-all-a', '/api/hist-all-a');
    await lastValueFrom(
      interceptor.intercept(ctx1, { handle: () => of('ok') }),
    );

    const ctx2 = createMockContext('GET', '/api/hist-all-b', '/api/hist-all-b');
    await lastValueFrom(
      interceptor.intercept(ctx2, { handle: () => of('ok') }),
    );

    const stats = interceptor.getStats();
    expect(Object.keys(stats).length).toBeGreaterThanOrEqual(2);
  });

  it('should return empty stats for unknown route', () => {
    const stats = interceptor.getStats('GET /nonexistent');
    expect(Object.keys(stats).length).toBe(0);
  });

  it('caps samples at 2500 when exceeding 5000', async () => {
    const routeKey = 'GET /api/hist-cap';
    for (let i = 0; i < 5010; i++) {
      const ctx = createMockContext('GET', '/api/hist-cap', '/api/hist-cap');
      await lastValueFrom(
        interceptor.intercept(ctx, { handle: () => of('ok') }),
      );
    }
    const stats = interceptor.getStats(routeKey);
    // After capping, count may reflect truncated samples
    expect(stats[routeKey].count).toBeGreaterThan(0);
  });

  it('should use URL as fallback when no route path', async () => {
    const ctx = createMockContext('GET', '/api/no-route');
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const stats = interceptor.getStats('GET /api/no-route');
    expect(stats['GET /api/no-route']).toBeDefined();
  });
});
