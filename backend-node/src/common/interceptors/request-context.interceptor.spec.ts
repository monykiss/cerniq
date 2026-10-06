import {
  RequestContextInterceptor,
  getRequestContext,
} from './request-context.interceptor';
import { of, lastValueFrom, throwError } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('RequestContextInterceptor', () => {
  let interceptor: RequestContextInterceptor;

  beforeEach(() => {
    interceptor = new RequestContextInterceptor();
  });

  const createMockContext = (
    overrides: Record<string, any> = {},
  ): ExecutionContext => {
    const req = {
      headers: { 'x-request-id': 'req-abc' },
      method: 'GET',
      url: '/api/test',
      user: undefined,
      id: undefined,
      ...overrides,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  };

  it('should store request context accessible via getRequestContext', async () => {
    const ctx = createMockContext({
      headers: { 'x-request-id': 'test-id' },
      method: 'POST',
      url: '/api/data',
    });

    let capturedContext: any;
    const handler: CallHandler = {
      handle: () => {
        capturedContext = getRequestContext();
        return of('ok');
      },
    };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(capturedContext).toBeDefined();
    expect(capturedContext.requestId).toBe('test-id');
    expect(capturedContext.method).toBe('POST');
    expect(capturedContext.path).toBe('/api/data');
  });

  it('should include userId when user is present', async () => {
    const ctx = createMockContext({
      user: { id: 'user-1', organizationId: 'org-1' },
      headers: { 'x-request-id': 'req-1' },
    });

    let capturedContext: any;
    const handler: CallHandler = {
      handle: () => {
        capturedContext = getRequestContext();
        return of('ok');
      },
    };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(capturedContext.userId).toBe('user-1');
    expect(capturedContext.tenantId).toBe('org-1');
  });

  it('should include tenantId from x-tenant-id header', async () => {
    const ctx = createMockContext({
      headers: { 'x-request-id': 'req-2', 'x-tenant-id': 'tenant-abc' },
    });

    let capturedContext: any;
    const handler: CallHandler = {
      handle: () => {
        capturedContext = getRequestContext();
        return of('ok');
      },
    };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(capturedContext.tenantId).toBe('tenant-abc');
  });

  it('should include startTime', async () => {
    const before = Date.now();
    const ctx = createMockContext();

    let capturedContext: any;
    const handler: CallHandler = {
      handle: () => {
        capturedContext = getRequestContext();
        return of('ok');
      },
    };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(capturedContext.startTime).toBeGreaterThanOrEqual(before);
    expect(capturedContext.startTime).toBeLessThanOrEqual(Date.now());
  });

  it('should generate a requestId when none is provided', async () => {
    const ctx = createMockContext({ headers: {} });

    let capturedContext: any;
    const handler: CallHandler = {
      handle: () => {
        capturedContext = getRequestContext();
        return of('ok');
      },
    };

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(capturedContext.requestId).toBeDefined();
    expect(typeof capturedContext.requestId).toBe('string');
    expect(capturedContext.requestId.length).toBeGreaterThan(0);
  });

  it('should pass through the handler result', async () => {
    const ctx = createMockContext();
    const handler: CallHandler = {
      handle: () => of({ data: 'result' }),
    };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ data: 'result' });
  });

  it('getRequestContext should return undefined outside of context', () => {
    const ctx = getRequestContext();
    expect(ctx).toBeUndefined();
  });

  it('should propagate errors from the handler', async () => {
    const ctx = createMockContext();
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('handler error')),
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, handler)),
    ).rejects.toThrow('handler error');
  });
});
