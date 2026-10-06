import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

type RequestUserLite = {
  userId?: string;
  email?: string;
  orgId?: string | null;
  authMethod?: 'token' | 'api_key';
  access?: { isPlatformAdmin?: boolean };
};

/**
 * TenantScopeGuard — Multi-tenant data isolation enforcement for ALM/SpendCheck.
 *
 * Resolves tenant into `request.tenantId` (org/workspace id).
 * **Fail-closed:** authenticated `/api/alm*` and `/api/expenses*` require an
 * org context unless the caller is a platform platform admin (`access.isPlatformAdmin`).
 *
 * Exceptions:
 * - Unauthenticated handlers (no `request.user`): pass through (demo/public ALM calculators).
 * - Platform admin bypass (cross-tenant operations).
 * - API keys: resolve org via `x-organization-id` / headers / first path segment after `/api/expenses/`.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  private readonly logger = new Logger(TenantScopeGuard.name);

  /** Paths that MUST carry org context once authenticated */
  private readonly TENANT_REQUIRED_PREFIXES = [
    '/api/alm',
    '/api/expenses',
    '/api/analyst',
  ];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const rawUrl =
      typeof request.originalUrl === 'string'
        ? request.originalUrl
        : (request.url as string | undefined);
    const pathSegment =
      (typeof request.path === 'string' && request.path) ||
      rawUrl.split('?')[0] ||
      '';

    const user = request.user as RequestUserLite | undefined;

    const orgFromPathExpense = this.orgIdFromExpensesPath(pathSegment);
    let orgId: string | null =
      user?.orgId ||
      (request.headers?.['x-organization-id'] as string | undefined) ||
      (request.headers?.['x-klytics-org-id'] as string | undefined) ||
      orgFromPathExpense ||
      null;

    if (typeof orgId === 'string') {
      orgId = orgId.trim() || null;
    }

    request.tenantId = orgId;

    const tenantRouteRequired = this.TENANT_REQUIRED_PREFIXES.some((prefix) =>
      pathSegment.startsWith(prefix),
    );

    if (!tenantRouteRequired) {
      return true;
    }

    if (!user) {
      return true;
    }

    if (user.access?.isPlatformAdmin === true) {
      this.logger.debug({
        event: 'tenant_scope.master_bypass',
        pathSegment,
      });
      return true;
    }

    if (!orgId) {
      const message =
        user.authMethod === 'api_key'
          ? 'Organization context required for this API key request. Provide x-organization-id or use an expense-scoped route with org id.'
          : 'Organization context required. Pass x-organization-id or authenticate with workspace membership.';
      throw new ForbiddenException(message);
    }

    return true;
  }

  /** `/api/expenses/:orgId/...` yields org id segment (not `auto` treated as unresolved). */
  private orgIdFromExpensesPath(pathOnly: string): string | null {
    const trimmed = pathOnly.split('?')[0] || '';
    const match = trimmed.match(/^\/api\/expenses\/([^/?]+)/);
    const segment = match?.[1]?.trim();
    if (!segment || segment === 'auto') {
      return null;
    }
    return segment;
  }
}
