import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { TenantScopeGuard } from './tenant-scope.guard';

describe('TenantScopeGuard', () => {
  let guard: TenantScopeGuard;

  beforeEach(() => {
    guard = new TenantScopeGuard();
  });

  const createMockContext = (
    path: string,
    user: Record<string, unknown> | undefined,
    headers: Record<string, string> = {},
    method: string = 'GET',
  ): { ctx: ExecutionContext; request: any } => {
    const request = {
      path,
      url: path,
      originalUrl: path,
      user,
      headers,
      method,
    } as any;
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  };

  it('passes without user for tenant paths (public ALM calculators)', () => {
    const { ctx } = createMockContext('/api/alm/duration-gap', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('sets tenantId from user.orgId', () => {
    const { ctx, request } = createMockContext(
      '/api/alm/institutions',
      {
        orgId: 'org-123',
        userId: 'u1',
        authMethod: 'token',
        access: {},
      },
      {},
    );
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.tenantId).toBe('org-123');
  });

  it('throws Forbidden when authenticated without org on /api/alm', () => {
    const { ctx } = createMockContext('/api/alm/institutions', {
      userId: 'u1',
      authMethod: 'token',
      access: {},
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows platform admin without org on tenant path', () => {
    const { ctx, request } = createMockContext('/api/alm/institutions', {
      userId: 'u1',
      authMethod: 'token',
      access: { isPlatformAdmin: true },
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.tenantId).toBeNull();
  });

  it('resolves tenant from /api/expenses/:orgId segment', () => {
    const { ctx, request } = createMockContext(
      '/api/expenses/acme-corp/upload',
      { userId: 'u1', authMethod: 'token', access: {} },
    );
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.tenantId).toBe('acme-corp');
  });

  it('throws for /api/expenses list without org header', () => {
    const { ctx } = createMockContext('/api/expenses', {
      userId: 'u1',
      authMethod: 'token',
      access: {},
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows non-tenant paths without org even when authenticated', () => {
    const { ctx } = createMockContext('/api/portal/jobs', {
      userId: 'u1',
      authMethod: 'token',
      access: {},
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('prefers user.orgId over x-organization-id', () => {
    const { ctx, request } = createMockContext(
      '/api/alm/institutions',
      { orgId: 'from-user', userId: 'u1', authMethod: 'token', access: {} },
      { 'x-organization-id': 'from-header' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.tenantId).toBe('from-user');
  });

  describe('/api/analyst (tenant-required after 2026-05-14)', () => {
    it('throws Forbidden when authenticated without org on /api/analyst', () => {
      const { ctx } = createMockContext('/api/analyst/inst-123/message', {
        userId: 'u1',
        authMethod: 'token',
        access: {},
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('passes with user.orgId on /api/analyst and resolves tenantId', () => {
      const { ctx, request } = createMockContext(
        '/api/analyst/inst-123/message',
        { orgId: 'org-A', userId: 'u1', authMethod: 'token', access: {} },
      );
      expect(guard.canActivate(ctx)).toBe(true);
      expect(request.tenantId).toBe('org-A');
    });

    it('allows platform admin bypass on /api/analyst', () => {
      const { ctx, request } = createMockContext(
        '/api/analyst/inst-123/message',
        {
          userId: 'u1',
          authMethod: 'token',
          access: { isPlatformAdmin: true },
        },
      );
      expect(guard.canActivate(ctx)).toBe(true);
      expect(request.tenantId).toBeNull();
    });

    it('passes unauthenticated /api/analyst (public calculators contract)', () => {
      const { ctx } = createMockContext(
        '/api/analyst/inst-123/message',
        undefined,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('resolves tenantId from x-organization-id for API key on /api/analyst', () => {
      const { ctx, request } = createMockContext(
        '/api/analyst/inst-123/message',
        { userId: 'u1', authMethod: 'api_key', access: {} },
        { 'x-organization-id': 'org-B' },
      );
      expect(guard.canActivate(ctx)).toBe(true);
      expect(request.tenantId).toBe('org-B');
    });
  });
});
