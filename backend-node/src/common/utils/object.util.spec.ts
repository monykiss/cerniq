import { omit, pick, isEmpty, deepMerge, flattenObject } from './object.util';

describe('object.util', () => {
  describe('omit', () => {
    it('removes specified keys', () => {
      expect(omit({ a: 1, b: 2, c: 3 }, ['b'])).toEqual({ a: 1, c: 3 });
    });

    it('returns same object if no keys match', () => {
      expect(omit({ a: 1 }, ['z' as any])).toEqual({ a: 1 });
    });
  });

  describe('pick', () => {
    it('retains only specified keys', () => {
      expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });
  });

  describe('deepMerge', () => {
    it('merges nested objects', () => {
      const result = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3 } } as any);
      expect(result).toEqual({ a: { x: 1, y: 3 } });
    });
  });

  describe('flattenObject', () => {
    it('flattens nested keys to dot notation', () => {
      expect(flattenObject({ a: { b: 1 } })).toEqual({ 'a.b': 1 });
    });
  });

  describe('isEmpty', () => {
    it('returns true for empty object', () => {
      expect(isEmpty({})).toBe(true);
    });

    it('returns false for non-empty object', () => {
      expect(isEmpty({ a: 1 })).toBe(false);
    });
  });
});
