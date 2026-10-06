import { chunk, unique, groupBy, partition, flatten } from './array.util';

describe('array.util', () => {
  describe('chunk', () => {
    it('splits an array into chunks of the given size', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('returns empty array for empty input', () => {
      expect(chunk([], 3)).toEqual([]);
    });

    it('throws when size is zero or negative', () => {
      expect(() => chunk([1], 0)).toThrow('Chunk size must be positive');
    });
  });

  describe('unique', () => {
    it('removes duplicates from primitives', () => {
      expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    });

    it('deduplicates by key function', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 1 }];
      expect(unique(items, (i) => i.id)).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('groupBy', () => {
    it('groups items by the key function', () => {
      const items = [
        { type: 'a', val: 1 },
        { type: 'b', val: 2 },
        { type: 'a', val: 3 },
      ];
      const grouped = groupBy(items, (i) => i.type);
      expect(grouped['a']).toHaveLength(2);
      expect(grouped['b']).toHaveLength(1);
    });
  });

  describe('partition', () => {
    it('splits array by predicate', () => {
      const [evens, odds] = partition([1, 2, 3, 4], (n) => n % 2 === 0);
      expect(evens).toEqual([2, 4]);
      expect(odds).toEqual([1, 3]);
    });
  });

  describe('flatten', () => {
    it('flattens one level deep', () => {
      expect(flatten([[1, 2], [3], [4, 5]])).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
