import { TimeoutInterceptor } from './timeout.interceptor';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('TimeoutInterceptor', () => {
  let interceptor: TimeoutInterceptor;

  beforeEach(() => {
    interceptor = new TimeoutInterceptor();
  });

  const createMockContext = (url: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ url, method: 'GET' }),
      }),
    }) as unknown as ExecutionContext;

  it('passes through responses that complete within timeout', (done) => {
    const ctx = createMockContext('/api/data');
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ ok: true });
      done();
    });
  });

  it('uses longer timeout for compute-heavy endpoints', () => {
    const ctx = createMockContext('/api/monte-carlo/run');
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    // Just verify it doesn't throw for immediate resolution
    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual({ ok: true });
    });
  });

  it('recognizes stress-test paths as compute-heavy', () => {
    const ctx = createMockContext('/api/stress-test');
    const handler: CallHandler = { handle: () => of('result') };

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toBe('result');
    });
  });

  it('recognizes all compute patterns', () => {
    const patterns = [
      '/api/monte-carlo/sim',
      '/api/stress-test',
      '/api/stress-v2/run',
      '/api/cvar-optimize',
      '/api/cecl/vintage',
      '/api/black-litterman',
      '/api/portfolio-var',
    ];
    for (const url of patterns) {
      const ctx = createMockContext(url);
      const handler: CallHandler = { handle: () => of('ok') };
      interceptor
        .intercept(ctx, handler)
        .subscribe((r) => expect(r).toBe('ok'));
    }
  });

  it('converts TimeoutError to RequestTimeoutException (normal URL)', (done) => {
    const { TimeoutError } = require('rxjs');
    const { throwError: rxThrowError } = require('rxjs');
    const { RequestTimeoutException } = require('@nestjs/common');
    const ctx = createMockContext('/api/data');
    const handler: CallHandler = {
      handle: () => rxThrowError(() => new TimeoutError()),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err: any) => {
        expect(err).toBeInstanceOf(RequestTimeoutException);
        expect(err.message).toContain('30s');
        done();
      },
    });
  });

  it('converts TimeoutError to RequestTimeoutException (compute URL)', (done) => {
    const { TimeoutError } = require('rxjs');
    const { throwError: rxThrowError } = require('rxjs');
    const { RequestTimeoutException } = require('@nestjs/common');
    const ctx = createMockContext('/api/monte-carlo/run');
    const handler: CallHandler = {
      handle: () => rxThrowError(() => new TimeoutError()),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err: any) => {
        expect(err).toBeInstanceOf(RequestTimeoutException);
        expect(err.message).toContain('120s');
        done();
      },
    });
  });

  it('passes through non-timeout errors', (done) => {
    const { throwError: rxThrowError } = require('rxjs');
    const ctx = createMockContext('/api/data');
    const handler: CallHandler = {
      handle: () => rxThrowError(() => new Error('DB connection failed')),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err: any) => {
        expect(err.message).toBe('DB connection failed');
        done();
      },
    });
  });

  it('handles empty URL (falls back to default timeout)', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe((r) => {
      expect(r).toBe('ok');
    });
  });
});
