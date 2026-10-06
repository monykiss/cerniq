import {
  EnterpriseBatchService,
  CreateBatchParams,
} from './enterprise-batch.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

describe('EnterpriseBatchService', () => {
  let service: EnterpriseBatchService;
  const mockPrisma = {} as any;

  const defaultParams: CreateBatchParams = {
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    requestedBy: 'api-key-test-user',
    batchType: 'BULK_REPORT',
    priority: 'NORMAL',
    institutionIds: ['inst-1', 'inst-2', 'inst-3'],
    outputFormat: 'PDF',
  };

  beforeEach(() => {
    service = new EnterpriseBatchService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Batch creation ──────────────────────────────────────────────────────

  it('creates a batch with PENDING status', async () => {
    const batch = await service.createBatch(defaultParams);

    expect(batch.id).toBeDefined();
    expect(batch.status).toBe('PENDING');
    expect(batch.totalItems).toBe(3);
    expect(batch.completedItems).toBe(0);
    expect(batch.failedItems).toBe(0);
    expect(batch.organizationId).toBe(defaultParams.organizationId);
    expect(batch.batchType).toBe('BULK_REPORT');
    expect(batch.outputFormat).toBe('PDF');
    expect(batch.errorLog).toEqual([]);
    expect(batch.completedAt).toBeNull();
  });

  it('stores optional modules and webhook URL', async () => {
    const batch = await service.createBatch({
      ...defaultParams,
      modules: ['duration', 'liquidity', 'nii'],
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret-at-least-16-chars',
    });

    expect(batch.modules).toEqual(['duration', 'liquidity', 'nii']);
    expect(batch.webhookUrl).toBe('https://example.com/webhook');
  });

  // ── Progress tracking ───────────────────────────────────────────────────

  it('tracks progress as items complete', async () => {
    const batch = await service.createBatch(defaultParams);

    await service.updateBatchProgress(batch.id, 'inst-1');
    const updated = await service.getBatch(batch.id);

    expect(updated.status).toBe('PROCESSING');
    expect(updated.completedItems).toBe(1);
    expect(updated.progressPercent).toBe(33); // 1/3 = 33%
  });

  it('marks batch COMPLETED when all items succeed', async () => {
    const batch = await service.createBatch(defaultParams);

    await service.updateBatchProgress(batch.id, 'inst-1');
    await service.updateBatchProgress(batch.id, 'inst-2');
    await service.updateBatchProgress(batch.id, 'inst-3');

    const final = await service.getBatch(batch.id);
    expect(final.status).toBe('COMPLETED');
    expect(final.progressPercent).toBe(100);
    expect(final.completedAt).toBeDefined();
  });

  it('marks batch PARTIAL when some items fail', async () => {
    const batch = await service.createBatch(defaultParams);

    await service.updateBatchProgress(batch.id, 'inst-1');
    await service.updateBatchProgress(batch.id, 'inst-2');
    await service.failBatchItem(batch.id, 'inst-3 timed out');

    const final = await service.getBatch(batch.id);
    expect(final.status).toBe('PARTIAL');
    expect(final.completedItems).toBe(2);
    expect(final.failedItems).toBe(1);
    expect(final.errorLog).toContain('inst-3 timed out');
  });

  it('marks batch FAILED when all items fail', async () => {
    const batch = await service.createBatch(defaultParams);

    await service.failBatchItem(batch.id, 'error 1');
    await service.failBatchItem(batch.id, 'error 2');
    await service.failBatchItem(batch.id, 'error 3');

    const final = await service.getBatch(batch.id);
    expect(final.status).toBe('FAILED');
    expect(final.failedItems).toBe(3);
    expect(final.completedItems).toBe(0);
  });

  // ── Cancellation ────────────────────────────────────────────────────────

  it('cancels a pending batch', async () => {
    const batch = await service.createBatch(defaultParams);

    await service.cancelBatch(batch.id);
    const cancelled = await service.getBatch(batch.id);

    expect(cancelled.status).toBe('CANCELLED');
  });

  it('does not cancel an already-completed batch', async () => {
    const batch = await service.createBatch({
      ...defaultParams,
      institutionIds: ['inst-1'],
    });

    await service.updateBatchProgress(batch.id, 'inst-1');
    await service.cancelBatch(batch.id);

    const result = await service.getBatch(batch.id);
    expect(result.status).toBe('COMPLETED');
  });

  it('throws NotFoundException for unknown batch ID', async () => {
    await expect(service.getBatch('nonexistent-id')).rejects.toThrow(
      'not found',
    );
  });

  // ── Pagination ──────────────────────────────────────────────────────────

  it('lists batches with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await service.createBatch({
        ...defaultParams,
        institutionIds: [`inst-${i}`],
      });
    }

    const page1 = await service.listBatches(defaultParams.organizationId, {
      page: 1,
      limit: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.page).toBe(1);
  });

  it('filters batches by status', async () => {
    const batch = await service.createBatch(defaultParams);
    await service.cancelBatch(batch.id);

    // Create another active batch
    await service.createBatch(defaultParams);

    const cancelled = await service.listBatches(defaultParams.organizationId, {
      status: 'CANCELLED',
    });
    expect(cancelled.items).toHaveLength(1);
    expect(cancelled.items[0].status).toBe('CANCELLED');
  });
});

describe('WebhookDeliveryService', () => {
  let service: WebhookDeliveryService;
  const mockPrisma = {} as any;

  beforeEach(() => {
    service = new WebhookDeliveryService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('computes HMAC-SHA256 signature correctly', () => {
    const secret = 'test-webhook-secret';
    const body = { batchId: 'batch-1', event: 'batch.completed' };

    const sig1 = service.computeSignature(secret, body);
    const sig2 = service.computeSignature(secret, body);

    // Deterministic
    expect(sig1).toBe(sig2);
    // Hex encoded SHA-256 = 64 chars
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different signatures for different secrets', () => {
    const body = { batchId: 'batch-1' };
    const sig1 = service.computeSignature('secret-a-long-enough', body);
    const sig2 = service.computeSignature('secret-b-long-enough', body);

    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different payloads', () => {
    const secret = 'shared-secret-value';
    const sig1 = service.computeSignature(secret, { event: 'a' });
    const sig2 = service.computeSignature(secret, { event: 'b' });

    expect(sig1).not.toBe(sig2);
  });

  it('returns empty delivery log for unknown batch', async () => {
    const logs = await service.getDeliveryLog('unknown-batch');
    expect(logs).toEqual([]);
  });
});
