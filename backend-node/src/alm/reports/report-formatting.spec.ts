import {
  asNumber,
  detectMixedCurrencies,
  createReportFormatter,
} from './report-formatting';

describe('asNumber', () => {
  it('passes through finite numbers', () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber(-3.14)).toBe(-3.14);
    expect(asNumber(0)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(asNumber('100.5')).toBe(100.5);
    expect(asNumber('-7')).toBe(-7);
  });

  it('returns 0 for non-finite values', () => {
    expect(asNumber(NaN)).toBe(0);
    expect(asNumber(Infinity)).toBe(0);
    expect(asNumber(-Infinity)).toBe(0);
  });

  it('handles Prisma Decimal-like objects via .toNumber()', () => {
    const decimal = { toNumber: () => 123.45 };
    expect(asNumber(decimal)).toBe(123.45);
  });

  it('returns 0 for null/undefined/garbage', () => {
    expect(asNumber(null)).toBe(0);
    expect(asNumber(undefined)).toBe(0);
    expect(asNumber('not-a-number')).toBe(0);
    expect(asNumber({})).toBe(0);
  });
});

describe('detectMixedCurrencies', () => {
  it('returns null for a single currency', () => {
    expect(detectMixedCurrencies(['USD', 'USD', 'USD'])).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectMixedCurrencies([])).toBeNull();
  });

  it('returns null when all entries are null/undefined', () => {
    expect(detectMixedCurrencies([null, undefined, null])).toBeNull();
  });

  it('returns null for a single non-null currency among nulls', () => {
    expect(detectMixedCurrencies([null, 'USD', undefined])).toBeNull();
  });

  it('returns a WARNING gap when currencies are mixed', () => {
    const gap = detectMixedCurrencies(['USD', 'EUR', 'USD']);
    expect(gap).not.toBeNull();
    expect(gap!.reason).toBe('MIXED_CURRENCIES');
    expect(gap!.severity).toBe('WARNING');
    expect(gap!.context.found).toEqual(expect.arrayContaining(['USD', 'EUR']));
    expect(gap!.context.found).toHaveLength(2);
  });

  it('lists all distinct currencies in context', () => {
    const gap = detectMixedCurrencies(['USD', 'EUR', 'GBP']);
    expect(gap!.context.found).toHaveLength(3);
  });
});

describe('createReportFormatter', () => {
  it('formats money in USD by default', () => {
    const fmt = createReportFormatter('en');
    expect(fmt.money(1000)).toMatch(/\$1,000\.00/);
  });

  it('formats percentages correctly', () => {
    const fmt = createReportFormatter('en');
    expect(fmt.percent(0.052, 1)).toBe('5.2%');
    expect(fmt.percent(75, 0)).toBe('75%');
  });

  it('uses ES locale for Spanish', () => {
    const fmt = createReportFormatter('es');
    expect(fmt.locale).toBe('es-PR');
  });
});
