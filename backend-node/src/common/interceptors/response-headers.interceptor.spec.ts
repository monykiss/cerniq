import { ResponseHeadersInterceptor } from './response-headers.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('ResponseHeadersInterceptor', () => {
  let interceptor: ResponseHeadersInterceptor;

  beforeEach(() => {
    interceptor = new ResponseHeadersInterceptor();
  });

  const createMockContext = (): { ctx: ExecutionContext; res: any } => {
    const res = {
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
    };
    const ctx = {
      switchToHttp: () => ({
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('should remove X-Powered-By header', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(res.removeHeader).toHaveBeenCalledWith('X-Powered-By');
  });

  it('should set X-Content-Type-Options header', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
  });

  it('should set X-Request-Start header with timestamp', async () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Start',
      expect.stringMatching(/^t=\d+$/),
    );
  });

  it('should pass through the handler result', async () => {
    const { ctx } = createMockContext();
    const handler: CallHandler = { handle: () => of({ data: 'test' }) };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ data: 'test' });
  });

  it('should set headers before handler executes', () => {
    const { ctx, res } = createMockContext();
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler);

    // Headers should already be set (before subscribing)
    expect(res.removeHeader).toHaveBeenCalledWith('X-Powered-By');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
  });
});
