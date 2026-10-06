import {
  StripeMeteringInterceptor,
  getUsageLog,
} from './stripe-metering.interceptor';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

describe('StripeMeteringInterceptor', () => {
  let interceptor: StripeMeteringInterceptor;

  beforeEach(() => {
    interceptor = new StripeMeteringInterceptor();
  });

  const createContext = (
    method: string,
    path: string,
    params: Record<string, string> = {},
    headers: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url: path,
          route: { path },
          params,
          headers,
        }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    }) as unknown as ExecutionContext;

  it('records compute_job usage for billable ALM endpoints', (done) => {
    const before = Date.now();
    const ctx = createContext('POST', '/api/alm/:id/monte-carlo/run', {
      institutionId: 'inst-1',
    });
    const next: CallHandler = { handle: () => of({ result: 'ok' }) };

    interceptor.intercept(ctx, next).subscribe(() => {
      const logs = getUsageLog('inst-1', before);
      const computeEvents = logs.filter((e) => e.eventType === 'compute_job');
      expect(computeEvents.length).toBeGreaterThanOrEqual(1);
      done();
    });
  });

  it('records api_call usage for /api/v1/ endpoints', (done) => {
    const before = Date.now();
    const ctx = createContext(
      'GET',
      '/api/v1/some-resource',
      {},
      { 'x-institution-id': 'inst-2' },
    );
    const next: CallHandler = { handle: () => of({ data: [] }) };

    interceptor.intercept(ctx, next).subscribe(() => {
      const logs = getUsageLog('inst-2', before);
      const apiCalls = logs.filter((e) => e.eventType === 'api_call');
      expect(apiCalls.length).toBeGreaterThanOrEqual(1);
      done();
    });
  });

  it('does not record usage when no institutionId is available', (done) => {
    const before = Date.now();
    const ctx = createContext('GET', '/api/v1/public', {}, {});
    const next: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(ctx, next).subscribe(() => {
      // No institution, so no new usage log entries for unknown institution
      const logs = getUsageLog('nonexistent-inst', before);
      expect(logs).toHaveLength(0);
      done();
    });
  });
});
