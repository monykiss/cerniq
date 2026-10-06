import { IpAllowlistGuard } from './ip-allowlist.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('IpAllowlistGuard', () => {
  let guard: IpAllowlistGuard;
  const OLD_ENV = process.env;

  beforeEach(() => {
    guard = new IpAllowlistGuard();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createMockContext = (
    ip: string,
    headers: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          ip,
          headers,
          connection: { remoteAddress: ip },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('always allows localhost (127.0.0.1)', () => {
    process.env.IP_ALLOWLIST = '';
    const ctx = createMockContext('127.0.0.1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('always allows IPv6 loopback (::1)', () => {
    process.env.IP_ALLOWLIST = '';
    const ctx = createMockContext('::1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows IPs in the allowlist', () => {
    process.env.IP_ALLOWLIST = '10.0.0.1, 10.0.0.2';
    const ctx = createMockContext('10.0.0.1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks IPs not in the allowlist', () => {
    process.env.IP_ALLOWLIST = '10.0.0.1';
    const ctx = createMockContext('192.168.1.100');
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('blocks non-local IPs when allowlist is empty', () => {
    process.env.IP_ALLOWLIST = '';
    const ctx = createMockContext('203.0.113.50');
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('extracts IP from X-Forwarded-For header', () => {
    process.env.IP_ALLOWLIST = '10.0.0.5';
    const ctx = createMockContext('192.168.1.1', {
      'x-forwarded-for': '10.0.0.5, 192.168.1.1',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
