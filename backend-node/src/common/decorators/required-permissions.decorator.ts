import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Permission-based access control decorator.
 * Marks a route handler with the permissions required to access it.
 * Used with a PermissionsGuard to enforce RBAC/ABAC policies.
 *
 * @example
 * @RequiredPermissions('portfolio:read', 'portfolio:write')
 * @UseGuards(AuthGuard, PermissionsGuard)
 * @Post('rebalance')
 * rebalance() { ... }
 */
export const RequiredPermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Convenience constants for common permission strings.
 */
export const Permissions = {
  // Portfolio
  PORTFOLIO_READ: 'portfolio:read',
  PORTFOLIO_WRITE: 'portfolio:write',
  PORTFOLIO_DELETE: 'portfolio:delete',

  // Reports
  REPORT_READ: 'report:read',
  REPORT_GENERATE: 'report:generate',
  REPORT_EXPORT: 'report:export',

  // Admin
  ADMIN_USERS: 'admin:users',
  ADMIN_BILLING: 'admin:billing',
  ADMIN_SETTINGS: 'admin:settings',

  // Risk
  RISK_READ: 'risk:read',
  RISK_CONFIGURE: 'risk:configure',

  // Compliance
  COMPLIANCE_READ: 'compliance:read',
  COMPLIANCE_MANAGE: 'compliance:manage',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];
