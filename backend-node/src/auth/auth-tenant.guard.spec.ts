import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { AuthTenantGuard } from './auth-tenant.guard';
import type { AuthGuard } from './auth.guard';
import type { TenantScopeGuard } from '../common/guards/tenant-scope.guard';

describe('AuthTenantGuard', () => {
  let authGuard: jest.Mocked<Pick<AuthGuard, 'canActivate'>>;
  let tenantScopeGuard: jest.Mocked<Pick<TenantScopeGuard, 'canActivate'>>;
  let guard: AuthTenantGuard;

  const createContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ path: '/api/alm/institutions' }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    authGuard = { canActivate: jest.fn() };
    tenantScopeGuard = { canActivate: jest.fn() };
    guard = new AuthTenantGuard(
      authGuard as unknown as AuthGuard,
      tenantScopeGuard as unknown as TenantScopeGuard,
    );
  });

  it('returns false and skips tenant scope when AuthGuard rejects', async () => {
    authGuard.canActivate.mockResolvedValue(false);

    await expect(guard.canActivate(createContext())).resolves.toBe(false);
    expect(tenantScopeGuard.canActivate).not.toHaveBeenCalled();
  });

  it('runs AuthGuard before TenantScopeGuard and returns tenant scope result', async () => {
    const callOrder: string[] = [];
    authGuard.canActivate.mockImplementation(async () => {
      callOrder.push('auth');
      return true;
    });
    tenantScopeGuard.canActivate.mockImplementation(() => {
      callOrder.push('tenant');
      return true;
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(callOrder).toEqual(['auth', 'tenant']);
  });

  it('returns false when TenantScopeGuard returns false (no fail-closed override)', async () => {
    authGuard.canActivate.mockResolvedValue(true);
    tenantScopeGuard.canActivate.mockReturnValue(false);

    await expect(guard.canActivate(createContext())).resolves.toBe(false);
  });

  it('rethrows ForbiddenException from TenantScopeGuard (fail-closed)', async () => {
    authGuard.canActivate.mockResolvedValue(true);
    tenantScopeGuard.canActivate.mockImplementation(() => {
      throw new ForbiddenException('tenant scope required');
    });

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rethrows non-Forbidden errors from TenantScopeGuard', async () => {
    authGuard.canActivate.mockResolvedValue(true);
    tenantScopeGuard.canActivate.mockImplementation(() => {
      throw new TypeError('unexpected');
    });

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('propagates AuthGuard rejections without invoking tenant scope', async () => {
    authGuard.canActivate.mockRejectedValue(new Error('boom'));

    await expect(guard.canActivate(createContext())).rejects.toThrow('boom');
    expect(tenantScopeGuard.canActivate).not.toHaveBeenCalled();
  });
});
