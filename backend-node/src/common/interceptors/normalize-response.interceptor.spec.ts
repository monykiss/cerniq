import { NormalizeResponseInterceptor } from './normalize-response.interceptor';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('NormalizeResponseInterceptor', () => {
  let interceptor: NormalizeResponseInterceptor;

  beforeEach(() => {
    interceptor = new NormalizeResponseInterceptor();
  });

  const context = {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({ setHeader: jest.fn() }),
    }),
  } as unknown as ExecutionContext;

  it('wraps plain data in a success envelope', (done) => {
    const next: CallHandler = { handle: () => of({ id: 1, name: 'test' }) };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1, name: 'test' });
      expect(result.timestamp).toBeDefined();
      done();
    });
  });

  it('skips wrapping if response already has success field', (done) => {
    const alreadyWrapped = { success: true, data: 'pre-wrapped' };
    const next: CallHandler = { handle: () => of(alreadyWrapped) };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(result).toBe(alreadyWrapped);
      expect(result.timestamp).toBeUndefined();
      done();
    });
  });

  it('passes through null/undefined without wrapping', (done) => {
    const next: CallHandler = { handle: () => of(null) };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(result).toBeNull();
      done();
    });
  });
});
