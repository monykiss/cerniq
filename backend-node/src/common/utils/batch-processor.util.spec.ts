import { processBatch } from './batch-processor.util';

describe('processBatch', () => {
  it('processes all items in batches', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = jest.fn(async (batch: number[]) =>
      batch.map((n) => n * 2),
    );

    const result = await processBatch(items, processor, { batchSize: 2 });

    expect(result.successful).toEqual([2, 4, 6, 8, 10]);
    expect(result.totalProcessed).toBe(5);
    expect(result.totalFailed).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // 5 items with batchSize 2 = 3 batches
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it('uses default batch size of 100', async () => {
    const items = Array.from({ length: 150 }, (_, i) => i);
    const processor = jest.fn(async (batch: number[]) => batch);

    await processBatch(items, processor);

    expect(processor).toHaveBeenCalledTimes(2); // 100 + 50
  });

  it('handles empty input', async () => {
    const processor = jest.fn(async (batch: number[]) => batch);
    const result = await processBatch([], processor);

    expect(result.successful).toEqual([]);
    expect(result.totalProcessed).toBe(0);
    expect(processor).not.toHaveBeenCalled();
  });

  it('throws on error when continueOnError is false', async () => {
    const items = [1, 2, 3];
    const processor = jest.fn(async () => {
      throw new Error('batch failed');
    });

    await expect(
      processBatch(items, processor, { batchSize: 2 }),
    ).rejects.toThrow('batch failed');
  });

  it('continues on error when continueOnError is true', async () => {
    const items = [1, 2, 3, 4];
    let callCount = 0;
    const processor = jest.fn(async (batch: number[]) => {
      callCount++;
      if (callCount === 1) throw new Error('first batch failed');
      return batch.map((n) => n * 10);
    });

    const result = await processBatch(items, processor, {
      batchSize: 2,
      continueOnError: true,
    });

    expect(result.successful).toEqual([30, 40]);
    expect(result.totalFailed).toBe(2);
    expect(result.failed.length).toBe(2);
  });

  it('calls onProgress callback', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = jest.fn(async (batch: number[]) => batch);
    const onProgress = jest.fn();

    await processBatch(items, processor, { batchSize: 2, onProgress });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith(2, 5);
    expect(onProgress).toHaveBeenCalledWith(4, 5);
    expect(onProgress).toHaveBeenCalledWith(5, 5);
  });

  // ── Coverage boost: delay between batches ─────────────────────
  it('applies delay between batches when configured', async () => {
    const items = [1, 2, 3];
    const processor = jest.fn(async (batch: number[]) => batch);

    const start = Date.now();
    const result = await processBatch(items, processor, {
      batchSize: 2,
      delayBetweenBatchesMs: 10,
    });
    const elapsed = Date.now() - start;

    expect(result.successful).toEqual([1, 2, 3]);
    // Should have at least ~10ms delay between the two batches
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(5);
  });

  it('records failed items with error details when continueOnError', async () => {
    const items = [1, 2];
    const err = new Error('test error');
    const processor = jest.fn(async () => {
      throw err;
    });

    const result = await processBatch(items, processor, {
      batchSize: 2,
      continueOnError: true,
    });

    expect(result.totalFailed).toBe(2);
    expect(result.failed[0].error).toBe(err);
    expect(result.failed[0].item).toBe(1);
    expect(result.failed[1].item).toBe(2);
  });

  it('does not delay after last batch', async () => {
    const items = [1, 2];
    const processor = jest.fn(async (batch: number[]) => batch);

    const start = Date.now();
    await processBatch(items, processor, {
      batchSize: 2,
      delayBetweenBatchesMs: 500, // large delay that should NOT apply (single batch)
    });
    const elapsed = Date.now() - start;

    // Should complete quickly since there's only one batch
    expect(elapsed).toBeLessThan(400);
  });

  it('samples overflow: processes more than 10000 items', async () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const processor = jest.fn(async (batch: number[]) =>
      batch.map((n) => n * 2),
    );
    const result = await processBatch(items, processor, { batchSize: 5 });
    expect(result.successful).toEqual([0, 2, 4, 6, 8]);
    expect(result.totalProcessed).toBe(5);
  });
});
