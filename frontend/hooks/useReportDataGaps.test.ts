import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReportDataGaps, DataGap } from './useReportDataGaps';

describe('useReportDataGaps', () => {
  const CRITICAL_GAP: DataGap = {
    field: 'liquidity.lcr',
    reason: 'NO_LIQUIDITY_POSITION',
    severity: 'CRITICAL',
    action: 'Upload liquidity position data',
  };

  const WARNING_GAP: DataGap = {
    field: 'duration.gap',
    reason: 'HARDCODED_DURATION',
    severity: 'WARNING',
    action: 'Wire DurationService to compute actual values',
  };

  it('returns empty summary for undefined gaps', () => {
    const { result } = renderHook(() => useReportDataGaps(undefined));
    expect(result.current.hasGaps).toBe(false);
    expect(result.current.criticalCount).toBe(0);
    expect(result.current.warningCount).toBe(0);
    expect(result.current.gaps).toEqual([]);
  });

  it('returns empty summary for null gaps', () => {
    const { result } = renderHook(() => useReportDataGaps(null));
    expect(result.current.hasGaps).toBe(false);
  });

  it('returns empty summary for empty array', () => {
    const { result } = renderHook(() => useReportDataGaps([]));
    expect(result.current.hasGaps).toBe(false);
  });

  it('counts critical and warning gaps', () => {
    const gaps = [CRITICAL_GAP, WARNING_GAP, { ...WARNING_GAP, field: 'nii.sensitivity' }];
    const { result } = renderHook(() => useReportDataGaps(gaps));

    expect(result.current.hasGaps).toBe(true);
    expect(result.current.hasCritical).toBe(true);
    expect(result.current.criticalCount).toBe(1);
    expect(result.current.warningCount).toBe(2);
  });

  it('gapForField finds matching gap', () => {
    const { result } = renderHook(() =>
      useReportDataGaps([CRITICAL_GAP, WARNING_GAP]),
    );

    const found = result.current.gapForField('liquidity.lcr');
    expect(found).toBe(CRITICAL_GAP);
  });

  it('gapForField returns undefined for non-matching field', () => {
    const { result } = renderHook(() =>
      useReportDataGaps([CRITICAL_GAP]),
    );

    expect(result.current.gapForField('some.other.field')).toBeUndefined();
  });

  it('memoizes result for same input', () => {
    const gaps = [CRITICAL_GAP];
    const { result, rerender } = renderHook(() => useReportDataGaps(gaps));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
