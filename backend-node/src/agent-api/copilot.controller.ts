import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AgentRunnerService } from '../agents/runner/agent-runner.service';
import { AgentRunService } from '../agents/runner/agent-run.service';
import { InstitutionScopeGuard } from './guards/institution-scope.guard';
import { AgentRunThrottleGuard } from './guards/agent-run-throttle.guard';
import { CopilotBodySchema, parseOrThrow } from './dto/agent-api.dto';

// CopilotController is the conversational entry point for the CFO Copilot
// agent. It is intentionally request/response (NOT streaming): every turn
// produces one Copilot output. Vol.2 ADR-005 reserves SSE for
// progress events on long-running ALM_DECISION runs — Copilot is short
// enough that streaming would just complicate clients.
//
// Session memory: the caller passes a `sessionId` (UUID); we derive an
// idempotency key from `(sessionId, query)` so accidental client retries
// short-circuit to the prior response. The peer's runner already supports
// idempotency-key replay via createOrReturnExisting().

@ApiTags('CFO Copilot')
@Controller('api/v1/agents/:institutionId/copilot')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AgentCopilotController {
  private readonly logger = new Logger(AgentCopilotController.name);

  constructor(private readonly runner: AgentRunnerService) {}

  @Post()
  // Per-user throttle on the expensive mutation. Copilot queries also
  // cost $0.10–$1.00 each. Same 10/min ceiling as /run — see
  // AgentRunThrottleGuard for rationale.
  @UseGuards(AgentRunThrottleGuard)
  @ApiOperation({
    summary: 'Ask the CFO Copilot a natural-language ALM question',
  })
  @ApiParam({ name: 'institutionId', description: 'Target institution UUID' })
  @ApiResponse({
    status: 201,
    description: 'Copilot response with tool citations and bilingual output',
  })
  @ApiResponse({ status: 400, description: 'Invalid query input' })
  async ask(
    @Param('institutionId') institutionId: string,
    @Body() rawBody: unknown,
    @Req() req: any,
  ) {
    let body: ReturnType<typeof parseBody>;
    try {
      body = parseBody(rawBody);
    } catch (err) {
      throw new BadRequestException({
        code: 'INPUT_INVALID',
        issues: (err as Error & { issues?: unknown }).issues ?? [],
      });
    }

    // Idempotency: per-(session, exact query). A session that asks the same
    // question twice gets the same answer — cheaper, faster, and avoids
    // confusing the operator with two slightly-different responses.
    const sessionId = body.sessionId ?? cryptoRandomSessionId();
    const idempotencyKey = AgentRunService.deriveIdempotencyKey({
      agentId: 'CFO_COPILOT',
      scope: sessionId,
      content: body.query,
    });

    const result = await this.runner.run({
      agentId: 'CFO_COPILOT',
      institutionId,
      organizationId: null,
      triggeredByUserId: req.user?.userId ?? null,
      triggerKind: 'USER_QUERY',
      triggerRef: sessionId,
      idempotencyKey,
      input: {
        institutionId,
        query: body.query,
        language: body.language,
        sessionId,
      },
    });

    return {
      sessionId,
      runId: result.runId,
      replay: result.existed,
      status: result.status,
      output: result.output ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    };
  }
}

function parseBody(raw: unknown) {
  return parseOrThrow(CopilotBodySchema, raw);
}

// Lightweight UUID v4 — avoids pulling in `uuid` just for this. Crypto
// quality is enough for a session handle (not used for security purposes).
function cryptoRandomSessionId(): string {
  // Node 20+ has crypto.randomUUID globally available
  return (globalThis.crypto?.randomUUID?.() ?? fallbackUuid()) as string;
}

function fallbackUuid(): string {
  const { randomBytes } =
    require('node:crypto') as typeof import('node:crypto');
  const buf = randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant 10
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
