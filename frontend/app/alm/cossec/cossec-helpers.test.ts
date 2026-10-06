import { describe, it, expect } from 'vitest';

import {
  validateCossec,
  overallBanner,
  ratioTone,
  ratioStatusLabel,
  formatRatioValue,
  countRatioStatuses,
  type CossecRatio,
} from './cossec-helpers';

const ok = {
  overallStatus: 'compliant',
  examReadinessScore: 88,
  ratios: [],
  summary: {
    capitalRatio: 0.123,
    loanToShareRatio: 0.8,
    liquidityRatio: 0.2,
    nim: 0.035,
  },
};

describe('validateCossec', () => {
  it('accepts a well-formed result', () => {
    const r = validateCossec(ok);
    expect(r.overallStatus).toBe('compliant');
    expect(r.examReadinessScore).toBe(88);
  });

  it('rejects non-objects', () => {
    expect(() => validateCossec(null)).toThrow();
    expect(() => validateCossec(42)).toThrow();
  });

  it('rejects missing overallStatus / ratios / summary', () => {
    expect(() => validateCossec({ ratios: [], summary: {} })).toThrow();
    expect(() =>
      validateCossec({ overallStatus: 'compliant', summary: {} }),
    ).toThrow();
    expect(() =>
      validateCossec({ overallStatus: 'compliant', ratios: [] }),
    ).toThrow();
  });
});

describe('overallBanner (Spanish-first semáforo)', () => {
  it('maps each status to ES label + tone', () => {
    expect(overallBanner('compliant')).toMatchObject({ es: 'CUMPLE', tone: 'green' });
    expect(overallBanner('conditional')).toMatchObject({
      es: 'CUMPLE CON OBSERVACIONES',
      tone: 'amber',
    });
    expect(overallBanner('non-compliant')).toMatchObject({
      es: 'NO CUMPLE',
      tone: 'red',
    });
    expect(overallBanner('data_unavailable')).toMatchObject({
      es: 'DATOS INSUFICIENTES',
      tone: 'gray',
    });
  });
});

describe('ratioTone + ratioStatusLabel', () => {
  it('maps status to a semáforo tone', () => {
    expect(ratioTone('pass')).toBe('green');
    expect(ratioTone('warning')).toBe('amber');
    expect(ratioTone('fail')).toBe('red');
    expect(ratioTone('info')).toBe('gray');
    expect(ratioTone('data_unavailable')).toBe('gray');
  });

  it('labels status bilingually', () => {
    expect(ratioStatusLabel('pass', true)).toBe('Cumple');
    expect(ratioStatusLabel('pass', false)).toBe('Pass');
    expect(ratioStatusLabel('data_unavailable', true)).toBe('Datos pendientes');
  });
});

describe('formatRatioValue (D1 — never the 0 sentinel)', () => {
  it('shows — for data_unavailable regardless of the value sentinel', () => {
    expect(
      formatRatioValue({ value: 0, unit: '%', status: 'data_unavailable' }),
    ).toBe('—');
  });

  it('formats percentages, ratios, and millions', () => {
    expect(formatRatioValue({ value: 12.345, unit: '%', status: 'pass' })).toBe(
      '12.35%',
    );
    expect(
      formatRatioValue({ value: 0.82, unit: 'ratio', status: 'warning' }),
    ).toBe('0.82×');
    expect(
      formatRatioValue({ value: 134.2, unit: 'USD_M', status: 'pass' }),
    ).toBe('$134.2M');
  });
});

describe('countRatioStatuses', () => {
  it('tallies the semáforo distribution', () => {
    const ratios = [
      { status: 'pass' },
      { status: 'pass' },
      { status: 'warning' },
      { status: 'fail' },
      { status: 'data_unavailable' },
      { status: 'info' },
    ] as unknown as CossecRatio[];
    expect(countRatioStatuses(ratios)).toEqual({
      pass: 2,
      warning: 1,
      fail: 1,
      unavailable: 1,
    });
  });
});
