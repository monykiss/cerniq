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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import { InstitutionScopeGuard } from './guards/institution-scope.guard';
import { AgentRunThrottleGuard } from './guards/agent-run-throttle.guard';
import {
  CostQuerySchema,
  ListRunsQuerySchema,
  parseOrThrow,
} from './dto/agent-api.dto';
import type { AgentCostSummary, AgentRunListResponse } from './dto/api-types';
import { AgentCostCircuitBreakerService } from '../queue/agent/agent-cost-circuit-breaker.service';
import { AgentRunnerService } from '../agents/runner/agent-runner.service';
import { AgentAuditService } from '../agents/runner/agent-audit.service';
import { isSchedulerDisabled } from '../agents/scheduler/scheduler-flag.util';
import { RunAgentRequestSchema } from '../agents/agents.dto';

// AgentRunsController serves the per-tenant agent endpoints.
//
//   POST /api/v1/agents/:institutionId/run              — trigger (tenant-scoped)
//   GET  /api/v1/agents/:institutionId/runs              — keyset-paginated list
//   GET  /api/v1/agents/:institutionId/runs/:runId       — single run detail
//   GET  /api/v1/agents/:institutionId/runs/:runId/trace — raw audit steps
//   GET  /api/v1/agents/:institutionId/cost              — month-rollup with budget gate
//
// Tenant scoping: InstitutionScopeGuard verifies ownership AND populates
// req.user.institutionId so the TenantContextMiddleware enforces RLS on
// every Prisma query made downstream.

@ApiTags('Agent Runs')
@Controller('api/v1/agents/:institutionId')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AgentRunsController {
  private readonly logger = new Logger(AgentRunsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costBreaker: AgentCostCircuitBreakerService,
    private readonly runner: AgentRunnerService,
    private readonly audit: AgentAuditService,
  ) {}

  // verify:body-trust-skip — URL :institutionId is the only authoritative tenancy binding (verified by class-level InstitutionScopeGuard); body.institutionId AND body.organizationId are silently ignored per the in-body comment below (institutionId IDOR closure pattern; organizationId stripped from runner.run() args, agent runs are scoped to the URL institutionId)
  @Post('run')
  // Per-user throttle on the expensive mutation. Each run triggers a
  // Claude Opus invocation costing $0.10–$1.00. Ceiling is 10/min per
  // user — see AgentRunThrottleGuard for the cost-math rationale.
  @UseGuards(AgentRunThrottleGuard)
  @ApiOperation({ summary: 'Trigger an agent run for the institution' })
  @ApiParam({ name: 'institutionId', description: 'Target institution UUID' })
  @ApiResponse({ status: 201, description: 'Agent run created and queued' })
  @ApiResponse({
    status: 400,
    description: 'Invalid input — Zod validation errors returned',
  })
  async triggerRun(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
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
    const req = parsed.data;
    // URL `:institutionId` wins — the class-level InstitutionScopeGuard
    // verified ownership of the URL value, NOT the body value. The prior
    // `req.institutionId ?? institutionId` allowed a caller authorized
    // for institution-A to set `body.institutionId = 'attacker-target'`
    // and run an agent on that institution's behalf. Body's
    // `institutionId` field remains in the schema as `.optional()` for
    // backward-compat with clients that send it (it's silently ignored).
    //
    // `body.organizationId` is also silently ignored (R3 verify-body-trust
    // flagged this as a body-IDOR in 2eea5608 — same class of bug as the
    // institutionId case above): accepting an unverified organizationId
    // and passing it to the runner could tag runs under a different
    // organization than the caller actually belongs to. The URL
    // `:institutionId` is the authoritative tenancy binding; the runner
    // derives any organization context downstream from the institution.
    return this.runner.run({
      agentId: req.agentId,
      institutionId,
      triggerKind: req.triggerKind,
      triggerRef: req.triggerRef,
      idempotencyKey:
        headerKey?.trim() ||
        req.idempotencyKey ||
        createHash('sha256')
          .update(
            `${req.agentId}|${institutionId}|${JSON.stringify(req.input ?? {})}`,
          )
          .digest('hex')
          .slice(0, 32),
      input: req.input,
    });
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Get a single agent run by ID' })
  @ApiParam({ name: 'runId', description: 'Agent run UUID' })
  @ApiResponse({
    status: 200,
    description: 'Full run record with output and metadata',
  })
  @ApiResponse({
    status: 404,
    description: 'Run not found or belongs to another institution',
  })
  async getRunById(
    @Param('institutionId') institutionId: string,
    @Param('runId') runId: string,
  ) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.institutionId !== institutionId) {
      throw new NotFoundException('run not found');
    }
    return run;
  }

  @Get('runs/:runId/trace')
  @ApiOperation({
    summary: 'Get the audit trace (tool calls, LLM turns) for a run',
  })
  @ApiParam({ name: 'runId', description: 'Agent run UUID' })
  @ApiResponse({
    status: 200,
    description: 'Ordered list of audit log entries with SHA-256 chain',
  })
  async getRunTrace(
    @Param('institutionId') institutionId: string,
    @Param('runId') runId: string,
  ) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { id: true, institutionId: true },
    });
    if (!run || run.institutionId !== institutionId) {
      throw new NotFoundException('run not found');
    }
    return this.audit.listForRun(runId);
  }

  @Get('schedule')
  @ApiOperation({
    summary: 'List scheduled agent cadences (daily/weekly/monthly)',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of schedule definitions with cron expressions',
  })
  async getSchedule() {
    // Shared helper keeps this in sync with AgentSchedulerService.
    // Previously each site used different truthiness rules, so
    // `AGENT_SCHEDULER_DISABLED=false` made the endpoint report
    // `enabled: false` while the scheduler was actually firing.
    const enabled = !isSchedulerDisabled();
    return {
      schedules: [
        {
          agentId: 'RISK_MONITOR',
          cadence: 'daily',
          cron: '0 0 9 * * *',
          timezone: 'America/Puerto_Rico',
          enabled,
        },
        {
          agentId: 'RISK_MONITOR',
          cadence: 'weekly',
          cron: '0 0 9 * * 1',
          timezone: 'America/Puerto_Rico',
          enabled,
        },
        {
          agentId: 'RISK_MONITOR',
          cadence: 'monthly',
          cron: '0 0 9 1 * *',
          timezone: 'America/Puerto_Rico',
          enabled,
        },
      ],
    };
  }

  @Get('runs')
  @ApiOperation({ summary: 'List agent runs with keyset pagination' })
  @ApiResponse({
    status: 200,
    description: 'Paginated run list with nextCursor',
  })
  async listRuns(
    @Param('institutionId') institutionId: string,
    @Query() rawQuery: unknown,
  ): Promise<AgentRunListResponse> {
    const query = parseOrThrowQuery(ListRunsQuerySchema, rawQuery);

    // Keyset pagination on (createdAt DESC, id DESC). When `cursor` is
    // present we resolve the cursor row's createdAt and ask for strictly
    // older rows. Avoids the OFFSET pathology and stays stable under
    // concurrent inserts.
    let cursorCreatedAt: Date | undefined;
    if (query.cursor) {
      const cursorRow = await this.prisma.agentRun.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, institutionId: true },
      });
      // Reject cursors that don't belong to this institution — defends
      // against tampering even if RLS is somehow bypassed.
      if (!cursorRow || cursorRow.institutionId !== institutionId) {
        throw new BadRequestException('cursor invalid for this institution');
      }
      cursorCreatedAt = cursorRow.createdAt;
    }

    const createdAtFilter =
      cursorCreatedAt || query.since
        ? {
            ...(cursorCreatedAt ? { lt: cursorCreatedAt } : {}),
            ...(query.since ? { gte: query.since } : {}),
          }
        : undefined;

    const rows = await this.prisma.agentRun.findMany({
      where: {
        institutionId,
        agentId: query.agentId ?? undefined,
        status: query.status ?? undefined,
        createdAt: createdAtFilter,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        agentId: true,
        status: true,
        triggerKind: true,
        institutionId: true,
        organizationId: true,
        durationMs: true,
        costUsdCents: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      runs: page.map((r: (typeof rows)[number]) => ({
        id: r.id,
        agentId: String(r.agentId),
        status: String(r.status),
        triggerKind: String(r.triggerKind),
        institutionId: r.institutionId,
        organizationId: r.organizationId,
        durationMs: r.durationMs,
        costUsdCents: r.costUsdCents,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  @Get('cost')
  @ApiOperation({ summary: 'Get agent cost summary for a billing month' })
  @ApiResponse({
    status: 200,
    description: 'Cost breakdown by agent, total tokens, budget status',
  })
  async cost(
    @Param('institutionId') institutionId: string,
    @Query() rawQuery: unknown,
  ): Promise<AgentCostSummary> {
    const query = parseOrThrowQuery(CostQuerySchema, rawQuery);
    const { from, to, monthLabel } = monthBoundaries(query.month);

    // Single grouping query — Prisma's groupBy is fine here because the
    // (institution_id, agent_id, created_at) index covers the predicate.
    const grouped = await this.prisma.agentRun.groupBy({
      by: ['agentId'],
      where: {
        institutionId,
        createdAt: { gte: from, lt: to },
      },
      _sum: {
        costUsdCents: true,
        inputTokens: true,
        outputTokens: true,
      },
      _count: { _all: true },
    });

    const byAgent = grouped.map((g: (typeof grouped)[number]) => ({
      agentId: String(g.agentId),
      runs: g._count._all,
      costUsdCents: g._sum.costUsdCents ?? 0,
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
    }));

    const totals = byAgent.reduce(
      (
        acc: {
          totalRuns: number;
          totalCostUsdCents: number;
          totalInputTokens: number;
          totalOutputTokens: number;
        },
        r: (typeof byAgent)[number],
      ) => {
        acc.totalRuns += r.runs;
        acc.totalCostUsdCents += r.costUsdCents;
        acc.totalInputTokens += r.inputTokens;
        acc.totalOutputTokens += r.outputTokens;
        return acc;
      },
      {
        totalRuns: 0,
        totalCostUsdCents: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    );

    const budget = this.costBreaker.snapshotForInstitution(
      institutionId,
      totals.totalCostUsdCents,
    );

    return {
      month: monthLabel,
      institutionId,
      ...totals,
      byAgent,
      budget,
    };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

import type { z } from 'zod';

function parseOrThrowQuery<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  try {
    return parseOrThrow(schema, raw);
  } catch (err) {
    throw new BadRequestException({
      code: 'QUERY_INVALID',
      issues: (err as Error & { issues?: unknown }).issues ?? [],
    });
  }
}

function monthBoundaries(monthInput?: string): {
  from: Date;
  to: Date;
  monthLabel: string;
} {
  const now = new Date();
  let year: number;
  let month: number; // 1..12
  if (monthInput) {
    const [y, m] = monthInput.split('-').map(Number);
    year = y;
    month = m;
  } else {
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
  }
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
  return { from, to, monthLabel };
}
