import {
  PerformanceInterceptor,
  getRouteMetrics,
} from './performance.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('PerformanceInterceptor', () => {
  let interceptor: PerformanceInterceptor;

  beforeEach(() => {
    interceptor = new PerformanceInterceptor();
  });

  const createMockContext = (
    method: string,
    url: string,
    routePath?: string,
  ): { ctx: ExecutionContext; res: any } => {
    const res = { setHeader: jest.fn() };
    const req: any = { method, url };
    if (routePath) req.route = { path: routePath };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('should set X-Response-Time header', async () => {
    const { ctx, res } = createMockContext('GET', '/api/test');
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Response-Time',
      expect.stringMatching(/\d+ms/),
    );
  });

  it('should record route metrics', async () => {
    const { ctx } = createMockContext(
      'GET',
      '/api/perf-test',
      '/api/perf-test',
    );
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const metrics = getRouteMetrics();
    const routeMetric = metrics.find((m) => m.route === 'GET /api/perf-test');
    expect(routeMetric).toBeDefined();
    expect(routeMetric!.count).toBeGreaterThanOrEqual(1);
  });

  it('should use route path when available', async () => {
    const { ctx } = createMockContext(
      'POST',
      '/api/users/123',
      '/api/users/:id',
    );
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const metrics = getRouteMetrics();
    const routeMetric = metrics.find((m) => m.route === 'POST /api/users/:id');
    expect(routeMetric).toBeDefined();
  });

  it('should fall back to URL when no route path', async () => {
    const { ctx } = createMockContext('GET', '/api/fallback-url');
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const metrics = getRouteMetrics();
    const routeMetric = metrics.find(
      (m) => m.route === 'GET /api/fallback-url',
    );
    expect(routeMetric).toBeDefined();
  });

  it('should accumulate metrics across multiple requests', async () => {
    const routePath = '/api/accumulate-test';
    for (let i = 0; i < 5; i++) {
      const { ctx } = createMockContext('GET', routePath, routePath);
      const handler: CallHandler = { handle: () => of('ok') };
      await lastValueFrom(interceptor.intercept(ctx, handler));
    }

    const metrics = getRouteMetrics();
    const routeMetric = metrics.find((m) => m.route === `GET ${routePath}`);
    expect(routeMetric).toBeDefined();
    expect(routeMetric!.count).toBeGreaterThanOrEqual(5);
  });

  it('should shift latencies when ring buffer is full (>100 samples)', async () => {
    const routePath = '/api/ring-buffer-test';
    for (let i = 0; i < 105; i++) {
      const { ctx } = createMockContext('GET', routePath, routePath);
      const handler: CallHandler = { handle: () => of('ok') };
      await lastValueFrom(interceptor.intercept(ctx, handler));
    }
    const metrics = getRouteMetrics();
    const routeMetric = metrics.find((m) => m.route === `GET ${routePath}`);
    expect(routeMetric).toBeDefined();
    expect(routeMetric!.count).toBe(105);
  });

  it('getRouteMetrics should return percentile data', () => {
    const metrics = getRouteMetrics();
    if (metrics.length > 0) {
      const m = metrics[0];
      expect(m).toHaveProperty('route');
      expect(m).toHaveProperty('count');
      expect(m).toHaveProperty('avgMs');
      expect(m).toHaveProperty('p50Ms');
      expect(m).toHaveProperty('p95Ms');
      expect(m).toHaveProperty('p99Ms');
      expect(m).toHaveProperty('maxMs');
    }
  });
});
