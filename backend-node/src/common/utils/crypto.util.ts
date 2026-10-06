import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

/**
 * Secure token generation and cryptographic utilities.
 * Uses Node.js crypto module for cryptographically secure operations.
 */

/**
 * Generate a cryptographically secure random token.
 * @param length - Number of random bytes (output will be hex-encoded, so 2x chars)
 */
export function generateSecureToken(length = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Generate a URL-safe random token (base64url encoding).
 * @param length - Number of random bytes
 */
export function generateUrlSafeToken(length = 32): string {
  return randomBytes(length).toString('base64url').substring(0, length);
}

/**
 * Generate an HMAC-SHA256 signature.
 * Useful for webhook verification and signed URLs.
 */
export function createHmacSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify an HMAC signature using timing-safe comparison.
 * Prevents timing attacks when comparing signatures.
 */
export function verifyHmacSignature(
  payload: string,
  secret: string,
  signature: string,
): boolean {
  const expected = createHmacSignature(payload, secret);
  if (expected.length !== signature.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Generate a short numeric OTP code.
 * @param digits - Number of digits (default: 6)
 */
export function generateOtp(digits = 6): string {
  const max = Math.pow(10, digits);
  const randomNum = parseInt(randomBytes(4).toString('hex'), 16) % max;
  return randomNum.toString().padStart(digits, '0');
}

/**
 * Hash a value using SHA-256 (non-reversible).
 * Useful for creating fingerprints or content hashes.
 */
export function sha256(input: string): string {
  return createHmac('sha256', '').update(input).digest('hex');
}
