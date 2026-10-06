import { RequestSizeLoggerInterceptor } from './request-size-logger.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('RequestSizeLoggerInterceptor', () => {
  let interceptor: RequestSizeLoggerInterceptor;

  beforeEach(() => {
    interceptor = new RequestSizeLoggerInterceptor(1); // 1KB threshold for testing
  });

  const createMockContext = (
    method: string,
    url: string,
    contentLength?: string,
  ): ExecutionContext => {
    const headers: Record<string, string> = {};
    if (contentLength) headers['content-length'] = contentLength;
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, url, headers }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should pass through the handler result', async () => {
    const ctx = createMockContext('GET', '/api/test');
    const handler: CallHandler = { handle: () => of({ data: 'ok' }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ data: 'ok' });
  });

  it('should log warning for large request payload', async () => {
    const warnSpy = jest.spyOn(interceptor['logger'], 'warn');
    const ctx = createMockContext('POST', '/api/upload', String(2 * 1024)); // 2KB > 1KB threshold
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Large request'),
    );
  });

  it('should not warn for small request payload', async () => {
    const warnSpy = jest.spyOn(interceptor['logger'], 'warn');
    const ctx = createMockContext('GET', '/api/data', '100'); // 100 bytes
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Large request'),
    );
  });

  it('should log warning for large response payload', async () => {
    const warnSpy = jest.spyOn(interceptor['logger'], 'warn');
    const ctx = createMockContext('GET', '/api/data');
    const largeBody = { data: 'x'.repeat(2 * 1024) }; // > 1KB
    const handler: CallHandler = { handle: () => of(largeBody) };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Large response'),
    );
  });

  it('should log debug info for every request', async () => {
    const debugSpy = jest.spyOn(interceptor['logger'], 'debug');
    const ctx = createMockContext('GET', '/api/small', '10');
    const handler: CallHandler = { handle: () => of({ tiny: true }) };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/small'),
    );
  });

  it('should handle null response body', async () => {
    const ctx = createMockContext('GET', '/api/empty');
    const handler: CallHandler = { handle: () => of(null) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBeNull();
  });

  it('should handle missing content-length header', async () => {
    const ctx = createMockContext('GET', '/api/no-length');
    const handler: CallHandler = { handle: () => of('ok') };

    // Should not throw
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBe('ok');
  });

  it('should use configurable threshold', async () => {
    const largeThreshold = new RequestSizeLoggerInterceptor(1024); // 1MB
    const warnSpy = jest.spyOn(largeThreshold['logger'], 'warn');
    const ctx = createMockContext('POST', '/api/data', String(100 * 1024)); // 100KB
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(largeThreshold.intercept(ctx, handler));

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Large request'),
    );
  });
});
