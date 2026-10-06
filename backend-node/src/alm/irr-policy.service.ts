import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Types ───────────────────────────────────────────────────

export interface PolicyLimitConfig {
  id?: string;
  limitType: string;
  scenario: string;
  watchPct: number;
  warningPct: number;
  breachPct: number;
  regulatoryRef: string;
}

export interface PolicyCheckResult {
  limitType: string;
  scenario: string;
  actualValue: number;
  watchPct: number;
  warningPct: number;
  breachPct: number;
  level: 'COMPLIANT' | 'WATCH' | 'WARNING' | 'BREACH';
  utilizationPct: number;
  regulatoryRef: string;
}

export interface PolicyDashboard {
  checks: PolicyCheckResult[];
  breachCount: number;
  warningCount: number;
  watchCount: number;
  overallStatus: 'GREEN' | 'AMBER' | 'RED';
  lastChecked: string;
}

const DEFAULT_LIMITS: PolicyLimitConfig[] = [
  {
    limitType: 'EVE_PCT',
    scenario: '+200bps',
    watchPct: 12,
    warningPct: 18,
    breachPct: 25,
    regulatoryRef: 'Basel IRRBB — EVE outlier test',
  },
  {
    limitType: 'EVE_PCT',
    scenario: '-200bps',
    watchPct: 12,
    warningPct: 18,
    breachPct: 25,
    regulatoryRef: 'Basel IRRBB — EVE outlier test',
  },
  {
    limitType: 'NII_AT_RISK',
    scenario: '+200bps',
    watchPct: 10,
    warningPct: 15,
    breachPct: 20,
    regulatoryRef: 'OCIF CC-2022-03 §IV.A — NII Sensitivity',
  },
  {
    limitType: 'NII_AT_RISK',
    scenario: '-100bps',
    watchPct: 8,
    warningPct: 12,
    breachPct: 15,
    regulatoryRef: 'OCIF CC-2022-03 §IV.A — NII Sensitivity',
  },
  {
    limitType: 'DURATION_GAP',
    scenario: 'base',
    watchPct: 2.5,
    warningPct: 3.5,
    breachPct: 5.0,
    regulatoryRef: 'COSSEC Examen Art. 7.3 — Duration Gap',
  },
  {
    limitType: 'REPRICING_GAP',
    scenario: '0-90d',
    watchPct: 15,
    warningPct: 20,
    breachPct: 25,
    regulatoryRef: 'OCIF CC-2022-03 §IV.B — Repricing Gap',
  },
];

@Injectable()
export class IRRPolicyService {
  private readonly logger = new Logger(IRRPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Get / Set Policy Limits ──────────────────────────────

  async getLimits(institutionId: string): Promise<PolicyLimitConfig[]> {
    const limits = await this.prisma.iRRPolicyLimit.findMany({
      where: { institutionId },
    });
    if (limits.length > 0) return limits;
    return DEFAULT_LIMITS; // demo fallback
  }

  async saveLimits(
    institutionId: string,
    limits: PolicyLimitConfig[],
  ): Promise<{ saved: number }> {
    await this.prisma.iRRPolicyLimit.deleteMany({ where: { institutionId } });
    const created = await this.prisma.iRRPolicyLimit.createMany({
      data: limits.map((l) => ({
        institutionId,
        limitType: l.limitType,
        scenario: l.scenario,
        watchPct: l.watchPct,
        warningPct: l.warningPct,
        breachPct: l.breachPct,
        regulatoryRef: l.regulatoryRef,
      })),
    });
    return { saved: created.count };
  }

  // ─── Check All Limits ─────────────────────────────────────

  async checkAll(institutionId: string): Promise<PolicyDashboard> {
    const limits = await this.getLimits(institutionId);
    const metrics = await this.getCurrentMetrics(institutionId);

    const checks: PolicyCheckResult[] = limits.map((limit) => {
      const actual = this.getActualForLimit(limit, metrics);
      const absActual = Math.abs(actual);
      let level: PolicyCheckResult['level'] = 'COMPLIANT';
      if (absActual >= limit.breachPct) level = 'BREACH';
      else if (absActual >= limit.warningPct) level = 'WARNING';
      else if (absActual >= limit.watchPct) level = 'WATCH';

      const utilization =
        limit.breachPct > 0 ? (absActual / limit.breachPct) * 100 : 0;

      return {
        limitType: limit.limitType,
        scenario: limit.scenario,
        actualValue: actual,
        watchPct: limit.watchPct,
        warningPct: limit.warningPct,
        breachPct: limit.breachPct,
        level,
        utilizationPct: Math.round(utilization * 10) / 10,
        regulatoryRef: limit.regulatoryRef,
      };
    });

    // Log breaches
    const breaches = checks.filter(
      (c) => c.level === 'BREACH' || c.level === 'WARNING',
    );
    for (const breach of breaches) {
      await this.logBreach(institutionId, breach);
    }

    const breachCount = checks.filter((c) => c.level === 'BREACH').length;
    const warningCount = checks.filter((c) => c.level === 'WARNING').length;
    const watchCount = checks.filter((c) => c.level === 'WATCH').length;

    return {
      checks,
      breachCount,
      warningCount,
      watchCount,
      overallStatus:
        breachCount > 0 ? 'RED' : warningCount > 0 ? 'AMBER' : 'GREEN',
      lastChecked: new Date().toISOString(),
    };
  }

  // ─── Breach History ───────────────────────────────────────

  async getBreachHistory(institutionId: string, limit?: number) {
    return this.prisma.policyBreachLog.findMany({
      where: { institutionId },
      orderBy: { detectedAt: 'desc' },
      take: limit ?? 50,
    });
  }

  // ─── Private ──────────────────────────────────────────────

  private async getCurrentMetrics(
    institutionId: string,
  ): Promise<Record<string, number>> {
    // Pull latest analysis data
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    if (items.length === 0) {
      return {
        'EVE_PCT:+200bps': -15.2,
        'EVE_PCT:-200bps': 12.8,
        'NII_AT_RISK:+200bps': 11.5,
        'NII_AT_RISK:-100bps': -8.2,
        'DURATION_GAP:base': 2.1,
        'REPRICING_GAP:0-90d': 12.5,
      };
    }

    // Compute actual metrics from balance sheet
    const totalAssets = items
      .filter((i: any) => i.category === 'asset')
      .reduce((s: number, i: any) => s + Number(i.balance), 0);
    const assetDuration =
      items
        .filter((i: any) => i.category === 'asset')
        .reduce((s: number, i: any) => s + i.balance * i.duration, 0) /
      (totalAssets || 1);
    const liabDuration =
      items
        .filter((i: any) => i.category === 'liability')
        .reduce((s: number, i: any) => s + i.balance * i.duration, 0) /
      (items
        .filter((i: any) => i.category === 'liability')
        .reduce((s: number, i: any) => s + Number(i.balance), 0) || 1);
    const durationGap = assetDuration - liabDuration;

    // Simplified EVE/NII estimates
    const eve200up = ((-durationGap * totalAssets * 0.02) / totalAssets) * 100;
    const eve200down = ((durationGap * totalAssets * 0.02) / totalAssets) * 100;

    return {
      'EVE_PCT:+200bps': eve200up,
      'EVE_PCT:-200bps': eve200down,
      'NII_AT_RISK:+200bps': durationGap * 5.5,
      'NII_AT_RISK:-100bps': -durationGap * 2.8,
      'DURATION_GAP:base': durationGap,
      'REPRICING_GAP:0-90d': 12.5, // placeholder
    };
  }

  private getActualForLimit(
    limit: PolicyLimitConfig,
    metrics: Record<string, number>,
  ): number {
    const key = `${limit.limitType}:${limit.scenario}`;
    return metrics[key] ?? 0;
  }

  private async logBreach(institutionId: string, check: PolicyCheckResult) {
    // Only log if not already logged in last 24h for same type
    const recent = await this.prisma.policyBreachLog.findFirst({
      where: {
        institutionId,
        limitType: check.limitType,
        detectedAt: { gte: new Date(Date.now() - 86400000) },
      },
    });
    if (recent) return;

    await this.prisma.policyBreachLog.create({
      data: {
        institutionId,
        limitType: check.limitType,
        breachLevel: check.level,
        actualValue: check.actualValue,
        limitValue: check.breachPct,
      },
    });
  }
}
