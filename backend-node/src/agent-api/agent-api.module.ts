import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AgentsModule } from '../agents/agents.module';
import { AgentQueueModule } from '../queue/agent/agent-queue.module';

import { InstitutionScopeGuard } from './guards/institution-scope.guard';
import { AgentRunThrottleGuard } from './guards/agent-run-throttle.guard';
import { AgentRunsController } from './agent-runs.controller';
import { AgentAlertsController } from './alerts.controller';
import { AgentCopilotController } from './copilot.controller';
import { AgentTenantStreamController } from './agent-tenant-stream.controller';
import { AgentExportController } from './agent-export.controller';

// AgentApiModule wires the per-tenant HTTP surface for the Agent Execution
// Layer (Vol.2 §API Contract). It complements `AgentsModule` (which owns
// the runtime, prompts, contracts, audit, registry, trigger) by exposing
// the operator-facing endpoints:
//
//   GET    /api/v1/agents/:institutionId/runs                — paginated list
//   GET    /api/v1/agents/:institutionId/cost                — month rollup
//   GET    /api/v1/agents/:institutionId/alerts              — list + summary
//   PATCH  /api/v1/agents/:institutionId/alerts/:alertId     — ack/resolve
//   POST   /api/v1/agents/:institutionId/copilot             — CFO Q&A
//   SSE    /api/v1/agents/:institutionId/stream              — activity feed
//   GET    /api/v1/agents/:institutionId/runs/:runId/trace/export — regulator
//
// Per-run trigger + per-run SSE live on AgentsController inside AgentsModule
// — we deliberately don't duplicate them here.
//
// Security perimeter: every controller is guarded by AuthGuard +
// InstitutionScopeGuard. The latter populates `req.user.institutionId` so
// the existing TenantContextMiddleware engages RLS for every Prisma query.

@Module({
  imports: [PrismaModule, AuthModule, AgentsModule, AgentQueueModule],
  controllers: [
    AgentRunsController,
    AgentAlertsController,
    AgentCopilotController,
    AgentTenantStreamController,
    AgentExportController,
  ],
  providers: [InstitutionScopeGuard, AgentRunThrottleGuard],
  exports: [InstitutionScopeGuard, AgentRunThrottleGuard],
})
export class AgentApiModule {}
