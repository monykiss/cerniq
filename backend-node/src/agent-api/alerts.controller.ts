import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AgentAlertStatus } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import { InstitutionScopeGuard } from './guards/institution-scope.guard';
import {
  AckAlertBodySchema,
  ListAlertsQuerySchema,
  parseOrThrow,
} from './dto/agent-api.dto';
import type { AgentAlertListResponse } from './dto/api-types';

// AlertsController owns the *operator* side of the Risk Monitor agent's
// output. Read-side: keyset list + per-severity summary strip. Write-side:
// acknowledge / resolve / suppress. Suppression mutates the dedup gate
// without touching the alert row's findings — the next regenerated alert
// will land if-and-only-if the dedup key changes.
//
// Status transition rules (enforced here, mirrored at the DB by the unique
// dedup index):
//
//                     ┌──────────► RESOLVED  (terminal — kept for audit)
//   OPEN ──ack──► ACKNOWLEDGED ────┤
//                     └──────────► SUPPRESSED (no re-emit until dedup changes)
//
// A RESOLVED alert that re-fires creates a NEW row. We never resurrect
// resolved rows because that would break the audit trail.

@ApiTags('Agent Alerts')
@Controller('api/v1/agents/:institutionId/alerts')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AgentAlertsController {
  private readonly logger = new Logger(AgentAlertsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'List alerts for the institution with keyset pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Alert list with severity summary strip',
  })
  async list(
    @Param('institutionId') institutionId: string,
    @Query() rawQuery: unknown,
  ): Promise<AgentAlertListResponse> {
    const query = parseQuery(ListAlertsQuerySchema, rawQuery);

    let cursorCreatedAt: Date | undefined;
    if (query.cursor) {
      const cursorRow = await this.prisma.agentAlert.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, institutionId: true },
      });
      if (!cursorRow || cursorRow.institutionId !== institutionId) {
        throw new BadRequestException('cursor invalid for this institution');
      }
      cursorCreatedAt = cursorRow.createdAt;
    }

    // Two queries: paginated rows + summary counts. The summary is cheap
    // (fully covered by `(institution_id, severity, createdAt)` index) and
    // the UI's header strip needs it on every render.
    const [rows, summaryRows] = await Promise.all([
      this.prisma.agentAlert.findMany({
        where: {
          institutionId,
          severity: query.severity ?? undefined,
          status: query.status ?? undefined,
          agentId: query.agentId ?? undefined,
          createdAt: cursorCreatedAt ? { lt: cursorCreatedAt } : undefined,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.agentAlert.groupBy({
        by: ['severity', 'status'],
        where: { institutionId },
        _count: { _all: true },
      }),
    ]);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const summary = { open: 0, critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of summaryRows) {
      if (row.status === AgentAlertStatus.OPEN) {
        summary.open += row._count._all;
      }
      // We surface severity counts across ALL non-resolved statuses so the
      // header strip reflects "what the operator still needs to deal with".
      if (
        row.status === AgentAlertStatus.OPEN ||
        row.status === AgentAlertStatus.ACKNOWLEDGED
      ) {
        const key = String(row.severity).toLowerCase() as
          | 'critical'
          | 'high'
          | 'medium'
          | 'low';
        if (key in summary) summary[key] += row._count._all;
      }
    }

    return {
      alerts: page.map((a: (typeof page)[number]) => ({
        id: a.id,
        runId: a.runId,
        agentId: String(a.agentId),
        severity: String(a.severity),
        status: String(a.status),
        metric: a.metric,
        finding: a.finding,
        findingEs: a.findingEs,
        recommendation: a.recommendation,
        regulatoryRef: a.regulatoryRef,
        deadline: a.deadline?.toISOString() ?? null,
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      summary,
    };
  }

  @Patch(':alertId')
  async ack(
    @Param('institutionId') institutionId: string,
    @Param('alertId') alertId: string,
    @Body() rawBody: unknown,
    @Req() req: any,
  ) {
    const body = parseQuery(AckAlertBodySchema, rawBody);
    const userId: string = req.user.userId;

    const existing = await this.prisma.agentAlert.findUnique({
      where: { id: alertId },
      select: { id: true, institutionId: true, status: true },
    });
    if (!existing || existing.institutionId !== institutionId) {
      throw new NotFoundException('alert not found');
    }

    // Idempotency: re-acking an already-acked alert is a no-op return, not
    // an error. Operators frequently double-click; surfacing 409 here would
    // train them to ignore real conflicts.
    if (
      existing.status !== AgentAlertStatus.OPEN &&
      body.resolution === 'ACKNOWLEDGED'
    ) {
      return this.prisma.agentAlert.findUnique({ where: { id: alertId } });
    }

    const now = new Date();
    return this.prisma.agentAlert.update({
      where: { id: alertId },
      data: {
        status:
          body.resolution === 'RESOLVED'
            ? AgentAlertStatus.RESOLVED
            : body.resolution === 'SUPPRESSED'
              ? AgentAlertStatus.SUPPRESSED
              : AgentAlertStatus.ACKNOWLEDGED,
        acknowledgedAt: now,
        acknowledgedBy: userId,
        // Resolved transitions stamp resolvedAt; the others leave it null.
        resolvedAt: body.resolution === 'RESOLVED' ? now : null,
      },
    });
  }
}

import type { z } from 'zod';

function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  try {
    return parseOrThrow(schema, raw);
  } catch (err) {
    throw new BadRequestException({
      code: 'INPUT_INVALID',
      issues: (err as Error & { issues?: unknown }).issues ?? [],
    });
  }
}
