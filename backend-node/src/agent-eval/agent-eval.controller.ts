import {
  Body,
  Controller,
  Inject,
  Logger,
  Optional,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { GoldenCase, RegressionReport } from './contracts';
import type { ReplayReport } from './replay.runner';
import { GoldenRunnerService } from './golden-runner.service';
import { ReplayRunnerService } from './replay.runner';
import { getOutputSchema } from '../agent-trust/schema-registry';
import type { AgentType } from '../agent-trust/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

export const GOLDEN_CASES = Symbol('GOLDEN_CASES');

const RunGoldenSchema = z.object({
  institutionId: z.string().min(1),
  only: z.array(z.string()).optional(),
  baselineAverage: z.number().optional(),
});

const ReplaySchema = z.object({
  runId: z.string().min(1),
  institutionId: z.string().min(1),
  agentType: z.string().min(1),
  narrative: z.string(),
  output: z.unknown(),
  trace: z.array(z.unknown()),
  computeMs: z.number(),
  priorVerdictPass: z.boolean().nullable().optional(),
  requiredLanguage: z.enum(['en', 'es', 'bilingual']).optional(),
  maxWords: z.number().optional(),
});

/**
 * REST surface for the eval harness and replay runner.
 *
 * - POST /eval/golden — runs golden cases against the agent runtime
 * - POST /eval/replay — replays trust validation against a stored run
 *
 * **Auth contract:** class-level `AuthGuard` enforces authentication.
 * Both handlers then call `InstitutionScopeGuard.verifyOwnership()` on
 * the body-supplied `institutionId` — same multi-context primitive
 * applied to `ai-advisor.controller.ts:ask()` in `e88ae20c`. Closes a
 * CRITICAL pre-fix vulnerability: the controller previously had ZERO
 * `@UseGuards`, so any unauthenticated caller could POST any
 * `institutionId` and trigger expensive LLM scoring against that
 * institution's data, billing Anthropic API calls to the platform.
 */
@Controller('api/v1/eval')
@UseGuards(AuthGuard)
export class AgentEvalController {
  private readonly logger = new Logger(AgentEvalController.name);

  constructor(
    private readonly goldenRunner: GoldenRunnerService,
    private readonly replayRunner: ReplayRunnerService,
    private readonly institutionScope: InstitutionScopeGuard,
    @Optional()
    @Inject(GOLDEN_CASES)
    private readonly goldenCases: readonly GoldenCase[] | null,
  ) {}

  @Post('golden')
  async runGolden(
    @Body() body: unknown,
    @Req() req: any,
  ): Promise<RegressionReport> {
    if (!this.goldenCases?.length) {
      throw new Error(
        'No golden cases registered. Provide GOLDEN_CASES token in AppModule.',
      );
    }
    const parsed = RunGoldenSchema.parse(body);
    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? '';
    await this.institutionScope.verifyOwnership(
      parsed.institutionId,
      userId,
      !!req.user?.access?.isPlatformAdmin,
    );
    return this.goldenRunner.run(parsed.institutionId, this.goldenCases, {
      only: parsed.only,
      baselineAverage: parsed.baselineAverage,
    });
  }

  @Post('replay')
  async replay(@Body() body: unknown, @Req() req: any): Promise<ReplayReport> {
    const parsed = ReplaySchema.parse(body);
    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? '';
    await this.institutionScope.verifyOwnership(
      parsed.institutionId,
      userId,
      !!req.user?.access?.isPlatformAdmin,
    );
    const schema = getOutputSchema(parsed.agentType as AgentType);

    return this.replayRunner.replay(
      {
        runId: parsed.runId,
        institutionId: parsed.institutionId,
        agentType: parsed.agentType as AgentType,
        narrative: parsed.narrative,
        output: parsed.output as Record<string, unknown>,
        trace: parsed.trace as any[],
        computeMs: parsed.computeMs,
      },
      parsed.priorVerdictPass != null
        ? {
            pass: parsed.priorVerdictPass,
            violations: [],
            summary: { block: 0, warn: 0, info: 0 },
            evaluatedInMs: 0,
          }
        : null,
      {
        outputSchema: schema,
        requiredLanguage: parsed.requiredLanguage,
        maxWords: parsed.maxWords,
      },
    );
  }
}
