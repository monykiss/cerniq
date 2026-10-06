/**
 * Shared axe-core configuration for the CERNIQ a11y sweep.
 *
 * WCAG target: 2.1 AA — our public claim on /security.
 *
 * Disabled rules are documented with a rationale + ticket owner so
 * we don't silently mask real regressions.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

/**
 * Severity policy (enterprise-default):
 *
 *   critical  — HARD FAIL on any new violation (exceeding baseline)
 *   serious   — HARD FAIL on any new violation
 *   moderate  — RATCHET: aggregate count across all routes may not
 *               INCREASE vs. ratchet.json. Can go down freely.
 *   minor     — tracked in report only, no CI gate
 *
 * Rationale: hard-gating moderate is too aggressive for a daily-ship
 * shop; ignoring it entirely lets debt accumulate. A ratchet gives the
 * right behavior — debt monotonically decreases (or stays flat).
 */
export const FAIL_IMPACTS: ReadonlyArray<'critical' | 'serious' | 'moderate' | 'minor'> = [
  'critical',
  'serious',
];

/**
 * Impacts subject to the monotonic-decrease ratchet. Their aggregate
 * count is stored in ratchet.json and CI fails if a PR raises the count.
 */
export const RATCHET_IMPACTS: ReadonlyArray<'critical' | 'serious' | 'moderate' | 'minor'> = [
  'moderate',
];

/**
 * Rules we've explicitly decided to disable (with rationale).
 * Keep this list SHORT and REVIEWED — every disabled rule is tech debt.
 */
export const DISABLED_RULES: Array<{ id: string; reason: string }> = [
  {
    id: 'color-contrast-enhanced',
    reason:
      'AAA-only rule (7:1). We target AA (4.5:1) per the /security page claim. ' +
      'Keep AA rule `color-contrast` enabled.',
  },
  {
    id: 'region',
    reason:
      'Marketing pages intentionally use decorative sections outside landmarks ' +
      '(e.g. full-bleed hero). Landmark coverage enforced via page-structure rules.',
  },
];

/**
 * Rules that are run-only for the authed sweep (richer interactive state).
 * Marketing pages have no forms-with-state to exercise here.
 */
export const AUTHED_ONLY_RULES: string[] = [
  'aria-allowed-attr',
  'aria-required-children',
  'aria-required-parent',
];

export interface AxeViolationSummary {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  help: string;
  helpUrl: string;
  nodeCount: number;
  targets: string[];
}

export interface RouteResult {
  route: string;
  url: string;
  loadedOk: boolean;
  httpStatus?: number;
  violations: AxeViolationSummary[];
  elapsedMs: number;
}
