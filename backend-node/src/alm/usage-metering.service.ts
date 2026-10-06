import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Metering Tiers ─────────────────────────────────────────

const TIER_LIMITS: Record<string, Record<string, number>> = {
  bronze: { compute_job: 50, api_call: 5000, report_generated: 10, seat: 3 },
  silver: { compute_job: 100, api_call: 10000, report_generated: 20, seat: 5 },
  gold: { compute_job: 500, api_call: 50000, report_generated: 100, seat: 15 },
};

const OVERAGE_RATES: Record<string, number> = {
  compute_job: 0.5, // $0.50 per job
  api_call: 0.005, // $0.005 per call
  report_generated: 5.0, // $5 per report
  seat: 150.0, // $150 per seat/month
};

// ─── Types ───────────────────────────────────────────────────

export interface UsageSummary {
  institutionId: string;
  period: string; // "2026-03"
  tier: string;
  usage: Record<
    string,
    { used: number; included: number; overage: number; overageCost: number }
  >;
  totalOverageCost: number;
}

@Injectable()
export class UsageMeteringService {
  private readonly logger = new Logger(UsageMeteringService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Record Usage Event ───────────────────────────────────

  async recordEvent(
    institutionId: string,
    eventType: string,
    quantity: number = 1,
    metadata?: any,
  ) {
    return this.prisma.usageMeterEvent.create({
      data: { institutionId, eventType, quantity, metadata },
    });
  }

  // ─── Get Monthly Usage Summary ────────────────────────────

  async getUsageSummary(
    institutionId: string,
    month?: string,
  ): Promise<UsageSummary> {
    const now = new Date();
    const period =
      month ??
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, mo] = period.split('-').map(Number);
    const startDate = new Date(year, mo - 1, 1);
    const endDate = new Date(year, mo, 1);

    // Get subscription tier
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      include: {
        workspace: { include: { owner: { include: { subscription: true } } } },
      },
    });
    const tier = (institution?.workspace?.owner?.subscription?.tier ??
      'silver') as string;
    const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.silver;

    // Count events by type
    const events = await this.prisma.usageMeterEvent.groupBy({
      by: ['eventType'],
      where: {
        institutionId,
        createdAt: { gte: startDate, lt: endDate },
      },
      _sum: { quantity: true },
    });

    const usage: UsageSummary['usage'] = {};
    let totalOverageCost = 0;

    for (const eventType of Object.keys(limits)) {
      const used =
        events.find((e: any) => e.eventType === eventType)?._sum?.quantity ?? 0;
      const included = limits[eventType];
      const overage = Math.max(0, used - included);
      const overageCost = overage * (OVERAGE_RATES[eventType] ?? 0);
      totalOverageCost += overageCost;

      usage[eventType] = {
        used,
        included,
        overage,
        overageCost: Math.round(overageCost * 100) / 100,
      };
    }

    return {
      institutionId,
      period,
      tier,
      usage,
      totalOverageCost: Math.round(totalOverageCost * 100) / 100,
    };
  }
}
