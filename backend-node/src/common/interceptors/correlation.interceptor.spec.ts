import { CorrelationInterceptor } from './correlation.interceptor';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  setTag: jest.fn(),
  setContext: jest.fn(),
}));

describe('CorrelationInterceptor', () => {
  let interceptor: CorrelationInterceptor;

  beforeEach(() => {
    interceptor = new CorrelationInterceptor();
    jest.clearAllMocks();
  });

  const createMockContext = (
    requestId?: string,
  ): { ctx: ExecutionContext; res: any } => {
    const res = {
      setHeader: jest.fn(),
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: requestId
            ? { 'x-request-id': requestId, 'user-agent': 'test' }
            : { 'user-agent': 'test' },
          id: requestId,
          method: 'GET',
          url: '/api/test',
          ip: '127.0.0.1',
        }),
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { ctx, res };
  };

  it('sets Sentry tags when request ID is present', (done) => {
    const { ctx } = createMockContext('req-123');
    const handler: CallHandler = { handle: () => of({ data: 'ok' }) };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(Sentry.setTag).toHaveBeenCalledWith('request_id', 'req-123');
      expect(Sentry.setContext).toHaveBeenCalledWith(
        'request',
        expect.objectContaining({ id: 'req-123' }),
      );
      done();
    });
  });

  it('sets response timing headers', (done) => {
    const { ctx, res } = createMockContext('req-456');
    const handler: CallHandler = { handle: () => of('result') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Response-Time',
        expect.stringMatching(/\d+ms/),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Server-Timing',
        expect.stringMatching(/total;dur=\d+/),
      );
      done();
    });
  });

  it('does not set Sentry context when no request ID', (done) => {
    const { ctx } = createMockContext(undefined);
    const handler: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(Sentry.setTag).not.toHaveBeenCalled();
      done();
    });
  });
});
