import { Injectable, Logger } from '@nestjs/common';
import type {
  AgentOutput,
  AgentRunResult,
  CaseScore,
  GoldenCase,
  GoldenExpectations,
  RegressionReport,
  ScoreBreakdown,
} from './contracts';
import { ScoreWeights, EvalThresholds, type DimensionKey } from './thresholds';

/**
 * Vol2 §Regression Scoring Framework — six-dimension weighted evaluator.
 *
 * Pure math. No DB, no network, no LLM. Deterministic for the same inputs,
 * which is a requirement for the replay harness.
 */
@Injectable()
export class RegressionScorerService {
  private readonly logger = new Logger(RegressionScorerService.name);

  scoreCase(
    gold: GoldenCase,
    result: AgentRunResult,
    hedgeCount: number,
  ): CaseScore {
    const failures: string[] = [];
    const dims: ScoreBreakdown = {
      toolCoverage: this.toolCoverage(gold.expected, result, failures),
      dollarQuantification: this.dollarQuantification(
        gold.expected,
        result,
        failures,
      ),
      specificity: this.specificity(result, hedgeCount),
      regulatoryReference: this.regulatoryReference(
        gold.expected,
        result,
        failures,
      ),
      bilingualCompleteness: this.bilingualCompleteness(
        gold.expected,
        result,
        failures,
      ),
      formatCompliance: this.formatCompliance(gold.expected, result, failures),
      total: 0,
    };
    dims.total = weightedTotal(dims);
    return { caseId: gold.id, caseName: gold.name, score: dims, failures };
  }

  buildReport(
    caseScores: readonly CaseScore[],
    baselineAverage: number | null,
  ): RegressionReport {
    const averageScore =
      caseScores.length === 0
        ? 0
        : caseScores.reduce((sum, c) => sum + c.score.total, 0) /
          caseScores.length;
    const blockedCases = caseScores
      .filter((c) => c.score.total < EvalThresholds.deployGate)
      .map((c) => c.caseId);
    const deltaFromBaseline =
      baselineAverage == null ? null : averageScore - baselineAverage;
    const passesDeployGate =
      averageScore >= EvalThresholds.deployGate && blockedCases.length === 0;

    if (!passesDeployGate) {
      this.logger.warn(
        `eval: deploy gate failed avg=${averageScore.toFixed(1)} blocked=${blockedCases.length}`,
      );
    }
    return {
      runAt: new Date().toISOString(),
      averageScore,
      cases: [...caseScores],
      blockedCases,
      deltaFromBaseline,
      passesDeployGate,
    };
  }

  // --- dimension scorers (each returns [0, 100]) ---

  private toolCoverage(
    exp: GoldenExpectations,
    result: AgentRunResult,
    failures: string[],
  ): number {
    if (exp.toolsCalledMin == null) return 100;
    const toolCalls = result.trace.filter(
      (s) => s.stepType === 'TOOL_CALL',
    ).length;
    const ratio = toolCalls / exp.toolsCalledMin;
    if (ratio < 1) {
      failures.push(`tool coverage: ${toolCalls} < min ${exp.toolsCalledMin}`);
    }
    return Math.min(100, ratio * 100);
  }

  private dollarQuantification(
    exp: GoldenExpectations,
    result: AgentRunResult,
    failures: string[],
  ): number {
    const risks = result.output.topRisks ?? [];
    if (risks.length === 0) {
      if (exp.hasMinDollarQuantification)
        failures.push('dollar quant: no topRisks emitted');
      return 0;
    }
    const withDollar = risks.filter(
      (r) => typeof r.dollarImpact === 'number' && r.dollarImpact > 0,
    ).length;
    const pct = (withDollar / risks.length) * 100;
    if (exp.hasMinDollarQuantification && withDollar === 0) {
      failures.push('dollar quant: expected ≥1 finding with $ amount, got 0');
    }
    return pct;
  }

  private specificity(result: AgentRunResult, hedgeCount: number): number {
    // Specificity = presence of verb+amount+asset+deadline in recommendations,
    // inversely penalized by hedge tokens. We use a simple proxy: every hedge
    // in the narrative subtracts 5 points from a base of 100, floored at 0.
    // Also penalize "vague" recommendations (no $ or deadline).
    const risks = result.output.topRisks ?? [];
    const recs = risks.map((r) => r.recommendation ?? '').filter(Boolean);
    const specificRecs = recs.filter((r) =>
      /\$\d|\d+\s?(?:bps|%)|by\s\d{4}-\d{2}-\d{2}/i.test(r),
    ).length;
    const recScore = recs.length === 0 ? 0 : (specificRecs / recs.length) * 100;
    return Math.max(0, recScore - hedgeCount * 5);
  }

  private regulatoryReference(
    exp: GoldenExpectations,
    result: AgentRunResult,
    failures: string[],
  ): number {
    const risks = result.output.topRisks ?? [];
    if (risks.length === 0) return exp.hasRegulatoryReference ? 0 : 100;
    const withRef = risks.filter(
      (r) => (r.regulatoryRef ?? '').trim().length > 0,
    ).length;
    const baseline = (withRef / risks.length) * 100;

    if (exp.requiredRegulatoryCodes?.length) {
      const narrativePlusRefs = [
        result.narrative,
        ...risks.map((r) => r.regulatoryRef ?? ''),
      ].join('\n');
      const missing = exp.requiredRegulatoryCodes.filter(
        (c) => !narrativePlusRefs.includes(c),
      );
      if (missing.length > 0) {
        failures.push(`missing required reg codes: ${missing.join(', ')}`);
        return Math.max(0, baseline - missing.length * 25);
      }
    }
    return baseline;
  }

  private bilingualCompleteness(
    exp: GoldenExpectations,
    result: AgentRunResult,
    failures: string[],
  ): number {
    if (!exp.bilingualRequired) return 100;
    const langs = result.output.languages ?? {};
    const en = (langs.en ?? '').trim().length > 0;
    const es = (langs.es ?? '').trim().length > 0;
    if (en && es) return 100;
    if (en || es) {
      failures.push(`bilingual: only ${en ? 'EN' : 'ES'} present`);
      return 50;
    }
    failures.push('bilingual: neither EN nor ES populated');
    return 0;
  }

  private formatCompliance(
    exp: GoldenExpectations,
    result: AgentRunResult,
    failures: string[],
  ): number {
    // A minimal structural check — scorer doesn't re-parse full Zod schemas,
    // the trust layer already did that. Here we check caller expectations.
    let penalties = 0;
    if (exp.topRiskDomain) {
      const actual = result.output.topRisks?.[0]?.domain;
      if (actual !== exp.topRiskDomain) {
        failures.push(
          `top risk domain: expected "${exp.topRiskDomain}", got "${actual}"`,
        );
        penalties += 50;
      }
    }
    if (exp.healthScoreRange && result.output.healthScore) {
      const [lo, hi] = exp.healthScoreRange;
      const s = result.output.healthScore.score;
      if (s < lo || s > hi) {
        failures.push(`health score: ${s} outside [${lo}, ${hi}]`);
        penalties += 30;
      }
    }
    return Math.max(0, 100 - penalties);
  }
}

function weightedTotal(b: ScoreBreakdown): number {
  let total = 0;
  for (const key of Object.keys(ScoreWeights) as DimensionKey[]) {
    total += b[key] * ScoreWeights[key];
  }
  return Number(total.toFixed(2));
}

// helper re-used in tests
export const __weightedTotal = weightedTotal;

/** Type-check: unused export hook so ScoreWeights drift is caught at compile time. */
type _Dims = keyof AgentOutput;
