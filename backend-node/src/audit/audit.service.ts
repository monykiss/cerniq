import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface AuditEvent {
  userId?: string;
  institutionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  outcome?: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget audit log entry.
   * NEVER blocks the request — errors are caught and logged.
   */
  log(event: AuditEvent): void {
    this.prisma.auditLog
      .create({
        data: {
          userId: event.userId || null,
          institutionId: event.institutionId || null,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId || null,
          outcome: event.outcome || 'success',
          metadata: event.metadata || null,
          ipAddress: event.ipAddress || null,
          userAgent: event.userAgent || null,
        },
      })
      .then(() => {
        this.logger.debug(
          `Audit: ${event.action} ${event.resource} ${event.resourceId || '(no id)'} by ${event.userId || 'anonymous'}`,
        );
      })
      .catch((err: any) => {
        // Never throw from audit logging
        this.logger.error('Audit log failed:', err.message);
      });
  }

  /**
   * Query audit logs for a specific institution (portal / admin use).
   * Returns logs sorted by createdAt DESC.
   */
  async queryByInstitution(
    institutionId: string,
    opts: { limit?: number; offset?: number; daysBack?: number } = {},
  ) {
    const limit = Math.min(opts.limit || 100, 500);
    const offset = opts.offset || 0;
    const daysBack = opts.daysBack || 90;

    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    return this.prisma.auditLog.findMany({
      where: {
        institutionId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Query audit logs for a specific user (portal use).
   * Returns logs sorted by createdAt DESC.
   */
  async queryByUser(
    userId: string,
    opts: { limit?: number; offset?: number; daysBack?: number } = {},
  ) {
    const limit = Math.min(opts.limit || 100, 500);
    const offset = opts.offset || 0;
    const daysBack = opts.daysBack || 90;

    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    return this.prisma.auditLog.findMany({
      where: {
        userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Admin query: paginated audit logs for an institution (all time).
   */
  async adminQuery(opts: {
    institutionId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(opts.limit || 100, 500);
    const offset = opts.offset || 0;

    const where: any = {};
    if (opts.institutionId) {
      where.institutionId = opts.institutionId;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, limit, offset };
  }
}
