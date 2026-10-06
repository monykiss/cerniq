import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { AlmEnterpriseService } from '../alm-enterprise.service';
import {
  COSSEC_SCENARIOS,
  NamedScenario,
  NamedScenarioResult,
} from '../scenarios/cossec-scenarios';

// Re-export for consumers (e.g. pipeline worker, controller)
export type {
  NamedScenario,
  NamedScenarioResult,
} from '../scenarios/cossec-scenarios';

/** Round to n decimal places with NaN guard */
function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Per-segment loan balances ($M) used to target a scenario's credit shock. */
interface LoanSegmentBalances {
  consumer: number;
  residential: number;
  commercial: number;
}

/**
 * The loan base a scenario's credit shock applies to. A scenario that names a
 * target segment (e.g. SIC 2026 → 'consumer') hits only that segment's balance;
 * everything else hits the whole book. Falls back to the whole book if the named
 * segment is absent/zero so a real shock is never silently zeroed (D1).
 */
function resolveCreditShockBase(
  scenario: NamedScenario,
  totalLoans: number,
  segments: LoanSegmentBalances | null,
): number {
  const seg = scenario.creditShockSegment;
  if (!seg || seg === 'all' || !segments) return totalLoans;
  const balance = segments[seg];
  return balance > 0 ? balance : totalLoans;
}

/** Maximum Monte Carlo paths to prevent memory exhaustion */
const MAX_MC_PATHS = 50_000;
/** Maximum simulation horizon in months */
const MAX_MC_HORIZON = 120;

// ─── Custom Scenario Interfaces ───────────────────────────────

export interface CustomScenarioParams {
  rateShockBps: number; // -300 to +300
  depositRunoffPct: number; // 0 to 30
  defaultRateIncreasePct: number; // 0 to 15
  energyCostShockPct: number; // 0 to 50
}

export interface CustomScenarioResult {
  nimImpactBps: number;
  nimBefore: number;
  nimAfter: number;
  lcrBefore: number;
  lcrAfter: number;
  capitalBefore: number;
  capitalAfter: number;
  examReadinessBefore: number;
  examReadinessAfter: number;
  verdict: 'RESILIENT' | 'ADEQUATE' | 'VULNERABLE' | 'CRITICAL';
  narrative: string;
  narrativeEs: string;
}

// ─── Result Interfaces ────────────────────────────────────────

export interface NEVRiskBand {
  level: 'low' | 'moderate' | 'high';
  label: string;
  labelEs: string;
}

export interface NEVShockPoint {
  shockBps: number;
  nev: number; // $M post-shock net economic value
  nevRatio: number; // % of post-shock asset value
  nevChangePct: number; // % change vs base NEV
  riskBand: NEVRiskBand;
}

/**
 * NEV supervisory analysis result. `baseNEV`/`baseNEVRatio` are null when
 * the balance sheet is empty (D1 — `overallRating: 'data_unavailable'`,
 * never phantom zeros).
 */
export interface NEVAnalysisResult {
  institutionId: string;
  baseNEV: number | null;
  baseNEVRatio: number | null;
  shocks: NEVShockPoint[];
  worstCase: NEVShockPoint | null;
  overallRating: NEVRiskBand['level'] | 'data_unavailable';
  gaps?: Array<{
    field: string;
    reason: string;
    severity: 'CRITICAL' | 'WARNING';
    action: string;
  }>;
}

export interface MonteCarloParams {
  paths: number; // default 1000
  horizon: number; // months, default 12
  volatility: number; // rate vol in bps, default 150
  meanReversion: number; // Vasicek kappa, default 0.15
}

export interface NIIDistribution {
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

export interface MonteCarloResult {
  paths: number;
  horizon: number;
  ratePaths: number[][]; // sampled paths for charting (max 50)
  niiDistribution: NIIDistribution;
  monthlyNIIBands: Array<{
    month: number;
    p5: number;
    p25: number;
    median: number;
    p75: number;
    p95: number;
  }>;
  worstCaseNII: number;
  expectedNII: number;
  niiAtRisk: number; // expected - worstCase
}

export interface RegulatoryScenario {
  name: string;
  description: string;
  rateShock: number[]; // monthly rate path in bps
  niImpact: number;
  mveImpact: number;
  lcrImpact: number;
  capitalImpact: number;
  passFailStatus: 'pass' | 'warn' | 'fail';
}

export interface RegulatoryStressResult {
  scenarios: RegulatoryScenario[];
  overallRating:
    | 'resilient'
    | 'adequate'
    | 'vulnerable'
    | 'critical'
    | 'data_unavailable';
  /**
   * Populated when the stress engine refuses to compute scenarios (e.g. LCR
   * input missing). When any CRITICAL gap is present, `scenarios` is empty
   * and `overallRating` is `'data_unavailable'`. D1 (2026-04-07).
   */
  gaps?: import('../reports/data-gap').DataGap[];
}

export interface StressTestResult {
  monteCarlo: MonteCarloResult;
  regulatory: RegulatoryStressResult;
  cossecScenarios: NamedScenarioResult[];
}

// ─── Vasicek Model Parameters ─────────────────────────────────

const DEFAULT_PARAMS: MonteCarloParams = {
  paths: 1000,
  horizon: 12,
  volatility: 150, // 150 bps annualized vol
  meanReversion: 0.15, // Vasicek kappa
};

// Current Fed Funds rate as mean-reversion target (θ)
// Reads from env or defaults to 4.50% (as of Q1 2026)
const THETA_BPS = parseInt(process.env.FED_FUNDS_RATE_BPS || '450', 10);

@Injectable()
export class StressTestingService {
  private readonly logger = new Logger(StressTestingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
  ) {}

  // ─── Monte Carlo Simulation (Vasicek) ─────────────────────────

  async runMonteCarloSimulation(
    institutionId: string,
    params: Partial<MonteCarloParams> = {},
  ): Promise<MonteCarloResult> {
    const p: MonteCarloParams = {
      paths: Math.min(
        Math.max(Math.floor(params.paths ?? DEFAULT_PARAMS.paths), 100),
        MAX_MC_PATHS,
      ),
      horizon: Math.min(
        Math.max(Math.floor(params.horizon ?? DEFAULT_PARAMS.horizon), 1),
        MAX_MC_HORIZON,
      ),
      volatility: Math.max(
        1,
        Math.min(params.volatility ?? DEFAULT_PARAMS.volatility, 1000),
      ),
      meanReversion: Math.max(
        0,
        Math.min(params.meanReversion ?? DEFAULT_PARAMS.meanReversion, 5),
      ),
    };
    this.logger.log(
      `Monte Carlo: ${p.paths} paths, ${p.horizon}mo, vol=${p.volatility}bps, kappa=${p.meanReversion}`,
    );

    // Fetch balance sheet data to calculate NII sensitivity
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    if (items.length === 0) {
      return this.emptyMonteCarloResult(p);
    }

    // Separate floating vs fixed items
    const floatingAssets = items.filter(
      (i: any) => i.category === 'asset' && i.rateType === 'variable',
    );
    const floatingLiabilities = items.filter(
      (i: any) => i.category === 'liability' && i.rateType === 'variable',
    );
    const fixedAssets = items.filter(
      (i: any) => i.category === 'asset' && i.rateType === 'fixed',
    );
    const fixedLiabilities = items.filter(
      (i: any) => i.category === 'liability' && i.rateType === 'fixed',
    );

    const totalFloatingAssets = floatingAssets.reduce(
      (s: number, a: any) => s + Number(a.balance),
      0,
    );
    const totalFloatingLiabilities = floatingLiabilities.reduce(
      (s: number, l: any) => s + Number(l.balance),
      0,
    );
    const totalFixedAssets = fixedAssets.reduce(
      (s: number, a: any) => s + Number(a.balance),
      0,
    );
    const totalFixedLiabilities = fixedLiabilities.reduce(
      (s: number, l: any) => s + Number(l.balance),
      0,
    );

    // Weighted average rates
    const avgFloatingAssetRate =
      totalFloatingAssets > 0
        ? floatingAssets.reduce(
            (s: number, a: any) => s + a.balance * a.rate,
            0,
          ) / totalFloatingAssets
        : 0;
    const avgFloatingLiabilityRate =
      totalFloatingLiabilities > 0
        ? floatingLiabilities.reduce(
            (s: number, l: any) => s + l.balance * l.rate,
            0,
          ) / totalFloatingLiabilities
        : 0;
    const avgFixedAssetRate =
      totalFixedAssets > 0
        ? fixedAssets.reduce((s: number, a: any) => s + a.balance * a.rate, 0) /
          totalFixedAssets
        : 0;
    const avgFixedLiabilityRate =
      totalFixedLiabilities > 0
        ? fixedLiabilities.reduce(
            (s: number, l: any) => s + l.balance * l.rate,
            0,
          ) / totalFixedLiabilities
        : 0;

    // Current short-term rate (starting point for simulation)
    const r0 = THETA_BPS; // in bps

    // Vasicek: dr = κ(θ - r)dt + σ√dt · ε
    const dt = 1 / 12; // monthly time step
    const kappa = p.meanReversion;
    const theta = THETA_BPS;
    const sigma = p.volatility; // annualized vol in bps
    const sqrtDt = Math.sqrt(dt);

    // Generate all rate paths
    const allPaths: number[][] = [];
    const allNIIPaths: number[] = []; // annual NII for each path

    for (let path = 0; path < p.paths; path++) {
      const ratePath: number[] = [r0];
      let r = r0;

      for (let month = 1; month <= p.horizon; month++) {
        const epsilon = this.boxMullerRandom();
        r = r + kappa * (theta - r) * dt + sigma * sqrtDt * epsilon;
        r = Math.max(0, r); // ZLB — rates can't go below 0
        ratePath.push(round(r, 1));
      }

      allPaths.push(ratePath);

      // Calculate NII under this rate path
      // Average rate change over the horizon
      const avgRate = ratePath.reduce((s, v) => s + v, 0) / ratePath.length;
      const rateChangeBps = avgRate - r0;

      // NII = fixed income + floating income - fixed cost - floating cost
      // Floating reprices with rate changes; fixed stays constant
      const fixedIncome =
        ((totalFixedAssets * (avgFixedAssetRate / 100)) / 12) * p.horizon;
      const floatingIncome =
        ((totalFloatingAssets *
          ((avgFloatingAssetRate + rateChangeBps / 100) / 100)) /
          12) *
        p.horizon;
      const fixedCost =
        ((totalFixedLiabilities * (avgFixedLiabilityRate / 100)) / 12) *
        p.horizon;
      const floatingCost =
        ((totalFloatingLiabilities *
          ((avgFloatingLiabilityRate + rateChangeBps / 100) / 100)) /
          12) *
        p.horizon;

      const annualNII = floatingIncome + fixedIncome - floatingCost - fixedCost;
      allNIIPaths.push(round(annualNII, 2));
    }

    // Sort NII for percentile calculation
    const sortedNII = [...allNIIPaths].sort((a, b) => a - b);

    const niiDistribution: NIIDistribution = {
      p5: this.percentile(sortedNII, 5),
      p25: this.percentile(sortedNII, 25),
      median: this.percentile(sortedNII, 50),
      p75: this.percentile(sortedNII, 75),
      p95: this.percentile(sortedNII, 95),
    };

    // Monthly NII bands (for fan chart)
    const monthlyNIIBands: {
      month: number;
      p5: number;
      p25: number;
      median: number;
      p75: number;
      p95: number;
    }[] = [];
    for (let month = 0; month <= p.horizon; month++) {
      const ratesAtMonth = allPaths.map((path) => path[month]);
      const sorted = [...ratesAtMonth].sort((a, b) => a - b);

      // Convert rates to NII impact at each month
      const rateChanges = sorted.map((r) => r - r0);
      const monthlyNIIs = rateChanges.map((rc) => {
        const floatInc =
          (totalFloatingAssets * ((avgFloatingAssetRate + rc / 100) / 100)) /
          12;
        const fixInc = (totalFixedAssets * (avgFixedAssetRate / 100)) / 12;
        const floatCst =
          (totalFloatingLiabilities *
            ((avgFloatingLiabilityRate + rc / 100) / 100)) /
          12;
        const fixCst =
          (totalFixedLiabilities * (avgFixedLiabilityRate / 100)) / 12;
        return floatInc + fixInc - floatCst - fixCst;
      });
      const sortedMonthlyNII = [...monthlyNIIs].sort((a, b) => a - b);

      monthlyNIIBands.push({
        month,
        p5: round(this.percentile(sortedMonthlyNII, 5), 2),
        p25: round(this.percentile(sortedMonthlyNII, 25), 2),
        median: round(this.percentile(sortedMonthlyNII, 50), 2),
        p75: round(this.percentile(sortedMonthlyNII, 75), 2),
        p95: round(this.percentile(sortedMonthlyNII, 95), 2),
      });
    }

    // Sample 50 paths for charting
    const sampledPaths = allPaths
      .filter((_, i) => i % Math.ceil(p.paths / 50) === 0)
      .slice(0, 50);

    return {
      paths: p.paths,
      horizon: p.horizon,
      ratePaths: sampledPaths,
      niiDistribution,
      monthlyNIIBands,
      worstCaseNII: round(niiDistribution.p5, 2),
      expectedNII: round(niiDistribution.median, 2),
      niiAtRisk: round(niiDistribution.median - niiDistribution.p5, 2),
    };
  }

  // ─── Regulatory Stress Scenarios ─────────────────────────────

  async runRegulatoryStress(
    institutionId: string,
  ): Promise<RegulatoryStressResult> {
    this.logger.log(`Regulatory stress test for institution ${institutionId}`);

    // Get NII sensitivity and LCR data
    const [niiSensitivity, liquidity, durationGap] = await Promise.all([
      this.almEnterprise.calculateNIISensitivity(institutionId),
      this.almEnterprise.calculateLCR(institutionId),
      this.almEnterprise.calculateDurationGap(institutionId),
    ]);

    const baseNII = niiSensitivity.baseNII;
    const baseLCR = liquidity.lcr;
    const gap = durationGap.durationGap;

    // D1 (2026-04-07): refuse to run regulatory scenarios when the LCR input
    // is unavailable. Previously this would silently use 0 as the base LCR
    // and produce four scenarios that all read "compliant" or all read
    // "breach" — neither is a real result. Surface a CRITICAL gap and let
    // the orchestrator render explicit DATA UNAVAILABLE.
    if (baseLCR === null) {
      this.logger.warn({
        event: 'regulatory_stress_data_unavailable',
        institutionId,
        reason: 'NO_LIQUIDITY_POSITION',
      });
      return {
        scenarios: [],
        overallRating: 'data_unavailable',
        gaps: [
          {
            field: 'stress.regulatory.baseLCR',
            reason: 'NO_LIQUIDITY_POSITION',
            severity: 'CRITICAL',
            action:
              'Upload a current liquidity_positions row before running regulatory stress scenarios.',
            context: { institutionId },
          },
          // Propagate any sub-gaps the LCR call already surfaced.
          ...(liquidity.gaps ?? []),
        ],
      };
    }

    // 4 regulatory scenarios
    const scenarios: RegulatoryScenario[] = [
      this.rapidRiseScenario(baseNII, baseLCR, gap, niiSensitivity),
      this.gradualRiseScenario(baseNII, baseLCR, gap, niiSensitivity),
      this.invertedScenario(baseNII, baseLCR, gap, niiSensitivity),
      this.shockDownScenario(baseNII, baseLCR, gap, niiSensitivity),
    ];

    // Overall rating
    const failCount = scenarios.filter(
      (s) => s.passFailStatus === 'fail',
    ).length;
    const warnCount = scenarios.filter(
      (s) => s.passFailStatus === 'warn',
    ).length;

    let overallRating: RegulatoryStressResult['overallRating'];
    if (failCount >= 2) overallRating = 'critical';
    else if (failCount >= 1) overallRating = 'vulnerable';
    else if (warnCount >= 2) overallRating = 'adequate';
    else overallRating = 'resilient';

    return { scenarios, overallRating };
  }

  // ─── Combined Stress Test ────────────────────────────────────

  async runFullStressTest(
    institutionId: string,
    params: Partial<MonteCarloParams> = {},
  ): Promise<StressTestResult> {
    const [monteCarlo, regulatory, cossecScenarios] = await Promise.all([
      this.runMonteCarloSimulation(institutionId, params),
      this.runRegulatoryStress(institutionId),
      this.runCOSSECScenarios(institutionId),
    ]);
    return { monteCarlo, regulatory, cossecScenarios };
  }

  // ─── Named COSSEC Regulatory Scenarios ────────────────────────

  async runCOSSECScenarios(
    institutionId: string,
  ): Promise<NamedScenarioResult[]> {
    this.logger.log(`COSSEC named scenarios for institution ${institutionId}`);

    const [niiSensitivity, _liquidity, cossec] = await Promise.all([
      this.almEnterprise.calculateNIISensitivity(institutionId),
      this.almEnterprise.calculateLCR(institutionId),
      this.almEnterprise.getCOSSECCompliance(institutionId),
    ]);

    const baseNII = niiSensitivity.baseNII;
    const totalDeposits = cossec?.summary?.totalShares ?? 0;
    const totalLoans = cossec?.summary?.totalLoans ?? 0;

    // Only pay for the per-segment balance pull when a scenario actually targets
    // a segment; otherwise the credit shock hits the whole book as before.
    const segmentTargeted = COSSEC_SCENARIOS.some(
      (s) => s.creditShockSegment && s.creditShockSegment !== 'all',
    );
    const loanSegments = segmentTargeted
      ? await this.loadLoanSegmentBalances(institutionId)
      : null;

    return COSSEC_SCENARIOS.map((scenario) => {
      // ── NII impact from rate shift ──
      // Find closest NII sensitivity scenario for interpolation
      const closestScenario = niiSensitivity.scenarios.reduce((prev, curr) =>
        Math.abs(curr.shiftBps - scenario.rateShiftBps) <
        Math.abs(prev.shiftBps - scenario.rateShiftBps)
          ? curr
          : prev,
      );

      // Scale linearly from closest known scenario
      const scaleFactor =
        closestScenario.shiftBps !== 0
          ? scenario.rateShiftBps / closestScenario.shiftBps
          : 1;
      let niiImpact = round(closestScenario.niImpact * scaleFactor, 2);

      // For steepening, apply NIM compression adjustment
      if (scenario.type === 'steepening') {
        niiImpact = round(niiImpact * 0.7 - baseNII * 0.02, 2);
      }

      const niiImpactPct =
        baseNII !== 0 ? round((niiImpact / baseNII) * 100, 2) : 0;

      // ── Deposit shock ──
      // Cost of replacing lost deposits at higher marginal rates (+1.5% above avg)
      const depositOutflow =
        totalDeposits * (Math.abs(scenario.depositShockPct) / 100);
      const depositImpact =
        scenario.depositShockPct !== 0
          ? round(depositOutflow * 0.015, 2) // 150bps marginal funding cost
          : 0;

      // ── Credit shock ──
      // Additional defaults applied to the targeted loan base (whole book, or
      // the named segment for segment-aware scenarios like SIC 2026).
      const creditShockBase = resolveCreditShockBase(
        scenario,
        totalLoans,
        loanSegments,
      );
      const creditLoss =
        scenario.creditShockPct !== 0
          ? round(creditShockBase * (scenario.creditShockPct / 100), 2)
          : 0;

      // ── Combined total impact ──
      const totalImpact = round(niiImpact - depositImpact - creditLoss, 2);
      const totalImpactPct =
        baseNII !== 0 ? round((totalImpact / baseNII) * 100, 2) : 0;

      // ── Pass/Fail assessment ──
      const absImpactPct = Math.abs(totalImpactPct);
      let passFailStatus: 'pass' | 'warn' | 'fail';
      if (absImpactPct > 20 && totalImpact < 0) passFailStatus = 'fail';
      else if (absImpactPct > 10 && totalImpact < 0) passFailStatus = 'warn';
      else passFailStatus = 'pass';

      return {
        scenario,
        niiImpact,
        niiImpactPct,
        depositImpact,
        creditLoss,
        totalImpact,
        totalImpactPct,
        passFailStatus,
      };
    });
  }

  /**
   * Loan balances by segment for segment-aware credit shocks. Reads the asset
   * side once and buckets by subcategory. Decimal columns are coerced with
   * `Number(...)` (Prisma maps Decimal to objects that string-concatenate under
   * `+`); a corrupt/non-finite balance is skipped rather than zeroed.
   */
  private async loadLoanSegmentBalances(
    institutionId: string,
  ): Promise<LoanSegmentBalances> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId, category: 'asset' },
      select: { subcategory: true, balance: true },
    });
    const rows = items as Array<{ subcategory: string; balance: unknown }>;
    const sumOf = (subcategory: string): number =>
      rows
        .filter((i) => i.subcategory === subcategory)
        .reduce((s: number, i) => {
          const bal = Number(i.balance);
          return Number.isFinite(bal) ? s + bal : s;
        }, 0);
    return {
      consumer: sumOf('consumer_loans'),
      residential: sumOf('residential_mortgages'),
      commercial: sumOf('commercial_loans'),
    };
  }

  // ─── NEV (Net Economic Value) Analysis ────────────────────────

  /**
   * Formal NEV supervisory analysis (Layer 1, #3). Revalues the balance
   * sheet under parallel shocks of ±100/200/300 bps using duration +
   * convexity. Classification follows the COSSEC CC-2025-01 stress-testing
   * framework / CAMEL-S sensitivity bands (Vol10 §NEV), a NCUA-derived but
   * COSSEC-published methodology — a TWO-dimensional test on the +300bps
   * supervisory point, taking the worse of:
   *   NEV ratio:        > 6% low · 4–6% moderate · < 4% high
   *   NEV sensitivity:  < 15% low · 15–25% moderate · > 25% high  (|Δ NEV|)
   * (No "extreme" band — COSSEC/NCUA retired it; < 4% is High.)
   *
   * D1: refuses to compute when the balance sheet is empty — returns a
   * data_unavailable shell with a CRITICAL gap, never phantom zeros.
   */
  async getNEVAnalysis(institutionId: string): Promise<NEVAnalysisResult> {
    this.logger.log(`NEV analysis for institution ${institutionId}`);

    const [durationGap, cossec] = await Promise.all([
      this.almEnterprise.calculateDurationGap(institutionId),
      this.almEnterprise.getCOSSECCompliance(institutionId),
    ]);

    const totalAssets = cossec?.summary?.totalAssets ?? 0;
    const totalLiabilities = cossec?.summary?.totalLiabilities ?? 0;

    if (cossec.overallStatus === 'data_unavailable' || totalAssets <= 0) {
      this.logger.warn({
        event: 'nev_data_unavailable',
        institutionId,
        reason: 'EMPTY_BALANCE_SHEET',
      });
      return {
        institutionId,
        baseNEV: null,
        baseNEVRatio: null,
        shocks: [],
        worstCase: null,
        overallRating: 'data_unavailable',
        gaps: [
          {
            field: 'nev.balanceSheet',
            reason: 'EMPTY_BALANCE_SHEET',
            severity: 'CRITICAL',
            action:
              'Cargue el balance (activos y pasivos) antes de ejecutar el análisis NEV. / Upload balance sheet items before running NEV analysis.',
          },
        ],
      };
    }

    const baseNEV = totalAssets - totalLiabilities;
    const baseNEVRatio =
      totalAssets > 0 ? round((baseNEV / totalAssets) * 100, 2) : 0;

    const shockSet = [-300, -200, -100, 100, 200, 300];
    const shocks: NEVShockPoint[] = shockSet.map((shockBps) => {
      const dr = shockBps / 10000;
      const assetChange =
        -durationGap.assetDuration * totalAssets * dr +
        0.5 * (durationGap.assetConvexity ?? 0) * totalAssets * dr * dr;
      const liabChange =
        -durationGap.liabilityDuration * totalLiabilities * dr +
        0.5 *
          (durationGap.liabilityConvexity ?? 0) *
          totalLiabilities *
          dr *
          dr;

      const shockedAssets = totalAssets + assetChange;
      const shockedLiabilities = totalLiabilities + liabChange;
      const nev = shockedAssets - shockedLiabilities;
      const nevRatio =
        shockedAssets > 0 ? round((nev / shockedAssets) * 100, 2) : 0;
      const nevChangePct =
        baseNEV !== 0
          ? round(((nev - baseNEV) / Math.abs(baseNEV)) * 100, 2)
          : 0;

      return {
        shockBps,
        nev: round(nev, 2),
        nevRatio,
        nevChangePct,
        // Per-shock band is the NEV-ratio band ONLY (informational): a
        // favorable down-shock with a large positive ΔNEV is not "risk".
        // The sensitivity leg is a supervisory measure of the ADVERSE
        // (+300bps) point and is applied to overallRating below, not here.
        riskBand: this.nevRiskBand(nevRatio, 0),
      };
    });

    const worstCase = shocks.reduce((worst, s) =>
      s.nevRatio < worst.nevRatio ? s : worst,
    );

    // COSSEC CC-2025-01 anchors the supervisory classification on the
    // instantaneous +300bps parallel shock specifically; the rest of the
    // grid is informational. Fall back to worst-case only if +300 is absent.
    const supervisoryPoint =
      shocks.find((s) => s.shockBps === 300) ?? worstCase;
    // The supervisory verdict applies the full two-dimensional test (NEV
    // ratio AND NEV sensitivity, worse of the two) at the +300bps point.
    const overallRating = this.nevRiskBand(
      supervisoryPoint.nevRatio,
      Math.abs(supervisoryPoint.nevChangePct),
    ).level;

    return {
      institutionId,
      baseNEV: round(baseNEV, 2),
      baseNEVRatio,
      shocks,
      worstCase,
      overallRating,
    };
  }

  /**
   * COSSEC CC-2025-01 / CAMEL-S two-dimensional NEV band (Vol10 §NEV): the
   * worse of the post-shock NEV-ratio band (>6 low · 4–6 moderate · <4 high)
   * and the NEV-sensitivity band (<15 low · 15–25 moderate · >25 high). No
   * "extreme" tier — COSSEC/NCUA retired it; sub-4% / >25% sensitivity is High.
   */
  private nevRiskBand(nevRatio: number, sensitivityPct: number): NEVRiskBand {
    const ratioRank = nevRatio > 6 ? 0 : nevRatio >= 4 ? 1 : 2;
    const sensRank = sensitivityPct < 15 ? 0 : sensitivityPct <= 25 ? 1 : 2;
    const rank = Math.max(ratioRank, sensRank);
    if (rank === 0) {
      return { level: 'low', label: 'Low risk', labelEs: 'Riesgo bajo' };
    }
    if (rank === 1) {
      return {
        level: 'moderate',
        label: 'Moderate risk',
        labelEs: 'Riesgo moderado',
      };
    }
    return { level: 'high', label: 'High risk', labelEs: 'Riesgo alto' };
  }

  // ─── Scenario Builders ───────────────────────────────────────

  private rapidRiseScenario(
    baseNII: number,
    baseLCR: number,
    gap: number,
    nii: {
      scenarios: Array<{
        shiftBps: number;
        niImpact: number;
        mveImpact: number;
        niImpactPct: number;
      }>;
    },
  ): RegulatoryScenario {
    // +300bps over 6 months, hold for remaining
    const rateShock = Array.from({ length: 12 }, (_, i) =>
      i < 6 ? Math.round((i + 1) * 50) : 300,
    );
    const scenario300 = nii.scenarios.find((s) => s.shiftBps === 300);
    const niImpact =
      scenario300?.niImpact ?? baseNII * (gap > 0 ? 0.08 : -0.08);
    const mveImpact = scenario300?.mveImpact ?? -baseNII * 0.15;
    const lcrImpact = round(baseLCR * 0.92, 2); // LCR typically drops ~8% in rapid rise
    const capitalImpact = round((mveImpact / (baseNII * 10)) * 100, 2); // rough capital ratio impact

    return {
      name: 'Rapid Rise',
      description:
        '+300bps over 6 months — sudden tightening cycle, stress on fixed-rate assets',
      rateShock,
      niImpact: round(niImpact, 2),
      mveImpact: round(mveImpact, 2),
      lcrImpact,
      capitalImpact,
      passFailStatus: this.assessPassFail(niImpact, baseNII, lcrImpact),
    };
  }

  private gradualRiseScenario(
    baseNII: number,
    baseLCR: number,
    gap: number,
    nii: {
      scenarios: Array<{
        shiftBps: number;
        niImpact: number;
        mveImpact: number;
        niImpactPct: number;
      }>;
    },
  ): RegulatoryScenario {
    // +25bps per quarter for 8 quarters = +200bps
    const rateShock = Array.from({ length: 12 }, (_, i) =>
      Math.round(Math.min((Math.floor(i / 3) + 1) * 25, 200)),
    );
    const scenario200 = nii.scenarios.find((s) => s.shiftBps === 200);
    const niImpact = scenario200
      ? scenario200.niImpact * 0.7 // gradual has less impact than instant
      : baseNII * (gap > 0 ? 0.04 : -0.04);
    const mveImpact = scenario200?.mveImpact ?? -baseNII * 0.08;
    const lcrImpact = round(baseLCR * 0.96, 2);
    const capitalImpact = round((mveImpact / (baseNII * 10)) * 100, 2);

    return {
      name: 'Gradual Rise',
      description:
        '+25bps per quarter for 2 years — orderly tightening, manageable repricing',
      rateShock,
      niImpact: round(niImpact, 2),
      mveImpact: round(mveImpact, 2),
      lcrImpact,
      capitalImpact,
      passFailStatus: this.assessPassFail(niImpact, baseNII, lcrImpact),
    };
  }

  private invertedScenario(
    baseNII: number,
    baseLCR: number,
    gap: number,
    nii: {
      scenarios: Array<{
        shiftBps: number;
        niImpact: number;
        mveImpact: number;
        niImpactPct: number;
      }>;
    },
  ): RegulatoryScenario {
    // Short rates +200bps, long rates flat (yield curve inversion)
    const rateShock = Array.from({ length: 12 }, () => 200);
    const scenario200 = nii.scenarios.find((s) => s.shiftBps === 200);
    // Inversion is worse for banks: short liabilities reprice up, long assets don't move
    const niImpact = scenario200
      ? scenario200.niImpact * 0.6 - baseNII * 0.03 // additional NIM compression from flattening
      : -baseNII * 0.05;
    const mveImpact = scenario200
      ? scenario200.mveImpact * 0.5
      : -baseNII * 0.05;
    const lcrImpact = round(baseLCR * 0.88, 2); // more stress
    const capitalImpact = round((mveImpact / (baseNII * 10)) * 100, 2);

    return {
      name: 'Yield Curve Inversion',
      description:
        'Short rates +200bps, long rates flat — NIM compression, deposit competition',
      rateShock,
      niImpact: round(niImpact, 2),
      mveImpact: round(mveImpact, 2),
      lcrImpact,
      capitalImpact,
      passFailStatus: this.assessPassFail(niImpact, baseNII, lcrImpact),
    };
  }

  private shockDownScenario(
    baseNII: number,
    baseLCR: number,
    gap: number,
    nii: {
      scenarios: Array<{
        shiftBps: number;
        niImpact: number;
        mveImpact: number;
        niImpactPct: number;
      }>;
    },
  ): RegulatoryScenario {
    // -200bps immediate
    const rateShock = Array.from({ length: 12 }, () => -200);
    const scenarioDown = nii.scenarios.find((s) => s.shiftBps === -200);
    const niImpact =
      scenarioDown?.niImpact ?? baseNII * (gap > 0 ? -0.06 : 0.04);
    const mveImpact =
      scenarioDown?.mveImpact ?? baseNII * (gap > 0 ? 0.1 : -0.05);
    const lcrImpact = round(baseLCR * 1.05, 2); // rates down can improve liquidity
    const capitalImpact = round((mveImpact / (baseNII * 10)) * 100, 2);

    return {
      name: 'Shock Down',
      description:
        '-200bps immediate — recession/deflation, asset-sensitive banks lose NII',
      rateShock,
      niImpact: round(niImpact, 2),
      mveImpact: round(mveImpact, 2),
      lcrImpact,
      capitalImpact,
      passFailStatus: this.assessPassFail(niImpact, baseNII, lcrImpact),
    };
  }

  // ─── Custom Scenario Builder ──────────────────────────────────

  async runCustomScenario(
    institutionId: string,
    params: CustomScenarioParams,
  ): Promise<CustomScenarioResult> {
    this.logger.log(
      `Custom scenario: rate=${params.rateShockBps}bps, deposits=${params.depositRunoffPct}%, defaults=${params.defaultRateIncreasePct}%, energy=${params.energyCostShockPct}%`,
    );

    // Clamp parameters to valid ranges
    const rateShockBps = Math.max(-300, Math.min(300, params.rateShockBps));
    const depositRunoffPct = Math.max(0, Math.min(30, params.depositRunoffPct));
    const defaultRateIncreasePct = Math.max(
      0,
      Math.min(15, params.defaultRateIncreasePct),
    );
    const energyCostShockPct = Math.max(
      0,
      Math.min(50, params.energyCostShockPct),
    );

    // Fetch institution data via ALM enterprise service
    let niiSensitivity: any;
    let liquidity: any;
    let cossec: any;
    try {
      [niiSensitivity, liquidity, cossec] = await Promise.all([
        this.almEnterprise.calculateNIISensitivity(institutionId),
        this.almEnterprise.calculateLCR(institutionId),
        this.almEnterprise.getCOSSECCompliance(institutionId),
      ]);
    } catch (_err) {
      this.logger.warn(
        `Custom scenario: could not load institution data — returning empty result`,
      );
      return this.emptyCustomScenarioResult();
    }

    const baseNII = niiSensitivity.baseNII; // in $M
    const baseLCR = liquidity.lcr;
    const summary = cossec?.summary;
    const totalAssets = summary?.totalAssets ?? 0;
    const totalLoans = summary?.totalLoans ?? 0;
    const totalShares = summary?.totalShares ?? 0;
    const capitalRatioBefore = summary?.capitalRatio ?? 0;
    const nimBefore = summary?.nim ?? 0;
    const examReadinessBefore = cossec?.examReadinessScore ?? 0;

    // ── 1. Rate Shock → NIM / NII Impact ──
    // Find closest NII sensitivity scenario and interpolate
    const closestScenario = niiSensitivity.scenarios.reduce(
      (prev: any, curr: any) =>
        Math.abs(curr.shiftBps - rateShockBps) <
        Math.abs(prev.shiftBps - rateShockBps)
          ? curr
          : prev,
    );
    const scaleFactor =
      closestScenario.shiftBps !== 0
        ? rateShockBps / closestScenario.shiftBps
        : 1;
    const niiImpact = closestScenario.niImpact * scaleFactor; // in $M

    // ── 2. Deposit Runoff → LCR Impact ──
    // Deposit outflow reduces HQLA and increases net outflows
    const depositOutflow = totalShares * (depositRunoffPct / 100);
    // Replacement funding at higher marginal rates increases costs
    const depositFundingCost = depositOutflow * 0.015; // 150bps marginal cost
    // LCR drops proportionally to deposit outflow vs HQLA
    const hqla = liquidity.hqla || 0;
    const lcrReduction =
      hqla > 0
        ? (depositOutflow / Math.max(hqla, 1)) * 100 * 0.5 // 50% pass-through to LCR
        : depositRunoffPct * 2;
    const lcrAfter = round(Math.max(0, baseLCR - lcrReduction), 1);

    // ── 3. Loan Default Increase → Capital Impact ──
    // Additional credit losses from increased defaults
    const additionalCreditLoss = totalLoans * (defaultRateIncreasePct / 100);
    // Capital ratio impact: loss / total assets (% points)
    const capitalImpactPct =
      totalAssets > 0 ? (additionalCreditLoss / totalAssets) * 100 : 0;
    const capitalAfter = round(
      Math.max(0, capitalRatioBefore - capitalImpactPct),
      2,
    );

    // ── 4. Energy Cost Shock → Operating Expense Stress ──
    // Energy costs typically 2-5% of operating expenses for PR institutions
    // Assume operating expenses ~40% of NII, energy ~3% of opex
    const baseOpex = baseNII * 0.4;
    const energyBaseCost = baseOpex * 0.03;
    const energyIncrease = energyBaseCost * (energyCostShockPct / 100);
    const combinedNiiImpact = niiImpact - depositFundingCost - energyIncrease;
    const combinedNiiImpactPct =
      baseNII !== 0 ? (combinedNiiImpact / baseNII) * 100 : 0;

    // NIM change: approximate as proportional to combined NII change
    const nimImpactBps = round(combinedNiiImpactPct * 3, 0); // ~3bps per 1% NII change
    const nimAfter = round(Math.max(0, nimBefore + nimImpactBps / 100), 2);

    // ── 5. Combined Exam Readiness Score ──
    let examDeductions = 0;
    // NIM degradation
    if (nimAfter < nimBefore) {
      const nimDropPct =
        ((nimBefore - nimAfter) / Math.max(nimBefore, 0.01)) * 100;
      if (nimDropPct > 20) examDeductions += 15;
      else if (nimDropPct > 10) examDeductions += 10;
      else if (nimDropPct > 5) examDeductions += 5;
    }
    // LCR breach
    if (lcrAfter < 100) examDeductions += 15;
    else if (lcrAfter < 110) examDeductions += 8;
    // Capital below well-capitalized
    if (capitalAfter < 6) examDeductions += 20;
    else if (capitalAfter < 8) examDeductions += 10;
    // High defaults
    if (defaultRateIncreasePct > 8) examDeductions += 10;
    else if (defaultRateIncreasePct > 3) examDeductions += 5;

    const examReadinessAfter = Math.max(
      0,
      examReadinessBefore - examDeductions,
    );

    // ── 6. Verdict ──
    let verdict: CustomScenarioResult['verdict'];
    if (capitalAfter >= 8 && lcrAfter >= 100 && examReadinessAfter >= 70) {
      verdict = 'RESILIENT';
    } else if (
      capitalAfter >= 6 &&
      lcrAfter >= 90 &&
      examReadinessAfter >= 50
    ) {
      verdict = 'ADEQUATE';
    } else if (capitalAfter >= 4 && lcrAfter >= 80) {
      verdict = 'VULNERABLE';
    } else {
      verdict = 'CRITICAL';
    }

    // ── 7. Bilingual Narrative ──
    const narrative = this.buildCustomNarrative(
      rateShockBps,
      depositRunoffPct,
      defaultRateIncreasePct,
      energyCostShockPct,
      nimBefore,
      nimAfter,
      baseLCR,
      lcrAfter,
      capitalRatioBefore,
      capitalAfter,
      verdict,
      'en',
    );
    const narrativeEs = this.buildCustomNarrative(
      rateShockBps,
      depositRunoffPct,
      defaultRateIncreasePct,
      energyCostShockPct,
      nimBefore,
      nimAfter,
      baseLCR,
      lcrAfter,
      capitalRatioBefore,
      capitalAfter,
      verdict,
      'es',
    );

    return {
      nimImpactBps: round(nimImpactBps, 0),
      nimBefore: round(nimBefore, 2),
      nimAfter,
      lcrBefore: round(baseLCR, 1),
      lcrAfter,
      capitalBefore: round(capitalRatioBefore, 2),
      capitalAfter,
      examReadinessBefore,
      examReadinessAfter,
      verdict,
      narrative,
      narrativeEs,
    };
  }

  private buildCustomNarrative(
    rateShockBps: number,
    depositRunoffPct: number,
    defaultRateIncreasePct: number,
    energyCostShockPct: number,
    nimBefore: number,
    nimAfter: number,
    lcrBefore: number,
    lcrAfter: number,
    capitalBefore: number,
    capitalAfter: number,
    verdict: string,
    lang: 'en' | 'es',
  ): string {
    if (lang === 'es') {
      const shocks: string[] = [];
      if (rateShockBps !== 0)
        shocks.push(
          `choque de tasas de ${rateShockBps > 0 ? '+' : ''}${rateShockBps}bps`,
        );
      if (depositRunoffPct > 0)
        shocks.push(`fuga de depositos del ${depositRunoffPct}%`);
      if (defaultRateIncreasePct > 0)
        shocks.push(`aumento de morosidad del ${defaultRateIncreasePct}%`);
      if (energyCostShockPct > 0)
        shocks.push(`aumento de costos energeticos del ${energyCostShockPct}%`);
      const shockStr =
        shocks.length > 0 ? shocks.join(', ') : 'sin choques aplicados';
      return `Bajo este escenario (${shockStr}), el NIM se mueve de ${nimBefore.toFixed(2)}% a ${nimAfter.toFixed(2)}%, el LCR cambia de ${lcrBefore.toFixed(1)}% a ${lcrAfter.toFixed(1)}%, y el ratio de capital se ajusta de ${capitalBefore.toFixed(2)}% a ${capitalAfter.toFixed(2)}%. Veredicto: ${verdict}.`;
    }
    const shocks: string[] = [];
    if (rateShockBps !== 0)
      shocks.push(
        `${rateShockBps > 0 ? '+' : ''}${rateShockBps}bps rate shock`,
      );
    if (depositRunoffPct > 0)
      shocks.push(`${depositRunoffPct}% deposit runoff`);
    if (defaultRateIncreasePct > 0)
      shocks.push(`${defaultRateIncreasePct}% default rate increase`);
    if (energyCostShockPct > 0)
      shocks.push(`${energyCostShockPct}% energy cost shock`);
    const shockStr =
      shocks.length > 0 ? shocks.join(', ') : 'no shocks applied';
    return `Under this scenario (${shockStr}), NIM moves from ${nimBefore.toFixed(2)}% to ${nimAfter.toFixed(2)}%, LCR changes from ${lcrBefore.toFixed(1)}% to ${lcrAfter.toFixed(1)}%, and capital ratio adjusts from ${capitalBefore.toFixed(2)}% to ${capitalAfter.toFixed(2)}%. Verdict: ${verdict}.`;
  }

  private emptyCustomScenarioResult(): CustomScenarioResult {
    return {
      nimImpactBps: 0,
      nimBefore: 0,
      nimAfter: 0,
      lcrBefore: 0,
      lcrAfter: 0,
      capitalBefore: 0,
      capitalAfter: 0,
      examReadinessBefore: 0,
      examReadinessAfter: 0,
      verdict: 'CRITICAL',
      narrative:
        'No balance sheet data available. Upload your balance sheet to use the scenario builder.',
      narrativeEs:
        'No hay datos de balance disponibles. Cargue su balance para usar el constructor de escenarios.',
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private assessPassFail(
    niImpact: number,
    baseNII: number,
    lcrImpact: number,
  ): 'pass' | 'warn' | 'fail' {
    const niImpactPct = baseNII !== 0 ? Math.abs(niImpact / baseNII) * 100 : 0;
    // Fail: NII drops > 15% or LCR goes below 100%
    if (niImpactPct > 15 && niImpact < 0) return 'fail';
    if (lcrImpact < 100) return 'fail';
    // Warn: NII drops > 8% or LCR buffer < 10%
    if (niImpactPct > 8 && niImpact < 0) return 'warn';
    if (lcrImpact < 110) return 'warn';
    return 'pass';
  }

  /** Crypto-quality Box-Muller transform for standard normal random numbers */
  private boxMullerRandom(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.cryptoUniform();
    while (v === 0) v = this.cryptoUniform();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return Number.isFinite(z) ? z : 0;
  }

  /** Uniform [0, 1) using crypto.randomBytes */
  private cryptoUniform(): number {
    const buf = randomBytes(4);
    return buf.readUInt32BE(0) / 0x100000000;
  }

  private percentile(sorted: number[], pct: number): number {
    if (sorted.length === 0) return 0;
    const index = (pct / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return round(sorted[lower] * (1 - weight) + sorted[upper] * weight, 2);
  }

  private emptyMonteCarloResult(p: MonteCarloParams): MonteCarloResult {
    return {
      paths: p.paths,
      horizon: p.horizon,
      ratePaths: [],
      niiDistribution: { p5: 0, p25: 0, median: 0, p75: 0, p95: 0 },
      monthlyNIIBands: Array.from({ length: p.horizon + 1 }, (_, month) => ({
        month,
        p5: 0,
        p25: 0,
        median: 0,
        p75: 0,
        p95: 0,
      })),
      worstCaseNII: 0,
      expectedNII: 0,
      niiAtRisk: 0,
    };
  }
}
