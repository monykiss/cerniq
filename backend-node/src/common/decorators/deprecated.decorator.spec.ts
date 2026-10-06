import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import {
  DeprecationInterceptor,
  DEPRECATION_KEY,
  Deprecated,
} from './deprecated.decorator';

describe('DeprecationInterceptor', () => {
  let interceptor: DeprecationInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new DeprecationInterceptor(reflector);
  });

  function makeContext(handlerMeta: any = null): {
    context: ExecutionContext;
    setHeader: jest.Mock;
  } {
    const setHeader = jest.fn();
    const handler = jest.fn();
    jest.spyOn(reflector, 'get').mockReturnValue(handlerMeta);
    const context = {
      getHandler: () => handler,
      switchToHttp: () => ({
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    return { context, setHeader };
  }

  function makeCallHandler(): CallHandler {
    return { handle: () => of('response-data') };
  }

  it('should pass through without headers when no deprecation meta', (done) => {
    const { context, setHeader } = makeContext(null);
    const next = makeCallHandler();

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toBe('response-data');
      expect(setHeader).not.toHaveBeenCalled();
      done();
    });
  });

  it('should set Sunset header with UTC date string', (done) => {
    const meta = { sunsetDate: '2026-06-01', alternative: '/api/v2/analysis' };
    const { context, setHeader } = makeContext(meta);
    const next = makeCallHandler();

    interceptor.intercept(context, next).subscribe(() => {
      expect(setHeader).toHaveBeenCalledWith(
        'Sunset',
        new Date('2026-06-01').toUTCString(),
      );
      done();
    });
  });

  it('should set Deprecation header to "true"', (done) => {
    const meta = { sunsetDate: '2026-06-01', alternative: '/api/v2/analysis' };
    const { context, setHeader } = makeContext(meta);
    const next = makeCallHandler();

    interceptor.intercept(context, next).subscribe(() => {
      expect(setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      done();
    });
  });

  it('should set Link header with successor-version rel', (done) => {
    const meta = {
      sunsetDate: '2026-12-31',
      alternative: '/api/v2/resource',
    };
    const { context, setHeader } = makeContext(meta);
    const next = makeCallHandler();

    interceptor.intercept(context, next).subscribe(() => {
      expect(setHeader).toHaveBeenCalledWith(
        'Link',
        '</api/v2/resource>; rel="successor-version"',
      );
      done();
    });
  });

  it('should set all three headers in a single response', (done) => {
    const meta = { sunsetDate: '2026-06-01', alternative: '/v2/endpoint' };
    const { context, setHeader } = makeContext(meta);
    const next = makeCallHandler();

    interceptor.intercept(context, next).subscribe(() => {
      expect(setHeader).toHaveBeenCalledTimes(3);
      const headerNames = setHeader.mock.calls.map((call: any[]) => call[0]);
      expect(headerNames).toContain('Sunset');
      expect(headerNames).toContain('Deprecation');
      expect(headerNames).toContain('Link');
      done();
    });
  });

  it('should still emit the original response value', (done) => {
    const meta = { sunsetDate: '2026-06-01', alternative: '/v2' };
    const { context } = makeContext(meta);
    const next = { handle: () => of({ data: 'original' }) } as CallHandler;

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toEqual({ data: 'original' });
      done();
    });
  });
});

describe('Deprecated decorator factory', () => {
  it('should return a decorator function', () => {
    const decorator = Deprecated('2026-06-01', '/api/v2/thing');
    expect(typeof decorator).toBe('function');
  });

  it('should export DEPRECATION_KEY constant', () => {
    expect(DEPRECATION_KEY).toBe('api_deprecation');
  });
});
