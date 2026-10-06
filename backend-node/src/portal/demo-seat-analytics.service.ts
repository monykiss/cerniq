import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * Funnel metrics for the CERNIQ demo-seat sales pipeline.
 *
 * This service is strictly read-only — it never writes to any table.
 * Every metric is derived from existing ProspectInstitution columns
 * populated elsewhere (provisioning in DemoSeatService, conversion in
 * BillingService.closeConvertedDemoProspect, engagement in the portal
 * streaming endpoint via markViewed).
 *
 * Why aggregate here instead of in the frontend?
 *   1. A single DB round-trip to Prisma is cheaper than shipping the
 *      whole prospect table to the browser and aggregating client-side.
 *   2. Keeps the admin dashboard oblivious to schema shape — the next
 *      schema refinement doesn't require a coordinated UI release.
 *   3. Unit-testable without Playwright or a browser.
 *
 * The shape is deliberately flat — no nested objects beyond the
 * revenue breakdown — so the admin page can dump the whole response
 * into a MetricStrip with zero transformation.
 */
@Injectable()
export class DemoSeatAnalyticsService {
  private readonly logger = new Logger(DemoSeatAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(now: Date = new Date()): Promise<DemoSeatAnalytics> {
    // Run every count in parallel — all are narrow Prisma counts over the
    // same table, so Postgres can plan them concurrently.
    const [
      totalProvisioned,
      active,
      expired,
      convertedAll,
      convertedThisMonth,
      viewedAtLeastOnce,
      provisionedLast7Days,
      convertedLast7Days,
      revenueAllTime,
      revenueThisMonth,
      avgDaysToConvertResult,
      topSnapshots,
    ] = await Promise.all([
      this.prisma.prospectInstitution.count({
        where: { demoUserId: { not: null } },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoUserId: { not: null },
          demoExpiresAt: { gte: now },
          demoConvertedAt: null,
        },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoUserId: { not: null },
          demoExpiresAt: { lt: now },
          demoConvertedAt: null,
        },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoUserId: { not: null },
          demoConvertedAt: { not: null },
        },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoConvertedAt: { gte: firstOfMonth(now) },
        },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoUserId: { not: null },
          demoLastViewedAt: { not: null },
        },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoProvisionedAt: { gte: daysAgo(now, 7) },
        },
      }),
      this.prisma.prospectInstitution.count({
        where: {
          demoConvertedAt: { gte: daysAgo(now, 7) },
        },
      }),
      this.prisma.prospectInstitution.aggregate({
        where: { demoConvertedAt: { not: null } },
        _sum: { demoConvertedAmountUsd: true },
      }),
      this.prisma.prospectInstitution.aggregate({
        where: { demoConvertedAt: { gte: firstOfMonth(now) } },
        _sum: { demoConvertedAmountUsd: true },
      }),
      this.computeAvgDaysToConvert(),
      this.computeTopConvertingSnapshots(),
    ]);

    const conversionRate =
      totalProvisioned > 0 ? (convertedAll / totalProvisioned) * 100 : 0;
    const viewRate =
      totalProvisioned > 0 ? (viewedAtLeastOnce / totalProvisioned) * 100 : 0;

    return {
      generatedAt: now.toISOString(),
      totals: {
        provisioned: totalProvisioned,
        active,
        expired,
        converted: convertedAll,
        viewedAtLeastOnce,
      },
      rates: {
        conversionRatePct: round(conversionRate, 1),
        viewRatePct: round(viewRate, 1),
      },
      revenue: {
        allTimeUsd: toNumber(revenueAllTime._sum.demoConvertedAmountUsd),
        thisMonthUsd: toNumber(revenueThisMonth._sum.demoConvertedAmountUsd),
      },
      velocity: {
        provisionedLast7Days,
        convertedLast7Days,
        avgDaysToConvert: avgDaysToConvertResult,
      },
      thisMonthConverted: convertedThisMonth,
      topConvertingSnapshots: topSnapshots,
    };
  }

  // ─── Private aggregations ───────────────────────────────────

  /**
   * Average days from provisioning → conversion across all converted seats.
   *
   * Uses Prisma's raw findMany (only converted rows) + arithmetic mean.
   * We don't use `aggregate` because Postgres can't directly subtract
   * two timestamp columns into days via Prisma's aggregate API without a
   * raw query, and the row count is always small (converted seats are
   * much rarer than provisioned ones).
   */
  private async computeAvgDaysToConvert(): Promise<number | null> {
    const rows: Array<{
      demoProvisionedAt: Date | null;
      demoConvertedAt: Date | null;
    }> = await this.prisma.prospectInstitution.findMany({
      where: {
        demoConvertedAt: { not: null },
        demoProvisionedAt: { not: null },
      },
      select: {
        demoProvisionedAt: true,
        demoConvertedAt: true,
      },
    });

    if (rows.length === 0) return null;

    const totalMs = rows.reduce<number>((sum, row) => {
      if (!row.demoProvisionedAt || !row.demoConvertedAt) return sum;
      return (
        sum + (row.demoConvertedAt.getTime() - row.demoProvisionedAt.getTime())
      );
    }, 0);

    const avgMs = totalMs / rows.length;
    return round(avgMs / 86400000, 1);
  }

  /**
   * Top 5 COSSEC / NCUA snapshots ranked by converted revenue attributed
   * to them. Used on the admin dashboard to show "which cooperativas are
   * actually buying" — guides the next quarter's snapshot refresh priority.
   */
  private async computeTopConvertingSnapshots(): Promise<
    Array<{
      identifier: string;
      source: string;
      converted: number;
      revenueUsd: number;
    }>
  > {
    // Prisma groupBy + aggregate returns a narrow generic that TS 5 sometimes
    // widens to unknown in the `.map` callback. We annotate the row shape
    // explicitly so noImplicitAny stays happy regardless of Prisma version.
    type GroupRow = {
      publicDataIdentifier: string | null;
      publicDataSource: string | null;
      _count: { _all: number };
      _sum: { demoConvertedAmountUsd: unknown };
    };
    const rows = (await this.prisma.prospectInstitution.groupBy({
      by: ['publicDataIdentifier', 'publicDataSource'],
      where: {
        demoConvertedAt: { not: null },
        publicDataIdentifier: { not: null },
      },
      _count: { _all: true },
      _sum: { demoConvertedAmountUsd: true },
      orderBy: { _sum: { demoConvertedAmountUsd: 'desc' } },
      take: 5,
    })) as unknown as GroupRow[];

    return rows.map((row: GroupRow) => ({
      identifier: row.publicDataIdentifier || 'unknown',
      source: row.publicDataSource || 'unknown',
      converted: row._count._all,
      revenueUsd: toNumber(row._sum.demoConvertedAmountUsd),
    }));
  }
}

export interface DemoSeatAnalytics {
  generatedAt: string;
  totals: {
    provisioned: number;
    active: number;
    expired: number;
    converted: number;
    viewedAtLeastOnce: number;
  };
  rates: {
    conversionRatePct: number;
    viewRatePct: number;
  };
  revenue: {
    allTimeUsd: number;
    thisMonthUsd: number;
  };
  velocity: {
    provisionedLast7Days: number;
    convertedLast7Days: number;
    avgDaysToConvert: number | null;
  };
  thisMonthConverted: number;
  topConvertingSnapshots: Array<{
    identifier: string;
    source: string;
    converted: number;
    revenueUsd: number;
  }>;
}

// ─── Small helpers ──────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function toNumber(decimalValue: unknown): number {
  if (decimalValue === null || decimalValue === undefined) return 0;
  // Prisma Decimal has .toNumber(); fall back to Number() for plain values.
  const asDecimal = decimalValue as { toNumber?: () => number };
  if (typeof asDecimal.toNumber === 'function') {
    return asDecimal.toNumber();
  }
  return Number(decimalValue) || 0;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86400000);
}

function firstOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
