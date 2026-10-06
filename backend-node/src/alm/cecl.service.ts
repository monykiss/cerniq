import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  COOPERATIVA_PRODUCT_REGISTRY,
  PR_PD_MULTIPLIERS,
  PR_SCENARIO_WEIGHTS,
  matchProductType,
  type CooperativaProductType,
} from './cooperativa/product-registry';
import { MacroOverlayService } from './macro-overlay.service';
import { getMacroOverlayMode } from './macro-overlay-config.util';
import type { DataGap } from './reports/data-gap';

// ─── Macro Scenario Weights (FASB 326 guidance) ──────────────

const SCENARIO_WEIGHTS = {
  baseline: 0.5,
  adverse: 0.3,
  severely_adverse: 0.2,
};

/**
 * PD×LGD Expected Credit Loss Model (Point-in-Time approach).
 *
 * Methodology: Base PD is the institution's historical 1-year marginal default probability.
 * Scenario multipliers convert from TTC (through-the-cycle) baseline to PIT (point-in-time)
 * conditional PDs per CCAR/DFAST guidance:
 * - Baseline: 1.0x (current economic conditions)
 * - Adverse: 1.8x (per FRB 2024 CCAR adverse scenario calibration)
 * - Severely Adverse: 3.0x (per FRB 2024 CCAR severely adverse scenario)
 *
 * Scenario weights follow FASB 326 guidance for community institutions:
 * - Baseline: 50% (most likely economic path)
 * - Adverse: 30% (moderate downturn)
 * - Severely Adverse: 20% (tail risk)
 *
 * Source: FRB SR Letter 99-18, FASB ASU 2016-13, NCUA Supervisory Letter 19-01
 */

// PD multiplier by scenario
const PD_MULTIPLIERS = {
  baseline: 1.0,
  adverse: 1.8,
  severely_adverse: 3.0,
};

// ─── Incurred-Loss horizon (Reglamento 8665 §2.12.2.5) ───────

/**
 * Loss-Emergence Period (LEP), in years, for the incurred-loss allowance basis.
 *
 * The incurred-loss method (legacy ALLL under ASC 450-20, mapped to COSSEC
 * Reglamento 8665 §2.12.2.5) recognizes losses *already incurred but not yet
 * confirmed* over a short emergence window — in contrast to CECL/WARM, which
 * recognizes *lifetime* expected losses scaled by remaining maturity. The one
 * structural difference between the two allowances is this horizon multiplier:
 *
 *   incurred-loss = balance × (historicalLossRate + qualitativeAdj) × LEP
 *   CECL / WARM   = balance × (historicalLossRate + qualitativeAdj) × WARL × pvFactor
 *
 * DISCLOSED CONFIG (D1): the exact LEP and any phase-in in Reglamento 8665
 * §2.12.2.5 are UNVERIFIED — the operative text is a non-OCR scan (market research notes
 * §9 item 3 / CC-2023-01). Until the OCR'd circular is obtained we default to a
 * 12-month emergence period (the conventional ASC 450-20 ALLL window) and emit a
 * WARNING DataGap on every incurred-loss computation so an examiner sees the
 * assumption rather than inferring a verified figure. NEVER ship this value
 * silently — it is an estimate presented as an estimate.
 */
const INCURRED_LOSS_EMERGENCE_PERIOD_YEARS = 1.0;

// ─── Types ───────────────────────────────────────────────────

export interface CECLSegmentResult {
  segmentName: string;
  balance: number;
  methodology: string;
  historicalLossRate: number;
  qualitativeAdj: number;
  adjustedLossRate: number;
  expectedLoss: number;
  allowanceRequired: number;
  coverageRatio: number; // allowance / balance
}

/**
 * CECL summary. D1 (2026-04-07): when no segments are provided (or all
 * segment balances are zero), the result reports `overallStatus: 'data_unavailable'`
 * and the `gaps[]` manifest carries a CRITICAL entry. The previous behavior
 * was to return `{totalBalance: 0, totalAllowance: 0}` — a "valid" zero
 * CECL allowance for an institution with no loan data. That zero would
 * appear on the audit pack as a measured zero, not as missing data.
 */
export interface CECLSummary {
  totalBalance: number;
  totalAllowance: number;
  weightedCoverageRatio: number;
  methodology: string;
  segments: CECLSegmentResult[];
  macroScenarioBreakdown?: {
    baseline: number;
    adverse: number;
    severelyAdverse: number;
    weighted: number;
  };
  overallStatus?: 'computed' | 'data_unavailable';
  /**
   * Measurement-basis disclosure (cooperativa path). CECL is ASC 326 (GAAP);
   * COSSEC reporting is CAEL/RAP transitioning to GAAP — examiner-relevant, so
   * the basis is surfaced rather than left implicit in code comments.
   */
  accountingBasis?: {
    framework: string;
    regulatoryContext: string;
    effectiveNote: string;
  };
  /**
   * W1.2 (cooperativa path, derived mode only): provenance of the PR macro
   * overlay actually applied — which basis produced the multipliers/weights,
   * from which macro inputs, at what stress index. Absent = the legacy
   * hard-coded constants were used (pre-W1.2 consumers, or the
   * CECL_MACRO_OVERLAY_MODE=hardcoded kill switch), keeping legacy output
   * byte-identical.
   */
  macroOverlay?: {
    basis: 'derived-from-macro' | 'hardcoded-fallback';
    macroStressIndex: number | null;
    inputs: {
      prUnemploymentPct: number;
      prHpiYoyPct: number;
      prNetMigrationPct: number;
      asOf?: string;
    } | null;
    provenance: string;
  };
  gaps?: import('./reports/data-gap').DataGap[];
}

export interface CECLForecast {
  quarters: Array<{
    quarter: string;
    allowance: number;
    provisionExpense: number;
    netChargeOffs: number;
    coverageRatio: number;
  }>;
  totalProvision12M: number;
}

@Injectable()
export class CECLService {
  private readonly logger = new Logger(CECLService.name);

  /**
   * W1.2: the macro overlay is optional so the five direct `new
   * CECLService(prisma)` sites (specs, CLI scripts, demo harness) keep
   * compiling; AlmModule DI wires it. Absent → legacy hard-coded PR
   * constants, byte-identical output.
   */
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly macroOverlay?: MacroOverlayService,
  ) {}

  // ─── WARM Method (Weighted Average Remaining Life) ─────────

  /**
   * Validate and sanitize segment inputs.
   * Clamps values to reasonable bounds to prevent nonsensical results.
   */
  private validateSegment(seg: {
    segmentName: string;
    balance: number;
    weightedAvgMaturity: number;
    historicalLossRate: number;
    lgd?: number;
    qualitativeAdj?: number;
    discountRate?: number;
  }): {
    segmentName: string;
    balance: number;
    weightedAvgMaturity: number;
    historicalLossRate: number;
    lgd: number;
    qualitativeAdj: number;
    discountRate: number;
  } {
    // Prisma Decimal inputs arrive TYPED as `number` but are Decimal OBJECTS at
    // runtime (the generic computeAnalysis path maps balanceSheet → segmentData
    // without coercion). `Number.isFinite(Decimal)` is ALWAYS false, so the
    // guards below silently zeroed balance / historicalLossRate → a $0 CECL
    // allowance filed for an institution with real loans. Coerce with Number()
    // FIRST so isFinite (and the clamps) operate on real numbers; an absent
    // optional field coerces to NaN → isFinite false → the documented default.
    const balance = Number(seg.balance);
    const weightedAvgMaturity = Number(seg.weightedAvgMaturity);
    const historicalLossRate = Number(seg.historicalLossRate);
    const lgd = Number(seg.lgd);
    const qualitativeAdj = Number(seg.qualitativeAdj);
    const discountRate = Number(seg.discountRate);
    return {
      segmentName: seg.segmentName || 'Unknown',
      balance: Math.max(0, Number.isFinite(balance) ? balance : 0),
      weightedAvgMaturity: Math.max(
        0,
        Math.min(
          Number.isFinite(weightedAvgMaturity) ? weightedAvgMaturity : 0,
          50,
        ),
      ), // cap at 50 years
      historicalLossRate: Math.max(
        0,
        Math.min(
          Number.isFinite(historicalLossRate) ? historicalLossRate : 0,
          1,
        ),
      ), // 0-100%
      lgd: Math.max(0, Math.min(Number.isFinite(lgd) ? lgd : 0.5, 1)), // 0-100%
      // Qualitative adjustment per CERNIQ Model Governance Policy v1.0
      // Cap: ±10% for standard segments, ±15% for emerging risk segments
      // Justification must be documented per FASB 326 qualitative framework
      qualitativeAdj: Math.max(
        -0.1,
        Math.min(Number.isFinite(qualitativeAdj) ? qualitativeAdj : 0, 0.1),
      ), // -10% to +10%
      discountRate: Math.max(
        0,
        Math.min(Number.isFinite(discountRate) ? discountRate : 0.03, 0.2),
      ), // 0-20%, default 3%
    };
  }

  calculateWARM(
    segments: Array<{
      segmentName: string;
      balance: number;
      weightedAvgMaturity: number;
      historicalLossRate: number;
      lgd?: number;
      qualitativeAdj?: number;
      discountRate?: number;
    }>,
  ): CECLSummary {
    // D1 (2026-04-07): refuse to compute CECL on empty segments. Returning
    // a "valid" zero allowance for an institution with no loan data is
    // exactly the silent-failure pattern that surfaces on audit packs as
    // a measured zero. Surface a CRITICAL gap instead.
    if (segments.length === 0 || segments.every((s) => !s.balance)) {
      this.logger.warn({
        event: 'cecl_data_unavailable',
        methodology: 'WARM',
        reason: 'EMPTY_SEGMENTS',
      });
      return this.dataUnavailableSummary('WARM', 'no segments provided');
    }
    const results: CECLSegmentResult[] = segments.map((rawSeg) => {
      const seg = this.validateSegment(rawSeg);
      const adjRate = seg.historicalLossRate + seg.qualitativeAdj;
      // FASB 326 requires PV discounting of expected losses (ASC 326-20-30-4)
      const discountRate = seg.discountRate ?? 0.03; // Default 3% if not specified
      const undiscountedLoss = adjRate * seg.weightedAvgMaturity;
      const pvFactor =
        seg.weightedAvgMaturity > 0
          ? (1 - Math.pow(1 + discountRate, -seg.weightedAvgMaturity)) /
            (discountRate * seg.weightedAvgMaturity)
          : 1;
      const lifetimeLossRate = Math.min(undiscountedLoss * pvFactor, 1);
      const expectedLoss = seg.balance * lifetimeLossRate;
      const allowance = expectedLoss;

      return {
        segmentName: seg.segmentName,
        balance: seg.balance,
        methodology: 'WARM',
        historicalLossRate: seg.historicalLossRate,
        qualitativeAdj: seg.qualitativeAdj,
        adjustedLossRate: adjRate,
        expectedLoss,
        allowanceRequired: allowance,
        coverageRatio: seg.balance > 0 ? allowance / seg.balance : 0,
      };
    });

    const totalBalance = results.reduce((sum, r) => sum + Number(r.balance), 0);
    const totalAllowance = results.reduce(
      (sum, r) => sum + r.allowanceRequired,
      0,
    );

    return {
      totalBalance,
      totalAllowance,
      weightedCoverageRatio:
        totalBalance > 0 ? totalAllowance / totalBalance : 0,
      methodology: 'WARM',
      segments: results,
      overallStatus: 'computed',
    };
  }

  // ─── Incurred-Loss Method (Reglamento 8665 §2.12.2.5) ──────

  /**
   * Incurred-loss allowance (COSSEC Reglamento 8665 §2.12.2.5 / legacy
   * ASC 450-20 ALLL). Mirrors {@link calculateWARM}'s inputs but applies a short
   * loss-emergence horizon instead of remaining life, producing the incurred-loss
   * leg of the CAEL dual filing (Wave 1, W1.1). Per the confirmed 12-month-LEP
   * convention: `allowance = balance × (lossRate + qFactor) × LEP`, no PV discount,
   * no forward-looking macro overlay — the honest, backward-looking contrast to
   * CECL's lifetime number.
   *
   * D1: refuses to compute on empty / all-zero-balance segments (returns
   * `data_unavailable` + CRITICAL gap) and ALWAYS attaches a WARNING gap
   * disclosing that the LEP and exact §2.12.2.5 basis are provisional config
   * pending the OCR'd circular. WARNING gaps render the report; they do not block.
   */
  calculateIncurredLoss(
    segments: Array<{
      segmentName: string;
      balance: number;
      weightedAvgMaturity: number;
      historicalLossRate: number;
      lgd?: number;
      qualitativeAdj?: number;
      discountRate?: number;
    }>,
    options: { lossEmergencePeriodYears?: number } = {},
  ): CECLSummary {
    const methodology = 'Incurred Loss (Reg 8665)';

    // D1: same empty-segment guard as WARM — an institution with no loan data
    // gets `data_unavailable`, never a "valid" $0 incurred-loss allowance.
    if (segments.length === 0 || segments.every((s) => !s.balance)) {
      this.logger.warn({
        event: 'cecl_data_unavailable',
        methodology,
        reason: 'EMPTY_SEGMENTS',
      });
      return this.dataUnavailableSummary(methodology, 'no segments provided');
    }

    const lep = this.resolveLossEmergencePeriod(
      options.lossEmergencePeriodYears,
    );

    const results: CECLSegmentResult[] = segments.map((rawSeg) => {
      const seg = this.validateSegment(rawSeg);
      // Annual adjusted loss rate, identical to WARM (historical + qualitative).
      const adjRate = seg.historicalLossRate + seg.qualitativeAdj;
      // Incurred-loss horizon = emergence period, NOT remaining life. No PV
      // discount (ASC 450-20 incurred losses are undiscounted), no macro overlay.
      const incurredLossRate = Math.min(Math.max(adjRate, 0) * lep, 1);
      const expectedLoss = seg.balance * incurredLossRate;

      return {
        segmentName: seg.segmentName,
        balance: seg.balance,
        methodology,
        historicalLossRate: seg.historicalLossRate,
        qualitativeAdj: seg.qualitativeAdj,
        adjustedLossRate: adjRate,
        expectedLoss,
        allowanceRequired: expectedLoss,
        coverageRatio: seg.balance > 0 ? expectedLoss / seg.balance : 0,
      };
    });

    const totalBalance = results.reduce((sum, r) => sum + Number(r.balance), 0);
    const totalAllowance = results.reduce(
      (sum, r) => sum + r.allowanceRequired,
      0,
    );

    return {
      totalBalance,
      totalAllowance,
      weightedCoverageRatio:
        totalBalance > 0 ? totalAllowance / totalBalance : 0,
      methodology,
      segments: results,
      overallStatus: 'computed',
      accountingBasis: {
        framework:
          'Reglamento 8665 §2.12.2.5 (pérdida incurrida) — base de medición RAP / Reg 8665 §2.12.2.5 (incurred loss) — RAP measurement basis',
        regulatoryContext:
          'Base de pérdida incurrida para el CAEL (Reglamento 7790); coexiste con el cómputo CECL (ASC 326) durante la transición RAP→GAAP (~2028). / Incurred-loss basis for CAEL (Reg 7790); coexists with the CECL (ASC 326) computation during the RAP→GAAP transition (~2028).',
        effectiveNote: `Horizonte de emergencia de pérdida (LEP) = ${lep} año(s); sin descuento a valor presente. / Loss-emergence period (LEP) = ${lep} year(s); undiscounted.`,
      },
      gaps: [
        {
          field: 'cecl.incurredLoss.lossEmergencePeriod',
          reason: 'COSSEC_INPUTS_INSUFFICIENT',
          severity: 'WARNING',
          action: `El período de emergencia de pérdida (${lep} año) y la base exacta del Reglamento 8665 §2.12.2.5 son configuración PROVISIONAL — el texto operativo es un escaneo sin OCR (CC-2023-01); confirmar con COSSEC antes de presentar. / The loss-emergence period (${lep}yr) and the exact Reglamento 8665 §2.12.2.5 basis are PROVISIONAL config — the operative text is a non-OCR scan (CC-2023-01); confirm with COSSEC before filing.`,
          context: {
            lossEmergencePeriodYears: lep,
            source: 'Reg 8665 §2.12.2.5 (UNVERIFIED)',
          },
        },
      ],
    };
  }

  /**
   * Clamp the loss-emergence period to a sane 0–10yr window; falls back to the
   * disclosed 12-month default when the input is absent or non-positive.
   */
  private resolveLossEmergencePeriod(input?: number): number {
    const v = Number(input);
    if (!Number.isFinite(v) || v <= 0) {
      return INCURRED_LOSS_EMERGENCE_PERIOD_YEARS;
    }
    return Math.min(v, 10);
  }

  /**
   * Build the structured `data_unavailable` shell returned when no segments
   * are provided. The numeric fields are zero by necessity (the type doesn't
   * admit null), but `overallStatus === 'data_unavailable'` and the gap
   * manifest mean callers can tell phantom zero from measured zero.
   */
  private dataUnavailableSummary(
    methodology: string,
    reason: string,
  ): CECLSummary {
    return {
      totalBalance: 0,
      totalAllowance: 0,
      weightedCoverageRatio: 0,
      methodology,
      segments: [],
      overallStatus: 'data_unavailable',
      gaps: [
        {
          field: 'cecl.segments',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
          action: `Provide loan segments (consumer, mortgage, commercial, etc.) before computing the CECL allowance under ${methodology}. ${reason}.`,
        },
      ],
    };
  }

  // ─── Vintage / Cohort Analysis ────────────────────────────

  calculateVintage(
    segments: Array<{
      segmentName: string;
      balance: number;
      weightedAvgMaturity: number;
      historicalLossRate: number;
      lgd?: number;
      qualitativeAdj?: number;
      discountRate?: number;
    }>,
  ): CECLSummary {
    if (segments.length === 0 || segments.every((s) => !s.balance)) {
      this.logger.warn({
        event: 'cecl_data_unavailable',
        methodology: 'Vintage',
        reason: 'EMPTY_SEGMENTS',
      });
      return this.dataUnavailableSummary('Vintage', 'no segments provided');
    }
    const results: CECLSegmentResult[] = segments.map((rawSeg) => {
      const seg = this.validateSegment(rawSeg);
      // Vintage: cumulative loss curve based on age
      // Simplified: use loss emergence pattern (30% Y1, 25% Y2, 20% Y3, 15% Y4, 10% Y5+)
      const emergencePattern = [0.3, 0.25, 0.2, 0.15, 0.1];
      const years = Math.ceil(seg.weightedAvgMaturity);
      const adjRate = seg.historicalLossRate + seg.qualitativeAdj;

      let cumulativeLoss = 0;
      for (let y = 0; y < Math.min(years, emergencePattern.length); y++) {
        cumulativeLoss += adjRate * emergencePattern[y];
      }
      // Any remaining years use flat tail
      if (years > emergencePattern.length) {
        const remainingYears = years - emergencePattern.length;
        cumulativeLoss += adjRate * 0.05 * remainingYears;
      }

      // Cap cumulative loss at 100%
      cumulativeLoss = Math.min(cumulativeLoss, 1);

      const expectedLoss = seg.balance * cumulativeLoss;
      const allowance = expectedLoss * seg.lgd;

      return {
        segmentName: seg.segmentName,
        balance: seg.balance,
        methodology: 'Vintage',
        historicalLossRate: seg.historicalLossRate,
        qualitativeAdj: seg.qualitativeAdj,
        adjustedLossRate: adjRate,
        expectedLoss,
        allowanceRequired: allowance,
        coverageRatio: seg.balance > 0 ? allowance / seg.balance : 0,
      };
    });

    const totalBalance = results.reduce((sum, r) => sum + Number(r.balance), 0);
    const totalAllowance = results.reduce(
      (sum, r) => sum + r.allowanceRequired,
      0,
    );

    return {
      totalBalance,
      totalAllowance,
      weightedCoverageRatio:
        totalBalance > 0 ? totalAllowance / totalBalance : 0,
      methodology: 'Vintage',
      segments: results,
      overallStatus: 'computed',
    };
  }

  // ─── PD × LGD with Macro Scenarios ────────────────────────

  calculatePDxLGD(
    segments: Array<{
      segmentName: string;
      balance: number;
      weightedAvgMaturity: number;
      historicalLossRate: number;
      lgd?: number;
      qualitativeAdj?: number;
      discountRate?: number;
    }>,
    overlay?: {
      /** Scenario PD multipliers (defaults to mainland CCAR). */
      pdMultipliers?: Record<string, number>;
      /** Scenario probability weights (defaults to FASB community 50/30/20). */
      scenarioWeights?: {
        baseline: number;
        adverse: number;
        severely_adverse: number;
      };
      /** Label appended to the methodology string for report provenance. */
      overlayLabel?: string;
    },
  ): CECLSummary {
    if (segments.length === 0 || segments.every((s) => !s.balance)) {
      this.logger.warn({
        event: 'cecl_data_unavailable',
        methodology: 'PDxLGD',
        reason: 'EMPTY_SEGMENTS',
      });
      return this.dataUnavailableSummary('PDxLGD', 'no segments provided');
    }
    const pdMultipliers = overlay?.pdMultipliers ?? PD_MULTIPLIERS;
    const weights = overlay?.scenarioWeights ?? SCENARIO_WEIGHTS;
    const methodologyLabel = overlay?.overlayLabel
      ? `PD×LGD (${overlay.overlayLabel})`
      : 'PD×LGD';
    const scenarioResults: Record<string, CECLSegmentResult[]> = {};
    const scenarioTotals: Record<string, number> = {};

    for (const [scenario, pdMult] of Object.entries(pdMultipliers)) {
      const results: CECLSegmentResult[] = segments.map((rawSeg) => {
        const seg = this.validateSegment(rawSeg);
        const basePD = seg.historicalLossRate + seg.qualitativeAdj;
        // Clamp scenarioPD to [0, 1) to prevent Math.pow domain issues
        const scenarioPD = Math.max(0, Math.min(basePD * pdMult, 0.99));

        // Lifetime PD: 1 - (1 - annual PD)^maturity
        const lifetimePD =
          1 - Math.pow(1 - scenarioPD, seg.weightedAvgMaturity);
        const expectedLoss = seg.balance * lifetimePD * seg.lgd;

        return {
          segmentName: seg.segmentName,
          balance: seg.balance,
          methodology: `PD*LGD (${scenario})`,
          historicalLossRate: seg.historicalLossRate,
          qualitativeAdj: seg.qualitativeAdj,
          adjustedLossRate: scenarioPD,
          expectedLoss,
          allowanceRequired: expectedLoss,
          coverageRatio: seg.balance > 0 ? expectedLoss / seg.balance : 0,
        };
      });

      scenarioResults[scenario] = results;
      scenarioTotals[scenario] = results.reduce(
        (sum, r) => sum + r.allowanceRequired,
        0,
      );
    }

    // Weighted average across scenarios
    const weightedAllowance =
      scenarioTotals.baseline * weights.baseline +
      scenarioTotals.adverse * weights.adverse +
      scenarioTotals.severely_adverse * weights.severely_adverse;

    // Use baseline segment breakdown with weighted allowance
    const baselineResults = scenarioResults.baseline;
    const totalBalance = baselineResults.reduce(
      (sum, r) => sum + Number(r.balance),
      0,
    );

    // Prorate weighted allowance across segments
    const baselineTotal = scenarioTotals.baseline || 1;
    const weightedResults = baselineResults.map((r) => ({
      ...r,
      methodology: `${methodologyLabel} (Weighted)`,
      allowanceRequired:
        (r.allowanceRequired / baselineTotal) * weightedAllowance,
      coverageRatio:
        r.balance > 0
          ? ((r.allowanceRequired / baselineTotal) * weightedAllowance) /
            r.balance
          : 0,
    }));

    return {
      totalBalance,
      totalAllowance: weightedAllowance,
      weightedCoverageRatio:
        totalBalance > 0 ? weightedAllowance / totalBalance : 0,
      methodology: methodologyLabel,
      segments: weightedResults,
      macroScenarioBreakdown: {
        baseline: scenarioTotals.baseline,
        adverse: scenarioTotals.adverse,
        severelyAdverse: scenarioTotals.severely_adverse,
        weighted: weightedAllowance,
      },
      overallStatus: 'computed',
    };
  }

  // ─── Enterprise: Full CECL Analysis ────────────────────────

  async getCECLAnalysis(
    institutionId: string,
    methodology?: string,
  ): Promise<CECLSummary> {
    const segments = await this.prisma.loanSegment.findMany({
      where: { institutionId },
      orderBy: { balance: 'desc' },
    });

    // D1 (2026-04-07): the previous behavior fell back to DEMO segments
    // and produced a real-looking CECL allowance against fake data — a
    // worse failure mode than silent zero. Now we refuse and surface a
    // CRITICAL gap (the demo-segment helper has since been removed entirely,
    // so there is no longer any path that substitutes fabricated segments).
    if (segments.length === 0) {
      this.logger.warn({
        event: 'cecl_data_unavailable',
        institutionId,
        reason: 'NO_LOAN_SEGMENTS',
      });
      return this.dataUnavailableSummary(
        methodology ?? 'WARM',
        'institution has no loan segments configured',
      );
    }

    const segmentData = segments.map((s: any) => ({
      segmentName: s.segmentName,
      balance: s.balance,
      weightedAvgRate: s.weightedAvgRate,
      weightedAvgMaturity: s.weightedAvgMaturity,
      historicalLossRate: s.historicalLossRate,
      lgd: s.lgd,
      qualitativeAdj: s.qualitativeAdj,
    }));

    switch (methodology) {
      case 'vintage':
        return this.calculateVintage(segmentData);
      case 'pdlgd':
        return this.calculatePDxLGD(segmentData);
      case 'incurredloss':
      case 'incurred-loss':
        return this.calculateIncurredLoss(segmentData);
      default:
        return this.calculateWARM(segmentData);
    }
  }

  // ─── Cooperativa CECL (PR-native, Layer 1) ─────────────────

  /**
   * Cooperativa-native CECL: classifies loan segments against the PR
   * product registry, fills cold-start PD/LGD from registry defaults when
   * the institution has no historical loss data (surfacing a WARNING gap
   * per default applied — defaults are disclosed configuration, never
   * silent substitutes, D1), and runs PD×LGD under the PR macro overlay
   * (hurricane/migration-calibrated multipliers and weights).
   */
  async getCooperativaCECLAnalysis(institutionId: string): Promise<
    CECLSummary & {
      productClassification: Array<{
        segmentName: string;
        productType: CooperativaProductType | null;
        nombre: string | null;
        defaultsApplied: boolean;
      }>;
    }
  > {
    const segments = await this.prisma.loanSegment.findMany({
      where: { institutionId },
      orderBy: { balance: 'desc' },
    });

    if (segments.length === 0) {
      this.logger.warn({
        event: 'cecl_data_unavailable',
        institutionId,
        reason: 'NO_LOAN_SEGMENTS',
      });
      return {
        ...this.dataUnavailableSummary(
          'PD×LGD (PR)',
          'institution has no loan segments configured',
        ),
        productClassification: [],
      };
    }

    const gaps: DataGap[] = [];
    const productClassification: Array<{
      segmentName: string;
      productType: CooperativaProductType | null;
      nombre: string | null;
      defaultsApplied: boolean;
    }> = [];

    interface EligibleSegment {
      segmentName: string;
      balance: number;
      weightedAvgMaturity: number;
      historicalLossRate: number;
      lgd: number;
      qualitativeAdj: number;
    }

    const segmentData: Array<EligibleSegment | null> = segments.map(
      // type-rationale: raw Prisma loan-segment rows (Decimal fields) reshaped into EligibleSegment; field access only, numeric coercion handled downstream
      (s: any) => {
        const name: string = s.segmentName;
        const productType = matchProductType(name);
        const registry = productType
          ? COOPERATIVA_PRODUCT_REGISTRY[productType]
          : null;

        const hasOwnLossRate = Number(s.historicalLossRate) > 0;
        const hasOwnLgd = s.lgd != null && Number(s.lgd) > 0;

        if (!productType) {
          // Unclassified. With no own loss history it is NOT estimable: a null
          // registry would feed PD=0 → $0 allowance while the balance stays in
          // the coverage denominator, silently UNDERSTATING coverage (D1).
          // Exclude it from BOTH the allowance and the denominator and disclose
          // the excluded balance. Keep it only if it carries its own loss rate.
          if (!hasOwnLossRate) {
            gaps.push({
              field: `cecl.segments.${name}`,
              reason: 'COSSEC_INPUTS_INSUFFICIENT',
              severity: 'WARNING',
              action: `El segmento "${name}" ($${(Number(s.balance) / 1_000_000).toFixed(1)}M) no corresponde a ningún producto conocido y no tiene historial de pérdida — se EXCLUYÓ del cálculo de provisión y cobertura para no subestimarlas. Clasifíquelo (préstamo personal, auto, hipoteca, comercial, garantía de acciones) o cargue su tasa de pérdida histórica. / Unclassified segment with no own loss history — EXCLUDED from the allowance and coverage so neither is understated.`,
            });
            productClassification.push({
              segmentName: name,
              productType: null,
              nombre: null,
              defaultsApplied: false,
            });
            return null;
          }
          // Unclassified but it has its own loss rate → estimable from own data.
          gaps.push({
            field: `cecl.segments.${name}`,
            reason: 'COSSEC_INPUTS_INSUFFICIENT',
            severity: 'WARNING',
            action: `El segmento "${name}" no corresponde a ningún producto de cooperativa conocido; se usó su historial de pérdida propio. Clasifíquelo manualmente (préstamo personal, auto, hipoteca, comercial, garantía de acciones) para aplicar la calibración del registro.`,
          });
        }

        // Liability-side products (Club de Navidad, ahorros, CDs) never
        // enter the allowance. Classify them but exclude from CECL math.
        if (registry && !registry.ceclEligible) {
          productClassification.push({
            segmentName: name,
            productType,
            nombre: registry.nombre,
            defaultsApplied: false,
          });
          return null;
        }

        const defaultsApplied = !!registry && (!hasOwnLossRate || !hasOwnLgd);

        if (defaultsApplied) {
          gaps.push({
            field: `cecl.segments.${name}`,
            reason: 'COSSEC_INPUTS_INSUFFICIENT',
            severity: 'WARNING',
            action: `Sin datos históricos de pérdida para "${name}" — se aplicó la calibración provisional del registro de productos (${registry.nombre}). Cargue el historial de pérdidas de la cooperativa para una estimación definitiva.`,
          });
        }

        productClassification.push({
          segmentName: name,
          productType,
          nombre: registry?.nombre ?? null,
          defaultsApplied,
        });

        return {
          segmentName: name,
          balance: Number(s.balance),
          weightedAvgMaturity:
            Number(s.weightedAvgMaturity) ||
            registry?.defaultMaturityYears ||
            0,
          historicalLossRate: hasOwnLossRate
            ? Number(s.historicalLossRate)
            : (registry?.defaultAnnualPd ?? 0),
          lgd: hasOwnLgd ? Number(s.lgd) : (registry?.defaultLgd ?? 0.5),
          qualitativeAdj: Number(s.qualitativeAdj) || 0,
        };
      },
    );

    const eligible = segmentData.filter(
      (s): s is EligibleSegment => s !== null,
    );

    if (eligible.length === 0 || eligible.every((s) => !s.balance)) {
      return {
        ...this.dataUnavailableSummary(
          'PD×LGD (PR)',
          'no CECL-eligible loan segments after classification',
        ),
        productClassification,
      };
    }

    // W1.2: derived mode routes the multipliers/weights through the
    // data-derived macro overlay (continuity guarantee: at the reference
    // macro state the derivation reduces exactly to the constants below, so
    // flipping the basis never silently moves the allowance). The kill
    // switch (CECL_MACRO_OVERLAY_MODE=hardcoded) and non-DI consumers fall
    // through to the legacy inline constants, byte-identical.
    const overlayResult =
      this.macroOverlay && getMacroOverlayMode() === 'derived'
        ? await this.macroOverlay.deriveCurrentOverlay()
        : null;

    const summary = this.calculatePDxLGD(eligible, {
      pdMultipliers: overlayResult
        ? { ...overlayResult.pdMultipliers }
        : { ...PR_PD_MULTIPLIERS },
      scenarioWeights: overlayResult
        ? { ...overlayResult.scenarioWeights }
        : { ...PR_SCENARIO_WEIGHTS },
      overlayLabel: 'PR',
    });

    // D1: always disclose that the PR macro overlay itself is a PROVISIONAL
    // calibration (an estimate presented as an estimate), independent of
    // whether per-segment registry PD/LGD defaults were applied. Derived
    // mode discloses through the overlay's own gaps (basis, stress index,
    // staleness); legacy mode keeps the original hard-coded disclosure.
    if (overlayResult) {
      gaps.push(...overlayResult.gaps);
    } else {
      gaps.push({
        field: 'cecl.macroOverlay',
        reason: 'COSSEC_INPUTS_INSUFFICIENT',
        severity: 'WARNING',
        action:
          'Los multiplicadores macro de PR (adverso 2.1x, severo 3.6x) y los pesos de escenario (45/35/20) son una calibración PROVISIONAL (post-María / migración); los valores definitivos requieren validación COSSEC/NCUA o calibración con datos propios. / The PR macro overlay multipliers (adverse 2.1x, severe 3.6x) and scenario weights (45/35/20) are a PROVISIONAL calibration; definitive values require COSSEC/NCUA validation or institution-specific calibration.',
      });
    }

    return {
      ...(overlayResult && {
        macroOverlay: {
          basis: overlayResult.basis,
          macroStressIndex: overlayResult.macroStressIndex,
          inputs: overlayResult.inputs,
          provenance: overlayResult.provenance,
        },
      }),
      ...summary,
      accountingBasis: {
        framework: 'ASC 326 (FASB ASU 2016-13, CECL) — GAAP measurement basis',
        regulatoryContext:
          'COSSEC CAEL con cómputo CECL (Reglamento 7790); reporte cooperativo en transición RAP→GAAP. / COSSEC CAEL with CECL computation (Reg. 7790); cooperativa reporting transitioning RAP→GAAP.',
        effectiveNote:
          'CECL efectivo para entidades no-PBE en años fiscales que comienzan después del 2022-12-15. / CECL effective for non-PBE entities for fiscal years beginning after 2022-12-15.',
      },
      gaps: [...(summary.gaps ?? []), ...gaps],
      productClassification,
    };
  }

  // ─── 8-Quarter Forecast ────────────────────────────────────

  async getCECLForecast(institutionId: string): Promise<CECLForecast> {
    const current = await this.getCECLAnalysis(institutionId);

    const quarters: CECLForecast['quarters'] = [];
    let prevAllowance = current.totalAllowance;
    const baseChargeOffRate = current.weightedCoverageRatio * 0.25; // quarterly

    for (let q = 1; q <= 8; q++) {
      // Assume gradual normalization
      const growthFactor = 1 + (q <= 4 ? 0.02 : -0.01); // slight growth then stabilization
      const quarterBalance = current.totalBalance * Math.pow(growthFactor, q);
      const quarterCoverage =
        current.weightedCoverageRatio * (1 + (q <= 2 ? 0.05 : -0.02) * q);
      const targetAllowance = quarterBalance * Math.max(quarterCoverage, 0.005);
      const netChargeOffs = quarterBalance * baseChargeOffRate * (1 + q * 0.05);
      const provisionExpense = targetAllowance - prevAllowance + netChargeOffs;

      const now = new Date();
      const quarterDate = new Date(
        now.getFullYear(),
        now.getMonth() + q * 3,
        1,
      );
      const quarterLabel = `Q${Math.ceil((quarterDate.getMonth() + 1) / 3)} ${quarterDate.getFullYear()}`;

      quarters.push({
        quarter: quarterLabel,
        allowance: targetAllowance,
        provisionExpense: Math.max(provisionExpense, 0),
        netChargeOffs,
        coverageRatio:
          quarterBalance > 0 ? targetAllowance / quarterBalance : 0,
      });

      prevAllowance = targetAllowance;
    }

    return {
      quarters,
      totalProvision12M: quarters
        .slice(0, 4)
        .reduce((sum, q) => sum + q.provisionExpense, 0),
    };
  }

  // ─── Import Segments ──────────────────────────────────────

  async importLoanSegments(
    institutionId: string,
    segments: Array<{
      segmentName: string;
      balance: number;
      weightedAvgRate: number;
      weightedAvgMaturity: number;
      historicalLossRate: number;
      lgd?: number;
      qualitativeAdj?: number;
    }>,
  ) {
    // Delete existing segments for this institution
    await this.prisma.loanSegment.deleteMany({ where: { institutionId } });

    const created = await this.prisma.loanSegment.createMany({
      data: segments.map((s) => ({
        institutionId,
        segmentName: s.segmentName,
        balance: s.balance,
        weightedAvgRate: s.weightedAvgRate,
        weightedAvgMaturity: s.weightedAvgMaturity,
        historicalLossRate: s.historicalLossRate,
        lgd: s.lgd ?? 0.5,
        qualitativeAdj: s.qualitativeAdj ?? 0,
        asOfDate: new Date(),
      })),
    });

    return { imported: created.count, institutionId };
  }
}
