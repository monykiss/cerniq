import {
  withTimeout,
  withRetry,
  settleAll,
  mapConcurrent,
  sleep,
} from './promise.util';

describe('promise.util', () => {
  // ── withTimeout ───────────────────────────────────────────────

  describe('withTimeout', () => {
    it('resolves if promise completes within timeout', async () => {
      const result = await withTimeout(Promise.resolve('fast'), 1000);
      expect(result).toBe('fast');
    });

    it('rejects with default message when promise exceeds timeout', async () => {
      const slow = new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        if (timer.unref) timer.unref();
      });
      await expect(withTimeout(slow, 10)).rejects.toThrow(
        'Operation timed out',
      );
    });

    it('rejects with custom message when provided', async () => {
      const slow = new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        if (timer.unref) timer.unref();
      });
      await expect(withTimeout(slow, 10, 'Too slow!')).rejects.toThrow(
        'Too slow!',
      );
    });

    it('propagates the original promise rejection', async () => {
      const failing = Promise.reject(new Error('original error'));
      await expect(withTimeout(failing, 1000)).rejects.toThrow(
        'original error',
      );
    });

    it('clears the timer after resolution', async () => {
      const val = await withTimeout(Promise.resolve('ok'), 500);
      expect(val).toBe('ok');
    });
  });

  // ── withRetry ─────────────────────────────────────────────────

  describe('withRetry', () => {
    it('returns result on first successful attempt', async () => {
      const fn = jest.fn().mockResolvedValue('done');
      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds on later attempt', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after maxAttempts exhausted', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      await expect(
        withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
      ).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws when maxAttempts is 0 (loop never executes)', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      let threw = false;
      try {
        await withRetry(fn, { maxAttempts: 0, baseDelayMs: 1 });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(fn).not.toHaveBeenCalled();
    });

    it('stops early when shouldRetry returns false', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fatal'));
      await expect(
        withRetry(fn, {
          maxAttempts: 5,
          baseDelayMs: 1,
          shouldRetry: () => false,
        }),
      ).rejects.toThrow('fatal');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('wraps non-Error throws into Error objects', async () => {
      const fn = jest.fn().mockRejectedValue('string error');
      await expect(
        withRetry(fn, { maxAttempts: 1, baseDelayMs: 1 }),
      ).rejects.toThrow('string error');
    });

    it('respects maxDelayMs cap', async () => {
      const start = Date.now();
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 15,
      });
      expect(Date.now() - start).toBeLessThan(200);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('uses defaults when no options provided', async () => {
      const fn = jest.fn().mockResolvedValue('value');
      const result = await withRetry(fn);
      expect(result).toBe('value');
    });
  });

  // ── settleAll ─────────────────────────────────────────────────

  describe('settleAll', () => {
    it('separates fulfilled and rejected results', async () => {
      const results = await settleAll([
        Promise.resolve('ok'),
        Promise.reject(new Error('fail')),
        Promise.resolve('also ok'),
      ]);
      expect(results.fulfilled).toEqual(['ok', 'also ok']);
      expect(results.rejected).toHaveLength(1);
      expect(results.rejected[0].message).toBe('fail');
    });

    it('returns all fulfilled values when none reject', async () => {
      const { fulfilled, rejected } = await settleAll([
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
      ]);
      expect(fulfilled).toEqual([1, 2, 3]);
      expect(rejected).toEqual([]);
    });

    it('returns all rejected errors when none fulfill', async () => {
      const { fulfilled, rejected } = await settleAll([
        Promise.reject(new Error('a')),
        Promise.reject(new Error('b')),
      ]);
      expect(fulfilled).toEqual([]);
      expect(rejected).toHaveLength(2);
      expect(rejected[0].message).toBe('a');
      expect(rejected[1].message).toBe('b');
    });

    it('wraps non-Error rejections into Error objects', async () => {
      const { rejected } = await settleAll([Promise.reject('string reason')]);
      expect(rejected[0]).toBeInstanceOf(Error);
      expect(rejected[0].message).toBe('string reason');
    });

    it('handles empty array', async () => {
      const { fulfilled, rejected } = await settleAll([]);
      expect(fulfilled).toEqual([]);
      expect(rejected).toEqual([]);
    });
  });

  // ── mapConcurrent ─────────────────────────────────────────────

  describe('mapConcurrent', () => {
    it('maps items with bounded concurrency', async () => {
      const items = [1, 2, 3];
      const results = await mapConcurrent(items, 2, async (n) => n * 2);
      expect(results).toEqual([2, 4, 6]);
    });

    it('provides correct index to the callback', async () => {
      const indices: number[] = [];
      await mapConcurrent([10, 20, 30], 2, async (_item, idx) => {
        indices.push(idx);
        return idx;
      });
      expect(indices.sort()).toEqual([0, 1, 2]);
    });

    it('respects concurrency limit', async () => {
      let running = 0;
      let maxRunning = 0;
      const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await sleep(10);
        running--;
        return item;
      });
      expect(maxRunning).toBeLessThanOrEqual(2);
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles empty array', async () => {
      const result = await mapConcurrent([], 5, async (item) => item);
      expect(result).toEqual([]);
    });

    it('works when concurrency exceeds items count', async () => {
      const result = await mapConcurrent([1, 2], 100, async (item) => item + 1);
      expect(result).toEqual([2, 3]);
    });
  });

  // ── sleep ─────────────────────────────────────────────────────

  describe('sleep', () => {
    it('resolves after the specified delay', async () => {
      const start = Date.now();
      await sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(30);
    });
  });
});
