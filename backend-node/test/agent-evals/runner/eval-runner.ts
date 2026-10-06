/**
 * Eval Runner — orchestrates golden-case evaluation.
 *
 * Flow:
 *   1. Load golden case JSON (expectedFindings + input)
 *   2. Load or build an LLM script (deterministic mock turns)
 *   3. Create a MockLlmBridge from the script
 *   4. Run the agent through the real AgentRunnerService with mock LLM
 *   5. Collect audit trace
 *   6. Score output against expected findings using 6-dimension scorer
 *   7. Return EvalResult
 *
 * The runner does NOT need a running database — it exercises the scoring
 * framework against pre-built outputs. When we need full integration testing
 * (NestJS + Prisma + mock LLM), the agent-evals.e2e-spec.ts handles that.
 *
 * For now, this module supports "offline scoring" — you feed it an output
 * object and a trace, and it scores them. The full NestJS integration is
 * a future extension once the agent runner stabilises.
 */

import type { GoldenCase, EvalResult } from './fixture-types';
import type { AuditStep } from '../scoring/dimensions';
import { scoreAgentRun, PASS_THRESHOLD } from '../scoring/weights';
import { loadScript } from './load-case';

export interface OfflineEvalInput {
  goldenCase: GoldenCase;
  actualOutput: unknown;
  auditTrace: AuditStep[];
}

/**
 * Score a pre-computed agent output against a golden case.
 *
 * Use this when you have the output already (e.g., from a real agent run
 * you captured, or from a mock run). No LLM, no NestJS.
 */
export function scoreOffline(input: OfflineEvalInput): EvalResult {
  const startMs = performance.now();

  const { goldenCase, actualOutput, auditTrace } = input;

  const toolsCalled = auditTrace
    .filter((s) => s.stepKind === 'TOOL_CALL' && s.toolName)
    .map((s) => s.toolName!);

  const composite = scoreAgentRun(
    actualOutput,
    auditTrace,
    goldenCase.expectedFindings,
  );

  const durationMs = Math.round(performance.now() - startMs);

  return {
    caseId: goldenCase.id,
    caseName: goldenCase.name,
    agentId: goldenCase.agentId,
    score: composite.total,
    pass: composite.pass,
    breakdown: composite.breakdown,
    durationMs,
    toolsCalled,
  };
}

/**
 * Run a batch of offline evals and produce a summary.
 */
export function runBatch(cases: OfflineEvalInput[]): {
  results: EvalResult[];
  avgScore: number;
  allPass: boolean;
} {
  const results = cases.map(scoreOffline);
  const avgScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;
  const allPass = results.every((r) => r.pass);

  return { results, avgScore, allPass };
}

/**
 * Pretty-print a scorecard to stdout (for CI logs).
 */
export function printScorecard(results: EvalResult[]): void {
  const avgScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;

  console.log('\n  CERNIQ Agent Eval Scorecard');
  console.log('  ═══════════════════════════════════════════════');
  console.log(`  Cases:     ${results.length}`);
  console.log(
    `  Avg Score: ${(avgScore * 100).toFixed(1)}% ${avgScore >= PASS_THRESHOLD ? '✅' : '❌'}`,
  );
  console.log('  ───────────────────────────────────────────────');

  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(
      `  ${icon} ${r.caseId.padEnd(12)} ${(r.score * 100).toFixed(1).padStart(5)}%  ${r.caseName}`,
    );
    if (!r.pass) {
      for (const [dim, info] of Object.entries(r.breakdown)) {
        if (info.score < 0.8) {
          console.log(
            `     ↳ ${dim}: ${(info.score * 100).toFixed(0)}% — ${info.evidence.join('; ')}`,
          );
        }
      }
    }
  }

  console.log('  ═══════════════════════════════════════════════\n');
}
