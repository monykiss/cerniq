import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { DemoSeatService } from './demo-seat.service';

/**
 * Hourly sweep that expires demo-seat subscriptions past their TTL.
 *
 * Scheduling note: we run at minute 5 of every hour to avoid colliding
 * with the pipeline worker's every-2-minute processQueue tick. This keeps
 * DB load evenly distributed and makes the sweep observable in logs.
 *
 * Idempotence: `DemoSeatService.sweepExpired()` is safe to run multiple
 * times concurrently; it's a narrow findMany + conditional update per
 * seat. Paid subscriptions are invisible to the query.
 *
 * Failure behavior: if the sweep throws (DB down, Prisma error, etc.),
 * the scheduler logs the error, reports it to Sentry with a structured
 * `portal.demo_seat_sweep_failed` tag, and retries on the next tick.
 * Demo seats that SHOULD have expired remain in the 'active' status
 * until the next successful sweep — the platform access service still
 * rejects them at request time because it re-checks currentPeriodEnd
 * on every call. The @Cron handler never throws — an uncaught rejection
 * would kill the NestJS scheduler for the whole process.
 */
@Injectable()
export class DemoSeatSweeper {
  private readonly logger = new Logger(DemoSeatSweeper.name);

  constructor(private readonly demoSeats: DemoSeatService) {}

  @Cron('5 * * * *') // Every hour at minute 5
  async runHourly() {
    try {
      const result = await this.demoSeats.sweepExpired();
      if (result.expired > 0) {
        this.logger.log({
          event: 'portal.demo_seat_sweep',
          scanned: result.scanned,
          expired: result.expired,
          expiredIds: result.expiredIds,
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Demo seat sweep failed: ${err?.message || err}`,
        err?.stack,
      );
      // Escalate to Sentry with structured context so on-call gets paged.
      // We wrap the capture in a try/catch-shaped scope config because the
      // cron MUST NOT throw — Sentry failures should never bubble.
      try {
        Sentry.withScope((scope) => {
          scope.setTag('component', 'portal.demo_seat_sweeper');
          scope.setTag('cron', 'hourly');
          scope.setContext('sweeper', {
            cronExpression: '5 * * * *',
            event: 'portal.demo_seat_sweep_failed',
          });
          scope.setLevel('error');
          Sentry.captureException(err);
        });
      } catch {
        // Sentry unavailable or mis-configured — already logged above
      }
    }
  }

  /**
   * Daily T-3 expiry reminder batch. Runs at 14:00 UTC (9 AM AST) — the
   * time CFOs are most likely to be at their desks and actually open email.
   *
   * Scans for seats whose TTL falls in the 48–96h window from now, sends
   * each a bilingual "your analysis expires soon" email, records the send
   * in the EmailSequence table so we don't double-send, and audit-logs the
   * reminder. Same Sentry-on-failure pattern as the hourly sweep.
   */
  @Cron('0 14 * * *') // Daily at 14:00 UTC
  async runDailyReminders() {
    try {
      const result = await this.demoSeats.sendExpiryReminders();
      if (result.sent > 0) {
        this.logger.log({
          event: 'portal.demo_seat_reminder_sweep',
          scanned: result.scanned,
          sent: result.sent,
          skipped: result.skipped,
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Demo seat reminder batch failed: ${err?.message || err}`,
        err?.stack,
      );
      try {
        Sentry.withScope((scope) => {
          scope.setTag('component', 'portal.demo_seat_sweeper');
          scope.setTag('cron', 'daily_reminder');
          scope.setContext('sweeper', {
            cronExpression: '0 14 * * *',
            event: 'portal.demo_seat_reminder_failed',
          });
          scope.setLevel('error');
          Sentry.captureException(err);
        });
      } catch {
        // ignore
      }
    }
  }
}
