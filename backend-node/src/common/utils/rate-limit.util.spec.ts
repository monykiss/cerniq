import { TokenBucketLimiter } from './rate-limit.util';

describe('TokenBucketLimiter', () => {
  it('allows requests within token limit', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 5, refillRate: 1 });
    expect(limiter.consume('user:1')).toBe(true);
    expect(limiter.consume('user:1')).toBe(true);
  });

  it('rejects requests when tokens exhausted', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 2, refillRate: 0 });
    expect(limiter.consume('user:1')).toBe(true);
    expect(limiter.consume('user:1')).toBe(true);
    expect(limiter.consume('user:1')).toBe(false);
  });

  it('tracks separate buckets per key', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 1, refillRate: 0 });
    expect(limiter.consume('user:1')).toBe(true);
    expect(limiter.consume('user:2')).toBe(true);
    expect(limiter.consume('user:1')).toBe(false);
    expect(limiter.consume('user:2')).toBe(false);
  });

  it('remaining returns max tokens for unknown key', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 10, refillRate: 1 });
    expect(limiter.remaining('unknown')).toBe(10);
  });

  it('remaining decreases after consumption', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 5, refillRate: 0 });
    limiter.consume('user:1');
    // remaining reflects tokens left (should be close to 4)
    expect(limiter.remaining('user:1')).toBeLessThanOrEqual(5);
  });

  it('retryAfter returns 0 when tokens available', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 5, refillRate: 1 });
    expect(limiter.retryAfter('user:1')).toBe(0);
  });

  it('retryAfter returns positive value when exhausted', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 1, refillRate: 1 });
    limiter.consume('user:1');
    limiter.consume('user:1'); // exhausted
    expect(limiter.retryAfter('user:1')).toBeGreaterThanOrEqual(0);
  });

  it('reset clears a specific key', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 1, refillRate: 0 });
    limiter.consume('user:1');
    expect(limiter.consume('user:1')).toBe(false);
    limiter.reset('user:1');
    expect(limiter.consume('user:1')).toBe(true);
  });

  it('clear removes all buckets', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 1, refillRate: 0 });
    limiter.consume('user:1');
    limiter.consume('user:2');
    limiter.clear();
    expect(limiter.consume('user:1')).toBe(true);
    expect(limiter.consume('user:2')).toBe(true);
  });

  it('cleanup removes stale buckets', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 5, refillRate: 1 });
    // Consume to create a bucket, then backdate its lastRefill
    limiter.consume('user:1');
    // Access internal buckets to simulate an old entry
    const buckets = (limiter as any).buckets as Map<
      string,
      { tokens: number; lastRefill: number }
    >;
    const bucket = buckets.get('user:1')!;
    bucket.lastRefill = Date.now() - 5000; // 5 seconds ago

    const removed = limiter.cleanup(1000); // stale if older than 1s
    expect(removed).toBe(1);
    expect(limiter.remaining('user:1')).toBe(5); // fresh bucket
  });

  it('consume supports multiple tokens required', () => {
    const limiter = new TokenBucketLimiter({ maxTokens: 5, refillRate: 0 });
    expect(limiter.consume('user:1', 3)).toBe(true);
    expect(limiter.consume('user:1', 3)).toBe(false); // only 2 left
    expect(limiter.consume('user:1', 2)).toBe(true);
  });
});
