import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { InstitutionScopeGuard } from './institution-scope.guard';
import type { PrismaService } from '../../prisma.service';

describe('InstitutionScopeGuard', () => {
  let prisma: {
    institution: { findUnique: jest.Mock };
    workspace: { findUnique: jest.Mock };
  };
  let guard: InstitutionScopeGuard;

  const createContext = (overrides: {
    userId?: string;
    institutionId?: string;
    isPlatformAdmin?: boolean;
  }): { ctx: ExecutionContext; req: any } => {
    const req: any = {
      user: overrides.userId
        ? {
            userId: overrides.userId,
            access: overrides.isPlatformAdmin ? { isPlatformAdmin: true } : {},
          }
        : undefined,
      params: overrides.institutionId
        ? { institutionId: overrides.institutionId }
        : {},
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  };

  beforeEach(() => {
    prisma = {
      institution: { findUnique: jest.fn() },
      workspace: { findUnique: jest.fn() },
    };
    guard = new InstitutionScopeGuard(prisma as unknown as PrismaService);
  });

  it('throws Unauthorized when there is no authenticated user', async () => {
    const { ctx } = createContext({ institutionId: 'inst-1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('passes through when :institutionId path param is missing (no scoped resource to verify)', async () => {
    // Class-level mount on controllers like AlmController mixes tenant-scoped
    // routes (`:institutionId/*`) with utility routes (`treasury/rates`,
    // `analyst/tools`, `demo/build`, etc.). The guard's contract is to
    // verify ownership of `:institutionId` *when present*. With no param,
    // there is nothing to scope; AuthGuard (runs first) is the baseline
    // authentication check. Without this pass-through, every utility route
    // in the controller would 403.
    const { ctx } = createContext({ userId: 'user-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('still passes through when both user and institutionId are absent', async () => {
    // Defense-in-depth: when neither auth nor scope can be enforced here,
    // the request still hits AuthGuard first — this path is reached only
    // if AuthGuard upstream chose to allow it (e.g. demo/public routes
    // that don't reach this guard at all).
    const req: any = { user: { userId: 'user-1' }, params: {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws NotFound when the institution does not exist', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);
    const { ctx } = createContext({
      userId: 'user-1',
      institutionId: 'missing',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws Forbidden when caller is not the workspace owner', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      workspace: { ownerId: 'other-user' },
    });
    const { ctx } = createContext({
      userId: 'user-1',
      institutionId: 'inst-1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows access when caller owns the institution and sets req.user.institutionId', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      workspace: { ownerId: 'user-1' },
    });
    const { ctx, req } = createContext({
      userId: 'user-1',
      institutionId: 'inst-1',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.institutionId).toBe('inst-1');
  });

  it('allows platform admin bypass even when ownership does not match (and still sets institutionId for RLS)', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      workspace: { ownerId: 'other-user' },
    });
    const { ctx, req } = createContext({
      userId: 'user-1',
      institutionId: 'inst-1',
      isPlatformAdmin: true,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.institutionId).toBe('inst-1');
  });

  it('fails closed (Forbidden) when Prisma throws during ownership lookup', async () => {
    prisma.institution.findUnique.mockRejectedValue(new Error('db down'));
    const { ctx } = createContext({
      userId: 'user-1',
      institutionId: 'inst-1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ─── verifyOwnership() — public ownership primitive ──────────────────
  // Used by controllers/services that receive institutionId from body,
  // query, or derivation (where :institutionId isn't in the URL and the
  // canActivate() pass-through would otherwise be a silent IDOR). See
  // ai-advisor.controller.ts for the canonical caller.

  describe('verifyOwnership (multi-context primitive)', () => {
    it('resolves silently when caller owns the institution', async () => {
      prisma.institution.findUnique.mockResolvedValue({
        workspace: { ownerId: 'user-1' },
      });
      await expect(
        guard.verifyOwnership('inst-1', 'user-1', false),
      ).resolves.toBeUndefined();
      expect(prisma.institution.findUnique).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        select: { workspace: { select: { ownerId: true } } },
      });
    });

    it('throws Forbidden when caller is not the workspace owner', async () => {
      prisma.institution.findUnique.mockResolvedValue({
        workspace: { ownerId: 'someone-else' },
      });
      await expect(
        guard.verifyOwnership('inst-1', 'user-1', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows platform admin bypass without comparing owner', async () => {
      prisma.institution.findUnique.mockResolvedValue({
        workspace: { ownerId: 'someone-else' },
      });
      await expect(
        guard.verifyOwnership('inst-1', 'user-1', true),
      ).resolves.toBeUndefined();
    });

    it('throws NotFound when the institution does not exist', async () => {
      prisma.institution.findUnique.mockResolvedValue(null);
      await expect(
        guard.verifyOwnership('missing', 'user-1', false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fails closed (Forbidden) when the Prisma lookup throws', async () => {
      prisma.institution.findUnique.mockRejectedValue(new Error('timeout'));
      await expect(
        guard.verifyOwnership('inst-1', 'user-1', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ─── verifyWorkspaceOwnership() — workspace-rooted ownership primitive ─
  // Sister of verifyOwnership for routes whose tenancy key is a raw
  // workspaceId rather than an institutionId (e.g. NCUA import). Same
  // contract: silent resolve / Forbidden / NotFound / platform-admin bypass /
  // fail-closed on Prisma throw.

  describe('verifyWorkspaceOwnership (workspace-rooted primitive)', () => {
    it('resolves silently when caller owns the workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue({ ownerId: 'user-1' });
      await expect(
        guard.verifyWorkspaceOwnership('ws-1', 'user-1', false),
      ).resolves.toBeUndefined();
      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        select: { ownerId: true },
      });
    });

    it('throws Forbidden when caller is not the workspace owner', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        ownerId: 'someone-else',
      });
      await expect(
        guard.verifyWorkspaceOwnership('ws-1', 'user-1', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows platform admin bypass without comparing owner', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        ownerId: 'someone-else',
      });
      await expect(
        guard.verifyWorkspaceOwnership('ws-1', 'user-1', true),
      ).resolves.toBeUndefined();
    });

    it('throws NotFound when the workspace does not exist', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      await expect(
        guard.verifyWorkspaceOwnership('missing', 'user-1', false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fails closed (Forbidden) when the Prisma lookup throws', async () => {
      prisma.workspace.findUnique.mockRejectedValue(new Error('timeout'));
      await expect(
        guard.verifyWorkspaceOwnership('ws-1', 'user-1', false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
