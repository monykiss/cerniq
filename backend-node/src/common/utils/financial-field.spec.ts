import { parseFinancialField } from './financial-field';

// Shared strict numeric parser for CSV-ingest surfaces.
// Originated as parseCpaFinancialField (Wave 2 / D21); hoisted to
// common/utils/ in Wave 3 when alm/csv-ingestion.service.ts and
// alm/csv-ingest-v2.service.ts migrated to use the same helper.
//
// Three silent-accept paths fixed (see JSDoc on the helper itself):
//   1. parseFloat trailing-garbage silent accept
//   2. parseFloat ±Infinity on exponential overflow
//   3. Rate auto-scale misfire on parseFloat('1.5abc') → 1.5

describe('parseFinancialField', () => {
  describe('strict numeric parsing (core)', () => {
    it('accepts a clean integer', () => {
      expect(parseFinancialField('100', { min: 0, max: 1000 })).toBe(100);
    });

    it('accepts a clean decimal', () => {
      expect(parseFinancialField('123.45', { min: 0, max: 1000 })).toBe(123.45);
    });

    it('accepts explicit negative when bounds allow', () => {
      expect(parseFinancialField('-0.25', { min: -1, max: 100 })).toBe(-0.25);
    });

    it('rejects trailing garbage (core parseFloat bug)', () => {
      expect(parseFinancialField('1234abc', { min: 0, max: 1e15 })).toBe(null);
      expect(parseFinancialField('abc1234', { min: 0, max: 1e15 })).toBe(null);
    });

    it('rejects Infinity (exponential overflow)', () => {
      // `1e400` overflows IEEE-754 double to +Infinity. `isNaN(Infinity)`
      // returns false, so the old code happily let it through.
      expect(parseFinancialField('1e400', { min: 0, max: 1e15 })).toBe(null);
      expect(parseFinancialField('-1e400', { min: -1e15, max: 1e15 })).toBe(
        null,
      );
    });

    it('rejects the literal strings "Infinity" and "-Infinity"', () => {
      expect(parseFinancialField('Infinity', { min: 0, max: 1e15 })).toBe(null);
      expect(parseFinancialField('-Infinity', { min: -1e15, max: 1e15 })).toBe(
        null,
      );
    });

    it('rejects "NaN"', () => {
      expect(parseFinancialField('NaN', { min: 0, max: 1e15 })).toBe(null);
    });

    it('rejects empty strings and whitespace-only', () => {
      expect(parseFinancialField('', { min: 0, max: 1000 })).toBe(null);
      expect(parseFinancialField('   ', { min: 0, max: 1000 })).toBe(null);
      expect(parseFinancialField('\t\n', { min: 0, max: 1000 })).toBe(null);
    });

    it('rejects null and undefined', () => {
      expect(parseFinancialField(null, { min: 0, max: 1000 })).toBe(null);
      expect(parseFinancialField(undefined, { min: 0, max: 1000 })).toBe(null);
    });

    it('trims leading/trailing whitespace before parsing', () => {
      expect(parseFinancialField('  42  ', { min: 0, max: 100 })).toBe(42);
    });
  });

  describe('bounds enforcement', () => {
    it('rejects values below min', () => {
      expect(parseFinancialField('-5', { min: 0, max: 100 })).toBe(null);
    });

    it('rejects values above max', () => {
      expect(parseFinancialField('101', { min: 0, max: 100 })).toBe(null);
    });

    it('accepts the min boundary', () => {
      expect(parseFinancialField('0', { min: 0, max: 100 })).toBe(0);
    });

    it('accepts the max boundary', () => {
      expect(parseFinancialField('100', { min: 0, max: 100 })).toBe(100);
    });
  });

  describe('integer-only constraint', () => {
    it('accepts an integer when integer:true', () => {
      expect(
        parseFinancialField('60', { min: 0, max: 600, integer: true }),
      ).toBe(60);
    });

    it('rejects a fractional when integer:true', () => {
      expect(
        parseFinancialField('60.5', { min: 0, max: 600, integer: true }),
      ).toBe(null);
    });

    it('accepts a fractional when integer is unset (default false)', () => {
      expect(parseFinancialField('27.5', { min: 0, max: 50 })).toBe(27.5);
    });

    it('tenor-in-months scenario: integer months up to 600 (50y)', () => {
      expect(
        parseFinancialField('360', { min: 0, max: 600, integer: true }),
      ).toBe(360);
      // 30.5 months is not a real tenor
      expect(
        parseFinancialField('30.5', { min: 0, max: 600, integer: true }),
      ).toBe(null);
    });
  });

  describe('realistic CSV scenarios', () => {
    it('balance: accepts a $250M cooperativa total asset line', () => {
      expect(parseFinancialField('250000000', { min: 0, max: 1e15 })).toBe(
        250_000_000,
      );
    });

    it("balance: rejects a negative balance (asset can't be negative)", () => {
      expect(parseFinancialField('-1000', { min: 0, max: 1e15 })).toBe(null);
    });

    it('rate: accepts a 4.75% mortgage rate', () => {
      expect(parseFinancialField('4.75', { min: -1, max: 100 })).toBe(4.75);
    });

    it('rate: rejects a 200% rate (operator typo — missed decimal)', () => {
      expect(parseFinancialField('200', { min: -1, max: 100 })).toBe(null);
    });

    it('duration: accepts a 30-year treasury duration (27.5y Macaulay)', () => {
      expect(parseFinancialField('27.5', { min: 0, max: 50 })).toBe(27.5);
    });

    it('duration: rejects a 100-year duration (operator typo — wrong col)', () => {
      expect(parseFinancialField('100', { min: 0, max: 50 })).toBe(null);
    });

    // D22 regression (ALM csv-ingestion.service.ts rate auto-scale misfire)
    it("rate auto-scale: '1.5abc' no longer silently becomes 0.015", () => {
      // Under the old parseFloat path, `1.5abc` returned 1.5, which
      // would then be > 1 and divided by 100 → 0.015 silently.
      // Under the new helper, it rejects outright.
      expect(parseFinancialField('1.5abc', { min: 0, max: 1 })).toBe(null);
    });

    // D22 regression (alm/csv-ingestion.service.ts:224 bound guard)
    it("balance: '250000000abc' now rejects, was silently accepting", () => {
      expect(
        parseFinancialField('250000000abc', { min: 0, max: 999_999_999_999 }),
      ).toBe(null);
    });
  });
});
