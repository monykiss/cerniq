import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface ExportableMetrics {
  institutionId: string;
  institutionName: string;
  reportDate: string;
  riskScore: number | null;
  capitalRatio: number | null;
  lcr: number | null;
  lcrStatus: string | null;
  durationGap: number | null;
  durationGapRiskProfile: string | null;
  assetDuration: number | null;
  liabilityDuration: number | null;
  baseNII: number | null;
  niiRiskRating: string | null;
  baseEVE: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  netBPV: number | null;
}

/**
 * Exports ALM metrics in JSON or CSV format for the latest
 * completed analysis run of an institution.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Export metrics for the latest completed analysis run.
   *
   * @param institutionId - The institution to export
   * @param format - 'json' returns the metrics object, 'csv' returns a CSV string
   */
  async exportMetrics(
    institutionId: string,
    format: 'json' | 'csv',
  ): Promise<ExportableMetrics | string> {
    const latestRun = await this.prisma.analysisRun.findFirst({
      where: {
        institutionId,
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        resultSummary: true,
        institution: {
          select: {
            id: true,
            name: true,
            reportingDate: true,
          },
        },
      },
    });

    if (!latestRun) {
      throw new NotFoundException(
        `No completed analysis run found for institution ${institutionId}`,
      );
    }

    const metrics = this.extractAllMetrics(latestRun);

    if (format === 'csv') {
      return this.toCSV(metrics);
    }

    return metrics;
  }

  private extractAllMetrics(run: {
    id: string;
    createdAt: Date;
    resultSummary: unknown;
    institution: {
      id: string;
      name: string;
      reportingDate: Date;
    };
  }): ExportableMetrics {
    const metrics: ExportableMetrics = {
      institutionId: run.institution.id,
      institutionName: run.institution.name,
      reportDate: run.createdAt.toISOString(),
      riskScore: null,
      capitalRatio: null,
      lcr: null,
      lcrStatus: null,
      durationGap: null,
      durationGapRiskProfile: null,
      assetDuration: null,
      liabilityDuration: null,
      baseNII: null,
      niiRiskRating: null,
      baseEVE: null,
      totalAssets: null,
      totalLiabilities: null,
      equity: null,
      netBPV: null,
    };

    if (!run.resultSummary || typeof run.resultSummary !== 'object') {
      return metrics;
    }

    const rs = run.resultSummary as Record<string, unknown>;
    const summary = rs['summary'] as Record<string, unknown> | undefined;

    if (!summary || typeof summary !== 'object') {
      return metrics;
    }

    // Risk score
    metrics.riskScore = this.safeNumber(summary['riskScore']);

    // Duration gap
    const dg = summary['durationGap'] as Record<string, unknown> | undefined;
    if (dg) {
      metrics.durationGap = this.safeNumber(dg['durationGap']);
      metrics.durationGapRiskProfile = this.safeString(dg['riskProfile']);
      metrics.assetDuration = this.safeNumber(dg['assetDuration']);
      metrics.liabilityDuration = this.safeNumber(dg['liabilityDuration']);
    }

    // LCR / Liquidity
    const liquidity = summary['liquidity'] as
      | Record<string, unknown>
      | undefined;
    if (liquidity) {
      metrics.lcr = this.safeNumber(liquidity['lcr']);
      metrics.lcrStatus = this.safeString(liquidity['status']);
    }

    // NII Sensitivity
    const nii = summary['niiSensitivity'] as
      | Record<string, unknown>
      | undefined;
    if (nii) {
      metrics.baseNII = this.safeNumber(nii['baseNII']);
      metrics.niiRiskRating = this.safeString(nii['riskRating']);
    }

    // Full Analysis sub-fields
    const fullAnalysis = summary['fullAnalysis'] as
      | Record<string, unknown>
      | undefined;
    if (fullAnalysis) {
      // Summary block
      const faSummary = fullAnalysis['summary'] as
        | Record<string, unknown>
        | undefined;
      if (faSummary) {
        metrics.totalAssets = this.safeNumber(faSummary['totalAssets']);
        metrics.totalLiabilities = this.safeNumber(
          faSummary['totalLiabilities'],
        );
        metrics.equity = this.safeNumber(faSummary['equity']);
      }

      // Capital ratio
      if (
        metrics.equity !== null &&
        metrics.totalAssets !== null &&
        metrics.totalAssets > 0
      ) {
        metrics.capitalRatio =
          Math.round((metrics.equity / metrics.totalAssets) * 10000) / 100;
      }

      // EVE
      const eve = fullAnalysis['eve'] as Record<string, unknown> | undefined;
      if (eve) {
        metrics.baseEVE = this.safeNumber(eve['baseEVE']);
      }

      // BPV
      const bpv = fullAnalysis['bpv'] as Record<string, unknown> | undefined;
      if (bpv) {
        metrics.netBPV = this.safeNumber(bpv['netBPV']);
      }
    }

    return metrics;
  }

  private toCSV(metrics: ExportableMetrics): string {
    const headers = Object.keys(metrics) as Array<keyof ExportableMetrics>;
    const headerRow = headers.join(',');
    const valueRow = headers
      .map((key) => {
        const val = metrics[key];
        if (val === null || val === undefined) {
          return 'DATA_UNAVAILABLE';
        }
        // Escape strings that might contain commas or quotes
        if (typeof val === 'string') {
          if (val.includes(',') || val.includes('"') || val.includes('\n')) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        }
        return String(val);
      })
      .join(',');

    return `${headerRow}\n${valueRow}\n`;
  }

  private safeNumber(value: unknown): number | null {
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
    return null;
  }

  private safeString(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }
    return null;
  }
}
