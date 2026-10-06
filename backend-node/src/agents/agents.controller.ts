import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthGuard } from '../auth/auth.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { AgentRunnerService } from './runner/agent-runner.service';
import { AgentRunService } from './runner/agent-run.service';
import { AgentAuditService } from './runner/agent-audit.service';
import { RunAgentRequestSchema } from './agents.dto';

// Pre-fix: this controller exposed three privileged routes with zero auth —
// any caller could POST /agents/run with arbitrary `institutionId` +
// `organizationId` in the body (the runner trusted both) and any caller
// could read any run's audit chain by guessed id. Documented as the #1
// critical gap in docs/security/AUTH_COVERAGE_AUDIT.md.
//
// Closure pattern mirrors ai-advisor.controller.ts (commits e88ae20c /
// 4f9e2728): AuthGuard at class level establishes "must be logged in";
// body-supplied tenancy keys are verified through the same kernel
// primitives URL-scoped routes use — `InstitutionScopeGuard.verifyOwnership`
// for `institutionId` (commit b2a64c25), `OrgMembershipGuard.verifyMembership`
// for `organizationId` (extracted in this commit; mirrors b2a64c25). The
// class-level `OrgMembershipGuard.canActivate` short-circuits when there is
// no `:orgId` / `:cycleId` in the URL — the explicit verify calls inside
// `run()` are the body-IDOR closure.
@Controller('agents')
@UseGuards(AuthGuard)
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(
    private readonly runner: AgentRunnerService,
    private readonly runs: AgentRunService,
    private readonly audit: AgentAuditService,
    private readonly institutionScope: InstitutionScopeGuard,
    private readonly orgMembership: OrgMembershipGuard,
  ) {}

  @Post('run')
  async run(
    @Body() body: unknown,
    @Req() req: any,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    const parsed = RunAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INPUT_INVALID',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const dto = parsed.data;

    // At least one tenancy key must be present — without it, the runner
    // would execute against no tenant and we'd have nothing to authorize
    // against. The DTO permits both to be optional for forward-compat with
    // system-scope agents; tightening here keeps the controller honest.
    if (!dto.institutionId && !dto.organizationId) {
      throw new BadRequestException({
        code: 'TENANCY_REQUIRED',
        message:
          'agents.run requires at least one of institutionId or organizationId',
      });
    }

    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? '';
    const isPlatformAdmin = req.user?.access?.isPlatformAdmin === true;

    if (dto.institutionId) {
      await this.institutionScope.verifyOwnership(
        dto.institutionId,
        userId,
        isPlatformAdmin,
      );
    }
    if (dto.organizationId) {
      await this.orgMembership.verifyMembership(
        dto.organizationId,
        userId,
        isPlatformAdmin,
      );
    }

    const idempotencyKey =
      headerKey?.trim() ||
      dto.idempotencyKey ||
      deriveKey(dto.agentId, dto.triggerRef ?? 'api', dto.input);

    return this.runner.run({
      agentId: dto.agentId,
      institutionId: dto.institutionId,
      organizationId: dto.organizationId,
      triggerKind: dto.triggerKind,
      triggerRef: dto.triggerRef,
      idempotencyKey,
      input: dto.input,
    });
  }

  @Get('runs/:runId')
  async getRun(@Param('runId') runId: string, @Req() req: any) {
    const run = await this.runs.getById(runId);
    if (!run) throw new NotFoundException();
    await this.assertRunOwnership(run, req);
    return run;
  }

  @Get('runs/:runId/audit')
  async getAudit(@Param('runId') runId: string, @Req() req: any) {
    const run = await this.runs.getById(runId);
    if (!run) throw new NotFoundException();
    await this.assertRunOwnership(run, req);
    const [steps, chain] = await Promise.all([
      this.audit.listForRun(runId),
      this.audit.verifyChain(runId),
    ]);
    return { run, steps, chain };
  }

  // Run rows carry whichever tenancy key was active at create time
  // (institutionId, organizationId, or both). The kernel primitives reject
  // with ForbiddenException when the caller doesn't match; a row with no
  // tenancy at all is also denied — there's no scope under which an
  // unattributed run is readable by an authenticated tenant user.
  private async assertRunOwnership(
    run: Record<string, unknown>,
    req: any,
  ): Promise<void> {
    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? '';
    const isPlatformAdmin = req.user?.access?.isPlatformAdmin === true;
    const institutionId = run.institutionId as string | null | undefined;
    const organizationId = run.organizationId as string | null | undefined;

    if (!institutionId && !organizationId) {
      // Anti-leak: never reveal that a tenantless run exists.
      throw new NotFoundException();
    }

    if (institutionId) {
      await this.institutionScope.verifyOwnership(
        institutionId,
        userId,
        isPlatformAdmin,
      );
    }
    if (organizationId) {
      await this.orgMembership.verifyMembership(
        organizationId,
        userId,
        isPlatformAdmin,
      );
    }
  }
}

function deriveKey(agentId: string, scope: string, input: unknown): string {
  return createHash('sha256')
    .update(`${agentId}|${scope}|${JSON.stringify(input ?? {})}`)
    .digest('hex')
    .slice(0, 32);
}
