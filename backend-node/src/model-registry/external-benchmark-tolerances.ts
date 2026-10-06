/**
 * External benchmark tolerance policy — FAANG Audit P2.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ENTERPRISE DECISION POINT — requires human review before shipping.   ║
 * ║                                                                      ║
 * ║ This file encodes the per-model drift policy. The numbers here       ║
 * ║ determine whether a model passes external validation, and what       ║
 * ║ happens if it fails. They are defensible in front of a COSSEC        ║
 * ║ examiner — get them right once.                                      ║
 * ║                                                                      ║
 * ║ TODO (user): fill in the 5 entries below with the policy you         ║
 * ║ intend to defend. Starter values are placeholders — I've set         ║
 * ║ conservative WARN-only defaults so nothing auto-deprecates before    ║
 * ║ you've signed off. Adjust absolute/relative bands and onFailure      ║
 * ║ per model.                                                           ║
 * ║                                                                      ║
 * ║ Pattern: keep `absolute` in the benchmark's native units. Leave      ║
 * ║ `relative` null for additive metrics (rates, ratios), or use it      ║
 * ║ for multiplicative metrics (prices, balances).                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
import type { Tolerance } from './external-benchmark.types';

/** Default when a model has no explicit policy. Conservative: WARN-only, 1% relative. */
export const DEFAULT_TOLERANCE: Tolerance = {
  absolute: null,
  relative: 0.01,
  onFailure: 'WARN',
};

/**
 * Per-model drift policy.
 *
 * Keys are `modelKey` values from the registry (see model-registry.seeder.ts).
 * Units of `absolute` match the benchmark's native units (percent, bp, ratio, etc.).
 *
 * STARTER VALUES — user to review and sign off:
 */
export const TOLERANCE_BY_MODEL_KEY: Record<string, Tolerance> = {
  // ── Interest-rate curve anchors — Fed H.15 ground truth ──
  // Fed publishes to 2 decimal places (basis-point precision); anything >5bp
  // drift likely indicates a calibration bug, not model choice.
  'rate.hjm-2f': {
    absolute: 0.05, // 5bp on a percent-valued yield
    relative: null,
    onFailure: 'BLOCK_APPROVAL',
  },

  // ── LCR — BCBS 128 doesn't publish a "truth" per institution, but COSSEC
  // circular thresholds and FFIEC peer medians give bands. A >2pp drift on
  // the published peer median for PR cooperativas is suspicious.
  'alm.lcr': {
    absolute: 2.0, // 2 percentage points on an LCR %
    relative: null,
    onFailure: 'WARN',
  },

  // ── Duration gap — FFIEC UBPR reports peer median duration. ±0.2yr is
  // the band examiners tolerate before asking questions.
  'alm.duration-gap': {
    absolute: 0.2, // 0.2 years
    relative: null,
    onFailure: 'WARN',
  },

  // ── COSSEC 12-ratio engine — thresholds published in circulars.
  // Any breach of the published threshold is a compliance event.
  'reg.cossec-compliance': {
    absolute: 0.1, // 0.1pp on a ratio
    relative: null,
    onFailure: 'BLOCK_APPROVAL',
  },

  // ── NII sensitivity — broad bands because peer methodology varies.
  'alm.nii-sensitivity': {
    absolute: null,
    relative: 0.05, // 5% relative drift from FFIEC peer median
    onFailure: 'WARN',
  },
};
