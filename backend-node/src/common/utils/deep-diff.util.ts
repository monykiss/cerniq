/**
 * Deep diff utility for audit trails.
 * Compares two objects and returns a structured list of changes.
 * Used by audit logging to record exactly what changed on each update.
 */

export interface DiffEntry {
  path: string;
  oldValue: any;
  newValue: any;
  type: 'added' | 'removed' | 'changed';
}

/**
 * Compute deep diff between two objects.
 * Returns an array of changes with dot-notation paths.
 *
 * @example
 * deepDiff({ name: 'Alice', age: 30 }, { name: 'Bob', age: 30 })
 * // [{ path: 'name', oldValue: 'Alice', newValue: 'Bob', type: 'changed' }]
 */
export function deepDiff(
  oldObj: Record<string, any>,
  newObj: Record<string, any>,
  parentPath = '',
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const allKeys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {}),
  ]);

  for (const key of allKeys) {
    const path = parentPath ? `${parentPath}.${key}` : key;
    const oldVal = oldObj?.[key];
    const newVal = newObj?.[key];

    if (oldVal === undefined && newVal !== undefined) {
      diffs.push({
        path,
        oldValue: undefined,
        newValue: newVal,
        type: 'added',
      });
    } else if (oldVal !== undefined && newVal === undefined) {
      diffs.push({
        path,
        oldValue: oldVal,
        newValue: undefined,
        type: 'removed',
      });
    } else if (isObject(oldVal) && isObject(newVal)) {
      diffs.push(...deepDiff(oldVal, newVal, path));
    } else if (!isEqual(oldVal, newVal)) {
      diffs.push({ path, oldValue: oldVal, newValue: newVal, type: 'changed' });
    }
  }

  return diffs;
}

/**
 * Format diff entries into a human-readable summary.
 */
export function formatDiffSummary(diffs: DiffEntry[]): string {
  if (diffs.length === 0) return 'No changes';

  return diffs
    .map((d) => {
      switch (d.type) {
        case 'added':
          return `+ ${d.path}: ${JSON.stringify(d.newValue)}`;
        case 'removed':
          return `- ${d.path}: ${JSON.stringify(d.oldValue)}`;
        case 'changed':
          return `~ ${d.path}: ${JSON.stringify(d.oldValue)} -> ${JSON.stringify(d.newValue)}`;
      }
    })
    .join('\n');
}

function isObject(val: any): val is Record<string, any> {
  return (
    val !== null &&
    typeof val === 'object' &&
    !Array.isArray(val) &&
    !(val instanceof Date)
  );
}

function isEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}
