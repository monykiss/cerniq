import {
  safeParse,
  stringifyWithBigInt,
  parseWithBigInt,
  jsonClone,
  isValidJson,
  prettyJson,
} from './json.util';

describe('json.util', () => {
  describe('safeParse', () => {
    it('parses valid JSON', () => {
      expect(safeParse('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('returns fallback for invalid JSON', () => {
      expect(safeParse('not json', 'fallback')).toBe('fallback');
    });

    it('returns null as default fallback', () => {
      expect(safeParse('bad')).toBeNull();
    });
  });

  describe('stringifyWithBigInt / parseWithBigInt', () => {
    it('round-trips BigInt values', () => {
      const obj = { count: 9007199254740993n };
      const json = stringifyWithBigInt(obj);
      expect(json).toContain('9007199254740993n');

      const parsed = parseWithBigInt<{ count: bigint }>(json);
      expect(parsed.count).toBe(9007199254740993n);
    });
  });

  describe('jsonClone', () => {
    it('deep clones an object', () => {
      const original = { a: { b: [1, 2, 3] } };
      const clone = jsonClone(original);
      clone.a.b.push(4);
      expect(original.a.b).toEqual([1, 2, 3]);
    });
  });

  describe('isValidJson', () => {
    it('returns true for valid JSON', () => {
      expect(isValidJson('{"a":1}')).toBe(true);
    });

    it('returns false for invalid JSON', () => {
      expect(isValidJson('{bad}')).toBe(false);
    });
  });

  describe('prettyJson', () => {
    it('formats JSON with indentation', () => {
      const result = prettyJson({ a: 1 });
      expect(result).toContain('\n');
      expect(result).toContain('  "a"');
    });
  });
});
