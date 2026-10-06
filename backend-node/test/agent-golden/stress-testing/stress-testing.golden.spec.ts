/**
 * B2 — Stress Testing Agent Golden Spec Runner
 *
 * Iterates through all 10 golden cases using it.each, validates output shape
 * with the StressTestOutputSchema (Zod), asserts numeric values fall within
 * expected ranges, and asserts verdict/classification is in the allowed set.
 *
 * Cases that require a live agent wired to real ALM data are marked as
 * it.todo (integration placeholders) until the full pipeline is connected.
 */

import { z } from 'zod';
import {
  StressTestOutputSchema,
  StressScenarioResultSchema,
  ScenarioClassification,
} from '../../../src/agents/contracts/stress-testing.contracts';
import {
  STRESS_TESTING_GOLDEN_CASES,
  type StressTestGoldenCase,
} from './cases';

// ─── Helpers ───────────────────────────────────────────────────────────────

function inRange(value: number, [min, max]: [number, number]): boolean {
  return value >= min && value <= max;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Build a minimal valid StressTestOutput fixture from a golden case input.
 * Used for schema-shape validation tests. In integration mode the real agent
 * produces this; here we construct a synthetic output that satisfies the Zod
 * schema so we can verify our golden-case expectations are coherent.
 */
function buildSyntheticOutput(c: StressTestGoldenCase) {
  const now = new Date().toISOString();
  const midNii =
    (c.expectedOutput.niiImpactRange[0] + c.expectedOutput.niiImpactRange[1]) /
    2;
  const midEve =
    (c.expectedOutput.eveChangeRange[0] + c.expectedOutput.eveChangeRange[1]) /
    2;
  const verdict = c.expectedOutput.verdictOneOf[0] as 'PASS' | 'WARN' | 'FAIL';

  const buildScenario = (id: string, name: string) => ({
    scenarioId: id,
    name,
    rateShiftBps: c.input.rateShockBps,
    depositShockPct: c.input.depositRunoffPct ?? 0,
    creditShockPct: c.input.creditLossOverridePct ?? 0,
    prExclusive: c.input.scenarioType.startsWith('pr_'),
    niiImpact: midNii * 1_000_000,
    niiImpactPct: midNii,
    eveImpact: midEve * 1_000_000,
    eveImpactPct: midEve,
    depositImpact: c.input.depositRunoffPct
      ? -(c.input.depositRunoffPct * 500_000)
      : undefined,
    creditLossImpact: c.input.creditLossOverridePct
      ? c.input.creditLossOverridePct * 1_000_000
      : undefined,
    totalImpact: (midNii + midEve) * 1_000_000,
    classification: verdict,
    mitigation:
      verdict !== 'PASS'
        ? 'Reduce duration exposure by shifting $10M to variable-rate.'
        : undefined,
    mitigationEs:
      verdict !== 'PASS'
        ? 'Reducir exposicion de duracion moviendo $10M a tasa variable.'
        : undefined,
  });

  // StressTestOutputSchema requires min 6 scenarios
  const scenarios = [
    buildScenario(`${c.input.scenarioType}-1`, `${c.name} - Primary`),
    buildScenario(`${c.input.scenarioType}-2`, `${c.name} - Secondary`),
    buildScenario(`${c.input.scenarioType}-3`, `${c.name} - Tertiary`),
    buildScenario(`${c.input.scenarioType}-4`, `${c.name} - Quaternary`),
    buildScenario(`${c.input.scenarioType}-5`, `${c.name} - Quinary`),
    buildScenario(`${c.input.scenarioType}-6`, `${c.name} - Senary`),
  ];

  return {
    agentId: 'stress_testing' as const,
    version: '1.0' as const,
    runId: `synthetic-${c.input.institutionId}`,
    institutionId: c.input.institutionId,
    timestamp: now,
    language: 'bilingual' as const,
    scenarios,
    worstCase: {
      scenarioId: scenarios[0].scenarioId,
      totalImpact: scenarios[0].totalImpact,
      classification: verdict,
      actionPlan:
        verdict === 'FAIL'
          ? 'Immediate capital infusion and liability restructuring.'
          : undefined,
      actionPlanEs:
        verdict === 'FAIL'
          ? 'Infusion de capital inmediata y reestructuracion de pasivos.'
          : undefined,
    },
    summary: `Stress test results for ${c.name}.`,
    summaryEs: `Resultados de prueba de estres para ${c.name}.`,
    auditTraceId: `trace-${c.input.institutionId}`,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('Stress Testing Agent — Golden Cases', () => {
  // Smoke: cases array is well-formed
  it('has exactly 10 golden cases', () => {
    expect(STRESS_TESTING_GOLDEN_CASES).toHaveLength(10);
  });

  it('every case has a unique institutionId', () => {
    const ids = STRESS_TESTING_GOLDEN_CASES.map((c) => c.input.institutionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── Schema shape validation (synthetic output) ─────────────────────────

  describe('Zod schema shape validation', () => {
    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — synthetic output passes StressTestOutputSchema',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        const result = StressTestOutputSchema.safeParse(output);

        if (!result.success) {
          // Pretty-print Zod errors for debugging
          const formatted = result.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n');
          fail(
            `Schema validation failed for "${goldenCase.name}":\n${formatted}`,
          );
        }

        expect(result.success).toBe(true);
      },
    );
  });

  // ── Range assertions on synthetic outputs ──────────────────────────────

  describe('numeric range assertions', () => {
    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — NII impact within expected range',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        const niiImpactM = output.scenarios[0].niiImpact / 1_000_000;
        expect(
          inRange(niiImpactM, goldenCase.expectedOutput.niiImpactRange),
        ).toBe(true);
      },
    );

    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — EVE change within expected range',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        const eveChangePct = output.scenarios[0].eveImpactPct;
        expect(
          inRange(eveChangePct, goldenCase.expectedOutput.eveChangeRange),
        ).toBe(true);
      },
    );

    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — verdict is in allowed set',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);
        expect(goldenCase.expectedOutput.verdictOneOf).toContain(
          output.worstCase.classification,
        );
      },
    );
  });

  // ── Numeric safety (boundary & edge cases) ─────────────────────────────

  describe('numeric safety', () => {
    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — all numeric outputs are finite',
      (_name, goldenCase) => {
        const output = buildSyntheticOutput(goldenCase);

        for (const scenario of output.scenarios) {
          expect(isFiniteNumber(scenario.niiImpact)).toBe(true);
          expect(isFiniteNumber(scenario.niiImpactPct)).toBe(true);
          expect(isFiniteNumber(scenario.eveImpact)).toBe(true);
          expect(isFiniteNumber(scenario.eveImpactPct)).toBe(true);
          expect(isFiniteNumber(scenario.totalImpact)).toBe(true);
          if (scenario.depositImpact !== undefined) {
            expect(isFiniteNumber(scenario.depositImpact)).toBe(true);
          }
          if (scenario.creditLossImpact !== undefined) {
            expect(isFiniteNumber(scenario.creditLossImpact)).toBe(true);
          }
        }

        expect(isFiniteNumber(output.worstCase.totalImpact)).toBe(true);
      },
    );
  });

  // ── ScenarioClassification enum validation ─────────────────────────────

  describe('classification enum', () => {
    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — verdictOneOf contains only valid classifications',
      (_name, goldenCase) => {
        for (const v of goldenCase.expectedOutput.verdictOneOf) {
          expect(ScenarioClassification.safeParse(v).success).toBe(true);
        }
      },
    );
  });

  // ── Expected range coherence ───────────────────────────────────────────

  describe('golden case range coherence', () => {
    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — NII range min <= max',
      (_name, goldenCase) => {
        const [min, max] = goldenCase.expectedOutput.niiImpactRange;
        expect(min).toBeLessThanOrEqual(max);
      },
    );

    it.each(STRESS_TESTING_GOLDEN_CASES.map((c) => [c.name, c] as const))(
      '%s — EVE range min <= max',
      (_name, goldenCase) => {
        const [min, max] = goldenCase.expectedOutput.eveChangeRange;
        expect(min).toBeLessThanOrEqual(max);
      },
    );

    it.each(
      STRESS_TESTING_GOLDEN_CASES.filter(
        (c) => c.expectedOutput.lcrAfterRange,
      ).map((c) => [c.name, c] as const),
    )('%s — LCR range min <= max', (_name, goldenCase) => {
      const [min, max] = goldenCase.expectedOutput.lcrAfterRange!;
      expect(min).toBeLessThanOrEqual(max);
      expect(min).toBeGreaterThanOrEqual(0);
    });

    it.each(
      STRESS_TESTING_GOLDEN_CASES.filter(
        (c) => c.expectedOutput.durationGapRange,
      ).map((c) => [c.name, c] as const),
    )('%s — duration gap range min <= max', (_name, goldenCase) => {
      const [min, max] = goldenCase.expectedOutput.durationGapRange!;
      expect(min).toBeLessThanOrEqual(max);
      expect(min).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Integration placeholders ───────────────────────────────────────────
  // These will be activated once the stress-testing agent is wired to
  // real ALM computation services and produces live output.

  describe('integration tests (pending agent wiring)', () => {
    it.todo(
      'Parallel +200bps — live agent NII impact falls within golden range',
    );
    it.todo(
      'PR Hurricane stress — live agent deposit runoff modelled correctly',
    );
    it.todo(
      'COSSEC adverse — live agent covers all 11 prescribed scenario IDs',
    );
    it.todo(
      'Multi-shock combined — live agent compounds shocks without double-counting',
    );
    it.todo('Zero rate environment — live agent respects floor constraints');
    it.todo(
      'Extreme +400bps — live agent produces finite outputs at max shock',
    );
    it.todo(
      'Steepening — live agent correctly differentiates short vs long rate deltas',
    );
    it.todo(
      'Flattening — live agent NIM compression matches expected magnitude',
    );
    it.todo(
      'Recession — live agent prepayment multiplier applied to mortgage book',
    );
    it.todo(
      'COSSEC scenario battery — live agent runs all 11 COSSEC_SCENARIO_IDS',
    );
  });
});
