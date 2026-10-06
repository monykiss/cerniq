/**
 * High-resolution timer utility for performance profiling.
 * Uses process.hrtime.bigint() for nanosecond precision.
 */

export interface TimerResult {
  /** Duration in milliseconds */
  ms: number;
  /** Duration in microseconds */
  us: number;
  /** Duration in nanoseconds */
  ns: bigint;
  /** Human-readable formatted duration */
  formatted: string;
}

/**
 * Create a high-resolution timer.
 * Call the returned function to stop the timer and get results.
 *
 * @example
 * const stop = createTimer();
 * await someOperation();
 * const result = stop();
 * console.log(result.formatted); // "123.45ms"
 */
export function createTimer(): () => TimerResult {
  const start = process.hrtime.bigint();

  return (): TimerResult => {
    const ns = process.hrtime.bigint() - start;
    const us = Number(ns) / 1_000;
    const ms = Number(ns) / 1_000_000;

    let formatted: string;
    if (ms >= 1000) {
      formatted = `${(ms / 1000).toFixed(2)}s`;
    } else if (ms >= 1) {
      formatted = `${ms.toFixed(2)}ms`;
    } else {
      formatted = `${us.toFixed(2)}us`;
    }

    return { ms, us, ns, formatted };
  };
}

/**
 * Measure the execution time of an async function.
 */
export async function measureAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; timing: TimerResult }> {
  const stop = createTimer();
  const result = await fn();
  const timing = stop();
  return { result, timing };
}

/**
 * Measure the execution time of a sync function.
 */
export function measureSync<T>(fn: () => T): {
  result: T;
  timing: TimerResult;
} {
  const stop = createTimer();
  const result = fn();
  const timing = stop();
  return { result, timing };
}
