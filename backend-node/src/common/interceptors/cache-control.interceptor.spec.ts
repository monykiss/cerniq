import { CacheControlInterceptor } from './cache-control.interceptor';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('CacheControlInterceptor', () => {
  let interceptor: CacheControlInterceptor;

  beforeEach(() => {
    interceptor = new CacheControlInterceptor();
  });

  const createMockContext = (
    method: string,
    url: string,
  ): { ctx: ExecutionContext; res: any } => {
    const res = { setHeader: jest.fn() };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method, url }),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('sets no-store for non-GET requests', (done) => {
    const { ctx, res } = createMockContext('POST', '/api/users');
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      done();
    });
  });

  it('sets no-cache for health endpoints', (done) => {
    const { ctx, res } = createMockContext('GET', '/health');
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-store, must-revalidate',
      );
      done();
    });
  });

  it('sets 1 hour cache for docs endpoint', (done) => {
    const { ctx, res } = createMockContext('GET', '/api/v1/docs');
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=3600',
      );
      done();
    });
  });

  it('sets 60s cache for market-data endpoints', (done) => {
    const { ctx, res } = createMockContext('GET', '/api/market-data/quotes');
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=60',
      );
      done();
    });
  });

  it('sets private no-cache for other GET endpoints', (done) => {
    const { ctx, res } = createMockContext('GET', '/api/users/me');
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-cache',
      );
      done();
    });
  });
});
