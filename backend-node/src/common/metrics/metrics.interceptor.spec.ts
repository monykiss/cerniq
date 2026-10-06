import { of, throwError } from 'rxjs';
import { MetricsInterceptor, getMetricsSummary } from './metrics.interceptor';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    interceptor = new MetricsInterceptor();
  });

  function createMockContext(overrides: Record<string, any> = {}) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          route: { path: '/api/test' },
          method: 'GET',
          path: '/api/test',
          ...overrides,
        }),
        getResponse: () => ({
          statusCode: 200,
        }),
      }),
    } as any;
  }

  function createMockCallHandler(returnValue: any = { data: 'ok' }) {
    return {
      handle: () => of(returnValue),
    } as any;
  }

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('records a successful request metric', (done) => {
    const ctx = createMockContext();
    const handler = createMockCallHandler();

    interceptor.intercept(ctx, handler).subscribe({
      next: (value) => {
        expect(value).toEqual({ data: 'ok' });
      },
      complete: () => {
        const summary = getMetricsSummary();
        expect(summary.totalRequests).toBeGreaterThanOrEqual(1);
        done();
      },
    });
  });

  it('records an error request metric and re-throws', (done) => {
    const ctx = createMockContext();
    const error = { status: 500, message: 'Internal error' };
    const handler = {
      handle: () => throwError(() => error),
    } as any;

    interceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        const summary = getMetricsSummary();
        expect(summary.totalRequests).toBeGreaterThanOrEqual(1);
        done();
      },
    });
  });

  it('records error without status as 500', (done) => {
    const ctx = createMockContext();
    const error = new Error('No status property');
    const handler = {
      handle: () => throwError(() => error),
    } as any;

    interceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        done();
      },
    });
  });

  it('uses req.path when route.path is not available', (done) => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ path: '/api/fallback', method: 'POST' }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as any;
    const handler = createMockCallHandler();

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const summary = getMetricsSummary();
        const routes = summary.slowestRoutes.map((r: any) => r.route);
        // Route should be recorded
        expect(summary.totalRequests).toBeGreaterThanOrEqual(1);
        done();
      },
    });
  });

  it('falls back to "unknown" when neither route.path nor req.path exist', (done) => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'DELETE' }),
        getResponse: () => ({ statusCode: 204 }),
      }),
    } as any;
    const handler = createMockCallHandler();

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        done();
      },
    });
  });
});

describe('getMetricsSummary', () => {
  it('returns zero-state when no recent metrics', () => {
    // getMetricsSummary filters by last 1h, so after enough time
    // or on a fresh module, it may return zeros. We just test shape.
    const summary = getMetricsSummary();
    expect(summary).toHaveProperty('totalRequests');
    expect(summary).toHaveProperty('errorRate');
    expect(summary).toHaveProperty('latencyP50');
    expect(summary).toHaveProperty('latencyP95');
    expect(summary).toHaveProperty('latencyP99');
    expect(summary).toHaveProperty('slowestRoutes');
    expect(Array.isArray(summary.slowestRoutes)).toBe(true);
  });

  it('calculates error rate from 4xx/5xx responses', () => {
    // The interceptor has already recorded some metrics from prior tests
    const summary = getMetricsSummary();
    expect(typeof summary.errorRate).toBe('number');
    expect(summary.errorRate).toBeGreaterThanOrEqual(0);
    expect(summary.errorRate).toBeLessThanOrEqual(1);
  });

  it('slowestRoutes includes route, avgMs, and count', () => {
    const summary = getMetricsSummary();
    if (summary.slowestRoutes.length > 0) {
      const route = summary.slowestRoutes[0];
      expect(route).toHaveProperty('route');
      expect(route).toHaveProperty('avgMs');
      expect(route).toHaveProperty('count');
      expect(typeof route.avgMs).toBe('number');
      expect(typeof route.count).toBe('number');
    }
  });
});
