import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Webhook signature verification utility.
 * Supports multiple webhook providers (Stripe, GitHub, custom HMAC).
 * Uses timing-safe comparison to prevent timing attacks.
 */

export interface WebhookVerifyOptions {
  /** The raw request body as a string or Buffer */
  payload: string | Buffer;
  /** The signature from the webhook header */
  signature: string;
  /** The shared secret for HMAC computation */
  secret: string;
  /** Signature algorithm (default: sha256) */
  algorithm?: string;
  /** Optional timestamp for replay protection */
  timestamp?: string;
  /** Max age in seconds for timestamp validation (default: 300) */
  maxAgeSeconds?: number;
}

/**
 * Verify a webhook signature using HMAC.
 * Returns true if the signature is valid.
 */
export function verifyWebhookSignature(options: WebhookVerifyOptions): boolean {
  const {
    payload,
    signature,
    secret,
    algorithm = 'sha256',
    timestamp,
    maxAgeSeconds = 300,
  } = options;

  // Replay protection: reject old webhooks
  if (timestamp) {
    const webhookTime = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - webhookTime) > maxAgeSeconds) {
      return false;
    }
  }

  const signedPayload = timestamp ? `${timestamp}.${payload}` : String(payload);
  const expected = createHmac(algorithm, secret)
    .update(signedPayload)
    .digest('hex');

  // Handle prefixed signatures (e.g., Stripe's "sha256=...")
  const cleanSignature = signature.includes('=')
    ? signature.split('=').pop() || ''
    : signature;

  if (expected.length !== cleanSignature.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(cleanSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Generate a webhook signature for outgoing webhooks.
 */
export function signWebhookPayload(
  payload: string | Buffer,
  secret: string,
  algorithm = 'sha256',
): { signature: string; timestamp: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${timestamp}.${payload}`;

  const signature = createHmac(algorithm, secret)
    .update(signedPayload)
    .digest('hex');

  return {
    signature: `${algorithm}=${signature}`,
    timestamp,
  };
}
