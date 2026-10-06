import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { AgentTrustService } from './agent-trust.service';
import { getOutputSchema } from './schema-registry';
import type {
  AgentType,
  AgentAuditLogReadModel,
  TrustVerdict,
} from './contracts';

const ValidateRequestSchema = z.object({
  agentType: z.string().min(1),
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  agentText: z.string(),
  agentOutput: z.unknown(),
  trace: z.array(
    z.object({
      id: z.string(),
      runId: z.string(),
      stepNumber: z.number(),
      stepType: z.string(),
      toolName: z.string().nullable().optional(),
      toolOutput: z.unknown().nullable().optional(),
    }),
  ),
  requiredLanguage: z.enum(['en', 'es', 'bilingual']).optional(),
  maxWords: z.number().optional(),
});

/**
 * REST surface for manual trust validation. Used by:
 * - The cockpit "Validate" button (re-run trust check on a past run)
 * - CI scripts that want to validate agent output before allowing deploy
 * - Developer debugging (curl a run's output and see trust violations)
 *
 * Auth: class-level `@UseGuards(AuthGuard)` requires a valid bearer token
 * on every route. The `validate()` handler additionally re-runs
 * `InstitutionScopeGuard.verifyOwnership(institutionId, userId, isPlatformAdmin)`
 * against the body-supplied `institutionId` — same shape as ai-advisor's
 * `POST /ask` (closed in `e88ae20c` / `4f9e2728`). The prior docstring
 * claimed "Protected by AuthGuard in production (added at AppModule
 * level)" — that was aspirational; AppModule registers only
 * APP_GUARD=UserThrottleGuard, no global AuthGuard. Closes
 * AUTH_COVERAGE_AUDIT gap #2 (POST /api/v1/trust/validate was reachable
 * unauthenticated, with body-trusted institutionId).
 */
@Controller('api/v1/trust')
@UseGuards(AuthGuard)
export class AgentTrustController {
  private readonly logger = new Logger(AgentTrustController.name);

  constructor(
    private readonly trust: AgentTrustService,
    private readonly institutionScope: InstitutionScopeGuard,
  ) {}

  @Post('validate')
  async validate(
    @Body() body: unknown,
    @Req() req: any,
  ): Promise<TrustVerdict> {
    const parsed = ValidateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? 'anonymous';

    await this.institutionScope.verifyOwnership(
      parsed.data.institutionId,
      userId,
      !!req.user?.access?.isPlatformAdmin,
    );

    this.logger.log(
      `trust validate: institution=${parsed.data.institutionId} run=${parsed.data.runId} agent=${parsed.data.agentType} user=${userId}`,
    );

    const schema = getOutputSchema(parsed.data.agentType as AgentType);

    return this.trust.evaluate({
      run: {
        id: parsed.data.runId,
        institutionId: parsed.data.institutionId,
        agentType: parsed.data.agentType as AgentType,
        status: 'SUCCEEDED',
        input: {},
        output: parsed.data.agentOutput as Record<string, unknown>,
        modelVersion: null,
      },
      agentText: parsed.data.agentText,
      agentOutput: parsed.data.agentOutput,
      trace: parsed.data.trace as unknown as AgentAuditLogReadModel[],
      outputSchema: schema,
      requiredLanguage: parsed.data.requiredLanguage,
      maxWords: parsed.data.maxWords,
    });
  }
}
