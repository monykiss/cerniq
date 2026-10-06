import { deepDiff, formatDiffSummary, DiffEntry } from './deep-diff.util';

describe('deep-diff.util', () => {
  // ── deepDiff ──────────────────────────────────────────────────

  it('returns empty array for identical objects', () => {
    const obj = { a: 1, b: 'hello' };
    expect(deepDiff(obj, obj)).toEqual([]);
  });

  it('detects changed primitive values', () => {
    const diff = deepDiff({ a: 1 }, { a: 2 });
    expect(diff).toEqual([
      { path: 'a', oldValue: 1, newValue: 2, type: 'changed' },
    ]);
  });

  it('detects added keys', () => {
    const diff = deepDiff({ a: 1 }, { a: 1, b: 2 });
    expect(diff).toEqual([
      { path: 'b', oldValue: undefined, newValue: 2, type: 'added' },
    ]);
  });

  it('detects removed keys', () => {
    const diff = deepDiff({ a: 1, b: 2 }, { a: 1 });
    expect(diff).toEqual([
      { path: 'b', oldValue: 2, newValue: undefined, type: 'removed' },
    ]);
  });

  it('recurses into nested objects', () => {
    const diff = deepDiff(
      { user: { name: 'Alice', age: 30 } },
      { user: { name: 'Bob', age: 30 } },
    );
    expect(diff).toEqual([
      {
        path: 'user.name',
        oldValue: 'Alice',
        newValue: 'Bob',
        type: 'changed',
      },
    ]);
  });

  it('handles deeply nested additions', () => {
    const diff = deepDiff({ a: { b: { c: 1 } } }, { a: { b: { c: 1, d: 2 } } });
    expect(diff).toEqual([
      { path: 'a.b.d', oldValue: undefined, newValue: 2, type: 'added' },
    ]);
  });

  it('handles deeply nested removals', () => {
    const diff = deepDiff({ a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 1 } } });
    expect(diff).toEqual([
      { path: 'a.b.d', oldValue: 2, newValue: undefined, type: 'removed' },
    ]);
  });

  it('treats arrays as primitives (compared via JSON.stringify)', () => {
    const diff = deepDiff({ tags: [1, 2] }, { tags: [1, 2, 3] });
    expect(diff).toEqual([
      { path: 'tags', oldValue: [1, 2], newValue: [1, 2, 3], type: 'changed' },
    ]);
  });

  it('returns no diff when arrays are identical', () => {
    expect(deepDiff({ tags: [1, 2] }, { tags: [1, 2] })).toEqual([]);
  });

  it('handles null values correctly (null is not an object to recurse into)', () => {
    const diff = deepDiff({ a: { x: 1 } }, { a: null });
    expect(diff).toEqual([
      { path: 'a', oldValue: { x: 1 }, newValue: null, type: 'changed' },
    ]);
  });

  it('handles null to object transition', () => {
    const diff = deepDiff({ a: null }, { a: { x: 1 } });
    expect(diff).toEqual([
      { path: 'a', oldValue: null, newValue: { x: 1 }, type: 'changed' },
    ]);
  });

  it('handles Date comparisons (same dates)', () => {
    const d = new Date('2024-01-01');
    expect(deepDiff({ d }, { d: new Date('2024-01-01') })).toEqual([]);
  });

  it('handles Date comparisons (different dates)', () => {
    const d1 = new Date('2024-01-01');
    const d2 = new Date('2024-06-01');
    const diff = deepDiff({ d: d1 }, { d: d2 });
    expect(diff).toEqual([
      { path: 'd', oldValue: d1, newValue: d2, type: 'changed' },
    ]);
  });

  it('handles both objects being empty', () => {
    expect(deepDiff({}, {})).toEqual([]);
  });

  it('handles oldObj being null/undefined gracefully', () => {
    const diff = deepDiff(null as any, { a: 1 });
    expect(diff).toEqual([
      { path: 'a', oldValue: undefined, newValue: 1, type: 'added' },
    ]);
  });

  it('handles newObj being null/undefined gracefully', () => {
    const diff = deepDiff({ a: 1 }, null as any);
    expect(diff).toEqual([
      { path: 'a', oldValue: 1, newValue: undefined, type: 'removed' },
    ]);
  });

  it('handles boolean changes', () => {
    const diff = deepDiff({ active: true }, { active: false });
    expect(diff).toEqual([
      { path: 'active', oldValue: true, newValue: false, type: 'changed' },
    ]);
  });

  it('handles string to number type change', () => {
    const diff = deepDiff({ val: '42' }, { val: 42 });
    expect(diff).toEqual([
      { path: 'val', oldValue: '42', newValue: 42, type: 'changed' },
    ]);
  });

  it('handles multiple changes at once', () => {
    const diff = deepDiff({ a: 1, b: 2, c: 3 }, { a: 10, b: 2, d: 4 });
    expect(diff).toHaveLength(3);
    expect(diff).toEqual(
      expect.arrayContaining([
        { path: 'a', oldValue: 1, newValue: 10, type: 'changed' },
        { path: 'c', oldValue: 3, newValue: undefined, type: 'removed' },
        { path: 'd', oldValue: undefined, newValue: 4, type: 'added' },
      ]),
    );
  });

  // ── formatDiffSummary ─────────────────────────────────────────

  describe('formatDiffSummary', () => {
    it('returns "No changes" for empty diff', () => {
      expect(formatDiffSummary([])).toBe('No changes');
    });

    it('formats added entry', () => {
      const diffs: DiffEntry[] = [
        { path: 'name', oldValue: undefined, newValue: 'Bob', type: 'added' },
      ];
      expect(formatDiffSummary(diffs)).toBe('+ name: "Bob"');
    });

    it('formats removed entry', () => {
      const diffs: DiffEntry[] = [
        {
          path: 'name',
          oldValue: 'Alice',
          newValue: undefined,
          type: 'removed',
        },
      ];
      expect(formatDiffSummary(diffs)).toBe('- name: "Alice"');
    });

    it('formats changed entry', () => {
      const diffs: DiffEntry[] = [
        { path: 'name', oldValue: 'Alice', newValue: 'Bob', type: 'changed' },
      ];
      expect(formatDiffSummary(diffs)).toBe('~ name: "Alice" -> "Bob"');
    });

    it('formats multiple entries separated by newlines', () => {
      const diffs: DiffEntry[] = [
        { path: 'a', oldValue: 1, newValue: 2, type: 'changed' },
        { path: 'b', oldValue: undefined, newValue: 3, type: 'added' },
      ];
      const result = formatDiffSummary(diffs);
      expect(result).toContain('~ a: 1 -> 2');
      expect(result).toContain('+ b: 3');
      expect(result.split('\n')).toHaveLength(2);
    });
  });
});
