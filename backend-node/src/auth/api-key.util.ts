import * as crypto from 'crypto';

const API_KEY_PREFIX = 'ck_live_';
const API_KEY_BYTES = 32;

export function generateApiKeyToken(): string {
  return `${API_KEY_PREFIX}${crypto.randomBytes(API_KEY_BYTES).toString('hex')}`;
}

export function apiKeyPrefix(token: string): string {
  return token.slice(0, 16);
}

function getPepper(): string {
  const pepper = (process.env.API_KEY_PEPPER || '').trim();
  if (!pepper || pepper.length < 32) {
    throw new Error(
      'API_KEY_PEPPER must be at least 32 characters. Set it in your environment.',
    );
  }
  return pepper;
}

export function hashApiKey(token: string): string {
  return crypto.createHmac('sha256', getPepper()).update(token).digest('hex');
}

export function hashApiKeyTimingSafe(token: string, expected: string): boolean {
  const computed = hashApiKey(token);
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

export function isReadOnlyMethod(method: string): boolean {
  const normalized = (method || '').toUpperCase();
  return (
    normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS'
  );
}
