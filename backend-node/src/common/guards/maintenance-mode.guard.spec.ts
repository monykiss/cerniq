import { MaintenanceModeGuard } from './maintenance-mode.guard';
import { ServiceUnavailableException, ExecutionContext } from '@nestjs/common';

describe('MaintenanceModeGuard', () => {
  let guard: MaintenanceModeGuard;
  const OLD_ENV = process.env;

  beforeEach(() => {
    guard = new MaintenanceModeGuard();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createMockContext = (
    url: string,
    headers: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ url, headers }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow all requests when maintenance mode is off', () => {
    process.env.MAINTENANCE_MODE = 'false';
    const ctx = createMockContext('/api/users');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow all requests when MAINTENANCE_MODE is not set', () => {
    delete process.env.MAINTENANCE_MODE;
    const ctx = createMockContext('/api/users');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow /health during maintenance', () => {
    process.env.MAINTENANCE_MODE = 'true';
    const ctx = createMockContext('/health');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow /ready during maintenance', () => {
    process.env.MAINTENANCE_MODE = 'true';
    const ctx = createMockContext('/ready');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow /health/detailed during maintenance', () => {
    process.env.MAINTENANCE_MODE = 'true';
    const ctx = createMockContext('/health/detailed');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow admin endpoints with correct admin key', () => {
    process.env.MAINTENANCE_MODE = 'true';
    process.env.ADMIN_KEY = 'secret-key';
    const ctx = createMockContext('/api/admin/toggle', {
      'x-admin-key': 'secret-key',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ServiceUnavailableException for regular endpoints during maintenance', () => {
    process.env.MAINTENANCE_MODE = 'true';
    const ctx = createMockContext('/api/users');
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it('should throw for admin endpoints with wrong admin key', () => {
    process.env.MAINTENANCE_MODE = 'true';
    process.env.ADMIN_KEY = 'correct-key';
    const ctx = createMockContext('/api/admin/toggle', {
      'x-admin-key': 'wrong-key',
    });
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it('should include MAINTENANCE error code in exception', () => {
    process.env.MAINTENANCE_MODE = 'true';
    const ctx = createMockContext('/api/data');
    try {
      guard.canActivate(ctx);
      fail('Expected exception');
    } catch (e: any) {
      const response = e.getResponse();
      expect(response.error.code).toBe('MAINTENANCE');
    }
  });

  it('should handle case-insensitive MAINTENANCE_MODE value', () => {
    process.env.MAINTENANCE_MODE = 'True';
    const ctx = createMockContext('/api/users');
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });
});
