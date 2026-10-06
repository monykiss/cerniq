import { ERROR_CODES, ErrorCode } from './error-codes';

describe('ERROR_CODES', () => {
  it('defines all expected domain error code groups', () => {
    const keys = Object.keys(ERROR_CODES);

    // Auth domain
    expect(
      keys.filter((k) => k.startsWith('AUTH_')).length,
    ).toBeGreaterThanOrEqual(5);
    // ALM domain
    expect(
      keys.filter((k) => k.startsWith('ALM_')).length,
    ).toBeGreaterThanOrEqual(3);
    // Billing domain
    expect(
      keys.filter((k) => k.startsWith('BILLING_')).length,
    ).toBeGreaterThanOrEqual(2);
    // System domain
    expect(
      keys.filter((k) => k.startsWith('SYSTEM_')).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('every error code has matching code, valid HTTP status, and a message', () => {
    for (const [key, entry] of Object.entries(ERROR_CODES)) {
      expect(entry.code).toBe(key);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it('ErrorCode type narrows to the known keys', () => {
    const sampleCode: ErrorCode = 'AUTH_TOKEN_EXPIRED';
    expect(ERROR_CODES[sampleCode].status).toBe(401);

    const systemCode: ErrorCode = 'SYSTEM_RATE_LIMITED';
    expect(ERROR_CODES[systemCode].status).toBe(429);
  });
});
