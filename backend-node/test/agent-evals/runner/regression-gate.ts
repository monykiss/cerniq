/**
 * Regression gate — compares eval results against baseline.
 *
 * Exit codes:
 *   0 — pass (avg ≥ 80%, no regression)
 *   1 — fail (avg < 80% OR ≥ 5pt drop)
 *
 * Usage:
 *   CERNIQ_EVAL_RESULTS=/path/to/results.json \
 *   CERNIQ_EVAL_BASELINE=/path/to/baselines/alm_decision.json \
 *   node dist/test/agent-evals/runner/regression-gate.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { PASS_THRESHOLD, REGRESSION_DROP_THRESHOLD } from '../scoring/weights';
import type { EvalResult, EvalBaseline } from './fixture-types';

function main() {
  const resultsPath = process.env.CERNIQ_EVAL_RESULTS;
  const baselinePath = process.env.CERNIQ_EVAL_BASELINE;

  if (!resultsPath) {
    console.error('CERNIQ_EVAL_RESULTS not set');
    process.exit(1);
  }

  const results: EvalResult[] = JSON.parse(readFileSync(resultsPath, 'utf-8'));

  if (results.length === 0) {
    console.error('No eval results');
    process.exit(1);
  }

  const avgScore =
    results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const failedCases = results.filter((r) => !r.pass);

  console.log(`\n  Agent Eval Gate`);
  console.log(`  ═══════════════════════════════════`);
  console.log(`  Cases:        ${results.length}`);
  console.log(`  Avg Score:    ${(avgScore * 100).toFixed(1)}%`);
  console.log(`  Pass Thresh:  ${(PASS_THRESHOLD * 100).toFixed(0)}%`);
  console.log(`  Failed Cases: ${failedCases.length}`);

  let regressionDetected = false;

  if (baselinePath && existsSync(baselinePath)) {
    const baseline: EvalBaseline = JSON.parse(
      readFileSync(baselinePath, 'utf-8'),
    );
    const drop = baseline.meanScore - avgScore;
    console.log(`  Baseline:     ${(baseline.meanScore * 100).toFixed(1)}%`);
    console.log(`  Delta:        ${(drop * -100).toFixed(1)}pp`);

    if (drop >= REGRESSION_DROP_THRESHOLD) {
      console.error(
        `\n  ❌ REGRESSION: ${(drop * 100).toFixed(1)}pp drop (threshold: ${(REGRESSION_DROP_THRESHOLD * 100).toFixed(0)}pp)`,
      );
      regressionDetected = true;
    }
  } else {
    console.log(`  Baseline:     (none — first run)`);
  }

  if (avgScore < PASS_THRESHOLD) {
    console.error(
      `\n  ❌ BELOW THRESHOLD: ${(avgScore * 100).toFixed(1)}% < ${(PASS_THRESHOLD * 100).toFixed(0)}%`,
    );
    process.exit(1);
  }

  if (regressionDetected) {
    process.exit(1);
  }

  console.log(`\n  ✅ PASS`);
  process.exit(0);
}

main();
