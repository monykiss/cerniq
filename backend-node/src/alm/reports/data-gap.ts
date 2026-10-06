/**
 * DataGap — the contract that lets CerniQ reports render with explicit
 * "DATA UNAVAILABLE" markers instead of lying with silent zeros.
 *
 * Locked decision (D1, 2026-04-07): when a report's inputs are incomplete,
 * the system MUST emit a structured gap manifest. Reports always render —
 * affected fields show as null, the top-level `gaps[]` array enumerates every
 * missing input, and the UI surfaces them as `—` with a tooltip explaining
 * what to upload to fix it. NEVER substitute 0, NaN, or hardcoded fallbacks.
 *
 * Why this matters: a regulator reading a CerniQ report with `lcr: 0,
 * status: 'breach'` would conclude the cooperativa is in regulatory breach
 * when the actual situation is "no liquidity data has been loaded yet". That
 * confusion is a legal exposure CerniQ exists to eliminate.
 *
 * Convention: every report DTO that touches user-facing numbers carries an
 * optional `gaps?: DataGap[]` field. Sub-calculations populate their own
 * gaps; the orchestrator (e.g. `getALMSummary`) concatenates them into a
 * single top-level array. Field paths use dot notation namespaced by domain
 * (`liquidity.lcr`, `cossec.capitalRatio`) so the same gap is identifiable
 * across producer, transport, and presenter.
 */

export type DataGapSeverity = 'CRITICAL' | 'WARNING';

/**
 * Reason codes — machine-stable strings the UI can localize and the API can
 * filter on. Keep these short, SCREAMING_SNAKE_CASE, and add new ones rather
 * than reusing an existing code with a different meaning.
 */
export type DataGapReason =
  | 'NO_LIQUIDITY_POSITION'
  | 'EMPTY_BALANCE_SHEET'
  | 'MISSING_TOTAL_ASSETS'
  | 'MISSING_INSTITUTION'
  | 'COSSEC_INPUTS_INSUFFICIENT'
  | 'STRESS_INPUTS_INSUFFICIENT'
  | 'MIXED_CURRENCIES'
  | 'STALE_SNAPSHOT'
  | 'CALCULATION_FAILED'
  | 'DEPENDENCY_REJECTED'
  | 'KMV_INPUTS_INSUFFICIENT'
  | 'NO_GEOGRAPHIC_DATA'
  | 'NO_BORROWER_DATA'
  | 'EWS_INPUTS_INSUFFICIENT'
  | 'INDICATOR_NOT_WIRED'
  | 'NO_LOAN_SEGMENTS'
  | 'NO_COHORT_DATA'
  | 'LOAN_TAPE_FIELD_MISSING'
  | 'NO_MEMBER_DATA'
  | 'MEMBER_ACCOUNTS_MISSING'
  | 'MEMBER_RISK_SCORE_UNAVAILABLE'
  /** A free-text product label did not map to the cooperativa product
   * registry, so the product cannot be priced or entered into CECL. Never
   * resolved by guessing a default product — see `product-mapping.ts`. */
  | 'PRODUCT_TYPE_UNMAPPED'
  /** Expected loss was computed from the registry's cold-start PD/LGD prior
   * rather than the institution's own loss history. The registry documents
   * these as provisional (OPERATOR-INPUT-NEEDED); this gap carries that
   * provenance into the report instead of letting the number look calibrated. */
  | 'PD_LGD_REGISTRY_DEFAULT';

export interface DataGap {
  /**
   * Dot-namespaced field path identifying what's missing or broken. Examples:
   * `liquidity.lcr`, `cossec.capitalRatio`, `stress.scenarios[+200bps].niImpact`.
   * The presenter uses this to find the corresponding cell to mark as `—`.
   */
  field: string;

  /** Machine-stable reason code. The UI maps this to a localized message. */
  reason: DataGapReason;

  /**
   * `CRITICAL` blocks regulator-bound artifacts (NCUA filings, board PDFs).
   * `WARNING` lets the report render but flags the field. The orchestrator
   * uses these to decide whether to disable downloads or just show a banner.
   */
  severity: DataGapSeverity;

  /**
   * Human-readable next step in plain language. Bilingual sites should keep
   * this in the user's preferred language at presentation time, not here.
   * Optional because some gaps are self-evident from `field + reason`.
   */
  action?: string;

  /**
   * Free-form debug payload for log correlation and test assertions. Never
   * leak secrets or PII here — the payload may be serialized into webhooks
   * and audit logs.
   */
  context?: Record<string, unknown>;
}

/** Factory — keeps gap construction terse at call sites and easy to grep. */
export function dataGap(
  field: string,
  reason: DataGapReason,
  opts: {
    severity?: DataGapSeverity;
    action?: string;
    context?: Record<string, unknown>;
  } = {},
): DataGap {
  return {
    field,
    reason,
    severity: opts.severity ?? 'CRITICAL',
    ...(opts.action !== undefined && { action: opts.action }),
    ...(opts.context !== undefined && { context: opts.context }),
  };
}

/**
 * Returns true if any gap in the list would block a regulator-bound artifact.
 * Use this to gate Excel/PDF/XML emission and to disable download buttons.
 */
export function hasCriticalGap(gaps: DataGap[] | undefined): boolean {
  return !!gaps?.some((g) => g.severity === 'CRITICAL');
}

/**
 * Concatenate gap arrays from sub-calculations into a single top-level array,
 * dropping undefined inputs. Used by orchestrators that compose several
 * report-producing sub-calls.
 */
export function mergeGaps(
  ...sources: Array<DataGap[] | undefined | null>
): DataGap[] {
  const out: DataGap[] = [];
  for (const src of sources) {
    if (src && src.length > 0) out.push(...src);
  }
  return out;
}
