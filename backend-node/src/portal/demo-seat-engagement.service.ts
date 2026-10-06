import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/**
 * Per-touchpoint engagement event log for demo seats.
 *
 * Every meaningful action in a demo seat's lifecycle writes a row here:
 * provisioning, email sends, portal views, report downloads, upgrade
 * clicks, conversion, expiry, reminders. Read paths power the admin
 * timeline UI and future cohort / funnel drop-off analytics.
 *
 * ── Design principles ──
 *
 * 1. **Fire-and-forget writes.** Every `recordEvent` call is non-blocking.
 *    An engagement log failure must NEVER propagate to the caller — it's
 *    observability plumbing, not a correctness-critical path. The service
 *    catches every error and logs a warning so telemetry isn't silent.
 *
 * 2. **Append-only.** Events are never updated or deleted (except via
 *    cascading delete when the parent prospect is removed). This makes
 *    the data structure trivially correct for cohort analytics.
 *
 * 3. **Batched read for lists.** `getSummaryForSeats()` accepts an array
 *    of prospect ids and returns a single aggregated Map — the admin
 *    list view uses one query to annotate dozens of rows.
 *
 * 4. **Typed event names.** The `DemoSeatEventType` union is the source
 *    of truth. Any new touchpoint must extend this union first, giving
 *    us compile-time coverage across the whole codebase.
 */

export type DemoSeatEventType =
  | 'provisioned'
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'portal_viewed'
  | 'report_viewed'
  | 'alco_downloaded'
  | 'upgrade_clicked'
  | 'converted'
  | 'expired'
  | 'reminder_sent';

export interface RecordEventInput {
  readonly prospectInstitutionId: string;
  readonly userId?: string | null;
  readonly eventType: DemoSeatEventType;
  readonly metadata?: Record<string, unknown>;
}

export interface EngagementEvent {
  readonly id: string;
  readonly prospectInstitutionId: string;
  readonly userId: string | null;
  readonly eventType: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface EngagementSummary {
  readonly eventCount: number;
  readonly lastEventType: string | null;
  readonly lastEventAt: string | null;
}

@Injectable()
export class DemoSeatEngagementService {
  private readonly logger = new Logger(DemoSeatEngagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append a new engagement event. Fire-and-forget: the caller never
   * awaits success — this returns immediately and the underlying write
   * happens on the next tick. Any failure is logged and swallowed.
   *
   * Returns the Promise so callers who DO want to await (e.g. tests)
   * can opt in via `await`.
   */
  recordEvent(input: RecordEventInput): Promise<void> {
    const promise = this.prisma.demoSeatEngagementEvent
      .create({
        data: {
          prospectInstitutionId: input.prospectInstitutionId,
          userId: input.userId ?? null,
          eventType: input.eventType,
          metadata: (input.metadata ?? null) as any,
        },
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        this.logger.warn({
          event: 'portal.engagement_record_failed',
          eventType: input.eventType,
          prospectInstitutionId: input.prospectInstitutionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Attach an always-resolving tail so unhandled rejection linters stay
    // quiet even when callers don't await.
    void promise;
    return promise;
  }

  /**
   * List recent engagement events for a single prospect, newest first.
   * Used by the admin timeline UI and per-seat debugging.
   */
  async listEventsForProspect(
    prospectInstitutionId: string,
    limit = 50,
  ): Promise<EngagementEvent[]> {
    const rows = await this.prisma.demoSeatEngagementEvent.findMany({
      where: { prospectInstitutionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row: any) => ({
      id: row.id,
      prospectInstitutionId: row.prospectInstitutionId,
      userId: row.userId,
      eventType: row.eventType,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Batched summary for admin list views.
   *
   * Given an array of prospect ids, returns a Map<id, summary> with
   * the event count, latest event type, and latest event timestamp
   * for each. Empty map entries for prospects with no events.
   *
   * Uses groupBy + a single findMany to keep the total queries to 2
   * regardless of batch size.
   */
  async getSummaryForSeats(
    prospectInstitutionIds: string[],
  ): Promise<Map<string, EngagementSummary>> {
    if (prospectInstitutionIds.length === 0) {
      return new Map();
    }

    const [counts, latestRaw] = (await Promise.all([
      this.prisma.demoSeatEngagementEvent.groupBy({
        by: ['prospectInstitutionId'],
        where: { prospectInstitutionId: { in: prospectInstitutionIds } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw(Prisma.sql`
        SELECT DISTINCT ON (prospect_institution_id)
          prospect_institution_id,
          event_type,
          created_at
        FROM demo_seat_engagement_events
        WHERE prospect_institution_id = ANY(${prospectInstitutionIds}::text[])
        ORDER BY prospect_institution_id, created_at DESC
      `),
    ])) as [
      Array<{
        prospectInstitutionId: string;
        _count: { _all: number };
      }>,
      Array<{
        prospect_institution_id: string;
        event_type: string;
        created_at: Date;
      }>,
    ];

    const countMap = new Map<string, number>();
    for (const row of counts) {
      countMap.set(row.prospectInstitutionId, row._count._all);
    }

    const latestMap = new Map<string, { eventType: string; createdAt: Date }>();
    for (const row of latestRaw) {
      latestMap.set(row.prospect_institution_id, {
        eventType: row.event_type,
        createdAt: row.created_at,
      });
    }

    const result = new Map<string, EngagementSummary>();
    for (const id of prospectInstitutionIds) {
      const latest = latestMap.get(id);
      result.set(id, {
        eventCount: countMap.get(id) ?? 0,
        lastEventType: latest?.eventType ?? null,
        lastEventAt: latest?.createdAt.toISOString() ?? null,
      });
    }
    return result;
  }
}
