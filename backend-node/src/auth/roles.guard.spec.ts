import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createContext(user: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  it('allows access when no roles are specified', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createContext({ role: 'any' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when roles array is empty', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const context = createContext({ role: 'any' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user has one of the required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['admin', 'super_admin']);
    const context = createContext({ role: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the platform admin bypass even when roles do not match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['OWNER']);
    const context = createContext({
      role: 'VIEWER',
      access: { isPlatformAdmin: true },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when user role does not match', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['admin', 'super_admin']);
    const context = createContext({ role: 'viewer' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('includes user role and required roles in error message', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createContext({ role: 'viewer' });
    try {
      guard.canActivate(context);
    } catch (e: any) {
      expect(e.message).toContain('viewer');
      expect(e.message).toContain('admin');
    }
  });

  it('throws ForbiddenException when user has no role property', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createContext({});
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is null', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createContext(null);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is undefined', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = createContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
