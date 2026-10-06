import { Injectable, Logger } from '@nestjs/common';
import {
  AgentRunnerService,
  type RunResult,
} from '../agents/runner/agent-runner.service';
import { AgentAuditService } from '../agents/runner/agent-audit.service';
import { getOutputSchema } from '../agent-trust/schema-registry';
import type {
  AgentType,
  AgentAuditLogReadModel,
} from '../agent-trust/contracts';
import type { AgentExecutor } from './agent-executor.port';
import type { AgentRunResult, AgentOutput } from './contracts';

/**
 * Adapter that bridges the peer-owned {@link AgentRunnerService} to our
 * hexagonal {@link AgentExecutor} port. The eval harness and replay runner
 * depend on the port; this adapter fulfills it in production.
 *
 * Register in AppModule: `{ provide: AGENT_EXECUTOR, useClass: AgentRunnerAdapter }`
 */
@Injectable()
export class AgentRunnerAdapter implements AgentExecutor {
  private readonly logger = new Logger(AgentRunnerAdapter.name);

  constructor(
    private readonly runner: AgentRunnerService,
    private readonly audit: AgentAuditService,
  ) {}

  async execute(invocation: {
    agentType: AgentType;
    institutionId: string;
    params: Record<string, unknown>;
  }): Promise<AgentRunResult> {
    const result: RunResult = await this.runner.run({
      agentId: invocation.agentType,
      institutionId: invocation.institutionId,
      idempotencyKey: `eval-${invocation.agentType}-${Date.now()}`,
      input: invocation.params,
    });

    const trace = await this.fetchTrace(result.runId);
    const output = (result.output ?? {}) as AgentOutput;
    const narrative = this.extractNarrative(output);

    return {
      runId: result.runId,
      institutionId: invocation.institutionId,
      agentType: invocation.agentType,
      output,
      trace,
      narrative,
      computeMs: result.durationMs,
    };
  }

  private async fetchTrace(runId: string): Promise<AgentAuditLogReadModel[]> {
    try {
      const rows = await this.audit.listForRun(runId);
      return rows.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        runId: String(row.runId ?? ''),
        stepNumber: Number(row.stepNumber ?? 0),
        stepType: String(
          row.stepType ?? 'TOOL_CALL',
        ) as AgentAuditLogReadModel['stepType'],
        toolName: row.toolName ? String(row.toolName) : null,
        toolInput: (row.toolInput ?? null) as Record<string, unknown> | null,
        toolOutput: (row.toolOutput ?? null) as Record<string, unknown> | null,
        llmPrompt: row.llmPrompt ? String(row.llmPrompt) : null,
        llmOutput: row.llmOutput ? String(row.llmOutput) : null,
        durationMs: row.durationMs ? Number(row.durationMs) : null,
      }));
    } catch (err) {
      this.logger.warn(`failed to fetch trace for run=${runId}: ${err}`);
      return [];
    }
  }

  private extractNarrative(output: AgentOutput): string {
    const parts: string[] = [];
    if ((output as any).brief) parts.push((output as any).brief);
    if (output.languages?.en) parts.push(output.languages.en);
    if (output.languages?.es) parts.push(output.languages.es);
    if (output.topRisks) {
      for (const risk of output.topRisks) {
        if (risk.recommendation) parts.push(risk.recommendation);
      }
    }
    return parts.join('\n');
  }
}
