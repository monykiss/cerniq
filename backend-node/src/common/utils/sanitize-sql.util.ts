/**
 * SQL parameter sanitization utility.
 * Extra defense layer for raw queries that bypass Prisma's parameterized queries.
 * Should NOT be used as primary SQL injection defense (use parameterized queries).
 * This is a safety net for edge cases like dynamic table names or ORDER BY clauses.
 */

/**
 * Validate that a string is a safe SQL identifier (table name, column name).
 * Only allows alphanumeric characters, underscores, and dots.
 */
export function isSafeIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(identifier);
}

/**
 * Sanitize a string for use as a SQL identifier.
 * Throws if the identifier contains unsafe characters.
 */
export function sanitizeIdentifier(identifier: string): string {
  if (!isSafeIdentifier(identifier)) {
    throw new Error(
      `Unsafe SQL identifier: "${identifier}". Only alphanumeric, underscores, and dots allowed.`,
    );
  }
  return identifier;
}

/**
 * Validate and sanitize ORDER BY direction.
 */
export function sanitizeOrderDirection(direction: string): 'ASC' | 'DESC' {
  const upper = direction?.toUpperCase().trim();
  if (upper !== 'ASC' && upper !== 'DESC') {
    return 'ASC';
  }
  return upper;
}

/**
 * Validate a sort field against an allowlist of permitted columns.
 */
export function validateSortField(
  field: string,
  allowedFields: string[],
  defaultField: string,
): string {
  if (!field) return defaultField;
  return allowedFields.includes(field) ? field : defaultField;
}

/**
 * Escape a LIKE pattern to prevent wildcard injection.
 * Escapes %, _, and \ characters.
 */
export function escapeLikePattern(pattern: string): string {
  return pattern
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
