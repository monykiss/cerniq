import { describe, expect, it } from 'vitest';

import {
  isDataUnavailable,
  readGaps,
  hasPartialGaps,
  type AlmDataShell,
} from './data-shell';
import type { DataGap } from '@/hooks/useReportDataGaps';

const criticalGap: DataGap = {
  field: 'nimAttribution.balanceSheet',
  reason: 'EMPTY_BALANCE_SHEET',
  severity: 'CRITICAL',
  action: 'Load the balance sheet.',
};

const warningGap: DataGap = {
  field: 'nimAttribution.nimPrior',
  reason: 'COSSEC_INPUTS_INSUFFICIENT',
  severity: 'WARNING',
  action: 'Generate a board report to set a baseline.',
};

describe('isDataUnavailable', () => {
  it('detects the primary `status` variant', () => {
    expect(isDataUnavailable({ status: 'data_unavailable' })).toBe(true);
    expect(isDataUnavailable({ status: 'ok' })).toBe(false);
  });

  it('detects the `overallStatus` variant (compliance / scenario services)', () => {
    expect(isDataUnavailable({ overallStatus: 'data_unavailable' })).toBe(true);
    expect(isDataUnavailable({ overallStatus: 'compliant' })).toBe(false);
  });

  it('detects the `overallRating` variant (stress-testing)', () => {
    expect(isDataUnavailable({ overallRating: 'data_unavailable' })).toBe(true);
    expect(isDataUnavailable({ overallRating: 'resilient' })).toBe(false);
  });

  it('detects the boolean `dataUnavailable` flag (advisor health-score)', () => {
    expect(isDataUnavailable({ dataUnavailable: true })).toBe(true);
    expect(isDataUnavailable({ dataUnavailable: false })).toBe(false);
  });

  it('is false for an ok shell that merely carries WARNING gaps', () => {
    expect(isDataUnavailable({ status: 'ok', gaps: [warningGap] })).toBe(false);
  });

  it('tolerates null / undefined / non-object input without throwing', () => {
    expect(isDataUnavailable(null)).toBe(false);
    expect(isDataUnavailable(undefined)).toBe(false);
    expect(isDataUnavailable({} as AlmDataShell)).toBe(false);
  });
});

describe('readGaps', () => {
  it('returns the manifest array', () => {
    expect(readGaps({ gaps: [criticalGap] })).toEqual([criticalGap]);
  });

  it('normalizes a missing manifest to an empty array', () => {
    expect(readGaps({ status: 'ok' })).toEqual([]);
    expect(readGaps(null)).toEqual([]);
  });
});

describe('hasPartialGaps', () => {
  it('is true when an ok shell carries gaps (real data + disclosed gap)', () => {
    expect(hasPartialGaps({ status: 'ok', gaps: [warningGap] })).toBe(true);
  });

  it('is false when the whole result is data_unavailable (panel owns it)', () => {
    expect(
      hasPartialGaps({ status: 'data_unavailable', gaps: [criticalGap] }),
    ).toBe(false);
  });

  it('is false for a clean ok shell with no gaps', () => {
    expect(hasPartialGaps({ status: 'ok' })).toBe(false);
  });
});
