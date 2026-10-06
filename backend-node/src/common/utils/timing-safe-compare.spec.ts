import { timingSafeStringEqual } from './timing-safe-compare';

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('returns false for different same-length strings', () => {
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
    expect(timingSafeStringEqual('aaaa', 'bbbb')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(timingSafeStringEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeStringEqual('', 'a')).toBe(false);
  });

  it('returns false for null or undefined inputs', () => {
    expect(timingSafeStringEqual(null, 'abc')).toBe(false);
    expect(timingSafeStringEqual('abc', null)).toBe(false);
    expect(timingSafeStringEqual(undefined, 'abc')).toBe(false);
    expect(timingSafeStringEqual('abc', undefined)).toBe(false);
    expect(timingSafeStringEqual(null, null)).toBe(false);
    expect(timingSafeStringEqual(undefined, undefined)).toBe(false);
  });

  it('handles multibyte UTF-8 strings', () => {
    expect(timingSafeStringEqual('🔑key', '🔑key')).toBe(true);
    expect(timingSafeStringEqual('🔑', '🔓')).toBe(false);
  });
});
