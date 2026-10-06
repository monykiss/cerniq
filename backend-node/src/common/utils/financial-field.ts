/**
 * Shared strict numeric parser for user-supplied financial fields.
 *
 * Replaces `parseFloat(raw)` + `isNaN(parsed)` + manual-bounds patterns
 * across the CSV-ingest surfaces (ALM balance sheet, ALM v2 ingest,
 * CPA bulk upload, expense ingest). The old pattern had three silent-
 * accept paths that corrupted downstream financial math:
 *
 *   1. parseFloat accepted trailing garbage:
 *        parseFloat('1234abc') → 1234
 *      So an operator typo "250000000abc" silently became a real
 *      $250M balance.
 *
 *   2. parseFloat returned ±Infinity on exponential overflow:
 *        parseFloat('1e400') → Infinity
 *        isNaN(Infinity) === false
 *      The isNaN gate let Infinity through; only the upper-bound
 *      check caught it (if present).
 *
 *   3. Rate auto-scale misfired on trailing garbage:
 *        parseFloat('1.5abc') → 1.5, > 1, divides by 100 → 0.015.
 *      What the customer typed got silently reinterpreted.
 *
 * Returns `null` as the sentinel for "invalid — reject this row with
 * a parse error to the caller". Callers then format the error message
 * with bilingual en/es strings and row-number context.
 *
 * Usage:
 *   const balance = parseFinancialField(row.balance, {
 *     min: 0,
 *     max: 999_999_999_999, // $999B — beyond any realistic cooperativa
 *   });
 *   if (balance === null) { errors.push({...}); continue; }
 *
 *   const duration = parseFinancialField(row.duration, {
 *     min: 0,
 *     max: 600, // 600 months = 50 years
 *     integer: true, // durations here are whole-month integers
 *   });
 */
export interface FinancialFieldBounds {
  min: number;
  max: number;
  /**
   * When true, reject non-integer values. Use for counts like
   * tenor-in-months or loan-term-in-years. Default false — accepts
   * decimals like 4.75% rate or 27.5-year Macaulay duration.
   */
  integer?: boolean;
}

/**
 * Strictly parse a financial field. Returns the parsed number, or
 * `null` if the input is invalid for any reason:
 *
 *   - undefined, null, empty string, or whitespace-only
 *   - non-numeric or has trailing non-numeric characters
 *   - ±Infinity (from exponential overflow)
 *   - fails the `integer` constraint when set
 *   - falls outside [bounds.min, bounds.max]
 *
 * All five existing safe-parse helpers in the codebase
 * (resolveConcurrency, resolveCapCents, computeCostUsdCents,
 * resolveUrlExpirySec, envFloat) use the same shape — `Number(raw)` +
 * `Number.isFinite` + explicit bounds. This helper is the shared
 * implementation for the user-CSV-input domain; the env-parsing ones
 * stay module-local because their semantics (fallback-to-default vs
 * reject-the-row) differ.
 */
export function parseFinancialField(
  raw: unknown,
  bounds: FinancialFieldBounds,
): number | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (str === '') return null;
  const parsed = Number(str);
  if (!Number.isFinite(parsed)) return null;
  if (bounds.integer && !Number.isInteger(parsed)) return null;
  if (parsed < bounds.min || parsed > bounds.max) return null;
  return parsed;
}
