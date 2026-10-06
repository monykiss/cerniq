import {
  verifyWebhookSignature,
  signWebhookPayload,
} from './webhook-signature.util';

describe('webhook-signature.util', () => {
  const secret = 'test-webhook-secret';
  const payload = '{"event":"test","data":{"id":1}}';

  describe('signWebhookPayload', () => {
    it('returns signature and timestamp', () => {
      const result = signWebhookPayload(payload, secret);
      expect(result.signature).toMatch(/^sha256=[a-f0-9]+$/);
      expect(result.timestamp).toMatch(/^\d+$/);
    });

    it('produces consistent signatures for same input', () => {
      const r1 = signWebhookPayload('test', secret);
      const r2 = signWebhookPayload('test', secret);
      // Same timestamp window = same signature
      if (r1.timestamp === r2.timestamp) {
        expect(r1.signature).toBe(r2.signature);
      }
    });
  });

  describe('verifyWebhookSignature', () => {
    it('verifies a valid signature', () => {
      const { signature, timestamp } = signWebhookPayload(payload, secret);
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret,
        timestamp,
      });
      expect(valid).toBe(true);
    });

    it('rejects wrong signature', () => {
      const { timestamp } = signWebhookPayload(payload, secret);
      const valid = verifyWebhookSignature({
        payload,
        signature:
          'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        secret,
        timestamp,
      });
      expect(valid).toBe(false);
    });

    it('rejects wrong secret', () => {
      const { signature, timestamp } = signWebhookPayload(payload, secret);
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret: 'wrong-secret',
        timestamp,
      });
      expect(valid).toBe(false);
    });

    it('rejects tampered payload', () => {
      const { signature, timestamp } = signWebhookPayload(payload, secret);
      const valid = verifyWebhookSignature({
        payload: payload + 'tampered',
        signature,
        secret,
        timestamp,
      });
      expect(valid).toBe(false);
    });

    it('rejects stale timestamps (replay protection)', () => {
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const { signature } = signWebhookPayload(payload, secret);
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret,
        timestamp: staleTimestamp,
        maxAgeSeconds: 300,
      });
      expect(valid).toBe(false);
    });

    it('works without timestamp (no replay protection)', () => {
      const sig = require('crypto')
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      const valid = verifyWebhookSignature({
        payload,
        signature: sig,
        secret,
      });
      expect(valid).toBe(true);
    });

    it('handles prefixed signatures (sha256=...)', () => {
      const { signature, timestamp } = signWebhookPayload(payload, secret);
      expect(signature.startsWith('sha256=')).toBe(true);
      const valid = verifyWebhookSignature({
        payload,
        signature,
        secret,
        timestamp,
      });
      expect(valid).toBe(true);
    });

    it('rejects length-mismatched signatures gracefully', () => {
      const valid = verifyWebhookSignature({
        payload,
        signature: 'abc',
        secret,
      });
      expect(valid).toBe(false);
    });

    it('returns false when non-hex signature causes timingSafeEqual to throw', () => {
      const crypto = require('crypto');
      const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      // Same string length but all non-hex chars → buffer size mismatch → timingSafeEqual throws
      const badSig = 'z'.repeat(expected.length);
      const valid = verifyWebhookSignature({
        payload,
        signature: badSig,
        secret,
      });
      expect(valid).toBe(false);
    });
  });
});
