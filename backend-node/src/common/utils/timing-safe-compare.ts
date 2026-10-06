import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string compare. Prevents character-by-character timing
 * attacks that `===` / `!==` are vulnerable to when comparing secrets
 * (admin keys, webhook signatures, one-time tokens).
 *
 * Length mismatch short-circuits to `false` without calling
 * `timingSafeEqual` because Node throws on unequal-length buffers. The
 * length itself is not a secret for fixed-size admin keys, and the
 * short-circuit cost is negligible compared to the cost of an observable
 * byte-level timing channel.
 */
export function timingSafeStringEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
