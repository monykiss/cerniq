import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { ResponseHistogramInterceptor } from './response-histogram.interceptor';

describe('ResponseHistogramInterceptor (metrics)', () => {
  let interceptor: ResponseHistogramInterceptor;

  function createMockContext(
    method = 'GET',
    url = '/api/test',
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, originalUrl: url }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    interceptor = new ResponseHistogramInterceptor();
  });

  it('records response time samples', async () => {
    const context = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, handler));

    const stats = interceptor.getStats();
    expect(stats.count).toBe(1);
    expect(stats.p50).toBeGreaterThanOrEqual(0);
  });

  it('getStats returns zeros when no samples recorded', () => {
    const stats = interceptor.getStats();
    expect(stats).toEqual({ p50: 0, p95: 0, p99: 0, count: 0 });
  });

  it('accumulates multiple samples', async () => {
    const context = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, handler));
    await lastValueFrom(interceptor.intercept(context, handler));
    await lastValueFrom(interceptor.intercept(context, handler));

    const stats = interceptor.getStats();
    expect(stats.count).toBe(3);
  });

  it('calculates percentiles correctly', async () => {
    const context = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    // Record several samples
    for (let i = 0; i < 100; i++) {
      await lastValueFrom(interceptor.intercept(context, handler));
    }

    const stats = interceptor.getStats();
    expect(stats.count).toBe(100);
    expect(stats.p50).toBeLessThanOrEqual(stats.p95);
    expect(stats.p95).toBeLessThanOrEqual(stats.p99);
  });
});
