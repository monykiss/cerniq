/**
 * Data masking utility for logs and responses.
 * Masks sensitive data (emails, phones, API keys) while preserving
 * enough structure for debugging and audit purposes.
 */

/**
 * Mask an email address: j***@example.com
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}@${domain}`;
}

/**
 * Mask a phone number: ***-***-1234
 */
export function maskPhone(phone: string): string {
  if (!phone) return '***';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-***-${digits.slice(-4)}`;
}

/**
 * Mask an API key: key_****abcd
 */
export function maskApiKey(key: string): string {
  if (!key) return '***';
  if (key.length <= 8) return '****';
  const prefix = key.substring(0, key.indexOf('_') + 1 || 4);
  const suffix = key.slice(-4);
  return `${prefix}****${suffix}`;
}

/**
 * Mask a credit card number: ****-****-****-1234
 */
export function maskCreditCard(cardNumber: string): string {
  if (!cardNumber) return '***';
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****-****-****-${digits.slice(-4)}`;
}

/**
 * Recursively mask sensitive fields in an object.
 * Detects field names containing: email, phone, password, secret, token, key, card.
 */
export function maskSensitiveFields(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveFields);

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === 'string') {
      if (lowerKey.includes('email')) {
        result[key] = maskEmail(value);
      } else if (lowerKey.includes('phone') || lowerKey.includes('mobile')) {
        result[key] = maskPhone(value);
      } else if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token')
      ) {
        result[key] = '********';
      } else if (lowerKey.includes('key') && value.length > 8) {
        result[key] = maskApiKey(value);
      } else if (lowerKey.includes('card')) {
        result[key] = maskCreditCard(value);
      } else {
        result[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
