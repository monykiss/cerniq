/**
 * Bilingual currency formatter for EN/ES reports.
 * Handles USD formatting with proper locale conventions
 * for both English and Spanish audiences.
 */

export type Locale = 'en' | 'es';

/**
 * Format a number as USD currency for the given locale.
 * EN: $1,234.56
 * ES: $1.234,56
 */
export function formatCurrency(amount: number, locale: Locale = 'en'): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-PR',
  };

  return new Intl.NumberFormat(localeMap[locale], {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number as a compact currency string.
 * EN: $1.2M, $500K
 * ES: $1,2 M, $500 K
 */
export function formatCompactCurrency(
  amount: number,
  locale: Locale = 'en',
): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-PR',
  };

  return new Intl.NumberFormat(localeMap[locale], {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

/**
 * Format currency with bilingual label.
 * Returns: "$1,234.56 / $1.234,56"
 */
export function formatBilingual(amount: number): string {
  return `${formatCurrency(amount, 'en')} / ${formatCurrency(amount, 'es')}`;
}

/**
 * Parse a currency string back to a number.
 * Handles both EN ($1,234.56) and ES ($1.234,56) formats.
 */
export function parseCurrency(value: string): number {
  if (!value) return 0;
  // Remove currency symbols and whitespace
  let cleaned = value.replace(/[^0-9.,-]/g, '');
  // Detect ES format (dot as thousands separator, comma as decimal)
  if (/^\d{1,3}(\.\d{3})+(,\d{2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // EN format
    cleaned = cleaned.replace(/,/g, '');
  }
  // D22: `parseFloat(cleaned) || 0` returned `Infinity` on strings like
  // `"$1e400"` because `Infinity || 0 === Infinity` (Infinity is truthy).
  // Use `Number()` + `Number.isFinite` to catch that + NaN in one step.
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
