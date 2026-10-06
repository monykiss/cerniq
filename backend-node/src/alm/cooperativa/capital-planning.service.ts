import { Injectable } from '@nestjs/common';
import type { DataGap } from '../reports/data-gap';

/**
 * Capital Planning — Indivisible-Capital Glide-Path Projector (Wave 1, W1.4)
 *
 * Forward-looking companion to the point-in-time COSSEC capital ratios. PR
 * cooperativas build the "capital indivisible" reserve out of RETAINED net
 * surplus each period; many are still climbing toward the regulatory floors
 * (market research notes §3.5: capital indivisible ≈ 3.25% of assets Q1-2026, phasing
 * toward a 4% Net-Equity floor and an 8% indivisible-capital-over-RWA index).
 * Boards want to know: "given our growth and surplus retention, WHEN do we
 * cross 4%? what does a stress event do to that timeline?"
 *
 * This projects the two ratios period-by-period:
 *   equity_t        = equity_{t-1} + retention × (ROA × assets_{t-1})
 *   assets_t        = assets_{t-1} × (1 + g)
 *   RWA_t           = RWA_{t-1}    × (1 + g)        (proportional — disclosed)
 *   netEquityRatio  = equity_t / assets_t           (CAEL Piloto / leverage)
 *   statutoryRatio  = equity_t / RWA_t              (Ley 255-2002 Art. 6.02)
 *
 * Deterministic (no RNG, SR 11-7 friendly). Distinct from
 * `CapitalAdequacyRatioService` (Basel III CET1/Tier1/Total at a point in time)
 * and from `demo/capital-ratio-projection` (a seeded point-in-time stress band).
 *
 * D1 / DISCLOSED CONFIG: a projection is ALWAYS assumption-driven, so the
 * resolved growth / ROA / retention assumptions are echoed back and a WARNING
 * `DataGap` is ALWAYS attached — these are planning inputs, not measured data,
 * and an examiner must see them as such. An invalid starting position (no
 * assets) returns a `data_unavailable` shell + CRITICAL gap, never a phantom
 * glide path.
 */

/** Forward-looking planning assumptions. Every field has a disclosed default. */
export interface CapitalGlidePathAssumptions {
  /** Annual asset (and RWA) growth, percent. Default 4%. */
  annualAssetGrowthPct?: number;
  /** Annual return on assets (net surplus ÷ assets), percent. Default 0.6%. */
  annualRoaPct?: number;
  /**
   * Fraction of net surplus retained into the indivisible reserve, percent.
   * Default 25% — the Ley 255 §6.02 statutory-floor allocation (the greater of
   * 25% of net earnings or 4% of net operating income). Conservative on purpose:
   * a planning default must never OVERSTATE a coop's climb to the capital floor
   * to an examiner. Override with the coop's board-approved retention policy
   * (a coop barred from distributions until the reserve is built may retain 100%).
   */
  surplusRetentionPct?: number;
  /** Projection horizon in years. Default 5. */
  horizonYears?: number;
  /** Compounding periods per year (4 = quarterly). Default 4. */
  periodsPerYear?: number;
  /** Net-Equity floor (CAEL Piloto phase-in), percent. Default 4%. */
  netEquityFloorPct?: number;
  /** Statutory indivisible-capital-over-RWA floor (Ley 255), percent. Default 8%. */
  statutoryRwaFloorPct?: number;
  /** One-time equity haircut at t0 for the stressed path, percent. Default 0 (no stress path). */
  stressCapitalHitPct?: number;
}

/** The institution's capital starting position. */
export interface CapitalGlidePathStart {
  equity: number;
  totalAssets: number;
  /** Risk-weighted assets. When absent the statutory leg is skipped + a gap is raised. */
  riskWeightedAssets?: number;
}

export interface CapitalGlidePathPeriod {
  period: number;
  yearsElapsed: number;
  equity: number;
  totalAssets: number;
  riskWeightedAssets: number | null;
  netEquityRatioPct: number;
  statutoryRatioPct: number | null;
  meetsNetEquityFloor: boolean;
  meetsStatutoryFloor: boolean | null;
}

export interface CapitalGlidePathResult {
  startingNetEquityRatioPct: number;
  startingStatutoryRatioPct: number | null;
  netEquityFloorPct: number;
  statutoryRwaFloorPct: number;
  periods: CapitalGlidePathPeriod[];
  milestones: {
    alreadyMeetsNetEquityFloor: boolean;
    alreadyMeetsStatutoryFloor: boolean | null;
    /** Years until the Net-Equity floor is first met (0 if already met, null if not within horizon). */
    yearsToNetEquityFloor: number | null;
    /** Years until the statutory floor is first met (0 if already, null if not within horizon or no RWA). */
    yearsToStatutoryFloor: number | null;
  };
  stressed: {
    stressCapitalHitPct: number;
    periods: CapitalGlidePathPeriod[];
    /** Years for the stressed path to (re)cross the Net-Equity floor (null if not within horizon). */
    yearsToRecoverNetEquityFloor: number | null;
  } | null;
  assumptions: Required<
    Omit<CapitalGlidePathAssumptions, 'stressCapitalHitPct'>
  > & { stressCapitalHitPct: number };
  overallStatus: 'computed' | 'data_unavailable';
  gaps: DataGap[];
}

const DEFAULTS = {
  annualAssetGrowthPct: 4,
  annualRoaPct: 0.6,
  // Ley 255 §6.02 statutory-floor allocation (25%) — conservative default that
  // never overstates the climb to the floor; override per coop board policy.
  surplusRetentionPct: 25,
  horizonYears: 5,
  periodsPerYear: 4,
  netEquityFloorPct: 4,
  statutoryRwaFloorPct: 8,
  stressCapitalHitPct: 0,
} as const;

@Injectable()
export class CapitalPlanningService {
  /**
   * Project the capital glide path from an explicit starting position.
   * Pure + deterministic — the unit-testable / goldenable core.
   */
  projectGlidePath(
    start: CapitalGlidePathStart,
    assumptions: CapitalGlidePathAssumptions = {},
  ): CapitalGlidePathResult {
    const a = this.resolveAssumptions(assumptions);
    const equity0 = Number(start.equity);
    const assets0 = Number(start.totalAssets);
    const rwaRaw = Number(start.riskWeightedAssets);
    const rwa0 = Number.isFinite(rwaRaw) && rwaRaw > 0 ? rwaRaw : null;

    // D1: never project on a missing/invalid balance sheet.
    if (
      !Number.isFinite(assets0) ||
      assets0 <= 0 ||
      !Number.isFinite(equity0)
    ) {
      return this.dataUnavailableResult(a, rwa0 === null);
    }

    const gaps: DataGap[] = [this.assumptionsDisclosureGap(a)];
    if (rwa0 === null) {
      gaps.push({
        field: 'capital.glidePath.riskWeightedAssets',
        reason: 'COSSEC_INPUTS_INSUFFICIENT',
        severity: 'WARNING',
        action:
          'No hay activos ponderados por riesgo (APR) — la razón estatutaria (Ley 255 §6.02) se omite; solo se proyecta la Razón de Patrimonio Neto. / No risk-weighted assets — the statutory ratio (Ley 255 §6.02) is skipped; only the Net-Equity ratio is projected.',
      });
    }

    const periods = this.runPath(equity0, assets0, rwa0, a);
    const stressed = this.buildStressedPath(equity0, assets0, rwa0, a);

    const start0 = periods[0];
    return {
      startingNetEquityRatioPct: start0.netEquityRatioPct,
      startingStatutoryRatioPct: start0.statutoryRatioPct,
      netEquityFloorPct: a.netEquityFloorPct,
      statutoryRwaFloorPct: a.statutoryRwaFloorPct,
      periods,
      milestones: {
        alreadyMeetsNetEquityFloor: start0.meetsNetEquityFloor,
        alreadyMeetsStatutoryFloor: start0.meetsStatutoryFloor,
        yearsToNetEquityFloor: this.firstCrossing(periods, 'netEquity'),
        yearsToStatutoryFloor:
          rwa0 === null ? null : this.firstCrossing(periods, 'statutory'),
      },
      stressed,
      assumptions: a,
      overallStatus: 'computed',
      gaps,
    };
  }

  /**
   * Map a COSSEC compliance summary into the projector input. Thin adapter so
   * the caller does not couple to the projector's shape; no DB access.
   */
  planFromCossecSummary(
    summary: {
      equity: number;
      totalAssets: number;
      riskWeightedAssets?: number;
    },
    assumptions: CapitalGlidePathAssumptions = {},
  ): CapitalGlidePathResult {
    return this.projectGlidePath(
      {
        equity: summary.equity,
        totalAssets: summary.totalAssets,
        riskWeightedAssets: summary.riskWeightedAssets,
      },
      assumptions,
    );
  }

  // ─── internals ───

  private resolveAssumptions(
    input: CapitalGlidePathAssumptions,
  ): CapitalGlidePathResult['assumptions'] {
    const clamp = (v: unknown, min: number, max: number, dflt: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : dflt;
    };
    return {
      annualAssetGrowthPct: clamp(
        input.annualAssetGrowthPct,
        -50,
        50,
        DEFAULTS.annualAssetGrowthPct,
      ),
      annualRoaPct: clamp(input.annualRoaPct, -20, 20, DEFAULTS.annualRoaPct),
      surplusRetentionPct: clamp(
        input.surplusRetentionPct,
        0,
        100,
        DEFAULTS.surplusRetentionPct,
      ),
      horizonYears: Math.round(
        clamp(input.horizonYears, 1, 30, DEFAULTS.horizonYears),
      ),
      periodsPerYear: Math.round(
        clamp(input.periodsPerYear, 1, 12, DEFAULTS.periodsPerYear),
      ),
      netEquityFloorPct: clamp(
        input.netEquityFloorPct,
        0,
        100,
        DEFAULTS.netEquityFloorPct,
      ),
      statutoryRwaFloorPct: clamp(
        input.statutoryRwaFloorPct,
        0,
        100,
        DEFAULTS.statutoryRwaFloorPct,
      ),
      stressCapitalHitPct: clamp(
        input.stressCapitalHitPct,
        0,
        100,
        DEFAULTS.stressCapitalHitPct,
      ),
    };
  }

  private runPath(
    equity0: number,
    assets0: number,
    rwa0: number | null,
    a: CapitalGlidePathResult['assumptions'],
  ): CapitalGlidePathPeriod[] {
    const totalPeriods = a.horizonYears * a.periodsPerYear;
    const periodGrowth =
      Math.pow(1 + a.annualAssetGrowthPct / 100, 1 / a.periodsPerYear) - 1;
    const periodRoa = a.annualRoaPct / 100 / a.periodsPerYear;
    const retention = a.surplusRetentionPct / 100;

    const out: CapitalGlidePathPeriod[] = [];
    let equity = equity0;
    let assets = assets0;
    let rwa = rwa0;

    for (let t = 0; t <= totalPeriods; t++) {
      if (t > 0) {
        // Net surplus is earned on the PRIOR period's asset base, then the
        // retained portion is added to the indivisible reserve (equity).
        const netSurplus = periodRoa * assets;
        equity = equity + retention * netSurplus;
        assets = assets * (1 + periodGrowth);
        if (rwa !== null) rwa = rwa * (1 + periodGrowth);
      }
      const netEquityRatioPct = assets > 0 ? (equity / assets) * 100 : 0;
      const statutoryRatioPct =
        rwa !== null && rwa > 0 ? (equity / rwa) * 100 : null;
      out.push({
        period: t,
        yearsElapsed: t / a.periodsPerYear,
        equity,
        totalAssets: assets,
        riskWeightedAssets: rwa,
        netEquityRatioPct,
        statutoryRatioPct,
        meetsNetEquityFloor: netEquityRatioPct >= a.netEquityFloorPct,
        meetsStatutoryFloor:
          statutoryRatioPct === null
            ? null
            : statutoryRatioPct >= a.statutoryRwaFloorPct,
      });
    }
    return out;
  }

  private buildStressedPath(
    equity0: number,
    assets0: number,
    rwa0: number | null,
    a: CapitalGlidePathResult['assumptions'],
  ): CapitalGlidePathResult['stressed'] {
    if (a.stressCapitalHitPct <= 0) return null;
    const stressedEquity0 = equity0 * (1 - a.stressCapitalHitPct / 100);
    const periods = this.runPath(stressedEquity0, assets0, rwa0, a);
    return {
      stressCapitalHitPct: a.stressCapitalHitPct,
      periods,
      yearsToRecoverNetEquityFloor: this.firstCrossing(periods, 'netEquity'),
    };
  }

  /** First period (in years) that meets the floor, 0 if already met, null if never. */
  private firstCrossing(
    periods: CapitalGlidePathPeriod[],
    which: 'netEquity' | 'statutory',
  ): number | null {
    const met = (p: CapitalGlidePathPeriod) =>
      which === 'netEquity' ? p.meetsNetEquityFloor : p.meetsStatutoryFloor;
    const hit = periods.find((p) => met(p) === true);
    return hit ? hit.yearsElapsed : null;
  }

  private assumptionsDisclosureGap(
    a: CapitalGlidePathResult['assumptions'],
  ): DataGap {
    return {
      field: 'capital.glidePath.assumptions',
      reason: 'COSSEC_INPUTS_INSUFFICIENT',
      severity: 'WARNING',
      action: `Proyección basada en supuestos de planificación (crecimiento ${a.annualAssetGrowthPct}%/año, ROA ${a.annualRoaPct}%, retención de excedente ${a.surplusRetentionPct}%); son estimados, no datos medidos — calibrar con el plan de negocio de la cooperativa. / Projection based on planning assumptions (growth ${a.annualAssetGrowthPct}%/yr, ROA ${a.annualRoaPct}%, surplus retention ${a.surplusRetentionPct}%); these are estimates, not measured data — calibrate to the cooperativa's business plan.`,
      context: {
        annualAssetGrowthPct: a.annualAssetGrowthPct,
        annualRoaPct: a.annualRoaPct,
        surplusRetentionPct: a.surplusRetentionPct,
      },
    };
  }

  private dataUnavailableResult(
    a: CapitalGlidePathResult['assumptions'],
    noRwa: boolean,
  ): CapitalGlidePathResult {
    return {
      startingNetEquityRatioPct: 0,
      startingStatutoryRatioPct: noRwa ? null : 0,
      netEquityFloorPct: a.netEquityFloorPct,
      statutoryRwaFloorPct: a.statutoryRwaFloorPct,
      periods: [],
      milestones: {
        alreadyMeetsNetEquityFloor: false,
        alreadyMeetsStatutoryFloor: noRwa ? null : false,
        yearsToNetEquityFloor: null,
        yearsToStatutoryFloor: null,
      },
      stressed: null,
      assumptions: a,
      overallStatus: 'data_unavailable',
      gaps: [
        {
          field: 'capital.glidePath',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action:
            'No hay posición de capital inicial (activos/patrimonio) para proyectar la trayectoria de capital. / No starting capital position (assets/equity) to project the glide path.',
        },
      ],
    };
  }
}
