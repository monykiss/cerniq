import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentId } from '@prisma/client';
import { AgentRunnerService } from './agent-runner.service';
import { AgentEventBusService } from './agent-event-bus.service';
import { PrismaService } from '../../prisma.service';

// Vol.1 §Cross-Agent Orchestration, Pattern 1: Monthly Governance Cycle
// ALM Decision → Peer Intelligence → Committee Report → Board Narrative
//
// Each step is async via Bull (CONTRACTS.md: "synchronous child-inside-parent
// chaining is banned"). The chain orchestrator listens for RUN_COMPLETED
// events and dispatches the next step if the run belongs to an active chain.

export interface ChainStep {
  agentId: AgentId;
  dependsOnAgent?: AgentId;
  inputMapper: (priorOutput: unknown) => unknown;
}

export interface ChainDefinition {
  id: string;
  name: string;
  steps: ChainStep[];
}

export const MONTHLY_GOVERNANCE_CHAIN: ChainDefinition = {
  id: 'monthly_governance',
  name: 'Monthly Governance Cycle (Vol.1 Pattern 1)',
  steps: [
    {
      agentId: AgentId.RISK_MONITOR,
      inputMapper: (input) => input,
    },
    {
      agentId: AgentId.ALM_DECISION,
      dependsOnAgent: AgentId.RISK_MONITOR,
      inputMapper: (prior) => ({
        ...((prior ?? {}) as Record<string, unknown>),
        chainSource: 'RISK_MONITOR',
      }),
    },
    {
      agentId: AgentId.PEER_INTELLIGENCE,
      dependsOnAgent: AgentId.ALM_DECISION,
      inputMapper: (prior) => ({ sourceRunOutput: prior }),
    },
    {
      agentId: AgentId.COMMITTEE_REPORT,
      dependsOnAgent: AgentId.PEER_INTELLIGENCE,
      inputMapper: (prior) => ({
        sourceRunOutput: prior,
        committeeType: 'board',
        language: 'bilingual',
      }),
    },
    {
      agentId: AgentId.BOARD_NARRATIVE,
      dependsOnAgent: AgentId.COMMITTEE_REPORT,
      inputMapper: (prior) => ({
        sourceRunOutput: prior,
        outputType: 'BOARD_PACKET',
      }),
    },
  ],
};

export const PRE_EXAM_CHAIN: ChainDefinition = {
  id: 'pre_exam',
  name: 'Pre-Examination Preparation (Vol.1 Pattern 2)',
  steps: [
    { agentId: AgentId.EXAM_PREP, inputMapper: (i) => i },
    {
      agentId: AgentId.ALM_DECISION,
      dependsOnAgent: AgentId.EXAM_PREP,
      inputMapper: (prior) => ({ chainSource: 'EXAM_PREP', examData: prior }),
    },
    {
      agentId: AgentId.STRESS_TESTING,
      dependsOnAgent: AgentId.ALM_DECISION,
      inputMapper: () => ({}),
    },
    {
      agentId: AgentId.REGULATORY_COMPLIANCE,
      dependsOnAgent: AgentId.STRESS_TESTING,
      inputMapper: () => ({}),
    },
    {
      agentId: AgentId.BOARD_NARRATIVE,
      dependsOnAgent: AgentId.REGULATORY_COMPLIANCE,
      inputMapper: (prior) => ({
        sourceRunOutput: prior,
        outputType: 'BOARD_PACKET',
      }),
    },
  ],
};

const CHAINS = new Map<string, ChainDefinition>([
  [MONTHLY_GOVERNANCE_CHAIN.id, MONTHLY_GOVERNANCE_CHAIN],
  [PRE_EXAM_CHAIN.id, PRE_EXAM_CHAIN],
]);

interface ActiveChain {
  chainId: string;
  rootRunId: string;
  institutionId: string;
  organizationId?: string;
  currentStepIdx: number;
  completedRuns: Map<AgentId, string>;
  startedAt: Date;
}

@Injectable()
export class AgentChainService {
  private readonly log = new Logger(AgentChainService.name);
  private readonly active = new Map<string, ActiveChain>();

  constructor(
    private readonly runner: AgentRunnerService,
    private readonly eventBus: AgentEventBusService,
    private readonly prisma: PrismaService,
  ) {
    this.eventBus.onAny((event: any) => {
      if (event?.type === 'RUN_COMPLETED' && event.runId) {
        this.onRunCompleted(event.runId, event.agentId, event.output).catch(
          (err) =>
            this.log.error({ err, runId: event.runId }, 'chain dispatch error'),
        );
      }
    });
  }

  async startChain(
    chainId: string,
    opts: { institutionId: string; organizationId?: string; input?: unknown },
  ): Promise<{ chainInstanceId: string; firstRunId: string }> {
    const def = CHAINS.get(chainId);
    if (!def) throw new Error(`unknown chain: ${chainId}`);
    if (def.steps.length === 0)
      throw new Error(`chain ${chainId} has no steps`);

    const chainInstanceId = `chain_${chainId}_${Date.now()}`;
    const firstStep = def.steps[0];

    const idempotencyKey = createHash('sha256')
      .update(
        `${chainId}|${opts.institutionId}|${Math.floor(Date.now() / 60_000)}`,
      )
      .digest('hex');

    const result = await this.runner.run({
      agentId: firstStep.agentId,
      institutionId: opts.institutionId,
      organizationId: opts.organizationId ?? null,
      triggeredByUserId: null,
      triggerKind: 'CHAIN',
      triggerRef: chainInstanceId,
      input: firstStep.inputMapper(opts.input),
      idempotencyKey,
    });

    this.active.set(chainInstanceId, {
      chainId,
      rootRunId: result?.runId ?? chainInstanceId,
      institutionId: opts.institutionId,
      organizationId: opts.organizationId,
      currentStepIdx: 0,
      completedRuns: new Map(),
      startedAt: new Date(),
    });

    this.log.log(
      { chainId, chainInstanceId, firstAgent: firstStep.agentId },
      'chain started',
    );
    return { chainInstanceId, firstRunId: result.runId };
  }

  private async onRunCompleted(
    runId: string,
    agentId: string,
    output: unknown,
  ): Promise<void> {
    for (const [instanceId, chain] of this.active) {
      const def = CHAINS.get(chain.chainId);
      if (!def) continue;

      const currentStep = def.steps[chain.currentStepIdx];
      if (currentStep.agentId !== agentId) continue;

      chain.completedRuns.set(agentId, runId);
      const nextIdx = chain.currentStepIdx + 1;

      if (nextIdx >= def.steps.length) {
        this.log.log(
          { chainId: chain.chainId, instanceId, steps: def.steps.length },
          'chain completed',
        );
        this.active.delete(instanceId);
        return;
      }

      const nextStep = def.steps[nextIdx];
      chain.currentStepIdx = nextIdx;

      const runOutput = output ?? (await this.fetchRunOutput(runId));
      const nextInput = nextStep.inputMapper(runOutput);

      const idempotencyKey = createHash('sha256')
        .update(`${instanceId}|${nextStep.agentId}|${runId}`)
        .digest('hex');

      this.runner
        .run({
          agentId: nextStep.agentId,
          institutionId: chain.institutionId,
          organizationId: chain.organizationId ?? null,
          triggeredByUserId: null,
          triggerKind: 'CHAIN',
          triggerRef: runId,
          input: nextInput,
          idempotencyKey,
        })
        .catch((err) =>
          this.log.error(
            { err, chainId: chain.chainId, agent: nextStep.agentId },
            'chain step failed',
          ),
        );

      this.log.log(
        {
          chainId: chain.chainId,
          instanceId,
          step: `${nextIdx}/${def.steps.length}`,
          agent: nextStep.agentId,
        },
        'chain step dispatched',
      );
    }
  }

  private async fetchRunOutput(runId: string): Promise<unknown> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { output: true },
    });
    return run?.output ?? null;
  }

  getActiveChains(): Array<{
    instanceId: string;
    chainId: string;
    step: number;
    totalSteps: number;
    ageSec: number;
  }> {
    const now = Date.now();
    return Array.from(this.active.entries()).map(([id, c]) => {
      const def = CHAINS.get(c.chainId);
      return {
        instanceId: id,
        chainId: c.chainId,
        step: c.currentStepIdx,
        totalSteps: def?.steps.length ?? 0,
        ageSec: Math.round((now - c.startedAt.getTime()) / 1000),
      };
    });
  }
}
