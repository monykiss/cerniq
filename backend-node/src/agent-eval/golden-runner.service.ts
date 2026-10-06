import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { HedgeLanguageDetector } from '../agent-trust/hedge-language.detector';
import { AGENT_EXECUTOR, type AgentExecutor } from './agent-executor.port';
import type { CaseScore, GoldenCase, RegressionReport } from './contracts';
import { RegressionScorerService } from './regression-scorer.service';

export interface RunHarnessOptions {
  /** If provided, the final {@link RegressionReport.deltaFromBaseline} is computed against this. */
  baselineAverage?: number;
  /** Optional golden-case filter (e.g. only "golden-001"). */
  only?: readonly string[];
}

/**
 * Runs a batch of golden cases against the agent runtime and produces a
 * {@link RegressionReport}. Used by CI (release gate) and the /eval admin
 * dashboard. Deterministic for the same fixtures + runtime.
 */
@Injectable()
export class GoldenRunnerService {
  private readonly logger = new Logger(GoldenRunnerService.name);

  constructor(
    @Optional()
    @Inject(AGENT_EXECUTOR)
    private readonly executor: AgentExecutor | null,
    private readonly scorer: RegressionScorerService,
    private readonly hedgeDetector: HedgeLanguageDetector,
  ) {}

  async run(
    institutionId: string,
    cases: readonly GoldenCase[],
    opts: RunHarnessOptions = {},
  ): Promise<RegressionReport> {
    if (!this.executor) {
      throw new Error(
        'GoldenRunnerService: no AGENT_EXECUTOR provided. Register the peer AgentRunnerService under AGENT_EXECUTOR in AgentEvalModule before calling run().',
      );
    }
    const selected = opts.only?.length
      ? cases.filter((c) => opts.only!.includes(c.id))
      : [...cases];

    const scores: CaseScore[] = [];
    for (const gold of selected) {
      this.logger.log(`eval: running case ${gold.id} ${gold.name}`);
      const result = await this.executor.execute({
        agentType: gold.agentType,
        institutionId,
        params: gold.params,
      });
      const hedgeCount = this.hedgeDetector.count(result.narrative);
      scores.push(this.scorer.scoreCase(gold, result, hedgeCount));
    }
    return this.scorer.buildReport(scores, opts.baselineAverage ?? null);
  }
}
