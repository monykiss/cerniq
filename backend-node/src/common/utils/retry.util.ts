import { Logger } from '@nestjs/common';

const logger = new Logger('RetryUtil');

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Optional predicate to decide if error is retryable */
  retryIf?: (error: any) => boolean;
}

/**
 * Generic retry utility with exponential backoff.
 * Retries a function up to maxAttempts times with increasing delays.
 * Supports custom retry predicates for selective retry logic.
 *
 * @example
 * ```typescript
 * const result = await retry(() => fetchExternalApi(), {
 *   maxAttempts: 5,
 *   initialDelayMs: 500,
 * });
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    retryIf,
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (retryIf && !retryIf(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      const delay = Math.min(
        initialDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs,
      );
      const jitter = delay * 0.1 * Math.random();

      logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay + jitter)}ms: ${error?.message || error}`,
      );

      await sleep(delay + jitter);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
