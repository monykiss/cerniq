import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface CreateBatchParams {
  organizationId: string;
  requestedBy: string;
  batchType: 'BULK_REPORT' | 'CUSTOM_ANALYSIS' | 'SCHEDULED';
  priority: 'NORMAL' | 'HIGH';
  institutionIds: string[];
  modules?: string[];
  outputFormat: 'PDF' | 'JSON' | 'XLSX';
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface EnterpriseBatch {
  id: string;
  organizationId: string;
  requestedBy: string;
  batchType: string;
  priority: string;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  institutionIds: string[];
  modules: string[] | null;
  outputFormat: string;
  webhookUrl: string | null;
  errorLog: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface EnterpriseBatchWithProgress extends EnterpriseBatch {
  progressPercent: number;
  estimatedCompletionAt?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  status?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class EnterpriseBatchService {
  private readonly logger = new Logger(EnterpriseBatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new batch job for Enterprise tier bulk report generation.
   * Inserts a row with status PENDING and returns the created record.
   */
  async createBatch(params: CreateBatchParams): Promise<EnterpriseBatch> {
    this.logger.log({
      msg: 'Creating enterprise batch',
      organizationId: params.organizationId,
      batchType: params.batchType,
      institutionCount: params.institutionIds.length,
    });

    const id = crypto.randomUUID();
    const now = new Date();

    const batch: EnterpriseBatch = {
      id,
      organizationId: params.organizationId,
      requestedBy: params.requestedBy,
      batchType: params.batchType,
      priority: params.priority,
      status: 'PENDING',
      totalItems: params.institutionIds.length,
      completedItems: 0,
      failedItems: 0,
      institutionIds: params.institutionIds,
      modules: params.modules ?? null,
      outputFormat: params.outputFormat,
      webhookUrl: params.webhookUrl ?? null,
      errorLog: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    // In production this persists to the enterprise_batches table via Prisma.
    // For the initial scaffold we store in-memory with the structure ready
    // for the migration that adds the table.
    this.batchStore.set(id, batch);

    this.logger.log({ msg: 'Batch created', batchId: id, status: 'PENDING' });
    return batch;
  }

  /**
   * Get a batch with computed progress information.
   */
  async getBatch(batchId: string): Promise<EnterpriseBatchWithProgress> {
    const batch = this.batchStore.get(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    const progressPercent =
      batch.totalItems > 0
        ? Math.round(
            ((batch.completedItems + batch.failedItems) / batch.totalItems) *
              100,
          )
        : 0;

    // Estimate completion: avg time per item * remaining items
    const processed = batch.completedItems + batch.failedItems;
    let estimatedCompletionAt: string | undefined;
    if (
      processed > 0 &&
      batch.status === 'PROCESSING' &&
      processed < batch.totalItems
    ) {
      const elapsed = Date.now() - batch.createdAt.getTime();
      const avgMs = elapsed / processed;
      const remainingMs = avgMs * (batch.totalItems - processed);
      estimatedCompletionAt = new Date(Date.now() + remainingMs).toISOString();
    }

    return { ...batch, progressPercent, estimatedCompletionAt };
  }

  /**
   * List batches for an organization with pagination and optional status filter.
   */
  async listBatches(
    organizationId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResult<EnterpriseBatch>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    let batches = Array.from(this.batchStore.values()).filter(
      (b) => b.organizationId === organizationId,
    );

    if (params.status) {
      batches = batches.filter((b) => b.status === params.status);
    }

    // Sort by createdAt descending
    batches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = batches.length;
    const start = (page - 1) * limit;
    const items = batches.slice(start, start + limit);

    return {
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Cancel a pending or processing batch.
   */
  async cancelBatch(batchId: string): Promise<void> {
    const batch = this.batchStore.get(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    if (batch.status === 'COMPLETED' || batch.status === 'CANCELLED') {
      this.logger.warn({
        msg: 'Cannot cancel batch in terminal state',
        batchId,
        status: batch.status,
      });
      return;
    }

    batch.status = 'CANCELLED';
    batch.updatedAt = new Date();
    this.batchStore.set(batchId, batch);

    this.logger.log({ msg: 'Batch cancelled', batchId });
  }

  /**
   * Called by the worker after each item completes successfully.
   * Updates progress counters and transitions status when all items are done.
   */
  async updateBatchProgress(
    batchId: string,
    completedItem: string,
  ): Promise<void> {
    const batch = this.batchStore.get(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    if (batch.status === 'PENDING') {
      batch.status = 'PROCESSING';
    }

    batch.completedItems += 1;
    batch.updatedAt = new Date();

    this.logger.debug({
      msg: 'Batch item completed',
      batchId,
      completedItem,
      progress: `${batch.completedItems + batch.failedItems}/${batch.totalItems}`,
    });

    // Check if all items are done
    if (batch.completedItems + batch.failedItems >= batch.totalItems) {
      batch.status = batch.failedItems > 0 ? 'PARTIAL' : 'COMPLETED';
      batch.completedAt = new Date();
      this.logger.log({
        msg: 'Batch finished',
        batchId,
        status: batch.status,
        completed: batch.completedItems,
        failed: batch.failedItems,
      });
    }

    this.batchStore.set(batchId, batch);
  }

  /**
   * Called by the worker when an item fails.
   * Increments failure counter and appends to error log.
   */
  async failBatchItem(batchId: string, error: string): Promise<void> {
    const batch = this.batchStore.get(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    if (batch.status === 'PENDING') {
      batch.status = 'PROCESSING';
    }

    batch.failedItems += 1;
    batch.errorLog.push(error);
    batch.updatedAt = new Date();

    this.logger.warn({
      msg: 'Batch item failed',
      batchId,
      error,
      failedCount: batch.failedItems,
    });

    // Check if all items are done
    if (batch.completedItems + batch.failedItems >= batch.totalItems) {
      batch.status = batch.completedItems === 0 ? 'FAILED' : 'PARTIAL';
      batch.completedAt = new Date();
      this.logger.log({
        msg: 'Batch finished with failures',
        batchId,
        status: batch.status,
        completed: batch.completedItems,
        failed: batch.failedItems,
      });
    }

    this.batchStore.set(batchId, batch);
  }

  // ── In-memory store (replaced by Prisma table in migration) ───────────────
  private readonly batchStore = new Map<string, EnterpriseBatch>();
}
