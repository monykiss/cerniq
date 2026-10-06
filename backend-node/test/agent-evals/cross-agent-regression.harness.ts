/**
 * Cross-Agent Regression Harness
 *
 * Validates cross-agent interactions where one agent's output feeds into
 * another (agent chains). Tests both the Monthly Governance chain and the
 * Pre-Exam chain defined in Vol.1 Bible.
 *
 * The harness mocks the agent runner and validates that:
 *   - Step N's output can be consumed by step N+1's input transform
 *   - Short-circuit conditions terminate the chain correctly
 *   - Cumulative token usage and cost are tracked across all steps
 *   - End-to-end acceptance criteria are satisfied
 *
 * Usage:
 *   const harness = new CrossAgentRegressionHarness();
 *   harness.defineChain(monthlyGovernanceChain);
 *   const result = await harness.runChain('monthly_governance', { institutionId: 'test-001' });
 *   harness.validateChainOutput(result, acceptanceCriteria);
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChainStepFixture {
  agentId: string;
  /** Mock output returned when this agent step runs. */
  fixtureOutput: Record<string, unknown>;
  /** Token usage for this step. */
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** Optional: if provided, the step only runs when this returns true. */
  runCondition?: (priorOutput: unknown) => boolean;
}

export interface ChainConfig {
  id: string;
  name: string;
  steps: ChainStepFixture[];
  /** Transform function mapping step N output to step N+1 input. */
  inputTransforms: Array<(priorOutput: unknown) => unknown>;
  /** Optional validation for each step's output before passing downstream. */
  outputValidations?: Array<((output: unknown) => boolean) | undefined>;
}

export interface ChainStepResult {
  stepIndex: number;
  agentId: string;
  input: unknown;
  output: Record<string, unknown>;
  tokenUsage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  skipped: boolean;
}

export interface ChainRunResult {
  chainId: string;
  chainName: string;
  steps: ChainStepResult[];
  completedSteps: number;
  totalSteps: number;
  shortCircuited: boolean;
  shortCircuitReason?: string;
  cumulativeTokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  estimatedCostUsd: number;
  totalDurationMs: number;
  finalOutput: unknown;
  success: boolean;
}

export interface AcceptanceCriteria {
  /** Final output must contain all these top-level keys. */
  requiredOutputKeys?: string[];
  /** Custom predicate applied to the final chain output. */
  finalOutputPredicate?: (output: unknown) => boolean;
  /** Max cumulative tokens allowed across the chain. */
  maxTotalTokens?: number;
  /** Max estimated cost in USD. */
  maxCostUsd?: number;
  /** All steps must complete (no short-circuit). */
  requireAllSteps?: boolean;
  /** Minimum number of completed steps. */
  minCompletedSteps?: number;
}

export interface ValidationResult {
  pass: boolean;
  failures: string[];
}

// ─── Cost constants ─────────────────────────────────────────────────────────

/** Pricing per 1M tokens (Claude Sonnet 4 estimates, used for cost tracking). */
const COST_PER_1M_INPUT = 3.0;
const COST_PER_1M_OUTPUT = 15.0;

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * COST_PER_1M_INPUT +
    (outputTokens / 1_000_000) * COST_PER_1M_OUTPUT
  );
}

// ─── Harness ────────────────────────────────────────────────────────────────

export class CrossAgentRegressionHarness {
  private chains = new Map<string, ChainConfig>();

  /**
   * Register a chain configuration with its fixture data.
   */
  defineChain(config: ChainConfig): void {
    if (config.steps.length === 0) {
      throw new Error(`Chain "${config.id}" must have at least one step`);
    }
    if (config.inputTransforms.length !== config.steps.length) {
      throw new Error(
        `Chain "${config.id}": inputTransforms length (${config.inputTransforms.length}) ` +
          `must match steps length (${config.steps.length})`,
      );
    }
    this.chains.set(config.id, config);
  }

  /**
   * Execute a chain using fixture data, validating inter-step data flow.
   */
  async runChain(
    chainId: string,
    opts: { institutionId: string; initialInput?: unknown },
  ): Promise<ChainRunResult> {
    const config = this.chains.get(chainId);
    if (!config) {
      throw new Error(`Unknown chain: ${chainId}. Call defineChain() first.`);
    }

    const steps: ChainStepResult[] = [];
    let currentInput: unknown = opts.initialInput ?? {};
    let shortCircuited = false;
    let shortCircuitReason: string | undefined;
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    const startMs = performance.now();

    for (let i = 0; i < config.steps.length; i++) {
      const step = config.steps[i];
      const stepStartMs = performance.now();

      // Apply input transform to produce this step's input
      const transformedInput = config.inputTransforms[i](currentInput);

      // Check run condition (short-circuit support)
      if (step.runCondition && !step.runCondition(currentInput)) {
        steps.push({
          stepIndex: i,
          agentId: step.agentId,
          input: transformedInput,
          output: {},
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 0,
          skipped: true,
        });
        shortCircuited = true;
        shortCircuitReason = `Step ${i} (${step.agentId}): runCondition returned false`;
        break;
      }

      // Validate prior step's output if validator is defined
      if (i > 0 && config.outputValidations?.[i - 1]) {
        const validator = config.outputValidations[i - 1]!;
        const priorOutput = steps[i - 1].output;
        if (!validator(priorOutput)) {
          shortCircuited = true;
          shortCircuitReason = `Step ${i - 1} (${steps[i - 1].agentId}): output validation failed`;
          break;
        }
      }

      // "Run" the step using fixture output
      const stepDurationMs = Math.round(performance.now() - stepStartMs);
      cumulativeInput += step.tokenUsage.inputTokens;
      cumulativeOutput += step.tokenUsage.outputTokens;

      steps.push({
        stepIndex: i,
        agentId: step.agentId,
        input: transformedInput,
        output: step.fixtureOutput,
        tokenUsage: step.tokenUsage,
        durationMs: stepDurationMs,
        skipped: false,
      });

      // Current output becomes next step's input basis
      currentInput = step.fixtureOutput;
    }

    const totalDurationMs = Math.round(performance.now() - startMs);
    const completedSteps = steps.filter((s) => !s.skipped).length;
    const lastCompleted = steps.filter((s) => !s.skipped).pop();

    return {
      chainId: config.id,
      chainName: config.name,
      steps,
      completedSteps,
      totalSteps: config.steps.length,
      shortCircuited,
      shortCircuitReason,
      cumulativeTokens: {
        inputTokens: cumulativeInput,
        outputTokens: cumulativeOutput,
        totalTokens: cumulativeInput + cumulativeOutput,
      },
      estimatedCostUsd: estimateCost(cumulativeInput, cumulativeOutput),
      totalDurationMs,
      finalOutput: lastCompleted?.output ?? null,
      success:
        !shortCircuited ||
        (shortCircuitReason?.includes('runCondition') ?? false),
    };
  }

  /**
   * Validate a chain run result against acceptance criteria.
   */
  validateChainOutput(
    result: ChainRunResult,
    criteria: AcceptanceCriteria,
  ): ValidationResult {
    const failures: string[] = [];

    if (criteria.requireAllSteps && result.shortCircuited) {
      failures.push(
        `Expected all ${result.totalSteps} steps but chain short-circuited at step ${result.completedSteps}: ${result.shortCircuitReason}`,
      );
    }

    if (
      criteria.minCompletedSteps !== undefined &&
      result.completedSteps < criteria.minCompletedSteps
    ) {
      failures.push(
        `Expected at least ${criteria.minCompletedSteps} completed steps, got ${result.completedSteps}`,
      );
    }

    if (criteria.requiredOutputKeys && result.finalOutput) {
      const outputObj = result.finalOutput as Record<string, unknown>;
      for (const key of criteria.requiredOutputKeys) {
        if (!(key in outputObj)) {
          failures.push(`Final output missing required key: "${key}"`);
        }
      }
    }

    if (
      criteria.finalOutputPredicate &&
      !criteria.finalOutputPredicate(result.finalOutput)
    ) {
      failures.push('Final output failed acceptance predicate');
    }

    if (
      criteria.maxTotalTokens !== undefined &&
      result.cumulativeTokens.totalTokens > criteria.maxTotalTokens
    ) {
      failures.push(
        `Cumulative tokens ${result.cumulativeTokens.totalTokens} exceed max ${criteria.maxTotalTokens}`,
      );
    }

    if (
      criteria.maxCostUsd !== undefined &&
      result.estimatedCostUsd > criteria.maxCostUsd
    ) {
      failures.push(
        `Estimated cost $${result.estimatedCostUsd.toFixed(4)} exceeds max $${criteria.maxCostUsd.toFixed(4)}`,
      );
    }

    return {
      pass: failures.length === 0,
      failures,
    };
  }

  /**
   * Get cumulative metrics for a completed chain run.
   */
  getCumulativeMetrics(result: ChainRunResult): {
    totalTokens: number;
    estimatedCostUsd: number;
    avgTokensPerStep: number;
    completionRate: number;
    agentsInvolved: string[];
  } {
    const completedSteps = result.steps.filter((s) => !s.skipped);
    return {
      totalTokens: result.cumulativeTokens.totalTokens,
      estimatedCostUsd: result.estimatedCostUsd,
      avgTokensPerStep:
        completedSteps.length > 0
          ? Math.round(
              result.cumulativeTokens.totalTokens / completedSteps.length,
            )
          : 0,
      completionRate:
        result.totalSteps > 0 ? result.completedSteps / result.totalSteps : 0,
      agentsInvolved: completedSteps.map((s) => s.agentId),
    };
  }

  /**
   * Verify that step N's output schema is compatible with step N+1's
   * input transform (does the transform execute without throwing?).
   */
  validateInterStepCompatibility(chainId: string): ValidationResult {
    const config = this.chains.get(chainId);
    if (!config) {
      return { pass: false, failures: [`Unknown chain: ${chainId}`] };
    }

    const failures: string[] = [];

    for (let i = 0; i < config.steps.length - 1; i++) {
      const currentOutput = config.steps[i].fixtureOutput;
      const nextTransform = config.inputTransforms[i + 1];

      try {
        const nextInput = nextTransform(currentOutput);
        if (nextInput === undefined || nextInput === null) {
          failures.push(
            `Step ${i} (${config.steps[i].agentId}) -> Step ${i + 1} (${config.steps[i + 1].agentId}): ` +
              `transform returned ${nextInput}`,
          );
        }
      } catch (err) {
        failures.push(
          `Step ${i} (${config.steps[i].agentId}) -> Step ${i + 1} (${config.steps[i + 1].agentId}): ` +
            `transform threw: ${(err as Error).message}`,
        );
      }
    }

    return {
      pass: failures.length === 0,
      failures,
    };
  }

  /**
   * Clear all registered chains (useful between test suites).
   */
  reset(): void {
    this.chains.clear();
  }
}
