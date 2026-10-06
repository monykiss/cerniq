import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AlmModule } from '../alm/alm.module';
import { AuthModule } from '../auth/auth.module';

import { AgentsController } from './agents.controller';
import { AgentAuditService } from './runner/agent-audit.service';
import { AgentRunService } from './runner/agent-run.service';
import { AgentRunnerService } from './runner/agent-runner.service';
import { AgentEventBusService } from './runner/agent-event-bus.service';
import { LlmBridgeService } from './runner/llm-bridge.service';
import { ToolRegistryService } from './registry/tool-registry.service';
import { AlmToolsFactory } from './registry/tools/alm-tools';
import { AgentTriggerService } from './trigger/agent-trigger.service';
import { AgentSchedulerService } from './scheduler/agent-scheduler.service';
import { AgentAlertNotifierService } from './alert-notifier/agent-alert-notifier.service';
import { QuantSwarmService } from '../swarm/quant-swarm.service';
import { CapitalAdequacyAdapterService } from '../swarm/capital-adequacy-adapter.service';
import { EmailModule } from '../email/email.module';
import { AgentQueueModule } from '../queue/agent/agent-queue.module';
import { AgentChainService } from './runner/agent-chain.service';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';

@Module({
  // forwardRef on AgentQueueModule breaks the AgentsModule ↔
  // AgentQueueModule cycle (see agent-queue.module.ts for the full
  // rationale). Mirror on both sides per NestJS circular-dep docs.
  //
  // AuthModule re-exports JwtModule so AuthGuard can verify bearer tokens
  // on the body-IDOR-closed agents routes (commit closing
  // AUTH_COVERAGE_AUDIT gap #1).
  imports: [
    PrismaModule,
    AlmModule,
    EmailModule,
    AuthModule,
    forwardRef(() => AgentQueueModule),
  ],
  controllers: [AgentsController],
  providers: [
    QuantSwarmService,
    CapitalAdequacyAdapterService,
    AgentEventBusService,
    AgentAuditService,
    AgentRunService,
    AgentRunnerService,
    LlmBridgeService,
    ToolRegistryService,
    AlmToolsFactory,
    AgentTriggerService,
    AgentSchedulerService,
    AgentAlertNotifierService,
    AgentChainService,
    // Tenancy-kernel primitives: InstitutionScopeGuard.verifyOwnership and
    // OrgMembershipGuard.verifyMembership are called explicitly inside
    // AgentsController.run() to close the body-supplied IDOR. Mirror of
    // ai-advisor.module.ts:20 wiring.
    InstitutionScopeGuard,
    OrgMembershipGuard,
  ],
  exports: [
    AgentRunnerService,
    AgentTriggerService,
    AgentEventBusService,
    AgentChainService,
    // Also export services consumed by AgentApiModule controllers so
    // the DI graph resolves cleanly from AppModule. AgentAuditService
    // is used by AgentRunsController (trace endpoints) and the export
    // controller; AgentEventBusService is already exported for the
    // tenant-stream SSE controller but is also consumed by other API
    // flows.
    AgentAuditService,
  ],
})
export class AgentsModule {}
