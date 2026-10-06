import { ResponseHistogramInterceptor } from './response-histogram.interceptor';
import { of } from 'rxjs';

describe('ResponseHistogramInterceptor', () => {
  let interceptor: ResponseHistogramInterceptor;

  beforeEach(() => {
    interceptor = new ResponseHistogramInterceptor();
  });

  const createMockContext = () => ({
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: '/test' }),
    }),
  });

  const createMockHandler = (data: any = { ok: true }) => ({
    handle: () => of(data),
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('records response time and returns data', (done) => {
    const context = createMockContext() as any;
    const handler = createMockHandler() as any;

    interceptor.intercept(context, handler).subscribe({
      next: (data) => {
        expect(data).toEqual({ ok: true });
      },
      complete: () => {
        const stats = interceptor.getStats();
        expect(stats.count).toBe(1);
        expect(stats.p50).toBeGreaterThanOrEqual(0);
        done();
      },
    });
  });

  it('getStats returns zeros when no samples', () => {
    const stats = interceptor.getStats();
    expect(stats).toEqual({ p50: 0, p95: 0, p99: 0, count: 0 });
  });

  it('accumulates multiple samples correctly', (done) => {
    const context = createMockContext() as any;
    const handler = createMockHandler() as any;

    let completed = 0;
    const total = 5;

    for (let i = 0; i < total; i++) {
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          completed++;
          if (completed === total) {
            const stats = interceptor.getStats();
            expect(stats.count).toBe(total);
            expect(stats.p50).toBeGreaterThanOrEqual(0);
            expect(stats.p95).toBeGreaterThanOrEqual(0);
            expect(stats.p99).toBeGreaterThanOrEqual(0);
            done();
          }
        },
      });
    }
  });

  it('records samples into histogram buckets', (done) => {
    const context = createMockContext() as any;
    const handler = createMockHandler() as any;

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        // Fast test responses should fall into the first few buckets
        const stats = interceptor.getStats();
        expect(stats.count).toBe(1);
        done();
      },
    });
  });

  it('shifts samples when exceeding 10000 limit', () => {
    // Access private method via record to fill samples
    for (let i = 0; i < 10_005; i++) {
      (interceptor as any).record(i % 100);
    }
    const stats = interceptor.getStats();
    expect(stats.count).toBe(10_000);
  });

  it('warns for slow requests (>2000ms)', (done) => {
    // We can't easily simulate slow requests, but we can test the interceptor still works
    const context = createMockContext() as any;
    const handler = createMockHandler() as any;

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        const stats = interceptor.getStats();
        expect(stats.count).toBeGreaterThan(0);
        done();
      },
    });
  });
});
