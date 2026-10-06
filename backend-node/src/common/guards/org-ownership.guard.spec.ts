import { OrgOwnershipGuard } from './org-ownership.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('OrgOwnershipGuard', () => {
  let guard: OrgOwnershipGuard;

  beforeEach(() => {
    guard = new OrgOwnershipGuard();
  });

  const createMockContext = (
    user: any,
    params: Record<string, string> = {},
    body: Record<string, any> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, params, body }),
      }),
    }) as unknown as ExecutionContext;

  it('should throw ForbiddenException when no user is present', () => {
    const ctx = createMockContext(null, { orgId: 'org-1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Authentication required');
  });

  it('should allow when no orgId in route params or body', () => {
    const ctx = createMockContext({ id: 'user-1', organizationId: 'org-1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow when user orgId matches route orgId', () => {
    const ctx = createMockContext(
      { id: 'user-1', organizationId: 'org-1' },
      { orgId: 'org-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow when user orgId matches route organizationId', () => {
    const ctx = createMockContext(
      { id: 'user-1', organizationId: 'org-1' },
      { organizationId: 'org-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow when user orgId (via orgId field) matches', () => {
    const ctx = createMockContext(
      { id: 'user-1', orgId: 'org-1' },
      { orgId: 'org-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw when user orgId does not match route orgId', () => {
    const ctx = createMockContext(
      { id: 'user-1', organizationId: 'org-1' },
      { orgId: 'org-2' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow(
      'Access denied to this organization',
    );
  });

  it('should throw when user has no organization assignment', () => {
    const ctx = createMockContext({ id: 'user-1' }, { orgId: 'org-1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow(
      'User is not assigned to any organization',
    );
  });

  it('should check body organizationId as fallback', () => {
    const ctx = createMockContext(
      { id: 'user-1', organizationId: 'org-1' },
      {},
      { organizationId: 'org-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should reject cross-tenant body organizationId', () => {
    const ctx = createMockContext(
      { id: 'user-1', organizationId: 'org-1' },
      {},
      { organizationId: 'org-other' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
