import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Standard Tenors (years) ─────────────────────────────────

const STANDARD_TENORS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];

// ─── Default US Treasury Curve (approximate March 2026) ──────

const DEFAULT_BASE_CURVE: TenorRate[] = [
  { tenor: 0.25, rate: 0.048 },
  { tenor: 0.5, rate: 0.0465 },
  { tenor: 1, rate: 0.044 },
  { tenor: 2, rate: 0.042 },
  { tenor: 3, rate: 0.041 },
  { tenor: 5, rate: 0.0405 },
  { tenor: 7, rate: 0.041 },
  { tenor: 10, rate: 0.042 },
  { tenor: 20, rate: 0.0455 },
  { tenor: 30, rate: 0.0465 },
];

// ─── Basel IRRBB Standard Shocks (bps by tenor) ─────────────

/**
 * Exported so the controller's GET alias for the Rate Shock v2 panel can
 * default to the SAME canonical shock definitions this service already uses,
 * rather than a second hand-written shock table that could drift from it.
 */
export const BASEL_SHOCKS: Record<string, Record<number, number>> = {
  parallel_up: Object.fromEntries(STANDARD_TENORS.map((t) => [t, 200])),
  parallel_down: Object.fromEntries(STANDARD_TENORS.map((t) => [t, -200])),
  steepener: {
    0.25: -100,
    0.5: -90,
    1: -75,
    2: -50,
    3: -30,
    5: 0,
    7: 30,
    10: 60,
    20: 90,
    30: 100,
  },
  flattener: {
    0.25: 100,
    0.5: 90,
    1: 75,
    2: 50,
    3: 30,
    5: 0,
    7: -30,
    10: -60,
    20: -90,
    30: -100,
  },
  short_up: {
    0.25: 300,
    0.5: 275,
    1: 250,
    2: 200,
    3: 150,
    5: 75,
    7: 40,
    10: 0,
    20: 0,
    30: 0,
  },
  short_down: {
    0.25: -300,
    0.5: -275,
    1: -250,
    2: -200,
    3: -150,
    5: -75,
    7: -40,
    10: 0,
    20: 0,
    30: 0,
  },
};

// ─── Types ───────────────────────────────────────────────────

export interface TenorRate {
  tenor: number;
  rate: number;
}

export interface NelsonSiegelParams {
  beta0: number; // long-term level
  beta1: number; // short-long spread (slope)
  beta2: number; // curvature (hump)
  lambda: number; // decay factor
}

export interface ShockedCurve {
  shockType: string;
  shockLabel: string;
  baseCurve: TenorRate[];
  shockedCurve: TenorRate[];
  shockBps: Record<number, number>;
}

export interface YieldCurveAnalysis {
  baseCurve: TenorRate[];
  nelsonSiegelParams: NelsonSiegelParams;
  forwardRates: TenorRate[];
  shockedCurves: ShockedCurve[];
  niiImpact: Array<{
    shockType: string;
    label: string;
    niiChangePct: number;
    eveChangePct: number;
  }>;
}

@Injectable()
export class YieldCurveService {
  private readonly logger = new Logger(YieldCurveService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Nelson-Siegel Interpolation ─────────────────────────────

  fitNelsonSiegel(curve: TenorRate[]): NelsonSiegelParams {
    // Grid search for lambda, then solve β0, β1, β2 via least squares
    let bestLambda = 1.5;
    let bestError = Infinity;

    for (let lambda = 0.5; lambda <= 5.0; lambda += 0.1) {
      const { error } = this.solveNSForLambda(curve, lambda);
      if (error < bestError) {
        bestError = error;
        bestLambda = lambda;
      }
    }

    const { beta0, beta1, beta2 } = this.solveNSForLambda(curve, bestLambda);
    return { beta0, beta1, beta2, lambda: bestLambda };
  }

  interpolateRate(params: NelsonSiegelParams, tenor: number): number {
    const { beta0, beta1, beta2, lambda } = params;
    const x = tenor / lambda;
    if (x < 1e-10) return beta0 + beta1;
    const factor1 = (1 - Math.exp(-x)) / x;
    const factor2 = factor1 - Math.exp(-x);
    return beta0 + beta1 * factor1 + beta2 * factor2;
  }

  // ─── Forward Rates ──────────────────────────────────────────

  calculateForwardRates(curve: TenorRate[]): TenorRate[] {
    const sorted = [...curve].sort((a, b) => a.tenor - b.tenor);
    const forwards: TenorRate[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const t1 = sorted[i - 1].tenor;
      const t2 = sorted[i].tenor;
      const r1 = sorted[i - 1].rate;
      const r2 = sorted[i].rate;
      // f(t1,t2) = (r2*t2 - r1*t1) / (t2 - t1)
      const fwd = (r2 * t2 - r1 * t1) / (t2 - t1);
      forwards.push({ tenor: t2, rate: Math.max(0, fwd) });
    }

    return forwards;
  }

  // ─── Apply Shocks ──────────────────────────────────────────

  applyShock(
    baseCurve: TenorRate[],
    shockType: string,
    customShocks?: Record<string, number>,
  ): ShockedCurve {
    const shockBps =
      shockType === 'custom' && customShocks
        ? Object.fromEntries(
            Object.entries(customShocks).map(([k, v]) => [parseFloat(k), v]), // tenor key parse — deliberate parseFloat leniency
          )
        : (BASEL_SHOCKS[shockType] ?? BASEL_SHOCKS['parallel_up']);

    const shockedCurve = baseCurve.map((point) => {
      // Find closest tenor shock or interpolate
      const bpsShift = this.interpolateShock(point.tenor, shockBps);
      const shockedRate = Math.max(0, point.rate + bpsShift / 10000);
      return { tenor: point.tenor, rate: shockedRate };
    });

    const labels: Record<string, string> = {
      parallel_up: 'Parallel +200bps',
      parallel_down: 'Parallel -200bps',
      steepener: 'Steepener (short -100 / long +100)',
      flattener: 'Flattener (short +100 / long -100)',
      short_up: 'Short Rate +300bps',
      short_down: 'Short Rate -300bps',
      custom: 'Custom Shock',
    };

    return {
      shockType,
      shockLabel: labels[shockType] ?? shockType,
      baseCurve,
      shockedCurve,
      shockBps,
    };
  }

  applyAllBaselShocks(baseCurve: TenorRate[]): ShockedCurve[] {
    return Object.keys(BASEL_SHOCKS).map((type) =>
      this.applyShock(baseCurve, type),
    );
  }

  // ─── Full Yield Curve Analysis ─────────────────────────────

  async getYieldCurveAnalysis(
    institutionId: string,
  ): Promise<YieldCurveAnalysis> {
    // Try to load institution's base curve
    let baseCurve = DEFAULT_BASE_CURVE;

    const saved = await this.prisma.yieldCurve.findFirst({
      where: { institutionId, isBase: true },
      orderBy: { asOfDate: 'desc' },
    });
    if (saved) {
      baseCurve = saved.tenors as unknown as TenorRate[];
    }

    const nsParams = this.fitNelsonSiegel(baseCurve);
    const forwardRates = this.calculateForwardRates(baseCurve);
    const shockedCurves = this.applyAllBaselShocks(baseCurve);

    // Estimate NII/EVE impact per shock
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const niiImpact = shockedCurves.map((sc) => {
      const { niiChangePct, eveChangePct } = this.estimateCurveImpact(
        items,
        baseCurve,
        sc,
      );
      return {
        shockType: sc.shockType,
        label: sc.shockLabel,
        niiChangePct,
        eveChangePct,
      };
    });

    return {
      baseCurve,
      nelsonSiegelParams: nsParams,
      forwardRates,
      shockedCurves,
      niiImpact,
    };
  }

  // ─── NII/EVE with Tenor-Specific Shocks ────────────────────

  niiSimulationWithCurve(
    items: any[],
    baseCurve: TenorRate[],
    shockedCurve: ShockedCurve,
  ): number {
    let baseNII = 0;
    let shockedNII = 0;

    for (const item of items) {
      const amount = item.balance;
      const isAsset = item.category === 'asset';
      const tenor = item.duration || 1;
      const baseRate = item.rate;

      // Find tenor-specific shock
      const bpsShift = this.interpolateShock(tenor, shockedCurve.shockBps);
      const beta = this.getRepricingBeta(item);
      const rateChange = (bpsShift / 10000) * beta;

      const baseIncome = amount * baseRate;
      const shockedIncome = amount * (baseRate + rateChange);

      if (isAsset) {
        baseNII += baseIncome;
        shockedNII += shockedIncome;
      } else {
        baseNII -= baseIncome;
        shockedNII -= shockedIncome;
      }
    }

    return baseNII === 0
      ? 0
      : ((shockedNII - baseNII) / Math.abs(baseNII)) * 100;
  }

  eveAnalysisWithCurve(
    items: any[],
    baseCurve: TenorRate[],
    shockedCurve: ShockedCurve,
  ): number {
    let baseEVE = 0;
    let shockedEVE = 0;

    for (const item of items) {
      const amount = item.balance;
      const isAsset = item.category === 'asset';
      const tenor = Math.max(item.duration || 1, 0.25);
      const baseRate = this.getRateAtTenor(baseCurve, tenor);
      const bpsShift = this.interpolateShock(tenor, shockedCurve.shockBps);
      const shockedRate = Math.max(0.001, baseRate + bpsShift / 10000);

      // PV = C / (1 + r)^t
      const basePV = amount / Math.pow(1 + baseRate, tenor);
      const shockedPV = amount / Math.pow(1 + shockedRate, tenor);

      if (isAsset) {
        baseEVE += basePV;
        shockedEVE += shockedPV;
      } else {
        baseEVE -= basePV;
        shockedEVE -= shockedPV;
      }
    }

    return baseEVE === 0
      ? 0
      : ((shockedEVE - baseEVE) / Math.abs(baseEVE)) * 100;
  }

  // ─── Forward NII Schedule (MP-002) ──────────────────────────

  async computeForwardNIISchedule(
    institutionId: string,
    shockBpsPerTenor: Record<string, number>,
    quarters: number = 12,
  ): Promise<
    Array<{
      quarter: string;
      baselineNII: number;
      shockedNII: number;
      delta: number;
      deltaPct: number;
    }>
  > {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    // Build shocked curve from per-tenor shocks
    const shockBps: Record<number, number> = {};
    for (const [key, bps] of Object.entries(shockBpsPerTenor)) {
      shockBps[parseFloat(key)] = bps; // tenor key parse — deliberate parseFloat leniency
    }

    const now = new Date();
    const result: Array<{
      quarter: string;
      baselineNII: number;
      shockedNII: number;
      delta: number;
      deltaPct: number;
    }> = [];

    for (let q = 0; q < quarters; q++) {
      const qDate = new Date(now.getFullYear(), now.getMonth() + q * 3, 1);
      const qLabel = `Q${Math.ceil((qDate.getMonth() + 1) / 3)} ${qDate.getFullYear()}`;

      let baseNII = 0;
      let shockedNII = 0;

      for (const item of items) {
        const tenor = Math.max(item.duration || 1, 0.25);
        const isAsset = item.category === 'asset';
        const balance = item.balance;

        // Check if item reprices in this quarter
        const repricingQuarter = Math.floor(tenor * 4);
        const hasRepriced =
          q >= repricingQuarter || item.rateType === 'variable';

        const baseRate = item.rate;
        const beta = this.getRepricingBeta(item);
        const tenorShock = this.interpolateShock(tenor, shockBps);
        const shockedRate = hasRepriced
          ? baseRate + (tenorShock / 10000) * beta
          : baseRate; // fixed-rate hasn't repriced yet

        const baseIncome = (balance * baseRate) / 4; // quarterly
        const shockedIncome = (balance * shockedRate) / 4;

        if (isAsset) {
          baseNII += baseIncome;
          shockedNII += shockedIncome;
        } else {
          baseNII -= baseIncome;
          shockedNII -= shockedIncome;
        }
      }

      const delta = shockedNII - baseNII;
      const deltaPct = baseNII !== 0 ? (delta / Math.abs(baseNII)) * 100 : 0;

      result.push({
        quarter: qLabel,
        baselineNII: Math.round(baseNII * 100) / 100,
        shockedNII: Math.round(shockedNII * 100) / 100,
        delta: Math.round(delta * 100) / 100,
        deltaPct: Math.round(deltaPct * 100) / 100,
      });
    }

    return result;
  }

  // ─── Save/Load Curves ──────────────────────────────────────

  async saveCustomCurve(data: {
    institutionId: string;
    name: string;
    tenors: TenorRate[];
    source?: string;
  }) {
    // Unset any existing base curve
    await this.prisma.yieldCurve.updateMany({
      where: { institutionId: data.institutionId, isBase: true },
      data: { isBase: false },
    });

    return this.prisma.yieldCurve.create({
      data: {
        institutionId: data.institutionId,
        name: data.name,
        asOfDate: new Date(),
        tenors: data.tenors as any,
        source: data.source ?? 'manual',
        isBase: true,
      },
    });
  }

  // ─── Private Helpers ───────────────────────────────────────

  private solveNSForLambda(curve: TenorRate[], lambda: number) {
    // Least-squares: y = β0 + β1*f1 + β2*f2
    const n = curve.length;
    let sum_y = 0,
      sum_f1 = 0,
      sum_f2 = 0;
    let sum_f1y = 0,
      sum_f2y = 0,
      sum_f1f1 = 0,
      sum_f2f2 = 0,
      sum_f1f2 = 0;

    for (const { tenor, rate } of curve) {
      const x = tenor / lambda;
      const f1 = x < 1e-10 ? 1 : (1 - Math.exp(-x)) / x;
      const f2 = f1 - Math.exp(-x);

      sum_y += rate;
      sum_f1 += f1;
      sum_f2 += f2;
      sum_f1y += f1 * rate;
      sum_f2y += f2 * rate;
      sum_f1f1 += f1 * f1;
      sum_f2f2 += f2 * f2;
      sum_f1f2 += f1 * f2;
    }

    // Solve 3x3 system [1, f1, f2; ...] * [β0, β1, β2] = [y, ...]
    // Simplified: use normal equations
    const A = [
      [n, sum_f1, sum_f2],
      [sum_f1, sum_f1f1, sum_f1f2],
      [sum_f2, sum_f1f2, sum_f2f2],
    ];
    const b = [sum_y, sum_f1y, sum_f2y];

    const betas = this.solve3x3(A, b);
    const beta0 = betas[0];
    const beta1 = betas[1];
    const beta2 = betas[2];

    // Compute error
    let error = 0;
    for (const { tenor, rate } of curve) {
      const fitted = this.interpolateRate(
        { beta0, beta1, beta2, lambda },
        tenor,
      );
      error += (rate - fitted) ** 2;
    }

    return { beta0, beta1, beta2, error };
  }

  private solve3x3(A: number[][], b: number[]): number[] {
    // Cramer's rule for 3x3
    const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    const D = det(A);
    if (Math.abs(D) < 1e-15) return [0, 0, 0];

    const D0 = det([
      [b[0], A[0][1], A[0][2]],
      [b[1], A[1][1], A[1][2]],
      [b[2], A[2][1], A[2][2]],
    ]);
    const D1 = det([
      [A[0][0], b[0], A[0][2]],
      [A[1][0], b[1], A[1][2]],
      [A[2][0], b[2], A[2][2]],
    ]);
    const D2 = det([
      [A[0][0], A[0][1], b[0]],
      [A[1][0], A[1][1], b[1]],
      [A[2][0], A[2][1], b[2]],
    ]);

    return [D0 / D, D1 / D, D2 / D];
  }

  private interpolateShock(
    tenor: number,
    shockBps: Record<number, number>,
  ): number {
    const tenors = Object.keys(shockBps)
      .map(Number)
      .sort((a, b) => a - b);
    if (tenors.length === 0) return 0;
    if (tenor <= tenors[0]) return shockBps[tenors[0]];
    if (tenor >= tenors[tenors.length - 1])
      return shockBps[tenors[tenors.length - 1]];

    // Linear interpolation
    for (let i = 0; i < tenors.length - 1; i++) {
      if (tenor >= tenors[i] && tenor <= tenors[i + 1]) {
        const t1 = tenors[i],
          t2 = tenors[i + 1];
        const s1 = shockBps[t1],
          s2 = shockBps[t2];
        return s1 + ((s2 - s1) * (tenor - t1)) / (t2 - t1);
      }
    }
    return 0;
  }

  private getRateAtTenor(curve: TenorRate[], tenor: number): number {
    const sorted = [...curve].sort((a, b) => a.tenor - b.tenor);
    if (tenor <= sorted[0].tenor) return sorted[0].rate;
    if (tenor >= sorted[sorted.length - 1].tenor)
      return sorted[sorted.length - 1].rate;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (tenor >= sorted[i].tenor && tenor <= sorted[i + 1].tenor) {
        const t1 = sorted[i].tenor,
          t2 = sorted[i + 1].tenor;
        const r1 = sorted[i].rate,
          r2 = sorted[i + 1].rate;
        return r1 + ((r2 - r1) * (tenor - t1)) / (t2 - t1);
      }
    }
    return sorted[0].rate;
  }

  private getRepricingBeta(item: any): number {
    if (item.depositBeta !== null && item.depositBeta !== undefined)
      return item.depositBeta;
    if (item.rateType === 'variable') return 1.0;
    if (item.category === 'liability') {
      const sub = (item.subcategory || '').toLowerCase();
      if (
        sub.includes('demand') ||
        sub.includes('savings') ||
        sub.includes('ahorros')
      )
        return 0.4;
      if (sub.includes('cd') || sub.includes('time') || sub.includes('plazo'))
        return 0.8;
      return 0.6;
    }
    return 1.0;
  }

  private estimateCurveImpact(
    items: any[],
    baseCurve: TenorRate[],
    shockedCurve: ShockedCurve,
  ): { niiChangePct: number; eveChangePct: number } {
    if (items.length === 0) {
      // Return heuristic based on shock magnitude
      const avgShock =
        Object.values(shockedCurve.shockBps).reduce((a, b) => a + b, 0) /
        Object.values(shockedCurve.shockBps).length;
      return { niiChangePct: avgShock * 0.05, eveChangePct: -avgShock * 0.08 };
    }

    const niiChangePct = this.niiSimulationWithCurve(
      items,
      baseCurve,
      shockedCurve,
    );
    const eveChangePct = this.eveAnalysisWithCurve(
      items,
      baseCurve,
      shockedCurve,
    );
    return { niiChangePct, eveChangePct };
  }
}
