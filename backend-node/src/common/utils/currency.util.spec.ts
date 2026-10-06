import {
  formatCurrency,
  formatCompactCurrency,
  formatBilingual,
  parseCurrency,
} from './currency.util';

describe('formatCurrency', () => {
  it('formats in EN locale by default', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats in EN locale explicitly', () => {
    expect(formatCurrency(1234.56, 'en')).toBe('$1,234.56');
  });

  it('formats in ES locale', () => {
    const result = formatCurrency(1234.56, 'es');
    // ES (es-PR) uses period as thousands separator and comma as decimal
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('56');
  });

  it('formats zero', () => {
    expect(formatCurrency(0, 'en')).toBe('$0.00');
  });

  it('formats negative amounts', () => {
    const result = formatCurrency(-500, 'en');
    expect(result).toContain('500');
    expect(result).toContain('$');
  });

  it('always uses two decimal places', () => {
    expect(formatCurrency(100, 'en')).toBe('$100.00');
  });
});

describe('formatCompactCurrency', () => {
  it('formats thousands as K', () => {
    const result = formatCompactCurrency(5000, 'en');
    expect(result).toMatch(/\$5\.?0?K/);
  });

  it('formats millions as M', () => {
    const result = formatCompactCurrency(1200000, 'en');
    expect(result).toMatch(/\$1\.2M/);
  });

  it('formats ES compact notation', () => {
    const result = formatCompactCurrency(5000, 'es');
    // Should contain a compact form
    expect(result).toContain('$');
    expect(result).toContain('5');
  });
});

describe('formatBilingual', () => {
  it('returns both EN and ES formats separated by /', () => {
    const result = formatBilingual(1234.56);
    expect(result).toContain('/');
    expect(result).toContain('$');
  });

  it('contains the EN format first', () => {
    const result = formatBilingual(100);
    expect(result.startsWith('$100.00')).toBe(true);
  });
});

describe('parseCurrency', () => {
  it('parses EN format', () => {
    expect(parseCurrency('$1,234.56')).toBe(1234.56);
  });

  it('parses ES format with dot thousands and comma decimal', () => {
    expect(parseCurrency('$1.234,56')).toBe(1234.56);
  });

  it('returns 0 for empty string', () => {
    expect(parseCurrency('')).toBe(0);
  });

  it('parses plain number', () => {
    expect(parseCurrency('500')).toBe(500);
  });

  it('parses negative value', () => {
    expect(parseCurrency('-$100.50')).toBe(-100.5);
  });

  it('handles invalid input gracefully', () => {
    expect(parseCurrency('abc')).toBe(0);
  });

  // D22: The char-allowlist sanitizer (`[^0-9.,-]`) strips exponential
  // notation (`e`) before parsing, so `$1e400` becomes `$1400` and
  // the old `parseFloat(cleaned) || 0` didn't actually leak Infinity
  // via this function — the sanitizer was an accidental guard. Fix
  // swaps to `Number(cleaned)` + `Number.isFinite(...)` anyway for
  // consistency with the parseFinancialField idiom across the codebase.
  // Regression coverage: literal "Infinity" is stripped to empty
  // string → 0, which is the correct behavior in both implementations.
  it('sanitizer strips Infinity/exponent chars → safe zero', () => {
    expect(parseCurrency('$Infinity')).toBe(0);
    expect(parseCurrency('$NaN')).toBe(0);
  });
});
