import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

/**
 * Guard that verifies the authenticated user has access to the requested workspace.
 * Ensures multi-tenant security by checking workspace membership.
 *
 * Expects:
 * - req.user.workspaceIds: string[] — list of workspace IDs the user belongs to
 * - req.params.workspaceId or req.headers['x-workspace-id'] — the target workspace
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  private readonly logger = new Logger(WorkspaceAccessGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const workspaceId =
      request.params?.workspaceId ||
      request.headers['x-workspace-id'] ||
      request.query?.workspaceId;

    if (!workspaceId) {
      // No workspace context — let other guards/logic handle it
      return true;
    }

    // Admin users can access any workspace
    if (user.role === 'admin' || user.isSuperAdmin) {
      return true;
    }

    const userWorkspaces: string[] = user.workspaceIds || [];

    if (!userWorkspaces.includes(workspaceId)) {
      this.logger.warn(
        `User ${user.id} denied access to workspace ${workspaceId}`,
      );
      throw new ForbiddenException('You do not have access to this workspace');
    }

    // Attach the resolved workspace ID to the request for downstream use
    request.workspaceId = workspaceId;
    return true;
  }
}
