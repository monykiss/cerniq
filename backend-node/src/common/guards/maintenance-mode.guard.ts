import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeStringEqual } from '../utils/timing-safe-compare';

/**
 * Enterprise maintenance mode guard.
 * When MAINTENANCE_MODE=true, returns 503 on all non-health endpoints.
 * Allows zero-downtime maintenance windows without taking down the load balancer.
 *
 * Usage: Set MAINTENANCE_MODE=true in Railway env vars during maintenance.
 * Health endpoints (/health, /ready) remain available for monitoring.
 */
@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const isMaintenanceMode =
      (process.env.MAINTENANCE_MODE || '').toLowerCase() === 'true';

    if (!isMaintenanceMode) return true;

    const request = context.switchToHttp().getRequest();
    const url = request.url;

    // Always allow health checks during maintenance
    if (url === '/health' || url === '/ready' || url === '/health/detailed') {
      return true;
    }

    // Allow admin endpoints for managing maintenance
    const adminKey = request.headers['x-admin-key'];
    const expectedKey = process.env.ADMIN_KEY;
    if (
      adminKey &&
      expectedKey &&
      timingSafeStringEqual(adminKey, expectedKey)
    ) {
      return true;
    }

    throw new ServiceUnavailableException({
      success: false,
      error: {
        code: 'MAINTENANCE',
        message:
          'CERNIQ is currently undergoing scheduled maintenance. Please try again shortly.',
        estimatedDowntime: process.env.MAINTENANCE_ETA || 'Unknown',
      },
    });
  }
}
