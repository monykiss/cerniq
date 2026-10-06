import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// InstitutionScopeGuard verifies that the JWT-authenticated caller actually
// owns the institution named in the URL (`:institutionId` param). It also
// hands the verified id to `req.user.institutionId` so the existing
// TenantContextMiddleware can hydrate the RLS GUC variable on the same
// request.
//
// Why a dedicated guard: existing ALM controllers trust the URL param and
// rely on application-level filtering. RLS makes that safer at the row
// level, but we want a 403 (not just empty result sets) when a caller
// addresses someone else's institution. This guard is the explicit gate.
//
// Routes WITHOUT `:institutionId` (utility/global endpoints in the same
// controller — e.g. `treasury/rates`, `analyst/tools`) pass through. The
// guard's job is to verify ownership of *that param*; absent the param,
// there is nothing to verify, and AuthGuard (which must run first) is the
// baseline authentication check. This pass-through behavior is what makes
// the guard safe to apply at the controller class level — see AlmModule.
//
// FAIL-CLOSED on the scoped path: any database error or missing relation
// results in 403, never silent allow. AuthGuard MUST run first so
// `req.user` is populated.

@Injectable()
export class InstitutionScopeGuard implements CanActivate {
  private readonly logger = new Logger(InstitutionScopeGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('authentication required');
    }

    const institutionId: string | undefined = req.params?.institutionId;
    if (!institutionId) {
      // No `:institutionId` in this route's path → no scoped resource to
      // verify. Pass through (AuthGuard already enforced authentication).
      // This is what lets the guard sit at the class level on controllers
      // that mix tenant-scoped and global routes. Routes that receive
      // institutionId via body/query/derivation should call
      // verifyOwnership() directly from the controller or service — see
      // ai-advisor.controller.ts for an example.
      return true;
    }

    await this.verifyOwnership(
      institutionId,
      userId,
      !!req.user?.access?.isPlatformAdmin,
    );

    // Hand the verified id to the tenant middleware so RLS engages.
    req.user.institutionId = institutionId;
    return true;
  }

  /**
   * Public ownership-check primitive. Same contract as the canActivate()
   * path but callable from non-HTTP contexts where `:institutionId` is
   * not in the URL — controllers handling body-supplied institutionIds,
   * service methods invoked from WebSocket gateways, scheduled jobs, etc.
   *
   * Throws the same exceptions canActivate() throws (NotFound /
   * Forbidden), so callers get matching HTTP semantics for free when the
   * exception bubbles through Nest's exception filter.
   *
   * Fail-closed on Prisma exceptions: a database outage becomes 403,
   * never a generic 500 reported as silent allow.
   */
  async verifyOwnership(
    institutionId: string,
    userId: string,
    isPlatformAdmin: boolean,
  ): Promise<void> {
    let institution: { workspace: { ownerId: string | null } | null } | null;
    try {
      institution = await this.prisma.institution.findUnique({
        where: { id: institutionId },
        select: { workspace: { select: { ownerId: true } } },
      });
    } catch (err) {
      this.logger.error(
        `institution lookup failed for ${institutionId}: ${String(err)}`,
      );
      throw new ForbiddenException('institution access check failed');
    }

    if (!institution) {
      throw new NotFoundException('institution not found');
    }

    if (!isPlatformAdmin && institution.workspace?.ownerId !== userId) {
      this.logger.warn(
        `denied: user ${userId} attempted to access institution ${institutionId}`,
      );
      throw new ForbiddenException('not authorized for this institution');
    }
  }

  /**
   * Sister primitive of `verifyOwnership` for routes that receive a raw
   * `workspaceId` rather than an `institutionId`. The chain is
   * `Workspace → Workspace.ownerId` (one hop shorter than the institution
   * path). Same fail-closed + platform-admin bypass + NotFound/Forbidden split
   * as `verifyOwnership`. Caller from `ncua/ncua.controller.ts` (body
   * `workspaceId` on the import route); future body-trust closures whose
   * tenancy root is the Workspace directly should call this.
   */
  async verifyWorkspaceOwnership(
    workspaceId: string,
    userId: string,
    isPlatformAdmin: boolean,
  ): Promise<void> {
    let workspace: { ownerId: string | null } | null;
    try {
      workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
      });
    } catch (err) {
      this.logger.error(
        `workspace lookup failed for ${workspaceId}: ${String(err)}`,
      );
      throw new ForbiddenException('workspace access check failed');
    }

    if (!workspace) {
      throw new NotFoundException('workspace not found');
    }

    if (!isPlatformAdmin && workspace.ownerId !== userId) {
      this.logger.warn(
        `denied: user ${userId} attempted to access workspace ${workspaceId}`,
      );
      throw new ForbiddenException('not authorized for this workspace');
    }
  }
}
