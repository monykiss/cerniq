import { describe, it, expect } from 'vitest';

import {
  validateCooperativaCecl,
  isCooperativaDataUnavailable,
  mapClassificationRow,
  mapClassificationRows,
  sideLabel,
  yesNoLabel,
  buildCooperativaStripItems,
  countGapSeverities,
  COOPERATIVA_PRODUCT_META,
  PR_OVERLAY_DISCLOSURE,
  COLD_START_NOTE,
  type CooperativaCECLResult,
} from './cecl-cooperativa-helpers';

// A well-formed computed result (the asset-loan happy path).
const computed: CooperativaCECLResult = {
  totalBalance: 120,
  totalAllowance: 4.2,
  weightedCoverageRatio: 0.035,
  methodology: 'PD×LGD (PR)',
  segments: [
    { segmentName: 'Préstamos personales', balance: 70, methodology: 'PD×LGD (PR) (Weighted)', allowanceRequired: 3.1, coverageRatio: 0.044 },
    { segmentName: 'Hipotecas', balance: 50, methodology: 'PD×LGD (PR) (Weighted)', allowanceRequired: 1.1, coverageRatio: 0.022 },
  ],
  overallStatus: 'computed',
  productClassification: [
    { segmentName: 'Préstamos personales', productType: 'PRESTAMO_PERSONAL', nombre: 'Préstamos personales', defaultsApplied: true },
    { segmentName: 'Hipotecas', productType: 'HIPOTECA', nombre: 'Hipotecas', defaultsApplied: false },
    { segmentName: 'Club de Navidad', productType: 'CLUB_NAVIDAD', nombre: 'Club de Navidad', defaultsApplied: false },
  ],
};

// A data_unavailable shell (zero sentinels — never a measured zero).
const unavailable: CooperativaCECLResult = {
  totalBalance: 0,
  totalAllowance: 0,
  weightedCoverageRatio: 0,
  methodology: 'PD×LGD (PR)',
  segments: [],
  overallStatus: 'data_unavailable',
  gaps: [
    { field: 'cecl.segments', reason: 'EMPTY_BALANCE_SHEET', severity: 'CRITICAL', action: 'Cargue los segmentos.' },
  ],
  productClassification: [],
};

describe('validateCooperativaCecl', () => {
  it('accepts a well-formed computed result', () => {
    const r = validateCooperativaCecl(computed);
    expect(r.methodology).toBe('PD×LGD (PR)');
    expect(r.productClassification).toHaveLength(3);
  });

  it('accepts the data_unavailable shell', () => {
    expect(() => validateCooperativaCecl(unavailable)).not.toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => validateCooperativaCecl(null)).toThrow();
    expect(() => validateCooperativaCecl(undefined)).toThrow();
    expect(() => validateCooperativaCecl(42)).toThrow();
  });

  it('rejects missing/invalid required fields', () => {
    expect(() => validateCooperativaCecl({ totalAllowance: 1, segments: [], productClassification: [] })).toThrow(/totalBalance/);
    expect(() => validateCooperativaCecl({ totalBalance: 1, segments: [], productClassification: [] })).toThrow(/totalAllowance/);
    expect(() => validateCooperativaCecl({ totalBalance: 1, totalAllowance: 1, productClassification: [] })).toThrow(/segments/);
    expect(() => validateCooperativaCecl({ totalBalance: 1, totalAllowance: 1, segments: [] })).toThrow(/productClassification/);
  });
});

describe('isCooperativaDataUnavailable (D1 — phantom vs measured zero)', () => {
  it('flags the data_unavailable shell', () => {
    expect(isCooperativaDataUnavailable(unavailable)).toBe(true);
  });

  it('flags an empty segment list defensively even when status is computed', () => {
    expect(
      isCooperativaDataUnavailable({ ...computed, overallStatus: 'computed', segments: [] }),
    ).toBe(true);
  });

  it('does not flag a real computed result', () => {
    expect(isCooperativaDataUnavailable(computed)).toBe(false);
  });
});

describe('mapClassificationRow (derives side + ceclEligible from productType)', () => {
  it('maps an asset loan with backend nombre taking ES precedence', () => {
    const row = mapClassificationRow(
      { segmentName: 'Auto', productType: 'PRESTAMO_AUTO', nombre: 'Autos del socio', defaultsApplied: true },
      true,
    );
    expect(row.side).toBe('asset');
    expect(row.ceclEligible).toBe(true);
    expect(row.productLabel).toBe('Autos del socio'); // backend nombre wins for ES
    expect(row.defaultsApplied).toBe(true);
  });

  it('falls back to the meta ES label when backend nombre is null', () => {
    const row = mapClassificationRow(
      { segmentName: 'Auto', productType: 'PRESTAMO_AUTO', nombre: null, defaultsApplied: false },
      true,
    );
    expect(row.productLabel).toBe(COOPERATIVA_PRODUCT_META.PRESTAMO_AUTO.es);
  });

  it('uses the English meta label regardless of backend nombre when es=false', () => {
    const row = mapClassificationRow(
      { segmentName: 'Auto', productType: 'PRESTAMO_AUTO', nombre: 'Autos del socio', defaultsApplied: false },
      false,
    );
    expect(row.productLabel).toBe('Auto loans');
  });

  it('marks a liability product as not CECL-eligible', () => {
    const row = mapClassificationRow(
      { segmentName: 'Club', productType: 'CLUB_NAVIDAD', nombre: 'Club de Navidad', defaultsApplied: false },
      true,
    );
    expect(row.side).toBe('liability');
    expect(row.ceclEligible).toBe(false);
  });

  it('surfaces an unmatched segment honestly (null side/eligibility)', () => {
    const es = mapClassificationRow(
      { segmentName: 'Mystery', productType: null, nombre: null, defaultsApplied: false },
      true,
    );
    expect(es.side).toBeNull();
    expect(es.ceclEligible).toBeNull();
    expect(es.productLabel).toBe('Sin clasificar');

    const en = mapClassificationRow(
      { segmentName: 'Mystery', productType: null, nombre: null, defaultsApplied: false },
      false,
    );
    expect(en.productLabel).toBe('Unclassified');
  });

  it('mapClassificationRows preserves order and length', () => {
    const rows = mapClassificationRows(computed.productClassification, true);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.segmentName)).toEqual([
      'Préstamos personales',
      'Hipotecas',
      'Club de Navidad',
    ]);
  });
});

describe('sideLabel + yesNoLabel (bilingual, `—` for null)', () => {
  it('labels each side bilingually', () => {
    expect(sideLabel('asset', true)).toBe('Activo');
    expect(sideLabel('asset', false)).toBe('Asset');
    expect(sideLabel('liability', true)).toBe('Pasivo');
    expect(sideLabel('liability', false)).toBe('Liability');
    expect(sideLabel(null, true)).toBe('—');
    expect(sideLabel(null, false)).toBe('—');
  });

  it('labels yes/no/`—`', () => {
    expect(yesNoLabel(true, true)).toBe('Sí');
    expect(yesNoLabel(true, false)).toBe('Yes');
    expect(yesNoLabel(false, true)).toBe('No');
    expect(yesNoLabel(false, false)).toBe('No');
    expect(yesNoLabel(null, true)).toBe('—');
  });
});

describe('buildCooperativaStripItems (D1 — null, not 0, when unavailable)', () => {
  it('emits real values for a computed result', () => {
    const items = buildCooperativaStripItems(computed, true);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ key: 'total_balance', value: 120, unit: 'USD_M', label: 'Balance Total' });
    expect(items[1]).toMatchObject({ key: 'total_allowance', value: 4.2 });
    expect(items[2]).toMatchObject({ key: 'coverage', value: 0.035, unit: 'ratio' });
    expect(items[3]).toMatchObject({ key: 'eligible_segments', value: 2, unit: 'count' });
  });

  it('nulls every numeric (never 0) when data is unavailable', () => {
    const items = buildCooperativaStripItems(unavailable, false);
    expect(items.every((i) => i.value === null)).toBe(true);
    expect(items[0].label).toBe('Total Balance');
  });
});

describe('countGapSeverities', () => {
  it('returns zeros for undefined / empty', () => {
    expect(countGapSeverities(undefined)).toEqual({ critical: 0, warning: 0 });
    expect(countGapSeverities([])).toEqual({ critical: 0, warning: 0 });
  });

  it('tallies critical vs warning', () => {
    expect(
      countGapSeverities([
        { field: 'a', reason: 'EMPTY_BALANCE_SHEET', severity: 'CRITICAL', action: '' },
        { field: 'b', reason: 'COSSEC_INPUTS_INSUFFICIENT', severity: 'WARNING', action: '' },
        { field: 'c', reason: 'COSSEC_INPUTS_INSUFFICIENT', severity: 'WARNING', action: '' },
      ]),
    ).toEqual({ critical: 1, warning: 2 });
  });
});

describe('PR overlay disclosure constants (mirror the backend registry)', () => {
  it('matches PR_PD_MULTIPLIERS 1.0/2.1/3.6 and PR_SCENARIO_WEIGHTS 45/35/20', () => {
    expect(PR_OVERLAY_DISCLOSURE.map((s) => s.pdMultiplier)).toEqual([1.0, 2.1, 3.6]);
    expect(PR_OVERLAY_DISCLOSURE.map((s) => s.weightPct)).toEqual([45, 35, 20]);
  });

  it('weights sum to 100', () => {
    expect(PR_OVERLAY_DISCLOSURE.reduce((s, x) => s + x.weightPct, 0)).toBe(100);
  });

  it('carries bilingual scenario labels', () => {
    expect(PR_OVERLAY_DISCLOSURE.map((s) => s.es)).toEqual(['Base', 'Adverso', 'Severamente Adverso']);
    expect(PR_OVERLAY_DISCLOSURE.map((s) => s.en)).toEqual(['Baseline', 'Adverse', 'Severely Adverse']);
  });

  it('cold-start note is bilingual and provisional', () => {
    expect(COLD_START_NOTE.es).toMatch(/provisional/i);
    expect(COLD_START_NOTE.en).toMatch(/provisional/i);
  });
});

describe('COOPERATIVA_PRODUCT_META invariants', () => {
  it('every asset product is CECL-eligible; every liability is not', () => {
    for (const meta of Object.values(COOPERATIVA_PRODUCT_META)) {
      expect(meta.ceclEligible).toBe(meta.side === 'asset');
      expect(meta.es.length).toBeGreaterThan(0);
      expect(meta.en.length).toBeGreaterThan(0);
    }
  });
});
