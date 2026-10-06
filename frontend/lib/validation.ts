/**
 * Client-side validation helpers.
 */

/** Validate an email address (RFC 5322 simplified) */
export const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Validate a US phone number (10 digits, optional country code / formatting) */
export const isValidPhone = (value: string): boolean => {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
};

/** Validate a UUID v4 */
export const isValidUUID = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Validate a URL */
export const isValidURL = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/** Check that a string is non-empty after trimming */
export const isNonEmpty = (value: string): boolean => value.trim().length > 0;

/** Check that a value falls within a numeric range */
export const isInRange = (value: number, min: number, max: number): boolean =>
  value >= min && value <= max;

/** Check minimum length */
export const hasMinLength = (value: string, min: number): boolean =>
  value.length >= min;

/** Check maximum length */
export const hasMaxLength = (value: string, max: number): boolean =>
  value.length <= max;
