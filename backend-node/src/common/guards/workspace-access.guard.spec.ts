import { WorkspaceAccessGuard } from './workspace-access.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('WorkspaceAccessGuard', () => {
  let guard: WorkspaceAccessGuard;

  beforeEach(() => {
    guard = new WorkspaceAccessGuard();
  });

  const createMockContext = (
    user: any,
    params: any = {},
    headers: any = {},
    query: any = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, params, headers, query }),
      }),
    }) as unknown as ExecutionContext;

  it('throws when user is not authenticated', () => {
    const ctx = createMockContext(null, { workspaceId: 'ws-1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows access when no workspace ID is specified', () => {
    const ctx = createMockContext({ id: 'u1', workspaceIds: [] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows admin access to any workspace', () => {
    const ctx = createMockContext(
      { id: 'u1', role: 'admin', workspaceIds: [] },
      { workspaceId: 'ws-99' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when user belongs to the workspace', () => {
    const ctx = createMockContext(
      { id: 'u1', workspaceIds: ['ws-1', 'ws-2'] },
      { workspaceId: 'ws-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies access when user does not belong to workspace', () => {
    const ctx = createMockContext(
      { id: 'u1', workspaceIds: ['ws-1'] },
      { workspaceId: 'ws-99' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
