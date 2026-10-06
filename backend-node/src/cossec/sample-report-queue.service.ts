import { Injectable, Logger } from '@nestjs/common';
import { SampleReportService } from './sample-report.service';
import { PrismaService } from '../prisma.service';
import type { QueueStatus } from './cossec.dto';

/**
 * In-memory priority queue for async sample report generation.
 *
 * Follows the same in-memory dispatch pattern as AgentQueueService
 * (see src/queue/agent/agent-queue.service.ts). When Redis is deployed
 * on the Railway stack this can be swapped to a @nestjs/bullmq processor
 * without changing the public interface.
 */

interface QueuedJob {
  prospectInstitutionId: string;
  priority: number;
  enqueuedAt: number;
}

@Injectable()
export class SampleReportQueueService {
  private readonly logger = new Logger(SampleReportQueueService.name);

  private readonly pending: QueuedJob[] = [];
  private processing = 0;
  private completedCount = 0;
  private failedCount = 0;
  private concurrency = 5;

  constructor(
    private readonly sampleReportService: SampleReportService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Enqueue all prospects ────────────────────────────────────────────────

  async enqueueAllProspects(
    concurrency?: number,
  ): Promise<{ jobCount: number }> {
    if (concurrency) this.concurrency = concurrency;

    const prospects = await this.prisma.prospectInstitution.findMany({
      where: { sampleReportGeneratedAt: null },
      select: { id: true },
    });

    this.logger.log(
      `Enqueuing ${prospects.length} prospects for sample report generation ` +
        `(concurrency=${this.concurrency})`,
    );

    for (const p of prospects) {
      const job: QueuedJob = {
        prospectInstitutionId: p.id,
        priority: 1, // normal priority
        enqueuedAt: Date.now(),
      };
      this.pending.push(job);
    }

    this.drain();

    return { jobCount: prospects.length };
  }

  // ── Enqueue single ──────────────────────────────────────────────────────

  async enqueueSingle(
    prospectInstitutionId: string,
    priority: 'normal' | 'high' = 'normal',
  ): Promise<string> {
    const job: QueuedJob = {
      prospectInstitutionId,
      priority: priority === 'high' ? 10 : 1,
      enqueuedAt: Date.now(),
    };

    // Insert in priority order
    const insertIdx = this.pending.findIndex((j) => j.priority < job.priority);
    if (insertIdx === -1) {
      this.pending.push(job);
    } else {
      this.pending.splice(insertIdx, 0, job);
    }

    this.drain();

    return `job:${prospectInstitutionId}:${job.enqueuedAt}`;
  }

  // ── Queue status ─────────────────────────────────────────────────────────

  getQueueStatus(): QueueStatus {
    return {
      waiting: this.pending.length,
      active: this.processing,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  // ── Internal drain loop ──────────────────────────────────────────────────

  private drain(): void {
    while (this.processing < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.processing += 1;
      // Fire-and-forget drain pattern; see agent-queue.service.ts:drain
      // for the full rationale — the counter + `.finally()` pair tracks
      // concurrency; errors are logged inside executeJob so there's
      // nothing useful to await. `void` silences no-floating-promises.
      void this.executeJob(job).finally(() => {
        this.processing -= 1;
        this.drain();
      });
    }
  }

  private async executeJob(job: QueuedJob): Promise<void> {
    const waitMs = Date.now() - job.enqueuedAt;
    this.logger.log(
      `Generating sample report for ${job.prospectInstitutionId} (wait=${waitMs}ms)`,
    );

    try {
      await this.sampleReportService.generateSampleReport(
        job.prospectInstitutionId,
      );
      this.completedCount += 1;
      this.logger.log(
        `Sample report completed for ${job.prospectInstitutionId}`,
      );
    } catch (err) {
      this.failedCount += 1;
      this.logger.error(
        `Sample report failed for ${job.prospectInstitutionId}: ${(err as Error).message}`,
      );
    }
  }
}
