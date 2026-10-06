import { slugify, uniqueSlug, truncateSlug } from './slug.util';

describe('slugify', () => {
  it('converts to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('foo bar baz')).toBe('foo-bar-baz');
  });

  it('removes special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('strips diacritical marks (accents)', () => {
    expect(slugify('Ano Fiscal 2025')).toBe('ano-fiscal-2025');
  });

  it('handles Spanish characters', () => {
    expect(slugify('Reporte Financiero Q1 2025')).toBe(
      'reporte-financiero-q1-2025',
    );
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo---bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify(' -hello- ')).toBe('hello');
  });

  it('handles underscores (stripped by char filter)', () => {
    // The regex [^a-z0-9\s-] removes underscores before the space/underscore replacement
    expect(slugify('foo_bar_baz')).toBe('foobarbaz');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('handles all-special-character input', () => {
    expect(slugify('!@#$%')).toBe('');
  });

  it('preserves numbers', () => {
    expect(slugify('Report Q4 2025')).toBe('report-q4-2025');
  });
});

describe('uniqueSlug', () => {
  it('appends a random suffix', () => {
    const result = uniqueSlug('quarterly-report');
    expect(result).toMatch(/^quarterly-report-[a-z0-9]{4}$/);
  });

  it('uses custom suffix length', () => {
    const result = uniqueSlug('test', 8);
    expect(result).toMatch(/^test-[a-z0-9]{8}$/);
  });

  it('generates different slugs each time', () => {
    const a = uniqueSlug('test');
    const b = uniqueSlug('test');
    // Extremely unlikely to be equal
    expect(a).not.toBe(b);
  });

  it('handles empty input', () => {
    const result = uniqueSlug('');
    // Should just return the random suffix
    expect(result).toMatch(/^[a-z0-9]{4}$/);
  });
});

describe('truncateSlug', () => {
  it('does not truncate short slugs', () => {
    expect(truncateSlug('short', 80)).toBe('short');
  });

  it('truncates at word boundary', () => {
    const input =
      'this is a very long title that should be truncated at a word boundary';
    const result = truncateSlug(input, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result.endsWith('-')).toBe(false);
  });

  it('defaults to 80 character limit', () => {
    const long = 'a'.repeat(100);
    const result = truncateSlug(long);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it('returns full slug if under maxLength', () => {
    expect(truncateSlug('hello-world', 100)).toBe('hello-world');
  });
});
