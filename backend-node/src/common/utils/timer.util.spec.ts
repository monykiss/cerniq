import { createTimer, measureSync, measureAsync } from './timer.util';

describe('timer.util', () => {
  describe('createTimer', () => {
    it('returns a stop function that produces timing results', () => {
      const stop = createTimer();
      const result = stop();
      expect(result).toHaveProperty('ms');
      expect(result).toHaveProperty('us');
      expect(result).toHaveProperty('ns');
      expect(result).toHaveProperty('formatted');
      expect(typeof result.ms).toBe('number');
      expect(typeof result.ns).toBe('bigint');
    });

    it('measures elapsed time (ms > 0 after delay)', () => {
      const stop = createTimer();
      // Busy wait ~1ms
      const start = Date.now();
      while (Date.now() - start < 2) {
        /* spin */
      }
      const result = stop();
      expect(result.ms).toBeGreaterThan(0);
    });

    it('formats short durations', () => {
      const stop = createTimer();
      const result = stop();
      expect(result.formatted).toMatch(/(ms|us|s)$/);
    });
  });

  describe('measureSync', () => {
    it('returns the function result and timing', () => {
      const { result, timing } = measureSync(() => 42);
      expect(result).toBe(42);
      expect(timing.ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('measureAsync', () => {
    it('returns the async function result and timing', async () => {
      const { result, timing } = await measureAsync(async () => 'done');
      expect(result).toBe('done');
      expect(timing.ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatted output', () => {
    it('formats time >= 1000ms as seconds', () => {
      const originalHrtime = process.hrtime.bigint;
      let callCount = 0;
      process.hrtime.bigint = () => {
        callCount++;
        // First call (start) returns 0, second call (stop) returns 2 seconds in ns
        return callCount === 1 ? BigInt(0) : BigInt(2_000_000_000);
      };

      const stop = createTimer();
      const result = stop();
      expect(result.formatted).toMatch(/s$/);
      expect(result.formatted).toContain('2.00');

      process.hrtime.bigint = originalHrtime;
    });
  });
});
