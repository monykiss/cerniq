/**
 * URL-safe slug generation utility.
 * Converts strings to lowercase, ASCII-only, hyphen-separated slugs
 * suitable for URLs, file names, and identifiers.
 */

/**
 * Generate a URL-safe slug from a string.
 * Handles unicode transliteration for common accented characters.
 *
 * @example
 * slugify('Hello World!') // 'hello-world'
 * slugify('Reporte Financiero Q1 2025') // 'reporte-financiero-q1-2025'
 * slugify('Año Fiscal 2025') // 'ano-fiscal-2025'
 */
export function slugify(input: string): string {
  if (!input) return '';

  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Strip diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric chars
    .replace(/[\s_]+/g, '-') // Replace spaces/underscores with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Generate a unique slug by appending a short random suffix.
 *
 * @example
 * uniqueSlug('quarterly-report') // 'quarterly-report-a3f2'
 */
export function uniqueSlug(input: string, suffixLength = 4): string {
  const base = slugify(input);
  const suffix = Math.random()
    .toString(36)
    .substring(2, 2 + suffixLength);
  return base ? `${base}-${suffix}` : suffix;
}

/**
 * Truncate a slug to a maximum length, preserving word boundaries.
 */
export function truncateSlug(input: string, maxLength = 80): string {
  const slug = slugify(input);
  if (slug.length <= maxLength) return slug;

  const truncated = slug.substring(0, maxLength);
  const lastHyphen = truncated.lastIndexOf('-');
  return lastHyphen > 0 ? truncated.substring(0, lastHyphen) : truncated;
}
