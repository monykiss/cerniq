import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// ─── Peer Metrics ────────────────────────────────────────────

/**
 * D1 (2026-04-07): institutionValue and percentileRank are nullable. When the
 * underlying metric is unavailable (e.g. EVE_Sensitivity is not yet wired to
 * a real source), the row renders as `INSUFFICIENT_DATA` instead of
 * defaulting to the peer median — which would have made missing data look
 * like average performance.
 */
export interface PeerMetric {
  metricName: string;
  metricNameEs: string;
  institutionValue: number | null;
  peerMin: number;
  peerP25: number;
  peerMedian: number;
  peerP75: number;
  peerMax: number;
  percentileRank: number | null; // 0–100, null when institutionValue is null
  status:
    | 'top_quartile'
    | 'above_median'
    | 'below_median'
    | 'bottom_quartile'
    | 'data_unavailable';
}

export interface PeerAnalyticsResult {
  institutionId: string;
  peerGroupName: string;
  peerGroupNameEs: string;
  peerCount: number;
  assetTier: string;
  metrics: PeerMetric[];
  overallStatus?: 'computed' | 'data_unavailable';
  gaps?: DataGap[];
}

// PR cooperativa benchmark data by asset tier (from NCUA aggregate analysis)
const PEER_BENCHMARKS: Record<
  string,
  Record<
    string,
    { min: number; p25: number; p50: number; p75: number; max: number }
  >
> = {
  small: {
    NIM: { min: 1.8, p25: 2.8, p50: 3.4, p75: 4.1, max: 5.8 },
    EVE_Sensitivity: { min: 2, p25: 8, p50: 14, p75: 22, max: 38 },
    LCR: { min: 72, p25: 98, p50: 118, p75: 145, max: 220 },
    Deposit_Beta: { min: 0.05, p25: 0.08, p50: 0.12, p75: 0.18, max: 0.28 },
    Loan_to_Share: { min: 42, p25: 58, p50: 68, p75: 78, max: 95 },
    CECL_Coverage: { min: 0.4, p25: 0.8, p50: 1.2, p75: 1.8, max: 3.2 },
  },
  medium: {
    NIM: { min: 2.0, p25: 3.0, p50: 3.6, p75: 4.2, max: 5.5 },
    EVE_Sensitivity: { min: 3, p25: 10, p50: 16, p75: 24, max: 40 },
    LCR: { min: 78, p25: 102, p50: 122, p75: 150, max: 230 },
    Deposit_Beta: { min: 0.08, p25: 0.12, p50: 0.17, p75: 0.24, max: 0.35 },
    Loan_to_Share: { min: 48, p25: 62, p50: 72, p75: 82, max: 98 },
    CECL_Coverage: { min: 0.5, p25: 0.9, p50: 1.3, p75: 2.0, max: 3.5 },
  },
  large: {
    NIM: { min: 2.2, p25: 3.2, p50: 3.8, p75: 4.4, max: 5.2 },
    EVE_Sensitivity: { min: 5, p25: 12, p50: 18, p75: 26, max: 42 },
    LCR: { min: 82, p25: 108, p50: 128, p75: 158, max: 245 },
    Deposit_Beta: { min: 0.1, p25: 0.15, p50: 0.22, p75: 0.3, max: 0.42 },
    Loan_to_Share: { min: 52, p25: 65, p50: 75, p75: 85, max: 100 },
    CECL_Coverage: { min: 0.6, p25: 1.0, p50: 1.5, p75: 2.2, max: 3.8 },
  },
};

const METRIC_LABELS: Record<
  string,
  { en: string; es: string; higherIsBetter: boolean }
> = {
  NIM: {
    en: 'Net Interest Margin (%)',
    es: 'Margen de Interés Neto (%)',
    higherIsBetter: true,
  },
  EVE_Sensitivity: {
    en: 'EVE Sensitivity +200bps (%)',
    es: 'Sensibilidad EVE +200bps (%)',
    higherIsBetter: false,
  },
  LCR: {
    en: 'Liquidity Coverage Ratio (%)',
    es: 'Ratio de Cobertura de Liquidez (%)',
    higherIsBetter: true,
  },
  Deposit_Beta: {
    en: 'Implied Deposit Beta',
    es: 'Beta de Depósito Implícito',
    higherIsBetter: false,
  },
  Loan_to_Share: {
    en: 'Loan-to-Share Ratio (%)',
    es: 'Ratio Préstamos/Acciones (%)',
    higherIsBetter: false,
  },
  CECL_Coverage: {
    en: 'CECL Allowance / Loans (%)',
    es: 'Provisión CECL / Préstamos (%)',
    higherIsBetter: true,
  },
};

@Injectable()
export class PeerAnalyticsService {
  private readonly logger = new Logger(PeerAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPeerAnalytics(institutionId: string): Promise<PeerAnalyticsResult> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    // D1 (2026-04-07): refuse to bucket the institution into a peer tier
    // when totalAssets is missing. The previous behavior fell back to
    // $200M (the medium tier) and ranked the institution against medium
    // peers — a phantom comparison.
    if (!institution || !institution.totalAssets) {
      this.logger.warn({
        event: 'peer_analytics_data_unavailable',
        institutionId,
        reason: 'MISSING_TOTAL_ASSETS',
      });
      return {
        institutionId,
        peerGroupName: 'Unknown',
        peerGroupNameEs: 'Desconocido',
        peerCount: 0,
        assetTier: 'unknown',
        metrics: [],
        overallStatus: 'data_unavailable',
        gaps: [
          dataGap('peer.institution', 'MISSING_INSTITUTION', {
            severity: 'CRITICAL',
            action:
              'Institution must have totalAssets set before peer analytics can determine the asset tier.',
            context: { institutionId },
          }),
        ],
      };
    }
    const totalAssets = Number(institution.totalAssets);
    const assetTier =
      totalAssets < 50 ? 'small' : totalAssets < 300 ? 'medium' : 'large';

    const peerData = PEER_BENCHMARKS[assetTier];
    const { metrics: institutionMetrics, gaps: metricGaps } =
      await this.getInstitutionMetrics(institutionId);

    const metrics: PeerMetric[] = Object.keys(peerData).map((key) => {
      const bench = peerData[key];
      const label = METRIC_LABELS[key];
      // D1: when an institution metric is null (unavailable), do NOT
      // substitute the peer median. The previous behavior made missing
      // data look like average performance — exactly the kind of
      // confidently-wrong number we exist to eliminate.
      const instValue = institutionMetrics[key];

      if (instValue === null || instValue === undefined) {
        return {
          metricName: label.en,
          metricNameEs: label.es,
          institutionValue: null,
          peerMin: bench.min,
          peerP25: bench.p25,
          peerMedian: bench.p50,
          peerP75: bench.p75,
          peerMax: bench.max,
          percentileRank: null,
          status: 'data_unavailable',
        };
      }

      const percentile = this.computePercentileRank(
        instValue,
        bench,
        label.higherIsBetter,
      );
      let status: PeerMetric['status'];
      if (percentile >= 75) status = 'top_quartile';
      else if (percentile >= 50) status = 'above_median';
      else if (percentile >= 25) status = 'below_median';
      else status = 'bottom_quartile';

      return {
        metricName: label.en,
        metricNameEs: label.es,
        institutionValue: Math.round(instValue * 100) / 100,
        peerMin: bench.min,
        peerP25: bench.p25,
        peerMedian: bench.p50,
        peerP75: bench.p75,
        peerMax: bench.max,
        percentileRank: percentile,
        status,
      };
    });

    const tierLabels: Record<
      string,
      { en: string; es: string; count: number }
    > = {
      small: {
        en: 'PR Cooperativas < $50M Assets',
        es: 'Cooperativas PR < $50M Activos',
        count: 32,
      },
      medium: {
        en: 'PR Cooperativas $50M–$300M',
        es: 'Cooperativas PR $50M–$300M',
        count: 43,
      },
      large: {
        en: 'PR Cooperativas > $300M',
        es: 'Cooperativas PR > $300M',
        count: 19,
      },
    };

    return {
      institutionId,
      peerGroupName: tierLabels[assetTier].en,
      peerGroupNameEs: tierLabels[assetTier].es,
      peerCount: tierLabels[assetTier].count,
      assetTier,
      metrics,
      overallStatus: 'computed',
      gaps: metricGaps,
    };
  }

  /**
   * D1 (2026-04-07): every metric is nullable. NIM and Loan_to_Share are
   * derived from real balance sheet items. EVE_Sensitivity, LCR,
   * Deposit_Beta, and CECL_Coverage are NOT YET wired to real sources —
   * they return null + a WARNING gap naming the source they should come
   * from. The previous implementation hardcoded these to literal numbers
   * (15.2, 115, 0.18, 1.3) and ranked the institution against peers using
   * those literals — a phantom comparison.
   */
  private async getInstitutionMetrics(institutionId: string): Promise<{
    metrics: Record<string, number | null>;
    gaps: DataGap[];
  }> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    const gaps: DataGap[] = [];

    // Always-WARNING gaps for the metrics that are not yet wired to real
    // sources. These tell the next contributor exactly which source to
    // wire in to fix each one.
    const unwiredGaps: DataGap[] = [
      dataGap('peer.metrics.EVE_Sensitivity', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire EVE sensitivity (DurationService.calculateEVESensitivity) into PeerAnalyticsService.getInstitutionMetrics. Currently null.',
      }),
      dataGap('peer.metrics.LCR', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire LCR (AlmEnterpriseService.calculateLCR) into PeerAnalyticsService.getInstitutionMetrics. Currently null.',
      }),
      dataGap('peer.metrics.Deposit_Beta', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire deposit beta (DepositBetaService) into PeerAnalyticsService.getInstitutionMetrics. Currently null.',
      }),
      dataGap('peer.metrics.CECL_Coverage', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire CECL coverage (CECLService.getCECLAnalysis) into PeerAnalyticsService.getInstitutionMetrics. Currently null.',
      }),
    ];

    if (items.length === 0) {
      gaps.push(
        dataGap('peer.metrics.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Upload balance sheet items so peer analytics can compute NIM and Loan_to_Share.',
        }),
        ...unwiredGaps,
      );
      return {
        metrics: {
          NIM: null,
          EVE_Sensitivity: null,
          LCR: null,
          Deposit_Beta: null,
          Loan_to_Share: null,
          CECL_Coverage: null,
        },
        gaps,
      };
    }

    const assets = items.filter((i: any) => i.category === 'asset');
    const liabs = items.filter((i: any) => i.category === 'liability');
    const totalAssets = assets.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const totalLiabs = liabs.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );

    const assetIncome = assets.reduce(
      (s: number, i: any) => s + Number(i.balance) * Number(i.rate),
      0,
    );
    const liabCost = liabs.reduce(
      (s: number, i: any) => s + Number(i.balance) * Number(i.rate),
      0,
    );
    const nim =
      totalAssets > 0 ? ((assetIncome - liabCost) / totalAssets) * 100 : null;

    const loans = assets.filter(
      (i: any) => !['cash', 'securities'].includes(i.subcategory.toLowerCase()),
    );
    const totalLoans = loans.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const loanToShare = totalLiabs > 0 ? (totalLoans / totalLiabs) * 100 : null;

    gaps.push(...unwiredGaps);

    return {
      metrics: {
        NIM: nim === null ? null : Math.round(nim * 100) / 100,
        EVE_Sensitivity: null,
        LCR: null,
        Deposit_Beta: null,
        Loan_to_Share:
          loanToShare === null ? null : Math.round(loanToShare * 10) / 10,
        CECL_Coverage: null,
      },
      gaps,
    };
  }

  private computePercentileRank(
    value: number,
    bench: { min: number; p25: number; p50: number; p75: number; max: number },
    higherIsBetter: boolean,
  ): number {
    // Linear interpolation between benchmark percentiles
    const points = [
      { pct: 0, val: bench.min },
      { pct: 25, val: bench.p25 },
      { pct: 50, val: bench.p50 },
      { pct: 75, val: bench.p75 },
      { pct: 100, val: bench.max },
    ];

    // For "lower is better" metrics, invert
    const v = higherIsBetter ? value : -value;
    const pts = higherIsBetter
      ? points
      : points.map((p) => ({ pct: p.pct, val: -p.val }));

    if (v <= pts[0].val) return 0;
    if (v >= pts[pts.length - 1].val) return 100;

    for (let i = 0; i < pts.length - 1; i++) {
      if (v >= pts[i].val && v <= pts[i + 1].val) {
        const ratio = (v - pts[i].val) / (pts[i + 1].val - pts[i].val);
        return Math.round(pts[i].pct + ratio * (pts[i + 1].pct - pts[i].pct));
      }
    }
    return 50;
  }
}
