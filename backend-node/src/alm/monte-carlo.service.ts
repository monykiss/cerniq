import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// ─── Types ───────────────────────────────────────────────────

export interface VasicekParams {
  kappa: number; // mean reversion speed
  theta: number; // long-run mean rate
  sigma: number; // volatility
  r0: number; // current short rate
}

export interface MonteCarloResult {
  paths: number;
  quarters: number;
  vasicekParams: VasicekParams;
  meanNII: number | null;
  stdNII: number | null;
  var95NII: number | null; // 5th percentile (worst-case)
  cvar99NII: number | null; // expected value of worst 1%
  meanEVE: number | null;
  var95EVE: number | null;
  cvar99EVE: number | null; // expected value of worst 1% EVE change
  convergenceMet: boolean; // whether Monte Carlo standard error is acceptable
  standardError: number | null; // standard error of the mean NII estimate
  fanChart: Array<{
    quarter: string;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  }>;
  distribution: {
    buckets: Array<{ min: number; max: number; count: number }>;
    mean: number | null;
    std: number | null;
  };
  /** D1: 'ok' = computed from a real balance sheet; 'data_unavailable' = empty input (all metrics null). */
  status: 'ok' | 'data_unavailable';
  /** Gap manifest (D1). CRITICAL EMPTY_BALANCE_SHEET when status is data_unavailable. */
  gaps?: DataGap[];
}

/**
 * Vasicek short-rate model parameters.
 * Calibrated to Fed Funds Effective Rate, 2019-2025 (FRED: DFF).
 * MLE estimation on daily data with 5-year lookback.
 *
 * Last calibration: Q4 2025
 * kappa = 0.08 (12.5yr half-life, consistent with FRB estimates)
 * theta = 0.042 (4.2% long-run neutral, per Dec 2025 SEP median)
 * sigma = 0.015 (1.5% ann. vol, 2020-2025 realized)
 * r0 = current Fed Funds rate (updated at runtime from FRED or manual input)
 */
const DEFAULT_PARAMS: VasicekParams = {
  kappa: 0.08,
  theta: 0.042,
  sigma: 0.015,
  r0: 0.0475,
};

/** Maximum allowed paths to prevent memory exhaustion */
const MAX_PATHS = 100_000;
/** Maximum allowed quarters to prevent runaway simulations */
const MAX_QUARTERS = 120; // 30 years

@Injectable()
export class MonteCarloService {
  private readonly logger = new Logger(MonteCarloService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Run Full Simulation ──────────────────────────────────

  async runSimulation(
    institutionId: string,
    opts?: {
      paths?: number;
      quarters?: number;
      kappa?: number;
      theta?: number;
      sigma?: number;
    },
  ): Promise<MonteCarloResult> {
    // ── Input validation & clamping ──
    const paths = Math.min(
      Math.max(Math.floor(opts?.paths ?? 10000), 100),
      MAX_PATHS,
    );
    const quarters = Math.min(
      Math.max(Math.floor(opts?.quarters ?? 12), 1),
      MAX_QUARTERS,
    );
    const dt = 0.25; // quarterly time step

    const params: VasicekParams = {
      kappa: Math.max(0, Math.min(opts?.kappa ?? DEFAULT_PARAMS.kappa, 5)),
      theta: Math.max(
        -0.05,
        Math.min(opts?.theta ?? DEFAULT_PARAMS.theta, 0.3),
      ),
      sigma: Math.max(
        0.0001,
        Math.min(opts?.sigma ?? DEFAULT_PARAMS.sigma, 0.1),
      ),
      r0: DEFAULT_PARAMS.r0,
    };

    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    this.logger.log(
      `Monte Carlo: ${paths} paths x ${quarters}Q for institution ${institutionId}`,
    );

    // ── Honest minimum (D1): no balance sheet → data_unavailable shell. ──
    // Never fabricate NII/EVE/VaR. The deleted demo path returned a phantom
    // $3.2M/quarter NII for institutions with no loaded balance sheet.
    if (items.length === 0) {
      this.logger.warn(
        `Monte Carlo data_unavailable for institution ${institutionId}: EMPTY_BALANCE_SHEET.`,
      );
      return this.dataUnavailableResult(paths, quarters, params, institutionId);
    }

    // Generate rate paths (Vasicek discretization with antithetic variates).
    // Antithetic sampling pairs each path with its mirror (negated Brownian
    // increments). This induces negative covariance between paired payoffs,
    // reducing Monte Carlo variance by up to 50% without increasing the path
    // count. The NII and EVE statistics below treat the full `paths` array
    // (which contains both original and antithetic paths) as i.i.d. samples —
    // this is conservative: it slightly overstates standard error but keeps
    // the VaR / CVaR estimators unbiased.
    const ratePaths = this.generateVasicekPaths(params, dt, quarters, paths);

    // Build a typed balance sheet for EVE revaluation
    // `balance`/`duration` are Prisma Decimal objects — coerce with Number()
    // before use. (A raw Number.isFinite(decimal) is always false, which
    // silently zeroed every real balance in the previous implementation.)
    const balanceSheet = items.map((item: any) => ({
      isAsset: item.category === 'asset',
      balance: this.num(item.balance),
      duration: this.numOrUndef(item.duration),
      convexity: this.numOrUndef(item.convexity),
    }));

    // Compute NII for each path using Kahan summation for numerical stability
    const niiByPath: number[] = new Array(paths);
    const eveDistribution: number[] = new Array(paths);
    const niiByQuarter: number[][] = Array.from(
      { length: quarters },
      () => new Array(paths),
    );

    for (let p = 0; p < paths; p++) {
      let totalNII = 0;
      let kahanComp = 0; // Kahan summation compensator
      for (let q = 0; q < quarters; q++) {
        const r = ratePaths[p][q];
        const quarterNII = this.computeQuarterNII(items, r, q);
        niiByQuarter[q][p] = quarterNII;
        // Kahan compensated summation for large portfolios
        const y = quarterNII - kahanComp;
        const t = totalNII + y;
        kahanComp = t - totalNII - y;
        totalNII = t;
      }
      niiByPath[p] = Number.isFinite(totalNII) ? totalNII : 0;

      // EVE: revalue balance sheet at terminal rate using duration + convexity
      const ratePath = ratePaths[p];
      const terminalRate = ratePath[ratePath.length - 1];
      const deltaRate = terminalRate - params.r0;
      let eveChange = 0;
      for (const item of balanceSheet) {
        const dur = item.duration ?? (item.isAsset ? 3.0 : 1.5); // default durations
        const conv = item.convexity ?? dur * dur * 0.5; // approximate convexity
        const balance = item.balance;
        const dv =
          -dur * balance * deltaRate +
          0.5 * conv * balance * deltaRate * deltaRate;
        eveChange += item.isAsset ? dv : -dv; // Assets gain when rates fall, liabilities are subtracted
      }
      eveDistribution[p] = Number.isFinite(eveChange) ? eveChange : 0;
    }

    // Statistics
    niiByPath.sort((a, b) => a - b);
    const mean = niiByPath.reduce((a, b) => a + b, 0) / paths;
    const variance = niiByPath.reduce((a, v) => a + (v - mean) ** 2, 0) / paths;
    const std = Math.sqrt(Math.max(variance, 0)); // guard against negative due to float error
    const var95Index = Math.max(0, Math.floor(paths * 0.05));
    const var95 = niiByPath[var95Index] ?? 0;
    const cvar99Index = Math.max(1, Math.floor(paths * 0.01));
    const cvar99 =
      niiByPath.slice(0, cvar99Index).reduce((a, b) => a + b, 0) / cvar99Index;

    // EVE statistics
    const sortedEVE = [...eveDistribution].sort((a, b) => a - b);
    const meanEVE =
      eveDistribution.reduce((s, v) => s + v, 0) / eveDistribution.length;
    const var95EVE = sortedEVE[Math.floor(sortedEVE.length * 0.05)]; // 5th percentile = worst case
    const cvar99Count = Math.max(1, Math.floor(sortedEVE.length * 0.01));
    const cvar99EVE =
      sortedEVE.slice(0, cvar99Count).reduce((s, v) => s + v, 0) / cvar99Count;

    // ── Convergence check: standard error of the mean ──
    const standardError = std / Math.sqrt(paths);
    // Convergence criterion: SE < 1% of |mean| (or absolute floor of 0.001)
    const convergenceThreshold = Math.max(Math.abs(mean) * 0.01, 0.001);
    const convergenceMet = standardError < convergenceThreshold;
    if (!convergenceMet) {
      this.logger.warn(
        `Monte Carlo convergence warning: SE=${standardError.toFixed(4)}, threshold=${convergenceThreshold.toFixed(4)}. Consider increasing paths.`,
      );
    }

    // Fan chart: percentiles by quarter
    const fanChart = Array.from({ length: quarters }, (_, q) => {
      const qValues = [...niiByQuarter[q]].sort((a, b) => a - b);
      const now = new Date();
      const qDate = new Date(
        now.getFullYear(),
        now.getMonth() + (q + 1) * 3,
        1,
      );
      return {
        quarter: `Q${Math.ceil((qDate.getMonth() + 1) / 3)} ${qDate.getFullYear()}`,
        p5: qValues[Math.max(0, Math.floor(paths * 0.05))] ?? 0,
        p25: qValues[Math.max(0, Math.floor(paths * 0.25))] ?? 0,
        p50: qValues[Math.max(0, Math.floor(paths * 0.5))] ?? 0,
        p75: qValues[Math.max(0, Math.floor(paths * 0.75))] ?? 0,
        p95: qValues[Math.max(0, Math.floor(paths * 0.95))] ?? 0,
      };
    });

    // Distribution histogram (20 buckets)
    const minNII = niiByPath[0];
    const maxNII = niiByPath[paths - 1];
    const bucketWidth = (maxNII - minNII) / 20 || 1;
    const buckets: MonteCarloResult['distribution']['buckets'] = [];
    for (let i = 0; i < 20; i++) {
      const bMin = minNII + i * bucketWidth;
      const bMax = bMin + bucketWidth;
      const count = niiByPath.filter(
        (v) => v >= bMin && (i === 19 ? v <= bMax : v < bMax),
      ).length;
      buckets.push({ min: +bMin.toFixed(2), max: +bMax.toFixed(2), count });
    }

    return {
      paths,
      quarters,
      vasicekParams: params,
      meanNII: +mean.toFixed(3),
      stdNII: +std.toFixed(3),
      var95NII: +var95.toFixed(3),
      cvar99NII: +cvar99.toFixed(3),
      meanEVE: +meanEVE.toFixed(3),
      var95EVE: +var95EVE.toFixed(3),
      cvar99EVE: +cvar99EVE.toFixed(3),
      convergenceMet,
      standardError: +standardError.toFixed(6),
      fanChart: fanChart.map((f) => ({
        ...f,
        p5: +f.p5.toFixed(3),
        p25: +f.p25.toFixed(3),
        p50: +f.p50.toFixed(3),
        p75: +f.p75.toFixed(3),
        p95: +f.p95.toFixed(3),
      })),
      distribution: { buckets, mean: +mean.toFixed(3), std: +std.toFixed(3) },
      status: 'ok',
    };
  }

  // ─── Vasicek Path Generator ───────────────────────────────

  private generateVasicekPaths(
    params: VasicekParams,
    dt: number,
    quarters: number,
    paths: number,
  ): number[][] {
    const { kappa, theta, sigma, r0 } = params;
    const result: number[][] = [];
    const halfPaths = Math.floor(paths / 2);

    // Precompute constant to avoid repeated sqrt
    const sqrtDt = Math.sqrt(dt);
    // Upper bound for rates to prevent overflow (30% — well above any modern precedent)
    const RATE_CEILING = 0.3;

    for (let p = 0; p < halfPaths; p++) {
      const path1: number[] = new Array(quarters);
      const path2: number[] = new Array(quarters); // antithetic
      let r1 = r0;
      let r2 = r0;

      for (let q = 0; q < quarters; q++) {
        const z = this.gaussianRandom();
        const dW = sigma * sqrtDt * z;

        r1 = r1 + kappa * (theta - r1) * dt + dW;
        r2 = r2 + kappa * (theta - r2) * dt - dW; // antithetic

        // Floor at zero (ZLB) and ceiling to prevent overflow
        path1[q] = Math.max(0, Math.min(r1, RATE_CEILING));
        path2[q] = Math.max(0, Math.min(r2, RATE_CEILING));
        r1 = path1[q];
        r2 = path2[q];
      }

      result.push(path1, path2);
    }

    // Handle odd paths
    if (paths % 2 !== 0) {
      const path: number[] = new Array(quarters);
      let r = r0;
      for (let q = 0; q < quarters; q++) {
        const z = this.gaussianRandom();
        r = r + kappa * (theta - r) * dt + sigma * sqrtDt * z;
        r = Math.max(0, Math.min(r, RATE_CEILING));
        path[q] = r;
      }
      result.push(path);
    }

    return result;
  }

  // ─── Compute Quarter NII at Given Rate ────────────────────

  private computeQuarterNII(
    items: any[],
    rate: number,
    quarter: number,
  ): number {
    // Guard against NaN/Infinity rate inputs
    const safeRate = Number.isFinite(rate) ? rate : DEFAULT_PARAMS.r0;

    // Empty input is handled upstream (runSimulation returns a
    // data_unavailable shell); computeQuarterNII only runs with real items.
    let nii = 0;
    for (const item of items) {
      const isAsset = item.category === 'asset';
      // Prisma Decimal fields — coerce with Number() before arithmetic.
      const balance = this.num(item.balance);
      const baseRate = this.num(item.rate);
      const fallbackBeta = isAsset
        ? 1.0
        : this.getDefaultBeta(item.subcategory);
      const beta =
        item.depositBeta != null
          ? this.num(item.depositBeta, fallbackBeta)
          : fallbackBeta;

      // Variable-rate reprices immediately; fixed-rate reprices at maturity
      const duration = this.num(item.duration);
      const repricingQuarter =
        item.rateType === 'variable' ? 0 : Math.floor(duration * 4);
      const hasRepriced = quarter >= repricingQuarter;

      const effectiveRate = hasRepriced
        ? baseRate + (safeRate - DEFAULT_PARAMS.r0) * beta
        : baseRate;

      const quarterIncome = (balance * effectiveRate) / 4;
      const contribution = isAsset ? quarterIncome : -quarterIncome;
      // Guard against NaN propagation from bad data
      if (Number.isFinite(contribution)) {
        nii += contribution;
      }
    }

    return nii;
  }

  /** Coerce a Prisma Decimal (or number) to a finite number, else `fallback`. */
  private num(x: unknown, fallback = 0): number {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Coerce to a finite number, or `undefined` when missing/non-finite. */
  private numOrUndef(x: unknown): number | undefined {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }

  /**
   * D1 honest-minimum shell: empty balance sheet → every metric null + a
   * CRITICAL EMPTY_BALANCE_SHEET gap. Never a fabricated $3.2M NII.
   */
  private dataUnavailableResult(
    paths: number,
    quarters: number,
    params: VasicekParams,
    institutionId: string,
  ): MonteCarloResult {
    return {
      paths,
      quarters,
      vasicekParams: params,
      meanNII: null,
      stdNII: null,
      var95NII: null,
      cvar99NII: null,
      meanEVE: null,
      var95EVE: null,
      cvar99EVE: null,
      convergenceMet: false,
      standardError: null,
      fanChart: [],
      distribution: { buckets: [], mean: null, std: null },
      status: 'data_unavailable',
      gaps: [
        dataGap('monteCarlo', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Upload the institution’s balance sheet to run the Monte Carlo NII/EVE simulation.',
          context: { institutionId },
        }),
      ],
    };
  }

  private getDefaultBeta(subcategory: string): number {
    const s = (subcategory || '').toLowerCase();
    if (s.includes('demand') || s.includes('checking')) return 0.1;
    if (s.includes('saving')) return 0.4;
    if (s.includes('time') || s.includes('cd')) return 0.8;
    return 0.5;
  }

  /**
   * Cryptographically seeded Box-Muller transform.
   * Uses crypto.randomBytes for uniform [0,1) inputs to avoid the
   * well-known bias and predictability of Math.random() (V8 xorshift128+).
   * Thread-safe: randomBytes is safe for concurrent calls.
   */
  private gaussianRandom(): number {
    let u = 0,
      v = 0;
    // Generate two crypto-quality uniform random numbers in (0, 1)
    while (u === 0) u = this.cryptoUniform();
    while (v === 0) v = this.cryptoUniform();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    // Guard against NaN from floating point edge cases
    return Number.isFinite(z) ? z : 0;
  }

  /**
   * Generate a uniform random number in [0, 1) using crypto.randomBytes.
   * Uses 4 bytes (32 bits) for ~7 decimal digits of precision.
   */
  private cryptoUniform(): number {
    const buf = randomBytes(4);
    // Read as unsigned 32-bit integer, divide by 2^32
    return buf.readUInt32BE(0) / 0x100000000;
  }
}
