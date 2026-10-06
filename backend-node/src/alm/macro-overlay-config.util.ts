// Single source of truth for the W1.2 macro-overlay runtime config.
//
// Follows the scheduler-flag.util.ts pattern: any env var consumed from more
// than one place gets one helper with a test-locked truth table, so two sites
// never interpret the same string with different rules.
//
// Accepted values are pinned in `env.schema.ts` (CECL_MACRO_OVERLAY_MODE as
// the enum ['derived','hardcoded']; PR_MACRO_STALENESS_DAYS as int 1–730),
// which keeps ambiguous inputs from reaching these helpers at boot. The
// helpers still normalize defensively for direct-instantiation contexts
// (CLI scripts, specs) that bypass validateEnv().

export type MacroOverlayMode = 'derived' | 'hardcoded';

/**
 * 'derived' (default) — CECL uses MacroOverlayService.deriveCurrentOverlay
 * (data-derived multipliers/weights, gap-disclosed). 'hardcoded' — ops kill
 * switch: CECL uses the legacy inline PR constants + legacy disclosure gap.
 *
 * Default is 'derived' deliberately: at the reference macro state both modes
 * produce identical numbers (continuity guarantee), and under stress the
 * derived overlay is the HARSHER (more conservative) allowance — the safe
 * direction for a credit reserve. Unknown values normalize to the default.
 */
export function getMacroOverlayMode(
  env: NodeJS.ProcessEnv = process.env,
): MacroOverlayMode {
  return env.CECL_MACRO_OVERLAY_MODE === 'hardcoded' ? 'hardcoded' : 'derived';
}

/** Default snapshot-staleness threshold: quarterly refresh cadence + slack. */
export const DEFAULT_MACRO_STALENESS_DAYS = 120;

/**
 * Days after `PR_MACRO_SNAPSHOT.compiledAsOf` before the feed emits a
 * STALE_SNAPSHOT WARNING gap (data still served — D1 partial + disclosed).
 * `parseInt` is banned for env parsing (silent-coercion trap); Number +
 * explicit integer/range checks, falling back to the default on any
 * invalid input.
 */
export function resolveMacroStalenessDays(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.PR_MACRO_STALENESS_DAYS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MACRO_STALENESS_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 730) {
    return DEFAULT_MACRO_STALENESS_DAYS;
  }
  return parsed;
}
