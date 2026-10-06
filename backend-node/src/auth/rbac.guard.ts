import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// ─── 9-Role Enterprise RBAC ────────────────────────────────

export enum CerniqRole {
  VIEWER = 'viewer',
  OPERATOR = 'operator',
  BOARD_MEMBER = 'board_member',
  CFO = 'cfo',
  CRO = 'cro',
  COMPLIANCE_OFFICER = 'compliance_officer',
  AUDITOR = 'auditor',
  API_CONSUMER = 'api_consumer',
  SECURITY_ADMIN = 'security_admin',
  RESELLER_ADMIN = 'reseller_admin',
  COSSEC_EXAMINER = 'cossec_examiner',
  BREAKGLASS = 'breakglass',
}

// ─── Permission Matrix ──────────────────────────────────────

const ROLE_PERMISSIONS: Record<string, string[]> = {
  [CerniqRole.VIEWER]: ['read:alm', 'read:reports'],
  [CerniqRole.OPERATOR]: [
    'read:alm',
    'read:reports',
    'write:alm',
    'write:balance_sheet',
    'run:analysis',
  ],
  [CerniqRole.BOARD_MEMBER]: ['read:board_report', 'read:camel'],
  [CerniqRole.CFO]: [
    'read:alm',
    'read:reports',
    'write:alm',
    'write:balance_sheet',
    'run:analysis',
    'run:monte_carlo',
    'read:ftp',
    'read:board_report',
  ],
  [CerniqRole.CRO]: [
    'read:alm',
    'read:reports',
    'write:alm',
    'run:analysis',
    'run:monte_carlo',
    'read:ftp',
    'read:credit_risk',
    'read:var',
    'read:ews',
    'read:audit_trail',
  ],
  [CerniqRole.COMPLIANCE_OFFICER]: [
    'read:alm',
    'read:reports',
    'read:compliance_calendar',
    'read:exam_prep',
    'read:policy',
    'read:repricing_gap',
  ],
  [CerniqRole.AUDITOR]: [
    'read:alm',
    'read:reports',
    'read:audit_trail',
    'read:compliance_calendar',
    'read:exam_prep',
  ],
  [CerniqRole.API_CONSUMER]: [
    'read:alm',
    'write:balance_sheet',
    'run:analysis',
  ],
  [CerniqRole.SECURITY_ADMIN]: [
    'read:alm',
    'read:reports',
    'write:alm',
    'manage:users',
    'manage:settings',
    'read:audit_trail',
  ],
  [CerniqRole.RESELLER_ADMIN]: [
    'read:alm',
    'read:reports',
    'manage:institutions',
    'read:billing',
  ],
  [CerniqRole.COSSEC_EXAMINER]: [
    'read:alm',
    'read:reports',
    'read:exam_prep',
    'read:compliance_calendar',
    'read:network',
  ],
  [CerniqRole.BREAKGLASS]: ['*'], // full access with mandatory logging
};

// ─── Decorator ──────────────────────────────────────────────

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

// ─── Guard ──────────────────────────────────────────────────

@Injectable()
export class RBACGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions decorator, allow (fall through to AuthGuard)
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    if (request.user?.access?.isPlatformAdmin) {
      return true;
    }

    const userRole = request.user?.role ?? CerniqRole.VIEWER;
    const rolePermissions =
      ROLE_PERMISSIONS[userRole] ?? ROLE_PERMISSIONS[CerniqRole.VIEWER];

    // Breakglass has wildcard
    if (rolePermissions.includes('*')) return true;

    const hasPermission = requiredPermissions.every((perm) =>
      rolePermissions.includes(perm),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Role '${userRole}' lacks required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}

// ─── Helper: Check Permission Programmatically ──────────────

export function hasPermission(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
}

export function getRolePermissions(role: string): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function getAllRoles(): Array<{ role: string; permissions: string[] }> {
  return Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
    role,
    permissions,
  }));
}
