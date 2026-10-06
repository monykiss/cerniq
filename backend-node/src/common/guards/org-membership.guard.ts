import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// OrgMembershipGuard verifies the JWT-authenticated caller belongs to the
// organization referenced in the URL via `:orgId`. It mirrors the
// InstitutionScopeGuard pattern (see commit 8f69c148, agent-api/guards/) but
// for organization-scoped surfaces where ownership flows through
// OrganizationMember instead of Workspace.ownerId.
//
// Previously lived at `close/guards/`. It moved here when the Close Cockpit
// was removed: `agents` and `enterprise` still depend on it, and it never had
// anything to do with Close beyond a `:cycleId` → CloseCycle.organizationId
// resolver. That branch was dropped with the routes that used it — no
// surviving route carries a `:cycleId` param, so it was unreachable.
//
// Pass-through when `:orgId` is not in the route — the same rule that lets
// InstitutionScopeGuard sit at the controller class level on a mixed-route
// controller. AuthGuard upstream is the baseline auth check; when the route
// has nothing tenant-scoped to verify, we pass.
//
// Platform admin override mirrors auth.guard.ts so platform support and audit
// users keep cross-tenant access.
//
// FAIL-CLOSED on Prisma exceptions: a database outage becomes 403, never a
// generic 500 reported as silent allow.

@Injectable()
export class OrgMembershipGuard implements CanActivate {
  private readonly logger = new Logger(OrgMembershipGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.userId ?? req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('authentication required');
    }

    if (req.user?.access?.isPlatformAdmin === true) {
      // Fast-path: skip the membership lookup.
      // Mirrors the original pre-extraction behavior.
      return true;
    }

    const orgId: string | undefined = req.params?.orgId;

    if (!orgId) {
      return true;
    }

    await this.verifyMembership(orgId, userId, false);
    req.user.orgId = orgId;
    return true;
  }

  /**
   * Public membership-check primitive. Same contract as the `canActivate`
   * path but callable from non-HTTP contexts where `:orgId` is not in the
   * URL — controllers handling body-supplied `organizationId`, WebSocket
   * event handlers, scheduled jobs, etc.
   *
   * Mirrors `InstitutionScopeGuard.verifyOwnership` (commit `b2a64c25`)
   * one-to-one — same Prisma lookup shape, same `ForbiddenException` /
   * `NotFoundException` semantics so callers get matching HTTP status
   * codes via Nest's exception filter, same fail-closed-on-Prisma-throw
   * behaviour, same platform-admin bypass.
   */
  async verifyMembership(
    orgId: string,
    userId: string,
    isPlatformAdmin: boolean,
  ): Promise<void> {
    if (isPlatformAdmin) {
      return;
    }

    let member: { organizationId: string } | null;
    try {
      member = await this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: orgId, userId },
        },
        select: { organizationId: true },
      });
    } catch (err) {
      this.logger.error(
        `membership lookup failed org=${orgId} user=${userId}: ${String(err)}`,
      );
      throw new ForbiddenException('organization access check failed');
    }

    if (!member) {
      this.logger.warn(
        `denied: user ${userId} attempted to access org ${orgId}`,
      );
      throw new ForbiddenException('not authorized for this organization');
    }
  }
}
