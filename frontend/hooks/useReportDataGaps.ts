import { useMemo } from 'react';

// ─── DataGap Types (mirrors backend data-gap.ts contract) ──────

export type GapSeverity = 'CRITICAL' | 'WARNING';

export interface DataGap {
  field: string;
  reason: string;
  severity: GapSeverity;
  action: string;
}

export interface DataGapSummary {
  gaps: DataGap[];
  criticalCount: number;
  warningCount: number;
  hasGaps: boolean;
  hasCritical: boolean;
  /** Find the gap affecting a specific field, if any. */
  gapForField: (field: string) => DataGap | undefined;
}

/**
 * useReportDataGaps — Parse and summarize data gaps from any API response.
 *
 * Convention (D1 from SESSION_HANDOFF):
 * - Every report DTO carries optional `gaps?: DataGap[]`
 * - When a field is missing, the UI shows `—` (em dash), not `0`, not blank
 * - Hover reveals the gap reason
 * - Top of every report with gaps shows a single-line MetricStrip-style banner
 *
 * Usage:
 *   const { gaps, hasCritical, gapForField } = useReportDataGaps(apiResponse?.gaps);
 *
 *   // Per-cell rendering:
 *   const lcrGap = gapForField('liquidity.lcr');
 *   if (lcrGap) return <GapCell gap={lcrGap} />;
 *   return <span>{formatPercent(lcr)}</span>;
 */
export function useReportDataGaps(
  rawGaps: DataGap[] | undefined | null,
): DataGapSummary {
  return useMemo(() => {
    const gaps = rawGaps ?? [];
    const criticalCount = gaps.filter((g) => g.severity === 'CRITICAL').length;
    const warningCount = gaps.filter((g) => g.severity === 'WARNING').length;

    return {
      gaps,
      criticalCount,
      warningCount,
      hasGaps: gaps.length > 0,
      hasCritical: criticalCount > 0,
      gapForField: (field: string) => gaps.find((g) => g.field === field),
    };
  }, [rawGaps]);
}
