import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { timingSafeStringEqual } from '../utils/timing-safe-compare';

/**
 * Paths where the request has no JWT user and no admin key but still needs
 * to write to RLS-protected tables (report_jobs, audit_logs, etc.). The
 * handlers themselves enforce their own auth (Stripe signature, cron-job
 * secret, etc.); this middleware only sets the GUC so the DB-layer RLS
 * doesn't block writes the handler has already authorized.
 *
 * Keep this list narrow. Every entry effectively bypasses tenant-isolation
 * for the whole request, so handlers MUST validate signature / secret
 * before doing any DB work.
 */
const SERVICE_BYPASS_PATH_PREFIXES = [
  '/api/billing/webhook', // Stripe signature-verified
  '/api/stripe/webhook', // alternate Stripe mount
];

/**
 * Row-Level Security (RLS) Tenant Context Middleware
 *
 * Sets PostgreSQL session variables that RLS policies evaluate:
 *
 *   app.current_institution_id — scopes all institution-bearing tables to the
 *   authenticated user's institution. Uses SET LOCAL so the value is
 *   automatically cleared at transaction end (commit / rollback).
 *
 *   app.admin_mode — allows admin endpoints (identified by the x-admin-key
 *   header) to bypass tenant isolation for cross-tenant operations.
 *
 * SECURITY NOTES:
 *   - Uses parameterized $executeRaw (tagged template) to prevent SQL injection.
 *   - Unauthenticated requests pass through without setting any GUC variables,
 *     so RLS policies default to blocking all rows.
 *   - The middleware runs AFTER JWT verification (applied on authenticated routes).
 *   - Service-level entrypoints (Stripe webhooks) bypass tenant isolation
 *     because they have no authenticated user and need to write to
 *     institution-scoped tables after their own signature check.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('TenantContextMiddleware');

  constructor(private readonly prisma: PrismaService) {}

  async use(req: any, _res: any, next: () => void): Promise<void> {
    const adminKey = req.headers?.['x-admin-key'] as string | undefined;
    const expectedAdminKey = process.env.ADMIN_KEY;

    // Admin route: set admin_mode so RLS admin_bypass policies grant access.
    // Only activates when the presented key constant-time matches the
    // configured ADMIN_KEY. A presence-only check here would let any request
    // with a garbage `x-admin-key: anything` header trip admin_bypass RLS
    // policies and see rows across every tenant.
    if (
      adminKey &&
      expectedAdminKey &&
      timingSafeStringEqual(adminKey, expectedAdminKey)
    ) {
      try {
        await this.prisma.$executeRaw`SET LOCAL app.admin_mode = 'true'`;
        this.logger.debug('RLS admin_mode set for admin request');
      } catch (err) {
        this.logger.error('Failed to set RLS admin_mode', (err as Error).stack);
      }
      next();
      return;
    }

    // Service bypass: webhook/cron entrypoints that self-authorize via
    // signature/secret before writing to institution-scoped tables.
    const requestPath = (req.path || req.url || '') as string;
    const isServiceBypass = SERVICE_BYPASS_PATH_PREFIXES.some((prefix) =>
      requestPath.startsWith(prefix),
    );
    if (isServiceBypass) {
      try {
        await this.prisma.$executeRaw`SET LOCAL app.admin_mode = 'true'`;
        this.logger.debug({ path: requestPath }, 'RLS service bypass set');
      } catch (err) {
        this.logger.error(
          'Failed to set RLS service bypass',
          (err as Error).stack,
        );
      }
      next();
      return;
    }

    // Authenticated request: set tenant context from JWT-decoded user
    const user = req.user as { institutionId?: string } | undefined;
    const institutionId = user?.institutionId;

    if (institutionId) {
      try {
        await this.prisma
          .$executeRaw`SET LOCAL app.current_institution_id = ${institutionId}`;
        this.logger.debug(
          { institutionId },
          'RLS tenant context set for request',
        );
      } catch (err) {
        this.logger.error(
          'Failed to set RLS tenant context',
          (err as Error).stack,
        );
      }
    }

    next();
  }
}
