import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * Enterprise data retention policy.
 * Cleans up old data according to configurable retention periods.
 * Designed to run as a daily cron job.
 *
 * Retention periods (configurable via env vars):
 * - Audit logs: 2555 days (7 years — matches security page claim, COSSEC compliance)
 * - Demo requests: 90 days
 * - Analysis runs: 180 days
 * - Ingestion logs: 90 days
 *
 * FAANG Audit FA-06: Security claims must match code. The security page
 * advertises 7-year audit log retention. This default enforces it.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runRetentionPolicy(): Promise<{
    auditLogs: number;
    demoRequests: number;
    analysisRuns: number;
    ingestionLogs: number;
  }> {
    const now = new Date();
    const results = {
      auditLogs: 0,
      demoRequests: 0,
      analysisRuns: 0,
      ingestionLogs: 0,
    };

    const retentionDays = {
      auditLogs: parseInt(process.env.RETENTION_AUDIT_LOGS_DAYS || '2555', 10),
      demoRequests: parseInt(
        process.env.RETENTION_DEMO_REQUESTS_DAYS || '90',
        10,
      ),
      analysisRuns: parseInt(
        process.env.RETENTION_ANALYSIS_RUNS_DAYS || '180',
        10,
      ),
      ingestionLogs: parseInt(
        process.env.RETENTION_INGESTION_LOGS_DAYS || '90',
        10,
      ),
    };

    // Audit logs — keep for compliance period
    try {
      const cutoff = new Date(
        now.getTime() - retentionDays.auditLogs * 86_400_000,
      );
      const deleted = await this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      results.auditLogs = deleted.count;
      if (deleted.count > 0) {
        this.logger.log(
          `Purged ${deleted.count} audit logs older than ${retentionDays.auditLogs} days`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Audit log retention failed: ${e.message}`);
    }

    // Demo requests
    try {
      const cutoff = new Date(
        now.getTime() - retentionDays.demoRequests * 86_400_000,
      );
      const deleted = await this.prisma.demoRequest.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      results.demoRequests = deleted.count;
      if (deleted.count > 0) {
        this.logger.log(
          `Purged ${deleted.count} demo requests older than ${retentionDays.demoRequests} days`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Demo request retention failed: ${e.message}`);
    }

    // Analysis runs
    try {
      const cutoff = new Date(
        now.getTime() - retentionDays.analysisRuns * 86_400_000,
      );
      const deleted = await this.prisma.analysisRun.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      results.analysisRuns = deleted.count;
      if (deleted.count > 0) {
        this.logger.log(
          `Purged ${deleted.count} analysis runs older than ${retentionDays.analysisRuns} days`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Analysis run retention failed: ${e.message}`);
    }

    // Ingestion logs
    try {
      const cutoff = new Date(
        now.getTime() - retentionDays.ingestionLogs * 86_400_000,
      );
      const deleted = await this.prisma.ingestionLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      results.ingestionLogs = deleted.count;
      if (deleted.count > 0) {
        this.logger.log(
          `Purged ${deleted.count} ingestion logs older than ${retentionDays.ingestionLogs} days`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Ingestion log retention failed: ${e.message}`);
    }

    return results;
  }
}
