import { Injectable, Logger } from '@nestjs/common';
import { AgentId } from '@prisma/client';
import {
  AgentRunnerService,
  type ExecuteOptions,
} from '../../agents/runner/agent-runner.service';
import { AgentCostCircuitBreakerService } from './agent-cost-circuit-breaker.service';

// AgentQueueService is the dispatch gateway between HTTP controllers / event
// triggers and the AgentRunnerService. It adds three concerns that the raw
// runner doesn't have:
//
//   1. Priority ordering — CRITICAL alerts preempt scheduled background scans.
//   2. Cost circuit breaker — reject runs that would blow the LLM budget.
//   3. Fire-and-forget + background tracking — callers get a run-id immediately;
//      the actual execution happens in a detached async.
//
// Architecture note: the existing ALM queue (`alm-compute.processor.ts`) uses
// an in-memory Map with setImmediate for async dispatch. We follow the same
// pattern here for consistency and to avoid adding Bull as a runtime dep until
// Redis is deployed (see docs/ops/AGENT_QUEUE_RUNBOOK.md for the migration
// path). The priority system is advisory — it determines scheduling order
// within the in-memory queue, not preemption of in-flight runs.

const PRIORITY = {
  CRITICAL: 10,
  HIGH: 7,
  USER_QUERY: 5,
  API: 3,
  SCHEDULE: 1,
} as const;

export interface AgentJobInput {
  agentId: string;
  input: unknown;
  options: ExecuteOptions & { institutionId?: string | null };
}

export interface EnqueueResult {
  accepted: boolean;
  runId?: string;
  position?: number;
  rejectedReason?: 'BUDGET_EXCEEDED' | 'QUEUE_FULL';
}

interface QueuedJob {
  job: AgentJobInput;
  priority: number;
  enqueuedAt: number;
}

const MAX_QUEUE_DEPTH = 200; // Vol.2 alert threshold
const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 50;

@Injectable()
export class AgentQueueService {
  private readonly logger = new Logger(AgentQueueService.name);
  private readonly pending: QueuedJob[] = [];
  private processing = 0;
  private readonly concurrency: number;

  constructor(
    private readonly runner: AgentRunnerService,
    private readonly costBreaker: AgentCostCircuitBreakerService,
  ) {
    this.concurrency = AgentQueueService.resolveConcurrency(
      process.env,
      (msg) => this.logger.warn(msg),
    );
  }

  /**
   * Resolve worker concurrency from env. Exported as static so the
   * spec can exercise the full truth table without constructing the
   * service. Previously used `parseInt(raw, 10)` which silently
   * accepted '100abc' as 100 and '0' as 0 — a zero value caused a
   * deadlock because `drain()`'s `while (processing < concurrency)`
   * guard never let anything execute. All invalid inputs now fall
   * back to the default with a warn log.
   */
  static resolveConcurrency(
    env: NodeJS.ProcessEnv,
    warn: (msg: string) => void = () => {},
  ): number {
    const raw = env.AGENT_WORKER_CONCURRENCY;
    if (raw === undefined || raw === '') return DEFAULT_CONCURRENCY;

    const parsed = Number(raw);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_CONCURRENCY ||
      parsed > MAX_CONCURRENCY
    ) {
      warn(
        `AGENT_WORKER_CONCURRENCY="${raw}" is not an integer in [${MIN_CONCURRENCY},${MAX_CONCURRENCY}] — using default ${DEFAULT_CONCURRENCY}`,
      );
      return DEFAULT_CONCURRENCY;
    }
    return parsed;
  }

  async enqueue(jobInput: AgentJobInput): Promise<EnqueueResult> {
    const instId = jobInput.options.institutionId;
    if (instId) {
      const budget = await this.costBreaker.isAllowed(instId);
      if (!budget.allowed) {
        this.logger.warn(
          `rejected agent run for ${instId}: budget exhausted ` +
            `(${budget.spentCents}/${budget.capCents} cents)`,
        );
        return { accepted: false, rejectedReason: 'BUDGET_EXCEEDED' };
      }
    }

    if (this.pending.length >= MAX_QUEUE_DEPTH) {
      this.logger.warn(
        `agent queue full (${this.pending.length}/${MAX_QUEUE_DEPTH})`,
      );
      return { accepted: false, rejectedReason: 'QUEUE_FULL' };
    }

    const priority = resolvePriority(jobInput);
    const queued: QueuedJob = {
      job: jobInput,
      priority,
      enqueuedAt: Date.now(),
    };

    const insertIdx = this.pending.findIndex((j) => j.priority < priority);
    if (insertIdx === -1) {
      this.pending.push(queued);
    } else {
      this.pending.splice(insertIdx, 0, queued);
    }

    this.drain();
    return {
      accepted: true,
      position: this.pending.indexOf(queued) + 1,
    };
  }

  get stats(): {
    pending: number;
    processing: number;
    concurrency: number;
  } {
    return {
      pending: this.pending.length,
      processing: this.processing,
      concurrency: this.concurrency,
    };
  }

  private drain(): void {
    while (this.processing < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.processing += 1;
      // Fire-and-forget: the drain loop tracks concurrency via the
      // counter updated inside `.finally()`, which runs regardless of
      // whether executeJob settled or threw. `void` marks this as
      // intentional so no-floating-promises doesn't flag the pattern.
      // If executeJob throws, the error is already logged by the inner
      // try/catch — there's nothing useful to await on here.
      void this.executeJob(job).finally(() => {
        this.processing -= 1;
        this.drain();
      });
    }
  }

  private async executeJob(queued: QueuedJob): Promise<void> {
    const waitMs = Date.now() - queued.enqueuedAt;
    const j = queued.job;
    this.logger.log(
      `executing ${j.agentId} (wait=${waitMs}ms, priority=${queued.priority})`,
    );
    try {
      const result = await this.runner.run({
        agentId: j.agentId,
        ...j.options,
        input: j.input,
      });
      this.logger.log(
        `completed ${j.agentId} run=${result.runId} status=${result.status}`,
      );
    } catch (err) {
      this.logger.error(
        `crashed ${j.agentId} for ${j.options.institutionId}: ${(err as Error).message}`,
      );
    }
  }
}

function resolvePriority(jobInput: AgentJobInput): number {
  if (jobInput.agentId === String(AgentId.RISK_MONITOR)) return PRIORITY.HIGH;
  if (jobInput.options.triggerKind === 'USER_QUERY') return PRIORITY.USER_QUERY;
  if (jobInput.options.triggerKind === 'SCHEDULE') return PRIORITY.SCHEDULE;
  return PRIORITY.API;
}
