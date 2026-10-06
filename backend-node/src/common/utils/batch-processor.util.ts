import { Logger } from '@nestjs/common';

const logger = new Logger('BatchProcessor');

/**
 * Generic batch processor for large datasets.
 * Processes items in configurable chunks to avoid memory exhaustion
 * and database connection pool saturation.
 */

export interface BatchOptions {
  /** Number of items per batch (default: 100) */
  batchSize?: number;
  /** Delay between batches in ms (default: 0) */
  delayBetweenBatchesMs?: number;
  /** Whether to continue on error (default: false) */
  continueOnError?: boolean;
  /** Optional progress callback */
  onProgress?: (processed: number, total: number) => void;
}

export interface BatchResult<T> {
  successful: T[];
  failed: Array<{ item: any; error: Error }>;
  totalProcessed: number;
  totalFailed: number;
  durationMs: number;
}

/**
 * Process a large array in batches with error handling.
 *
 * @example
 * const result = await processBatch(users, async (batch) => {
 *   return prisma.user.createMany({ data: batch });
 * }, { batchSize: 50 });
 */
export async function processBatch<TInput, TOutput>(
  items: TInput[],
  processor: (batch: TInput[]) => Promise<TOutput[]>,
  options: BatchOptions = {},
): Promise<BatchResult<TOutput>> {
  const {
    batchSize = 100,
    delayBetweenBatchesMs = 0,
    continueOnError = false,
    onProgress,
  } = options;

  const start = Date.now();
  const successful: TOutput[] = [];
  const failed: Array<{ item: any; error: Error }> = [];

  const totalBatches = Math.ceil(items.length / batchSize);
  logger.debug(
    `Processing ${items.length} items in ${totalBatches} batches of ${batchSize}`,
  );

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      const results = await processor(batch);
      successful.push(...results);
    } catch (error: any) {
      logger.error(
        `Batch ${batchNum}/${totalBatches} failed: ${error.message}`,
      );
      if (continueOnError) {
        failed.push(...batch.map((item) => ({ item, error })));
      } else {
        throw error;
      }
    }

    const processed = Math.min(i + batchSize, items.length);
    onProgress?.(processed, items.length);

    if (delayBetweenBatchesMs > 0 && i + batchSize < items.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, delayBetweenBatchesMs),
      );
    }
  }

  return {
    successful,
    failed,
    totalProcessed: successful.length + failed.length,
    totalFailed: failed.length,
    durationMs: Date.now() - start,
  };
}
