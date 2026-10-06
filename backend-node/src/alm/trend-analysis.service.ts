import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface TrendPeriod {
  date: string;
  runId: string;
  riskScore: number | null;
  capitalRatio: number | null;
  lcr: number | null;
  durationGap: number | null;
  niiSensitivity: number | null;
  eveSensitivity: number | null;
}

export interface HistoricalTrendResult {
  institutionId: string;
  periodCount: number;
  periods: TrendPeriod[];
}

/**
 * Extracts time-series metrics from completed AnalysisRun records
 * to enable historical trend comparison across report submissions.
 */
@Injectable()
export class TrendAnalysisService {
  private readonly logger = new Logger(TrendAnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch historical metrics trend for an institution.
   *
   * Retrieves the last 20 completed AnalysisRun records and extracts
   * key risk metrics from each run's resultSummary JSON, returning
   * a time series suitable for charting.
   *
   * @param institutionId - The institution to query
   * @param metricKeys - Optional filter for specific metric keys
   */
  async getHistoricalTrend(
    institutionId: string,
    metricKeys?: string[],
  ): Promise<HistoricalTrendResult> {
    const runs = await this.prisma.analysisRun.findMany({
      where: {
        institutionId,
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        resultSummary: true,
      },
    });

    const allMetricKeys = [
      'riskScore',
      'capitalRatio',
      'lcr',
      'durationGap',
      'niiSensitivity',
      'eveSensitivity',
    ];
    const activeKeys =
      metricKeys && metricKeys.length > 0
        ? allMetricKeys.filter((k) => metricKeys.includes(k))
        : allMetricKeys;

    const periods: TrendPeriod[] = runs.map(
      (run: { id: string; createdAt: Date; resultSummary: unknown }) => {
        const metrics = this.extractMetrics(run.resultSummary, activeKeys);
        return {
          date: run.createdAt.toISOString(),
          runId: run.id,
          ...metrics,
        };
      },
    );

    // Return in chronological order (oldest first) for charting
    periods.reverse();

    return {
      institutionId,
      periodCount: periods.length,
      periods,
    };
  }

  /**
   * Extract key metrics from a resultSummary JSON blob.
   *
   * The resultSummary structure (from AnalysisRunsService) is:
   * {
   *   summary: ALMSummaryResult {
   *     riskScore, durationGap, niiSensitivity, liquidity, fullAnalysis, ...
   *   },
   *   stressTest: StressTestResult
   * }
   */
  private extractMetrics(
    resultSummary: unknown,
    activeKeys: string[],
  ): Omit<TrendPeriod, 'date' | 'runId'> {
    const result: Omit<TrendPeriod, 'date' | 'runId'> = {
      riskScore: null,
      capitalRatio: null,
      lcr: null,
      durationGap: null,
      niiSensitivity: null,
      eveSensitivity: null,
    };

    if (!resultSummary || typeof resultSummary !== 'object') {
      return result;
    }

    const rs = resultSummary as Record<string, unknown>;
    const summary = rs['summary'] as Record<string, unknown> | undefined;

    if (!summary || typeof summary !== 'object') {
      return result;
    }

    if (activeKeys.includes('riskScore')) {
      result.riskScore = this.safeNumber(summary['riskScore']);
    }

    if (activeKeys.includes('durationGap')) {
      const dg = summary['durationGap'] as Record<string, unknown> | undefined;
      result.durationGap = dg ? this.safeNumber(dg['durationGap']) : null;
    }

    if (activeKeys.includes('lcr')) {
      const liquidity = summary['liquidity'] as
        | Record<string, unknown>
        | undefined;
      result.lcr = liquidity ? this.safeNumber(liquidity['lcr']) : null;
    }

    if (activeKeys.includes('niiSensitivity')) {
      const nii = summary['niiSensitivity'] as
        | Record<string, unknown>
        | undefined;
      if (nii) {
        // Use the worst-case NII impact percentage as the sensitivity metric
        const scenarios = nii['scenarios'] as
          | Array<Record<string, unknown>>
          | undefined;
        if (scenarios && scenarios.length > 0) {
          const worstImpact = scenarios.reduce((worst, s) => {
            const pct = Math.abs(this.safeNumber(s['niImpactPct']) ?? 0);
            return pct > worst ? pct : worst;
          }, 0);
          result.niiSensitivity = worstImpact;
        } else {
          result.niiSensitivity = null;
        }
      }
    }

    if (activeKeys.includes('eveSensitivity')) {
      const eveSens = summary['eveSensitivity'] as
        | Array<Record<string, unknown>>
        | undefined;
      if (eveSens && eveSens.length > 0) {
        // Use the worst-case EVE change percentage
        const worstEve = eveSens.reduce((worst, point) => {
          const pct = Math.abs(this.safeNumber(point['changePct']) ?? 0);
          return pct > worst ? pct : worst;
        }, 0);
        result.eveSensitivity = worstEve;
      } else {
        // Fall back to fullAnalysis.eve if available
        const fullAnalysis = summary['fullAnalysis'] as
          | Record<string, unknown>
          | undefined;
        if (fullAnalysis) {
          const eve = fullAnalysis['eve'] as
            | Record<string, unknown>
            | undefined;
          if (eve) {
            const scenarios = eve['scenarios'] as
              | Array<Record<string, unknown>>
              | undefined;
            if (scenarios && scenarios.length > 0) {
              const worstEve = scenarios.reduce((worst, s) => {
                const pct = Math.abs(this.safeNumber(s['changePct']) ?? 0);
                return pct > worst ? pct : worst;
              }, 0);
              result.eveSensitivity = worstEve;
            }
          }
        }
      }
    }

    if (activeKeys.includes('capitalRatio')) {
      // capitalRatio is derived: equity / totalAssets from the fullAnalysis summary
      const fullAnalysis = summary['fullAnalysis'] as
        | Record<string, unknown>
        | undefined;
      if (fullAnalysis) {
        const faSummary = fullAnalysis['summary'] as
          | Record<string, unknown>
          | undefined;
        if (faSummary) {
          const equity = this.safeNumber(faSummary['equity']);
          const totalAssets = this.safeNumber(faSummary['totalAssets']);
          if (equity !== null && totalAssets !== null && totalAssets > 0) {
            result.capitalRatio =
              Math.round((equity / totalAssets) * 10000) / 100; // percentage with 2 decimals
          }
        }
      }
    }

    return result;
  }

  private safeNumber(value: unknown): number | null {
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
    return null;
  }
}
