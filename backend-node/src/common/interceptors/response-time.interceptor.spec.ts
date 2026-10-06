import { ResponseTimeInterceptor } from './response-time.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('ResponseTimeInterceptor', () => {
  let interceptor: ResponseTimeInterceptor;

  beforeEach(() => {
    interceptor = new ResponseTimeInterceptor();
  });

  const createMockContext = (): { ctx: ExecutionContext; res: any } => {
    const res = { setHeader: jest.fn() };
    const ctx = {
      switchToHttp: () => ({
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('should set X-Response-Time header', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of({ data: 'test' }) };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Response-Time',
      expect.stringMatching(/^\d+\.\d{2}ms$/),
    );
  });

  it('should pass through the handler result', async () => {
    const { ctx } = createMockContext();
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ ok: true });
  });

  it('should record a small duration for fast operations', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of('fast') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const call = res.setHeader.mock.calls.find(
      (c: any[]) => c[0] === 'X-Response-Time',
    );
    expect(call).toBeDefined();
    const timeValue = parseFloat(call[1].replace('ms', ''));
    expect(timeValue).toBeGreaterThanOrEqual(0);
    expect(timeValue).toBeLessThan(1000); // Should be fast
  });

  it('should handle null response body', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of(null) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBeNull();
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Response-Time',
      expect.any(String),
    );
  });

  it('should use high-resolution timing', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    const call = res.setHeader.mock.calls.find(
      (c: any[]) => c[0] === 'X-Response-Time',
    );
    // Should have decimal places from hrtime
    expect(call[1]).toMatch(/\.\d{2}ms$/);
  });
});
