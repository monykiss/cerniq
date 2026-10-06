/**
 * data-gap factory + helpers — small but the contract everything else relies on.
 */
import { dataGap, hasCriticalGap, mergeGaps, DataGap } from './data-gap';

describe('dataGap factory', () => {
  it('defaults severity to CRITICAL when not specified', () => {
    const gap = dataGap('liquidity.lcr', 'NO_LIQUIDITY_POSITION');
    expect(gap.severity).toBe('CRITICAL');
    expect(gap.field).toBe('liquidity.lcr');
    expect(gap.reason).toBe('NO_LIQUIDITY_POSITION');
  });

  it('respects an explicit WARNING severity', () => {
    const gap = dataGap('cossec.peer', 'STALE_SNAPSHOT', {
      severity: 'WARNING',
    });
    expect(gap.severity).toBe('WARNING');
  });

  it('omits action and context when not provided (no undefined-key noise)', () => {
    const gap = dataGap('liquidity.lcr', 'NO_LIQUIDITY_POSITION');
    expect('action' in gap).toBe(false);
    expect('context' in gap).toBe(false);
  });

  it('includes action and context when provided', () => {
    const gap = dataGap('liquidity.lcr', 'NO_LIQUIDITY_POSITION', {
      action: 'Upload liquidity_positions for 2026-Q1',
      context: { institutionId: 'inst-1' },
    });
    expect(gap.action).toMatch(/Upload/);
    expect(gap.context).toEqual({ institutionId: 'inst-1' });
  });
});

describe('hasCriticalGap', () => {
  it('returns false for undefined or empty input', () => {
    expect(hasCriticalGap(undefined)).toBe(false);
    expect(hasCriticalGap([])).toBe(false);
  });

  it('returns true when any gap is CRITICAL', () => {
    const gaps: DataGap[] = [
      dataGap('a', 'STALE_SNAPSHOT', { severity: 'WARNING' }),
      dataGap('b', 'NO_LIQUIDITY_POSITION', { severity: 'CRITICAL' }),
    ];
    expect(hasCriticalGap(gaps)).toBe(true);
  });

  it('returns false when all gaps are WARNING-only', () => {
    const gaps: DataGap[] = [
      dataGap('a', 'STALE_SNAPSHOT', { severity: 'WARNING' }),
      dataGap('b', 'MIXED_CURRENCIES', { severity: 'WARNING' }),
    ];
    expect(hasCriticalGap(gaps)).toBe(false);
  });
});

describe('mergeGaps', () => {
  it('drops undefined and null sources', () => {
    const merged = mergeGaps(undefined, null, [
      dataGap('a', 'EMPTY_BALANCE_SHEET'),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('preserves order across sources', () => {
    const a = dataGap('a', 'EMPTY_BALANCE_SHEET');
    const b = dataGap('b', 'NO_LIQUIDITY_POSITION');
    const c = dataGap('c', 'MISSING_TOTAL_ASSETS');
    const merged = mergeGaps([a], [b, c]);
    expect(merged.map((g) => g.field)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array when all sources are empty/undefined', () => {
    expect(mergeGaps(undefined, [], null)).toEqual([]);
  });
});
