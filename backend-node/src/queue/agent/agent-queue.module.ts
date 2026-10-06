import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { AgentsModule } from '../../agents/agents.module';
import { AgentQueueService } from './agent-queue.service';
import { AgentCostCircuitBreakerService } from './agent-cost-circuit-breaker.service';

// AgentQueueModule wraps the in-memory priority queue + cost circuit
// breaker for agent runs. Exports both services so AgentApiModule can
// inject them into controllers.
//
// AgentsModule ↔ AgentQueueModule is a documented circular dependency:
// AgentsModule imports AgentQueueModule to enqueue runs, and
// AgentQueueModule imports AgentsModule to invoke the runner when a job
// is picked up. NestJS resolves this only when BOTH sides use
// `forwardRef()` — without it, whichever side initializes second sees
// `undefined` at index [1] of the peer's imports array and every e2e
// spec that bootstraps AppModule fails with:
//   "Nest cannot create the AgentQueueModule instance. The module at
//    index [1] of the AgentQueueModule 'imports' array is undefined."
// Landed in commit 12dcfdb2 when the full module graph was first
// stress-tested by the e2e suite.
//
// Bull migration path: when Redis is deployed to the Railway stack,
// replace AgentQueueService with a @nestjs/bullmq processor and add the
// BullModule.forRoot configuration. The priority map, concurrency setting,
// and cost-gate logic stay the same — only the dispatch mechanism changes.
// See docs/ops/AGENT_QUEUE_RUNBOOK.md for the step-by-step.

@Module({
  imports: [PrismaModule, forwardRef(() => AgentsModule)],
  providers: [AgentQueueService, AgentCostCircuitBreakerService],
  exports: [AgentQueueService, AgentCostCircuitBreakerService],
})
export class AgentQueueModule {}
