import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to specific user roles.
 * Usage: @Roles('admin', 'analyst') on any controller method.
 * Requires RolesGuard to be active in the module.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
