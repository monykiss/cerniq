import {
  generateSecureToken,
  generateUrlSafeToken,
  createHmacSignature,
  verifyHmacSignature,
  generateOtp,
  sha256,
} from './crypto.util';

describe('generateSecureToken', () => {
  it('generates a hex string of expected length', () => {
    const token = generateSecureToken(16);
    expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
  });

  it('defaults to 32 bytes (64 hex chars)', () => {
    const token = generateSecureToken();
    expect(token).toHaveLength(64);
  });

  it('generates unique tokens each call', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toBe(b);
  });

  it('produces only hex characters', () => {
    const token = generateSecureToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
  });
});

describe('generateUrlSafeToken', () => {
  it('generates a URL-safe string', () => {
    const token = generateUrlSafeToken(32);
    // base64url chars: A-Z, a-z, 0-9, -, _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('respects length parameter', () => {
    const token = generateUrlSafeToken(16);
    expect(token).toHaveLength(16);
  });

  it('generates unique tokens', () => {
    const a = generateUrlSafeToken();
    const b = generateUrlSafeToken();
    expect(a).not.toBe(b);
  });
});

describe('createHmacSignature', () => {
  it('creates a deterministic HMAC for the same input', () => {
    const sig1 = createHmacSignature('hello', 'secret');
    const sig2 = createHmacSignature('hello', 'secret');
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different payloads', () => {
    const sig1 = createHmacSignature('hello', 'secret');
    const sig2 = createHmacSignature('world', 'secret');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different secrets', () => {
    const sig1 = createHmacSignature('hello', 'secret1');
    const sig2 = createHmacSignature('hello', 'secret2');
    expect(sig1).not.toBe(sig2);
  });

  it('returns a hex string', () => {
    const sig = createHmacSignature('data', 'key');
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });
});

describe('verifyHmacSignature', () => {
  it('returns true for valid signature', () => {
    const sig = createHmacSignature('payload', 'secret');
    expect(verifyHmacSignature('payload', 'secret', sig)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    expect(verifyHmacSignature('payload', 'secret', 'badsignature')).toBe(
      false,
    );
  });

  it('returns false for wrong secret', () => {
    const sig = createHmacSignature('payload', 'secret1');
    expect(verifyHmacSignature('payload', 'secret2', sig)).toBe(false);
  });

  it('returns false for tampered payload', () => {
    const sig = createHmacSignature('original', 'secret');
    expect(verifyHmacSignature('tampered', 'secret', sig)).toBe(false);
  });

  it('returns false for mismatched length signatures', () => {
    expect(verifyHmacSignature('payload', 'secret', 'short')).toBe(false);
  });
});

describe('generateOtp', () => {
  it('generates a 6-digit code by default', () => {
    const otp = generateOtp();
    expect(otp).toHaveLength(6);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('pads with leading zeros', () => {
    // Call multiple times; at least the format should always be correct
    for (let i = 0; i < 10; i++) {
      const otp = generateOtp(6);
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it('supports custom digit count', () => {
    const otp = generateOtp(4);
    expect(otp).toHaveLength(4);
    expect(otp).toMatch(/^\d{4}$/);
  });
});

describe('sha256', () => {
  it('produces a 64-char hex string', () => {
    const hash = sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256('test')).toBe(sha256('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('hello')).not.toBe(sha256('world'));
  });
});

describe('verifyHmacSignature catch path', () => {
  it('returns false when signature contains non-hex chars causing buffer mismatch', () => {
    const {
      verifyHmacSignature,
      createHmacSignature,
    } = require('./crypto.util');
    const expected = createHmacSignature('test', 'secret');
    // Same string length but all non-hex chars → Buffer.from produces 0 bytes → timingSafeEqual throws
    const badSig = 'z'.repeat(expected.length);
    expect(verifyHmacSignature('test', 'secret', badSig)).toBe(false);
  });
});
