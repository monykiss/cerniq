import { describe, it, expect } from 'vitest';

import {
  validateBoardReport,
  formatBoardKpi,
  buildBoardKpiTiles,
  countBoardGaps,
  urgencyTone,
  urgencyLabel,
  BOARD_KPI_SPECS,
  type BoardReportKpis,
} from './board-report-helpers';

const fullKpis: BoardReportKpis = {
  nim: 3.52,
  lcr: 115,
  nsfr: null,
  nwr: 9.21,
  eveSensitivity: null,
  nplRatio: null,
  ceclCoverage: null,
  roa: null,
};

const ok = {
  institutionName: 'Cooperativa de Prueba',
  reportMonth: '2026-06',
  generatedAt: '2026-06-07T00:00:00.000Z',
  camelComposite: 2,
  kpis: fullKpis,
  sections: [],
  topRisks: ['x'],
  topRisksEs: ['y'],
  recommendations: ['a'],
  recommendationsEs: ['b'],
  regPulse: [],
};

describe('validateBoardReport', () => {
  it('accepts a well-formed result', () => {
    const r = validateBoardReport(ok);
    expect(r.institutionName).toBe('Cooperativa de Prueba');
    expect(r.reportMonth).toBe('2026-06');
  });

  it('rejects non-objects', () => {
    expect(() => validateBoardReport(null)).toThrow();
    expect(() => validateBoardReport(42)).toThrow();
    expect(() => validateBoardReport('nope')).toThrow();
  });

  it('rejects missing institutionName / reportMonth / kpis', () => {
    expect(() => validateBoardReport({ ...ok, institutionName: undefined })).toThrow();
    expect(() => validateBoardReport({ ...ok, reportMonth: 123 })).toThrow();
    expect(() => validateBoardReport({ ...ok, kpis: undefined })).toThrow();
  });

  it('rejects non-array sections / topRisks / recommendations / regPulse', () => {
    expect(() => validateBoardReport({ ...ok, sections: {} })).toThrow();
    expect(() => validateBoardReport({ ...ok, topRisks: 'x' })).toThrow();
    expect(() => validateBoardReport({ ...ok, recommendations: null })).toThrow();
    expect(() => validateBoardReport({ ...ok, regPulse: 7 })).toThrow();
  });
});

describe('formatBoardKpi (D1 — null is never a measured zero)', () => {
  it('shows — for null, undefined, and non-finite values', () => {
    expect(formatBoardKpi(null)).toBe('—');
    expect(formatBoardKpi(undefined)).toBe('—');
    expect(formatBoardKpi(Number.NaN)).toBe('—');
    expect(formatBoardKpi(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('never renders a null KPI as 0', () => {
    expect(formatBoardKpi(null)).not.toBe('0.00%');
    expect(formatBoardKpi(null)).not.toBe('0');
  });

  it('formats a real percentage to two decimals', () => {
    expect(formatBoardKpi(3.5)).toBe('3.50%');
    expect(formatBoardKpi(115)).toBe('115.00%');
    expect(formatBoardKpi(9.214)).toBe('9.21%');
  });

  it('formats a genuine zero (not the same as a missing value)', () => {
    expect(formatBoardKpi(0)).toBe('0.00%');
  });
});

describe('buildBoardKpiTiles', () => {
  it('produces one tile per spec, in spec order', () => {
    const tiles = buildBoardKpiTiles(fullKpis, true);
    expect(tiles).toHaveLength(BOARD_KPI_SPECS.length);
    expect(tiles.map((t) => t.field)).toEqual(BOARD_KPI_SPECS.map((s) => s.field));
  });

  it('marks null KPIs unavailable with a — display, real KPIs available', () => {
    const tiles = buildBoardKpiTiles(fullKpis, true);
    const nim = tiles.find((t) => t.field === 'nim')!;
    const nsfr = tiles.find((t) => t.field === 'nsfr')!;

    expect(nim.available).toBe(true);
    expect(nim.display).toBe('3.52%');

    expect(nsfr.available).toBe(false);
    expect(nsfr.display).toBe('—');
  });

  it('uses Spanish-first labels when es=true (razón de capital for NWR)', () => {
    const es = buildBoardKpiTiles(fullKpis, true);
    const en = buildBoardKpiTiles(fullKpis, false);
    const nwrEs = es.find((t) => t.field === 'nwr')!;
    const nwrEn = en.find((t) => t.field === 'nwr')!;
    expect(nwrEs.label).toBe('Razón de Capital');
    expect(nwrEn.label).toBe('Net Worth Ratio');
  });
});

describe('countBoardGaps', () => {
  it('returns zeros for empty / undefined gaps', () => {
    expect(countBoardGaps(undefined)).toEqual({ critical: 0, warning: 0 });
    expect(countBoardGaps([])).toEqual({ critical: 0, warning: 0 });
  });

  it('tallies CRITICAL vs WARNING', () => {
    const gaps = [
      { field: 'board.kpis.nim', reason: 'x', action: 'y', severity: 'CRITICAL' as const },
      { field: 'board.kpis.lcr', reason: 'x', action: 'y', severity: 'CRITICAL' as const },
      { field: 'board.kpis.nsfr', reason: 'x', action: 'y', severity: 'WARNING' as const },
    ];
    expect(countBoardGaps(gaps)).toEqual({ critical: 2, warning: 1 });
  });
});

describe('urgencyTone + urgencyLabel', () => {
  it('maps known urgencies case-insensitively', () => {
    expect(urgencyTone('HIGH')).toBe('high');
    expect(urgencyTone('medium')).toBe('medium');
    expect(urgencyTone('LOW')).toBe('low');
  });

  it('degrades unknown urgency to low rather than throwing', () => {
    expect(urgencyTone('')).toBe('low');
    expect(urgencyTone('whatever')).toBe('low');
  });

  it('labels urgency bilingually (Spanish-first)', () => {
    expect(urgencyLabel('HIGH', true)).toBe('Alta');
    expect(urgencyLabel('HIGH', false)).toBe('High');
    expect(urgencyLabel('MEDIUM', true)).toBe('Media');
    expect(urgencyLabel('LOW', true)).toBe('Baja');
  });
});
