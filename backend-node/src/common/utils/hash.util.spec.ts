import {
  consistentHash,
  buildCacheKey,
  stableStringify,
  fingerprint,
} from './hash.util';

describe('hash.util', () => {
  describe('consistentHash', () => {
    it('produces consistent hash for the same string input', () => {
      const hash1 = consistentHash('test-input');
      const hash2 = consistentHash('test-input');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      expect(consistentHash('a')).not.toBe(consistentHash('b'));
    });

    it('respects custom length parameter', () => {
      expect(consistentHash('test', 8)).toHaveLength(8);
      expect(consistentHash('test', 32)).toHaveLength(32);
    });
  });

  describe('buildCacheKey', () => {
    it('returns prefix:hash format', () => {
      const key = buildCacheKey('user', { id: '123' });
      expect(key).toMatch(/^user:[a-f0-9]+$/);
    });

    it('produces same key for same params regardless of insertion order', () => {
      const key1 = buildCacheKey('items', { a: '1', b: '2' });
      const key2 = buildCacheKey('items', { b: '2', a: '1' });
      expect(key1).toBe(key2);
    });
  });

  describe('stableStringify', () => {
    it('sorts object keys', () => {
      const result = stableStringify({ b: 2, a: 1 });
      expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
    });

    it('handles null and undefined', () => {
      expect(stableStringify(null)).toBe('');
      expect(stableStringify(undefined)).toBe('');
    });
  });

  describe('fingerprint', () => {
    it('returns a 12-char hex string', () => {
      const fp = fingerprint({ key: 'value' });
      expect(fp).toHaveLength(12);
      expect(fp).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('stableStringify edge types', () => {
    it('handles symbols', () => {
      const result = stableStringify(Symbol('test'));
      expect(result).toContain('Symbol');
    });

    it('handles functions', () => {
      const result = stableStringify(() => 42);
      expect(result).toContain('=>');
    });

    it('handles arrays', () => {
      const result = stableStringify([1, 'two', { three: 3 }]);
      expect(result).toContain('[');
      expect(result).toContain(']');
    });

    it('handles numbers and booleans', () => {
      expect(stableStringify(42)).toBe('42');
      expect(stableStringify(true)).toBe('true');
    });
  });
});
