import { Injectable } from '@nestjs/common';
import {
  getCaelFramework,
  type CaelVariant,
  type CaelLossBasis,
  type CaelRatio,
} from './frameworks/cael-pr.framework';
import { dataGap, type DataGap } from './reports/data-gap';

/**
 * CAEL Compliance — Compute Layer (Wave 1, W1.1 Slice 2)
 *
 * The COMPUTATION half of the CAEL dual-filing surface whose declarative
 * dictionary landed in Slice 1 (`frameworks/cael-pr.framework.ts`). It
 * evaluates the three quarterly CAEL variants' ratios on a real balance sheet,
 * reusing the engines that already exist — the COSSEC capital / liquidity /
 * earnings figures and the {@link CECLService} incurred-loss vs CECL allowance
 * legs — so nothing is recomputed and nothing drifts.
 *
 * Pure + deterministic: every method takes pre-computed engine outputs and
 * returns a verdict. No DB, no NestJS wiring (zero-arg constructor → it cannot
 * shift the `AlmController` positional-slot map). The production fetch/dispatch
 * (`getRegulatoryCompliance` routing `primaryRegulator === 'CAEL'`) and the
 * `CAEL_*` `ReportArtifactFormat` persistence are a later slice — the artifact
 * enum is a `schema.prisma` change that would collide with the open PR #71.
 *
 * D1 / honesty contract:
 *   - Missing inputs → that leg is `data_unavailable` + a gap, NEVER a phantom
 *     pass. The asset-quality leg (delinquency ≤ 3%) is `data_unavailable` by
 *     default because NPL data is not on a PR coop's aggregate balance sheet —
 *     surfaced, not faked.
 *   - The Reg 7790 CAEL bands are an UNVERIFIED non-OCR scan: every PROVISIONAL
 *     ratio that contributes to the composite raises a WARNING gap so an
 *     examiner never reads a provisional band as a verified figure. Statutory
 *     thresholds (Ley 255 capital 8% / 4%, CC-2021-02 liquidity 5%) are firm.
 *   - The variant's allowance basis (incurred-loss for 7790, CECL for the CECL
 *     variant) is reported as its own metric — the dual-filing's whole point.
 */

/** Status of a single evaluated CAEL leg. */
export type CaelRatioStatus = 'pass' | 'fail' | 'info' | 'data_unavailable';

/** One evaluated CAEL ratio: the framework definition + the computed verdict. */
export interface CaelRatioEvaluation {
  id: number;
  name: string;
  nameEs: string;
  category: string;
  /** Computed value (percent). `null` when the input is `data_unavailable`. */
  value: number | null;
  unit: string;
  threshold: string;
  thresholdDirection: 'gte' | 'lte' | 'range' | 'info';
  weight: number;
  status: CaelRatioStatus;
  /** Regulatory source / circular the threshold derives from. */
  source: string;
  /** True when the threshold is PROVISIONAL config (UNVERIFIED reg text). */
  provisional: boolean;
}

/** The allowance leg that distinguishes the three CAEL variants. */
export interface CaelAllowanceResult {
  basis: CaelLossBasis;
  totalAllowance: number | null;
  totalLoans: number | null;
  /** allowance ÷ loans × 100. `null` when either input is missing. */
  coveragePct: number | null;
  methodology: string | null;
}

/** Pre-computed engine inputs for one CAEL variant — the projector's contract. */
export interface CaelComplianceInput {
  variant: CaelVariant;
  /** Indivisible-capital-over-RWA ratio (%), for the 7790 / CECL variants. */
  capitalRatioRwaPct: number | null;
  /** Net-Equity ratio = equity ÷ assets (%), for the Piloto variant. */
  netEquityRatioPct: number | null;
  /** Delinquency / NPL ratio (%). `null` ⇒ not on the aggregate balance sheet. */
  delinquencyPct: number | null;
  /** Return on assets (%) — the earnings leg. */
  roaPct: number | null;
  /** Liquidity ratio = liquid assets ÷ total assets (%). */
  liquidityRatioPct: number | null;
  /** Variant allowance (incurred-loss / CECL). `null` for the Piloto variant. */
  allowance: CaelAllowanceResult | null;
}

export interface CaelComplianceResult {
  variant: CaelVariant;
  frameworkId: string;
  frameworkName: string;
  frameworkNameEs: string;
  lossBasis: CaelLossBasis;
  ratios: CaelRatioEvaluation[];
  allowance: CaelAllowanceResult;
  composite: {
    /** Weighted pass-rate over the legs with a definitive (pass/fail) verdict. */
    examReadinessScore: number | null;
    /** Sum of weights that contributed to the score. */
    computableWeight: number;
    /** True when any contributing leg's band is PROVISIONAL (UNVERIFIED). */
    provisional: boolean;
  };
  overallStatus:
    | 'compliant'
    | 'conditional'
    | 'non-compliant'
    | 'data_unavailable';
  provenance: string;
  gaps: DataGap[];
}

@Injectable()
export class CaelComplianceService {
  /**
   * Evaluate one CAEL variant from pre-computed engine inputs. Pure: the same
   * inputs always yield the same verdict.
   */
  evaluateCaelCompliance(input: CaelComplianceInput): CaelComplianceResult {
    const framework = getCaelFramework(input.variant);
    const gaps: DataGap[] = [];

    const allowance: CaelAllowanceResult = input.allowance ?? {
      basis: framework.lossBasis,
      totalAllowance: null,
      totalLoans: null,
      coveragePct: null,
      methodology: null,
    };

    const ratios = framework.ratios.map((r) =>
      this.evaluateLeg(r, input, gaps),
    );

    // Composite: weighted pass-rate over legs with a definitive pass/fail.
    const contributing = ratios.filter(
      (r) => r.status === 'pass' || r.status === 'fail',
    );
    const computableWeight = contributing.reduce((s, r) => s + r.weight, 0);
    const examReadinessScore =
      computableWeight > 0
        ? round(
            (contributing.reduce(
              (s, r) => s + (r.status === 'pass' ? r.weight : 0),
              0,
            ) /
              computableWeight) *
              100,
          )
        : null;
    const provisionalContributes = contributing.some((r) => r.provisional);

    if (provisionalContributes) {
      gaps.push(
        dataGap('cael.bands.provisional', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'WARNING',
          action:
            'Una o más bandas CAEL (Reglamento 7790) son PROVISIONALES — el texto operativo es un escaneo sin OCR; trate el estatus como preliminar hasta validar con COSSEC. / One or more CAEL bands (Reglamento 7790) are PROVISIONAL — the operative text is a non-OCR scan; treat the status as preliminary pending COSSEC validation.',
        }),
      );
    }

    const overallStatus = this.resolveOverallStatus(ratios, computableWeight);

    return {
      variant: input.variant,
      frameworkId: framework.id,
      frameworkName: framework.name,
      frameworkNameEs: framework.nameEs,
      lossBasis: framework.lossBasis,
      ratios,
      allowance,
      composite: {
        examReadinessScore,
        computableWeight,
        provisional: provisionalContributes,
      },
      overallStatus,
      provenance: framework.provenance,
      gaps,
    };
  }

  /**
   * Map raw engine outputs (a COSSEC summary + the variant's CECL/incurred-loss
   * allowance) into the projector's input. Pure structural adapter — no coupling
   * to the concrete engine result types, so callers (and the golden harness)
   * stay decoupled.
   */
  caelInputsFromEngines(
    variant: CaelVariant,
    summary: {
      equity: number;
      totalAssets: number;
      capitalRatioRWA?: number | null;
      liquidityRatio: number;
      interestIncome: number;
      interestExpense: number;
    },
    allowanceSummary: {
      totalAllowance: number;
      totalBalance: number;
      methodology: string;
      overallStatus?: 'computed' | 'data_unavailable';
    } | null,
  ): CaelComplianceInput {
    const totalAssets = Number(summary.totalAssets);
    const netEquityRatioPct =
      totalAssets > 0
        ? round((Number(summary.equity) / totalAssets) * 100)
        : null;
    const roaPct =
      totalAssets > 0
        ? round(
            ((Number(summary.interestIncome) -
              Number(summary.interestExpense)) /
              totalAssets) *
              100,
          )
        : null;
    const capitalRatioRwaPct =
      summary.capitalRatioRWA === null || summary.capitalRatioRWA === undefined
        ? null
        : round(Number(summary.capitalRatioRWA));

    const lossBasis = getCaelFramework(variant).lossBasis;
    let allowance: CaelAllowanceResult | null = null;
    if (lossBasis !== 'n/a' && allowanceSummary) {
      const computed = allowanceSummary.overallStatus !== 'data_unavailable';
      const totalLoans = computed
        ? Number(allowanceSummary.totalBalance)
        : null;
      const totalAllowance = computed
        ? Number(allowanceSummary.totalAllowance)
        : null;
      allowance = {
        basis: lossBasis,
        totalAllowance,
        totalLoans,
        coveragePct:
          totalLoans && totalLoans > 0 && totalAllowance !== null
            ? round((totalAllowance / totalLoans) * 100)
            : null,
        methodology: allowanceSummary.methodology,
      };
    }

    return {
      variant,
      capitalRatioRwaPct,
      netEquityRatioPct,
      // NPL / delinquency is not carried on a PR coop's aggregate balance sheet.
      delinquencyPct: null,
      roaPct,
      liquidityRatioPct:
        summary.liquidityRatio === null || summary.liquidityRatio === undefined
          ? null
          : round(Number(summary.liquidityRatio)),
      allowance,
    };
  }

  // ─── internals ───

  private evaluateLeg(
    ratio: CaelRatio,
    input: CaelComplianceInput,
    gaps: DataGap[],
  ): CaelRatioEvaluation {
    const value = this.legValue(ratio.category, input);
    let status: CaelRatioStatus;
    if (ratio.thresholdDirection === 'info') {
      status = 'info';
    } else if (value === null) {
      status = 'data_unavailable';
      gaps.push(
        dataGap(`cael.${ratio.category}`, 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'WARNING',
          action:
            ratio.category === 'asset_quality'
              ? 'La calidad de activos (morosidad/NPL) no está en el balance agregado de la cooperativa — cargue datos de préstamos morosos para evaluar esta razón. / Asset quality (delinquency/NPL) is not on the cooperativa aggregate balance sheet — load delinquent-loan data to evaluate this ratio.'
              : `No hay datos suficientes para la razón ${ratio.nameEs}. / Insufficient data for the ${ratio.name} ratio.`,
          context: { category: ratio.category, variant: input.variant },
        }),
      );
    } else {
      status = this.compare(value, ratio.thresholdDirection, ratio.threshold);
    }
    return {
      id: ratio.id,
      name: ratio.name,
      nameEs: ratio.nameEs,
      category: ratio.category,
      value,
      unit: '%',
      threshold: ratio.threshold,
      thresholdDirection: ratio.thresholdDirection,
      weight: ratio.weight,
      status,
      source: ratio.source,
      provisional: ratio.provisional,
    };
  }

  /** Pull the computed value for a leg's category from the input. */
  private legValue(
    category: string,
    input: CaelComplianceInput,
  ): number | null {
    switch (category) {
      case 'capital':
        // Piloto's capital leg is the Net-Equity ratio (≥4%); the 7790 / CECL
        // variants use the indivisible-capital-over-RWA ratio (≥8%).
        return input.variant === 'piloto'
          ? input.netEquityRatioPct
          : input.capitalRatioRwaPct;
      case 'asset_quality':
        return input.delinquencyPct;
      case 'earnings':
        return input.roaPct;
      case 'liquidity':
        return input.liquidityRatioPct;
      default:
        return null;
    }
  }

  /**
   * Binary pass/fail against the framework threshold. No invented warning band —
   * the CAEL bands are themselves UNVERIFIED, so manufacturing an intermediate
   * tier would fabricate config; the `provisional` flag carries that caveat.
   */
  private compare(
    value: number,
    direction: 'gte' | 'lte' | 'range' | 'info',
    threshold: string,
  ): CaelRatioStatus {
    const limit = parseThreshold(threshold);
    if (limit === null) return 'info';
    if (direction === 'gte') return value >= limit ? 'pass' : 'fail';
    if (direction === 'lte') return value <= limit ? 'pass' : 'fail';
    return 'info';
  }

  private resolveOverallStatus(
    ratios: CaelRatioEvaluation[],
    computableWeight: number,
  ): CaelComplianceResult['overallStatus'] {
    if (computableWeight === 0) return 'data_unavailable';
    const statutoryFail = ratios.some(
      (r) => !r.provisional && r.status === 'fail',
    );
    if (statutoryFail) return 'non-compliant';
    const softGap = ratios.some(
      (r) => r.status === 'fail' || r.status === 'data_unavailable',
    );
    return softGap ? 'conditional' : 'compliant';
  }
}

/** Round to 4 dp — matches the golden-reconciliation normalize() precision. */
function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Extract the first numeric literal from a threshold string (">= 8%" → 8). */
function parseThreshold(threshold: string): number | null {
  const m = threshold.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
