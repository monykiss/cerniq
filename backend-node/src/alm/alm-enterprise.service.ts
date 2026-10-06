import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlmService } from './alm.service';
import {
  DurationService,
  PortfolioDurationMetrics,
  EVESensitivityPoint,
} from './duration.service';
import { BalanceSheetDto, InstrumentDto, FullAnalysisResult } from './alm.dto';
import {
  PR_COOP_BENCHMARKS,
  getPercentileRank,
  SectorBenchmark,
} from './benchmarks/pr-cooperativa-benchmarks';
import { getFramework, IRegulatoryFramework } from './frameworks';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { DataGap, dataGap, mergeGaps } from './reports/data-gap';
import { asNumber } from './reports/report-formatting';
import { parseFinancialField } from '../common/utils/financial-field';

/** Round to n decimal places */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export interface DurationGapSummary {
  assetDuration: number;
  liabilityDuration: number;
  durationGap: number;
  riskProfile: 'asset-sensitive' | 'liability-sensitive' | 'neutral';
  /** Modified duration + convexity analytics (added by DurationService) */
  assetConvexity?: number;
  liabilityConvexity?: number;
  leverageAdjustedDurationGap?: number;
}

export interface NIISensitivityResult {
  scenarios: Array<{
    name: string;
    shiftBps: number;
    niImpact: number;
    niImpactPct: number;
    mveImpact: number;
    mveImpactPct: number;
  }>;
  baseNII: number;
  riskRating: 'low' | 'moderate' | 'high' | 'critical';
}

/**
 * LCR summary. Locked decision D1 (2026-04-07): when liquidity inputs are
 * missing, numeric fields are `null` (not 0) and `status` is `'data_unavailable'`.
 * The `gaps[]` array enumerates exactly what's missing. Callers MUST handle
 * the null case explicitly — that's the whole point of the contract: a real
 * zero LCR (cooperativa actually in breach) is semantically distinct from
 * "we don't have the data yet".
 */
export interface LCRSummary {
  lcr: number | null;
  hqla: number | null;
  netOutflows: number | null;
  status: 'compliant' | 'warning' | 'breach' | 'data_unavailable';
  buffer: number | null;
  gaps?: DataGap[];
}

export interface COSSECCheck {
  name: string;
  nameEs: string;
  value: number;
  threshold: number;
  unit: string;
  status: 'pass' | 'warning' | 'fail';
  description: string;
  descriptionEs: string;
}

export interface CossecRatioResult {
  id: number;
  name: string;
  nameEs: string;
  /**
   * Numeric value of the ratio. When `status === 'data_unavailable'`, this
   * field is `0` as a sentinel — but that 0 is **not** a real value. Callers
   * MUST check `status` (or the parent `gaps[]` manifest) before rendering.
   * D1 (2026-04-07).
   */
  value: number;
  unit: string;
  threshold: string;
  thresholdDirection: 'gte' | 'lte' | 'range' | 'info';
  status: 'pass' | 'warning' | 'fail' | 'info' | 'data_unavailable';
  description: string;
  descriptionEs: string;
  examReadinessContribution: number;
  sectorMedian: number | null;
  percentileRank: string | null;
  percentileRankEs: string | null;
}

export interface COSSECComplianceResult {
  institutionName: string;
  institutionType: string;
  reportingDate: string;
  checks: COSSECCheck[];
  ratios: CossecRatioResult[];
  examReadinessScore: number;
  overallStatus:
    | 'compliant'
    | 'conditional'
    | 'non-compliant'
    | 'data_unavailable';
  /**
   * Populated when input data is incomplete (e.g. empty balance sheet). When
   * any CRITICAL gap is present, `checks`/`ratios` are empty and the summary
   * fields are zero — but the `data_unavailable` status communicates that
   * those zeros are NOT real numbers. See `data-gap.ts` for the contract.
   */
  gaps?: DataGap[];
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    equity: number;
    totalLoans: number;
    totalShares: number;
    liquidAssets: number;
    capitalRatio: number;
    /**
     * Statutory capital ratio (Ley 255-2002 Art. 6.02): net-worth proxy for the
     * capital indivisible reserve ÷ risk-weighted assets ("activos sujetos a
     * riesgo"). Optional — populated by the COSSEC path; a `cossec.capitalRatio.basis`
     * gap discloses the proxy. This (not `capitalRatio`) is the statutory figure.
     */
    capitalRatioRWA?: number;
    /** Risk-weighted assets used as the statutory capital-ratio denominator. */
    riskWeightedAssets?: number;
    loanToShareRatio: number;
    liquidityRatio: number;
    earningAssets: number;
    interestIncome: number;
    interestExpense: number;
    nim: number;
    earningAssetsYield: number;
    costOfFunds: number;
    largestSectorPct: number;
    largestSectorName: string;
  };
}

export interface TrendDelta {
  ratioId: number;
  ratioName: string;
  ratioNameEs: string;
  currentValue: number;
  previousValue: number;
  delta: number; // absolute change (currentValue - previousValue)
  deltaBps?: number; // change in bps for percentage ratios
  trend: 'improving' | 'deteriorating' | 'stable';
  unit: string;
  previousPeriod: string; // e.g. "Q4-2025"
}

export interface COSSECComplianceWithTrend extends COSSECComplianceResult {
  trends: TrendDelta[] | null;
  previousPeriod: string | null;
}

export interface ALMSummaryResult {
  institution: {
    id: string;
    name: string;
    type: string;
    totalAssets: number;
    currency: string;
    reportingDate: string;
  };
  durationGap: DurationGapSummary;
  niiSensitivity: NIISensitivityResult;
  liquidity: LCRSummary;
  topRisks: string[];
  recommendations: string[];
  /**
   * Composite 0-100 risk score (40% duration gap + 35% NII + 25% LCR). Null
   * when any input component carries a CRITICAL gap — a partial score is
   * more misleading than no score, so the presenter renders `—` and points
   * the user at `gaps[]` instead. D1 (2026-04-07).
   */
  riskScore: number | null;
  fullAnalysis: FullAnalysisResult;
  /** Duration/convexity analytics from DurationService (MP-QUANT-02) */
  durationConvexity?: PortfolioDurationMetrics | null;
  /** EVE sensitivity with convexity adjustment across rate shocks */
  eveSensitivity?: EVESensitivityPoint[] | null;
  /**
   * Top-level gap manifest aggregated from every sub-calculation. When this
   * array contains any `CRITICAL` gap, the report should not be shipped to
   * regulators or boards — see `hasCriticalGap()` in `data-gap.ts`. The UI
   * surfaces these as a banner above the report and as `—` markers in the
   * affected cells. Locked decision D1 (2026-04-07).
   */
  gaps?: DataGap[];
}

@Injectable()
export class AlmEnterpriseService {
  private readonly logger = new Logger(AlmEnterpriseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almService: AlmService,
    private readonly durationService: DurationService,
  ) {}

  // ─── Institution CRUD ──────────────────────────────────────────

  async createInstitution(data: {
    workspaceId: string;
    name: string;
    type: string;
    totalAssets: number;
    currency?: string;
    reportingDate: string;
    primaryRegulator?: string;
    preferredLanguage?: string;
  }) {
    return this.prisma.institution.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        type: data.type,
        totalAssets: data.totalAssets,
        currency: data.currency || 'USD',
        reportingDate: new Date(data.reportingDate),
        primaryRegulator: data.primaryRegulator || 'COSSEC',
        preferredLanguage: data.preferredLanguage || 'es',
      },
    });
  }

  async getInstitution(institutionId: string) {
    const inst = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      include: {
        balanceSheetItems: true,
        liquidityPositions: { orderBy: { date: 'desc' }, take: 1 },
      },
    });
    if (!inst) throw new NotFoundException('Institution not found');
    return inst;
  }

  async getInstitutionsByWorkspace(
    workspaceId: string,
    pagination?: PaginationQueryDto,
  ) {
    const page = pagination?.page || 1;
    const pageSize = pagination?.pageSize || 20;
    const where = { workspaceId };

    const [items, total] = await Promise.all([
      this.prisma.institution.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: pagination?.sortOrder || 'desc' },
      }),
      this.prisma.institution.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getInstitutionsByUser(userId: string, pagination?: PaginationQueryDto) {
    const page = pagination?.page || 1;
    const pageSize = pagination?.pageSize || 20;

    const workspaces = await this.prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true },
      take: 100,
    });
    const workspaceIds = workspaces.map((w: any) => w.id);
    if (workspaceIds.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const where = { workspaceId: { in: workspaceIds } };
    const [items, total] = await Promise.all([
      this.prisma.institution.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: pagination?.sortOrder || 'desc' },
      }),
      this.prisma.institution.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ─── Balance Sheet Import ──────────────────────────────────────

  async importBalanceSheetItems(
    institutionId: string,
    items: Array<{
      category: string;
      subcategory: string;
      name: string;
      balance: number;
      rate: number;
      duration: number;
      repriceDate?: string;
      maturityDate?: string;
      rateType: string;
    }>,
  ) {
    // Delete existing items and replace
    await this.prisma.balanceSheetItem.deleteMany({
      where: { institutionId },
    });

    const created = await this.prisma.balanceSheetItem.createMany({
      data: items.map((item) => ({
        institutionId,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: item.balance,
        rate: item.rate,
        duration: item.duration,
        repriceDate: item.repriceDate ? new Date(item.repriceDate) : null,
        maturityDate: item.maturityDate ? new Date(item.maturityDate) : null,
        rateType: item.rateType,
      })),
    });

    // Update institution totalAssets
    const assetTotal = items
      .filter((i) => i.category === 'asset')
      .reduce((sum, i) => sum + Number(i.balance), 0);
    await this.prisma.institution.update({
      where: { id: institutionId },
      data: { totalAssets: assetTotal },
    });

    return { count: created.count };
  }

  async listBalanceSheetItems(
    institutionId: string,
    pagination?: PaginationQueryDto,
  ) {
    const page = pagination?.page || 1;
    const pageSize = pagination?.pageSize || 20;
    const where = { institutionId };

    const [items, total] = await Promise.all([
      this.prisma.balanceSheetItem.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.balanceSheetItem.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ─── Save Liquidity Position ───────────────────────────────────

  async saveLiquidityPosition(
    institutionId: string,
    data: {
      hqlaLevel1: number;
      hqlaLevel2: number;
      cashOutflows: number;
      cashInflows: number;
      lcr: number;
      nsfr: number;
    },
  ) {
    return this.prisma.liquidityPosition.create({
      data: {
        institutionId,
        date: new Date(),
        ...data,
      },
    });
  }

  // ─── Core ALM Calculations (DB-backed) ─────────────────────────

  /**
   * Convert DB balance sheet items into the stateless BalanceSheetDto
   * format expected by the existing AlmService calculation engine.
   */
  /**
   * Build a BalanceSheetDto from pre-fetched items (pure, no DB).
   * Used by getALMSummary's pinned transaction to avoid redundant reads.
   */
  private buildBalanceSheetDtoFromItems(items: any[]): BalanceSheetDto {
    if (items.length === 0) {
      return {
        assets: [
          {
            name: 'No assets',
            amount: 0,
            rate: 0,
            maturityYears: 0,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'No liabilities',
            amount: 0,
            rate: 0,
            maturityYears: 0,
            isFloating: false,
          },
        ],
        equity: 0,
      };
    }

    const toInstrument = (item: any): InstrumentDto => {
      const balance = asNumber(item.balance);
      const rate = asNumber(item.rate);
      const duration = asNumber(item.duration);
      const maturityYears = item.maturityDate
        ? Math.max(
            0,
            (item.maturityDate.getTime() - Date.now()) /
              (365.25 * 24 * 3600 * 1000),
          )
        : duration;
      return {
        name: item.name,
        amount: balance * 1_000_000,
        rate,
        maturityYears: round(maturityYears, 2),
        isFloating: item.rateType === 'variable',
        repricingFrequencyMonths:
          item.rateType === 'variable' && item.repriceDate
            ? Math.max(
                1,
                round(
                  (item.repriceDate.getTime() - Date.now()) /
                    (30 * 24 * 3600 * 1000),
                  0,
                ),
              )
            : item.rateType === 'variable'
              ? 3
              : undefined,
      };
    };

    const assets = items
      .filter((i: any) => i.category === 'asset')
      .map(toInstrument);
    const liabilities = items
      .filter((i: any) => i.category === 'liability')
      .map(toInstrument);
    const totalAssets = assets.reduce(
      (s: any, a: any) => s + Number(a.amount),
      0,
    );
    const totalLiabilities = liabilities.reduce(
      (s: any, l: any) => s + Number(l.amount),
      0,
    );

    return {
      assets:
        assets.length > 0
          ? assets
          : [
              {
                name: 'No assets',
                amount: 0,
                rate: 0,
                maturityYears: 0,
                isFloating: false,
              },
            ],
      liabilities:
        liabilities.length > 0
          ? liabilities
          : [
              {
                name: 'No liabilities',
                amount: 0,
                rate: 0,
                maturityYears: 0,
                isFloating: false,
              },
            ],
      equity: totalAssets - totalLiabilities,
    };
  }

  private async buildBalanceSheetDto(
    institutionId: string,
  ): Promise<BalanceSheetDto> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    return this.buildBalanceSheetDtoFromItems(items);
  }

  async getBalanceSheetSnapshot(
    institutionId: string,
  ): Promise<BalanceSheetDto> {
    return this.buildBalanceSheetDto(institutionId);
  }

  async calculateDurationGap(
    institutionId: string,
  ): Promise<DurationGapSummary> {
    // Try the new DurationService (proper modified duration + convexity) first
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    if (items.length > 0) {
      const portfolio = this.durationService.calculatePortfolioMetrics(items);

      const gap = portfolio.leverageAdjustedDurationGap;
      let riskProfile: 'asset-sensitive' | 'liability-sensitive' | 'neutral';
      if (Math.abs(gap) < 0.5) {
        riskProfile = 'neutral';
      } else if (gap > 0) {
        riskProfile = 'asset-sensitive';
      } else {
        riskProfile = 'liability-sensitive';
      }

      return {
        assetDuration: round(portfolio.assetDuration, 2),
        liabilityDuration: round(portfolio.liabilityDuration, 2),
        durationGap: round(gap, 2),
        riskProfile,
        assetConvexity: round(portfolio.assetConvexity, 4),
        liabilityConvexity: round(portfolio.liabilityConvexity, 4),
        leverageAdjustedDurationGap: round(
          portfolio.leverageAdjustedDurationGap,
          4,
        ),
      };
    }

    // Fallback to original AlmService for backward compatibility
    const bs = await this.buildBalanceSheetDto(institutionId);
    const result = this.almService.durationGapAnalysis(bs);

    const gap = result.durationGap;
    let riskProfile: 'asset-sensitive' | 'liability-sensitive' | 'neutral';
    if (Math.abs(gap) < 0.5) {
      riskProfile = 'neutral';
    } else if (gap > 0) {
      riskProfile = 'asset-sensitive';
    } else {
      riskProfile = 'liability-sensitive';
    }

    return {
      assetDuration: round(result.assetDuration, 2),
      liabilityDuration: round(result.liabilityDuration, 2),
      durationGap: round(gap, 2),
      riskProfile,
    };
  }

  async calculateNIISensitivity(
    institutionId: string,
    rateShocksBps?: number[],
  ): Promise<NIISensitivityResult> {
    const bs = await this.buildBalanceSheetDto(institutionId);
    const niiResult = this.almService.niiSimulation(bs, rateShocksBps);
    const eveResult = this.almService.eveAnalysis(bs, rateShocksBps);

    const scenarios = niiResult.scenarios
      .filter((s) => s.shockBps !== 0)
      .map((s) => {
        const eveScenario = eveResult.scenarios.find(
          (e) => e.shockBps === s.shockBps,
        );
        return {
          name: s.shockBps > 0 ? `+${s.shockBps}bps` : `${s.shockBps}bps`,
          shiftBps: s.shockBps,
          niImpact: round(s.change / 1_000_000, 2), // convert to millions
          niImpactPct: round(s.changePct * 100, 2),
          mveImpact: eveScenario ? round(eveScenario.change / 1_000_000, 2) : 0,
          mveImpactPct: eveScenario ? round(eveScenario.changePct * 100, 2) : 0,
        };
      });

    // Risk rating based on worst-case NII impact
    const worstPct = Math.max(...scenarios.map((s) => Math.abs(s.niImpactPct)));
    let riskRating: 'low' | 'moderate' | 'high' | 'critical';
    if (worstPct < 5) riskRating = 'low';
    else if (worstPct < 10) riskRating = 'moderate';
    else if (worstPct < 20) riskRating = 'high';
    else riskRating = 'critical';

    return {
      scenarios,
      baseNII: round(niiResult.baseNII / 1_000_000, 2), // in millions
      riskRating,
    };
  }

  async calculateLCR(institutionId: string): Promise<LCRSummary> {
    // Try to use stored liquidity position first
    const latestPosition = await this.prisma.liquidityPosition.findFirst({
      where: { institutionId },
      orderBy: { date: 'desc' },
    });

    if (latestPosition) {
      const hqlaLevel1 = asNumber(latestPosition.hqlaLevel1);
      const hqlaLevel2 = asNumber(latestPosition.hqlaLevel2);
      const cashOutflows = asNumber(latestPosition.cashOutflows);
      const cashInflows = asNumber(latestPosition.cashInflows);
      const lcrValue = asNumber(latestPosition.lcr);
      const hqla = hqlaLevel1 + hqlaLevel2;
      const netOutflows = cashOutflows - cashInflows;
      return {
        lcr: round(lcrValue, 2),
        hqla: round(hqla, 2),
        netOutflows: round(netOutflows, 2),
        status:
          lcrValue >= 100 ? 'compliant' : lcrValue >= 90 ? 'warning' : 'breach',
        buffer: round(lcrValue - 100, 2),
      };
    }

    // Fall back to deriving from balance sheet
    const bs = await this.buildBalanceSheetDto(institutionId);
    const lcrResult = this.almService.fullAnalysis(bs).lcr;

    if (!lcrResult) {
      // D1 (2026-04-07): never silently substitute zero. A real cooperativa
      // with no liquidity row + insufficient balance sheet to derive LCR is
      // semantically distinct from "lcr === 0". Emit a CRITICAL gap so the
      // orchestrator (`getALMSummary`) and downstream presenters render the
      // field as `DATA UNAVAILABLE` instead of "breach".
      this.logger.warn({
        event: 'lcr_data_unavailable',
        institutionId,
        reason:
          'NO_LIQUIDITY_POSITION and balance-sheet derivation insufficient',
      });
      return {
        lcr: null,
        hqla: null,
        netOutflows: null,
        status: 'data_unavailable',
        buffer: null,
        gaps: [
          dataGap('liquidity.lcr', 'NO_LIQUIDITY_POSITION', {
            severity: 'CRITICAL',
            action:
              'Upload a liquidity_positions row for this institution, or load enough balance sheet detail (HQLA + cash flows) for the system to derive LCR.',
            context: { institutionId },
          }),
        ],
      };
    }

    return {
      lcr: round(lcrResult.lcr, 2),
      hqla: round(lcrResult.hqlaTotal / 1_000_000, 2), // in millions
      netOutflows: round(lcrResult.totalNetOutflows / 1_000_000, 2),
      status: lcrResult.status,
      buffer: round(lcrResult.lcr - 100, 2),
    };
  }

  // ─── COSSEC Compliance — Full 12-Ratio Engine ─────────────────

  /**
   * Build the structured `data_unavailable` shell returned by `getCOSSECCompliance`
   * when the institution has no balance sheet items. The numeric summary fields
   * are zero by necessity (the type doesn't admit null), but `overallStatus`
   * is `'data_unavailable'` and the `gaps[]` array carries a CRITICAL gap so
   * callers can branch on the manifest, not on phantom zeros.
   */
  private cossecDataUnavailableResult(institution: {
    name: string;
    type: string;
    reportingDate: Date | string;
  }): COSSECComplianceResult {
    const reportingDate =
      institution.reportingDate instanceof Date
        ? institution.reportingDate.toISOString()
        : String(institution.reportingDate);
    return {
      institutionName: institution.name,
      institutionType: institution.type,
      reportingDate,
      checks: [],
      ratios: [],
      examReadinessScore: 0,
      overallStatus: 'data_unavailable',
      gaps: [
        dataGap('cossec.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Upload balance sheet items (assets and liabilities) for this institution before running COSSEC compliance.',
        }),
      ],
      summary: {
        totalAssets: 0,
        totalLiabilities: 0,
        equity: 0,
        totalLoans: 0,
        totalShares: 0,
        liquidAssets: 0,
        capitalRatio: 0,
        loanToShareRatio: 0,
        liquidityRatio: 0,
        earningAssets: 0,
        interestIncome: 0,
        interestExpense: 0,
        nim: 0,
        earningAssetsYield: 0,
        costOfFunds: 0,
        largestSectorPct: 0,
        largestSectorName: '',
      },
    };
  }

  /**
   * D1 helper: a COSSEC ratio whose essential input is missing. Mirrors the
   * ratio-9 (LCR) `data_unavailable` shape — `value: 0` is a sentinel, NOT a
   * real number; the parent `gaps[]` carries the actionable manifest. A single
   * `data_unavailable` ratio downgrades `overallStatus` to `data_unavailable`,
   * which suppresses the conclusion sentences (never a phantom 0%/100% PASS).
   */
  private cossecRatioUnavailable(
    id: number,
    name: string,
    nameEs: string,
    unit: string,
    threshold: string,
    thresholdDirection: CossecRatioResult['thresholdDirection'],
    description: string,
    descriptionEs: string,
  ): CossecRatioResult {
    return {
      id,
      name,
      nameEs,
      value: 0,
      unit,
      threshold,
      thresholdDirection,
      status: 'data_unavailable',
      description,
      descriptionEs,
      examReadinessContribution: 0,
      sectorMedian: null,
      percentileRank: null,
      percentileRankEs: null,
    };
  }

  /**
   * Statutory risk weight for a balance-sheet subcategory under Ley 255-2002
   * Art. 6.02(d) — "activos sujetos a riesgo". Cash/equivalents 0%, investment
   * securities 20% (agency default), 1st-lien residential mortgages 50%
   * (Ley 185-2006 sets secondary-market-eligible loans to 0%, which the
   * subcategory alone cannot distinguish — 50% is the conservative default,
   * disclosed via gap), consumer 75%, commercial 100%, everything else 100%.
   */
  private cossecRiskWeight(subcategory: string): number {
    switch (subcategory) {
      case 'cash_equivalents':
        return 0.0;
      case 'investment_securities':
        return 0.2;
      case 'residential_mortgages':
        return 0.5;
      case 'consumer_loans':
        return 0.75;
      case 'commercial_loans':
        return 1.0;
      default:
        return 1.0;
    }
  }

  async getCOSSECCompliance(
    institutionId: string,
  ): Promise<COSSECComplianceResult> {
    const institution = await this.getInstitution(institutionId);
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    // D1 (2026-04-07): refuse to compute the 12-ratio engine on an empty
    // balance sheet. The previous implementation .reduce()'d to zero across
    // every aggregation, producing a `COSSECComplianceResult` where every
    // ratio was 0 — a regulator reading that report would conclude the
    // cooperativa was insolvent. Emit a CRITICAL gap and return a structured
    // `data_unavailable` shell so callers can render explicit DATA UNAVAILABLE
    // markers instead of phantom zeros.
    if (items.length === 0) {
      this.logger.warn({
        event: 'cossec_data_unavailable',
        institutionId,
        reason: 'EMPTY_BALANCE_SHEET',
      });
      return this.cossecDataUnavailableResult(institution);
    }

    // ── Aggregate balance sheet ──
    const assetItems = items.filter((i: any) => i.category === 'asset');
    const liabilityItems = items.filter((i: any) => i.category === 'liability');

    const totalAssets = assetItems.reduce(
      (s: any, i: any) => s + Number(i.balance),
      0,
    );
    const totalLiabilities = liabilityItems.reduce(
      (s: any, i: any) => s + Number(i.balance),
      0,
    );
    const equity = totalAssets - totalLiabilities;

    const loanSubcats = [
      'consumer_loans',
      'residential_mortgages',
      'commercial_loans',
    ];
    const depositSubcats = [
      'savings_deposits',
      'demand_deposits',
      'time_deposits',
    ];
    const liquidSubcats = ['cash_equivalents', 'investment_securities'];
    const earningSubcats = [...loanSubcats, 'investment_securities'];

    const totalLoans = assetItems
      .filter((i: any) => loanSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const totalShares = liabilityItems
      .filter((i: any) => depositSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const liquidAssets = assetItems
      .filter((i: any) => liquidSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const earningAssets = assetItems
      .filter((i: any) => earningSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const interestBearingLiabilities = liabilityItems
      .filter((i: any) => i.rate > 0)
      .reduce((s: any, i: any) => s + Number(i.balance), 0);

    // Weighted interest income/expense (annualized, in $M)
    const interestIncome = assetItems
      .filter((i: any) => earningSubcats.includes(i.subcategory))
      .reduce(
        (s: any, i: any) =>
          s + i.balance * (i.rate > 1 ? i.rate / 100 : i.rate),
        0,
      );
    const interestExpense = liabilityItems
      .filter((i: any) => i.rate > 0)
      .reduce(
        (s: any, i: any) =>
          s + i.balance * (i.rate > 1 ? i.rate / 100 : i.rate),
        0,
      );

    // ── Derived ratios ──
    const capitalRatio = totalAssets > 0 ? (equity / totalAssets) * 100 : 0;
    // ── Statutory capital ratio (Ley 255-2002 Art. 6.02 / 7 L.P.R.A. §1366a) ──
    // COSSEC's 8% minimum is measured against "activos sujetos a riesgo"
    // (risk-weighted assets) with a "capital indivisible" reserve numerator —
    // NOT equity/total-assets. We compute the RWA denominator from per-category
    // statutory risk weights; the reserve composition is not on the uploaded
    // balance sheet, so net worth (patrimonio) is a DISCLOSED numerator proxy
    // (WARNING gap below), never a fabricated statutory figure (D1). The
    // leverage view `capitalRatio` (equity/total-assets) is retained for trend
    // and summary back-compat.
    const riskWeightedAssets = assetItems.reduce(
      (s: number, i: { balance: number; subcategory: string }) =>
        s + Number(i.balance) * this.cossecRiskWeight(i.subcategory),
      0,
    );
    const capitalRatioRWA =
      riskWeightedAssets > 0 ? (equity / riskWeightedAssets) * 100 : 0;
    const loanToShareRatio =
      totalShares > 0 ? (totalLoans / totalShares) * 100 : 0;
    const liquidityRatio =
      totalAssets > 0 ? (liquidAssets / totalAssets) * 100 : 0;
    const earningAssetsYield =
      earningAssets > 0 ? (interestIncome / earningAssets) * 100 : 0;
    const costOfFunds =
      interestBearingLiabilities > 0
        ? (interestExpense / interestBearingLiabilities) * 100
        : 0;
    const nim =
      earningAssets > 0
        ? ((interestIncome - interestExpense) / earningAssets) * 100
        : 0;

    // Concentration risk: largest subcategory as % of total loans
    const sectorMap = new Map<string, number>();
    for (const item of assetItems.filter((i: any) =>
      loanSubcats.includes(i.subcategory),
    )) {
      sectorMap.set(
        item.subcategory,
        (sectorMap.get(item.subcategory) || 0) + Number(item.balance),
      );
    }
    let largestSectorName = 'N/A';
    let largestSectorBalance = 0;
    for (const [sector, bal] of sectorMap) {
      if (bal > largestSectorBalance) {
        largestSectorBalance = bal;
        largestSectorName = sector;
      }
    }
    const largestSectorPct =
      totalLoans > 0 ? (largestSectorBalance / totalLoans) * 100 : 0;

    // Reuse existing calculations
    const lcr = await this.calculateLCR(institutionId);
    const durationGap = await this.calculateDurationGap(institutionId);
    const niiSensitivity = await this.calculateNIISensitivity(institutionId);

    // EVE sensitivity from +200bps — prefer convexity-adjusted DurationService
    let eveSensitivity = 0;
    try {
      if (items.length > 0) {
        const evePoints = this.durationService.calculateEVESensitivity(
          durationGap.assetDuration,
          durationGap.assetConvexity || 0,
          totalAssets,
          durationGap.liabilityDuration,
          durationGap.liabilityConvexity || 0,
          totalLiabilities,
          [200],
        );
        const eve200Point = evePoints.find((p) => p.shockBps === 200);
        if (eve200Point) {
          eveSensitivity = Math.abs(eve200Point.eveChangePct);
        }
      }
    } catch {
      // Fallback to old NII-based EVE estimate
    }
    if (eveSensitivity === 0) {
      const eve200 = niiSensitivity.scenarios.find((s) => s.shiftBps === 200);
      eveSensitivity = eve200 ? Math.abs(eve200.mveImpactPct) : 0;
    }

    // ── D1: partial-balance-sheet detection ──
    // The empty-balance-sheet guard above only fires when `items.length === 0`.
    // A PARTIAL load (e.g. loans entered but member shares not yet, or only a
    // liability side present) silently zeroes denominators, which previously
    // rendered as 0%/100% PASS ratios on the regulator-bound COSSEC PDF — a
    // textbook silent zero (D1). Each ratio whose essential input is absent is
    // emitted as `data_unavailable` (mirroring the ratio-9/LCR pattern below)
    // with a structured gap; a single such ratio downgrades `overallStatus`
    // and short-circuits the conclusion sentences. Never a phantom 0/100% PASS.
    const noAssetSide = assetItems.length === 0;
    const noLiabilitySide = liabilityItems.length === 0;
    const noShares = totalShares <= 0;
    const noEarningAssets = earningAssets <= 0;
    const partialGaps: DataGap[] = [];
    if (noLiabilitySide || noAssetSide) {
      partialGaps.push(
        dataGap('cossec.capitalRatio', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'CRITICAL',
          action: noLiabilitySide
            ? 'Cargue los pasivos (depósitos y acciones de socios) — sin el lado de pasivos el capital no es calculable. / Load liabilities (member deposits and shares); capital cannot be computed without the liability side.'
            : 'Cargue los activos del balance antes de calcular la razón de capital. / Load balance-sheet assets before computing the capital ratio.',
        }),
      );
    }
    if (noAssetSide) {
      partialGaps.push(
        dataGap('cossec.liquidityRatio', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'CRITICAL',
          action:
            'Cargue los activos (efectivo e inversiones) para calcular la razón de liquidez. / Load assets (cash and investments) to compute the liquidity ratio.',
        }),
      );
    }
    if (noShares) {
      partialGaps.push(
        dataGap('cossec.loanToShareRatio', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'CRITICAL',
          action:
            'Cargue los depósitos y acciones de socios — la razón préstamos/depósitos no es calculable sin ellos. / Load member deposits and shares; the loan-to-deposit ratio cannot be computed without them.',
        }),
      );
    }
    if (noEarningAssets) {
      partialGaps.push(
        dataGap('cossec.nim', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'WARNING',
          action:
            'Cargue los activos productivos (préstamos e inversiones) para calcular el margen de interés neto. / Load earning assets (loans and investments) to compute net interest margin.',
        }),
      );
    }

    // Statutory capital ratio is computable only when both sides are present
    // and there is a non-zero risk-weighted-asset base.
    const capitalRatioComputable =
      !noLiabilitySide && !noAssetSide && riskWeightedAssets > 0;
    if (capitalRatioComputable) {
      // Always disclose the statutory-basis proxy (D1 honesty): the displayed
      // figure uses net worth as a proxy for the capital indivisible reserve
      // and default Art. 6.02(d) risk weights.
      partialGaps.push(
        dataGap('cossec.capitalRatio.basis', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'WARNING',
          action:
            'Ley 255 Art. 6.02: el numerador estatutario es el capital indivisible (no el patrimonio total) y el denominador son los activos sujetos a riesgo. Se usó el patrimonio neto como proxy del numerador y pesos de riesgo por defecto (hipoteca 50%, consumo 75%, comercial 100%, efectivo 0%); cargue la composición de la reserva de capital indivisible para la cifra definitiva. / Act 255 §6.02: the statutory numerator is indivisible capital (not total equity) and the denominator is risk-weighted assets; net worth was used as a numerator proxy with default risk weights — provide the indivisible-capital reserve composition for the definitive figure.',
        }),
      );
      if (capitalRatioRWA < 8) {
        partialGaps.push(
          dataGap('cossec.surplusAllocation', 'COSSEC_INPUTS_INSUFFICIENT', {
            severity: 'WARNING',
            action:
              'Bajo el 8%: Ley 255 Art. 6.02 exige separar anualmente el mayor de 25% de las economías netas o 4% del ingreso neto de operaciones al capital indivisible, y mantener 35% de la reserva en activos líquidos. Estos sub-tests requieren datos de economías netas / ingreso neto no presentes en el balance. / Below 8%: Act 255 §6.02 requires annually allocating the greater of 25% of net earnings or 4% of net operating income to indivisible capital, and holding 35% of the reserve in liquid assets; these sub-tests need net-earnings inputs not present.',
          }),
        );
      }
    }

    // Worst absolute % NII change across the rate-shock scenarios — the actual
    // measured figure for the NII-sensitivity ratio (RC-1: replaces a synthetic
    // 0-100 score that did not match its own "%" threshold).
    const niiWorstPct = niiSensitivity.scenarios.length
      ? Math.max(
          ...niiSensitivity.scenarios.map((s) => Math.abs(s.niImpactPct)),
        )
      : 0;

    // ── Build 12 COSSEC ratios ──
    const b = PR_COOP_BENCHMARKS.ratios;
    const ratios: CossecRatioResult[] = [
      !capitalRatioComputable
        ? this.cossecRatioUnavailable(
            1,
            'Capital Adequacy',
            'Suficiencia de Capital',
            '%',
            '>= 8%',
            'gte',
            'Statutory capital ratio not computable — balance sheet incomplete or no risk-weighted assets. See gaps manifest.',
            'Razón de capital estatutaria no calculable — balance incompleto o sin activos sujetos a riesgo. Ver datos pendientes.',
          )
        : this.buildRatio(
            1,
            'Capital Adequacy',
            'Suficiencia de Capital',
            capitalRatioRWA,
            '%',
            '>= 8%',
            'gte',
            capitalRatioRWA >= 8 ? 'pass' : 'fail',
            `Indivisible capital (proxy: net worth) / Risk-weighted assets: ${round(capitalRatioRWA, 1)}%. Statutory minimum (Act 255 §6.02): 8%.`,
            `Capital indivisible (proxy: patrimonio) / Activos sujetos a riesgo: ${round(capitalRatioRWA, 1)}%. Mínimo estatutario (Ley 255 Art. 6.02): 8%.`,
            20,
            // No sector percentile: the RWA-based statutory ratio is not
            // comparable to the leverage-ratio (equity/total-assets) benchmark.
            null,
            capitalRatioRWA,
            false,
          ),

      this.buildRatio(
        2,
        'Asset Quality (Est.)',
        'Calidad de Activos (Est.)',
        0,
        '%',
        '<= 3%',
        'lte',
        'pass',
        'Non-performing loan data not available from current balance sheet. Assumed healthy. COSSEC satisfactory delinquency threshold: <= 3%.',
        'Datos de morosidad no disponibles. Se asume buena calidad. Umbral COSSEC satisfactorio de morosidad: <= 3%.',
        15,
        b.assetQuality,
        0,
        true,
      ),

      noAssetSide
        ? this.cossecRatioUnavailable(
            3,
            'Liquidity Ratio',
            'Razón de Liquidez',
            '%',
            '>= 5%',
            'gte',
            'Liquidity ratio not computable — no asset-side balance loaded. See gaps manifest.',
            'Razón de liquidez no calculable — no hay activos cargados. Ver datos pendientes.',
          )
        : this.buildRatio(
            3,
            'Liquidity Ratio',
            'Razón de Liquidez',
            liquidityRatio,
            '%',
            '>= 5%',
            'gte',
            liquidityRatio >= 5 ? 'pass' : 'fail',
            `Liquid assets/Total assets: ${round(liquidityRatio, 1)}%. Operational minimum (CC-2021-02): 5%.`,
            `Activos líquidos/Activos totales: ${round(liquidityRatio, 1)}%. Mínimo operacional (CC-2021-02): 5%.`,
            10,
            b.liquidity,
            liquidityRatio,
            false,
          ),

      noShares
        ? this.cossecRatioUnavailable(
            4,
            'Loan-to-Deposit Ratio',
            'Razón Préstamos/Depósitos',
            '%',
            '<= 80%',
            'lte',
            'Loan-to-deposit not computable — member deposits/shares not loaded. See gaps manifest.',
            'Razón préstamos/depósitos no calculable — faltan depósitos/acciones de socios. Ver datos pendientes.',
          )
        : this.buildRatio(
            4,
            'Loan-to-Deposit Ratio',
            'Razón Préstamos/Depósitos',
            loanToShareRatio,
            '%',
            '<= 80%',
            'lte',
            loanToShareRatio <= 80
              ? 'pass'
              : loanToShareRatio <= 100
                ? 'warning'
                : 'fail',
            `Loans/Deposits: ${round(loanToShareRatio, 1)}%. Target: <=80%.`,
            `Préstamos/Depósitos: ${round(loanToShareRatio, 1)}%. Meta de gestión: <=80%.`,
            10,
            b.loanToDeposit,
            loanToShareRatio,
            true,
          ),

      this.buildRatio(
        5,
        'NII Sensitivity',
        'Sensibilidad NII',
        round(niiWorstPct, 1),
        '%',
        '<= 20%',
        'lte',
        niiWorstPct <= 10 ? 'pass' : niiWorstPct <= 20 ? 'warning' : 'fail',
        `Worst NII change across rate shocks: ${round(niiWorstPct, 1)}% (rating: ${niiSensitivity.riskRating}). COSSEC CC-2020-03: <=10% low, 10-20% moderate, >20% high. Base NII: $${niiSensitivity.baseNII.toFixed(1)}M.`,
        `Peor cambio de NII bajo shocks de tasa: ${round(niiWorstPct, 1)}% (clasificación: ${niiSensitivity.riskRating}). COSSEC CC-2020-03: <=10% bajo, 10-20% moderado, >20% alto. NII base: $${niiSensitivity.baseNII.toFixed(1)}M.`,
        10,
        null,
        0,
        true,
      ),

      this.buildRatio(
        6,
        'Duration Gap',
        'Brecha de Duración',
        durationGap.durationGap,
        'yr',
        '-1yr to +3yr',
        'range',
        Math.abs(durationGap.durationGap) <= 1
          ? 'pass'
          : Math.abs(durationGap.durationGap) <= 3
            ? 'warning'
            : 'fail',
        `Gap: ${durationGap.durationGap > 0 ? '+' : ''}${durationGap.durationGap.toFixed(2)}yr. Profile: ${durationGap.riskProfile}.`,
        `Brecha: ${durationGap.durationGap > 0 ? '+' : ''}${durationGap.durationGap.toFixed(2)} años. Perfil: ${durationGap.riskProfile}.`,
        10,
        b.durationGap,
        Math.abs(durationGap.durationGap),
        true,
      ),

      this.buildRatio(
        7,
        'EVE Sensitivity',
        'Sensibilidad EVE',
        eveSensitivity,
        '%',
        '<= 25%',
        'lte',
        eveSensitivity <= 15
          ? 'pass'
          : eveSensitivity <= 25
            ? 'warning'
            : 'fail',
        `EVE change per +200bps: ${round(eveSensitivity, 1)}%. Threshold: <=25%.`,
        `Cambio EVE por +200bps: ${round(eveSensitivity, 1)}%. Umbral: <=25%.`,
        5,
        null,
        0,
        true,
      ),

      this.buildRatio(
        8,
        'Concentration Risk',
        'Riesgo de Concentración',
        largestSectorPct,
        '%',
        '<= 25%',
        'lte',
        largestSectorPct <= 25
          ? 'pass'
          : largestSectorPct <= 40
            ? 'warning'
            : 'fail',
        `Largest sector (${largestSectorName}): ${round(largestSectorPct, 1)}% of loans.`,
        `Mayor sector (${largestSectorName}): ${round(largestSectorPct, 1)}% de préstamos.`,
        5,
        b.concentrationRisk,
        largestSectorPct,
        true,
      ),

      // Ratio #9 — LCR. When `lcr.lcr` is null (no liquidity data), emit a
      // `data_unavailable` ratio shape so the array stays length-12 for
      // downstream consumers, but the status communicates "not a real number".
      // The parent COSSECComplianceResult.gaps array carries the canonical gap.
      lcr.lcr === null
        ? ({
            id: 9,
            name: 'LCR (Basel III)',
            nameEs: 'LCR (Basilea III)',
            value: 0, // sentinel — see status + parent gaps
            unit: '%',
            threshold: '>= 100%',
            thresholdDirection: 'gte',
            status: 'data_unavailable',
            description:
              'LCR cannot be calculated — liquidity inputs missing. See gaps manifest.',
            descriptionEs:
              'LCR no se puede calcular — faltan datos de liquidez. Ver manifiesto de brechas.',
            examReadinessContribution: 0,
            sectorMedian: null,
            percentileRank: null,
            percentileRankEs: null,
          } as CossecRatioResult)
        : this.buildRatio(
            9,
            'LCR (Basel III)',
            'LCR (Basilea III)',
            lcr.lcr,
            '%',
            '>= 100%',
            'gte',
            lcr.lcr >= 120 ? 'pass' : lcr.lcr >= 100 ? 'warning' : 'fail',
            `HQLA/Net outflows: ${round(lcr.lcr, 1)}%. Required: 100%. Target: 120%+.`,
            `HQLA/Flujos netos: ${round(lcr.lcr, 1)}%. Requerido: 100%. Meta: 120%+.`,
            5,
            b.lcr,
            lcr.lcr,
            false,
          ),

      this.buildRatio(
        10,
        'Earning Assets Yield',
        'Rendimiento Activos Productivos',
        earningAssetsYield,
        '%',
        'Benchmark',
        'info',
        'info',
        `Interest income / Earning assets: ${round(earningAssetsYield, 2)}%. PR median: ${b.earningAssetsYield.median}%.`,
        `Ingreso por intereses / Activos productivos: ${round(earningAssetsYield, 2)}%. Mediana PR: ${b.earningAssetsYield.median}%.`,
        0,
        b.earningAssetsYield,
        earningAssetsYield,
        false,
      ),

      this.buildRatio(
        11,
        'Cost of Funds',
        'Costo de Fondos',
        costOfFunds,
        '%',
        'Benchmark',
        'info',
        'info',
        `Interest expense / Interest-bearing liabilities: ${round(costOfFunds, 2)}%. PR median: ${b.costOfFunds.median}%.`,
        `Gasto por intereses / Pasivos con intereses: ${round(costOfFunds, 2)}%. Mediana PR: ${b.costOfFunds.median}%.`,
        0,
        b.costOfFunds,
        costOfFunds,
        true,
      ),

      noEarningAssets
        ? this.cossecRatioUnavailable(
            12,
            'Net Interest Margin',
            'Margen de Interés Neto',
            '%',
            'Benchmark (>= 2.5%)',
            'gte',
            'NIM not computable — no earning assets (loans/investments) loaded. See gaps manifest.',
            'MNI no calculable — no hay activos productivos (préstamos/inversiones) cargados. Ver datos pendientes.',
          )
        : this.buildRatio(
            12,
            'Net Interest Margin',
            'Margen de Interés Neto',
            nim,
            '%',
            'Benchmark (>= 2.5%)',
            'gte',
            // Bible §E / NIM: an institution-specific benchmark, NOT a hard
            // COSSEC floor — significant deviation triggers review, never a
            // pass/fail "NO CUMPLE". Below the benchmark = warning (review).
            nim >= 2.5 ? 'pass' : 'warning',
            `NIM: ${round(nim, 2)}%. COSSEC benchmark (significant deviation triggers review). PR median: ${b.nim.median}%.`,
            `MNI: ${round(nim, 2)}%. Referencia COSSEC (desviación significativa requiere revisión). Mediana PR: ${b.nim.median}%.`,
            10,
            b.nim,
            nim,
            false,
          ),
    ];

    // Exam readiness: sum of weights for PASS ratios (max 100)
    const examReadinessScore = ratios
      .filter((r) => r.status === 'pass')
      .reduce((s, r) => s + r.examReadinessContribution, 0);

    // Legacy checks (backward compat with old 4-check code). Filter out both
    // 'info' and 'data_unavailable' — these aren't real pass/warn/fail signals.
    const checks: COSSECCheck[] = ratios
      .filter((r) => r.status !== 'info' && r.status !== 'data_unavailable')
      .slice(0, 9)
      .map((r) => ({
        name: r.name,
        nameEs: r.nameEs,
        value: round(r.value, 2),
        // D23: parseFloat + || 0 let Infinity slip through (`|| 0`
        // only fires on falsy values; Infinity is truthy). Thresholds
        // here span wildly different scales (% ratios, year counts,
        // score units like 15100 for NII sensitivity, negative years
        // like -13 for duration gap). Use generous bounds that only
        // reject Infinity/NaN — the point of this change is strictness
        // on non-finite values, not on range.
        threshold:
          parseFinancialField(r.threshold.replace(/[^0-9.-]/g, ''), {
            min: -1e9,
            max: 1e9,
          }) ?? 0,
        unit: r.unit,
        // After the filter above, status is narrowed to pass | warning | fail.
        status: r.status as 'pass' | 'warning' | 'fail',
        description: r.description,
        descriptionEs: r.descriptionEs,
      }));

    // D1: a single CRITICAL data_unavailable ratio downgrades the WHOLE
    // overall status to data_unavailable, even if other ratios pass. We do
    // not want a presenter to render "compliant" overall while one ratio is
    // missing — that's exactly the silent-zero failure mode.
    const overallStatus: COSSECComplianceResult['overallStatus'] = ratios.some(
      (r) => r.status === 'data_unavailable',
    )
      ? 'data_unavailable'
      : ratios.some((r) => r.status === 'fail')
        ? 'non-compliant'
        : ratios.some((r) => r.status === 'warning')
          ? 'conditional'
          : 'compliant';

    // Aggregate gaps from sub-calculations (currently just LCR; future:
    // duration, NII, COSSEC-specific data shortfalls all flow through here).
    const cossecGaps = mergeGaps(lcr.gaps, partialGaps);

    return {
      institutionName: institution.name,
      institutionType: institution.type,
      reportingDate: institution.reportingDate.toISOString(),
      checks,
      ratios,
      examReadinessScore,
      overallStatus,
      ...(cossecGaps.length > 0 && { gaps: cossecGaps }),
      summary: {
        totalAssets,
        totalLiabilities,
        equity,
        totalLoans,
        totalShares,
        liquidAssets,
        capitalRatio: round(capitalRatio, 2),
        capitalRatioRWA: round(capitalRatioRWA, 2),
        riskWeightedAssets: round(riskWeightedAssets, 2),
        loanToShareRatio: round(loanToShareRatio, 2),
        liquidityRatio: round(liquidityRatio, 2),
        earningAssets: round(earningAssets, 2),
        interestIncome: round(interestIncome, 2),
        interestExpense: round(interestExpense, 2),
        nim: round(nim, 2),
        earningAssetsYield: round(earningAssetsYield, 2),
        costOfFunds: round(costOfFunds, 2),
        largestSectorPct: round(largestSectorPct, 2),
        largestSectorName,
      },
    };
  }

  // ─── Multi-Period Trend Analysis ────────────────────────────────

  /**
   * Returns COSSEC compliance data enriched with trend deltas from the
   * most recent prior completed AnalysisRun for the same institution.
   * Gracefully returns trends: null when no previous period exists.
   */
  async getCOSSECComplianceWithTrend(
    institutionId: string,
  ): Promise<COSSECComplianceWithTrend> {
    const current = await this.getCOSSECCompliance(institutionId);

    // Find the previous completed analysis run for this institution (skip current)
    let previousRun: any = null;
    try {
      previousRun = await this.prisma.analysisRun.findFirst({
        where: { institutionId, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        skip: 1, // skip the current one, get the previous
      });
    } catch {
      // Table may not exist yet; graceful degradation
      this.logger.warn({
        event: 'trend.previous_run_lookup_failed',
        institutionId,
      });
    }

    if (!previousRun?.resultSummary) {
      return { ...current, trends: null, previousPeriod: null };
    }

    // Also check if there is a previous ReportJob with an analysisPeriod
    let previousPeriodLabel: string | null = null;
    try {
      const prevJob = await this.prisma.reportJob.findFirst({
        where: { institutionId, status: 'COMPLETE' },
        orderBy: { completedAt: 'desc' },
        skip: 1,
        select: { analysisPeriod: true, completedAt: true },
      });
      previousPeriodLabel =
        prevJob?.analysisPeriod ||
        (previousRun.createdAt
          ? this.derivePeriodLabel(previousRun.createdAt)
          : null);
    } catch {
      previousPeriodLabel = previousRun.createdAt
        ? this.derivePeriodLabel(previousRun.createdAt)
        : null;
    }

    const prevSummary = previousRun.resultSummary;
    const trends = this.calculateTrendDeltas(
      current.ratios,
      prevSummary,
      previousPeriodLabel || 'Prior',
    );

    return { ...current, trends, previousPeriod: previousPeriodLabel };
  }

  /**
   * Calculate deltas between current ratios and previous period's summary.
   * Maps stored resultSummary keys to ratio IDs.
   */
  private calculateTrendDeltas(
    currentRatios: CossecRatioResult[],
    prevSummary: any,
    previousPeriod: string,
  ): TrendDelta[] {
    // Map ratio IDs to the keys stored in resultSummary
    const prevMapping: Record<number, { key: string; lowerIsBetter: boolean }> =
      {
        1: { key: 'capitalRatio', lowerIsBetter: false },
        3: { key: 'liquidityRatio', lowerIsBetter: false },
        4: { key: 'loanToShareRatio', lowerIsBetter: true },
        8: { key: 'largestSectorPct', lowerIsBetter: true },
        10: { key: 'earningAssetsYield', lowerIsBetter: false },
        11: { key: 'costOfFunds', lowerIsBetter: true },
        12: { key: 'nim', lowerIsBetter: false },
      };

    const trends: TrendDelta[] = [];

    for (const ratio of currentRatios) {
      const mapping = prevMapping[ratio.id];
      if (!mapping) continue;

      // Look for key in prevSummary or prevSummary.summary
      const prevData = prevSummary.summary || prevSummary;
      const prevValue = prevData[mapping.key];
      if (prevValue == null || typeof prevValue !== 'number') continue;

      const delta = round(ratio.value - prevValue, 2);
      const deltaBps = ratio.unit === '%' ? Math.round(delta * 100) : undefined;

      // Determine trend direction
      const STABLE_THRESHOLD = 0.05; // 5bps for percentages
      let trend: 'improving' | 'deteriorating' | 'stable';
      if (Math.abs(delta) < STABLE_THRESHOLD) {
        trend = 'stable';
      } else if (mapping.lowerIsBetter) {
        trend = delta < 0 ? 'improving' : 'deteriorating';
      } else {
        trend = delta > 0 ? 'improving' : 'deteriorating';
      }

      trends.push({
        ratioId: ratio.id,
        ratioName: ratio.name,
        ratioNameEs: ratio.nameEs,
        currentValue: ratio.value,
        previousValue: round(prevValue, 2),
        delta,
        deltaBps,
        trend,
        unit: ratio.unit,
        previousPeriod,
      });
    }

    return trends;
  }

  /** Derive a period label like "Q1-2026" from a date. */
  private derivePeriodLabel(date: Date): string {
    const q = Math.ceil((date.getMonth() + 1) / 3);
    return `Q${q}-${date.getFullYear()}`;
  }

  private buildRatio(
    id: number,
    name: string,
    nameEs: string,
    value: number,
    unit: string,
    threshold: string,
    thresholdDirection: 'gte' | 'lte' | 'range' | 'info',
    status: 'pass' | 'warning' | 'fail' | 'info',
    description: string,
    descriptionEs: string,
    examReadinessContribution: number,
    benchmark: SectorBenchmark | null,
    benchmarkValue: number,
    lowerIsBetter: boolean,
  ): CossecRatioResult {
    let sectorMedian: number | null = null;
    let percentileRank: string | null = null;
    let percentileRankEs: string | null = null;

    if (benchmark) {
      sectorMedian = benchmark.median;
      const rank = getPercentileRank(benchmarkValue, benchmark, lowerIsBetter);
      percentileRank = rank.rank;
      percentileRankEs = rank.rankEs;
    }

    return {
      id,
      name,
      nameEs,
      value: round(value, 2),
      unit,
      threshold,
      thresholdDirection,
      status,
      description,
      descriptionEs,
      examReadinessContribution,
      sectorMedian,
      percentileRank,
      percentileRankEs,
    };
  }

  // ─── Framework-Aware Regulatory Compliance ──────────────────

  /**
   * Dispatch to the correct compliance engine based on the institution's
   * primaryRegulator field. Returns the same COSSECComplianceResult type
   * for frontend compatibility — only the ratio names, thresholds, and
   * weights differ between frameworks.
   */
  async getRegulatoryCompliance(
    institutionId: string,
  ): Promise<COSSECComplianceResult> {
    const institution = await this.getInstitution(institutionId);
    const framework = getFramework(institution.primaryRegulator);

    if (framework.id === 'ncua-us') {
      return this.calculateNcuaCompliance(institutionId, framework);
    }
    // Default: COSSEC
    return this.getCOSSECCompliance(institutionId);
  }

  /**
   * NCUA CAMEL compliance engine.
   *
   * Computes 7 NCUA-specific ratios from the same balance-sheet data
   * used by the COSSEC engine, returning a COSSECComplianceResult for
   * frontend compatibility. The remaining 5 slots (up to 12) are filled
   * with 'N/A' placeholders so the 12-ratio grid renders cleanly.
   */
  async calculateNcuaCompliance(
    institutionId: string,
    framework: IRegulatoryFramework,
  ): Promise<COSSECComplianceResult> {
    const institution = await this.getInstitution(institutionId);
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    // ── Aggregate balance sheet ──
    const assetItems = items.filter((i: any) => i.category === 'asset');
    const liabilityItems = items.filter((i: any) => i.category === 'liability');

    const totalAssets = assetItems.reduce(
      (s: any, i: any) => s + Number(i.balance),
      0,
    );
    const totalLiabilities = liabilityItems.reduce(
      (s: any, i: any) => s + Number(i.balance),
      0,
    );
    const equity = totalAssets - totalLiabilities;

    const loanSubcats = [
      'consumer_loans',
      'residential_mortgages',
      'commercial_loans',
    ];
    const depositSubcats = [
      'savings_deposits',
      'demand_deposits',
      'time_deposits',
    ];
    const liquidSubcats = ['cash_equivalents', 'investment_securities'];
    const earningSubcats = [...loanSubcats, 'investment_securities'];

    const totalLoans = assetItems
      .filter((i: any) => loanSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const totalShares = liabilityItems
      .filter((i: any) => depositSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const liquidAssets = assetItems
      .filter((i: any) => liquidSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const earningAssets = assetItems
      .filter((i: any) => earningSubcats.includes(i.subcategory))
      .reduce((s: any, i: any) => s + Number(i.balance), 0);
    const interestBearingLiabilities = liabilityItems
      .filter((i: any) => i.rate > 0)
      .reduce((s: any, i: any) => s + Number(i.balance), 0);

    // Weighted interest income/expense (annualized, in $M)
    const interestIncome = assetItems
      .filter((i: any) => earningSubcats.includes(i.subcategory))
      .reduce(
        (s: any, i: any) =>
          s + i.balance * (i.rate > 1 ? i.rate / 100 : i.rate),
        0,
      );
    const interestExpense = liabilityItems
      .filter((i: any) => i.rate > 0)
      .reduce(
        (s: any, i: any) =>
          s + i.balance * (i.rate > 1 ? i.rate / 100 : i.rate),
        0,
      );

    // ── NCUA CAMEL Ratios ──

    // 1. Net Worth Ratio (Capital): equity / totalAssets * 100
    const netWorthRatio = totalAssets > 0 ? (equity / totalAssets) * 100 : 0;
    const netWorthStatus: 'pass' | 'warning' | 'fail' =
      netWorthRatio >= 7 ? 'pass' : netWorthRatio >= 6 ? 'warning' : 'fail';

    // 2. Delinquency Ratio (Asset Quality): estimated from loan quality
    // Balance sheet doesn't carry NPL data — estimate conservatively
    const delinquencyRatio = 0; // will show as info/estimated
    const delinquencyStatus: 'pass' | 'warning' | 'fail' = 'pass'; // assumed healthy

    // 3. Return on Assets (Earnings): (interestIncome - interestExpense) / totalAssets * 100
    const roa =
      totalAssets > 0
        ? ((interestIncome - interestExpense) / totalAssets) * 100
        : 0;
    const roaStatus: 'pass' | 'warning' | 'fail' =
      roa >= 0.5 ? 'pass' : roa >= 0.25 ? 'warning' : 'fail';

    // 4. Operating Expense Ratio: estimated from available data
    // Proxy: interest expense as % of total income (conservative)
    const operatingExpenseRatio =
      interestIncome > 0 ? (interestExpense / interestIncome) * 100 : 0;
    const opexStatus: 'pass' | 'warning' | 'fail' =
      operatingExpenseRatio <= 75
        ? 'pass'
        : operatingExpenseRatio <= 85
          ? 'warning'
          : 'fail';

    // 5. Liquidity Ratio: (cash + shortTermSecurities) / totalAssets * 100
    const liquidityRatio =
      totalAssets > 0 ? (liquidAssets / totalAssets) * 100 : 0;
    const liquidityStatus: 'pass' | 'warning' | 'fail' =
      liquidityRatio >= 10 ? 'pass' : liquidityRatio >= 7 ? 'warning' : 'fail';

    // 6. Loan-to-Share Ratio: totalLoans / totalDeposits * 100
    const loanToShareRatio =
      totalShares > 0 ? (totalLoans / totalShares) * 100 : 0;
    const ltsStatus: 'pass' | 'warning' | 'fail' =
      loanToShareRatio <= 90
        ? 'pass'
        : loanToShareRatio <= 100
          ? 'warning'
          : 'fail';

    // 7. Net Interest Margin
    const nim =
      earningAssets > 0
        ? ((interestIncome - interestExpense) / earningAssets) * 100
        : 0;
    const nimStatus: 'pass' | 'warning' | 'fail' =
      nim >= 2.0 ? 'pass' : nim >= 1.5 ? 'warning' : 'fail';

    // Derived shared values
    const capitalRatio = netWorthRatio;
    const earningAssetsYield =
      earningAssets > 0 ? (interestIncome / earningAssets) * 100 : 0;
    const costOfFunds =
      interestBearingLiabilities > 0
        ? (interestExpense / interestBearingLiabilities) * 100
        : 0;

    // Concentration (for summary only)
    const sectorMap = new Map<string, number>();
    for (const item of assetItems.filter((i: any) =>
      loanSubcats.includes(i.subcategory),
    )) {
      sectorMap.set(
        item.subcategory,
        (sectorMap.get(item.subcategory) || 0) + Number(item.balance),
      );
    }
    let largestSectorName = 'N/A';
    let largestSectorBalance = 0;
    for (const [sector, bal] of sectorMap) {
      if (bal > largestSectorBalance) {
        largestSectorBalance = bal;
        largestSectorName = sector;
      }
    }
    const largestSectorPct =
      totalLoans > 0 ? (largestSectorBalance / totalLoans) * 100 : 0;

    // ── Build 7 NCUA ratios ──
    const fwRatios = framework.ratios;
    const ratios: CossecRatioResult[] = [
      this.buildRatio(
        fwRatios[0].id,
        fwRatios[0].name,
        fwRatios[0].nameEs,
        netWorthRatio,
        '%',
        fwRatios[0].threshold,
        fwRatios[0].thresholdDirection,
        netWorthStatus,
        `Net Worth/Assets: ${round(netWorthRatio, 1)}%. Well-capitalized: >=7%. Adequately: 6-7%.`,
        `Capital Neto/Activos: ${round(netWorthRatio, 1)}%. Bien capitalizado: >=7%.`,
        fwRatios[0].weight,
        null,
        0,
        false,
      ),
      this.buildRatio(
        fwRatios[1].id,
        fwRatios[1].name,
        fwRatios[1].nameEs,
        delinquencyRatio,
        '%',
        fwRatios[1].threshold,
        fwRatios[1].thresholdDirection,
        delinquencyStatus,
        'Delinquent loan data not available from balance sheet. Assumed healthy.',
        'Datos de morosidad no disponibles del balance. Se asume buena calidad.',
        fwRatios[1].weight,
        null,
        0,
        true,
      ),
      this.buildRatio(
        fwRatios[2].id,
        fwRatios[2].name,
        fwRatios[2].nameEs,
        roa,
        '%',
        fwRatios[2].threshold,
        fwRatios[2].thresholdDirection,
        roaStatus,
        `Net Income/Assets: ${round(roa, 2)}%. Target: >=0.5%.`,
        `Ingreso Neto/Activos: ${round(roa, 2)}%. Meta: >=0.5%.`,
        fwRatios[2].weight,
        null,
        0,
        false,
      ),
      this.buildRatio(
        fwRatios[3].id,
        fwRatios[3].name,
        fwRatios[3].nameEs,
        operatingExpenseRatio,
        '%',
        fwRatios[3].threshold,
        fwRatios[3].thresholdDirection,
        opexStatus,
        `Operating expenses / income (est.): ${round(operatingExpenseRatio, 1)}%. Target: <=75%.`,
        `Gastos operativos / ingresos (est.): ${round(operatingExpenseRatio, 1)}%. Meta: <=75%.`,
        fwRatios[3].weight,
        null,
        0,
        true,
      ),
      this.buildRatio(
        fwRatios[4].id,
        fwRatios[4].name,
        fwRatios[4].nameEs,
        liquidityRatio,
        '%',
        fwRatios[4].threshold,
        fwRatios[4].thresholdDirection,
        liquidityStatus,
        `Liquid assets/Total assets: ${round(liquidityRatio, 1)}%. NCUA minimum: 10%.`,
        `Activos líquidos/Activos totales: ${round(liquidityRatio, 1)}%. Mínimo NCUA: 10%.`,
        fwRatios[4].weight,
        null,
        0,
        false,
      ),
      this.buildRatio(
        fwRatios[5].id,
        fwRatios[5].name,
        fwRatios[5].nameEs,
        loanToShareRatio,
        '%',
        fwRatios[5].threshold,
        fwRatios[5].thresholdDirection,
        ltsStatus,
        `Loans/Shares: ${round(loanToShareRatio, 1)}%. NCUA guideline: <=90%.`,
        `Préstamos/Depósitos: ${round(loanToShareRatio, 1)}%. Guía NCUA: <=90%.`,
        fwRatios[5].weight,
        null,
        0,
        true,
      ),
      this.buildRatio(
        fwRatios[6].id,
        fwRatios[6].name,
        fwRatios[6].nameEs,
        nim,
        '%',
        fwRatios[6].threshold,
        fwRatios[6].thresholdDirection,
        nimStatus,
        `NIM: ${round(nim, 2)}%. NCUA target: >=2.0%.`,
        `MNI: ${round(nim, 2)}%. Meta NCUA: >=2.0%.`,
        fwRatios[6].weight,
        null,
        0,
        false,
      ),
    ];

    // Pad to 12 slots with N/A placeholders for grid compatibility
    for (let i = ratios.length + 1; i <= 12; i++) {
      ratios.push(
        this.buildRatio(
          i,
          'N/A',
          'N/A',
          0,
          '',
          'N/A',
          'info',
          'info',
          'Not applicable under NCUA framework.',
          'No aplica bajo el marco NCUA.',
          0,
          null,
          0,
          false,
        ),
      );
    }

    // Exam readiness: sum of weights for PASS ratios
    const examReadinessScore = ratios
      .filter((r) => r.status === 'pass')
      .reduce((s, r) => s + r.examReadinessContribution, 0);

    // Legacy checks (backward compat). Filter info + data_unavailable —
    // mirrors getCOSSECCompliance() above. See D1 in SESSION_HANDOFF.md §1.
    const checks: COSSECCheck[] = ratios
      .filter((r) => r.status !== 'info' && r.status !== 'data_unavailable')
      .slice(0, 9)
      .map((r) => ({
        name: r.name,
        nameEs: r.nameEs,
        value: round(r.value, 2),
        // D23: parseFloat + || 0 let Infinity slip through (`|| 0`
        // only fires on falsy values; Infinity is truthy). Thresholds
        // here span wildly different scales (% ratios, year counts,
        // score units like 15100 for NII sensitivity, negative years
        // like -13 for duration gap). Use generous bounds that only
        // reject Infinity/NaN — the point of this change is strictness
        // on non-finite values, not on range.
        threshold:
          parseFinancialField(r.threshold.replace(/[^0-9.-]/g, ''), {
            min: -1e9,
            max: 1e9,
          }) ?? 0,
        unit: r.unit,
        status: r.status as 'pass' | 'warning' | 'fail',
        description: r.description,
        descriptionEs: r.descriptionEs,
      }));

    const overallStatus: COSSECComplianceResult['overallStatus'] = ratios.some(
      (r) => r.status === 'data_unavailable',
    )
      ? 'data_unavailable'
      : ratios.some((r) => r.status === 'fail')
        ? 'non-compliant'
        : ratios.some((r) => r.status === 'warning')
          ? 'conditional'
          : 'compliant';

    return {
      institutionName: institution.name,
      institutionType: institution.type,
      reportingDate: institution.reportingDate.toISOString(),
      checks,
      ratios,
      examReadinessScore,
      overallStatus,
      summary: {
        totalAssets,
        totalLiabilities,
        equity,
        totalLoans,
        totalShares,
        liquidAssets,
        capitalRatio: round(capitalRatio, 2),
        loanToShareRatio: round(loanToShareRatio, 2),
        liquidityRatio: round(liquidityRatio, 2),
        earningAssets: round(earningAssets, 2),
        interestIncome: round(interestIncome, 2),
        interestExpense: round(interestExpense, 2),
        nim: round(nim, 2),
        earningAssetsYield: round(earningAssetsYield, 2),
        costOfFunds: round(costOfFunds, 2),
        largestSectorPct: round(largestSectorPct, 2),
        largestSectorName,
      },
    };
  }

  /**
   * Pure duration gap computation from pre-fetched items (no DB calls).
   */
  private calculateDurationGapFromItems(
    items: any[],
    bs: BalanceSheetDto,
  ): DurationGapSummary {
    if (items.length > 0) {
      const portfolio = this.durationService.calculatePortfolioMetrics(items);
      const gap = portfolio.leverageAdjustedDurationGap;
      const riskProfile: 'asset-sensitive' | 'liability-sensitive' | 'neutral' =
        Math.abs(gap) < 0.5
          ? 'neutral'
          : gap > 0
            ? 'asset-sensitive'
            : 'liability-sensitive';
      return {
        assetDuration: round(portfolio.assetDuration, 2),
        liabilityDuration: round(portfolio.liabilityDuration, 2),
        durationGap: round(gap, 2),
        riskProfile,
        assetConvexity: round(portfolio.assetConvexity, 4),
        liabilityConvexity: round(portfolio.liabilityConvexity, 4),
        leverageAdjustedDurationGap: round(
          portfolio.leverageAdjustedDurationGap,
          4,
        ),
      };
    }

    // Fallback to AlmService when no raw items
    const result = this.almService.durationGapAnalysis(bs);
    const gap = result.durationGap;
    return {
      assetDuration: round(result.assetDuration, 2),
      liabilityDuration: round(result.liabilityDuration, 2),
      durationGap: round(gap, 2),
      riskProfile:
        Math.abs(gap) < 0.5
          ? 'neutral'
          : gap > 0
            ? 'asset-sensitive'
            : 'liability-sensitive',
    };
  }

  /**
   * Pure NII sensitivity from pre-built BalanceSheetDto (no DB calls).
   */
  private calculateNIISensitivityFromBs(
    bs: BalanceSheetDto,
    rateShocksBps?: number[],
  ): NIISensitivityResult {
    const niiResult = this.almService.niiSimulation(bs, rateShocksBps);
    const eveResult = this.almService.eveAnalysis(bs, rateShocksBps);
    const scenarios = niiResult.scenarios
      .filter((s) => s.shockBps !== 0)
      .map((s) => {
        const eveScenario = eveResult.scenarios.find(
          (e) => e.shockBps === s.shockBps,
        );
        return {
          name: s.shockBps > 0 ? `+${s.shockBps}bps` : `${s.shockBps}bps`,
          shiftBps: s.shockBps,
          niImpact: round(s.change / 1_000_000, 2),
          niImpactPct: round(s.changePct * 100, 2),
          mveImpact: eveScenario ? round(eveScenario.change / 1_000_000, 2) : 0,
          mveImpactPct: eveScenario ? round(eveScenario.changePct * 100, 2) : 0,
        };
      });
    const worstPct = Math.max(...scenarios.map((s) => Math.abs(s.niImpactPct)));
    let riskRating: 'low' | 'moderate' | 'high' | 'critical';
    if (worstPct < 5) riskRating = 'low';
    else if (worstPct < 10) riskRating = 'moderate';
    else if (worstPct < 20) riskRating = 'high';
    else riskRating = 'critical';
    return {
      scenarios,
      baseNII: round(niiResult.baseNII / 1_000_000, 2),
      riskRating,
    };
  }

  /**
   * Pure LCR computation from a pre-fetched liquidity position (no DB calls).
   */
  private calculateLCRFromPosition(
    latestPosition: any | null,
    bs: BalanceSheetDto,
  ): LCRSummary {
    if (latestPosition) {
      const hqlaLevel1 = asNumber(latestPosition.hqlaLevel1);
      const hqlaLevel2 = asNumber(latestPosition.hqlaLevel2);
      const cashOutflows = asNumber(latestPosition.cashOutflows);
      const cashInflows = asNumber(latestPosition.cashInflows);
      const lcrValue = asNumber(latestPosition.lcr);
      const hqla = hqlaLevel1 + hqlaLevel2;
      const netOutflows = cashOutflows - cashInflows;
      return {
        lcr: round(lcrValue, 2),
        hqla: round(hqla, 2),
        netOutflows: round(netOutflows, 2),
        status:
          lcrValue >= 100 ? 'compliant' : lcrValue >= 90 ? 'warning' : 'breach',
        buffer: round(lcrValue - 100, 2),
      };
    }

    // Fall back to deriving from balance sheet
    const lcrResult = this.almService.fullAnalysis(bs).lcr;
    if (!lcrResult) {
      return {
        lcr: null,
        hqla: null,
        netOutflows: null,
        status: 'data_unavailable',
        buffer: null,
        gaps: [
          dataGap('liquidity.lcr', 'NO_LIQUIDITY_POSITION', {
            severity: 'CRITICAL',
            action:
              'Upload a liquidity_positions row for this institution, or load enough balance sheet detail (HQLA + cash flows) for the system to derive LCR.',
          }),
        ],
      } as any;
    }

    return {
      lcr: round(lcrResult.lcr, 2),
      hqla: round(lcrResult.hqlaTotal, 2),
      netOutflows: round(lcrResult.totalNetOutflows, 2),
      status:
        lcrResult.lcr >= 100
          ? 'compliant'
          : lcrResult.lcr >= 90
            ? 'warning'
            : 'breach',
      buffer: round(lcrResult.lcr - 100, 2),
    };
  }

  async getALMSummary(
    institutionId: string,
    rateShocksBps?: number[],
  ): Promise<ALMSummaryResult> {
    // ─── Pinned Snapshot ───
    // All data reads in a single RepeatableRead transaction so the report
    // sees a consistent database state. Without this, a balance sheet update
    // between reads could produce a report where duration gap was computed
    // from different items than the NII sensitivity.
    const snapshot = await this.prisma.$transaction(
      async (tx: any) => {
        const institution = await tx.institution.findUnique({
          where: { id: institutionId },
        });
        const balanceSheetItems = await tx.balanceSheetItem.findMany({
          where: { institutionId },
        });
        const latestLiquidityPosition = await tx.liquidityPosition.findFirst({
          where: { institutionId },
          orderBy: { date: 'desc' },
        });
        return { institution, balanceSheetItems, latestLiquidityPosition };
      },
      { isolationLevel: 'RepeatableRead' as any },
    );

    if (!snapshot.institution) {
      throw new NotFoundException(`Institution ${institutionId} not found`);
    }

    // ─── Pure computation on the pinned snapshot ───
    const bs = this.buildBalanceSheetDtoFromItems(snapshot.balanceSheetItems);
    const fullAnalysis = this.almService.fullAnalysis(bs, rateShocksBps);
    const durationGap = this.calculateDurationGapFromItems(
      snapshot.balanceSheetItems,
      bs,
    );
    const niiSensitivity = this.calculateNIISensitivityFromBs(
      bs,
      rateShocksBps,
    );
    const liquidity = this.calculateLCRFromPosition(
      snapshot.latestLiquidityPosition,
      bs,
    );

    // ─── Duration/Convexity Analytics (MP-QUANT-02) ───
    let durationConvexity: PortfolioDurationMetrics | null = null;
    let eveSensitivity: EVESensitivityPoint[] | null = null;
    try {
      if (snapshot.balanceSheetItems.length > 0) {
        const analysis = this.durationService.fullDurationAnalysis(
          snapshot.balanceSheetItems,
          rateShocksBps || [-200, -100, 100, 200, 300],
        );
        durationConvexity = analysis.portfolio;
        eveSensitivity = analysis.eveSensitivity;
      }
    } catch (err) {
      this.logger.warn({
        event: 'duration_convexity_error',
        institutionId,
        error: (err as Error).message,
      });
    }

    const institution = snapshot.institution;

    // ─── Risk Score (0-100) ───
    // Duration gap: 40% weight, NII sensitivity: 35%, LCR: 25%. If any
    // component score is null (data unavailable), the overall score is null
    // too — partial scores are more misleading than no score, and the gaps
    // manifest below tells the user exactly what's missing. D1 (2026-04-07).
    const durationGapScore = this.scoreDurationGap(durationGap.durationGap);
    const niiScore = this.scoreNII(niiSensitivity);
    const lcrScore = this.scoreLCR(liquidity.lcr);

    const riskScore: number | null =
      lcrScore === null
        ? null
        : round(durationGapScore * 0.4 + niiScore * 0.35 + lcrScore * 0.25, 0);

    // ─── Top Risks ───
    const topRisks = this.identifyTopRisks(
      durationGap,
      niiSensitivity,
      liquidity,
    );

    // ─── Recommendations ───
    const recommendations = this.generateRecommendations(
      durationGap,
      niiSensitivity,
      liquidity,
    );

    // ─── Gap manifest ───
    // Aggregate every gap surfaced by sub-calculations into a single top-level
    // array. Presenters use `hasCriticalGap(result.gaps)` to gate downloads
    // and render the warning banner. New report-producing sub-calls should
    // also populate `.gaps` and be added here.
    const gaps = mergeGaps(liquidity.gaps);

    // Save computed scenarios to DB
    await this.persistScenarios(institutionId, niiSensitivity, fullAnalysis);

    return {
      institution: {
        id: institution.id,
        name: institution.name,
        type: institution.type,
        totalAssets: institution.totalAssets,
        currency: institution.currency,
        reportingDate: institution.reportingDate.toISOString(),
      },
      durationGap,
      niiSensitivity,
      liquidity,
      topRisks,
      recommendations,
      riskScore,
      fullAnalysis,
      durationConvexity,
      eveSensitivity,
      ...(gaps.length > 0 && { gaps }),
    };
  }

  // ─── Risk Scoring ──────────────────────────────────────────────

  /** Score duration gap (0=worst, 100=best). Gap near 0 is ideal. */
  private scoreDurationGap(gap: number): number {
    const absGap = Math.abs(gap);
    if (absGap < 0.5) return 95;
    if (absGap < 1.0) return 80;
    if (absGap < 2.0) return 60;
    if (absGap < 3.0) return 40;
    if (absGap < 5.0) return 20;
    return 5;
  }

  /** Score NII sensitivity (0=worst, 100=best) */
  private scoreNII(nii: NIISensitivityResult): number {
    switch (nii.riskRating) {
      case 'low':
        return 90;
      case 'moderate':
        return 70;
      case 'high':
        return 40;
      case 'critical':
        return 15;
    }
  }

  /** Score LCR (0=worst, 100=best). >=100% is good. */
  /**
   * Score the LCR ratio 0-100 (higher = better). Returns null when the LCR
   * itself is unknown — the caller (`getALMSummary`) treats null as "this
   * component cannot contribute to the weighted risk score" and propagates
   * a null overall score rather than averaging in a phantom value.
   */
  private scoreLCR(lcr: number | null): number | null {
    if (lcr === null) return null;
    if (lcr >= 150) return 95;
    if (lcr >= 120) return 85;
    if (lcr >= 100) return 70;
    if (lcr >= 90) return 40;
    if (lcr >= 80) return 20;
    return 5;
  }

  // ─── Risk Identification ───────────────────────────────────────

  private identifyTopRisks(
    dg: DurationGapSummary,
    nii: NIISensitivityResult,
    lcr: LCRSummary,
  ): string[] {
    const risks: string[] = [];

    if (Math.abs(dg.durationGap) > 2.0) {
      risks.push(
        dg.durationGap > 0
          ? `Significant duration mismatch (+${dg.durationGap}yr) — equity exposed to rising rates`
          : `Significant duration mismatch (${dg.durationGap}yr) — equity exposed to falling rates`,
      );
    }

    if (nii.riskRating === 'high' || nii.riskRating === 'critical') {
      const worstScenario = nii.scenarios.reduce((worst, s) =>
        Math.abs(s.niImpact) > Math.abs(worst.niImpact) ? s : worst,
      );
      risks.push(
        `NII at risk: ${worstScenario.name} scenario impacts NII by $${worstScenario.niImpact}M (${worstScenario.niImpactPct}%)`,
      );
    }

    if (lcr.status === 'data_unavailable') {
      risks.push(
        'LCR cannot be assessed — liquidity inputs missing (see gaps manifest)',
      );
    } else if (lcr.status === 'breach' && lcr.lcr !== null) {
      risks.push(`LCR below Basel III minimum (${lcr.lcr}% vs 100% required)`);
    } else if (lcr.status === 'warning' && lcr.lcr !== null) {
      risks.push(`LCR near minimum threshold (${lcr.lcr}%) — limited buffer`);
    }

    if (risks.length === 0) {
      risks.push('No significant risks identified — strong ALM position');
    }

    return risks;
  }

  // ─── Recommendations ───────────────────────────────────────────

  private generateRecommendations(
    dg: DurationGapSummary,
    nii: NIISensitivityResult,
    lcr: LCRSummary,
  ): string[] {
    const recs: string[] = [];

    if (dg.riskProfile === 'asset-sensitive' && dg.durationGap > 1.5) {
      recs.push(
        'Consider extending liability duration (e.g., longer-term CDs or FHLB advances) to narrow the gap',
      );
      recs.push(
        'Evaluate interest rate swaps (pay-fixed, receive-floating) to reduce asset sensitivity',
      );
    } else if (
      dg.riskProfile === 'liability-sensitive' &&
      dg.durationGap < -1.5
    ) {
      recs.push(
        'Consider shortening asset duration or adding floating-rate loans',
      );
      recs.push('Evaluate receive-fixed interest rate swaps');
    }

    if (nii.riskRating === 'high' || nii.riskRating === 'critical') {
      recs.push(
        'Implement rate caps/floors on variable-rate instruments to limit NII volatility',
      );
    }

    if (lcr.status === 'data_unavailable') {
      recs.push(
        'Upload a current liquidity_positions row so LCR can be calculated and recommendations made',
      );
    } else {
      if (lcr.buffer !== null && lcr.buffer < 20 && lcr.status !== 'breach') {
        recs.push(
          'Build HQLA buffer — target LCR above 120% for adequate cushion',
        );
      }
      if (lcr.status === 'breach') {
        recs.push(
          'URGENT: Increase HQLA holdings immediately to meet Basel III LCR requirement',
        );
      }
    }

    if (recs.length === 0) {
      recs.push(
        'Maintain current ALM strategy — risk metrics within acceptable ranges',
      );
      recs.push('Continue monitoring rate sensitivity quarterly');
    }

    return recs;
  }

  // ─── Persist Computed Scenarios ────────────────────────────────

  private async persistScenarios(
    institutionId: string,
    nii: NIISensitivityResult,
    full: FullAnalysisResult,
  ) {
    // Clear old scenarios
    await this.prisma.interestRateScenario.deleteMany({
      where: { institutionId },
    });

    // Save new ones
    const scenarios = nii.scenarios.map((s) => ({
      institutionId,
      name: s.name,
      shiftBps: s.shiftBps,
      niImpact: s.niImpact,
      mveImpact: s.mveImpact,
      duration: full.durationGap.durationGap,
    }));

    if (scenarios.length > 0) {
      await this.prisma.interestRateScenario.createMany({ data: scenarios });
    }
  }
}
