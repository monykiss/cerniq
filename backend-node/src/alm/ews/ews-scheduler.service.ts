import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { EwsSnapshotService } from './ews-snapshot.service';
import { isEwsSchedulerDisabled } from './ews-scheduler-flag.util';

const TZ = 'America/Puerto_Rico';

/**
 * Daily EWS capture (Wave 1, W1.3 — "scheduled recomputation").
 *
 * 06:30 AST, before the 09:00 agent monitors, so the day's snapshot (and any
 * threshold-crossing alerts) exists by the time boards and agents read it.
 * `ScheduleModule.forRoot()` is already mounted in AppModule (the 2026-04-16
 * fix — decorators here actually fire).
 *
 * Failure semantics: per-institution try/catch with an accounting summary —
 * one broken institution never blocks the rest, and the summary log names
 * the failure count instead of swallowing it (no-silent-catch). The daily
 * upsert key makes a manual re-run after a partial failure safe.
 */
@Injectable()
export class EwsSchedulerService {
  private readonly logger = new Logger(EwsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: EwsSnapshotService,
  ) {}

  @Cron('0 30 6 * * *', { name: 'ews-daily-capture', timeZone: TZ })
  async captureDaily(): Promise<void> {
    if (isEwsSchedulerDisabled()) {
      this.logger.log(
        'EWS_SCHEDULER_DISABLED is set — skipping daily EWS capture',
      );
      return;
    }
    await this.captureAll('scheduled');
  }

  /**
   * Capture a snapshot for every institution. Returns the accounting so the
   * cron log (and any manual caller) sees exactly what happened.
   */
  async captureAll(
    source: 'scheduled' | 'manual',
  ): Promise<{ captured: number; failed: number; alertsRaised: number }> {
    const institutions = await this.prisma.institution.findMany({
      select: { id: true },
    });

    let captured = 0;
    let failed = 0;
    let alertsRaised = 0;

    for (const { id } of institutions) {
      try {
        const { alerts } = await this.snapshots.captureSnapshot(id, {
          source,
        });
        captured++;
        alertsRaised += alerts.length;
      } catch (err) {
        failed++;
        this.logger.error({
          event: 'ews_capture_failed',
          institutionId: id,
          error: String(err),
        });
      }
    }

    this.logger.log({
      event: 'ews_daily_capture_complete',
      institutions: institutions.length,
      captured,
      failed,
      alertsRaised,
    });
    return { captured, failed, alertsRaised };
  }
}
