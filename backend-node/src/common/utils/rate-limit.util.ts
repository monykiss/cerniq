/**
 * Token bucket rate limiter utility.
 * In-memory implementation for per-key rate limiting.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface TokenBucketOptions {
  /** Maximum number of tokens in the bucket */
  maxTokens: number;
  /** Number of tokens added per second */
  refillRate: number;
}

/**
 * Token bucket rate limiter.
 * Each key gets its own bucket that refills at a constant rate.
 *
 * @example
 * const limiter = new TokenBucketLimiter({ maxTokens: 10, refillRate: 1 });
 * if (limiter.consume('user:123')) {
 *   // Request allowed
 * } else {
 *   // Rate limited
 * }
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(options: TokenBucketOptions) {
    this.maxTokens = options.maxTokens;
    this.refillRate = options.refillRate;
  }

  /**
   * Try to consume a token for the given key.
   * Returns true if the request is allowed, false if rate limited.
   */
  consume(key: string, tokensRequired = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsed * this.refillRate,
    );
    bucket.lastRefill = now;

    if (bucket.tokens >= tokensRequired) {
      bucket.tokens -= tokensRequired;
      return true;
    }

    return false;
  }

  /**
   * Get the number of remaining tokens for a key.
   */
  remaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.maxTokens;

    const elapsed = (Date.now() - bucket.lastRefill) / 1000;
    return Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
  }

  /**
   * Get the time in seconds until the next token is available.
   */
  retryAfter(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.tokens >= 1) return 0;

    const tokensNeeded = 1 - bucket.tokens;
    return Math.ceil(tokensNeeded / this.refillRate);
  }

  /**
   * Reset a specific key's bucket.
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Clear all buckets. Useful for testing or periodic cleanup.
   */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Remove stale buckets that haven't been used recently.
   * Call periodically to prevent memory leaks.
   */
  cleanup(maxAgeMs = 3600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
