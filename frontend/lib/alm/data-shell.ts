/**
 * ALM data-shell — the frontend half of CerniQ Decision D1 ("never silent
 * zeros", SESSION_HANDOFF §1).
 *
 * The backend ALM services no longer fabricate numbers on empty / insufficient
 * input. Instead every result DTO is an honest *shell*:
 *
 *   • A `status` field grows a `'data_unavailable'` variant. Different services
 *     name it differently — `status`, `overallStatus`, `overallRating`, or a
 *     `dataUnavailable: boolean` flag — but the meaning is identical: "the
 *     engine could not compute this; do not render a number."
 *   • Every numeric field that depended on the missing input becomes
 *     `T | null` (never `0`, never `NaN`, never a hardcoded fallback).
 *   • A top-level `gaps: DataGap[]` manifest enumerates each missing input with
 *     a `field`, `reason`, `severity` (`CRITICAL` / `WARNING`) and `action`.
 *
 * The shell arrives as a **200 OK with valid JSON**, so it is NOT a transport
 * or schema error — a page's `validate()` must accept it (return it as the
 * typed shell), never `throw`. Throwing would mis-route an honest gap into the
 * `useAlmEndpoint` error / `getDemo` fallback and the user would see a
 * *fabricated* sample instead of the truth the backend disclosed. That swap is
 * the exact D1 violation this module exists to close.
 *
 * This file is intentionally framework-free (no React, no hooks) so the
 * D1-critical predicate is unit-tested without rendering. The presentation half
 * lives in `components/alm/AlmDataUnavailable.tsx` (the neutral panel) and the
 * existing `components/ui/cerniq/DataGapBanner.tsx` (`—` cells + the manifest
 * banner).
 */

import type { DataGap } from '@/hooks/useReportDataGaps';

export type { DataGap };

/**
 * The common surface every gap-bearing ALM response shares. Pages keep their
 * own richer interface (with the domain numeric fields) and intersect it with
 * this — e.g. `interface NIMAttributionData extends AlmDataShell { … }`.
 */
export interface AlmDataShell {
  /** Primary status union on most services (`'ok' | 'data_unavailable'`, etc.). */
  readonly status?: string;
  /** Compliance / scenario services name it `overallStatus`. */
  readonly overallStatus?: string;
  /** Stress-testing names its verdict `overallRating`. */
  readonly overallRating?: string;
  /** Advisor health-score uses a boolean flag rather than a status union. */
  readonly dataUnavailable?: boolean;
  /** The missing-input manifest. Present (and non-empty) whenever a gap exists. */
  readonly gaps?: DataGap[];
}

const DATA_UNAVAILABLE = 'data_unavailable';

/**
 * True when the backend reported it could not compute the result. Checks every
 * status-field variant the ALM services use plus the boolean flag. A page uses
 * this to swap the whole content area for the neutral DATA-UNAVAILABLE panel
 * rather than rendering a grid of `—`.
 *
 * Deliberately tolerant of `null`/`undefined`/non-object input so a caller can
 * pass a freshly-fetched value without a guard.
 */
export function isDataUnavailable(shell: AlmDataShell | null | undefined): boolean {
  if (!shell || typeof shell !== 'object') return false;
  if (shell.dataUnavailable === true) return true;
  return (
    shell.status === DATA_UNAVAILABLE ||
    shell.overallStatus === DATA_UNAVAILABLE ||
    shell.overallRating === DATA_UNAVAILABLE
  );
}

/** The gap manifest, normalized to an array (never `undefined`). */
export function readGaps(shell: AlmDataShell | null | undefined): DataGap[] {
  return shell?.gaps ?? [];
}

/**
 * True when the response carries WARNING/partial gaps but still computed real
 * numbers (`status` is NOT data_unavailable yet `gaps` is non-empty). The page
 * renders the real content AND a `<DataGapBanner>` so the user sees the value
 * *and* what is missing — e.g. a real current NIM with the prior-period
 * attribution disclosed as a gap.
 */
export function hasPartialGaps(shell: AlmDataShell | null | undefined): boolean {
  return !isDataUnavailable(shell) && readGaps(shell).length > 0;
}
