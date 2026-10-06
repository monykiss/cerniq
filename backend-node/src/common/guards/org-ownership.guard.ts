import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

/**
 * Organization ownership guard.
 * Ensures the authenticated user belongs to the organization
 * referenced in the route parameter :orgId.
 * Prevents cross-tenant data access in multi-tenant architecture.
 */
@Injectable()
export class OrgOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(OrgOwnershipGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const routeOrgId =
      request.params?.orgId ||
      request.params?.organizationId ||
      request.body?.organizationId;

    if (!routeOrgId) {
      // No org ID in route - allow (other guards handle authorization)
      return true;
    }

    const userOrgId = user.organizationId || user.orgId;

    if (!userOrgId) {
      this.logger.warn(`User ${user.id} has no organization assignment`);
      throw new ForbiddenException('User is not assigned to any organization');
    }

    if (userOrgId !== routeOrgId) {
      this.logger.warn(
        `Cross-tenant access attempt: user ${user.id} (org ${userOrgId}) tried to access org ${routeOrgId}`,
      );
      throw new ForbiddenException('Access denied to this organization');
    }

    return true;
  }
}
