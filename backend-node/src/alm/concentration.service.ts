import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { ConcentrationLimit } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ─── Default Policy Limits ──────────────────────────────────

const DEFAULT_LIMITS: Record<string, { maxPct: number; type: string }> = {
  'Commercial RE': { maxPct: 0.3, type: 'sector' },
  'Residential Mortgage': { maxPct: 0.35, type: 'sector' },
  'Consumer Loans': { maxPct: 0.25, type: 'sector' },
  'Auto Loans': { maxPct: 0.15, type: 'sector' },
  'Credit Cards': { maxPct: 0.1, type: 'product' },
  'C&I Loans': { maxPct: 0.25, type: 'sector' },
  'Top 10 Borrowers': { maxPct: 0.25, type: 'single_name' },
  'Single Counterparty': { maxPct: 0.1, type: 'single_name' },
};

// ─── Types ───────────────────────────────────────────────────

export interface ConcentrationExposure {
  limitName: string;
  limitType: string;
  maxPct: number;
  // Nullable per D1: a `single_name`/`geography` limit cannot be evaluated
  // from aggregate balance-sheet data, so its measured fields are `null`
  // (never 0, which would read as "no concentration / compliant").
  currentPct: number | null;
  currentBalance: number | null;
  headroom: number | null; // maxPct - currentPct
  status: 'compliant' | 'warning' | 'breach' | 'data_unavailable';
  utilizationPct: number | null; // currentPct / maxPct
}

export interface ConcentrationAnalysis {
  exposures: ConcentrationExposure[];
  // Nullable per D1: with no asset data there is nothing to compute, so the
  // engine returns `null` + a gap rather than fabricated demo numbers.
  hhi: number | null; // Herfindahl-Hirschman Index (0-10000)
  hhiInterpretation: string | null;
  diversificationScore: number | null; // 0-100
  breachCount: number;
  warningCount: number;
  totalAssets: number | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class ConcentrationService {
  private readonly logger = new Logger(ConcentrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConcentrationAnalysis(
    institutionId: string,
  ): Promise<ConcentrationAnalysis> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
      });
      const customLimits = await this.prisma.concentrationLimit.findMany({
        where: { institutionId },
      });

      const assets = items.filter((i: any) => i.category === 'asset');
      const totalAssets = assets.reduce(
        (s: number, i: any) => s + Number(i.balance),
        0,
      );

      // D1 (never silent zeros): with no asset data there is nothing to
      // measure concentration against. Return an honest shell + CRITICAL gap
      // instead of demo numbers a regulator would read as a real portfolio.
      if (totalAssets === 0) {
        return this.dataUnavailableResult();
      }

      // Aggregate by subcategory
      const sectorBalances = new Map<string, number>();
      for (const item of assets) {
        const sector = this.normalizeSectorName(item.subcategory);
        sectorBalances.set(
          sector,
          (sectorBalances.get(sector) ?? 0) + Number(item.balance),
        );
      }

      // Custom limits override defaults. Normalize both into one shape so the
      // single evaluation loop handles either source identically.
      const limits =
        customLimits.length > 0
          ? customLimits.map((l: ConcentrationLimit) => ({
              limitName: l.limitName,
              limitType: l.limitType,
              maxPct: Number(l.maxPct),
            }))
          : Object.entries(DEFAULT_LIMITS).map(([limitName, config]) => ({
              limitName,
              limitType: config.type,
              maxPct: config.maxPct,
            }));

      const exposures: ConcentrationExposure[] = [];
      const gaps: DataGap[] = [];
      const usingCustom = customLimits.length > 0;

      for (const limit of limits) {
        // D1: single-borrower and geographic limits cannot be evaluated from
        // aggregate balance-sheet data — there is no loan-level or municipio
        // detail in this schema (roadmap W2.0 supplies it). Reporting
        // 'compliant' would be a FALSE PASS; surface a WARNING gap instead.
        if (
          limit.limitType === 'single_name' ||
          limit.limitType === 'geography'
        ) {
          exposures.push({
            limitName: limit.limitName,
            limitType: limit.limitType,
            maxPct: limit.maxPct,
            currentPct: null,
            currentBalance: null,
            headroom: null,
            status: 'data_unavailable',
            utilizationPct: null,
          });
          gaps.push(
            dataGap(
              `concentration.${limit.limitType}.${limit.limitName}`,
              limit.limitType === 'geography'
                ? 'NO_GEOGRAPHIC_DATA'
                : 'NO_BORROWER_DATA',
              {
                severity: 'WARNING',
                action:
                  limit.limitType === 'geography'
                    ? 'Cargue datos a nivel de préstamo con municipio para evaluar la concentración geográfica.'
                    : 'Cargue datos a nivel de prestatario para evaluar la concentración por deudor único.',
                context: { limitName: limit.limitName },
              },
            ),
          );
          continue;
        }

        const balance =
          sectorBalances.get(this.normalizeSectorName(limit.limitName)) ?? 0;

        // Default sector/product limits with no matching balance are omitted
        // (there is no exposure to report). Custom limits are always shown so
        // the user sees the limit they configured, even at 0%.
        if (!usingCustom && balance === 0) {
          continue;
        }

        const currentPct = balance / totalAssets;
        const headroom = limit.maxPct - currentPct;
        const utilization = limit.maxPct > 0 ? currentPct / limit.maxPct : 0;

        exposures.push({
          limitName: limit.limitName,
          limitType: limit.limitType,
          maxPct: limit.maxPct,
          currentPct,
          currentBalance: balance,
          headroom,
          status:
            currentPct > limit.maxPct
              ? 'breach'
              : utilization > 0.8
                ? 'warning'
                : 'compliant',
          utilizationPct: utilization * 100,
        });
      }

      // HHI calculation (sector shares — independent of the limit exposures)
      const shares = Array.from(sectorBalances.values()).map(
        (b) => (b / totalAssets) * 100,
      );
      const hhi = shares.reduce((sum, s) => sum + s * s, 0);
      const hhiInterpretation =
        hhi < 1500
          ? 'Well diversified'
          : hhi < 2500
            ? 'Moderate concentration'
            : 'Highly concentrated';
      const diversificationScore = Math.max(0, Math.min(100, 100 - hhi / 100));

      return {
        // Sort by utilization desc; unevaluable (null) exposures sink to the
        // bottom rather than corrupting the numeric comparison.
        exposures: exposures.sort(
          (a, b) => (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1),
        ),
        hhi: Math.round(hhi),
        hhiInterpretation,
        diversificationScore: Math.round(diversificationScore),
        breachCount: exposures.filter((e) => e.status === 'breach').length,
        warningCount: exposures.filter((e) => e.status === 'warning').length,
        totalAssets,
        status: 'ok',
        gaps: gaps.length > 0 ? gaps : undefined,
      };
    } catch (error: any) {
      this.logger.error(`Computation failed: ${error.message}`, error.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  async saveConcentrationLimits(
    institutionId: string,
    limits: Array<{
      limitType: string;
      limitName: string;
      maxPct: number;
    }>,
  ) {
    await this.prisma.concentrationLimit.deleteMany({
      where: { institutionId },
    });
    return this.prisma.concentrationLimit.createMany({
      data: limits.map((l) => ({
        institutionId,
        limitType: l.limitType,
        limitName: l.limitName,
        maxPct: l.maxPct,
        currentPct: 0,
        status: 'compliant',
      })),
    });
  }

  private normalizeSectorName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[_-]/g, ' ')
      .replace(/\b(re|loans?|mortgage)\b/g, (m) => m)
      .trim();
  }

  // D1: the honest empty-data shell. Replaces the former getDemoAnalysis()
  // fabrication (HHI 1850 / diversification 82 / $445M) that would have read
  // as a real, moderately-diversified portfolio to a COSSEC examiner.
  private dataUnavailableResult(): ConcentrationAnalysis {
    return {
      exposures: [],
      hhi: null,
      hhiInterpretation: null,
      diversificationScore: null,
      breachCount: 0,
      warningCount: 0,
      totalAssets: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('concentration.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue el balance de situación (activos) para calcular la concentración de la cartera.',
          context: { service: 'concentration' },
        }),
      ],
    };
  }
}
