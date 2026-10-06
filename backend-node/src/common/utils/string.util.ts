/**
 * String utilities — truncate, capitalize, pluralize.
 * Lightweight helpers for common string transformations.
 */

/**
 * Truncate a string to the given length, appending a suffix if truncated.
 */
export function truncate(
  str: string,
  maxLength: number,
  suffix = '...',
): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Simple English pluralization.
 * Handles common cases: -s, -es, -ies.
 */
export function pluralize(word: string, count: number): string {
  if (count === 1) return word;
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  if (/(?:s|x|z|ch|sh)$/i.test(word)) {
    return word + 'es';
  }
  return word + 's';
}

/**
 * Convert a string to camelCase.
 */
export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/**
 * Convert a string to snake_case.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

/**
 * Check if a string is blank (empty or whitespace-only).
 */
export function isBlank(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0;
}
