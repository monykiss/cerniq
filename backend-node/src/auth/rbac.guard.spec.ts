import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RBACGuard,
  CerniqRole,
  hasPermission,
  getRolePermissions,
  getAllRoles,
  REQUIRED_PERMISSIONS_KEY,
} from './rbac.guard';

describe('RBACGuard', () => {
  let guard: RBACGuard;
  let reflector: Reflector;

  function makeContext(role: string, permissions: string[] = []) {
    const handler = jest.fn();
    if (permissions.length) {
      Reflect.defineMetadata(REQUIRED_PERMISSIONS_KEY, permissions, handler);
    }
    return {
      getHandler: () => handler,
      getClass: () => Object,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    } as any;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RBACGuard(reflector);
  });

  it('allows when no permissions required', () => {
    const ctx = makeContext(CerniqRole.VIEWER);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows VIEWER to read:alm', () => {
    const ctx = makeContext(CerniqRole.VIEWER, ['read:alm']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies VIEWER write:alm', () => {
    const ctx = makeContext(CerniqRole.VIEWER, ['write:alm']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows CFO to run:analysis', () => {
    const ctx = makeContext(CerniqRole.CFO, ['run:analysis']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows OPERATOR to write:balance_sheet', () => {
    const ctx = makeContext(CerniqRole.OPERATOR, ['write:balance_sheet']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies BOARD_MEMBER write access', () => {
    const ctx = makeContext(CerniqRole.BOARD_MEMBER, ['write:alm']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows BREAKGLASS everything (wildcard)', () => {
    const ctx = makeContext(CerniqRole.BREAKGLASS, [
      'write:alm',
      'run:monte_carlo',
      'admin:anything',
    ]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('requires ALL permissions (AND logic)', () => {
    const ctx = makeContext(CerniqRole.VIEWER, ['read:alm', 'write:alm']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('defaults unknown role to VIEWER permissions', () => {
    const ctx = makeContext('unknown_role', ['read:alm']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('error message includes missing permissions', () => {
    const ctx = makeContext(CerniqRole.VIEWER, ['admin:delete']);
    try {
      guard.canActivate(ctx);
      fail('Should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('admin:delete');
      expect(e.message).toContain('viewer');
    }
  });
});

describe('RBAC helpers', () => {
  it('hasPermission checks role', () => {
    expect(hasPermission(CerniqRole.CFO, 'run:analysis')).toBe(true);
    expect(hasPermission(CerniqRole.VIEWER, 'write:alm')).toBe(false);
  });

  it('BREAKGLASS has all permissions', () => {
    expect(hasPermission(CerniqRole.BREAKGLASS, 'anything')).toBe(true);
  });

  it('getRolePermissions returns array', () => {
    const perms = getRolePermissions(CerniqRole.CFO);
    expect(perms).toContain('run:analysis');
    expect(perms).toContain('read:alm');
  });

  it('getAllRoles returns all defined roles', () => {
    const roles = getAllRoles();
    expect(roles.length).toBeGreaterThanOrEqual(10);
    expect(roles.find((r) => r.role === CerniqRole.CFO)).toBeDefined();
    expect(roles.find((r) => r.role === CerniqRole.BREAKGLASS)).toBeDefined();
  });
});
