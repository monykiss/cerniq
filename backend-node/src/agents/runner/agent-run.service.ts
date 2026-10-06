/**
 * AgentRunService — lifecycle + idempotency for agent runs.
 *
 * Key API:
 *   - `deriveIdempotencyKey({agentId, scope, content})` — static helper
 *     that generates a deterministic sha256 key from the triple. Used by
 *     the trigger layer to ensure upload-triggered runs are deduped.
 *   - `createOrReturnExisting(...)` — insert if absent, return existing
 *     if the (agent_id, idempotency_key) unique constraint fires. The
 *     `existing` boolean tells the caller whether to re-execute.
 *   - `markRunning`, `complete`, `fail`, `timedOut` — terminal transitions.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';

interface PrismaKnownError {
  code?: string;
}

@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  static deriveIdempotencyKey(params: {
    agentId: string;
    scope: string;
    content: string;
  }): string {
    const input = [params.agentId, params.scope, params.content].join('::');
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  async createOrReturnExisting(params: {
    agentId: string;
    agentVersion?: string;
    promptVersion?: string;
    institutionId?: string | null;
    organizationId?: string | null;
    triggeredByUserId?: string | null;
    triggerKind?: string;
    triggerRef?: string | null;
    idempotencyKey: string;
    input: unknown;
  }): Promise<{ run: Record<string, unknown>; existing: boolean }> {
    const existing = await this.prisma.agentRun.findUnique({
      where: {
        agent_idempotency: {
          agentId: params.agentId as never,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
    if (existing) {
      return {
        run: existing as unknown as Record<string, unknown>,
        existing: true,
      };
    }

    try {
      const created = await this.prisma.agentRun.create({
        data: {
          agentId: params.agentId as never,
          agentVersion: params.agentVersion ?? '1.0.0',
          promptVersion: params.promptVersion ?? '1.0.0',
          institutionId: params.institutionId ?? null,
          organizationId: params.organizationId ?? null,
          triggeredByUserId: params.triggeredByUserId ?? null,
          triggerKind: (params.triggerKind ?? 'API') as never,
          triggerRef: params.triggerRef ?? null,
          idempotencyKey: params.idempotencyKey,
          status: 'QUEUED' as never,
          input: (params.input ?? null) as never,
        },
      });
      return {
        run: created as unknown as Record<string, unknown>,
        existing: false,
      };
    } catch (err) {
      const knownErr = err as PrismaKnownError;
      if (knownErr?.code === 'P2002') {
        const winner = await this.prisma.agentRun.findUnique({
          where: {
            agent_idempotency: {
              agentId: params.agentId as never,
              idempotencyKey: params.idempotencyKey,
            },
          },
        });
        if (winner) {
          return {
            run: winner as unknown as Record<string, unknown>,
            existing: true,
          };
        }
      }
      throw err;
    }
  }

  async markRunning(runId: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING' as never,
        startedAt: new Date(),
      },
    });
  }

  async complete(
    runId: string,
    args: {
      output: unknown;
      auditRootHash: string | null;
      toolCallCount: number;
      llmTurnCount: number;
      inputTokens?: number | null;
      outputTokens?: number | null;
      costUsdCents?: number | null;
      durationMs: number;
    },
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'SUCCEEDED' as never,
        output: (args.output ?? null) as never,
        auditRootHash: args.auditRootHash,
        toolCallCount: args.toolCallCount,
        llmTurnCount: args.llmTurnCount,
        inputTokens: args.inputTokens ?? null,
        outputTokens: args.outputTokens ?? null,
        costUsdCents: args.costUsdCents ?? null,
        durationMs: args.durationMs,
        completedAt: new Date(),
      },
    });
  }

  async fail(
    runId: string,
    args: {
      errorCode: string;
      errorMessage: string;
      auditRootHash?: string | null;
      toolCallCount?: number;
      llmTurnCount?: number;
      // Record tokens + cost on failure too — failed runs still burn
      // LLM tokens, and the cost circuit breaker sums from `agentRun`
      // rows. Leaving cost null on failures would under-report spend.
      inputTokens?: number | null;
      outputTokens?: number | null;
      costUsdCents?: number | null;
      durationMs?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED' as never,
          errorCode: args.errorCode,
          errorMessage: args.errorMessage,
          auditRootHash: args.auditRootHash ?? null,
          toolCallCount: args.toolCallCount ?? 0,
          llmTurnCount: args.llmTurnCount ?? 0,
          inputTokens: args.inputTokens ?? null,
          outputTokens: args.outputTokens ?? null,
          costUsdCents: args.costUsdCents ?? null,
          durationMs: args.durationMs ?? null,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error({
        event: 'agent_run_fail_write_errored',
        runId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async timedOut(
    runId: string,
    args: {
      errorMessage: string;
      toolCallCount?: number;
      llmTurnCount?: number;
      // Same accounting as `fail` — a timed-out run still consumed
      // tokens on the LLM turns it completed before the deadline.
      inputTokens?: number | null;
      outputTokens?: number | null;
      costUsdCents?: number | null;
      durationMs?: number;
    },
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'TIMED_OUT' as never,
        errorCode: 'RUN_TIMEOUT',
        errorMessage: args.errorMessage,
        toolCallCount: args.toolCallCount ?? 0,
        llmTurnCount: args.llmTurnCount ?? 0,
        inputTokens: args.inputTokens ?? null,
        outputTokens: args.outputTokens ?? null,
        costUsdCents: args.costUsdCents ?? null,
        durationMs: args.durationMs ?? null,
        completedAt: new Date(),
      },
    });
  }

  async getById(runId: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.agentRun.findUnique({ where: { id: runId } });
    return row as unknown as Record<string, unknown> | null;
  }

  // Aliases used by the runner
  async startRun(input: {
    agentId: string;
    agentVersion?: string;
    promptVersion?: string;
    institutionId?: string | null;
    organizationId?: string | null;
    triggeredByUserId?: string | null;
    triggerKind?: string;
    triggerRef?: string | null;
    idempotencyKey: string;
    input: unknown;
  }): Promise<{
    runId: string;
    agentId: string;
    institutionId: string | null;
    replay: boolean;
    _nextStepIndex: number;
  }> {
    const { run, existing } = await this.createOrReturnExisting(input);
    // `createOrReturnExisting` returns `{ run: Record<string, unknown> }` —
    // the wide typing is a deliberate legacy boundary so the runner doesn't
    // have to import Prisma's generated `AgentRun` model. But the Prisma
    // schema does guarantee `id: string`, `agentId: string`, `institutionId:
    // string | null` on every returned row (the unique-constraint conflict
    // path throws rather than returning a degenerate shape). Narrow with
    // targeted casts here instead of `as any` so any future schema drift
    // surfaces as a TypeScript error at this call site, not silently in
    // the agent runtime.
    const runId = String(run.id);
    const agentId = (run.agentId as string | undefined) ?? input.agentId;
    const institutionId =
      (run.institutionId as string | null | undefined) ??
      input.institutionId ??
      null;
    return {
      runId,
      agentId,
      institutionId,
      replay: existing,
      _nextStepIndex: existing ? await this.nextStepIndexFor(runId) : 0,
    };
  }

  async getRun(runId: string) {
    return this.getById(runId);
  }

  private async nextStepIndexFor(runId: string): Promise<number> {
    const last = await this.prisma.agentAuditLog.findFirst({
      where: { runId },
      orderBy: { stepIndex: 'desc' },
      select: { stepIndex: true },
    });
    return last ? last.stepIndex + 1 : 0;
  }

  async listForInstitution(
    institutionId: string,
    opts: { agentId?: string; limit?: number } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.prisma.agentRun.findMany({
      where: {
        institutionId,
        ...(opts.agentId ? { agentId: opts.agentId as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 500),
    });
    return rows as unknown as Array<Record<string, unknown>>;
  }
}
