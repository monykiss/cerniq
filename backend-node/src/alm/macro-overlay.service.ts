import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  PR_PD_MULTIPLIERS,
  PR_SCENARIO_WEIGHTS,
} from './cooperativa/product-registry';
// Runtime import one way only — pr-macro-feed imports PrMacroInputs from
// this module as `import type` (erased), so there is no runtime cycle.
import { PrMacroFeedService } from './pr-macro-feed.service';
import type { DataGap } from './reports/data-gap';

/**
 * PR Macro Overlay — data-derived CECL stress calibration (Wave 1, W1.2)
 *
 * The CECL cooperativa path currently scales PDs by HARD-CODED PR multipliers
 * (`PR_PD_MULTIPLIERS` adverse 2.1×/severe 3.6×) and scenario weights
 * (`PR_SCENARIO_WEIGHTS` 45/35/20) — a provisional "harsher because we said so"
 * calibration (market research notes §5). This service turns that into "harsher because
 * here's the sourced PR data": it DERIVES the overlay from PR macro inputs
 * (unemployment, HPI YoY, net migration) so the calibration is defensible under
 * a NASCUS-accredited examiner.
 *
 * Design (deterministic — no RNG, SR 11-7):
 *   - At a REFERENCE macro state the derivation reduces EXACTLY to the existing
 *     provisional constants (continuity — we don't silently re-baseline).
 *   - A Macro-Stress Index (MSI ≥ 0) rises as unemployment exceeds, HPI growth
 *     falls below, or out-migration worsens vs the reference; multipliers and
 *     scenario weights scale up with MSI, clamped to disclosed bounds.
 *
 * D1 / DISCLOSED CONFIG: BOTH paths emit a WARNING `DataGap` — the derived path
 * discloses "derived from sourced PR macro data, PROVISIONAL pending COSSEC
 * validation"; the no-input path discloses the hard-coded fallback. The `basis`
 * field makes which path was taken auditable. The overlay NEVER silently falls
 * back to constants without a gap (the W1.2 ratchet). Every coefficient below is
 * disclosed configuration, echoed in `provenance`, pending COSSEC calibration —
 * never presented as a verified figure.
 *
 * This is the DERIVATION engine (Slice 1), tested on cached fixtures. Wiring a
 * live FRED/BLS/Census feed (the `treasury-rates.service.ts` cached-fetch
 * pattern) and injecting this into `CECLService.getCooperativaCECLAnalysis` in
 * place of the hard-coded tuple are follow-up slices.
 */

export interface PrMacroInputs {
  /** PR unemployment rate, percent (BLS LAUS, e.g. 5.7). */
  prUnemploymentPct: number;
  /** PR house-price index, YoY percent change (FHFA, e.g. +4.2). */
  prHpiYoyPct: number;
  /** PR annual net migration as % of population; negative = net OUT-migration (e.g. -1.0). */
  prNetMigrationPct: number;
  /** Optional as-of label for provenance (e.g. "2026-Q1"). */
  asOf?: string;
}

export interface MacroOverlayResult {
  pdMultipliers: {
    baseline: number;
    adverse: number;
    severely_adverse: number;
  };
  scenarioWeights: {
    baseline: number;
    adverse: number;
    severely_adverse: number;
  };
  overlayLabel: 'PR';
  basis: 'derived-from-macro' | 'hardcoded-fallback';
  /** ≥0; 0 at the reference macro state. null on the fallback path. */
  macroStressIndex: number | null;
  inputs: PrMacroInputs | null;
  provenance: string;
  gaps: DataGap[];
}

/**
 * Reference macro state — the calibration point where the derivation reproduces
 * the existing provisional constants exactly. DISCLOSED config (PR "normal":
 * ~6% unemployment, ~+3% HPI, ~1%/yr net out-migration). Pending COSSEC cal.
 */
export const PR_MACRO_REFERENCE: PrMacroInputs = {
  prUnemploymentPct: 6.0,
  prHpiYoyPct: 3.0,
  prNetMigrationPct: -1.0,
};

/** MSI component weights (sum 1.0) + multiplier/weight sensitivities. DISCLOSED. */
const MSI_WEIGHTS = { unemployment: 0.5, hpi: 0.3, migration: 0.2 } as const;
const ADVERSE_SENSITIVITY = 0.5; // adverse multiplier grows 0.5×MSI of its base
const SEVERE_SENSITIVITY = 0.7; // severe is more MSI-sensitive than adverse
const WEIGHT_SHIFT_SENSITIVITY = 0.1; // baseline→tail mass shift per unit MSI
const MAX_MSI = 3;
const MAX_ADVERSE_MULT = 4.0;
const MAX_SEVERE_MULT = 6.0;
const MAX_WEIGHT_SHIFT = 0.25;

@Injectable()
export class MacroOverlayService {
  private readonly logger = new Logger(MacroOverlayService.name);

  /**
   * Feed is optional so pure-derivation contexts (`new MacroOverlayService()`
   * in specs, Slice-1 callers) keep working; DI wires it in AlmModule.
   */
  constructor(@Optional() private readonly feed?: PrMacroFeedService) {}

  /**
   * Slice-2 entry point: derive the overlay from the CURRENT macro state as
   * served by PrMacroFeedService (committed snapshot + optional FRED
   * refresh). Feed gaps (staleness, refresh failure) are merged into the
   * result's gaps and the feed's source provenance is appended, so the
   * consumer sees one complete disclosure. No feed (or a broken one) →
   * disclosed hard-coded fallback — never silent (the W1.2 ratchet).
   */
  async deriveCurrentOverlay(): Promise<MacroOverlayResult> {
    if (!this.feed) {
      return this.fallbackOverlay();
    }
    try {
      const snap = await this.feed.getSnapshot();
      const derived = this.deriveOverlay(snap.inputs);
      return {
        ...derived,
        gaps: [...derived.gaps, ...snap.gaps],
        provenance: `${derived.provenance} ${snap.provenance}`,
      };
    } catch (err) {
      // The feed degrades internally (fixture fallback + gaps); reaching
      // here means the feed itself is broken. Disclose and fall back.
      this.logger.warn(
        `PR macro feed failed, using hard-coded fallback overlay: ${err}`,
      );
      const fallback = this.fallbackOverlay();
      return {
        ...fallback,
        gaps: [
          ...fallback.gaps,
          {
            field: 'cecl.macroOverlay.feed',
            reason: 'CALCULATION_FAILED',
            severity: 'WARNING',
            action:
              'El feed macro de PR falló — se usa la calibración hard-coded divulgada. Revisar PrMacroFeedService. / The PR macro feed failed — using the disclosed hard-coded calibration. Investigate PrMacroFeedService.',
            context: { error: String(err) },
          },
        ],
      };
    }
  }

  /**
   * Derive the PR CECL overlay from macro inputs. With no/invalid inputs, falls
   * back to the disclosed hard-coded constants — ALWAYS with a WARNING gap.
   */
  deriveOverlay(inputs?: PrMacroInputs | null): MacroOverlayResult {
    const clean = this.validateInputs(inputs);
    if (clean === null) {
      return this.fallbackOverlay();
    }

    const msi = this.macroStressIndex(clean);

    const adverse = this.clamp(
      PR_PD_MULTIPLIERS.adverse * (1 + ADVERSE_SENSITIVITY * msi),
      PR_PD_MULTIPLIERS.adverse,
      MAX_ADVERSE_MULT,
    );
    const severelyAdverse = this.clamp(
      PR_PD_MULTIPLIERS.severely_adverse * (1 + SEVERE_SENSITIVITY * msi),
      PR_PD_MULTIPLIERS.severely_adverse,
      MAX_SEVERE_MULT,
    );

    const scenarioWeights = this.deriveWeights(msi);
    const asOf = clean.asOf ?? 'unspecified period';

    return {
      pdMultipliers: {
        baseline: PR_PD_MULTIPLIERS.baseline,
        adverse: this.round(adverse),
        severely_adverse: this.round(severelyAdverse),
      },
      scenarioWeights,
      overlayLabel: 'PR',
      basis: 'derived-from-macro',
      macroStressIndex: this.round(msi),
      inputs: clean,
      provenance: `Overlay derivado de datos macro de PR (desempleo ${clean.prUnemploymentPct}%, HPI ${clean.prHpiYoyPct}% i/a, migración neta ${clean.prNetMigrationPct}%; ${asOf}); índice de estrés macro ${this.round(msi)}. Coeficientes PROVISIONALES — pendiente validación COSSEC/NCUA. / Overlay derived from PR macro data (unemployment ${clean.prUnemploymentPct}%, HPI ${clean.prHpiYoyPct}% YoY, net migration ${clean.prNetMigrationPct}%; ${asOf}); macro-stress index ${this.round(msi)}. Coefficients PROVISIONAL — pending COSSEC/NCUA validation.`,
      gaps: [
        {
          field: 'cecl.macroOverlay',
          reason: 'COSSEC_INPUTS_INSUFFICIENT',
          severity: 'WARNING',
          action: `Los multiplicadores PD y pesos de escenario fueron DERIVADOS de datos macro de PR (índice de estrés ${this.round(msi)}); la calibración (coeficientes de sensibilidad, estado de referencia) es PROVISIONAL — confirmar con COSSEC/NCUA o calibrar con datos propios. / The PD multipliers and scenario weights were DERIVED from PR macro data (stress index ${this.round(msi)}); the calibration (sensitivity coefficients, reference state) is PROVISIONAL — confirm with COSSEC/NCUA or calibrate to institution data.`,
          context: {
            basis: 'derived-from-macro',
            macroStressIndex: this.round(msi),
            asOf,
          },
        },
      ],
    };
  }

  // ─── internals ───

  /** The hard-coded constants, disclosed as a provisional fallback. */
  private fallbackOverlay(): MacroOverlayResult {
    return {
      pdMultipliers: { ...PR_PD_MULTIPLIERS },
      scenarioWeights: { ...PR_SCENARIO_WEIGHTS },
      overlayLabel: 'PR',
      basis: 'hardcoded-fallback',
      macroStressIndex: null,
      inputs: null,
      provenance:
        'Sin datos macro disponibles — se usa la calibración PR hard-coded (adverso 2.1×, severo 3.6×; pesos 45/35/20), PROVISIONAL. / No macro data available — using the hard-coded PR calibration (adverse 2.1×, severe 3.6×; weights 45/35/20), PROVISIONAL.',
      gaps: [
        {
          field: 'cecl.macroOverlay',
          reason: 'COSSEC_INPUTS_INSUFFICIENT',
          severity: 'WARNING',
          action:
            'Los multiplicadores macro de PR (adverso 2.1×, severo 3.6×) y los pesos de escenario (45/35/20) son una calibración PROVISIONAL hard-coded (post-María / migración); sin datos macro para derivarlos — los valores definitivos requieren validación COSSEC/NCUA o calibración con datos propios. / The PR macro overlay multipliers (adverse 2.1×, severe 3.6×) and scenario weights (45/35/20) are a PROVISIONAL hard-coded calibration; no macro data to derive them — definitive values require COSSEC/NCUA validation or institution-specific calibration.',
          context: { basis: 'hardcoded-fallback' },
        },
      ],
    };
  }

  /** ≥0 macro-stress index; 0 at the reference state. */
  private macroStressIndex(i: PrMacroInputs): number {
    const ref = PR_MACRO_REFERENCE;
    // Each component contributes only positive stress (worse-than-reference).
    const uStress = Math.max(
      0,
      (i.prUnemploymentPct - ref.prUnemploymentPct) /
        Math.abs(ref.prUnemploymentPct),
    );
    const hStress = Math.max(
      0,
      (ref.prHpiYoyPct - i.prHpiYoyPct) / Math.abs(ref.prHpiYoyPct),
    );
    const mStress = Math.max(
      0,
      (ref.prNetMigrationPct - i.prNetMigrationPct) /
        Math.abs(ref.prNetMigrationPct),
    );
    const msi =
      MSI_WEIGHTS.unemployment * uStress +
      MSI_WEIGHTS.hpi * hStress +
      MSI_WEIGHTS.migration * mStress;
    return this.clamp(msi, 0, MAX_MSI);
  }

  /** Shift scenario-weight mass from baseline to the tail as MSI rises; sum 1. */
  private deriveWeights(msi: number): MacroOverlayResult['scenarioWeights'] {
    const base = PR_SCENARIO_WEIGHTS;
    const shift = this.clamp(
      WEIGHT_SHIFT_SENSITIVITY * msi,
      0,
      MAX_WEIGHT_SHIFT,
    );
    const baseline = Math.max(0.2, base.baseline - shift);
    const adverse = base.adverse + 0.6 * shift;
    const severelyAdverse = base.severely_adverse + 0.4 * shift;
    const sum = baseline + adverse + severelyAdverse;
    return {
      baseline: this.round(baseline / sum),
      adverse: this.round(adverse / sum),
      severely_adverse: this.round(severelyAdverse / sum),
    };
  }

  /** Coerce + bound-check inputs; null if any required field is missing/insane. */
  private validateInputs(inputs?: PrMacroInputs | null): PrMacroInputs | null {
    if (!inputs) return null;
    const u = Number(inputs.prUnemploymentPct);
    const h = Number(inputs.prHpiYoyPct);
    const m = Number(inputs.prNetMigrationPct);
    if (!Number.isFinite(u) || !Number.isFinite(h) || !Number.isFinite(m)) {
      return null;
    }
    // Sanity bounds: unemployment 0–40%, HPI -50..+50% YoY, migration -20..+20%.
    if (u < 0 || u > 40 || h < -50 || h > 50 || m < -20 || m > 20) {
      return null;
    }
    return {
      prUnemploymentPct: u,
      prHpiYoyPct: h,
      prNetMigrationPct: m,
      ...(inputs.asOf !== undefined && { asOf: inputs.asOf }),
    };
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
  }

  private round(v: number): number {
    return Math.round(v * 1e6) / 1e6;
  }
}
