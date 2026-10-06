import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Logger,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import { AgentAuditService } from '../agents/runner/agent-audit.service';
import { InstitutionScopeGuard } from './guards/institution-scope.guard';
import { ExportFormatSchema } from './dto/agent-api.dto';
import type { AgentTraceExportJson } from './dto/api-types';

// AgentExportController serves regulator-grade trace exports of a single
// agent run. Two formats:
//
//   ?format=json — full audit chain + chain verification + export hash.
//                  This is the canonical, machine-checkable artifact.
//   ?format=pdf  — operator/regulator-friendly rendering. Wraps the JSON
//                  payload in a deterministic PDF (placeholder pending the
//                  AlmDocumentExportsService pipeline; see runbook).
//
// Audit hash chain is computed by AgentAuditService.verifyChain so the
// export carries a `chain.ok` flag. If the chain is broken, the export
// still emits — regulators need to see the broken state, not have it
// hidden — but with `chain.ok = false` and the broken index recorded.
//
// The `exportHash` is sha256 over a canonical JSON of (run header + steps).
// A regulator can rerun the algorithm against the file to verify the
// export hasn't been tampered with after generation.

@ApiTags('Agent Trace Export')
@Controller('api/v1/agents/:institutionId/runs/:runId/trace')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AgentExportController {
  private readonly logger = new Logger(AgentExportController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AgentAuditService,
  ) {}

  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(
    @Param('institutionId') institutionId: string,
    @Param('runId') runId: string,
    @Query('format') rawFormat: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentTraceExportJson | undefined> {
    const formatResult = ExportFormatSchema.safeParse(rawFormat ?? 'json');
    if (!formatResult.success) {
      throw new BadRequestException('format must be json or pdf');
    }
    const format = formatResult.data;

    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.institutionId !== institutionId) {
      throw new NotFoundException('run not found');
    }

    const [steps, chain] = await Promise.all([
      this.prisma.agentAuditLog.findMany({
        where: { runId },
        orderBy: { stepIndex: 'asc' },
      }),
      this.audit.verifyChain(runId),
    ]);

    const stepsWire = steps.map((s: any) => ({
      stepIndex: s.stepIndex,
      stepKind: String(s.stepKind),
      toolName: s.toolName,
      payload: s.payload,
      prevHash: s.prevHash,
      hash: s.hash,
      durationMs: s.durationMs,
      createdAt: s.createdAt.toISOString(),
    }));

    const runHeader = {
      id: run.id,
      agentId: String(run.agentId),
      status: String(run.status),
      triggerKind: String(run.triggerKind),
      institutionId: run.institutionId,
      organizationId: run.organizationId,
      durationMs: run.durationMs,
      costUsdCents: run.costUsdCents,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      auditRootHash: run.auditRootHash,
      promptVersion: run.promptVersion,
      agentVersion: run.agentVersion,
    };

    const exportPayload: AgentTraceExportJson = {
      run: runHeader,
      steps: stepsWire,
      chain,
      generatedAt: new Date().toISOString(),
      exportHash: '',
    };
    exportPayload.exportHash = computeExportHash(exportPayload);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="agent-trace-${runId}.json"`,
      );
      return exportPayload;
    }

    // PDF format: deferred to AlmDocumentExportsService once the agent
    // module exposes a renderer. For now, we set headers that announce a
    // pending pipeline so frontend developers see a clean 501 instead of
    // a half-baked PDF. See docs/ops/AGENT_API_CONTRACT.md §Trace Export.
    res.status(501);
    res.setHeader('Content-Type', 'application/json');
    res.json({
      code: 'PDF_EXPORT_PENDING',
      message:
        'PDF export pipeline pending — request format=json for now. ' +
        'See docs/ops/AGENT_API_CONTRACT.md §Trace Export.',
    });
    return undefined;
  }
}

// Canonical-JSON sha256 over the export. We exclude the `exportHash` field
// itself (it's set after computation) and serialise with sorted keys so
// any platform regenerating the hash gets the same digest.
export function computeExportHash(payload: AgentTraceExportJson): string {
  const cloned = { ...payload, exportHash: '' };
  const canonical = canonicalJson(cloned);
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k: string, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k];
    }
    return sorted;
  });
}
